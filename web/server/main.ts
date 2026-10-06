// Kav on the web: serves the app, the offline map and timetable, and speaks to Moovit for it.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as M from "./moovit.ts";
import * as Pay from "./pay.ts";
import { Net, metres } from "./net.ts";
import * as St from "./state.ts";

const ROOT = path.join(import.meta.dirname, "..");
const DATA = path.join(ROOT, "data");
const DIST = path.join(ROOT, "dist");
const MAP_ASSETS = path.join(ROOT, "..", "android", "app", "src", "main", "assets", "map");
const PORT = Number(process.env.PORT ?? 8443);
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 8080);

// ---- the timetable ---------------------------------------------------------------------------

console.log("loading the timetable…");
const net = Net.load(path.join(DATA, "il.kav"));
console.log(`timetable: ${net.nStops} stops, ${net.rShort.length} routes`);

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

function learnFromPattern(stops: M.StopInfo[]) {
  for (const st of stops) { const c = Number(st.code); if (c > 0) St.learnStopId(`c${c}`, st.id); }
}

// ---- HTTP plumbing ---------------------------------------------------------------------------

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
type Q = URLSearchParams;
type Handler = (q: Q, body: any) => Promise<unknown>;
const routes = new Map<string, Handler>();
const route = (name: string, h: Handler) => routes.set(name, h);

