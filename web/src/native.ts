// Kav as an iOS app: the backend runs on the phone, Moovit is reached through the native plugin, and
// the map is a file the app downloads once. In a browser none of this is used: the server does it.
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Platform } from "../backend/platform.ts";

export const isNative = Capacitor.isNativePlatform();

interface KavNativePlugin {
  request(o: { method: string; url: string; headers: Record<string, string>; body?: string; timeout?: number }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  fileSize(o: { name: string }): Promise<{ size: number }>;
  readRange(o: { name: string; offset: number; length: number }): Promise<{ data: string }>;
  download(o: { url: string; name: string; size: number }): Promise<{ size: number }>;
  remove(o: { name: string }): Promise<void>;
  keepAwake(o: { on: boolean }): Promise<void>;
  liveStart(o: TripLive & { destination: string }): Promise<{ ok: boolean; why?: string }>;
  liveUpdate(o: TripLive): Promise<{ ok: boolean }>;
  liveEnd(): Promise<void>;
  addListener(event: "downloadProgress", f: (e: { done: number; total: number }) => void): Promise<PluginListenerHandle>;
}
export const KavNative = registerPlugin<KavNativePlugin>("KavNative");

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const STATE_KEY = "kav-backend";

const phone: Platform = {
  async request(method, url, headers, body, timeoutMs = 25000) {
    const o = { method, url, headers, body: body ? toBase64(body) : undefined, timeout: timeoutMs };
    let r;
    // iOS often drops a kept-alive connection under a request ("The network connection was lost"),
    // most of all on mobile data. Once more on a fresh one fixes it.
    try { r = await KavNative.request(o); }
    catch { await new Promise(done => setTimeout(done, 400)); r = await KavNative.request(o); }
    return { code: r.status, headers: r.headers, body: fromBase64(r.body) };
  },
  load: () => { try { return localStorage.getItem(STATE_KEY); } catch { return null; } },
  save: text => { try { localStorage.setItem(STATE_KEY, text); } catch { /* storage full */ } },
};

// ---- the backend, on the phone ---------------------------------------------------------------

type Backend = typeof import("../backend/routes.ts");
let backend: Promise<Backend> | null = null;

function startBackend(): Promise<Backend> {
  backend ??= import("../backend/routes.ts").then(async b => {
    // The timetable ships inside the app.
    b.startBackend(phone, async () => new Uint8Array(await (await fetch("/il.kav.gz")).arrayBuffer()));
    return b;
  });
  return backend;
}
if (isNative) startBackend();

export class LocalError extends Error {
  status: number; title: string | null;
  constructor(status: number, message: string, title: string | null) { super(message); this.status = status; this.title = title; }
}

// The same calls the server answers, answered on the phone.
export async function callLocal(path: string, body?: unknown): Promise<any> {
  const b = await startBackend();
  const [name, query = ""] = path.split("?");
  try {
    // Through JSON, as over the network, so the screens get plain copies.
    return JSON.parse(JSON.stringify(await b.call(name, new URLSearchParams(query), body === undefined ? {} : JSON.parse(JSON.stringify(body)))) ?? "null");
  } catch (e) {
    const err = e as Error & { title?: string };
    throw new LocalError(b.statusOf(e), err.message, err.title ?? null);
  }
}

// ---- the map file ----------------------------------------------------------------------------

export const MAP_FILE = "israel.pmtiles";
const MAP_URL = "https://github.com/ImNoammm/kav/releases/download/map-1/israel.pmtiles";
export const MAP_BYTES = 185_001_087;

export type MapState = { k: "checking" } | { k: "missing" } | { k: "downloading"; progress: number } | { k: "failed"; why: string } | { k: "ready" };
let mapState: MapState = { k: isNative ? "checking" : "ready" };
const mapListeners = new Set<() => void>();
function setMapState(s: MapState) { mapState = s; mapListeners.forEach(l => l()); }
export const getMapState = () => mapState;
export const subscribeMap = (f: () => void) => { mapListeners.add(f); return () => { mapListeners.delete(f); }; };

if (isNative) {
  KavNative.fileSize({ name: MAP_FILE })
    .then(r => setMapState(r.size === MAP_BYTES ? { k: "ready" } : { k: "missing" }))
    .catch(() => setMapState({ k: "missing" }));
}

export async function downloadMap() {
  if (mapState.k === "downloading" || mapState.k === "ready") return;
  setMapState({ k: "downloading", progress: 0 });
  const listener = await KavNative.addListener("downloadProgress", e => setMapState({ k: "downloading", progress: e.done / (e.total > 0 ? e.total : MAP_BYTES) }));
  try {
    await KavNative.download({ url: MAP_URL, name: MAP_FILE, size: MAP_BYTES });
    setMapState({ k: "ready" });
  } catch (e) {
    setMapState({ k: "failed", why: (e as Error).message });
  } finally {
    listener.remove();
  }
}

export async function removeMap() {
  await KavNative.remove({ name: MAP_FILE });
  setMapState({ k: "missing" });
}

// The map reads its tiles straight from the file, a piece at a time.
export const nativeMapSource = {
  getKey: () => "kav-map",
  getBytes: async (offset: number, length: number) => {
    const r = await KavNative.readRange({ name: MAP_FILE, offset, length });
    const data = fromBase64(r.data);
    return { data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer };
  },
};

export function keepAwake(on: boolean) {
  if (isNative) KavNative.keepAwake({ on }).catch(() => {});
}

// ---- the trip on the lock screen and in the Dynamic Island ------------------------------------

export interface TripLive {
  phase: "wait" | "ride" | "walk" | "arrive"; title: string; detail: string; label: string; stop: string; line: string; mode: string;
  color: string; accent: string; target: number; depart: number; arrive: number; live: boolean; step: number; steps: number;
}

// Why the lock screen did not take the trip, if it didn't: "disabled" (Live Activities are off for Kav in
// Settings), "ios" (older than 16.2), "missing" (the app was built without them) or iOS's own words.
export type LiveResult = { ok: boolean; why?: string };
let lastResult: LiveResult | null = null;
export const liveResult = () => lastResult;

// Started once per trip, then updated; a phone without Live Activities just says no.
let started = false;
export function showTrip(destination: string, t: TripLive) {
  if (!isNative) return;
  if (!started) {
    started = true;
    KavNative.liveStart({ destination, ...t })
      .then(r => { lastResult = r; if (!r.ok) started = false; })
      .catch(e => { lastResult = { ok: false, why: /not implemented/i.test(String(e?.message)) ? "missing" : String(e?.message ?? e) }; started = false; });
  }
  else KavNative.liveUpdate(t).catch(() => {});
}
export function endTrip() {
  if (!isNative || !started) return;
  started = false;
  KavNative.liveEnd().catch(() => {});
}

// From Settings: a two-minute sample trip, to see it on the lock screen and to learn why if it can't be.
export async function tryTripLive(t: TripLive): Promise<LiveResult> {
  if (!isNative) return { ok: false, why: "browser" };
  try {
    const r = await KavNative.liveStart({ destination: t.stop, ...t });
    if (r.ok) setTimeout(() => KavNative.liveEnd().catch(() => {}), 120_000);
    return lastResult = r;
  } catch (e) {
    return lastResult = { ok: false, why: /not implemented/i.test(String((e as Error)?.message)) ? "missing" : String((e as Error)?.message ?? e) };
  }
}
