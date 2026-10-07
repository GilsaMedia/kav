// What a web page has and JavaScriptCore on its own doesn't, for the backend run in the background on
// iPhone (background.ts): timers, UTF-8, random bytes and a console. Imported first, so it's all in place
// before the modules that use it load. The __kav* functions are the app's (KavNative.swift).
import { strToU8, strFromU8 } from "fflate";

declare const __kavTimeout: (ms: number, f: () => void) => void;
declare const __kavLog: (s: string) => void;

const g = globalThis as any;

if (typeof g.setTimeout !== "function") {
  let next = 1;
  const live = new Set<number>();
  g.setTimeout = (f: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = next++;
    live.add(id);
    __kavTimeout(Math.max(0, Number(ms) || 0), () => { if (live.delete(id)) f(...args); });
    return id;
  };
  g.clearTimeout = (id: number) => { live.delete(id); };
}

if (typeof g.TextEncoder !== "function") {
  g.TextEncoder = class { encode(s = "") { return strToU8(s); } };
  g.TextDecoder = class { decode(b?: Uint8Array) { return b ? strFromU8(b) : ""; } };
}

if (typeof g.crypto?.getRandomValues !== "function") {
  g.crypto = {
    getRandomValues<T extends Uint8Array>(b: T): T { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); return b; },
  };
}

if (typeof g.console === "undefined") {
  const log = (...a: unknown[]) => __kavLog(a.map(String).join(" "));
  g.console = { log, info: log, warn: log, error: log, debug: log };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < b.length ? B64[n >> 6 & 63] : "=") + (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return s;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64_INDEX[clean.charCodeAt(i)] << 18) | (B64_INDEX[clean.charCodeAt(i + 1)] << 12)
      | ((B64_INDEX[clean.charCodeAt(i + 2)] ?? 0) << 6) | (B64_INDEX[clean.charCodeAt(i + 3)] ?? 0);
    if (o < out.length) out[o++] = n >> 16 & 255;
    if (o < out.length) out[o++] = n >> 8 & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