const qNum = (q: Q, k: string) => { const v = q.get(k); const n = v == null || v === "" ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
const qAt = (q: Q): M.LatLon | null => { const la = qNum(q, "lat"), lo = qNum(q, "lon"); return la != null && lo != null ? [la, lo] : null; };
const qIds = (q: Q, k: string) => (q.get(k) ?? "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
const bAt = (v: any): M.LatLon | null => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? [v[0], v[1]] : null;
function lang(q: Q) { M.settings.hebrew = q.get("lang") !== "en"; }

// ---- browsing --------------------------------------------------------------------------------

route("status", async () => ({ pay: St.paySignedIn(), stops: net.nStops }));

route("places", async q => {
  const text = (q.get("q") ?? "").trim();
  const at = qAt(q);
  const stops = net.searchStops(text, at, 4).map(gtfsStop);
  let places: M.Place[] = [], error: string | null = null;
  try { places = await M.searchPlaces(await St.browse(), text, standIn(at, q.get("private") !== "0")); }
  catch (e) { error = (e as Error).message; }
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
  const lines = [...new Set(arrivals.map(a => a.lineId))].filter(l => l > 0);
  return { arrivals, poll, resolved: await M.resolveIds(s, lines, []) };
});

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
  // A name search finds one stop per name. The lines through the stops nearby list every stop on them
  // with its code, which settles the others.
  if (id == null && net.code[g] > 0) {
    const near: number[] = [];
    for (const [n] of net.nearestStops(net.lat[g], net.lon[g], 8, 400)) {
      const nid = n === g ? null : await moovitStopId(s, n).catch(() => null);
      if (nid) near.push(nid);
      if (near.length >= 4) break;
    }
    if (near.length) {
      const { arrivals } = await M.stopArrivals(s, near);
      // The lines the timetable says call here are asked first.
      const calling = net.routesAt(g);
      const lines = (await M.resolveIds(s, [...new Set(arrivals.map(a => a.lineId))].filter(l => l > 0), [])).lines;
      const patterns = [...new Set(arrivals.filter(a => calling.has(lines[a.lineId]?.number ?? "")).map(a => a.patternId))].filter(p => p > 0);
      for (let k = 0; k < patterns.length && !St.stopIds[stopKey(g)]; k += 4)
        await M.pool(patterns.slice(k, k + 4), 4, async p => learnFromPattern(await M.patternStops(s, p).catch(() => [])));
      id = St.stopIds[stopKey(g)] ?? null;
    }
  }
  if (id == null) return { moovitId: null, arrivals: [], poll: 30 };
  const { arrivals, poll } = await M.stopArrivals(s, [id]);
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

function payAt(b: any): M.LatLon {
  const at = bAt(b?.at);
  return standIn(at, b?.private !== false) ?? M.NEUTRAL;
}

route("pay/state", async () => {
  if (!St.paySignedIn()) return { signedIn: false };
  const account = await St.asPayer(Pay.account).catch(() => null);
  return { signedIn: true, account };
});
route("pay/steps", async () => St.asPayer(Pay.steps));
route("pay/terms", async (_q, b) => { await St.asPayer(u => Pay.acceptTerms(u, Number(b.version) || 1)); return {}; });
route("pay/send", async (_q, b) => { await St.asPayer(u => Pay.sendCode(u, String(b.phone ?? ""))); return {}; });
route("pay/verify", async (_q, b) => {
  const v = await St.asPayer(u => Pay.verify(u, String(b.code ?? ""), !!b.takeOver));
  if (!v.exists) St.signOut();
  return v;
});
route("pay/cvv", async (_q, b) => { await St.asPayer(u => Pay.confirmCard(u, String(b.cvv ?? ""))); return {}; });
// Ready once Moovit lists the account as connected for paying.
route("pay/finish", async () => {
  const account = await St.asPayer(Pay.account);
  if (account?.connected) St.markSignedIn();
  return { connected: !!account?.connected, account };
});
route("pay/signout", async () => { St.signOut(); return {}; });

function signedIn() { if (!St.paySignedIn()) throw new HttpError(401, "Not signed in to payments"); }

route("pay/tickets", async () => { signedIn(); return St.asPayer(Pay.tickets); });
route("pay/history", async q => { signedIn(); return { charges: await St.asPayer(u => Pay.history(u, qNum(q, "month") ?? 1, qNum(q, "year") ?? 2026)) }; });
route("pay/billing", async () => { signedIn(); return St.asPayer(Pay.billing); });

route("pay/price", async (_q, b) => { signedIn(); return St.asPayer(u => Pay.price(u, String(b.qr ?? ""), payAt(b))); });
route("pay/quote", async (_q, b) => {
  signedIn();
  if (b.station) return St.asPayer(u => Pay.quoteStation(u, b.station, Number(b.routeType)));
  return St.asPayer(u => Pay.quoteFare(u, b.offer, b.fare, payAt(b)));
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
  const step = await St.asPayer(u => Pay.station(u, at!, routeType, Number(b.origin) || 0, Number(b.destination) || 0));
  const pick = step.pickOrigin.length ? step.pickOrigin : step.pickDestination;
  const picks = pick.length ? Object.values((await M.resolveIds(await St.browse(), [], pick)).stops) : [];
  return { ...step, at, picks };
});
route("pay/exitPrice", async (_q, b) => {
  signedIn();
  let at = bAt(b.at);
  if (at && !b.exact) { const g = net.nearestOfType(at[0], at[1], 2); if (g != null) at = [net.lat[g], net.lon[g]]; }
  if (!at) throw new HttpError(400, "A position is needed");
  const e = await St.asPayer(u => Pay.exitPrice(u, at!));
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
      if (e instanceof Pay.Refused) throw e;
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
  return purchase(() => St.asPayer(u => Pay.buy(u, b.offer, b.fare, payAt(b), count)));
});
route("pay/enter", async (_q, b) => {
  signedIn();
  const at = bAt(b.at); if (!at) throw new HttpError(400, "A position is needed");
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 10);
  return purchase(() => St.asPayer(u => Pay.enter(u, b.station, at, Number(b.routeType), count, !!b.picked)));
});
route("pay/exit", async (_q, b) => {
  signedIn();
  const at = bAt(b.at); if (!at) throw new HttpError(400, "A position is needed");
  if (b.cancel) return { tickets: await St.asPayer(u => Pay.exit(u, at, Number(b.fromStopId), String(b.ref), false, true)) };
  return purchase(() => St.asPayer(u => Pay.exit(u, at, Number(b.fromStopId), String(b.ref), !!b.manual)), true);
});

// ---- static files and the map ----------------------------------------------------------------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".pbf": "application/x-protobuf", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon", ".crt": "application/x-x509-ca-cert", ".mobileconfig": "application/x-apple-aspen-config",
};

function sendFile(req: http.IncomingMessage, res: http.ServerResponse, file: string, cache = "no-cache") {
  let st: fs.Stats;
  try { st = fs.statSync(file); if (!st.isFile()) throw 0; } catch { res.writeHead(404).end("Not found"); return; }
  const type = TYPES[path.extname(file)] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    start = Math.max(0, start); end = Math.min(end, st.size - 1);
    if (start > end) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end(); return; }
    res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes", "Cache-Control": cache });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": cache });
  fs.createReadStream(file).pipe(res);
}

