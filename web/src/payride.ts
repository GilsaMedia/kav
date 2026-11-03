// The ride you'd pay for next on the trip you have open, so Pay on the lock screen and in the Dynamic Island opens
// paying for it; and the rides you've paid for, so the button goes once you have. A ride is known by the stop
// you get on at and its mode, the same however the payment was started.
import { useSyncExternalStore } from "react";
import { api, type LatLon } from "./core.ts";

// qr: a bus already scanned, paid for without scanning it again. pay: paid right away once the fare is
// known (Quick pay), without a second tap on Pay.
export interface PayStart { at?: LatLon; routeType?: number; off?: LatLon; qr?: string; pay?: boolean }

const PAID = "kav-paid", SIGNED = "kav-pay-signed-in";
// A payment covers the ride it was for, and that ride is over within a few hours.
const KEEP_MS = 4 * 3600_000;

export const rideKey = (at: LatLon, routeType: number) => `${at[0].toFixed(5)},${at[1].toFixed(5)}:${routeType}`;

let target: PayStart | null = null;
let paid: Record<string, number> = (() => {
  try {
    const all = JSON.parse(localStorage.getItem(PAID) ?? "{}") as Record<string, number>;
    return Object.fromEntries(Object.entries(all).filter(([, t]) => Date.now() - t < KEEP_MS));
  } catch { return {}; }
})();
const listeners = new Set<() => void>();

export const setPayTarget = (t: PayStart | null) => { target = t; };
export const payTarget = () => target;

// Paid: the ride the payment was started for, from its stop.
export function markPaid(start: PayStart | null) {
  if (!start?.at || start.routeType == null) return;
  paid = { ...paid, [rideKey(start.at, start.routeType)]: Date.now() };
  try { localStorage.setItem(PAID, JSON.stringify(paid)); } catch { /* not kept */ }
  listeners.forEach(l => l());
}
export const isPaid = (at: LatLon, routeType: number) => rideKey(at, routeType) in paid;
export function usePaid() {
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, () => paid);
}

// The last bus scanned and not paid for yet, kept on this phone for a few hours: forgot to pay when getting on,
// pay for it from your seat (or from the lock screen's Quick pay) without scanning again.
const LAST_BUS = "kav-last-bus", KEEP_BUS_MS = 3 * 3600_000;
export type ScannedBus = { qr: string; atMs: number };
let bus: ScannedBus | null = (() => {
  try {
    const b = JSON.parse(localStorage.getItem(LAST_BUS) ?? "null") as ScannedBus | null;
    return b?.qr && Date.now() - b.atMs < KEEP_BUS_MS ? b : null;
  } catch { return null; }
})();
const busListeners = new Set<() => void>();
function setBus(b: ScannedBus | null) {
  bus = b;
  try { if (b) localStorage.setItem(LAST_BUS, JSON.stringify(b)); else localStorage.removeItem(LAST_BUS); } catch { /* not kept */ }
  busListeners.forEach(l => l());
}
export const busExpires = (b: ScannedBus) => b.atMs + KEEP_BUS_MS;
export const lastBus = () => bus && Date.now() < busExpires(bus) ? bus : null;
export const keepBus = (qr: string) => setBus({ qr, atMs: Date.now() });
export const forgetBus = () => setBus(null);
export function useLastBus() {
  const b = useSyncExternalStore(f => { busListeners.add(f); return () => { busListeners.delete(f); }; }, () => bus);
  return b && Date.now() < busExpires(b) ? b : null;
}

// Whether paying in Kav is set up on this phone: without it, the lock screen has no Pay to offer.
export function setPaySignedIn(on: boolean) { try { localStorage.setItem(SIGNED, on ? "1" : "0"); } catch { /* not kept */ } }
export const paySignedIn = () => { try { return localStorage.getItem(SIGNED) === "1"; } catch { return false; } };

// Kav learns it on the Pay screen, so someone signed in before 3.0 who hasn't opened it since had no Pay on the
// lock screen. Asked at launch too: signed out always counts; signed in counts unless the Pay screen found a step
// Moovit still wants.
export function learnPaySignedIn() {
  api<{ pay: boolean }>("status").then(s => {
    let known: string | null = null;
    try { known = localStorage.getItem(SIGNED); } catch { /* not kept */ }
    if (!s.pay) setPaySignedIn(false);
    else if (known === null) setPaySignedIn(true);
  }, () => {});
}
