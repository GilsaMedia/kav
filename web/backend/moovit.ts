// Moovit's app API, as Kav's Android app speaks it. Mirrors android/.../data/Moovit.kt.
import { gunzipSync } from "fflate";
import { platform } from "./platform.ts";
import { TWriter, TReader, TType, thriftFields, type TStruct } from "./thrift.ts";

export interface MoovitSession {
  userKey: string;
  accessToken: string;
  refreshToken: string;
  metroId: number;
  accessExpiresUtc: number;
}

export type LatLon = [number, number];

export const APP_ID = "moovit_2751703405";
export const CLIENT_VERSION = "5.199.1.1804";
export const APP4 = "https://app4.moovitapp.com/services-app/services/";
const APP5 = "https://app5.moovitapp.com/services-app/services/";
const APP4CDN = "https://app4cdn.moovitapp.com/services-app/services/";
const STATIC = "https://static.moovitapp.com/v4/";
export const NEUTRAL: LatLon = [32.0755, 34.7755];

const REV_HEADER = "Metro-Revision-Number";
let metroRev = "1788783184120";

export const settings = { hebrew: true };

// The phone Moovit is told about. Moovit refused one fixed value every copy of Kav sent, so each
// install picks its own once.
export const device = { model: "Google oriole", os: "14_34", agent: "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 6 Build/AP2A.240905.003)" };

function withRev(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() !== REV_HEADER.toLowerCase()) out[k] = v;
  out[REV_HEADER] = metroRev;
  return out;
}

interface Reply { code: number; raw: Uint8Array; headers: Record<string, string> }

const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

async function request(method: string, url: string, headers: Record<string, string>, body?: Uint8Array, timeoutMs = 25000, once = false): Promise<Reply> {
  const r = await platform().request(method, url, headers, body, timeoutMs, once);
  let raw = r.body;
  // Some HTTP stacks unpack gzip themselves; the rest is unpacked here.
  if (isGzip(raw)) { try { raw = gunzipSync(raw); } catch { /* keep raw */ } }
  return { code: r.code, raw, headers: r.headers };
}

function adoptRevision(r: Reply): boolean {
  if (r.code !== 412) return false;
  const fresh = (r.headers[REV_HEADER.toLowerCase()] ?? "").trim();
  if (!fresh || fresh === metroRev) return false;
  metroRev = fresh;
  return true;
}

export async function post(base: string, path: string, body: Uint8Array, headers: Record<string, string>,
  readMs = 25000, revision = true, once = false): Promise<[number, Uint8Array]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // A 412 (stale revision) is refused before anything is done, so even a payment is sent again after one.
    const r = await request("POST", base + path, revision ? withRev(headers) : headers, body, readMs, once);
    if (!revision) {
      const rev = (r.headers[REV_HEADER.toLowerCase()] ?? "").trim();
      if (rev) metroRev = rev;
    }
    if (attempt === 0 && (adoptRevision(r) || r.code === 412)) continue;
    return [r.code, r.raw];
  }
  return [412, new Uint8Array(0)];
}

async function get(base: string, path: string, headers: Record<string, string>): Promise<[number, Uint8Array]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = path.replace(/(metro_revision|metroRevisionNumber)=\d+/, `$1=${metroRev}`);
    const r = await request("GET", base + url, withRev(headers));
    if (attempt === 0 && (adoptRevision(r) || r.code === 412)) continue;
    return [r.code, r.raw];
  }
  return [412, new Uint8Array(0)];
}

const decoder = new TextDecoder();
const text = (b: Uint8Array) => decoder.decode(b);

// Moovit's JSON carries 64-bit ids; any past 2^53 are kept exact as strings. Older WebKit (before iOS 18.4)
// doesn't hand the reviver the number's source text, so there they're quoted before parsing.
let hasSource = false;
JSON.parse("1", (_k, v, ctx?: { source?: string }) => { hasSource = ctx?.source === "1"; return v; });

function quoteBigInts(text: string): string {
  let out = "", from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++; continue; }
    if (c !== "-" && (c < "0" || c > "9")) continue;
    let j = i + 1;
    while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
    const n = text.slice(i, j);
    if (/^-?\d{16,}$/.test(n) && !Number.isSafeInteger(Number(n))) { out += text.slice(from, i) + '"' + n + '"'; from = j; }
    i = j - 1;
  }
  return out + text.slice(from);
}

export function parseJson(text: string): any {
  if (!hasSource) return JSON.parse(quoteBigInts(text));
  return JSON.parse(text, (_k, v, ctx?: { source?: string }) =>
    typeof v === "number" && !Number.isSafeInteger(v) && ctx?.source && /^-?\d+$/.test(ctx.source) ? ctx.source : v);
}

const latlon = (lat: number, lon: number) => new TWriter().i32Field(1, Math.trunc(lat * 1e6)).i32Field(2, Math.trunc(lon * 1e6));
const locale = () => settings.hebrew
  ? new TWriter().strField(1, "he").strField(2, "IL").strField(3, "")
  : new TWriter().strField(1, "en").strField(2, "GB").strField(3, "");
const dpk = () => new TWriter().strField(1, "").strField(2, "").strField(3, "");
// crypto.randomUUID arrived in iOS 15.4.
const uuid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join("");

function createUserBody(lat: number, lon: number): Uint8Array {
  const w = new TWriter();
  w.structField(1, latlon(lat, lon));
  w.structField(3, locale());
  w.strField(4, device.model);
  w.strField(5, device.os); w.i32Field(6, 2);
  w.structField(7, dpk());
  w.strField(8, ""); w.strField(9, ""); w.boolField(10, true);
  w.i32Field(11, 5); w.i64Field(12, Date.now()); w.i32Field(13, 1);
  w.strField(15, hex(8));
  w.strField(16, APP_ID);
  w.strField(19, uuid());
  w.strField(20, hex(16));
  w.strField(21, "com.tranzmate");
  w.stop();
  return w.bytes();
}