function inside(base: string, rel: string) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) ? p : null;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? "/", "https://kav.local");
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith("/api/")) {
    const h = routes.get(p.slice(5));
    if (!h) { res.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"No such call"}'); return; }
    let body: any = {};
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
    }
    lang(url.searchParams);
    try {
      const out = await h(url.searchParams, body);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(out));
    } catch (e) {
      const err = e as Error & { status?: number; title?: string };
      const status = err.status ?? (e instanceof Pay.Refused ? 422 : e instanceof Pay.Unauthorized ? 401 : 502);
      if (status >= 500) console.error(p, err.message);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: err.message, title: err.title ?? null }));
    }
    return;
  }
  if (p === "/map/israel.pmtiles") return sendFile(req, res, path.join(DATA, "israel.pmtiles"), "max-age=31536000");
  if (p.startsWith("/map/")) { const f = inside(MAP_ASSETS, p.slice(5)); return f ? sendFile(req, res, f, "max-age=86400") : res.writeHead(404).end(); }
  if (p === "/kav-ca.crt") return sendFile(req, res, path.join(DATA, "certs", "ca.crt"));
  const f = p === "/" ? path.join(DIST, "index.html") : inside(DIST, p.slice(1));
  if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(req, res, f, p.startsWith("/assets/") ? "max-age=31536000, immutable" : "no-cache");
  // The app's own routes.
  return sendFile(req, res, path.join(DIST, "index.html"));
}

// ---- certificates: a small CA of this machine's own, installed once on the phone -------------

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a!.address);
}

function certificates() {
  const dir = path.join(DATA, "certs");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ca = path.join(dir, "ca.crt"), caKey = path.join(dir, "ca.key");
  const crt = path.join(dir, "server.crt"), key = path.join(dir, "server.key"), sans = path.join(dir, "sans.txt");
  const run = (...args: string[]) => execFileSync("openssl", args, { stdio: "pipe" });
  if (!fs.existsSync(ca)) {
    run("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", caKey, "-out", ca, "-days", "3650",
      "-subj", `/CN=Kav local CA (${os.hostname()})`, "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
    fs.rmSync(crt, { force: true });
  }
  const want = ["DNS:localhost", `DNS:${os.hostname()}.local`, "IP:127.0.0.1", ...lanAddresses().map(a => `IP:${a}`)].join(",");
  if (!fs.existsSync(crt) || (fs.existsSync(sans) ? fs.readFileSync(sans, "utf8") : "") !== want) {
    const csr = path.join(dir, "server.csr"), ext = path.join(dir, "server.ext");
    run("req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-subj", "/CN=Kav");
    // iOS accepts server certificates of at most 825 days.
    fs.writeFileSync(ext, `subjectAltName=${want}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    run("x509", "-req", "-in", csr, "-CA", ca, "-CAkey", caKey, "-CAcreateserial", "-out", crt, "-days", "800", "-sha256", "-extfile", ext);
    fs.writeFileSync(sans, want);
    fs.rmSync(csr); fs.rmSync(ext);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---- start -----------------------------------------------------------------------------------

if (!fs.existsSync(path.join(DIST, "index.html"))) console.warn("dist/ is missing: run `npm run build` first");

const server = https.createServer(certificates(), (req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) res.writeHead(500).end(); }); });
server.listen(PORT, "0.0.0.0");

// Plain HTTP only hands out the CA and points at the HTTPS address.
http.createServer((req, res) => {
  const host = (req.headers.host ?? "localhost").replace(/:\d+$/, "");
  if (req.url === "/kav-ca.crt") return sendFile(req, res, path.join(DATA, "certs", "ca.crt"));
  const https_ = `https://${host}:${PORT}/`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kav setup</title><body style="font:17px -apple-system,system-ui;max-width:34em;margin:2em auto;padding:0 16px;line-height:1.5">
<h2>Set up Kav on this iPhone</h2><ol>
<li><a href="/kav-ca.crt">Download the Kav certificate</a> and tap <b>Allow</b>.</li>
<li>Open <b>Settings → General → VPN &amp; Device Management</b>, tap <b>Kav local CA</b>, and <b>Install</b>.</li>
<li>Open <b>Settings → General → About → Certificate Trust Settings</b> and turn on <b>Kav local CA</b>.</li>
<li>Open <a href="${https_}">${https_}</a>, then <b>Share → Add to Home Screen</b>.</li></ol></body>`);
}).listen(HTTP_PORT, "0.0.0.0");

console.log(`\nKav is running.`);
for (const a of lanAddresses()) console.log(`  on your iPhone, first time: http://${a}:${HTTP_PORT}/   then: https://${a}:${PORT}/`);
console.log(`  on this computer: https://localhost:${PORT}/`);
