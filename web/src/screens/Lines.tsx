// Every line Moovit knows, and the page of one: its route, stops, buses on the road and today's departures.
import { useMemo, useRef, useState } from "react";
import { T, api, useLoad, useNow, clock, minutesText, timeOf, isLive, modeColor, modeName, type Arrival, type LatLon, type StopInfo, type LineInfo } from "../core.ts";
import { Header, LineBadge, Spinner, Note, LiveDot } from "../ui.tsx";
import { MapView } from "../MapView.tsx";
import { ChevronGlyph } from "../icons.tsx";

interface LineGroup { id: number; number: string; name: string; cities: string; agencyId: number; agency: string; routeType: number }

export function LinesScreen() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LineGroup | null>(null);
  const found = useLoad<{ lines: LineGroup[]; total: number }>(q.trim() ? `lines:${q.trim()}` : null,
    s => new Promise(r => setTimeout(r, 200)).then(() => api(`lines/search?q=${encodeURIComponent(q.trim())}`, undefined, s)));
  if (open) return <LineDetail group={open} onBack={() => setOpen(null)} />;
  return (
    <div className="screen">
      <Header title={T("Lines", "קווים")} />
      <div className="pad">
        <input className="field" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Line number, operator or city", "מספר קו, מפעיל או עיר")} dir="auto" enterKeyHint="search" inputMode="search" />
      </div>
      <div className="scroll">
        {!q.trim() && <div className="pad dim">{T("Search for a line by its number, such as 480, or by a city or operator.", "חפשו קו לפי המספר שלו, למשל 480, או לפי עיר או מפעיל.")}</div>}
        {found.loading && !found.data && <div className="pad"><Spinner text={T("Loading Moovit's line list…", "טוענים את רשימת הקווים…")} /></div>}
        {found.error && <div className="pad"><Note tone="error">{found.error}</Note></div>}
        <ul className="list">
          {found.data?.lines.map(l => (
            <li key={l.id} className="row" onClick={() => setOpen(l)}>
              <LineBadge number={l.number} type={l.routeType === 7 ? 715 : l.routeType} />
              <div className="row-main"><div dir="auto">{l.cities || l.name}</div><div className="dim small" dir="auto">{l.agency}</div></div>
            </li>
          ))}
          {found.data && found.data.total > found.data.lines.length && <li className="pad dim small">{T(`and ${found.data.total - found.data.lines.length} more: narrow the search`, `ועוד ${found.data.total - found.data.lines.length}: צמצמו את החיפוש`)}</li>}
          {found.data && !found.data.lines.length && <li className="pad dim">{T("No lines found", "לא נמצאו קווים")}</li>}
        </ul>
      </div>
    </div>
  );
}

interface Direction { lineId: number; info: LineInfo | null; stops: StopInfo[]; shape: LatLon[]; departures: number[] }
interface Detail { group: LineGroup | null; directions: Direction[]; agencyRouteType: number }
interface Alert { id: string; title: string; body: string; html: boolean; label: string }

