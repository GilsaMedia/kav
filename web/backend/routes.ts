// The API Kav's screens use, the same on the computer's server and inside the iOS app.
import * as M from "./moovit.ts";
import * as Pay from "./pay.ts";
import { Net, metres } from "./net.ts";
import * as St from "./state.ts";
import * as Delays from "./delays.ts";
import { setPlatform, type Platform } from "./platform.ts";

let net!: Net;
let netReady: Promise<void> | null = null;

// Sets the backend up on a platform; the timetable loads in the background.
export function startBackend(p: Platform, loadTimetable: () => Promise<Uint8Array>) {
  setPlatform(p);
  St.initState();
  // A load that fails is tried again by the next call rather than failing every call after it.
  loadNet = () => loadTimetable().then(Net.fromBytes).then(n => { net = n; }).catch(e => { netReady = null; throw e; });
  netReady = loadNet();
  return netReady;
}
let loadNet: (() => Promise<void>) | null = null;

// One call of the API: `name` as in `/api/<name>`, the query, and a POST's body.
export async function call(name: string, q: URLSearchParams, body: any = {}): Promise<unknown> {
  const h = routes.get(name);
  if (!h) throw new HttpError(404, "No such call");
  M.settings.hebrew = q.get("lang") !== "en";
  if (!loadNet) throw new Error("The backend hasn't started");
  if (name !== "status") await (netReady ??= loadNet());
  return h(q, body ?? {});
}

// The HTTP status an error stands for.
export function statusOf(e: unknown): number {
  const err = e as { status?: number };
  return err?.status ?? (e instanceof Pay.Refused ? 422 : e instanceof Pay.Unauthorized ? 401 : 502);
}

// Israel's wall clock, for the timetable's seconds-since-midnight.
function israelNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { day, secs: Number(g("hour")) * 3600 + Number(g("minute")) * 60 + Number(g("second")) };
}
const serviceDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(Date.now() + offsetDays * 86_400_000)).replaceAll("-", "");

const gtfsStop = (i: number) => ({
  i, name: net.name[i], city: net.cityName(i), code: net.code[i], lat: net.lat[i], lon: net.lon[i], type: net.stopType[i],
});

// What Moovit is told instead of the phone's position while private search is on: the town's centre.
function standIn(at: M.LatLon | null, priv: boolean): M.LatLon | null {
  if (!at) return null;
  if (!priv) return at;
  const c = net.cityAround(at[0], at[1]);
  return c ? [c.lat, c.lon] : M.NEUTRAL;
}

// ---- timetable stops to Moovit ids -----------------------------------------------------------

const stopKey = (g: number) => net.code[g] > 0 ? `c${net.code[g]}` : `n${net.name[g]}@${net.lat[g].toFixed(4)},${net.lon[g].toFixed(4)}`;
const misses = new Set<string>();

// Same-named stops across a street can share one Moovit hit; it belongs to the nearer.
function owns(g: number, la: number, lo: number) {
  const own = metres(la, lo, net.lat[g], net.lon[g]);
  for (const [i] of net.nearestStops(la, lo, 12, own + 1)) if (i !== g && net.name[i] === net.name[g] && metres(la, lo, net.lat[i], net.lon[i]) < own) return false;
  return true;
}

async function moovitStopId(s: M.MoovitSession, g: number): Promise<number | null> {
  const key = stopKey(g);
  if (St.stopIds[key]) return St.stopIds[key];
  if (misses.has(key)) return null;
  const at: M.LatLon = [net.lat[g], net.lon[g]];
  const id = await M.searchStopId(s, net.name[g], at, at, (la, lo) => owns(g, la, lo));
  if (id == null) misses.add(key); else St.learnStopId(key, id);
  return id;
}

