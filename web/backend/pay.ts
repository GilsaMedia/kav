// Paying for a ride with the rider's own Moovit payment account ("IsraelMot"). Mirrors
// android/.../data/MoovitPay.kt. Every call goes out as a Moovit user made only for paying.
import { TWriter, TReader, TType, type TStruct } from "./thrift.ts";
import { APP4, post, authHeaders, type MoovitSession, type LatLon } from "./moovit.ts";

const CONTEXT = "IsraelMot";
export const BUS = 3;
export const STEP_PHONE = 1, STEP_PAYMENT_METHOD = 8, STEP_TERMS = 10;
export const TRAM = 0, RAIL = 2, CABLE = 5;

export class Refused extends Error {
  title: string;
  constructor(title: string, message: string) { super(message); this.title = title; }
}
export class Unauthorized extends Error { constructor() { super("not signed in"); } }

export interface Price { agorot: number; code: string }
export interface Cost { price: Price; full: Price; reasons: string[] }
export interface Fare {
  code: number; radius: number; regionId: number; originRegionId: number; price: Price; full: Price | null;
  from: string | null; to: string | null; reasons: string[]; cases: string[];
}
export interface Offer { context: string; profile: string; fares: Fare[] }
export interface Ticket {
  id: number; ref: string; boughtUtc: number; title: string; price: Price | null; profile: string; agency: string;
  active: boolean; qr: string; endsUtc: number; passenger: string; radius: number; mode: number;
  fromStopId: number; toStopId: number; anonymous: boolean; needsExit: boolean;
}
export interface Station {
  stopId: number; name: string; price: Price | null; full: Price | null; fareCode: number; radius: number;
  context: string; destinationStopId: number; reasons: string[]; cases: string[];
}

type S = TStruct;
const sStr = (m: S | undefined, id: number) => { const v = m?.get(id); return typeof v === "string" && v ? v : undefined; };
const sNum = (m: S | undefined, id: number) => { const v = m?.get(id); return typeof v === "number" ? v : typeof v === "string" ? Number(v) : undefined; };
const sRec = (m: S | undefined, id: number) => { const v = m?.get(id); return v instanceof Map ? v as S : undefined; };
const sRecs = (m: S | undefined, id: number) => { const v = m?.get(id); return Array.isArray(v) ? v.filter(x => x instanceof Map) as S[] : []; };
const sInts = (m: S | undefined, id: number) => { const v = m?.get(id); return Array.isArray(v) ? v.filter(x => typeof x === "number") as number[] : []; };
const sStrs = (m: S | undefined, id: number) => { const v = m?.get(id); return Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : []; };

const latlon = (at: LatLon) => new TWriter().i32Field(1, Math.trunc(at[0] * 1e6)).i32Field(2, Math.trunc(at[1] * 1e6));

// Binary Thrift both ways. Null for an empty answer.
async function call(user: MoovitSession, path: string, body: TWriter): Promise<S | null> {
  const [code, raw] = await post(APP4, path, body.stop().bytes(), authHeaders(user));
  if (code === 204 || (code === 200 && !raw.length)) return null;
  let s: S | null = null;
  try { s = new TReader(raw).readStruct(); } catch { /* not a struct */ }
  if (code === 200) return s;
  if (code === 401) throw new Unauthorized();
  const title = sStr(s ?? undefined, 1);
  if (title) throw new Refused(title, sStr(s!, 2) ?? title);
  // Moovit's other refusals keep their words deeper in the struct, or send plain text: say what they say.
  const said = (s ? texts(s) : []).join(" · ") || plain(raw);
  if (said && code >= 400 && code < 500) throw new Refused(said, said);
  throw new Error(`${path.split("/").pop()} HTTP ${code}${said ? ": " + said : ""}`);
}

function texts(m: S, depth = 0): string[] {
  const out: string[] = [];
  for (const v of m.values()) {
    if (typeof v === "string" && v.trim() && v.length < 300) out.push(v.trim());
    else if (v instanceof Map && depth < 2) out.push(...texts(v as S, depth + 1));
  }
  return out.slice(0, 2);
}

function plain(raw: Uint8Array): string {
  const t = new TextDecoder().decode(raw.subarray(0, 400)).trim();
  return /^[\p{L}\p{N}\p{P}\s]+$/u.test(t) ? t.slice(0, 200) : "";
}

function cardOf(steps?: S) {
  const pm = sRec(steps, 5);
  if (!pm || pm.get(4) !== true) return null;
  const c = sRec(sRec(pm, 2), 1);
  const last4 = sStr(c, 2);
  return last4 ? { type: sStr(c, 1) ?? "", last4 } : null;
}