function LineDetail({ group, onBack }: { group: LineGroup; onBack: () => void }) {
  const detail = useLoad<Detail>(`line:${group.id}`, s => api(`lines/detail?id=${group.id}`, undefined, s));
  const [dir, setDir] = useState(0);
  const [tab, setTab] = useState<"stops" | "times">("stops");
  const now = useNow(15000);
  const d = detail.data?.directions[dir];
  const type = detail.data?.agencyRouteType ?? group.routeType;
  const color = modeColor(type);
  const stopIds = useMemo(() => d?.stops.map(s => s.id).slice(0, 60) ?? [], [d]);
  const poll = useRef(20);
  const live = useLoad<{ arrivals: Arrival[]; poll: number }>(stopIds.length ? `linelive:${d!.lineId}` : null,
    s => api<{ arrivals: Arrival[]; poll: number }>(`arrivals?stops=${stopIds.join(",")}`, undefined, s).then(r => { poll.current = Math.min(Math.max(r.poll, 10), 60); return r; }),
    () => poll.current * 1000);
  const alerts = useLoad<{ alerts: Alert[] }>(`alerts:${group.id}`, s => api(`alerts?groups=${group.id}`, undefined, s));

  const mine = (live.data?.arrivals ?? []).filter(a => a.lineId === d?.lineId);
  // One mark per vehicle, at its latest report.
  const vehicles = [...new Map(mine.filter(a => a.tracked && a.lat).map(a => [String(a.tripId), a])).values()];
  // The next live arrival at each stop on this direction.
  const nextAt = new Map<number, Arrival>();
  for (const a of mine) { const p = nextAt.get(a.stopId); if (timeOf(a) >= now - 60 && (!p || timeOf(a) < timeOf(p))) nextAt.set(a.stopId, a); }
  const pts = d?.stops.filter(s => s.lat != null).map(s => [s.lat!, s.lon!] as LatLon) ?? [];

  return (
    <div className="screen">
      <Header title={`${modeName(type)} ${group.number}`} sub={group.agency} back={onBack} />
      {d && <MapView className="map-half" lines={[{ coords: d.shape.length ? d.shape : pts, color, width: 5 }]}
        points={[
          ...d.stops.filter(s => s.lat != null).map(s => ({ id: `s${s.id}`, at: [s.lat!, s.lon!] as LatLon, color: "#ffffff", kind: "stop" as const, ring: color })),
          ...vehicles.map(v => ({ id: `v${v.tripId}`, at: [v.lat, v.lon] as LatLon, color, kind: "vehicle" as const, label: group.number })),
        ]} fit={pts} fitKey={`${group.id}:${dir}`} />}
      <div className="pad stack">
        {detail.loading && <Spinner text={T("Asking Moovit…", "שואלים את Moovit…")} />}
        {detail.error && <Note tone="error">{detail.error}</Note>}
        {detail.data && !detail.data.directions.length && <Note>{T("This line has no trips this week.", "לקו הזה אין נסיעות השבוע.")}</Note>}
        {(detail.data?.directions.length ?? 0) > 1 && (
          <div className="segmented wrap">
            {detail.data!.directions.map((x, k) => (
              <button key={x.lineId} className={k === dir ? "on" : ""} onClick={() => setDir(k)} dir="auto">
                {T("to", "ל")}{x.info?.destination || x.stops[x.stops.length - 1]?.name || `#${k + 1}`}
              </button>
            ))}
          </div>
        )}
        {d && <div className="segmented">
          <button className={tab === "stops" ? "on" : ""} onClick={() => setTab("stops")}>{T("Stops", "תחנות")} ({d.stops.length})</button>
          <button className={tab === "times" ? "on" : ""} onClick={() => setTab("times")}>{T("Departures", "יציאות")}</button>
        </div>}
        {d && vehicles.length > 0 && <div className="dim small"><LiveDot /> {T(`${vehicles.length} on the road`, `${vehicles.length} בדרך עכשיו`)}</div>}
      </div>
      <div className="scroll">
        {!!alerts.data?.alerts.length && <div className="pad stack">{alerts.data.alerts.map(a => <AlertNote key={a.id} a={a} />)}</div>}
        {d && tab === "stops" && (
          <ol className="line-stops" style={{ borderColor: color }}>
            {d.stops.map(s => {
              const a = nextAt.get(s.id);
              return (
                <li key={s.id}>
                  <span className="stop-dot" style={{ borderColor: color }} />
                  <div className="row-main"><div dir="auto">{s.name}</div>{s.code && <div className="dim small">{s.code}</div>}</div>
                  {a && <span className={"dep" + (isLive(a) ? " live" : "")}>{isLive(a) && <LiveDot />}{minutesText(Math.round((timeOf(a) - now) / 60))}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {d && tab === "times" && (
          <div className="pad times">
            {d.departures.length === 0 && <span className="dim">{T("No departures listed.", "אין יציאות.")}</span>}
            {d.departures.map((t, k) => <span key={k} className={"time" + (t < now ? " past" : "")}>{clock(t)}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

// Collapsed to its title until tapped: Moovit's notices run long.
function AlertNote({ a }: { a: Alert }) {
  const [open, setOpen] = useState(false);
  return <Note tone="warn"><button className="alert-title" onClick={() => setOpen(!open)}><ChevronGlyph size={12} open={open} /><b>{a.title || a.label}</b></button>
    {open && a.body && <div className="alert-body">{a.html ? stripHtml(a.body) : a.body}</div>}</Note>;
}

function stripHtml(html: string) {
  // DOMParser builds an inert document: nothing in Moovit's HTML runs.
  return new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
}