const userHeaders: Record<string, string> = {
  "Content-Type": "application/octet", "Accept": "application/octet,application/json,application/json",
  "Accept-Encoding": "gzip;q=1.0,identity;q=0.5", "User-Agent": "ktor-client",
  "api_key": APP_ID, "client_version": CLIENT_VERSION, "phone_type": "2",
};

function sessionOf(userKey: string, metroId: number, tokens: any): MoovitSession {
  const access = tokens["1"].rec, refresh = tokens["2"].rec;
  return {
    userKey, metroId,
    accessToken: access["3"].str,
    accessExpiresUtc: Math.floor(Number(access["2"].i64) / 1000),
    refreshToken: refresh["3"].str,
  };
}

export async function register(lat = NEUTRAL[0], lon = NEUTRAL[1]): Promise<MoovitSession> {
  const [code, raw] = await post(APP4, "UserAuth/CreateUser", createUserBody(lat, lon), userHeaders, 25000, false);
  if (code !== 200) throw new Error(`CreateUser HTTP ${code}`);
  const rec = parseJson(text(raw))["1"].rec;
  return sessionOf(rec["1"].str, rec["3"].i16, rec["7"].rec["1"].rec);
}

export async function renew(s: MoovitSession): Promise<MoovitSession> {
  const body = new TWriter().strField(1, s.refreshToken).stop().bytes();
  const [code, raw] = await post(APP4, "UserAuth/RefreshTokens", body, userHeaders, 25000, false);
  if (code !== 200) throw new Error(`RefreshTokens HTTP ${code}`);
  return sessionOf(s.userKey, s.metroId, parseJson(text(raw))["1"].rec);
}

let sequence = 0;
export function authHeaders(s: MoovitSession): Record<string, string> {
  return {
    "Content-Type": "application/octet", "Accept": "application/octet",
    "Accept-Encoding": "gzip;q=1.0, identity;q=0.5", "User-Agent": device.agent,
    "api_key": APP_ID, "client_version": CLIENT_VERSION, "phone_type": "2",
    "request-sequence-id": String(++sequence), "gtfs-language": "",
    "user_key": s.userKey, "access-token": s.accessToken,
    "Metro-Revision-Metro-Id": String(s.metroId), [REV_HEADER]: metroRev,
  };
}
const jsonHeaders = (s: MoovitSession) => ({ ...authHeaders(s), "Accept": "application/json" });

// ---- binary-thrift helpers -------------------------------------------------------------------

const m = (v: any): TStruct | undefined => v instanceof Map ? v : undefined;
const list = (v: any): any[] => Array.isArray(v) ? v : [];
const num = (v: any): number | undefined => typeof v === "number" ? v : typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : undefined;
const str = (v: any): string => typeof v === "string" ? v : "";

// ---- live arrivals ---------------------------------------------------------------------------

export interface Arrival {
  stopId: number; lineId: number; tripId: number | string;
  staticUtc: number; rtUtc: number; statisticalUtc: number;
  status: number; certainty: number; traffic: number;
  frequency: boolean; rtDropped: boolean; tracked: boolean;
  lat: number; lon: number; vehicleId: string; sampleUtc: number; vehicleStatus: number;
  nextStopIndex: number; stopIndex: number; patternStops: number; tripShapeId: number; patternId: number;
  platform: string;
}

// Trains come as "3 🚆 #121": the platform, then the train's number.
function platformOf(raw?: string): string {
  if (!raw) return "";
  const p = raw.split("#")[0].trim().split(" ")[0];
  return p.length <= 4 && /^[\p{L}\p{N}]*$/u.test(p) ? p : "";
}

const arrivalsConf = () => new TWriter().boolField(2, false).boolField(3, false).boolField(4, true).boolField(5, true).boolField(6, false);

// Moovit leaves the live times out of an answer for many stops at once, so they're asked five at a time.
export async function stopArrivals(s: MoovitSession, stopIds: number[]): Promise<{ arrivals: Arrival[]; poll: number }> {
  const ids = [...new Set(stopIds)];
  if (ids.length <= 5) return stopArrivalsBatch(s, ids);
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));
  const answers = await pool(batches, 6, b => stopArrivalsBatch(s, b));
  return { arrivals: answers.flatMap(a => a.arrivals), poll: Math.min(...answers.map(a => a.poll)) };
}

// Now and then Moovit answers with the timetable only. Plenty of departures and not one live time
// means that happened, so it's asked once more.
async function stopArrivalsBatch(s: MoovitSession, stopIds: number[]): Promise<{ arrivals: Arrival[]; poll: number }> {
  const first = await stopArrivalsOnce(s, stopIds);
  if (first.arrivals.length < 30 || first.arrivals.some(a => a.rtUtc > 0)) return first;
  const again = await stopArrivalsOnce(s, stopIds).catch(() => first);
  return again.arrivals.some(a => a.rtUtc > 0) ? again : first;
}

