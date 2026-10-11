// The ride you started with Start, kept on the phone: the Trip tab's home shows it until you stop it or its
// time is over, so leaving Live Directions for a moment, or closing Kav, never loses it.
import { useSyncExternalStore } from "react";
import { useNow, type Itinerary, type Resolved } from "./core.ts";

export interface SavedRide { trip: Itinerary; resolved: Resolved; from: string; to: string; step: number }

const KEY = "kav-ride";
// Over a few minutes after its arrival: a little late is still the same ride.
const GRACE_MS = 5 * 60_000;

let ride: SavedRide | null = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } })();
const listeners = new Set<() => void>();

function set(next: SavedRide | null) {
  ride = next;
  try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* storage full */ }
  listeners.forEach(l => l());
}

const over = (r: SavedRide) => Date.now() > r.trip.arr * 1000 + GRACE_MS;

// Gone once over: hidden from then on, and forgotten when Kav next starts.
if (ride && over(ride)) set(null);
export const getRide = (): SavedRide | null => ride && !over(ride) ? ride : null;

export function useRide(): SavedRide | null {
  useNow(30_000); // looked at again as time goes, so it leaves when it's over
  return useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, getRide);
}

export const saveRide = (r: SavedRide) => set(r);
export const clearRide = () => set(null);
export function setRideStep(step: number) {
  if (ride && ride.step !== step) set({ ...ride, step });
}
