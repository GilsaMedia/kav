// A line's status, as Moovit's line list shows it: the kind of its alerts ("עיקוף", a detour) with a mark beside
// the line, on the Lines tab, the ways there and a way's rides. The alerts themselves, collapsed to their titles.
import { useState } from "react";
import { T, api, useLoad } from "./core.ts";
import { Note } from "./ui.tsx";
import { ChevronGlyph, InfoGlyph } from "./icons.tsx";

export interface LineStatus { category: number; label: string; n: number }
export type Statuses = Record<number, LineStatus>;
export interface Alert { id: string; title: string; body: string; html: boolean; label: string }

// Every line's status at once (the Lines tab), refreshed every ten minutes while it's shown.
export const useAllStatuses = (on = true) =>
  useLoad<{ status: Statuses }>(on ? "linestatus:all" : null, s => api("lines/status?all=1", undefined, s), 10 * 60_000, true);

// The status of a few lines (a way's rides).
export function useStatuses(groups: number[]) {
  const ids = [...new Set(groups.filter(g => g > 0))].sort((a, b) => a - b);
  return useLoad<{ status: Statuses }>(ids.length ? `linestatus:${ids.join(",")}` : null, s => api(`lines/status?groups=${ids.join(",")}`, undefined, s), 10 * 60_000, true);
}

// What the status says, for a line with nothing more than its mark: "Detour", or "2 alerts".
export const statusText = (st: LineStatus) => st.label || (st.n === 1 ? T("Service alert", "התראת שירות") : T(`${st.n} service alerts`, `${st.n} התראות שירות`));
// A detour ("עיקוף"): the ways there don't show it.
export const isDetour = (st: LineStatus) => /עיקוף|detour/i.test(st.label);
// Moovit's kind 3 is a detour or long delays: it changes your ride. The rest are notices.
export const isSerious = (st: LineStatus) => st.category >= 3;

export function StatusMark({ st, size = 22 }: { st: LineStatus; size?: number }) {
  return <span className={"status-mark" + (isSerious(st) ? " serious" : "")} title={statusText(st)} aria-label={statusText(st)}><InfoGlyph size={size} /></span>;
}

// Collapsed to its title until tapped: Moovit's notices run long.
export function AlertNote({ a }: { a: Alert }) {
  const [open, setOpen] = useState(false);
  return <Note tone="warn"><button className="alert-title" onClick={() => setOpen(!open)}><ChevronGlyph size={12} open={open} /><b>{a.title || a.label}</b></button>
    {open && a.body && <div className="alert-body">{a.html ? stripHtml(a.body) : a.body}</div>}</Note>;
}

// The alerts of one line, each collapsed to its title.
export function LineAlerts({ group }: { group: number }) {
  const alerts = useLoad<{ alerts: Alert[] }>(group > 0 ? `alerts:${group}` : null, s => api(`alerts?groups=${group}`, undefined, s));
  if (!alerts.data?.alerts.length) return null;
  return <div className="stack">{alerts.data.alerts.map(a => <AlertNote key={a.id} a={a} />)}</div>;
}

function stripHtml(html: string) {
  // DOMParser builds an inert document: nothing in Moovit's HTML runs.
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