// A stop's Moovit id from the lines that call there: each one's stop list carries the stops' codes.
async function learnThroughLines(s: M.MoovitSession, g: number): Promise<number | null> {
  const key = stopKey(g);
  const agencyOf = new Map<string, string>();
  for (let i = net.dStart[g]; i < net.dStart[g + 1]; i++) {
    const r = net.tripRoute[net.tripOf(net.cST[net.dConn[i]])];
    if (!agencyOf.has(net.rShort[r])) agencyOf.set(net.rShort[r], net.agencyOf(r));
  }
  const catalogue = await M.lineCatalogue(s).catch(() => [] as M.LineGroup[]);
  // Lines with the same number and operator first; a few lines are enough.
  const groups = [...agencyOf.entries()].flatMap(([number, agency]) =>
    catalogue.filter(l => l.number === number).sort((a, b) => Number(!b.agency.includes(agency)) - Number(!a.agency.includes(agency))).slice(0, 2));
  for (const group of groups.slice(0, 6)) {
    const trips = await M.lineGroupTrips(s, group.id, serviceDate()).catch(() => [] as M.LineTrips[]);
    for (const p of [...new Set(trips.map(t => t.patternId))].filter(p => p > 0)) {
      learnFromPattern(await M.patternStops(s, p).catch(() => []));
      if (St.stopIds[key]) return St.stopIds[key];
    }
  }
  return null;
}

function learnFromPattern(stops: M.StopInfo[]) {
  for (const st of stops) { const c = Number(st.code); if (c > 0) St.learnStopId(`c${c}`, st.id); }
}

// ---- HTTP plumbing ---------------------------------------------------------------------------

export class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
type Q = URLSearchParams;
type Handler = (q: Q, body: any) => Promise<unknown>;
const routes = new Map<string, Handler>();
const route = (name: string, h: Handler) => routes.set(name, h);