export async function steps(user: MoovitSession) {
  const root = sRec(await call(user, "PaymentContext/GetMissingSteps", new TWriter().strField(1, CONTEXT)) ?? undefined, 1);
  if (!root) return { missing: [] as number[], terms: null, card: null };
  const t = sRec(root, 4);
  const cta = sRec(t, 6) ?? sRec(t, 3);
  const terms = t ? {
    title: sStr(t, 1) ?? "", text: sStr(t, 2) ?? "", agree: sStr(cta, 1) ?? "",
    links: sRecs(cta, 2).map(l => [sStr(l, 1) ?? "", sStr(l, 2) ?? ""]), button: sStr(t, 7) ?? "", version: sNum(t, 8) ?? 1,
  } : null;
  return { missing: sInts(root, 2), terms, card: cardOf(root) };
}

export async function acceptTerms(user: MoovitSession, version: number) {
  await call(user, "PaymentContext/TosConfirmation", new TWriter().strField(1, CONTEXT).i32Field(2, version));
}

// An Israeli number as Moovit's app sends it, "054-123-4567", with the calling code apart.
export async function sendCode(user: MoovitSession, phone: string) {
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("972")) d = "0" + d.slice(3);
  const shown = d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
  await call(user, "PaymentContext/GenerateVerificationToken", new TWriter().strField(1, shown).strField(2, "+972").strField(3, CONTEXT));
}

export async function verify(user: MoovitSession, code: string, takeOver: boolean) {
  const root = await call(user, "PaymentContext/RegistrationVerification",
    new TWriter().strField(1, CONTEXT).strField(2, code).boolField(3, !takeOver));
  if (!root) return { exists: true, elsewhere: false, missing: [] as number[], card: null };
  const st = sRec(root, 2);
  return { exists: root.get(3) === true, elsewhere: root.get(3) === true && root.get(1) !== true, missing: sInts(st, 2), card: cardOf(st) };
}

// The CVV goes to Moovit once and is kept nowhere.
export async function confirmCard(user: MoovitSession, cvv: string) {
  // Digits only: the iPhone keyboard or autofill can bring a space along.
  const digits = cvv.replace(/\D/g, "");
  try {
    await call(user, "PTB/Accounts/SetBillingAccount", new TWriter().strField(1, CONTEXT).strField(2, digits));
  } catch (e) {
    // Moovit's server answers 500 {"error":"null"} when it finds nothing where it looks for the CVV. Once
    // more with the CVV in a struct of its own, as Moovit's newer requests carry their card details.
    if (!(e instanceof Error) || !/HTTP 500/.test(e.message)) throw e;
    await call(user, "PTB/Accounts/SetBillingAccount",
      new TWriter().strField(1, CONTEXT).structField(2, new TWriter().strField(1, digits)));
  }
}

export async function account(user: MoovitSession) {
  const acc = sRec(await call(user, "PaymentContext/GetPaymentAccount", new TWriter()) ?? undefined, 1);
  if (!acc) return null;
  const person = sRec(acc, 3);
  return {
    name: [sStr(person, 1), sStr(person, 2)].filter(Boolean).join(" "), phone: sStr(person, 6) ?? "",
    connected: sRecs(acc, 2).some(c => sStr(c, 1) === CONTEXT && sNum(c, 2) === 2),
  };
}

const priceOf = (m?: S): Price | null => { const a = sNum(m, 1); return a == null ? null : { agorot: a, code: sStr(m, 4) ?? "ILS" }; };
function costOf(m?: S): Cost | null {
  const price = priceOf(sRec(m, 1)); if (!price) return null;
  return { price, full: priceOf(sRec(m, 2)) ?? price, reasons: sStrs(m, 3) };
}
const amount = (p: Price) => new TWriter().i64Field(1, p.agorot).i32Field(2, 0).strField(3, "").strField(4, p.code);

export async function price(user: MoovitSession, qr: string, at: LatLon, transitType = BUS): Promise<Offer> {
  const root = await call(user, "PTB/Activations/GetActivationPriceV2",
    new TWriter().strField(1, qr).structField(2, latlon(at)).i32Field(3, transitType));
  if (!root) throw new Error("no price");
  const regions = new Map(sRecs(root, 5).map(r => [sNum(r, 1) ?? 0, sStr(r, 3) ?? null]));
  const fares: Fare[] = [];
  for (const f of sRecs(root, 2)) for (const rp of sRecs(f, 4)) {
    const ap = sRec(rp, 2); const code = sNum(f, 1); const regionId = sNum(rp, 1); const p = priceOf(sRec(ap, 1));
    if (!ap || code == null || regionId == null || !p) continue;
    fares.push({
      code, radius: sNum(f, 2) ?? 0, regionId, originRegionId: sNum(f, 5) ?? 0, price: p, full: priceOf(sRec(ap, 2)),
      from: regions.get(sNum(f, 5) ?? -1) ?? null, to: regions.get(regionId) ?? null, reasons: sStrs(ap, 3), cases: sStrs(ap, 4),
    });
  }
  return { context: sStr(root, 1) ?? "", profile: sStr(root, 3) ?? "", fares };
}

