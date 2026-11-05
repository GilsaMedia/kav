// Every line Moovit knows, as Moovit's Lines tab lists them: the lines with alerts, the ones you saved, all of them
// by operator, and each mode's. The page of one line: its route on the map, its stops on a rail with when the line
// is next at each, its departures, its delays and its alerts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { T, api, useLoad, useNow, useHere, usePrefs, getPrefs, setPrefs, moved, clock, metres, distanceText, timeOf, isLive, modeColor, modeName, MODE_FILTERS, streetViewUrl,
  type Arrival, type LatLon, type StopInfo, type LineInfo, type SavedLine } from "../core.ts";
import { Header, SearchField, LineBadge, Spinner, Note, LiveDot, Eta, NextTimes, goBack, lineColour } from "../ui.tsx";
import { MapView } from "../MapView.tsx";
import { StarGlyph, ClockGlyph, BackGlyph, LiveGlyph } from "../icons.tsx";
import { DelayNote, DelayStats } from "../delays.tsx";
import { useReorder, GripGlyph } from "../reorder.tsx";
import { useAllStatuses, StatusMark, LineAlerts, statusText, isSerious, type LineStatus, type Statuses } from "../status.tsx";
import { Board, type Stop } from "./Stations.tsx";

type LineGroup = SavedLine;

const isSaved = (l: LineGroup) => getPrefs().savedLines.some(x => x.id === l.id);
function toggleSaved(l: LineGroup) {
  const saved = getPrefs().savedLines;
  setPrefs({ savedLines: saved.some(x => x.id === l.id) ? saved.filter(x => x.id !== l.id) : [...saved, l] });
}

// The star that saves a line to the ★ tab; wide: Moovit's Favorite button along the bottom of a line.
function SaveLine({ line, wide }: { line: LineGroup; wide?: boolean }) {
  usePrefs();
  const on = isSaved(line);
  const label = on ? T("Remove from saved lines", "הסרה מהקווים השמורים") : T("Save this line", "שמירת הקו");
  if (wide) return <button className={"setup-btn star-btn grow" + (on ? " on" : "")} onClick={() => toggleSaved(line)} aria-label={label}>
    <StarGlyph size={20} filled={on} />{on ? T("Saved", "שמור") : T("Favorite", "מועדף")}</button>;
  return <button className={"plate-btn star-btn" + (on ? " on" : "")} onClick={e => { e.stopPropagation(); toggleSaved(line); }} aria-label={label}><StarGlyph size={22} filled={on} /></button>;
}

// Moovit names a line by its ends: "מסוף הטייסים-תל אביב יפו<->בית העלמין/קרית שאול-תל אביב יפו-20". Without the
// towns and the number at the end: "מסוף הטייסים ↔ בית העלמין/קרית שאול". It tells apart two lines 3 in one town.
function endsOf(l: LineGroup): string {
  const parts = l.name.split("<->");
  if (parts.length !== 2) return "";
  const [a, b] = [parts[0], parts[1].replace(/-\d+$/, "")].map(p => { const k = p.lastIndexOf("-"); return (k > 0 ? p.slice(0, k) : p).trim(); });
  return a && b ? `${a} ↔ ${b}` : "";
}
const badgeType = (l: LineGroup) => l.routeType === 7 ? 715 : l.routeType;

// One row as Moovit lists a line: its plate, its towns, and the yellow (i) when it has an alert. On the Alerts tab, the
// kind of alert under the towns.
function LineRow({ l, st, onOpen, grip, why }: { l: LineGroup; st?: LineStatus; onOpen: () => void; grip?: React.HTMLAttributes<HTMLButtonElement>; why?: boolean }) {
  return (
    <li className="row line-row" data-row onClick={onOpen}>
      <LineBadge number={l.number} type={badgeType(l)} agency={l.agency} />
      <div className="row-main">
        <div dir="auto" className="line-title">{l.cities || endsOf(l) || l.name}</div>
        {why && st && <div className={"small line-status" + (isSerious(st) ? " serious" : "")} dir="auto">{statusText(st)}</div>}
      </div>
      {grip ? <button {...grip}><GripGlyph /></button> : st && <StatusMark st={st} size={26} />}
    </li>
  );
}