const qNum = (q: Q, k: string) => { const v = q.get(k); const n = v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
const qAt = (q: Q): M.LatLon | null => { const la = qNum(q, "lat"), lo = qNum(q, "lon"); return la != null && lo != null ? [la, lo] : null; };
const qIds = (q: Q, k: string) => (q.get(k) ?? "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
const bAt = (v: any): M.LatLon | null => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null;


// ---- browsing --------------------------------------------------------------------------------

route("status", async () => ({ pay: St.paySignedIn(), stops: net?.nStops ?? 0 }));

route("places", async q => {
  const text = (q.get("q") ?? "").trim();
  const at = qAt(q);
  const stops = net.searchStops(text, at, 4).map(gtfsStop);
  let places: M.Place[] = [], error: string | null = null;
  try { places = await M.searchPlaces(await St.browse(), text, standIn(at, q.get("private") !== "0")); }
  catch (e) { error = (e as Error).message; }
  // The one nearest you first: a Naaman Street in your own town before the one in Tel Aviv. Sorted here,
  // with your real position, so Moovit still only ever sees the stand-in.
  if (at) places = places.map(p => ({ p, m: metres(at[0], at[1], p.lat, p.lon) })).sort((a, b) => a.m - b.m).map(x => x.p);
  places = places.slice(0, 8);
  return { places, stops, error };
});

route("plan", async (_q, b) => {
  const from = bAt(b.from), to = bAt(b.to);
  if (!from || !to) throw new HttpError(400, "from and to are needed");
  const s = await St.browse(from);
  try {
    const plan = await M.planItineraries(s, from, to, Number(b.when) || 0, Number(b.timeType) || M.TIME_DEPARTURE,
      Array.isArray(b.routeTypes) && b.routeTypes.length ? b.routeTypes : M.ALL_ROUTE_TYPES, !!b.skipTaxi);
    const itineraries = M.laidOut(plan);
    return { itineraries, resolved: await M.resolveNames(s, itineraries) };
  } catch (e) {
    if (e instanceof M.PlannerRefusal) return { itineraries: [], refusal: { code: e.code, title: e.title, detail: e.detail } };
    throw e;
  }
});

route("arrivals", async q => {
  const ids = qIds(q, "stops").slice(0, 60);
  const s = await St.browse();
  const { arrivals, poll } = await M.stopArrivals(s, ids);
  Delays.observe(arrivals);
  const lines = [...new Set(arrivals.map(a => a.lineId))].filter(l => l > 0);
  return { arrivals, poll, resolved: await M.resolveIds(s, lines, []) };
});

// What Kav has seen of a line's delays, at one stop or along the whole line.
route("delays", async q => Delays.report(qNum(q, "line") ?? 0, qNum(q, "stop") ?? undefined));
route("resolve", async q => M.resolveIds(await St.browse(), qIds(q, "lines"), qIds(q, "stops")));
route("shape", async q => ({ shape: await M.tripShape(await St.browse(), qNum(q, "id") ?? 0) }));
route("pattern", async q => {
  const stops = await M.patternStops(await St.browse(), qNum(q, "id") ?? 0);
  learnFromPattern(stops);
  return { stops };
});
route("alerts", async q => ({ alerts: await M.serviceAlerts(await St.browse(), qIds(q, "groups")) }));
route("photos", async q => M.stopImages(await St.browse(), qNum(q, "id") ?? 0));

route("share", async (_q, b) => ({ link: await M.shareItinerary(await St.browse(), String(b.guid ?? ""), String(b.wire ?? "")) }));
route("shared", async q => {
  const raw = q.get("id") ?? "";
  const id = raw.match(/moovitapp\.com\/i\/([A-Za-z0-9_-]+)/)?.[1] ?? raw;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new HttpError(400, "Unsupported Moovit link");
  const s = await St.browse();
  const shared = await M.sharedItinerary(s, id);
  return { ...shared, resolved: await M.resolveNames(s, [shared.trip]) };
});

// ---- stations (from the timetable, live from Moovit) -----------------------------------------

route("stations/search", async q => ({ stops: net.searchStops(q.get("q") ?? "", qAt(q), 40).map(gtfsStop) }));
route("stations/near", async q => {
  const at = qAt(q); if (!at) throw new HttpError(400, "lat and lon are needed");
  return { stops: net.nearestStops(at[0], at[1], 30, 1500).map(([i, d]) => ({ ...gtfsStop(i), metres: Math.round(d) })) };
});

route("stations/board", async q => {
  const g = qNum(q, "i");
  if (g == null || g < 0 || g >= net.nStops) throw new HttpError(404, "No such stop");
  const now = israelNow();
  const timetable = net.departuresAt(g, now.secs - 60, now.day, 80).map(([c, dep]) => {
    const t = net.tripOf(net.cST[c]); const r = net.tripRoute[t];
    return { route: r, short: net.rShort[r], long: net.rLong[r], type: net.rType[r], agency: net.agencyOf(r), to: net.name[net.tripLast(t)], inSecs: dep - now.secs };
  });
  return { stop: gtfsStop(g), timetable };
});

route("stations/live", async q => {
  const g = qNum(q, "i");
  if (g == null || g < 0 || g >= net.nStops) throw new HttpError(404, "No such stop");
  const s = await St.browse();
  let id = await moovitStopId(s, g).catch(() => null);
  // A name search finds one stop per name. The lines the timetable says call here list every stop on
  // them with its code, which settles it.
  if (id == null && net.code[g] > 0) id = await learnThroughLines(s, g);
  if (id == null) return { moovitId: null, arrivals: [], poll: 30 };
  const { arrivals, poll } = await M.stopArrivals(s, [id]);
  Delays.observe(arrivals);
  const lines = [...new Set(arrivals.map(a => a.lineId))].filter(l => l > 0);
  return { moovitId: id, arrivals, poll, resolved: await M.resolveIds(s, lines, []) };
});

// ---- lines (Moovit's catalogue) --------------------------------------------------------------

route("lines/search", async q => {
  const need = (q.get("q") ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = await M.lineCatalogue(await St.browse());
  const hits = all.filter(l => {
    const hay = `${l.number} ${l.name} ${l.cities} ${l.agency}`.toLowerCase();
    return need.every(w => w === l.number.toLowerCase() || hay.includes(w));
  });
  const exact = (l: M.LineGroup) => need.length && l.number.toLowerCase() === need[0] ? 0 : 1;
  hits.sort((a, b) => exact(a) - exact(b) || (parseInt(a.number) || 1e9) - (parseInt(b.number) || 1e9) || a.number.localeCompare(b.number));
  return { lines: hits.slice(0, 80), total: hits.length };
});

route("lines/detail", async q => {
  const groupId = qNum(q, "id") ?? 0;
  const s = await St.browse();
  const group = (await M.lineCatalogue(s)).find(l => l.id === groupId) ?? null;
  let trips: M.LineTrips[] = [];
  // Today's trips, or the next day's when the line doesn't run today.
  for (let k = 0; k < 7 && !trips.length; k++) trips = await M.lineGroupTrips(s, groupId, serviceDate(k)).catch(() => []);
  const byLine = new Map<number, M.LineTrips[]>();
  for (const t of trips) byLine.set(t.lineId, [...(byLine.get(t.lineId) ?? []), t]);
  const directions = await Promise.all([...byLine.entries()].map(async ([lineId, ts]) => {
    // The usual run: the stop pattern with the most departures, across the groups that share it.
    const runs = new Map<number, number>();
    for (const t of ts) runs.set(t.patternId, (runs.get(t.patternId) ?? 0) + t.departures.length);
    const usual = [...ts].sort((a, b) => runs.get(b.patternId)! - runs.get(a.patternId)! || b.departures.length - a.departures.length)[0];
    const [info, stops, shape] = await Promise.all([
      M.lineInfo(s, lineId).catch(() => null),
      M.patternStops(s, usual.patternId).catch(() => [] as M.StopInfo[]),
      M.tripShape(s, usual.shapeId).catch(() => [] as M.LatLon[]),
    ]);
    learnFromPattern(stops);
    return { lineId, info, stops, shape, departures: ts.flatMap(t => t.departures).sort((a, b) => a - b) };
  }));
  return { group, directions, agencyRouteType: group ? await M.agencyRouteType(s, group.agencyId).catch(() => group.routeType) : 3 };
});

// ---- live map --------------------------------------------------------------------------------

route("live", async q => {
  const at = qAt(q); if (!at) throw new HttpError(400, "lat and lon are needed");
  const reach = Math.min(Math.max(qNum(q, "km") ?? 1.2, 0.4), 3) * 1000;
  const s = await St.browse();
  const inView = net.nearestStops(at[0], at[1], 80, reach).map(([g]) => g);
  const known: { id: number; g: number }[] = [];
  const unknown: number[] = [];
  for (const g of inView) { const id = St.stopIds[stopKey(g)]; if (id) known.push({ id, g }); else if (!misses.has(stopKey(g))) unknown.push(g); }
  // A few unknown stops are looked up per refresh, nearest first, so the map fills in as it polls.
  await M.pool(unknown.slice(0, known.length ? 6 : 12), 6, async g => {
    const id = await moovitStopId(s, g).catch(() => null);
    if (id) known.push({ id, g });
  });
  const ids = [...new Set(known.map(k => k.id))].slice(0, 60);
  const { arrivals, poll } = ids.length ? await M.stopArrivals(s, ids) : { arrivals: [], poll: 20 };
  Delays.observe(arrivals);
  // The lines through these stops list every stop on them with its code, which settles the rest.
  const left = inView.filter(g => !St.stopIds[stopKey(g)] && !misses.has(stopKey(g)));
  if (left.length) {
    const patterns = [...new Set(arrivals.map(a => a.patternId))].filter(p => p > 0).slice(0, 8);
    await M.pool(patterns, 4, async p => learnFromPattern(await M.patternStops(s, p).catch(() => [])));
  }
  const lines = [...new Set(arrivals.filter(a => a.tracked).map(a => a.lineId))].filter(l => l > 0);
  const byG = new Map(known.map(k => [k.id, k.g]));
  return {
    stops: ids.map(id => { const g = byG.get(id)!; return { id, name: net.name[g], lat: net.lat[g], lon: net.lon[g], code: net.code[g] }; }),
    arrivals, poll, pending: left.length, resolved: await M.resolveIds(s, lines, []),
  };
});

// ---- paying ----------------------------------------------------------------------------------

// The bus you're on or about to board, for its fare: a vehicle Moovit tracks right by you, or one at the stop
// you're at now. The closest first. Your exact place stays here: Moovit is only asked about the stops.
route("pay/buses", async (_q, b) => {
  const at = bAt(b.at); if (!at) throw new HttpError(400, "at is needed");
  const s = await St.browse();
  const near = net.nearestStops(at[0], at[1], 10, 250);
  const ids = new Map<number, number>();
  await M.pool(near.slice(0, 8), 4, async ([g, d]) => {
    const id = St.stopIds[stopKey(g)] ?? await moovitStopId(s, g).catch(() => null);
    if (id) ids.set(id, d);
  });
  if (!ids.size) return { buses: [], resolved: await M.resolveIds(s, [], []) };
  const { arrivals } = await M.stopArrivals(s, [...ids.keys()]);
  const now = Date.now() / 1000;
  const when = (a: M.Arrival) => a.rtUtc > 0 ? a.rtUtc : a.statisticalUtc > 0 ? a.statisticalUtc : a.staticUtc;
  const best = new Map<string, { lineId: number; patternId: number; stopId: number; tripId: number | string; metres: number | null; inSecs: number; score: number }>();
  for (const a of arrivals) {
    if (a.lineId <= 0 || a.status === 3) continue;
    const vehicle = a.tracked && a.lat ? metres(at[0], at[1], a.lat, a.lon) : null;
    const dt = when(a) - now, stop = ids.get(a.stopId) ?? 1e9;
    const byVehicle = vehicle != null && vehicle < 200;
    const atStop = stop < 120 && dt > -180 && dt < 240;
    if (!byVehicle && !atStop) continue;
    const score = byVehicle ? vehicle! : 150 + Math.abs(dt) / 2 + stop;
    const key = String(a.tripId);
    if ((best.get(key)?.score ?? Infinity) > score) best.set(key, { lineId: a.lineId, patternId: a.patternId, stopId: a.stopId, tripId: a.tripId, metres: vehicle == null ? null : Math.round(vehicle), inSecs: Math.round(dt), score });
  }
  // Buses only: a train or light rail line through a stop next door isn't the bus whose code was scanned.
  const all = [...best.values()].sort((x, y) => x.score - y.score).slice(0, 12);
  const resolved = await M.resolveIds(s, [...new Set(all.map(x => x.lineId))], []);
  const isBus = (lineId: number) => { const l = resolved.lines[lineId]; return !l || (resolved.routeTypes[l.agencyId] ?? 3) === 3; };
  return { buses: all.filter(x => isBus(x.lineId)).slice(0, 8), resolved };
});

function payAt(b: any): M.LatLon {
  const at = bAt(b?.at);
  return standIn(at, b?.private !== false) ?? M.NEUTRAL;
}

// Signed in, and whether Moovit still wants a step before it takes payments (a new card check, a reconnect).
route("pay/state", async () => {
  if (!St.paySignedIn()) return { signedIn: false };
  const [account, steps] = await Promise.all([St.asPayer(Pay.account).catch(() => null), St.asPayer(Pay.steps).catch(() => null)]);
  return { signedIn: true, account, unfinished: !!steps?.missing.length };
});
route("pay/steps", async () => St.asPayer(Pay.steps));
route("pay/terms", async (_q, b) => { await St.asPayer(u => Pay.acceptTerms(u, Number(b.version) || 1)); return {}; });
route("pay/send", async (_q, b) => { await St.asPayer(u => Pay.sendCode(u, String(b.phone ?? ""))); return {}; });
route("pay/verify", async (_q, b) => {
  return St.asPayer(u => Pay.verify(u, String(b.code ?? ""), !!b.takeOver));
});
route("pay/cvv", async (_q, b) => { await St.asPayer(u => Pay.confirmCard(u, String(b.cvv ?? ""))); return {}; });
// An input step (the CVV step, or another Moovit asks for), answered with its fields' values.
route("pay/input", async (_q, b) => {
  const values = (Array.isArray(b.values) ? b.values : []).map((v: any) => ({ id: String(v?.id ?? ""), value: String(v?.value ?? "") }));
  await St.asPayer(u => Pay.completeInput(u, !!b.cvv, String(b.step ?? ""), values));
  return St.asPayer(Pay.steps);
});
// Ready once Moovit lists the account as connected for paying.
// Ready once Moovit asks for nothing more and lists the account as connected for paying.
route("pay/finish", async () => {
  const [account, steps] = await Promise.all([St.asPayer(Pay.account), St.asPayer(Pay.steps)]);
  const ready = !!account?.connected && !steps.missing.length;
  if (ready) St.markSignedIn();
  return { connected: ready, account, steps };
});
route("pay/signout", async () => { St.signOut(); return {}; });

function signedIn() { if (!St.paySignedIn()) throw new HttpError(401, "Not signed in to payments"); }

// Moovit answers a fare or a purchase with a bare "Something went wrong" when the account still has a step
// to finish on this device. Then the app is told so (409) and walks the rider through it.
async function payCall<T>(f: (u: M.MoovitSession) => Promise<T>): Promise<T> {
  try { return await St.asPayer(f); }
  catch (e) {
    if (e instanceof Pay.Refused) {
      const steps = await St.asPayer(Pay.steps).catch(() => null);
      if (steps?.missing.length) throw new HttpError(409, "Moovit needs one more step to finish connecting your payment account.");
    }
    throw e;
  }
}

route("pay/tickets", async () => { signedIn(); return St.asPayer(Pay.tickets); });
route("pay/history", async q => { signedIn(); return { charges: await St.asPayer(u => Pay.history(u, qNum(q, "month") ?? 1, qNum(q, "year") ?? 2026)) }; });
route("pay/billing", async () => { signedIn(); return St.asPayer(Pay.billing); });

route("pay/price", async (_q, b) => { signedIn(); return payCall(u => Pay.price(u, String(b.qr ?? ""), payAt(b))); });
route("pay/quote", async (_q, b) => {
  signedIn();
  if (b.station) return payCall(u => Pay.quoteStation(u, b.station, Number(b.routeType)));
  return payCall(u => Pay.quoteFare(u, b.offer, b.fare, payAt(b)));
});
route("pay/station", async (_q, b) => {
  signedIn();
  const routeType = Number(b.routeType);
  let at = bAt(b.at);
  // Only the station's own position goes to Moovit, never the fix.
  if (at && !b.exact) {
    const gtfs = routeType === Pay.TRAM ? 0 : routeType === Pay.RAIL ? 2 : 7;
    const g = net.nearestOfType(at[0], at[1], gtfs);
    if (g == null) return { none: true };
    at = [net.lat[g], net.lon[g]];
  }
  if (!at) throw new HttpError(400, "A position is needed");
  const step = await payCall(u => Pay.station(u, at!, routeType, Number(b.origin) || 0, Number(b.destination) || 0));
  const pick = step.pickOrigin.length ? step.pickOrigin : step.pickDestination;
  const picks = pick.length ? Object.values((await M.resolveIds(await St.browse(), [], pick)).stops) : [];
  return { ...step, at, picks };
});
route("pay/exitPrice", async (_q, b) => {
  signedIn();
  let at = bAt(b.at);
  if (at && !b.exact) { const g = net.nearestOfType(at[0], at[1], 2); if (g != null) at = [net.lat[g], net.lon[g]]; }
  if (!at) throw new HttpError(400, "A position is needed");
  const e = await payCall(u => Pay.exitPrice(u, at!));
  const picks = e.pick.length ? Object.values((await M.resolveIds(await St.browse(), [], e.pick)).stops) : [];
  return { ...e, at, picks };
});

// A purchase whose answer is lost may still have gone through: before calling it failed, the
// account's tickets are read again for ones that were not there just before. Never retried.
let buying = false;
async function purchase(buy: () => Promise<Pay.Ticket[]>, allowOpenTrain = false): Promise<{ tickets: Pay.Ticket[]; unconfirmed?: boolean }> {
  if (buying) throw new Pay.Refused("", "A payment is already in progress.");
  buying = true;
  try {
    const before = await St.asPayer(Pay.tickets);
    if (!allowOpenTrain && before.tickets.some(t => t.active && t.needsExit))
      throw new Pay.Refused("Important!", "End your train ride first: pay for the exit before buying another ticket.");
    const seen = new Set(before.tickets.map(t => `${t.id}:${t.ref}`));
    try { return { tickets: await buy() }; }
    catch (e) {
      if (e instanceof Pay.Refused || e instanceof HttpError) throw e;
      try {
        const after = (await St.asPayer(Pay.tickets)).tickets.filter(t => !seen.has(`${t.id}:${t.ref}`));
        if (after.length) return { tickets: after };
      } catch { /* fall through */ }
      return { tickets: [], unconfirmed: true };
    }
  } finally { buying = false; }
}

route("pay/buy", async (_q, b) => {
  signedIn();
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 10);
  return purchase(() => payCall(u => Pay.buy(u, b.offer, b.fare, payAt(b), count)));
});
route("pay/enter", async (_q, b) => {
  signedIn();
  const at = bAt(b.at); if (!at) throw new HttpError(400, "A position is needed");
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 10);
  return purchase(() => payCall(u => Pay.enter(u, b.station, at, Number(b.routeType), count, !!b.picked)));
});
route("pay/exit", async (_q, b) => {
  signedIn();
  const at = bAt(b.at); if (!at) throw new HttpError(400, "A position is needed");
  if (b.cancel) return { tickets: await St.asPayer(u => Pay.exit(u, at, Number(b.fromStopId), String(b.ref), false, true)) };
  return purchase(() => St.asPayer(u => Pay.exit(u, at, Number(b.fromStopId), String(b.ref), !!b.manual)), true);
});