function regionPrice(f: Fare) {
  const ap = new TWriter().structField(1, amount(f.price));
  if (f.full && f.full.agorot > f.price.agorot) ap.structField(2, amount(f.full));
  if (f.reasons.length) ap.listField(3, TType.STRING, f.reasons, (w, s) => w.str(s));
  if (f.cases.length) ap.listField(4, TType.STRING, f.cases, (w, s) => w.str(s));
  return new TWriter().i32Field(1, f.regionId).structField(2, ap);
}

async function quoteOf(user: MoovitSession, intent: TWriter) {
  const root = await call(user, "PTB/Activations/GetPriceFullDetails", new TWriter().structField(1, intent));
  if (!root) throw new Error("no quote");
  return { main: costOf(sRec(root, 1)), other: costOf(sRec(root, 2)) };
}

export function quoteFare(user: MoovitSession, offer: Offer, f: Fare, at: LatLon) {
  const bus = new TWriter().structField(1, new TWriter().i32Field(1, f.code).i32Field(2, f.radius)).structField(2, regionPrice(f));
  if (f.originRegionId) bus.i32Field(3, f.originRegionId);
  bus.strField(4, offer.context).structField(5, latlon(at));
  return quoteOf(user, new TWriter().structField(1, bus));
}

export function quoteStation(user: MoovitSession, s: Station, routeType: number) {
  const st = new TWriter().i32Field(1, routeType).i32Field(2, s.stopId);
  if (s.destinationStopId) st.i32Field(3, s.destinationStopId);
  if (s.price) st.structField(4, amount(s.price));
  if (s.full) st.structField(5, amount(s.full));
  st.structField(6, new TWriter().i32Field(1, s.fareCode).i32Field(2, s.radius)).strField(7, s.context);
  return quoteOf(user, new TWriter().structField(2, st));
}

function ticketOf(a: S, groupRef: string): Ticket {
  const mode = sNum(a, 16) ?? 0, fromStopId = sNum(a, 13) ?? 0, toStopId = sNum(a, 14) ?? 0;
  return {
    id: sNum(a, 1) ?? 0, ref: sStr(a, 19) ?? groupRef, boughtUtc: sNum(a, 2) ?? 0, title: sStr(a, 3) ?? "",
    price: priceOf(sRec(sRec(a, 4), 1)), profile: sStr(a, 5) ?? "", agency: sStr(a, 7) ?? "",
    active: (sNum(a, 10) ?? 1) === 1, qr: sStr(a, 12) ?? "", endsUtc: sNum(a, 15) ?? 0,
    passenger: sStr(a, 18) ?? "", radius: sNum(sRec(a, 17), 2) ?? 0, mode, fromStopId, toStopId,
    anonymous: a.get(6) === true, needsExit: mode === 7 && fromStopId !== 0 && toStopId === 0,
  };
}

function ticketsOf(group?: S): Ticket[] {
  const ref = sStr(group, 1) ?? "";
  const out = sRecs(group, 2).map(t => ticketOf(t, ref));
  if (!out.length) throw new Error("no ticket");
  return out;
}

export async function buy(user: MoovitSession, offer: Offer, f: Fare, at: LatLon, count = 1) {
  const body = new TWriter().strField(1, offer.context).structField(2, latlon(at))
    .structField(3, new TWriter().i32Field(1, f.code).i32Field(2, f.radius)).structField(4, regionPrice(f)).i32Field(5, count);
  if (f.originRegionId) body.i32Field(9, f.originRegionId);
  return ticketsOf(sRec(await call(user, "PTB/Activations/SetActivationV2", body) ?? undefined, 1));
}

export async function station(user: MoovitSession, at: LatLon, routeType: number, origin = 0, destination = 0) {
  const body = new TWriter().structField(1, latlon(at)).i32Field(2, routeType);
  if (destination) body.i32Field(3, destination);
  if (origin) body.i32Field(4, origin);
  body.i32Field(7, 10).i32Field(8, 0);
  const step = sRec(await call(user, "PTB/Activations/GetStationInfo", body) ?? undefined, 1);
  if (!step) throw new Error("no station");
  const s = sRec(step, 1);
  if (s) {
    const ap = sRec(s, 4);
    const st: Station = {
      stopId: sNum(s, 1) ?? 0, name: sStr(s, 2) ?? "", price: priceOf(sRec(ap, 1)), full: priceOf(sRec(ap, 2)),
      fareCode: sNum(sRec(s, 6), 1) ?? 0, radius: sNum(sRec(s, 6), 2) ?? 0, context: sStr(s, 7) ?? "",
      destinationStopId: sNum(s, 5) ?? 0, reasons: sStrs(ap, 3), cases: sStrs(ap, 4),
    };
    return { station: st, pickOrigin: [] as number[], pickDestination: [] as number[], title: "" };
  }
  const o = sRec(step, 3); if (o) return { station: null, pickOrigin: sInts(o, 1), pickDestination: [], title: sStr(o, 2) ?? "" };
  const d = sRec(step, 2); if (d) return { station: null, pickOrigin: [], pickDestination: sInts(d, 1), title: sStr(d, 2) ?? "" };
  throw new Error("no station");
}

