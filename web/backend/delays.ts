// How late each line really is, learned from the live times Kav sees while it's used: when a vehicle is
// about to reach a stop, its live time against its timetable time is that ride's delay there. Kept on the
// phone for ten weeks and read back by weekday and hour ("on Sundays around 17:00, 10 minutes late").
import type { Arrival } from "./moovit.ts";
import { delaySamples, persist } from "./state.ts";

// A sample: [lineId, stopId, timetable time (s), delay (s), when seen (s), trip].
type Sample = [number, number, number, number, number, string];

const KEEP_S = 70 * 86_400;
const MAX_SAMPLES = 8000;
// A live time this close to now is the vehicle arriving, not a forecast.
const ARRIVING_S = 120;

const dayHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", weekday: "short", hour: "2-digit", hourCycle: "h23" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function israelDayHour(utc: number): [number, number] {
  const parts = dayHour.formatToParts(new Date(utc * 1000));
  return [DAYS.indexOf(parts.find(p => p.type === "weekday")!.value), Number(parts.find(p => p.type === "hour")!.value)];
}

let lastSave = 0;

export function observe(arrivals: Arrival[]) {
  const now = Math.floor(Date.now() / 1000);
  const kept = delaySamples();
  let changed = false;
  for (const a of arrivals) {
    if (a.rtUtc <= 0 || a.staticUtc <= 0 || a.frequency || a.status === 3 || a.vehicleStatus === 2 || a.vehicleStatus === 3) continue;
    if (Math.abs(a.rtUtc - now) > ARRIVING_S) continue;
    const delay = a.rtUtc - a.staticUtc;
    if (delay < -15 * 60 || delay > 90 * 60) continue;
    // The latest sighting of a ride wins: the closer to arriving, the truer.
    kept[`${a.lineId}:${a.stopId}:${a.staticUtc}`] = [a.lineId, a.stopId, a.staticUtc, delay, now, String(a.tripId)];
    changed = true;
  }
  if (!changed) return;
  const keys = Object.keys(kept);
  if (keys.length > MAX_SAMPLES) {
    keys.sort((x, y) => kept[x][4] - kept[y][4]).slice(0, keys.length - MAX_SAMPLES).forEach(k => delete kept[k]);
  }
  // Saved once a minute at most: arrivals come every few seconds.
  if (now - lastSave > 60) { lastSave = now; persist(); }
}

export interface Bucket { day: number; hour: number; n: number; delayMin: number }
export interface Report {
  n: number; delayMin: number; lateShare: number;
  byDay: { day: number; n: number; delayMin: number }[];
  patterns: Bucket[];
  now: Bucket | null;
  weeks: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const minutes = (sec: number) => Math.round(sec / 6) / 10;

// The line's delays (at one stop, or at all its stops): overall, by weekday, the hours that stand out, and
// the hour that's now.
export function report(lineId: number, stopId?: number): Report {
  const now = Math.floor(Date.now() / 1000);
  const kept = delaySamples();
  const mine: Sample[] = [];
  for (const [k, s] of Object.entries(kept) as [string, Sample][]) {
    if (now - s[4] > KEEP_S) { delete kept[k]; continue; }
    if (s[0] === lineId && (stopId == null || s[1] === stopId)) mine.push(s);
  }
  // One ride passes many stops: at the line level each ride counts once, at its most delayed stop seen.
  let rides = mine;
  if (stopId == null) {
    const byRide = new Map<string, Sample>();
    for (const s of mine) {
      // A trip id names a ride of the timetable; the day tells this week's from last week's.
      const ride = `${s[5]}:${Math.floor((s[2] + 2 * 3600) / 86_400)}`;
      const p = byRide.get(ride);
      if (!p || s[3] > p[3]) byRide.set(ride, s);
    }
    rides = [...byRide.values()];
  }
  const delays = rides.map(s => s[3]);
  const days = new Map<number, number[]>(), hours = new Map<string, number[]>();
  for (const s of rides) {
    const [d, h] = israelDayHour(s[2]);
    (days.get(d) ?? days.set(d, []).get(d)!).push(s[3]);
    (hours.get(`${d}:${h}`) ?? hours.set(`${d}:${h}`, []).get(`${d}:${h}`)!).push(s[3]);
  }
  const bucket = (k: string, xs: number[]): Bucket => { const [d, h] = k.split(":").map(Number); return { day: d, hour: h, n: xs.length, delayMin: minutes(median(xs)) }; };
  const patterns = [...hours].map(([k, xs]) => bucket(k, xs))
    .filter(b => b.n >= 2 && Math.abs(b.delayMin) >= 3)
    .sort((a, b) => Math.abs(b.delayMin) * Math.sqrt(b.n) - Math.abs(a.delayMin) * Math.sqrt(a.n))
    .slice(0, 6);
  const [nd, nh] = israelDayHour(now);
  // This hour, or failing that the hours either side of it, on this weekday.
  const near = [nh, nh - 1, nh + 1].map(h => hours.get(`${nd}:${h}`)).find(xs => xs && xs.length >= 2);
  const first = rides.length ? Math.min(...rides.map(s => s[2])) : now;
  return {
    n: rides.length,
    delayMin: rides.length ? minutes(median(delays)) : 0,
    lateShare: rides.length ? delays.filter(d => d >= 180).length / rides.length : 0,
    byDay: DAYS.map((_, d) => ({ day: d, n: days.get(d)?.length ?? 0, delayMin: days.get(d)?.length ? minutes(median(days.get(d)!)) : 0 })),
    patterns,
    now: near ? { day: nd, hour: nh, n: near.length, delayMin: minutes(median(near)) } : null,
    weeks: Math.max(1, Math.ceil((now - first) / (7 * 86_400))),
  };
}