// Opened last first, a few of them, for Recent.
function rememberLine(l: LineGroup) {
  setPrefs({ recentLines: [l, ...(getPrefs().recentLines ?? []).filter(x => x.id !== l.id)].slice(0, 5) });
}

// Moovit's order of the mode tabs: Bus, Light rail, then the trains (Israel Railways) and the rest.
const MODE_TABS = [0, 2, 1, 3, 4].map(k => ({ k, ...MODE_FILTERS[k], label: k === 1 ? () => T("Israel Railways", "רכבת ישראל") : MODE_FILTERS[k].label }));

// "Saved", "All" and each mode the catalogue has; Alerts first, as Moovit has them.
type Tab = "alerts" | "saved" | "all" | number;
const PAGE = 120;

export function LinesScreen({ head }: { head?: ReactNode }) {
  const prefs = usePrefs();
  const here = useHere();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LineGroup | null>(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>(() => getPrefs().savedLines.length ? "saved" : "all");
  const [shown, setShown] = useState(PAGE);
  const { list, grip } = useReorder((from, to) => setPrefs({ savedLines: moved(getPrefs().savedLines, from, to) }));
  // Asked once with where you are then, so the operators around you come first; not again with every fix.
  const near = useRef<LatLon | null>(null);
  if (!near.current && here) near.current = here;
  const where = near.current ? `${near.current[0].toFixed(2)},${near.current[1].toFixed(2)}` : "";
  const all = useLoad<{ lines: LineGroup[] }>(`lines:all:${where}`, s => api(`lines/all${near.current ? `?lat=${near.current[0]}&lon=${near.current[1]}` : ""}`, undefined, s), undefined, true);
  const statuses = useAllStatuses();
  const status: Statuses = statuses.data?.status ?? {};
  const found = useLoad<{ lines: LineGroup[]; total: number }>(q.trim() ? `lines:${q.trim()}` : null,
    s => new Promise(r => setTimeout(r, 200)).then(() => api(`lines/search?q=${encodeURIComponent(q.trim())}`, undefined, s)));
  useEffect(() => { setShown(PAGE); }, [tab, q]);
  // More rows as the end of the list comes into view: thousands of lines at once would be slow to draw.
  const more = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setShown(n => n + PAGE); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  });

  const lines = all.data?.lines ?? [];
  const modes = useMemo(() => MODE_TABS.filter(f => lines.some(l => f.types.includes(l.routeType))), [lines]);
  if (open) return <LineDetail group={open} onBack={() => setOpen(null)} />;
  const openLine = (l: LineGroup) => { rememberLine(l); setOpen(l); };

  const saved = prefs.savedLines;
  const inTab = (l: LineGroup) => tab === "all" ? true : tab === "alerts" ? !!status[l.id] : tab === "saved" ? saved.some(x => x.id === l.id)
    : MODE_FILTERS[tab].types.includes(l.routeType);
  const searching = !!q.trim();
  const rows = searching ? (found.data?.lines ?? []).filter(inTab) : tab === "saved" ? saved : lines.filter(inTab);
  // By operator, as Moovit lists them: a heading wherever the operator (or its mode) changes.
  const grouped = !searching && tab !== "saved";
  // Recent, over All and each mode's tab: the lines you opened last (of that mode).
  const recent = !searching && (tab === "all" || typeof tab === "number") ? (prefs.recentLines ?? []).filter(inTab) : [];

  return (
    <div className="screen">
      {head ?? <Header title={T("Lines", "קווים")} />}
      <div className="pad">
        <SearchField value={q} onChange={setQ} placeholder={T("Search for a line", "חיפוש קו")} inputMode="search" icon />
      </div>
      <div className="line-tabs scroll-x" role="tablist">
        <button role="tab" className={tab === "alerts" ? "on" : ""} onClick={() => setTab("alerts")}>{T("Alerts", "התראות")}</button>
        <button role="tab" className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")} aria-label={T("Saved lines", "קווים שמורים")}><StarGlyph size={20} filled /></button>
        <button role="tab" className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>{T("All", "הכל")}</button>
        {modes.map(f => <button role="tab" key={f.k} className={tab === f.k ? "on" : ""} onClick={() => setTab(f.k)}>{f.label()}</button>)}
      </div>
      <div className="scroll">
        {tab === "saved" && !searching && saved.length > 1 && <div className="list-head saved-head"><span>{T("Saved lines", "קווים שמורים")}</span>
          <button className="link" onClick={() => setEditing(!editing)}>{editing ? T("Done", "סיום") : T("Edit", "עריכה")}</button></div>}
        {tab === "saved" && !searching && !saved.length && <div className="pad dim">{T("Open a line and tap the star to keep it here.", "פתחו קו והקישו על הכוכב כדי לשמור אותו כאן.")}</div>}
        {tab === "alerts" && !searching && statuses.loading && !statuses.data && <div className="pad"><Spinner text={T("Asking Moovit about every line…", "שואלים את Moovit על כל הקווים…")} /></div>}
        {tab === "alerts" && !searching && statuses.data && !rows.length && <div className="pad dim">{T("No line has an alert right now.", "אין כרגע התראות על אף קו.")}</div>}
        {statuses.error && tab === "alerts" && <div className="pad"><Note tone="warn">{statuses.error}</Note></div>}
        {(searching ? found.loading && !found.data : all.loading && !all.data && tab !== "saved") && <div className="pad"><Spinner text={T("Loading Moovit's line list…", "טוענים את רשימת הקווים…")} /></div>}
        {(searching ? found.error : tab !== "saved" && all.error) && <div className="pad"><Note tone="error">{searching ? found.error : all.error}</Note></div>}
        {recent.length > 0 && <>
          <div className="list-head line-group"><span>{T("Recent", "אחרונים")}</span>
            <button className="link" onClick={() => setPrefs({ recentLines: [] })}>{T("Clear", "ניקוי")}</button></div>
          <ul className="list">{recent.map(l => <LineRow key={l.id} l={l} st={status[l.id]} onOpen={() => openLine(l)} />)}</ul>
        </>}
        <ul className="list" ref={tab === "saved" && !searching ? list : undefined}>
          {rows.slice(0, shown).flatMap((l, i) => {
            const prev = rows[i - 1];
            const heading = grouped && (!prev || prev.agency !== l.agency || prev.routeType !== l.routeType);
            return [
              heading && <li key={`h${l.agencyId}:${l.routeType}:${i}`} className="list-head line-group"><span dir="auto">{l.agency}</span><span>{modeName(l.routeType)}</span></li>,
              <LineRow key={l.id} l={l} st={status[l.id]} why={tab === "alerts"} onOpen={() => { if (!editing || tab !== "saved") openLine(l); }}
                grip={editing && tab === "saved" && !searching ? grip(i) : undefined} />,
            ];
          })}
          {rows.length > shown && <li ref={more} className="pad"><Spinner /></li>}
          {searching && found.data && found.data.total > found.data.lines.length && <li className="pad dim small">{T(`and ${found.data.total - found.data.lines.length} more: narrow the search`, `ועוד ${found.data.total - found.data.lines.length}: צמצמו את החיפוש`)}</li>}
          {searching && found.data && !rows.length && <li className="pad dim">{T("No lines found", "לא נמצאו קווים")}</li>}
        </ul>
      </div>
    </div>
  );
}

