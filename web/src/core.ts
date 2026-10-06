// Shared plumbing: preferences, language, the API, time and place helpers, and the data shapes the server sends.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { isNative, callLocal, LocalError } from "./native.ts";

// ---- preferences (this phone only) -----------------------------------------------------------

export type Look = "black" | "dark" | "light";
export interface Place { name: string; detail: string; lat: number; lon: number; type?: number }
export interface Favourite extends Place { label: string }
export interface Prefs {
  lang: "he" | "en"; look: Look; privateSearch: boolean; recents: Place[]; favourites: Favourite[]; modes: number[];
  accent: string; liquid: boolean;
  // First-launch setup done, and the one "Enjoying Kav?" note after it.
  onboarded: boolean; supportShown: boolean;
  // Trips planned, newest first, for the home screen.
  trips: RecentTrip[];
}
export interface RecentTrip { from: Place | null; to: Place; at: number }

export function rememberTrip(from: Place | null, to: Place) {
  const same = (a: Place | null, b: Place | null) => (!a && !b) || (!!a && !!b && Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4);
  const trips = [{ from, to, at: Date.now() }, ...prefs.trips.filter(t => !(same(t.from, from) && same(t.to, to)))].slice(0, 10);
  setPrefs({ trips });
}

export function agoText(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return T("just now", "עכשיו");
  if (m < 60) return T(`${m} min ago`, `לפני ${m} דק׳`);
  const h = Math.round(m / 60);
  if (h < 24) return T(`${h} h ago`, `לפני ${h} ש׳`);
  const d = Math.round(h / 24);
  return T(`${d} d ago`, `לפני ${d} ימים`);
}

export const DEFAULT_ACCENT = "#9ABEFF";
const DEFAULTS: Prefs = {
  lang: "he", look: "dark", privateSearch: true, recents: [], favourites: [], modes: [], accent: DEFAULT_ACCENT, liquid: true,
  onboarded: false, supportShown: false, trips: [],
};
const KEY = "kav-prefs";

function readPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...DEFAULTS }; }
}
let prefs = readPrefs();
const listeners = new Set<() => void>();

export function setPrefs(change: Partial<Prefs>) {
  prefs = { ...prefs, ...change };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  applyLook();
  listeners.forEach(l => l());
}
export const getPrefs = () => prefs;
export function usePrefs(): Prefs {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => prefs);
}

export function applyLook() {
  const html = document.documentElement;
  html.dataset.look = prefs.look;
  html.dataset.glass = prefs.liquid ? "liquid" : "solid";
  // Accents are always pale, so text on them stays dark in every look.
  html.style.setProperty("--accent", /^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : DEFAULT_ACCENT);
  html.lang = prefs.lang;
  html.dir = prefs.lang === "he" ? "rtl" : "ltr";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", prefs.look === "light" ? "#F6F6F3" : prefs.look === "dark" ? "#101012" : "#000000");
}

export function remember(p: Place) {
  const recents = [p, ...prefs.recents.filter(r => r.name !== p.name || Math.abs(r.lat - p.lat) > 1e-4)].slice(0, 12);
  setPrefs({ recents });
}

// English first, then Hebrew, as the Android app writes its strings.
export const T = (en: string, he: string) => (prefs.lang === "he" ? he : en);

// ---- the API ---------------------------------------------------------------------------------

export class ApiError extends Error {
  status: number; title: string | null;
  constructor(status: number, message: string, title: string | null) { super(message); this.status = status; this.title = title; }
}

export async function api<T = any>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  if (isNative) {
    // In the app the backend runs on the phone itself.
    try { return await callLocal(`${path}${sep}lang=${prefs.lang}&private=${prefs.privateSearch ? 1 : 0}`, body); }
    catch (e) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (e instanceof LocalError) throw new ApiError(e.status, e.message, e.title);
      throw e;
    }
  }
  const url = `/api/${path}${sep}lang=${prefs.lang}&private=${prefs.privateSearch ? 1 : 0}`;
  const res = await fetch(url, body === undefined ? { signal } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, out.error ?? `HTTP ${res.status}`, out.title ?? null);
  return out as T;
}