async function stopArrivalsOnce(s: MoovitSession, stopIds: number[]): Promise<{ arrivals: Arrival[]; poll: number }> {
  if (!stopIds.length) return { arrivals: [], poll: 20 };
  const body = new TWriter().i32ListField(1, stopIds).structField(2, arrivalsConf()).stop().bytes();
  const [code, raw] = await post(APP5, "V4/StopsArrivals", body, authHeaders(s));
  if (code !== 200) throw new Error(`StopsArrivals HTTP ${code}`);
  const out = new Map<string, Arrival>();
  let poll = 20;
  const rd = new TReader(raw);
  while (rd.hasMore()) {
    const resp = rd.readStruct();
    if (!resp.size) break;
    const stopId = num(resp.get(1)) ?? -1;
    if (typeof resp.get(5) === "number") poll = resp.get(5);
    for (const la of list(resp.get(3))) {
      const lm = m(la); if (!lm) continue;
      const lineId = num(lm.get(1)) ?? -1;
      for (const a of list(lm.get(2))) {
        const am = m(a); if (!am) continue;
        const tripId = am.get(2); if (tripId == null) continue;
        const v = m(am.get(11)); const ll = m(v?.get(1)); const prog = m(v?.get(2));
        out.set(`${stopId}:${tripId}`, {
          stopId, lineId, tripId,
          staticUtc: Math.floor((num(am.get(3)) ?? 0) / 1000),
          rtUtc: Math.floor((num(am.get(4)) ?? 0) / 1000),
          statisticalUtc: Math.floor((num(am.get(17)) ?? 0) / 1000),
          status: num(am.get(5)) ?? 0, certainty: num(am.get(18)) ?? 0, traffic: num(am.get(19)) ?? 0,
          frequency: am.get(9) != null,
          rtDropped: am.get(4) == null && am.get(20) === true,
          tracked: v != null,
          lat: (num(ll?.get(1)) ?? 0) / 1e6, lon: (num(ll?.get(2)) ?? 0) / 1e6,
          vehicleId: str(v?.get(3)), sampleUtc: Math.floor((num(v?.get(4)) ?? 0) / 1000),
          vehicleStatus: num(v?.get(5)) ?? 0,
          nextStopIndex: num(prog?.get(1)) ?? -1, stopIndex: num(am.get(12)) ?? -1,
          patternStops: num(am.get(13)) ?? -1, tripShapeId: num(am.get(15)) ?? -1, patternId: num(am.get(1)) ?? -1,
          platform: platformOf(am.get(6)),
        });
      }
    }
  }
  return { arrivals: [...out.values()], poll };
}

// ---- service alerts --------------------------------------------------------------------------

export interface ServiceAlert { id: string; category: number; label: string; title: string; body: string; html: boolean; activeFrom: number; activeTo: number; url: string }

export async function serviceAlerts(s: MoovitSession, groupIds: number[]): Promise<ServiceAlert[]> {
  const groups = [...new Set(groupIds.filter(g => g > 0))];
  if (!groups.length) return [];
  const [dc, draw] = await post(APP5, "V4/ServiceAlert/LineGroupsServiceAlerts", new TWriter().i32ListField(1, groups).stop().bytes(), authHeaders(s));
  if (dc !== 200) throw new Error(`LineGroupsServiceAlerts HTTP ${dc}`);
  const labels = new Map<string, [number, string]>();
  for (const d of list(new TReader(draw).readStruct().get(1))) {
    const line = m(d); if (!line) continue;
    const status = m(line.get(2));
    for (const id of list(line.get(1))) if (typeof id === "string") labels.set(id, [num(status?.get(1)) ?? 0, str(status?.get(2))]);
  }
  if (!labels.size) return [];
  const body = new TWriter().listField(1, TType.STRING, [...labels.keys()], (w, v) => w.str(v)).stop().bytes();
  const [code, raw] = await post(APP5, "V4/ServiceAlert/ServiceAlertsById", body, authHeaders(s));
  if (code !== 200) throw new Error(`ServiceAlertsById HTTP ${code}`);
  return list(new TReader(raw).readStruct().get(1)).map(m).filter(Boolean).map(a => {
    const id = str(a!.get(1)); const status = m(a!.get(3)); const fb = labels.get(id); const b = m(a!.get(9));
    return {
      id, category: num(status?.get(1)) ?? fb?.[0] ?? 0, label: str(status?.get(2)) || fb?.[1] || "",
      title: str(a!.get(8)), body: str(b?.get(1)), html: b?.get(2) === 1,
      activeFrom: Math.floor((num(a!.get(6)) ?? 0) / 1000), activeTo: Math.floor((num(a!.get(7)) ?? 0) / 1000),
      url: str(a!.get(10)),
    };
  });
}

// ---- entities --------------------------------------------------------------------------------

export interface LineInfo { groupId: number; number: string; agencyId: number; origin: string; destination: string; caption: string }
export interface StopInfo { id: number; name: string; code: string; lat: number | null; lon: number | null }

const validPoint = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

const lineCache = new Map<number, LineInfo>();
const stopCache = new Map<number, StopInfo>();
const agencyMode = new Map<number, number>();
const agencyNames = new Map<number, string>();
const shapeCache = new Map<number, LatLon[]>();
const patternCache = new Map<string, number[]>();
const patternStopCache = new Map<string, StopInfo[]>();

async function entity(s: MoovitSession, type: number, id: number, resolve = false): Promise<TStruct[] | null> {
  const qs = `V5/Entities/Entity?entity_type=${type}&entity_id=${id}&metro_area_id=${s.metroId}` +
    `&metro_revision=${metroRev}&protocol_version=1&resolve_references=${resolve}`;
  try {
    const [code, raw] = await get(APP4CDN, qs, authHeaders(s));
    if (code !== 200 || raw.length < 8) return null;
    return list(new TReader(raw).readStruct().get(1)).map(e => m(m(e)?.get(1))).filter(Boolean) as TStruct[];
  } catch { return null; }
}
const firstEntity = async (s: MoovitSession, type: number, id: number) => (await entity(s, type, id))?.[0] ?? null;

export async function lineInfo(s: MoovitSession, lineId: number): Promise<LineInfo | null> {
  const hit = lineCache.get(lineId); if (hit) return hit;
  const g = m((await firstEntity(s, 4, lineId))?.get(8)); if (!g) return null;
  const summaries = list(g.get(6)).map(m).filter(Boolean) as TStruct[];
  const base = { groupId: num(g.get(1)) ?? -1, number: str(g.get(2)), agencyId: num(g.get(3)) ?? -1, caption: str(g.get(9)) || str(g.get(8)) };
  for (const e of summaries) {
    const lid = num(e.get(1)); if (lid == null) continue;
    lineCache.set(lid, { ...base, origin: str(e.get(2)), destination: str(e.get(3)) });
  }
  const mine = lineCache.get(lineId) ?? { ...base, origin: "", destination: "" };
  lineCache.set(lineId, mine);
  return mine;
}