interface Direction { lineId: number; info: LineInfo | null; stops: StopInfo[]; shape: LatLon[]; departures: number[] }
interface Detail { group: LineGroup | null; directions: Direction[]; agencyRouteType: number }

// Opened from a stop's board: at (that stop) and lineId (the direction that stops there) open the page on that
// direction with that stop as yours.
export function LineDetail({ group, onBack, at, lineId }: { group: LineGroup; onBack: () => void; at?: number; lineId?: number }) {
  const detail = useLoad<Detail>(`line:${group.id}`, s => api(`lines/detail?id=${group.id}`, undefined, s));
  const [dir, setDir] = useState(0);
  const [placed, setPlaced] = useState(false);
  if (!placed && detail.data && at != null) {
    const ds = detail.data.directions;
    let k = ds.findIndex(x => x.lineId === lineId);
    if (k < 0) k = ds.findIndex(x => x.stops.some(s => s.id === at));
    setPlaced(true);
    if (k > 0) setDir(k);
  }
  const [tab, setTab] = useState<"stops" | "times" | "delays">("stops");
  // The stop opened on the rail: yours until you tap another.
  const [picked, setPicked] = useState<number | null>(null);
  const [board, setBoard] = useState<Stop | null>(null);
  const [boardNote, setBoardNote] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const now = useNow(15000);
  const d = detail.data?.directions[dir];
  const type = detail.data?.agencyRouteType ?? group.routeType;
  const color = lineColour(type, group.agency);
  const stopIds = useMemo(() => d?.stops.map(s => s.id).slice(0, 60) ?? [], [d]);
  const poll = useRef(20);
  const live = useLoad<{ arrivals: Arrival[]; poll: number }>(stopIds.length ? `linelive:${d!.lineId}` : null,
    s => api<{ arrivals: Arrival[]; poll: number }>(`arrivals?stops=${stopIds.join(",")}`, undefined, s).then(r => { poll.current = Math.min(Math.max(r.poll, 10), 60); return r; }),
    () => poll.current * 1000);
  const statuses = useAllStatuses();
  const st = statuses.data?.status[group.id];
  const alertsAt = useRef<HTMLDivElement>(null);

  const mine = (live.data?.arrivals ?? []).filter(a => a.lineId === d?.lineId);
  // One mark per vehicle, at its latest report.
  const vehicles = [...new Map(mine.filter(a => a.tracked && a.lat).map(a => [String(a.tripId), a])).values()];
  // The coming arrivals at each stop on this direction, soonest first.
  const atStop = new Map<number, Arrival[]>();
  for (const a of mine) if (timeOf(a) >= now - 60) atStop.set(a.stopId, [...(atStop.get(a.stopId) ?? []), a]);
  for (const xs of atStop.values()) xs.sort((a, b) => timeOf(a) - timeOf(b));
  const pts = d?.stops.filter(s => s.lat != null).map(s => [s.lat!, s.lon!] as LatLon) ?? [];

  // The stop on this direction nearest to you (within 2 km).
  const here = useHere();
  const yours = useMemo(() => {
    const came = at != null ? d?.stops.find(s => s.id === at) : undefined;
    if (came) return { stop: came, m: here && came.lat != null && came.lon != null ? metres(here, [came.lat, came.lon]) : 0 };
    if (!here || !d) return null;
    let best: { stop: StopInfo; m: number } | null = null;
    for (const s of d.stops) {
      if (s.lat == null || s.lon == null) continue;
      const m = metres(here, [s.lat, s.lon]);
      if (!best || m < best.m) best = { stop: s, m };
    }
    return best && best.m <= 2000 ? best : null;
  }, [here?.[0], here?.[1], d]);
  const openId = picked ?? yours?.stop.id ?? null;
  const openStop = d?.stops.find(s => s.id === openId) ?? null;
  const openRow = useRef<HTMLLIElement>(null);
  // The open stop's photo, as Moovit shows one in the map's corner; it opens Street View there.
  const photo = useLoad<{ thumb: string | null }>(openId != null && openId > 0 ? `photo:${openId}` : null, sig => api(`photos?id=${openId}`, undefined, sig));
  // Like Moovit, the list opens at your stop: once per direction.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    const key = yours ? `${dir}:${yours.stop.id}` : null;
    if (!key || scrolledTo.current === key || !openRow.current) return;
    scrolledTo.current = key;
    openRow.current.scrollIntoView({ block: "center" });
  });
  const turn = () => { setDir(k => (k + 1) % (detail.data?.directions.length || 1)); setPicked(null); };

  // The stop's own page (its board), found in the timetable by its code.
  const openBoard = async (s: StopInfo) => {
    setBoardNote(null);
    try {
      const near = s.lat != null ? `&lat=${s.lat}&lon=${s.lon}` : "";
      const r = await api<{ stops: Stop[] }>(`stations/search?q=${encodeURIComponent(s.code || s.name)}${near}`);
      const hit = r.stops.find(x => s.code && String(x.code) === s.code) ?? (s.lat != null ? r.stops.find(x => metres([x.lat, x.lon], [s.lat!, s.lon!]) < 150) : undefined);
      if (hit) setBoard(hit); else setBoardNote(T("This stop isn't in the timetable.", "התחנה הזו לא נמצאת בלוח הזמנים."));
    } catch (e) { setBoardNote((e as Error).message); }
  };
  if (board) return <Board stop={board} onBack={() => setBoard(null)} />;

  const origin = d ? d.info?.origin || d.stops[0]?.name || "" : "";
  const dest = d ? d.info?.destination || d.stops[d.stops.length - 1]?.name || "" : "";
  const many = (detail.data?.directions.length ?? 0) > 1;
  // Live location: the map turns to the buses on the road, and back to the whole line.
  const vPts = vehicles.map(v => [v.lat, v.lon] as LatLon);
  const onBuses = follow && vPts.length > 0;
  return (
    <div className="screen line-page">
      {/* As Moovit heads a line: its plate and its operator, the alert mark beside them. */}
      <header className="header line-header">
        <button className="plate-btn" data-back onClick={goBack(onBack)} aria-label={T("Back", "חזרה")}><BackGlyph /></button>
        <div className="line-header-mid"><LineBadge number={group.number} type={badgeType({ ...group, routeType: type })} agency={group.agency} /><span className="dim" dir="auto">{group.agency}</span></div>
        {st ? <button className="plate-btn" onClick={() => { setTab("stops"); requestAnimationFrame(() => alertsAt.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }}
          aria-label={statusText(st)}><StatusMark st={st} size={26} /></button> : <span className="plate-space" />}
      </header>
      {d && <div className="line-map">
        <MapView className="map-half" lines={[{ coords: d.shape.length ? d.shape : pts, color, width: 5 }]}
          points={[
            ...d.stops.filter(s => s.lat != null).map(s => ({ id: `s${s.id}`, at: [s.lat!, s.lon!] as LatLon, color: s.id === openId ? color : "#ffffff", kind: "stop" as const, ring: color, size: s.id === openId ? 7 : undefined })),
            ...vehicles.map(v => ({ id: `v${v.tripId}`, at: [v.lat, v.lon] as LatLon, color, kind: "vehicle" as const, label: group.number })),
          ]} fit={onBuses ? vPts : pts} fitKey={`${group.id}:${dir}:${onBuses ? "buses" : "line"}`} />
        <button className={"live-btn" + (onBuses ? " on" : "")} onClick={() => setFollow(f => !f)} disabled={!vehicles.length}>
          <LiveGlyph size={20} />{vehicles.length ? T(`Live location · ${vehicles.length}`, `מיקום בזמן אמת · ${vehicles.length}`) : T("Live location", "מיקום בזמן אמת")}
        </button>
        {photo.data?.thumb && openStop?.lat != null && <a className="stop-photo" href={streetViewUrl(openStop.lat, openStop.lon!)} target="_blank" rel="noreferrer"
          aria-label={T("Street View", "Street View")}><img src={photo.data.thumb} alt="" /></a>}
      </div>}
      <div className="pad stack line-head">
        {detail.loading && <Spinner text={T("Asking Moovit…", "שואלים את Moovit…")} />}
        {detail.error && <Note tone="error">{detail.error}</Note>}
        {detail.data && !detail.data.directions.length && <Note>{T("This line has no trips this week.", "לקו הזה אין נסיעות השבוע.")}</Note>}
        {/* Where it goes: from → to, and the other way with Change direction under it. */}
        {d && <div className="line-dir">
          <div className="line-dir-text"><bdi>{origin}</bdi><span className="dir-arrow">{T("→", "←")}</span><bdi>{dest}</bdi></div>
          {many && <button className="link" onClick={turn}>{T("Change direction", "החלפת כיוון")}{detail.data!.directions.length > 2 && <span className="dim"> ({dir + 1}/{detail.data!.directions.length})</span>}</button>}
        </div>}
        {d && tab !== "stops" && <div className="line-sub">
          <button className="link" onClick={() => setTab("stops")}><BackGlyph size={14} />{T("Stops", "תחנות")}</button>
          <b>{tab === "times" ? T("Full schedule", "לוח זמנים מלא") : T("Delays", "איחורים")}</b>
        </div>}
      </div>
      <div className="scroll line-scroll">
        {st && tab === "stops" && <div className="pad" ref={alertsAt}><LineAlerts group={group.id} /></div>}
        {boardNote && <div className="pad"><Note tone="warn">{boardNote}</Note></div>}
        {d && tab === "stops" && (
          <ol className="line-rail" style={{ "--c": color } as React.CSSProperties}>
            {d.stops.map((s, k) => {
              const coming = atStop.get(s.id) ?? [];
              const a = coming[0];
              const isOpen = s.id === openId;
              const isYours = yours?.stop.id === s.id;
              return (
                <li key={s.id} ref={isOpen ? openRow : undefined} className={(isOpen ? "on" : "") + (k === 0 ? " first" : "") + (k === d.stops.length - 1 ? " last" : "")}
                  onClick={() => setPicked(isOpen ? -1 : s.id)}>
                  <span className="rail-dot" />
                  <div className="row-main">
                    <div className="rail-name" dir="auto">{s.name}</div>
                    {/* The stop that's open, as Moovit opens one: when the line is next here, and what you can do from it. */}
                    {isOpen && <div className="stop-open" onClick={e => e.stopPropagation()}>
                      <div className="stop-when">
                        {a ? <><span className="time-pill"><ClockGlyph size={16} /><Eta d={a} now={now} inline /></span><span className="dim">{clock(timeOf(a))}</span></>
                          : <span className="dim">{live.loading && !live.data ? T("Asking Moovit…", "שואלים את Moovit…") : T("Nothing on its way here in the next while.", "אין נסיעה בדרך לכאן בזמן הקרוב.")}</span>}
                      </div>
                      <div className="dim small">
                        {a && (isLive(a) ? <><LiveDot /> {T("Live", "בזמן אמת")}</> : T("By the timetable", "לפי לוח הזמנים"))}
                        {isYours && <>{a ? " · " : ""}{T("Your stop", "התחנה שלך")}{here && yours ? ` · ${distanceText(yours.m)}` : ""}</>}
                        {s.code && <> · {T("stop", "תחנה")} {s.code}</>}
                      </div>
                      {coming.length > 1 && <div className="dim small">{T("then ", "אחר כך ")}<NextTimes ds={coming.slice(1, 3)} now={now} /></div>}
                      <DelayNote lineId={d.lineId} stopId={s.id} />
                      <div className="stop-acts">
                        <button className="link" onClick={() => openBoard(s)}>{T("Stop details", "פרטי התחנה")}</button>
                        <button className="link" onClick={() => setTab("times")}>{T("Full schedule", "לוח זמנים מלא")}</button>
                        <button className="link" onClick={() => setTab("delays")}>{T("Delays", "איחורים")}</button>
                      </div>
                    </div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {d && tab === "delays" && <div className="pad stack">
          {openStop && <DelayStats lineId={d.lineId} stopId={openStop.id} stopName={openStop.name} />}
          <DelayStats lineId={d.lineId} />
        </div>}
        {d && tab === "times" && (
          <div className="pad times">
            {d.departures.length === 0 && <span className="dim">{T("No departures listed.", "אין יציאות.")}</span>}
            {d.departures.map((t, k) => <span key={k} className={"time" + (t < now ? " past" : "")}>{clock(t)}</span>)}
          </div>
        )}
      </div>
      {/* Moovit's buttons along the bottom of a line. */}
      {d && <div className="line-cta">
        <button className={"setup-btn" + (onBuses ? " on" : "")} onClick={() => setFollow(f => !f)} disabled={!vehicles.length} aria-label={T("Live location", "מיקום בזמן אמת")}><LiveGlyph size={20} /></button>
        <button className={"setup-btn" + (tab === "delays" ? " on" : "")} onClick={() => setTab(tab === "delays" ? "stops" : "delays")}><ClockGlyph size={18} />{T("Delays", "איחורים")}</button>
        <SaveLine line={group} wide />
      </div>}
    </div>
  );
}
