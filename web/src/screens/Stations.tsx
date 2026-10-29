// The stops you saved, stops near you or found by name, and the departure board of one: live from Moovit, then
// the timetable.
import { useRef, useState, type ReactNode } from "react";
import { T, api, useHere, useLoad, useNow, usePrefs, getPrefs, setPrefs, moved, askPlan, streetViewUrl, clock, distanceText, metres, timeOf, modeColor, type Arrival, type Resolved, type SavedStop, type SavedLine, agencyOf } from "../core.ts";
import { Header, SearchField, LineBadge, Spinner, Note, Eta, NextTimes } from "../ui.tsx";
import { MapView } from "../MapView.tsx";
import { StationMark, StarGlyph, PinGlyph, FlagGlyph } from "../icons.tsx";
import { LineDetail } from "./Lines.tsx";
import { useReorder, GripGlyph } from "../reorder.tsx";

interface Stop extends SavedStop { metres?: number }

const isSaved = (s: Stop) => getPrefs().savedStops.some(x => x.i === s.i);
function toggleSaved({ metres: _, ...s }: Stop) {
  const saved = getPrefs().savedStops;
  setPrefs({ savedStops: saved.some(x => x.i === s.i) ? saved.filter(x => x.i !== s.i) : [...saved, s] });
}

function SaveStop({ stop }: { stop: Stop }) {
  usePrefs();
  const on = isSaved(stop);
  return <button className={"plate-btn star-btn" + (on ? " on" : "")} onClick={() => toggleSaved(stop)}
    aria-label={on ? T("Remove from saved stops", "הסרה מהתחנות השמורות") : T("Save this stop", "שמירת התחנה")}><StarGlyph size={22} filled={on} /></button>;
}