export function decodePolyline(enc?: string): LatLon[] {
  if (!enc) return [];
  const out: LatLon[] = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= enc.length) return null;
      b = enc.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift; shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < enc.length) {
    const dl = next(); if (dl == null) break;
    const dn = next(); if (dn == null) break;
    lat += dl; lon += dn;
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

export async function tripShape(s: MoovitSession, shapeId: number): Promise<LatLon[]> {
  if (shapeId <= 0) return [];
  const hit = shapeCache.get(shapeId); if (hit) return hit;
  const rec = m((await firstEntity(s, 15, shapeId))?.get(11));
  if (!rec || rec.get(1) !== shapeId) return [];
  const pts = decodePolyline(rec.get(2));
  if (pts.length < 2 || !pts.every(p => validPoint(p[0], p[1]))) return [];
  shapeCache.set(shapeId, pts);
  return pts;
}

function stopInfoOf(stopId: number, e: TStruct): StopInfo | null {
  const st = m(e.get(5)); if (!st) return null;
  const name = st.get(2); if (typeof name !== "string") return null;
  const ll = m(st.get(3));
  const lat = num(ll?.get(1)), lon = num(ll?.get(2));
  return { id: stopId, name, code: str(st.get(4)), lat: lat != null ? lat / 1e6 : null, lon: lon != null ? lon / 1e6 : null };
}

export async function stopInfo(s: MoovitSession, stopId: number): Promise<StopInfo | null> {
  const hit = stopCache.get(stopId); if (hit) return hit;
  const e = await firstEntity(s, 3, stopId);
  const info = e && stopInfoOf(stopId, e);
  if (info) stopCache.set(stopId, info);
  return info;
}

let agenciesLoadedRev: string | null = null;
let agenciesLoading: Promise<void> | null = null;
async function loadAgencies(s: MoovitSession) {
  if (agenciesLoadedRev === metroRev) return;
  agenciesLoading ??= (async () => {
    const metro = m((await firstEntity(s, 10, s.metroId))?.get(4));
    for (const a of list(metro?.get(3))) {
      const am = m(a); const id = num(am?.get(1)); if (!am || id == null) continue;
      agencyMode.set(id, num(am.get(3)) ?? 3);
      if (str(am.get(2))) agencyNames.set(id, str(am.get(2)));
    }
    if (metro) agenciesLoadedRev = metroRev;
  })().finally(() => { agenciesLoading = null; });
  await agenciesLoading;
}

export async function agencyRouteType(s: MoovitSession, agencyId: number): Promise<number> {
  if (agencyMode.has(agencyId)) return agencyMode.get(agencyId)!;
  await loadAgencies(s);
  return agencyMode.get(agencyId) ?? 3;
}
export const agencyName = (id: number) => agencyNames.get(id);

export async function tripPattern(s: MoovitSession, id: number): Promise<number[]> {
  if (id <= 0) return [];
  const key = `${metroRev}:${id}`;
  const hit = patternCache.get(key); if (hit) return hit;
  const e = await firstEntity(s, 13, id);
  const stops = e ? tripPatternOf(id, e) : [];
  if (stops.length) patternCache.set(key, stops);
  return stops;
}

function tripPatternOf(id: number, e: TStruct): number[] {
  const p = m(e.get(9));
  if (!p || p.get(1) !== id) return [];
  return list(p.get(2)).filter(x => typeof x === "number");
}

// Asked to resolve references, Moovit sends every stop on the pattern along with it, codes included.
export async function patternStops(s: MoovitSession, patternId: number): Promise<StopInfo[]> {
  if (patternId <= 0) return [];
  const key = `${metroRev}:${patternId}`;
  const hit = patternStopCache.get(key); if (hit) return hit;
  const entries = await entity(s, 13, patternId, true);
  if (!entries) throw new Error("Pattern unavailable");
  const stops: StopInfo[] = [];
  for (const e of entries) {
    const id = num(m(e.get(5))?.get(1));
    const info = id != null ? stopInfoOf(id, e) : null;
    if (info) { stops.push(info); stopCache.set(info.id, info); }
    const p = tripPatternOf(patternId, e);
    if (p.length) patternCache.set(key, p);
  }
  // In the pattern's own order.
  const order = patternCache.get(key);
  const byId = new Map(stops.map(x => [x.id, x]));
  const ordered = order ? order.map(i => byId.get(i)).filter(Boolean) as StopInfo[] : stops;
  patternStopCache.set(key, ordered);
  return ordered;
}

// ---- line catalogue --------------------------------------------------------------------------

export interface LineGroup { id: number; number: string; name: string; cities: string; agencyId: number; agency: string; routeType: number }

let catalogue: { rev: string; at: number; lines: LineGroup[] } | null = null;

export async function lineCatalogue(s: MoovitSession): Promise<LineGroup[]> {
  if (catalogue && Date.now() - catalogue.at < 12 * 3600_000) return catalogue.lines;
  await loadAgencies(s);
  let [code, raw] = await get(STATIC, `${metroRev}/0/line_search_data_${s.metroId}.gz`, {});
  if (code !== 200) {
    await firstEntity(s, 10, s.metroId);
    [code, raw] = await get(STATIC, `${metroRev}/0/line_search_data_${s.metroId}.gz`, {});
  }
  if (code !== 200) throw new Error(`line catalogue HTTP ${code}`);
  const data = isGzip(raw) ? gunzipSync(raw) : raw;
  const r = new TReader(data);
  const out: LineGroup[] = [];
  const n = r.i32();
  for (let i = 0; i < n; i++) {
    const section = r.readStruct();
    const type = num(section.get(1)) ?? 3, agency = num(section.get(2)) ?? -1;
    for (const item of list(section.get(3))) {
      const im = m(item); const id = num(im?.get(1)); if (!im || id == null) continue;
      const cities = list(im.get(4)).map(c => str(m(c)?.get(1))).filter(Boolean).join(" ");
      out.push({ id, number: str(im.get(8)) || str(im.get(6)), name: str(im.get(7)), cities, agencyId: agency, agency: agencyNames.get(agency) ?? "", routeType: type });
    }
  }
  catalogue = { rev: metroRev, at: Date.now(), lines: out };
  return out;
}

export interface LineTrips { lineId: number; patternId: number; shapeId: number; departures: number[] }

export async function lineGroupTrips(s: MoovitSession, groupId: number, serviceDate: string): Promise<LineTrips[]> {
  const qs = `V4/GetLineGroupTrips?serviceDate=${serviceDate}&lineGroupId=${groupId}&metroAreaId=${s.metroId}` +
    `&metroRevisionNumber=${metroRev}&osTypeId=2&protocolVersionId=4`;
  const [code, raw] = await get(APP4CDN, qs, authHeaders(s));
  if (code !== 200) throw new Error(`GetLineGroupTrips HTTP ${code}`);
  const out: LineTrips[] = [];
  for (const lt of list(new TReader(raw).readStruct().get(1))) {
    const line = m(lt); const lineId = num(line?.get(1)); if (!line || lineId == null) continue;
    const patterns = new Map<number, number>();
    for (const p of list(line.get(3))) { const pm = m(p); if (pm) patterns.set(num(pm.get(1)) ?? -1, num(pm.get(2)) ?? -1); }
    for (const g of list(line.get(2))) {
      const gm = m(g); if (!gm) continue;
      out.push({
        lineId, patternId: patterns.get(num(gm.get(1)) ?? -2) ?? -1, shapeId: num(gm.get(2)) ?? -1,
        departures: list(gm.get(3)).map(num).filter((x): x is number => x != null).map(x => Math.floor(x / 1000)),
      });
    }
  }
  return out;
}

// ---- search ----------------------------------------------------------------------------------

export interface Place { name: string; detail: string; lat: number; lon: number; type: number }

const jo = (o: any, k: string) => (o && typeof o === "object" ? o[k] : undefined);
const jInt = (o: any, k: string): number | undefined => {
  const n = jo(o, k); if (!n) return undefined;
  for (const t of ["i64", "i32", "i16", "i8", "byte"]) if (t in n) return Number(n[t]);
  return undefined;
};
const jRaw = (o: any, k: string): any => { const n = jo(o, k); return n && ("i64" in n ? n.i64 : "i32" in n ? n.i32 : undefined); };
const jDbl = (o: any, k: string): number | undefined => { const v = jo(o, k)?.dbl; return typeof v === "number" ? v : undefined; };
const jStr = (o: any, k: string): string | undefined => { const v = jo(o, k)?.str; return typeof v === "string" && v ? v : undefined; };
const jBool = (o: any, k: string) => !!jo(o, k)?.tf;
const jRec = (o: any, k: string): any => jo(o, k)?.rec;
const jList = (o: any, k: string): any[] | undefined => jo(o, k)?.lst;
const items = (arr?: any[]) => (arr ? arr.slice(2).filter(x => x && typeof x === "object") : []);
const intList = (arr?: any[]) => (arr ? arr.slice(2).filter(x => typeof x === "number") : []) as number[];

function searchBody(query: string, at: LatLon | null, metroId: number, sections = [2, 3, 4, 5]): Uint8Array {
  const w = new TWriter().strField(1, query).i32Field(2, metroId);
  if (at) w.structField(3, latlon(at[0], at[1]));
  return w.i16Field(4, 0).i32ListField(8, sections).structField(9, locale()).stop().bytes();
}

export async function searchPlaces(s: MoovitSession, query: string, at: LatLon | null): Promise<Place[]> {
  if (!query.trim()) return [];
  const [code, raw] = await post(APP5, "V4/CloudSearch/FullSearch", searchBody(query, at, s.metroId), jsonHeaders(s), 4000);
  if (code !== 200) throw new Error(`Search HTTP ${code}`);
  const out: Place[] = [];
  for (const item of items(jList(parseJson(text(raw)), "2"))) {
    const title = jStr(item, "4"); const ll = jRec(item, "6");
    if (!title || !ll) continue;
    out.push({
      name: title, detail: items(jList(item, "5")).map(t => jStr(t, "1")).filter(Boolean).join(", "),
      lat: (jInt(ll, "1") ?? 0) / 1e6, lon: (jInt(ll, "2") ?? 0) / 1e6, type: jInt(item, "1") ?? 5,
    });
  }
  // All of them: the caller puts the nearest first, which may be far down Moovit's own order.
  return out;
}

// The timetable keys stops by GTFS code, so Moovit's own id comes from a search.
export async function searchStopId(s: MoovitSession, name: string, at: LatLon, where: LatLon | null,
  owns: (lat: number, lon: number) => boolean = () => true): Promise<number | null> {
  if (!name.trim()) return null;
  const [code, raw] = await post(APP5, "V4/CloudSearch/FullSearch", searchBody(name, where, s.metroId, [1]), jsonHeaders(s), 4000);
  if (code !== 200) throw new Error(`Search HTTP ${code}`);
  let best: number | null = null, bestD = 120;
  for (const item of items(jList(parseJson(text(raw)), "2"))) {
    if (jInt(item, "1") !== 1) continue;
    const id = jInt(item, "2"); const ll = jRec(item, "6");
    if (id == null || !ll) continue;
    const lat = (jInt(ll, "1") ?? 0) / 1e6, lon = (jInt(ll, "2") ?? 0) / 1e6;
    if (!owns(lat, lon)) continue;
    const d = Math.hypot((lat - at[0]) * 111_000, (lon - at[1]) * 93_000);
    if (d < bestD) { best = id; bestD = d; }
  }
  return best;
}

export async function stopImages(s: MoovitSession, stopId: number): Promise<{ thumb: string | null; photos: string[] }> {
  const [code, raw] = await post(APP5, "V5/StopImages/GetStopImages", new TWriter().i32Field(1, stopId).stop().bytes(), jsonHeaders(s), 6000);
  if (code === 204) return { thumb: null, photos: [] };
  if (code !== 200) throw new Error(`Stop images HTTP ${code}`);
  const root = parseJson(text(raw));
  return { thumb: jStr(root, "2") ?? null, photos: items(jList(root, "1")).map(i => jStr(i, "1")).filter(Boolean) as string[] };
}

// ---- trip planning ---------------------------------------------------------------------------

export type LegKind = "walk" | "wait" | "ride" | "taxi" | "bike" | "other";

export interface Departure {
  tripId: number | string; staticUtc: number; rtUtc: number; statisticalUtc: number;
  status: number; certainty: number; traffic: number; frequency: boolean; rtDropped: boolean;
  vehicleStatus: number; alert: number; platform: string;
}

export interface Leg {
  kind: LegKind; lineId: number; tripId: number | string; dep: number; arr: number;
  stops: number[]; fromStop: number; toStop: number; meters: number; nextDeps: Departure[];
  shortName: string; pathway: boolean; fare: number; currency: string; shape: LatLon[];
  alertCategory: number; alertText: string; taxiPickup: LatLon | null; taxiDropoff: LatLon | null;
  alternatives: Leg[]; alternativeLineIds: number[];
}

export interface Itinerary {
  guid: string; group: number; legs: Leg[]; dep: number; arr: number; fare: number; currency: string;
  co2g: number; accessible: boolean; tags: string[]; section: string; sectionId: number; wire: string;
}

function leg(kind: LegKind, x: Partial<Leg> = {}): Leg {
  return {
    kind, lineId: -1, tripId: 0, dep: 0, arr: 0, stops: [], fromStop: -1, toStop: -1, meters: 0, nextDeps: [],
    shortName: "", pathway: false, fare: -1, currency: "", shape: [], alertCategory: 0, alertText: "",
    taxiPickup: null, taxiDropoff: null, alternatives: [], alternativeLineIds: [], ...x,
  };
}

function departure(tripId: number | string, staticUtc: number, x: Partial<Departure> = {}): Departure {
  return { tripId, staticUtc, rtUtc: 0, statisticalUtc: 0, status: 0, certainty: 0, traffic: 0, frequency: false,
    rtDropped: false, vehicleStatus: 0, alert: 0, platform: "", ...x };
}

function departureOf(a: any): Departure | null {
  const rt = Math.max(jInt(a, "4") ?? 0, 0), stat = Math.max(jInt(a, "17") ?? 0, 0), sched = Math.max(jInt(a, "3") ?? 0, 0);
  if (!rt && !stat && !sched) return null;
  return departure(jRaw(a, "2") ?? 0, Math.floor(sched / 1000), {
    rtUtc: Math.floor(rt / 1000), statisticalUtc: Math.floor(stat / 1000),
    status: jInt(a, "5") ?? 0, certainty: jInt(a, "18") ?? 0, traffic: jInt(a, "19") ?? 0,
    frequency: jInt(a, "9") != null, rtDropped: rt === 0 && jBool(a, "20"),
    vehicleStatus: jInt(jRec(a, "11"), "5") ?? 0, platform: platformOf(jStr(a, "6")),
  });
}

function timeOf(o: any): [number, number] {
  const t = jRec(o, "1"); if (!t) return [0, 0];
  return [Math.floor((jInt(t, "1") ?? 0) / 1000), Math.floor((jInt(t, "2") ?? 0) / 1000)];
}

function timeDeparture(time: any, tripId: number | string = 0, end = false): Departure | null {
  if (!time) return null;
  const shown = jInt(time, end ? "2" : "1");
  return shown && shown > 0 ? departure(tripId, Math.floor(shown / 1000)) : null;
}

function rideOf(l: any): Leg {
  const [dep, arr] = timeOf(l);
  const stops = intList(jList(l, "3"));
  const tripId = jRaw(l, "6") ?? 0;
  const fare = jRec(jRec(l, "5"), "2");
  return leg("ride", {
    lineId: jInt(l, "2") ?? -1, tripId, dep, arr, stops,
    nextDeps: [timeDeparture(jRec(l, "1"), tripId)].filter(Boolean) as Departure[],
    fromStop: stops[0] ?? -1, toStop: stops[stops.length - 1] ?? -1,
    shortName: jStr(l, "8") ?? "", shape: decodePolyline(jStr(jRec(l, "4"), "2")),
    fare: jInt(fare, "1") ?? -1, currency: jStr(fare, "3") ?? "",
  });
}

function locationPoint(loc: any): LatLon | null {
  const ll = jRec(loc, "3"); const lat = jInt(ll, "1"), lon = jInt(ll, "2");
  if (lat == null || lon == null || !validPoint(lat / 1e6, lon / 1e6)) return null;
  return [lat / 1e6, lon / 1e6];
}

function waitOf(inner: any, multi: any = null): Leg {
  const [dep, arr] = timeOf(inner);
  const service = jRec(jRec(inner, multi ? "4" : "6"), "2");
  const alert = jInt(service, "1") ?? 0;
  const deps: Departure[] = [];
  const first = timeDeparture(jRec(inner, "1"), 0, true); if (first) deps.push(first);
  for (const a of items(jList(jRec(inner, multi ? "3" : "5"), "2"))) { const d = departureOf(a); if (d) deps.push(d); }
  return leg("wait", {
    lineId: jInt(inner, "2") ?? -1, dep, arr,
    fromStop: jInt(multi ?? inner, multi ? "2" : "3") ?? -1,
    toStop: jInt(multi ?? inner, multi ? "3" : "4") ?? -1,
    nextDeps: deps.map(d => alert ? { ...d, alert } : d),
    alertCategory: alert, alertText: jStr(service, "2") ?? "",
  });
}

function parseLeg(l: any): Leg {
  const fid = Object.keys(l)[0]; if (!fid) return leg("other");
  const inner = jRec(l, fid); if (!inner) return leg("other");
  const [dep, arr] = timeOf(inner);
  switch (Number(fid)) {
    case 1: {
      const j = jRec(inner, "2");
      return leg("walk", {
        dep, arr, fromStop: jInt(jRec(j, "1"), "2") ?? -1, toStop: jInt(jRec(j, "2"), "2") ?? -1,
        meters: Math.trunc(jDbl(jRec(inner, "3"), "1") ?? 0), shape: decodePolyline(jStr(jRec(inner, "3"), "2")),
      });
    }
    case 8: return leg("walk", { dep, arr, toStop: jInt(inner, "2") ?? -1, pathway: true });
    case 2: return waitOf(inner);
    case 9: {
      const options = items(jList(inner, "5")).map(a => waitOf(a, inner));
      const primary = options[jInt(inner, "6") ?? 0] ?? options[0];
      return primary ? { ...primary, alternatives: options } : leg("wait", { dep, arr });
    }
    case 3: return rideOf(inner);
    case 6: { const r = jRec(inner, "1"); return r ? { ...rideOf(r), alternativeLineIds: intList(jList(inner, "2")) } : leg("other", { dep, arr }); }
    case 10: {
      const options = items(jList(inner, "1")).map(rideOf);
      const primary = options[jInt(inner, "2") ?? 0] ?? options[0];
      return primary ? { ...primary, alternatives: options } : leg("other", { dep, arr });
    }
    case 5: {
      const journey = jRec(inner, "2"), shape = jRec(inner, "3");
      return leg("taxi", {
        dep, arr, meters: Math.trunc(jDbl(shape, "1") ?? 0), shape: decodePolyline(jStr(shape, "2")),
        taxiPickup: locationPoint(jRec(journey, "1")), taxiDropoff: locationPoint(jRec(journey, "2")),
      });
    }
    case 11: case 12: return leg("bike", { dep, arr });
    default: return leg("other", { dep, arr });
  }
}

function parseItinerary(it: any): Itinerary | null {
  const legs = items(jList(it, "5")).map(parseLeg);
  if (!legs.length) return null;
  const fareRec = jRec(jRec(it, "10"), "1");
  const times = legs.flatMap(l => [l.dep, l.arr]).filter(t => t > 0);
  return {
    guid: jStr(it, "1") ?? "", group: jInt(it, "3") ?? -1, legs,
    dep: legs.find(l => l.dep > 0)?.dep ?? (times.length ? Math.min(...times) : 0),
    arr: [...legs].reverse().find(l => l.arr > 0)?.arr ?? (times.length ? Math.max(...times) : 0),
    fare: jInt(fareRec, "1") ?? -1, currency: jStr(fareRec, "3") ?? "",
    co2g: jInt(jRec(it, "13"), "1") ?? -1, accessible: jBool(it, "9"),
    tags: items(jList(it, "18")).map(t => jStr(t, "3")).filter(Boolean) as string[],
    section: jStr(it, "14") ?? "", sectionId: jInt(it, "2") ?? -1,
    wire: JSON.stringify(it),
  };
}

export interface Section { id: number; name: string; maxItems: number; type: number; index: number }

// Moovit's planner answers with several JSON values back to back.
function jsonValues(text: string): any[] {
  const out: any[] = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") { if (depth++ === 0) start = i; }
    else if (c === "}" || c === "]") { if (--depth === 0 && start >= 0) { try { out.push(parseJson(text.slice(start, i + 1))); } catch { /* skip */ } start = -1; } }
  }
  return out;
}