export async function enter(user: MoovitSession, s: Station, at: LatLon, routeType: number, count: number, picked: boolean) {
  const body = new TWriter().strField(1, s.context).structField(2, latlon(at)).i32Field(3, count).i32Field(5, routeType);
  if (s.destinationStopId) body.i32Field(6, s.destinationStopId);
  if (picked && s.stopId) body.i32Field(7, s.stopId);
  return ticketsOf(sRec(await call(user, "PTB/Activations/SetActivationByLocation", body) ?? undefined, 1));
}

export async function exitPrice(user: MoovitSession, at: LatLon) {
  const root = await call(user, "PTB/Activations/FinishTrainEstimatedPrice", new TWriter().strField(1, CONTEXT).structField(2, latlon(at)));
  if (!root) throw new Error("no exit price");
  const e = sRec(root, 1);
  if (e) return { stopId: sNum(e, 3) ?? 0, name: sStr(e, 4) ?? "", price: priceOf(sRec(e, 1)), full: priceOf(sRec(e, 2)), pick: [] as number[], title: "" };
  const p = sRec(root, 2);
  if (!p) throw new Error("no exit price");
  return { stopId: 0, name: "", price: null, full: null, pick: sInts(p, 1), title: sStr(p, 2) ?? "" };
}

export async function exit(user: MoovitSession, at: LatLon, fromStopId: number, ref: string, manual: boolean, cancel = false) {
  const body = new TWriter().strField(1, CONTEXT).structField(2, latlon(at)).i32Field(3, fromStopId).strField(4, ref)
    .boolField(5, manual).boolField(6, cancel);
  const group = sRec(await call(user, "PTB/Activations/FinishTrainActivation", body) ?? undefined, 1);
  if (!group) return [];
  return sRecs(group, 2).map(t => ticketOf(t, sStr(group, 1) ?? ""));
}

export async function tickets(user: MoovitSession) {
  const root = await call(user, "PTB/Activations/GetCurrentActivations", new TWriter());
  if (!root) return { tickets: [] as Ticket[], window: null };
  const list = sRecs(root, 1).flatMap(g => sRecs(g, 2).map(t => ticketOf(t, sStr(g, 1) ?? ""))).sort((a, b) => b.boughtUtc - a.boughtUtc);
  const info = sRec(root, 2); const bar = sRec(info, 4);
  const window = bar && (sNum(bar, 2) ?? 0) > 0
    ? { fromUtc: sNum(bar, 1) ?? 0, untilUtc: sNum(bar, 2) ?? 0, title: sStr(sRec(info, 2), 2) ?? "", text: sStr(sRec(info, 2), 3) ?? "" }
    : null;
  return { tickets: list, window };
}

export async function history(user: MoovitSession, month: number, year: number) {
  const root = await call(user, "PTB/Activations/TransactionsHistory", new TWriter().structField(1, new TWriter().i32Field(1, month).i32Field(2, year)));
  if (!root) return [];
  return sRecs(root, 1).map(c => ({ name: sStr(c, 2) ?? "", atUtc: sNum(c, 3) ?? 0, amount: priceOf(sRec(c, 4)), full: priceOf(sRec(c, 6)) }))
    .sort((a, b) => b.atUtc - a.atUtc);
}

export async function billing(user: MoovitSession) {
  const root = await call(user, "PTB/Activations/GetBillingInfo", new TWriter());
  if (!root) return { current: null, past: [] };
  const c = sRec(root, 1);
  return {
    current: c ? { price: priceOf(sRec(c, 1)), full: priceOf(sRec(c, 2)), atUtc: sNum(c, 5) ?? 0, monthly: sNum(c, 4) === 2 } : null,
    past: sRecs(root, 2).map(p => ({ price: priceOf(sRec(p, 2)), full: null, atUtc: sNum(p, 5) ?? 0, monthly: sNum(p, 6) === 2 }))
      .sort((a, b) => b.atUtc - a.atUtc),
  };
}
