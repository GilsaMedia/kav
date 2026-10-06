// Stops near you or found by name, and the departure board of one: live from Moovit, then the timetable.
import { useRef, useState } from "react";
import { T, api, useHere, useLoad, useNow, clock, minutesText, distanceText, timeOf, isLive, isCancelled, modeColor, type Arrival, type Resolved } from "../core.ts";
import { Header, LineBadge, Spinner, Note, LiveDot } from "../ui.tsx";
import { MapView } from "../MapView.tsx";
import { StationMark } from "../icons.tsx";

interface Stop { i: number; name: string; city: string; code: number; lat: number; lon: number; type: number; metres?: number }

export function StationsScreen() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Stop | null>(null);
  const here = useHere();
  const near = useLoad<{ stops: Stop[] }>(here && !q.trim() ? `near:${here[0].toFixed(3)},${here[1].toFixed(3)}` : null,
    s => api(`stations/near?lat=${here![0]}&lon=${here![1]}`, undefined, s));
  const found = useLoad<{ stops: Stop[] }>(q.trim().length >= 2 ? `q:${q.trim()}` : null,
    s => new Promise(r => setTimeout(r, 200)).then(() => api(`stations/search?q=${encodeURIComponent(q.trim())}${here ? `&lat=${here[0]}&lon=${here[1]}` : ""}`, undefined, s)));

  if (open) return <Board stop={open} onBack={() => setOpen(null)} />;
  const list = q.trim() ? found.data?.stops : near.data?.stops;
  return (
    <div className="screen">
      <Header title={T("Stations", "תחנות")} />
      <div className="pad">
        <input className="field" value={q} onChange={e => setQ(e.target.value)} placeholder={T("Stop name or code", "שם תחנה או מספר")} dir="auto" enterKeyHint="search" />
      </div>
      <div className="scroll">
        {!q.trim() && !here && <div className="pad"><Note>{T("Allow location to see the stops around you, or search for one.", "אפשרו מיקום כדי לראות את התחנות סביבכם, או חפשו תחנה.")}</Note></div>}
        {!q.trim() && here && <div className="list-head">{T("Near you", "בסביבה")}</div>}
        {(near.loading || found.loading) && !list && <div className="pad"><Spinner /></div>}
        <ul className="list">
          {list?.map(s => (
            <li key={s.i} className="row" onClick={() => setOpen(s)}>
              <span className="row-icon"><StationMark type={s.type} /></span>
              <div className="row-main"><div dir="auto">{s.name}</div><div className="dim">{s.city}{s.code > 0 ? ` · ${s.code}` : ""}</div></div>
              {s.metres != null && <span className="dim small">{distanceText(s.metres)}</span>}
            </li>
          ))}
          {list && !list.length && <li className="pad dim">{T("No stops found", "לא נמצאו תחנות")}</li>}
        </ul>
      </div>
    </div>
  );
}

interface BoardData { stop: Stop; timetable: { route: number; short: string; long: string; type: number; agency: string; to: string; inSecs: number }[] }
interface LiveData { moovitId: number | null; arrivals: Arrival[]; poll: number; resolved?: Resolved }

function Board({ stop, onBack }: { stop: Stop; onBack: () => void }) {
  const now = useNow(10000);
  const board = useLoad<BoardData>(`board:${stop.i}`, s => api(`stations/board?i=${stop.i}`, undefined, s), 60000);
  const poll = useRef(20);
  const live = useLoad<LiveData>(`live:${stop.i}`, s => api<LiveData>(`stations/live?i=${stop.i}`, undefined, s)
    .then(r => { poll.current = Math.min(Math.max(r.poll, 10), 60); return r; }), () => poll.current * 1000);
  const [tab, setTab] = useState<"live" | "timetable">("live");
  const r = live.data?.resolved;
  const arrivals = (live.data?.arrivals ?? []).filter(a => timeOf(a) >= now - 60).sort((a, b) => timeOf(a) - timeOf(b));

  return (
    <div className="screen">
      <Header title={stop.name} sub={`${stop.city}${stop.code > 0 ? ` · ${T("stop", "תחנה")} ${stop.code}` : ""}`} back={onBack} />
      <MapView className="map-small" center={[stop.lat, stop.lon]} zoom={16}
        points={[{ id: "s", at: [stop.lat, stop.lon], color: modeColor(stop.type), kind: "place", size: 9 },
          ...arrivals.filter(a => a.tracked && a.lat).map(a => ({ id: `v${a.tripId}`, at: [a.lat, a.lon] as [number, number], color: modeColor(r?.routeTypes[r?.lines[a.lineId]?.agencyId ?? -1] ?? 3), kind: "vehicle" as const, label: r?.lines[a.lineId]?.number ?? "" }))]} />
      <div className="pad">
        <div className="segmented">
          <button className={tab === "live" ? "on" : ""} onClick={() => setTab("live")}>{T("Live", "בזמן אמת")}</button>
          <button className={tab === "timetable" ? "on" : ""} onClick={() => setTab("timetable")}>{T("Timetable", "לוח זמנים")}</button>
        </div>
      </div>
      <div className="scroll">
        {tab === "live" && (
          <ul className="list">
            {live.loading && !live.data && <li className="pad"><Spinner text={T("Asking Moovit…", "שואלים את Moovit…")} /></li>}
            {live.error && <li className="pad"><Note tone="warn">{live.error}</Note></li>}
            {live.data && live.data.moovitId == null && <li className="pad"><Note>{T("Moovit doesn't know this stop. See the timetable.", "התחנה הזו לא מוכרת ל-Moovit. ראו את לוח הזמנים.")}</Note></li>}
            {live.data?.moovitId != null && !arrivals.length && <li className="pad dim">{T("Nothing in the next hour or so.", "אין יציאות בשעה הקרובה.")}</li>}
            {arrivals.slice(0, 40).map(a => {
              const line = r?.lines[a.lineId];
              const type = line ? r?.routeTypes[line.agencyId] ?? 3 : 3;
              const mins = Math.round((timeOf(a) - now) / 60);
              return (
                <li key={`${a.tripId}`} className="row">
                  <LineBadge number={line?.number ?? "…"} type={type} />
                  <div className="row-main"><div dir="auto">{line?.destination || line?.caption || ""}</div>
                    {a.platform && <div className="dim small">{T("Platform", "רציף")} {a.platform}</div>}</div>
                  <span className={"dep" + (isLive(a) ? " live" : "") + (isCancelled(a) ? " cancelled" : "")}>
                    {isLive(a) && <LiveDot />}{isCancelled(a) ? T("cancelled", "בוטל") : mins <= 30 ? minutesText(mins) : clock(timeOf(a))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {tab === "timetable" && (
          <ul className="list">
            {board.loading && !board.data && <li className="pad"><Spinner /></li>}
            {board.error && <li className="pad"><Note tone="error">{board.error}</Note></li>}
            {board.data?.timetable.map((d, k) => {
              const t = Math.floor(Date.now() / 1000) + d.inSecs;
              const mins = Math.round(d.inSecs / 60);
              return (
                <li key={k} className="row">
                  <LineBadge number={d.short} type={d.type} />
                  <div className="row-main"><div dir="auto">{d.to}</div><div className="dim small">{d.agency}</div></div>
                  <span className="dep">{mins <= 30 ? minutesText(mins) : clock(t)}</span>
                </li>
              );
            })}
            {board.data && !board.data.timetable.length && <li className="pad dim">{T("No more departures today.", "אין עוד יציאות היום.")}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