export class PlannerRefusal extends Error {
  code: number; title: string; detail: string;
  constructor(code: number, title: string, detail: string) {
    super(`TripPlanner refused (${code}): ${title}`);
    this.code = code; this.title = title; this.detail = detail;
  }
}

export const TIME_ARRIVAL = 1, TIME_DEPARTURE = 2, TIME_LAST = 3;
export const ALL_ROUTE_TYPES = [0, 1, 2, 3, 4, 5, 6, 7];

function tripPlanRequest(from: LatLon, to: LatLon, whenMs: number, timeType: number, routeTypes: number[], skipTaxi: boolean): Uint8Array {
  const locTarget = (lat: number, lon: number, caption: string | null, locType: number, source: number) => {
    const inner = new TWriter();
    if (caption != null) inner.strField(1, caption);
    inner.structField(3, latlon(lat, lon)); inner.i32Field(4, locType);
    return new TWriter().structField(1, inner).i32Field(2, source);
  };
  return new TWriter()
    .i32Field(1, 2)
    .i64Field(2, whenMs > 0 ? whenMs : Date.now())
    .i32Field(3, timeType)
    .boolField(4, whenMs <= 0 && timeType === TIME_DEPARTURE)
    .i32ListField(5, routeTypes.length ? routeTypes : ALL_ROUTE_TYPES)
    .structField(6, locTarget(from[0], from[1], null, 9, 5))
    .structField(7, locTarget(to[0], to[1], "Destination", 1, 4))
    .boolField(10, skipTaxi)
    .i32ListField(13, [5, 1, 2, 4])
    .boolField(15, true)
    .structField(16, new TWriter().boolField(1, false).boolField(3, false))
    .i32Field(17, 1)
    .strField(18, "suggested_routes")
    .stop().bytes();
}

