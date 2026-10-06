// What the backend keeps between runs: the two Moovit users (one for browsing, one for paying) and
// the timetable-to-Moovit stop ids it has learned. Saved through the platform: a file on a computer,
// the app's own storage on a phone.
import * as M from "./moovit.ts";
import { Unauthorized } from "./pay.ts";
import { platform } from "./platform.ts";

const WEEK_MS = 7 * 86_400_000;

interface Saved {
  browse?: M.MoovitSession; born?: number;
  pay?: M.MoovitSession; paySignedIn?: boolean;
  device?: typeof M.device;
  stopIds?: Record<string, number>;
}

// Each install tells Moovit about one phone of its own.
const PHONES = [
  ["Google oriole", "14_34", "Pixel 6", "AP2A.240905.003"], ["Google panther", "14_34", "Pixel 7", "AP2A.240905.003"],
  ["samsung dm1qxxx", "14_34", "SM-S911B", "UP1A.231005.007"], ["samsung a54xnsxx", "14_34", "SM-A546E", "UP1A.231005.007"],
  ["Xiaomi garnet_global", "14_34", "23124RA7EO", "UKQ1.231003.002"],
];

let saved: Saved = {};
export let stopIds: Record<string, number> = {};

// Reads what was saved. Called once the platform is set.
export function initState() {
  try { saved = JSON.parse(platform().load() ?? "{}"); } catch { saved = {}; }
  if (!saved.device) {
    const [model, os, name, build] = PHONES[Math.floor(Math.random() * PHONES.length)];
    saved.device = { model, os, agent: `Dalvik/2.1.0 (Linux; U; Android 14; ${name} Build/${build})` };
  }
  Object.assign(M.device, saved.device);
  saved.stopIds ??= {};
  stopIds = saved.stopIds;
  persist();
}

let writing: ReturnType<typeof setTimeout> | null = null;
// now: at once, for what can't be lost if the app is closed straight after (the payment user).
export function persist(now = false) {
  if (now) {
    if (writing) { clearTimeout(writing); writing = null; }
    platform().save(JSON.stringify(saved));
    return;
  }
  if (writing) return;
  writing = setTimeout(() => { writing = null; platform().save(JSON.stringify(saved)); }, 200);
}

const fresh = (s?: M.MoovitSession) => !!s && s.accessExpiresUtc - Date.now() / 1000 > 60;

// ---- browsing: one Moovit user, renewed daily and replaced weekly ----------------------------

let opening: Promise<M.MoovitSession> | null = null;
let failures = 0, failedAt = 0;

export function browse(at?: M.LatLon | null): Promise<M.MoovitSession> {
  const s = saved.browse;
  if (fresh(s) && Date.now() - (saved.born ?? 0) < WEEK_MS) return Promise.resolve(s!);
  opening ??= (async () => {
    // Each failure waits twice as long, up to five minutes: Moovit refuses new users from an address that keeps asking.
    const wait = Math.min(10_000 * 2 ** Math.max(failures - 1, 0), 300_000);
    if (failures && Date.now() - failedAt < wait) throw new Error("Moovit is unreachable");
    try {
      const kept = saved.browse;
      let next: M.MoovitSession | null = null;
      if (!kept || Date.now() - (saved.born ?? 0) > WEEK_MS) {
        try { next = at ? await M.register(at[0], at[1]) : await M.register(); saved.born = Date.now(); }
        catch (e) {
          if (!kept) throw e;
          // Keep the old user another day rather than asking Moovit for a new one on every call.
          saved.born = Date.now() - WEEK_MS + 86_400_000;
        }
      }
      if (!next) next = fresh(kept) ? kept! : await M.renew(kept!);
      saved.browse = next; persist(); failures = 0;
      return next;
    } catch (e) { failures++; failedAt = Date.now(); throw e; }
  })().finally(() => { opening = null; });
  return opening;
}

// ---- paying: the user the rider's payment account is tied to ---------------------------------

let payLock: Promise<unknown> = Promise.resolve();

async function payUser(renew: boolean): Promise<M.MoovitSession> {
  const kept = saved.pay;
  let next = kept;
  if (!kept) next = await M.register();
  else if (renew || !fresh(kept)) next = await M.renew(kept);
  if (next !== kept) { saved.pay = next; persist(true); }
  return next!;
}

// A call as the paying user. If Moovit stops taking its access, renew once.
export function asPayer<T>(f: (s: M.MoovitSession) => Promise<T>): Promise<T> {
  const run = payLock.then(async () => {
    try { return await f(await payUser(false)); }
    catch (e) { if (e instanceof Unauthorized) return f(await payUser(true)); throw e; }
  });
  payLock = run.catch(() => {});
  return run;
}

export const paySignedIn = () => !!saved.paySignedIn;
export function markSignedIn() { saved.paySignedIn = true; persist(true); }
export function signOut() { saved.pay = undefined; saved.paySignedIn = false; persist(true); }

// ---- timetable stops to Moovit ids -----------------------------------------------------------

export function learnStopId(key: string, id: number) { if (stopIds[key] !== id) { stopIds[key] = id; persist(); } }
