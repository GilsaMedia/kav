// What Kav keeps an eye on while it isn't open: trips you asked to be reminded of, and the lines whose
// service alerts you follow. The same check runs in the app when it opens and, on iPhone, when iOS wakes
// Kav in the background (background.ts); it says which notifications to show, and when.
import type { Arrival, ServiceAlert } from "./moovit.ts";

// "Leave in 5 min": the notification comes this long before it's time to go.
export const LEAD_MS = 5 * 60_000;
// The live times are asked for once the ride is this close; before that the timetable stands.
const LIVE_WITHIN_MS = 2 * 3600_000;
// A line followed because you rode it is dropped after this long without riding it again.
const AUTO_KEEP_MS = 30 * 86_400_000;

export interface Reminder {
  id: string;
  dest: string;                 // where the trip goes, as you named it
  leaveMs: number;              // when the trip starts, as planned (the walk to the stop included)
  boardMs: number;              // when the first ride leaves its stop, as planned
  stopId: number; tripId: string; lineIds: number[];
  line: string; stop: string;   // "72", "Herzl/Jabotinsky", for the words
  at?: number;                  // when its notification is set for
  liveBoardMs?: number;         // the ride's live time, last seen
}

export interface FollowedLine {
  groupId: number;
  label: string;                // "Bus 72", in the language it was followed in
  manual: boolean;              // followed from the line's page, rather than by riding it
  lastMs: number;               // followed or last ridden
}

export interface Jobs {
  hebrew: boolean;
  reminders: Reminder[];
  lines: FollowedLine[];
  // The alerts already seen on each line group; a line with none here yet just learns what's there.
  seen: Record<string, string[]>;
}

export const emptyJobs = (): Jobs => ({ hebrew: true, reminders: [], lines: [], seen: {} });

export function parseJobs(text: string | null | undefined): Jobs {
  try { return { ...emptyJobs(), ...JSON.parse(text ?? "") }; } catch { return emptyJobs(); }
}

// A notification to show at `at` (ms), or now when that has passed. The same id replaces the one before.
export interface Notice { id: string; title: string; body: string; at: number }

export interface JobDeps {
  arrivals(stopIds: number[]): Promise<Arrival[]>;
  alerts(groupId: number): Promise<ServiceAlert[]>;
}

export const reminderNoticeId = (r: Reminder) => `leave-${r.id}`;
export const isActiveLine = (l: FollowedLine, now: number) => l.manual || now - l.lastMs < AUTO_KEEP_MS;

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const timeOf = (a: Arrival) => (a.rtUtc > 0 ? a.rtUtc : a.statisticalUtc > 0 ? a.statisticalUtc : a.staticUtc) * 1000;
const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();

// The ride as it runs now: the same trip if Moovit lists it, else the same line's nearest departure.
function liveBoard(r: Reminder, arrivals: Arrival[]): number | null {
  const mine = arrivals.filter(a => a.stopId === r.stopId && r.lineIds.includes(a.lineId) && a.status !== 3);
  const same = mine.find(a => String(a.tripId) === r.tripId);
  if (same) return timeOf(same);
  const near = mine.map(timeOf).filter(t => Math.abs(t - r.boardMs) < 15 * 60_000).sort((x, y) => Math.abs(x - r.boardMs) - Math.abs(y - r.boardMs));
  return near[0] ?? null;
}

export async function runJobs(jobs: Jobs, deps: JobDeps, now = Date.now()): Promise<{ jobs: Jobs; notices: Notice[]; cancel: string[] }> {
  const T = (en: string, he: string) => jobs.hebrew ? he : en;
  const notices: Notice[] = [], cancel: string[] = [];

  // ---- reminders to leave
  const reminders: Reminder[] = [];
  const soon = jobs.reminders.filter(r => r.boardMs - now < LIVE_WITHIN_MS && r.boardMs > now);
  const live = soon.length ? await deps.arrivals([...new Set(soon.map(r => r.stopId))]).catch(() => null) : null;
  for (const r0 of jobs.reminders) {
    const r = { ...r0 };
    const board = (live && soon.includes(r0) ? liveBoard(r, live) : null) ?? r.liveBoardMs ?? r.boardMs;
    // Gone: the ride has left.
    if (board < now - 10 * 60_000) { cancel.push(reminderNoticeId(r)); continue; }
    reminders.push(r);
    // Already shown: nothing more to do for it.
    if (r.at != null && r.at <= now) continue;
    r.liveBoardMs = board;
    const leave = r.leaveMs + (board - r.boardMs);
    const at = Math.max(leave - LEAD_MS, now);
    // Only when it moved by a minute or more, so the same notification isn't set again on every check.
    if (r.at != null && Math.abs(r.at - at) < 60_000) continue;
    r.at = at;
    const late = Math.round((board - r.boardMs) / 60_000);
    const mins = Math.max(0, Math.round((leave - at) / 60_000));
    notices.push({
      id: reminderNoticeId(r), at,
      title: mins > 0 ? T(`Leave in ${mins} min for ${r.dest}`, `יוצאים בעוד ${mins} דק׳ אל ${r.dest}`) : T(`Time to leave for ${r.dest}`, `הגיע הזמן לצאת אל ${r.dest}`),
      body: T(`${r.line} from ${r.stop} at ${hm(board)}`, `${r.line} מ${r.stop} ב-${hm(board)}`)
        + (late >= 2 ? T(`, ${late} min late`, `, באיחור של ${late} דק׳`) : late <= -2 ? T(`, ${-late} min early`, `, מוקדם ב-${-late} דק׳`) : ""),
    });
  }

  // ---- service alerts on the lines you follow
  const lines = jobs.lines.filter(l => isActiveLine(l, now));
  const seen: Record<string, string[]> = {};
  for (const l of lines) {
    const key = String(l.groupId);
    const before = jobs.seen[key];
    let alerts: ServiceAlert[];
    try { alerts = await deps.alerts(l.groupId); }
    catch { if (before) seen[key] = before; continue; }
    const current = alerts.filter(a => !a.activeTo || a.activeTo * 1000 > now);
    seen[key] = current.map(a => a.id);
    if (!before) continue;
    for (const a of current) {
      if (before.includes(a.id)) continue;
      const title = a.title || a.label;
      notices.push({ id: `alert-${l.groupId}-${a.id}`, at: now, title: `${l.label}: ${title}`, body: plain(a.body).slice(0, 240) || a.label });
    }
  }

  return { jobs: { ...jobs, reminders, lines, seen }, notices, cancel };
}