export function failure(e: unknown): string {
  if (e instanceof ApiError) {
    // The reason goes along, small, so a failure can be told apart from a bad connection.
    if (e.status === 502 || e.status === 500) return T("Couldn't reach Moovit. Try again in a moment.", "אין חיבור ל-Moovit. נסו שוב בעוד רגע.")
      + (e.message && !/^HTTP \d+$/.test(e.message) ? ` (${e.message})` : "");
    return e.message;
  }
  if (e instanceof TypeError) return isNative ? T("No internet connection.", "אין חיבור לאינטרנט.") : T("No connection to the Kav server.", "אין חיבור לשרת של Kav.");
  return (e as Error)?.message ?? String(e);
}

// Loads once per key, keeps the last answer while reloading, and drops answers to stale keys.
// With keep, a new key shows the old answer until the new one comes, rather than an empty screen.
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, everyMs?: number | (() => number), keep = false) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!key });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load); loadRef.current = load;
  useEffect(() => { setState(s => ({ data: keep ? s.data : null, error: null, loading: !!key })); }, [key]);
  useEffect(() => {
    if (!key) return;
    const ac = new AbortController();
    let timer: number | undefined, unwait: (() => void) | undefined;
    setState(s => ({ ...s, loading: true }));
    Promise.resolve().then(() => loadRef.current(ac.signal)).then(
      data => { if (!ac.signal.aborted) setState({ data, error: null, loading: false }); },
      e => { if (!ac.signal.aborted) setState(s => ({ ...s, error: failure(e), loading: false })); },
    ).finally(() => {
      if (ac.signal.aborted || !everyMs) return;
      const ms = typeof everyMs === "function" ? everyMs() : everyMs;
      timer = window.setTimeout(() => { if (document.visibilityState === "visible") setTick(t => t + 1); else unwait = waitVisible(() => setTick(t => t + 1)); }, ms);
    });
    return () => { ac.abort(); clearTimeout(timer); unwait?.(); };
  }, [key, tick]);
  return { ...state, reload: () => setTick(t => t + 1) };
}

function waitVisible(f: () => void) {
  const on = () => { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", on); f(); } };
  document.addEventListener("visibilitychange", on);
  return () => document.removeEventListener("visibilitychange", on);
}

// ---- location --------------------------------------------------------------------------------

export type LatLon = [number, number];
let here: LatLon | null = null;
let accuracy = 0;
const hereListeners = new Set<() => void>();
let watching = 0;
let watchId: number | null = null;
export let locationDenied = false;

let nativeWatch: Promise<string> | null = null;

let fixedAt = 0;
function fix(lat: number, lon: number, acc: number) {
  here = [lat, lon]; accuracy = acc; fixedAt = Date.now(); locationDenied = false; hereListeners.forEach(l => l());
}
function denied() { locationDenied = true; hereListeners.forEach(l => l()); }

function startWatch() {
  if (isNative) {
    // The app asks iOS itself, so the location prompt names Kav rather than a web page.
    nativeWatch ??= Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }, (p, err) => {
      if (p) fix(p.coords.latitude, p.coords.longitude, p.coords.accuracy);
      else if (err && /denied|permission/i.test(String((err as Error).message ?? err))) denied();
    });
    return;
  }
  if (watchId != null || !("geolocation" in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    p => fix(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
    e => { if (e.code === e.PERMISSION_DENIED) denied(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  );
}
function stopWatch() {
  if (nativeWatch) { const w = nativeWatch; nativeWatch = null; w.then(id => Geolocation.clearWatch({ id })).catch(() => {}); }
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// The phone's position while a screen that needs it is open.
export function useHere(active = true): LatLon | null {
  const v = useSyncExternalStore(cb => { hereListeners.add(cb); return () => hereListeners.delete(cb); }, () => here);
  useEffect(() => {
    if (!active) return;
    watching++; startWatch();
    return () => { if (--watching === 0) stopWatch(); };
  }, [active]);
  return v;
}
export const currentHere = () => here;
export const currentAccuracy = () => accuracy;

// The position now: the one being followed, or a fresh fix. A position kept from long ago would price a ride
// or find a station where the rider no longer is.
export function locateOnce(timeout = 12000): Promise<LatLon> {
  if (here && (watching > 0 || Date.now() - fixedAt < 30_000)) return Promise.resolve(here);
  if (isNative) {
    return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout, maximumAge: 10000 }).then(
      p => { fix(p.coords.latitude, p.coords.longitude, p.coords.accuracy); return here!; },
      e => { throw new Error(/denied|permission/i.test(String(e?.message ?? e))
        ? T("Location is off for Kav. Allow it in Settings → Kav → Location.", "המיקום כבוי עבור Kav. אפשרו אותו בהגדרות → Kav → מיקום.")
        : T("Couldn't find your location.", "לא הצלחנו למצוא את המיקום שלכם.")); });
  }
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error(T("Location isn't available.", "המיקום אינו זמין.")));
    navigator.geolocation.getCurrentPosition(
      p => { fix(p.coords.latitude, p.coords.longitude, p.coords.accuracy); resolve(here!); },
      e => reject(new Error(e.code === e.PERMISSION_DENIED
        ? T("Location is off for Kav. Allow it in Settings → Safari → Location.", "המיקום כבוי עבור Kav. אפשרו אותו בהגדרות → Safari → מיקום.")
        : T("Couldn't find your location.", "לא הצלחנו למצוא את המיקום שלכם."))),
      { enableHighAccuracy: true, timeout, maximumAge: 10000 },
    );
  });
}

