// The ride you'd pay for next on the trip you have open, so Pay on the lock screen and in the Dynamic Island opens
// paying for it; and the rides you've paid for, so the button goes once you have. A ride is known by the stop
// you get on at and its mode, the same however the payment was started.
import { useSyncExternalStore } from "react";
import type { LatLon } from "./core.ts";

export interface PayStart { at?: LatLon; routeType?: number; off?: LatLon }

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

// Whether paying in Kav is set up on this phone: without it, the lock screen has no Pay to offer.
export function setPaySignedIn(on: boolean) { try { localStorage.setItem(SIGNED, on ? "1" : "0"); } catch { /* not kept */ } }
export const paySignedIn = () => { try { return localStorage.getItem(SIGNED) === "1"; } catch { return false; } };