export async function planItineraries(s: MoovitSession, from: LatLon, to: LatLon, whenMs = 0, timeType = TIME_DEPARTURE,
  routeTypes = ALL_ROUTE_TYPES, skipTaxi = false): Promise<{ itineraries: Itinerary[]; sections: Section[] }> {
  const body = tripPlanRequest(from, to, whenMs, timeType, routeTypes, skipTaxi);
  const [code, raw] = await post(APP5, "V4/TripPlanner2/Search", body, jsonHeaders(s));
  if (code === 424) {
    let o: any = null; try { o = parseJson(text(raw)); } catch { /* none */ }
    throw new PlannerRefusal(jInt(o, "3") ?? 0, jStr(o, "1") ?? "", jStr(o, "2") ?? "");
  }
  if (code !== 200) throw new Error(`TripPlanner HTTP ${code}`);
  const itineraries: Itinerary[] = [];
  let sections: Section[] = [];
  for (const obj of jsonValues(text(raw))) {
    const rec = jRec(obj, "1");
    if (rec) { const it = parseItinerary(rec); if (it) itineraries.push(it); }
    const secs = jRec(obj, "2");
    if (secs) sections = items(jList(secs, "1")).map((sec, index) => ({
      id: jInt(sec, "2") ?? -1, name: jStr(sec, "1") ?? "", maxItems: jInt(sec, "3") ?? Number.MAX_SAFE_INTEGER,
      type: jInt(sec, "4") ?? 0, index,
    }));
  }
  return { itineraries, sections };
}

