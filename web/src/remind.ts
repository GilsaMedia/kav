// Reminders to leave and the lines of the ride you're on (backend/jobs.ts). Kept by the app, where its
// background check reads them too, and checked again each time Kav comes to the front. iPhone only: a web
// page can't set a notification for later.
import { useSyncExternalStore } from "react";
import { isNative, KavNative } from "./native.ts";
import { api, getPrefs } from "./core.ts";
import { parseJobs, runJobs, emptyJobs, reminderNoticeId, type Jobs, type Reminder, type FollowedLine, type Notice } from "../backend/jobs.ts";
import type { Arrival, ServiceAlert } from "../backend/moovit.ts";

export type { Reminder, FollowedLine };
export const canNotify = isNative;

let jobs: Jobs = emptyJobs();
const listeners = new Set<() => void>();
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function useJobs(): Jobs { return useSyncExternalStore(subscribe, () => jobs); }

// One change at a time, each on the jobs as the last one left them.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(f: () => Promise<T>): Promise<T> {
  const run = chain.then(f);
  chain = run.catch(() => {});
  return run;
}

async function load() {
  try { jobs = parseJobs((await KavNative.stateRead({ key: "jobs" })).value); } catch { /* as it was */ }
  listeners.forEach(l => l());
}

async function save(next: Jobs) {
  jobs = { ...next, hebrew: getPrefs().lang === "he" };
  listeners.forEach(l => l());
  await KavNative.stateWrite({ key: "jobs", value: JSON.stringify(jobs) }).catch(() => {});
}

const notify = (notices: Notice[], cancel: string[]) =>
  notices.length || cancel.length ? KavNative.notifySet({ json: JSON.stringify({ notices, cancel }) }).catch(() => {}) : Promise.resolve();

// The check, here and now: reminders moved by live times, new alerts told.
const check = () => runJobs(jobs, {
  arrivals: async ids => (await api<{ arrivals: Arrival[] }>(`arrivals?stops=${ids.join(",")}`)).arrivals,
  alerts: async group => (await api<{ alerts: ServiceAlert[] }>(`alerts?groups=${group}`)).alerts,
}).then(async r => { await save(r.jobs); await notify(r.notices, r.cancel); });

let lastCheck = 0;
function refresh() {
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  queue(async () => { await load(); if (jobs.reminders.length || jobs.lines.length) await check(); }).catch(() => {});
}

if (isNative) {
  refresh();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}

// Asked the first time it's needed; false when notifications are off for Kav.
async function allowed(): Promise<boolean> {
  try { return (await KavNative.notifyAllow()).granted; } catch { return false; }
}
let granted = false;

// ---- reminders to leave

export async function addReminder(r: Omit<Reminder, "at" | "liveBoardMs">): Promise<boolean> {
  if (!(granted = await allowed())) return false;
  await queue(async () => {
    await save({ ...jobs, reminders: [...jobs.reminders.filter(x => x.id !== r.id), r] });
    await check();
  });
  return true;
}

export function removeReminder(id: string) {
  return queue(async () => {
    const r = jobs.reminders.find(x => x.id === id);
    await save({ ...jobs, reminders: jobs.reminders.filter(x => x.id !== id) });
    if (r) await notify([], [reminderNoticeId(r)]);
  });
}

// ---- the lines of the ride you started

// Followed for their alerts while you're on the ride and no longer, never asking for notifications by itself,
// so only once they're allowed. The alerts already up when you start are learned, not told: only a new one
// during the ride is.
export function rideLines(lines: { groupId: number; label: string }[], untilMs: number) {
  if (!isNative || !granted) return;
  queue(async () => {
    await save({ ...jobs, lines: lines.map(l => ({ ...l, until: untilMs })), seen: {} });
    if (lines.length) await check();
  }).catch(() => {});
}

// The ride stopped: nothing more about its lines.
export function endRideLines() {
  if (!isNative || !jobs.lines.length) return;
  queue(() => save({ ...jobs, lines: [], seen: {} })).catch(() => {});
}
// Whether they're allowed, learned at start without asking.
if (isNative) KavNative.notifyAllowed().then(r => { granted = r.granted; }, () => {});

// ---- the steps of a trip you follow with Start

// Set ahead for each step ("72 at your stop in 2 min", "Get off in 2 min"), so they come with Kav in the
// background too, and set again as the live times move them. Taken back when you stop.
let navIds: string[] = [];
export async function setStepNotices(notices: Notice[]) {
  if (!isNative) return;
  if (!(granted ||= await allowed())) return;
  const ids = notices.map(n => n.id);
  const gone = navIds.filter(id => !ids.includes(id));
  navIds = ids;
  await notify(notices, gone);
}
export function clearStepNotices() {
  if (!isNative || !navIds.length) return;
  const gone = navIds; navIds = [];
  notify([], gone);
}
