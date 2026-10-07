// Reminders to leave and the lines whose alerts you follow (backend/jobs.ts). Kept by the app, where its
// background check reads them too, and checked again each time Kav comes to the front. iPhone only: a web
// page can't set a notification for later.
import { useSyncExternalStore } from "react";
import { isNative, KavNative } from "./native.ts";
import { api, getPrefs } from "./core.ts";
import { parseJobs, runJobs, emptyJobs, isActiveLine, reminderNoticeId, type Jobs, type Reminder, type FollowedLine, type Notice } from "../backend/jobs.ts";
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

// ---- lines whose alerts you follow

export const followsLine = (j: Jobs, groupId: number) => j.lines.some(l => l.groupId === groupId && isActiveLine(l, Date.now()));

export async function followLine(groupId: number, label: string): Promise<boolean> {
  if (!(granted = await allowed())) return false;
  await queue(async () => {
    await save({ ...jobs, lines: [...jobs.lines.filter(l => l.groupId !== groupId), { groupId, label, manual: true, lastMs: Date.now() }] });
    await check();
  });
  return true;
}

export function unfollowLine(groupId: number) {
  return queue(async () => {
    const seen = { ...jobs.seen }; delete seen[String(groupId)];
    await save({ ...jobs, lines: jobs.lines.filter(l => l.groupId !== groupId), seen });
  });
}

// The lines of a trip you take with Live Directions, followed for a month after; never asks for notifications
// by itself, so only once they're allowed.
export function rodeLines(lines: { groupId: number; label: string }[]) {
  if (!isNative || !granted || !lines.length) return;
  queue(async () => {
    const now = Date.now();
    const kept = jobs.lines.filter(l => !lines.some(x => x.groupId === l.groupId));
    const ridden = lines.map(x => ({ ...x, manual: jobs.lines.find(l => l.groupId === x.groupId)?.manual ?? false, lastMs: now }));
    await save({ ...jobs, lines: [...kept, ...ridden] });
    await check();
  }).catch(() => {});
}
// Whether they're allowed, learned at start without asking.
if (isNative) KavNative.notifyAllowed().then(r => { granted = r.granted; }, () => {});