// Itineraries in Moovit's own sections, each capped as Moovit caps it.
export function laidOut(plan: { itineraries: Itinerary[]; sections: Section[] }): Itinerary[] {
  if (!plan.sections.length) return plan.itineraries;
  const byId = new Map(plan.sections.map(x => [x.id, x]));
  const seen = new Map<number, number>();
  return [...plan.itineraries]
    .sort((a, b) => (byId.get(a.sectionId)?.index ?? 1e9) - (byId.get(b.sectionId)?.index ?? 1e9))
    .filter(it => {
      const n = (seen.get(it.sectionId) ?? 0) + 1; seen.set(it.sectionId, n);
      return n <= (byId.get(it.sectionId)?.maxItems ?? Infinity);
    })
    .map(it => ({ ...it, section: byId.get(it.sectionId)?.name || it.section }));
}

export async function shareItinerary(s: MoovitSession, guid: string, wire: string): Promise<string> {
  const body = new TWriter().i32Field(1, 1).strField(2, guid).structField(3, thriftFields(parseJson(wire))).stop().bytes();
  const [code, raw] = await post(APP5, "V5/Sharing/ShareItinerary", body, jsonHeaders(s));
  if (code !== 200) throw new Error(`Share itinerary HTTP ${code}`);
  const link = jStr(jRec(parseJson(text(raw)), "1"), "1");
  if (!link) throw new Error("Moovit returned no itinerary link.");
  return link;
}