export function metres(a: LatLon, b: LatLon): number {
  const r = 6_371_000, toR = Math.PI / 180;
  const dLa = (b[0] - a[0]) * toR, dLo = (b[1] - a[1]) * toR;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(x)));
}

export const distanceText = (m: number) => m < 1000 ? T(`${Math.round(m / 10) * 10} m`, `${Math.round(m / 10) * 10} מ׳`) : T(`${(m / 1000).toFixed(1)} km`, `${(m / 1000).toFixed(1)} ק״מ`);

// ---- time ------------------------------------------------------------------------------------

const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const clock = (utc: number) => hm.format(new Date(utc * 1000));
export const nowSec = () => Math.floor(Date.now() / 1000);

export function useNow(everyMs = 15000) {
  const [now, setNow] = useState(nowSec);
  useEffect(() => { const t = setInterval(() => setNow(nowSec()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

export function minutesText(mins: number) {
  if (mins <= 0) return T("now", "עכשיו");
  if (mins < 60) return T(`${mins} min`, `${mins} דק׳`);
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? T(`${h} h ${m} min`, `${h} ש׳ ${m} דק׳`) : T(`${h} h`, `${h} ש׳`);
}

export const shekels = (agorot: number) => "₪" + (agorot / 100).toFixed(2).replace(/\.00$/, "");

// ---- modes -----------------------------------------------------------------------------------

// GTFS route types, as Moovit's agencies carry them.
export function modeName(type: number) {
  switch (type) {
    case 0: return T("Light rail", "רכבת קלה");
    case 1: return T("Metro", "מטרו");
    case 2: return T("Train", "רכבת");
    case 4: return T("Ferry", "מעבורת");
    case 5: return T("Cable car", "רכבל");
    case 6: return T("Cable car", "רכבל");
    case 7: return T("Carmelit", "כרמלית");
    case 715: return T("Shared taxi", "מונית שירות");
    default: return T("Bus", "אוטובוס");
  }
}

export function modeColor(type: number) {
  switch (type) {
    case 0: return "#D8232A";
    case 1: return "#8950D4";
    case 2: return "#1F6FD0";
    case 5: case 6: return "#8950D4";
    case 7: return "#0A822E";
    case 715: return "#F5C518";
    default: return "#3E9B5C";
  }
}

export const MODE_FILTERS: { types: number[]; label: () => string }[] = [
  { types: [3], label: () => T("Bus", "אוטובוס") },
  { types: [2], label: () => T("Train", "רכבת") },
  { types: [0, 1], label: () => T("Light rail", "רכבת קלה") },
  { types: [5, 6, 7], label: () => T("Cable", "רכבל וכרמלית") },
  { types: [4], label: () => T("Ferry", "מעבורת") },
];

// ---- what the server sends -------------------------------------------------------------------

export interface Departure {
  tripId: number | string; staticUtc: number; rtUtc: number; statisticalUtc: number; status: number; certainty: number;
  traffic: number; frequency: boolean; rtDropped: boolean; vehicleStatus: number; alert: number; platform: string;
}
export interface Arrival extends Departure {
  stopId: number; lineId: number; tracked: boolean; lat: number; lon: number; vehicleId: string; sampleUtc: number;
  nextStopIndex: number; stopIndex: number; patternStops: number; tripShapeId: number; patternId: number;
}
export interface Leg {
  kind: "walk" | "wait" | "ride" | "taxi" | "bike" | "other"; lineId: number; tripId: number | string; dep: number; arr: number;
  stops: number[]; fromStop: number; toStop: number; meters: number; nextDeps: Departure[]; shortName: string; pathway: boolean;
  fare: number; currency: string; shape: LatLon[]; alertCategory: number; alertText: string;
  taxiPickup: LatLon | null; taxiDropoff: LatLon | null; alternatives: Leg[]; alternativeLineIds: number[];
}
export interface Itinerary {
  guid: string; group: number; legs: Leg[]; dep: number; arr: number; fare: number; currency: string; co2g: number;
  accessible: boolean; tags: string[]; section: string; sectionId: number; wire: string;
}
export interface LineInfo { groupId: number; number: string; agencyId: number; origin: string; destination: string; caption: string }
export interface StopInfo { id: number; name: string; code: string; lat: number | null; lon: number | null }
export interface Resolved {
  lines: Record<number, LineInfo>; stops: Record<number, StopInfo>; routeTypes: Record<number, number>; agencies: Record<number, string>;
}
export const emptyResolved = (): Resolved => ({ lines: {}, stops: {}, routeTypes: {}, agencies: {} });
export const mergeResolved = (a: Resolved, b?: Resolved | null): Resolved => b ? ({
  lines: { ...a.lines, ...b.lines }, stops: { ...a.stops, ...b.stops }, routeTypes: { ...a.routeTypes, ...b.routeTypes }, agencies: { ...a.agencies, ...b.agencies },
}) : a;

export const timeOf = (d: Departure) => d.rtUtc > 0 ? d.rtUtc : d.statisticalUtc > 0 ? d.statisticalUtc : d.staticUtc;
export const isLive = (d: Departure) => d.status !== 3 && !d.frequency && d.vehicleStatus !== 2 && d.rtUtc > 0 && d.vehicleStatus !== 3;
export const isCancelled = (d: Departure) => d.status === 3;
export const routeTypeOf = (r: Resolved, lineId: number) => { const l = r.lines[lineId]; return l ? r.routeTypes[l.agencyId] ?? 3 : 3; };
export const options = (l: Leg) => (l.alternatives.length ? l.alternatives : [l]);

// The first ride of a way there, from where you get on: when the vehicle is at that stop (live when
// Moovit tracks it), how long you ride, and how long you walk before it.
export interface Boarding { ride: Leg; at: number; live: boolean; dep: Departure | null; stop: string; rideMin: number; walkMin: number; numbers: string[] }

export function boardingOf(it: Itinerary, r: Resolved, now: number): Boarding | null {
  const i = it.legs.findIndex(l => l.kind === "ride");
  if (i < 0) return null;
  const ride = it.legs[i];
  const before = it.legs[i - 1]?.kind === "wait" ? options(it.legs[i - 1]).find(w => w.lineId === ride.lineId) : undefined;
  const deps = [...(before?.nextDeps ?? []), ...ride.nextDeps].filter(d => timeOf(d) >= now - 30);
  // The very vehicle this way is planned on, else the next one of the line.
  const dep = deps.find(d => String(d.tripId) === String(ride.tripId)) ?? deps.sort((a, b) => timeOf(a) - timeOf(b))[0] ?? null;
  const walk = it.legs.slice(0, i).filter(l => l.kind === "walk").reduce((s, l) => s + Math.max(0, l.arr - l.dep), 0);
  return {
    ride, dep, at: dep ? timeOf(dep) : ride.dep, live: !!dep && isLive(dep), stop: r.stops[ride.fromStop]?.name ?? "",
    rideMin: Math.max(1, Math.round((ride.arr - ride.dep) / 60)), walkMin: Math.round(walk / 60),
    numbers: [...new Set(options(ride).map(o => r.lines[o.lineId]?.number || o.shortName).filter(Boolean))].slice(0, 3),
  };
}

// The way that gets you onto a vehicle soonest from now, the earlier arrival breaking a tie.
export function soonest(its: Itinerary[], r: Resolved, now: number): { it: Itinerary; b: Boarding | null } | null {
  let best: { it: Itinerary; b: Boarding | null } | null = null;
  for (const it of its) {
    const b = boardingOf(it, r, now);
    if (!b || b.at < now - 30) continue;
    if (!best || !best.b || b.at < best.b.at || (b.at === best.b.at && it.arr < best.it.arr)) best = { it, b };
  }
  return best ?? (its[0] ? { it: its[0], b: boardingOf(its[0], r, now) } : null);
}