export function StationsScreen({ head }: { head?: ReactNode }) {
  const prefs = usePrefs();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Stop | null>(null);
  const [editing, setEditing] = useState(false);
  const { list: savedList, grip } = useReorder((from, to) => setPrefs({ savedStops: moved(getPrefs().savedStops, from, to) }));
  const here = useHere();
  const near = useLoad<{ stops: Stop[] }>(here && !q.trim() ? `near:${here[0].toFixed(3)},${here[1].toFixed(3)}` : null,
    s => api(`stations/near?lat=${here![0]}&lon=${here![1]}`, undefined, s));
  const found = useLoad<{ stops: Stop[] }>(q.trim().length >= 2 ? `q:${q.trim()}` : null,
    s => new Promise(r => setTimeout(r, 200)).then(() => api(`stations/search?q=${encodeURIComponent(q.trim())}${here ? `&lat=${here[0]}&lon=${here[1]}` : ""}`, undefined, s)));

  if (open) return <Board stop={open} onBack={() => setOpen(null)} />;
  const list = q.trim() ? found.data?.stops : near.data?.stops;
  const saved = prefs.savedStops;
  return (
    <div className="screen">
      {head ?? <Header title={T("Stations", "תחנות")} />}
      <div className="pad">
        <SearchField value={q} onChange={setQ} placeholder={T("Stop name or code", "שם תחנה או מספר")} />
      </div>
      <div className="scroll">
        {!q.trim() && saved.length > 0 && <>
          <div className="list-head saved-head"><span>{T("Saved stops", "תחנות שמורות")}</span>
            {saved.length > 1 && <button className="link" onClick={() => setEditing(!editing)}>{editing ? T("Done", "סיום") : T("Edit", "עריכה")}</button>}</div>
          <ul className="list" ref={savedList}>
            {saved.map((s, i) => (
              <li key={s.i} className="row" data-row onClick={() => { if (!editing) setOpen(s); }}>
                <span className="row-icon lit"><StationMark type={s.type} /></span>
                <div className="row-main"><div dir="auto">{s.name}</div><div className="dim">{s.city}{s.code > 0 ? ` · ${s.code}` : ""}</div></div>
                {editing ? <button {...grip(i)}><GripGlyph /></button> : here && <span className="dim small">{distanceText(metres(here, [s.lat, s.lon]))}</span>}
              </li>
            ))}
          </ul>
        </>}
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

// Arrivals in time order, gathered per line: each group starts with its next one.
function groupByLine(arrivals: Arrival[]): Arrival[][] {
  const groups = new Map<number, Arrival[]>();
  for (const a of arrivals) { const g = groups.get(a.lineId); if (g) g.push(a); else groups.set(a.lineId, [a]); }
  return [...groups.values()];
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
  // A line tapped on the board, opened at this stop.
  const [line, setLine] = useState<{ lineId: number; group: SavedLine } | null>(null);
  const r = live.data?.resolved;
  const arrivals = (live.data?.arrivals ?? []).filter(a => timeOf(a) >= now - 60).sort((a, b) => timeOf(a) - timeOf(b));

  if (line) return <LineDetail group={line.group} lineId={line.lineId} at={live.data?.moovitId ?? undefined} onBack={() => setLine(null)} />;
  const place = { name: stop.name, detail: stop.city, lat: stop.lat, lon: stop.lon, type: 1 };
  const openLine = (lineId: number) => {
    const l = r?.lines[lineId];
    if (!l?.groupId) return;
    setLine({ lineId, group: { id: l.groupId, number: l.number, name: l.caption, cities: l.destination, agencyId: l.agencyId, agency: r!.agencies[l.agencyId] ?? "",
      routeType: r!.routeTypes[l.agencyId] ?? 3 } });
  };
  return (
    <div className="screen">
      <Header title={stop.name} sub={`${stop.city}${stop.code > 0 ? ` · ${T("stop", "תחנה")} ${stop.code}` : ""}`} back={onBack} right={<SaveStop stop={stop} />} />
      <MapView className="map-small" center={[stop.lat, stop.lon]} zoom={16}
        points={[{ id: "s", at: [stop.lat, stop.lon], color: modeColor(stop.type), kind: "place", size: 9 },
          ...arrivals.filter(a => a.tracked && a.lat).map(a => ({ id: `v${a.tripId}`, at: [a.lat, a.lon] as [number, number], color: modeColor(r?.routeTypes[r?.lines[a.lineId]?.agencyId ?? -1] ?? 3), kind: "vehicle" as const, label: r?.lines[a.lineId]?.number ?? "" }))]} />
      {/* Planning from or to the stop, and a look at it in Street View. */}
      <div className="pad stop-actions">
        <button className="chip" onClick={() => askPlan({ from: place })}><PinGlyph size={15} />{T("From here", "יציאה מכאן")}</button>
        <button className="chip" onClick={() => askPlan({ to: place })}><FlagGlyph size={15} />{T("To here", "הגעה לכאן")}</button>
        <a className="chip" href={streetViewUrl(stop.lat, stop.lon)} target="_blank" rel="noreferrer">{T("Street View", "Street View")}</a>
      </div>
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
            {/* As Moovit lists a stop: one row per line, its next one large and the two after it small. */}
            {groupByLine(arrivals).slice(0, 30).map(([a, ...more]) => {
              const line = r?.lines[a.lineId];
              const type = line ? r?.routeTypes[line.agencyId] ?? 3 : 3;
              return (
                <li key={`${a.lineId}`} className="row dep-row" onClick={() => openLine(a.lineId)}>
                  <LineBadge number={line?.number ?? "…"} type={type} agency={agencyOf(r, a.lineId)} />
                  <div className="row-main"><div className="dest" dir="auto">{line?.destination || line?.caption || ""}</div>
                    <div className="dim small">{a.platform ? `${T("Platform", "רציף")} ${a.platform}` : ""}{more.length > 0 && <>{a.platform ? " · " : ""}{T("then ", "אחר כך ")}<NextTimes ds={more.slice(0, 2)} now={now} /></>}</div></div>
                  <Eta d={a} now={now} />
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
                  <LineBadge number={d.short} type={d.type} agency={d.agency} />
                  <div className="row-main"><div dir="auto">{d.to}</div><div className="dim small">{d.agency}</div></div>
                  <span className="eta scheduled">{mins <= 0 ? <b>{T("now", "עכשיו")}</b> : mins < 60 ? <><b>{mins}</b><small>{T("min", "דק׳")}</small></> : <b>{clock(t)}</b>}</span>
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