export async function sharedItinerary(s: MoovitSession, id: string): Promise<{ trip: Itinerary; from: Place | null; to: Place | null }> {
  const [code, raw] = await post(APP5, "V4/TripPlanner2/GetSharedItinerary", new TWriter().strField(1, id).stop().bytes(), jsonHeaders(s));
  if (code !== 200) throw new Error(`Shared itinerary HTTP ${code}`);
  const root = parseJson(text(raw));
  const trip = jRec(root, "1") && parseItinerary(jRec(root, "1"));
  if (!trip) throw new Error("This shared trip is no longer available.");
  const request = jRec(root, "2");
  const endpoint = (f: string): Place | null => {
    const loc = jRec(jRec(request, f), "1"); const p = locationPoint(loc);
    return p ? { name: jStr(loc, "1") ?? "", detail: "", lat: p[0], lon: p[1], type: 5 } : null;
  };
  return { trip, from: endpoint("6"), to: endpoint("7") };
}

// ---- names for a set of itineraries ----------------------------------------------------------

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); }
  }));
  return out;
}
export { pool };

export interface Resolved {
  lines: Record<number, LineInfo>; stops: Record<number, StopInfo>; routeTypes: Record<number, number>;
  agencies: Record<number, string>;
}

const options = (l: Leg) => (l.alternatives.length ? l.alternatives : [l]);

export async function resolveNames(s: MoovitSession, its: Itinerary[]): Promise<Resolved> {
  const lineIds = new Set<number>(), stopIds = new Set<number>();
  for (const it of its) for (const l of it.legs) for (const o of options(l)) {
    if (o.kind === "ride") for (const id of [o.lineId, ...o.alternativeLineIds]) if (id > 0) lineIds.add(id);
    if (o.kind === "wait" || o.kind === "ride") { if (o.fromStop > 0) stopIds.add(o.fromStop); if (o.toStop > 0) stopIds.add(o.toStop); }
    if (o.kind === "ride") for (const st of o.stops) if (st > 0) stopIds.add(st);
  }
  return resolveIds(s, [...lineIds], [...stopIds]);
}

export async function resolveIds(s: MoovitSession, lineIds: number[], stopIds: number[]): Promise<Resolved> {
  const lines: Record<number, LineInfo> = {}, stops: Record<number, StopInfo> = {}, routeTypes: Record<number, number> = {};
  const agencies: Record<number, string> = {};
  await Promise.all([
    pool(lineIds, 8, async id => { const l = await lineInfo(s, id).catch(() => null); if (l) lines[id] = l; }),
    pool(stopIds, 8, async id => { const st = await stopInfo(s, id).catch(() => null); if (st) stops[id] = st; }),
  ]);
  for (const a of new Set(Object.values(lines).map(l => l.agencyId))) {
    routeTypes[a] = await agencyRouteType(s, a).catch(() => 3);
    const n = agencyNames.get(a); if (n) agencies[a] = n;
  }
  return { lines, stops, routeTypes, agencies };
}
