// Planning a trip: where from and to, the ways there, one of them in detail, and walking through it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  T, api, usePrefs, getPrefs, setPrefs, rememberTrip, boardingOf, useHere, useLoad, useNow, clock, minutesText, distanceText, metres, shekels, failure,
  timeOf, isLive, isCancelled, distinctDeps, routeTypeOf, options, modeColor, modeName, MODE_FILTERS, mergeResolved, emptyResolved,
  type Place, type Itinerary, type Leg, type Resolved, type Arrival, type LatLon, type Departure,
} from "../core.ts";
import { Header, LineBadge, Spinner, Note, LiveDot, PlacePicker, SaveFavourite, HERE_NAME, Sheet, Eta, NextTimes, isLate, goBack, stayPut, liveWhy } from "../ui.tsx";
import { MapView, type MapLine, type MapPoint } from "../MapView.tsx";
import { Home, Arrives, type Opened } from "./Home.tsx";
import { DragSheet } from "../sheet.tsx";
import { WhenButton, WhenSheet, type When } from "../when.tsx";
import { DelayNote } from "../delays.tsx";
import { canNotify, useJobs, addReminder, removeReminder, rodeLines } from "../remind.ts";
import { isNative, keepAwake, showTrip, endTrip, buzz, type TripLive } from "../native.ts";
import { SwapGlyph, StarGlyph, CloseGlyph, RecentGlyph, WalkGlyph, BikeGlyph, TaxiGlyph, DotGlyph, ShareGlyph, PlayGlyph, ChevronGlyph, BackGlyph, PayGlyph, LocateGlyph, PinGlyph, StationMark, BellGlyph, FlagGlyph, modeOf } from "../icons.tsx";


interface PlanResult { itineraries: Itinerary[]; resolved: Resolved; refusal?: { code: number; title: string; detail: string } }

export function PlanScreen({ home, onPay }: { home: number; onPay: (at?: LatLon, routeType?: number) => void }) {
  const prefs = usePrefs();
  const here = useHere();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | "fav" | null>(null);
  const [when, setWhen] = useState<When>({ kind: "now" });
  const [timeSheet, setTimeSheet] = useState(false);
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState<Place | null>(null);
  // A way opened straight from a card on the home screen.
  const [opened, setOpened] = useState<Opened | null>(null);

  // Back to the home screen, from wherever in Directions you are.
  useEffect(() => {
    if (!home) return;
    stayPut();
    setPicking(null); setTimeSheet(false); setOpened(null); setChosen(null); setTo(null); setFrom(null); setSearchKey(null);
  }, [home]);

  const fromAt = (): LatLon | null => from ? [from.lat, from.lon] : here;
  const plan = useLoad<PlanResult>(searchKey, signal => {
    const f = fromAt();
    if (!f || !to) throw new Error(T("Waiting for your location…", "ממתינים למיקום שלכם…"));
    const types = prefs.modes.length ? prefs.modes : undefined;
    return api("plan", {
      from: f, to: [to.lat, to.lon], routeTypes: types,
      when: when.kind === "depart" || when.kind === "arrive" ? when.ms : 0, timeType: when.kind === "arrive" ? 1 : when.kind === "last" ? 3 : 2,
    }, signal);
  });

  // A new search whenever the ends, the time or the modes change.
  useEffect(() => {
    if (!to || (!from && !here)) return;
    setChosen(null);
    rememberTrip(from, to);
    setSearchKey(JSON.stringify([from?.lat, from?.lon, !from ? "here" : "", to.lat, to.lon, when, prefs.modes, Date.now()]));
    // `here` is read once when the search starts, not on every fix.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, when, prefs.modes, !!here]);

  // Moovit sometimes lists the same way twice, once per section.
  const its = useMemo(() => {
    const seen = new Set<string>();
    return (plan.data?.itineraries ?? []).filter(it => {
      const k = `${it.dep}:${it.arr}:${it.legs.filter(l => l.kind === "ride").map(l => `${l.lineId}@${l.fromStop}`).join()}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  }, [plan.data]);

  // Without a position yet there's no "here" to swap to.
  const swap = () => { if (!from && !here) return; const f = from; setFrom(to); setTo(f ?? { name: HERE_NAME(), detail: "", lat: here![0], lon: here![1], type: -1 }); };

  if (picking) {
    return <PlacePicker title={picking === "from" ? T("From", "מאיפה") : picking === "fav" ? T("Add a favorite", "הוספת מועדף") : T("To", "לאן")} allowHere={picking !== "fav"}
      onClose={() => setPicking(null)}
      onPick={p => {
        if (picking === "fav") setSaving(p);
        else (picking === "from" ? setFrom : setTo)(p.type === -1 && picking === "from" ? null : p);
        setPicking(null);
      }} />;
  }

  if (opened) return <TripDetail trip={opened.it} resolved={opened.resolved} from={HERE_NAME()} to={opened.to.name}
    onBack={() => setOpened(null)} onPay={onPay} />;

  // No destination yet: the home screen, as Moovit opens.
  if (!to) return (
    <div className="screen">
      <Home onSearch={() => setPicking("to")} onGo={p => { setFrom(null); setTo(p); }} onOpen={o => { rememberTrip(null, o.to); setOpened(o); }} onTrip={t => { setFrom(t.from); setTo(t.to); }}
        onPay={() => onPay()} onAdd={() => setPicking("fav")} />
      {saving && <SaveFavourite place={saving} onDone={() => setSaving(null)} />}
    </div>
  );

  if (chosen != null && its[chosen] && plan.data) {
    return <TripDetail trip={its[chosen]} resolved={plan.data.resolved} from={from?.name ?? HERE_NAME()} to={to?.name ?? ""}
      onBack={() => setChosen(null)} onPay={onPay} />;
  }


  return (
    <div className="screen">
      <Header title={T("Where to?", "לאן נוסעים?")} back={() => { setTo(null); setFrom(null); setSearchKey(null); }} />
      <div className="pad stack">
        <div className="ends card">
          <button className="end" onClick={() => setPicking("from")}>
            <span className="end-dot from" /><span className="end-text" dir="auto">{from?.name ?? HERE_NAME()}</span>
          </button>
          <div className="end-sep" />
          <button className="end" onClick={() => setPicking("to")}>
            <span className="end-dot to" /><span className={"end-text" + (to ? "" : " dim")} dir="auto">{to?.name ?? T("Choose a destination", "בחרו יעד")}</span>
          </button>
          <button className="icon-btn swap" onClick={swap} aria-label={T("Swap", "החלפה")}><SwapGlyph size={20} /></button>
        </div>
        <WhenButton when={when} onClick={() => setTimeSheet(true)} />
        <div className="chips scroll-x">
          {MODE_FILTERS.map(f => {
            const on = f.types.every(t => prefs.modes.includes(t));
            return <button key={f.types.join()} className={"chip" + (on ? " on" : "")}
              onClick={() => setPrefs({ modes: on ? prefs.modes.filter(t => !f.types.includes(t)) : [...prefs.modes, ...f.types] })}>{f.label()}</button>;
          })}
        </div>
      </div>

      <div className="scroll">
        {!to && (
          <ul className="list">
            {prefs.favourites.map(f => (
              <li key={f.label + f.lat} className="row" onClick={() => setTo(f)}>
                <span className="row-icon lit"><StarGlyph size={18} filled /></span><div className="row-main"><div>{f.label}</div><div className="dim" dir="auto">{f.name}</div></div>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); setPrefs({ favourites: prefs.favourites.filter(x => x !== f) }); }} aria-label={T("Remove", "הסרה")}><CloseGlyph size={16} /></button>
              </li>
            ))}
            {prefs.recents.length > 0 && <li className="list-head">{T("Recent", "אחרונים")}</li>}
            {prefs.recents.slice(0, 8).map((p, i) => (
              <li key={i} className="row" onClick={() => setTo(p)}>
                <span className="row-icon"><RecentGlyph size={18} /></span><div className="row-main"><div dir="auto">{p.name}</div>{p.detail && <div className="dim" dir="auto">{p.detail}</div>}</div>
                <button className="icon-btn" onClick={e => { e.stopPropagation(); setSaving(p); }} aria-label={T("Save", "שמירה")}><StarGlyph size={18} /></button>
              </li>
            ))}
            {!prefs.recents.length && !prefs.favourites.length && <li className="pad dim">{T("Search for a place to get there by public transport.", "חפשו מקום כדי להגיע אליו בתחבורה ציבורית.")}</li>}
          </ul>
        )}
        {to && (
          <div className="pad stack">
            {!from && !here && <Note>{T("Waiting for your location… or choose where you start from.", "ממתינים למיקום שלכם… או בחרו נקודת מוצא.")}</Note>}
            {plan.loading && <Spinner text={T("Asking Moovit…", "שואלים את Moovit…")} />}
            {plan.error && <Note tone="error">{plan.error} <button className="link" onClick={plan.reload}>{T("Try again", "נסו שוב")}</button></Note>}
            {plan.data?.refusal && <Note tone="warn"><b>{plan.data.refusal.title}</b><br />{plan.data.refusal.detail}</Note>}
            {plan.data && !plan.loading && !its.length && !plan.data.refusal && <Note>{T("No routes found.", "לא נמצאו מסלולים.")}</Note>}
            {its.map((it, i) => (
              <div key={it.guid + i} className="it-wrap">
                {it.section && it.section !== its[i - 1]?.section && <div className="list-head">{it.section}</div>}
                <ItineraryCard it={it} resolved={plan.data!.resolved} onClick={() => setChosen(i)} />
              </div>
            ))}
            {to && <button className="link center" onClick={() => setSaving(to)}><StarGlyph size={16} />{T("Save this destination", "שמירת היעד")}</button>}
          </div>
        )}
      </div>

      {timeSheet && <WhenSheet when={when} onDone={w => { setWhen(w); setTimeSheet(false); }} onClose={() => setTimeSheet(false)} />}
      {saving && <SaveFavourite place={saving} onDone={() => setSaving(null)} />}
    </div>
  );
}

// ---- one way there, at a glance --------------------------------------------------------------

function legLabel(l: Leg, r: Resolved) {
  const line = r.lines[l.lineId];
  return line?.number || l.shortName || "";
}

function LegChain({ it, r }: { it: Itinerary; r: Resolved }) {
  // Only what moves you: waits and zero-length steps say nothing here.
  const legs = it.legs.filter(l => l.kind === "ride" || l.kind === "taxi" || l.kind === "bike" || (l.kind === "walk" && l.arr - l.dep >= 30));
  return (
    <div className="it-legs">
      {legs.map((l, i) => (
        <span key={i} className="it-leg">
          {i > 0 && <span className="sep">›</span>}
          {l.kind === "ride" ? options(l).slice(0, 3).map((o, k) => <LineBadge key={k} number={legLabel(o, r)} type={routeTypeOf(r, o.lineId)} small />)
            : l.kind === "walk" ? <span className="walk"><WalkGlyph size={13} />{Math.max(1, Math.round((l.arr - l.dep) / 60))}</span>
            : l.kind === "taxi" ? <LineBadge number={T("Taxi", "מונית")} type={715} small />
            : <BikeGlyph size={16} />}
        </span>
      ))}
    </div>
  );
}

function ItineraryCard({ it, resolved, onClick }: { it: Itinerary; resolved: Resolved; onClick: () => void }) {
  const now = useNow(15000);
  const b = boardingOf(it, resolved, now);
  const mins = Math.max(0, Math.round((it.arr - it.dep) / 60));
  return (
    // As Moovit lays a result out: the way there on the left, the whole trip in minutes large on the right.
    <button className="card it-card" onClick={onClick}>
      <div className="it-body">
      <LegChain it={it} r={resolved} />
      <div className="it-time">{clock(it.dep)} – {clock(it.arr)}{it.fare > 0 && <span className="dim"> · {shekels(it.fare)}</span>}</div>
      {/* The first vehicle: when it is at the stop you get on at, and how long you ride it. */}
      {b && <div className="it-foot">
        <Arrives b={b} now={now} short />
        <div className="dim" dir="auto">{T("at", "ב")} {b.stop}</div>
      </div>}
      </div>
      <span className="eta it-total">{mins < 60 ? <><b>{mins}</b><small>{T("min", "דק׳")}</small></> : <><b>{Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}</b><small>{T("hours", "שעות")}</small></>}</span>
    </button>
  );
}

// ---- one way there, in full ------------------------------------------------------------------

interface LiveState { arrivals: Arrival[]; poll: number; resolved: Resolved }

// Live arrivals at every boarding stop of the trip, refreshed as often as Moovit asks.
function useTripLive(trip: Itinerary) {
  const boarding = useMemo(() => [...new Set(trip.legs.filter(l => l.kind === "ride" || l.kind === "wait")
    .flatMap(options).map(l => l.fromStop).filter(s => s > 0))].slice(0, 40), [trip]);
  const pollRef = useRef(20);
  const live = useLoad<LiveState>(boarding.length ? `live:${trip.guid}:${boarding.join()}` : null,
    s => api<LiveState>(`arrivals?stops=${boarding.join(",")}`, undefined, s).then(r => { pollRef.current = Math.min(Math.max(r.poll, 10), 60); return r; }),
    () => pollRef.current * 1000);
  return live;
}

// The departures of one boarding: live ones when Moovit tracks them, the planned ones otherwise.
function departuresFor(ride: Leg, wait: Leg | undefined, live: Arrival[] | undefined, now: number): Departure[] {
  const boarding = wait ? options(wait).find(w => w.lineId === ride.lineId) : undefined;
  const planned = [...(boarding?.nextDeps ?? []), ...ride.nextDeps];
  const liveHere = (live ?? []).filter(a => a.stopId === ride.fromStop && a.lineId === ride.lineId && timeOf(a) >= now - 60)
    .sort((a, b) => timeOf(a) - timeOf(b));
  if (liveHere.length) return distinctDeps(liveHere);
  return distinctDeps(planned.filter(d => timeOf(d) >= now - 60));
}

function DepTime({ d, now }: { d: Departure; now: number }) {
  // The real time only: a late one is marked late, its delay isn't added on top.
  return (
    <span className="dep-time">
      <Eta d={d} now={now} inline />
      {d.platform && <span className="dim small"> · {T("platform", "רציף")} {d.platform}</span>}
    </span>
  );
}

const PAYABLE: Record<number, number> = { 3: 3, 0: 0, 2: 2, 7: 5, 5: 5 }; // GTFS route type -> Moovit pay mode

// The way with the line chosen for each ride that several lines can do, so the map, the vehicles on it, the
// steps, live directions and the lock screen all follow the line the rider picked.
function chooseLines(trip: Itinerary, picks: Record<number, number>): Itinerary {
  if (!Object.keys(picks).length) return trip;
  return { ...trip, legs: trip.legs.map((l, i) => {
    const o = l.kind === "ride" && picks[i] != null ? options(l)[picks[i]] : undefined;
    return o ? { ...o, kind: "ride", alternatives: l.alternatives, alternativeLineIds: l.alternativeLineIds } : l;
  }) };
}

// Which of a ride's lines is the one shown.
const pickOf = (leg: Leg) => {
  const opts = options(leg);
  const k = opts.findIndex(o => o.lineId === leg.lineId && String(o.tripId) === String(leg.tripId));
  return k >= 0 ? k : Math.max(0, opts.findIndex(o => o.lineId === leg.lineId));
};
type PickLine = (legIndex: number, option: number) => void;

export function TripDetail({ trip: planned, resolved: first, from, to, onBack, onPay }: {
  trip: Itinerary; resolved: Resolved; from: string; to: string; onBack: () => void; onPay: (at?: LatLon, routeType?: number) => void;
}) {
  const live = useTripLive(planned);
  const [picks, setPicks] = useState<Record<number, number>>({});
  const trip = useMemo(() => chooseLines(planned, picks), [planned, picks]);
  const pickLine: PickLine = (i, k) => setPicks(p => ({ ...p, [i]: k }));
  const now = useNow(10000);
  const [navigating, setNavigating] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const r = mergeResolved(first ?? emptyResolved(), live.data?.resolved);
  const here = useHere(navigating);

  const legs = trip.legs;
  const stopAt = (id: number): LatLon | null => { const s = r.stops[id]; return s && s.lat != null && s.lon != null ? [s.lat, s.lon] : null; };
  const lines: MapLine[] = legs.flatMap(l => {
    if (l.kind === "ride") return [{ coords: l.shape.length ? l.shape : l.stops.map(stopAt).filter(Boolean) as LatLon[], color: modeColor(routeTypeOf(r, l.lineId)), width: 6 }];
    if (l.shape.length) return [{ coords: l.shape, color: "#9ABEFF", width: 4, dashed: l.kind === "walk" }];
    return [];
  });
  const vehicles: MapPoint[] = (live.data?.arrivals ?? []).filter(a => a.tracked && a.lat && legs.some(l => l.kind === "ride" && l.lineId === a.lineId && a.stopId === l.fromStop))
    .map(a => ({ id: `v${a.tripId}`, at: [a.lat, a.lon] as LatLon, color: modeColor(routeTypeOf(r, a.lineId)), kind: "vehicle" as const, label: r.lines[a.lineId]?.number ?? "" }));
  const ends: MapPoint[] = legs.filter(l => l.kind === "ride").flatMap(l => [l.fromStop, l.toStop]).map(id => ({ id: `s${id}`, at: stopAt(id), name: r.stops[id]?.name }))
    .filter(p => p.at).map(p => ({ id: p.id, at: p.at!, color: "#ffffff", kind: "end" as const, label: p.name, size: 5, ring: "#000" }));
  const all = lines.flatMap(l => l.coords);

  const share = async () => {
    try {
      const { link } = await api<{ link: string }>("share", { guid: trip.guid, wire: trip.wire });
      if (navigator.share) await navigator.share({ url: link, title: `${from} → ${to}` });
      else { await navigator.clipboard.writeText(link); setShareNote(T("Link copied", "הקישור הועתק")); }
    } catch (e) { if ((e as Error).name !== "AbortError") setShareNote(failure(e)); }
  };

  // On the lock screen and in the Dynamic Island from the moment a way is open; Start takes it on from there.
  const allCards = useMemo(() => cardsOf(trip), [trip]);
  const preview = tripLiveOf(trip, r, live.data?.arrivals, now, to, allCards, 0);
  const previewKey = JSON.stringify(preview);
  const [lockNote, setLockNote] = useState<string | null>(null);
  useEffect(() => {
    if (navigating) return;
    showTrip(to, preview).then(res => setLockNote(res && !res.ok ? liveWhy(res) : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, navigating]);
  useEffect(() => () => endTrip(), []);

  // A reminder to leave, for a way that starts a while from now: its first ride, followed by its live time.
  const jobs = useJobs();
  const [remindNote, setRemindNote] = useState<string | null>(null);
  const ride = legs.find(l => l.kind === "ride");
  const remindId = ride ? `${ride.tripId}@${ride.dep}` : "";
  const reminder = jobs.reminders.find(x => x.id === remindId);
  const canRemind = canNotify && !!ride && (trip.dep - now > 10 * 60 || !!reminder);
  const remind = async () => {
    if (!ride) return;
    setRemindNote(null);
    if (reminder) { await removeReminder(remindId); return; }
    const ok = await addReminder({
      id: remindId, dest: to, leaveMs: trip.dep * 1000, boardMs: ride.dep * 1000, stopId: ride.fromStop, tripId: String(ride.tripId),
      lineIds: [...new Set([ride.lineId, ...options(ride).map(o => o.lineId)])].filter(id => id > 0),
      line: `${modeName(routeTypeOf(r, ride.lineId))} ${r.lines[ride.lineId]?.number || ride.shortName}`.trim(), stop: r.stops[ride.fromStop]?.name ?? "",
    }).catch(() => false);
    if (!ok) setRemindNote(T("Notifications are off for Kav. Turn them on in Settings → Kav → Notifications.", "ההתראות כבויות עבור Kav. אפשר להפעיל אותן בהגדרות → Kav → עדכונים."));
  };
  const start = () => {
    // The lines you ride are followed for their alerts.
    rodeLines(legs.filter(l => l.kind === "ride" && r.lines[l.lineId]?.groupId)
      .map(l => ({ groupId: r.lines[l.lineId].groupId, label: `${modeName(routeTypeOf(r, l.lineId))} ${r.lines[l.lineId].number}` })));
    setNavigating(true);
  };

  if (navigating) return <Navigate trip={trip} r={r} live={live.data?.arrivals} here={here} lines={lines} ends={ends} vehicles={vehicles}
    from={from} to={to} onPay={onPay} onShare={share} onExit={() => setNavigating(false)} onPick={pickLine} />;

  const mins = Math.max(1, Math.round((trip.arr - trip.dep) / 60));
  const b = boardingOf(trip, r, now);
  return (
    <div className="screen trip">
      {/* As Moovit shows a way: the map on top with its buttons floating on it, the steps in a sheet over it. */}
      <div className="trip-map">
        <MapView className="map-full" lines={lines} points={[...ends, ...vehicles]} fit={all} fitKey={`${trip.guid}:${JSON.stringify(picks)}`} user={here} />
        <button className="plate-btn trip-back" data-back onClick={goBack(onBack)} aria-label={T("Back", "חזרה")}><BackGlyph /></button>
        <button className="plate-btn trip-share" onClick={share} aria-label={T("Share", "שיתוף")}><ShareGlyph /></button>
      </div>
      {/* Dragged up for every step, down to see the map: three resting heights, from all up to the summary. */}
      <DragSheet className="trip-sheet" start={1} detents={el => { const h = el.offsetHeight; return [0, Math.round(h * 0.42), Math.max(0, h - 200)]; }}>
        <div className="trip-grip" data-grip data-toggle />
        <div className="trip-sum">
          <div className="grow">
            <div className="trip-sum-time">{clock(trip.dep)} – {clock(trip.arr)}{trip.fare > 0 && <span className="dim"> · {shekels(trip.fare)}</span>}</div>
            <LegChain it={trip} r={r} />
            {b && <Arrives b={b} now={now} short />}
          </div>
          <span className="eta it-total">{mins < 60 ? <><b>{mins}</b><small>{T("min", "דק׳")}</small></> : <><b>{Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}</b><small>{T("hours", "שעות")}</small></>}</span>
        </div>
        {shareNote && <div className="pad"><Note>{shareNote}</Note></div>}
        {lockNote && <div className="pad"><Note tone="warn">{lockNote}</Note></div>}
        {remindNote && <div className="pad"><Note tone="warn">{remindNote}</Note></div>}
        {live.error && <div className="pad"><Note tone="warn">{T("Live times are unavailable right now.", "זמני אמת אינם זמינים כרגע.")}</Note></div>}
        <Timeline trip={trip} r={r} live={live.data?.arrivals} now={now} from={from} to={to} onPay={onPay} stopAt={stopAt} onPick={pickLine} />
      </DragSheet>
      <div className="trip-cta">
        <button className="setup-btn lit" onClick={start}><PlayGlyph size={16} />{T("Start", "יציאה לדרך")}</button>
        {canRemind && <button className={"setup-btn remind-btn" + (reminder ? " on" : "")} onClick={remind}
          aria-label={reminder ? T("Cancel the reminder", "ביטול התזכורת") : T("Remind me to leave", "תזכורת לצאת")}>
          <BellGlyph size={18} />{reminder ? clock(Math.floor((reminder.at ?? reminder.leaveMs - 5 * 60_000) / 1000)) : T("Remind me", "תזכורת")}
        </button>}
      </div>
    </div>
  );
}

// ---- the steps, on a rail ----------------------------------------------------------------------

const WALK = "var(--dim)";

// A stop or an end: its time, a dot on the rail, its name. The rail above and below takes the colours of
// the steps it joins.
function Stop({ time, above, below, title, big, children }: {
  time?: number; above: string | null; below: string | null; title: string; big?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={"tl tl-stop" + (big ? " big" : "")} style={{ "--above": above ?? "transparent", "--below": below ?? "transparent", "--dot": below ?? above ?? WALK } as React.CSSProperties}>
      <span className="tl-time">{time ? clock(time) : ""}</span>
      <span className="tl-rail"><i /></span>
      <div className="tl-body"><div className="tl-title"><bdi>{title}</bdi></div>{children}</div>
    </div>
  );
}

// What happens between two stops: walking (a dotted rail) or riding (the line's colour).
function Step({ color, walk, children }: { color: string; walk?: boolean; children: React.ReactNode }) {
  return (
    <div className={"tl tl-step" + (walk ? " on-foot" : "")} style={{ "--c": color } as React.CSSProperties}>
      <span className="tl-time" />
      <span className="tl-rail" />
      <div className="tl-body">{children}</div>
    </div>
  );
}

function Timeline({ trip, r, live, now, from, to, onPay, stopAt, onPick }: {
  trip: Itinerary; r: Resolved; live?: Arrival[]; now: number; from: string; to: string;
  onPay: (at?: LatLon, routeType?: number) => void; stopAt: (id: number) => LatLon | null; onPick: PickLine;
}) {
  const legs = trip.legs.filter(l => l.kind !== "wait" && !(l.kind === "walk" && l.arr - l.dep < 30));
  const colorOf = (l: Leg | undefined) => !l ? null : l.kind === "ride" ? modeColor(routeTypeOf(r, l.lineId)) : l.kind === "walk" ? WALK : "var(--accent)";
  const out: React.ReactNode[] = [];
  out.push(<Stop key="from" time={trip.dep} above={null} below={colorOf(legs[0])} title={from} big />);
  legs.forEach((l, i) => {
    const next = legs[i + 1];
    const wait = (() => { const k = trip.legs.indexOf(l); return trip.legs[k - 1]?.kind === "wait" ? trip.legs[k - 1] : undefined; })();
    if (l.kind === "ride") {
      out.push(<RideSteps key={i} leg={l} wait={wait} r={r} live={live} now={now} onPay={onPay} stopAt={stopAt} below={colorOf(next)} prev={colorOf(legs[i - 1])}
        onPick={k => onPick(trip.legs.indexOf(l), k)} />);
      return;
    }
    const mins = Math.max(1, Math.round((l.arr - l.dep) / 60));
    out.push(<Step key={i} color={colorOf(l)!} walk={l.kind === "walk"}>
      <div className="tl-what">
        {l.kind === "walk" ? <WalkGlyph size={16} /> : l.kind === "taxi" ? <TaxiGlyph size={16} /> : l.kind === "bike" ? <BikeGlyph size={16} /> : <DotGlyph size={12} />}
        <span>{l.kind === "walk" ? T("Walk", "הליכה") : l.kind === "taxi" ? T("Taxi", "מונית") : l.kind === "bike" ? T("Bike", "אופניים") : ""} {minutesText(mins)}{l.meters > 0 ? ` · ${distanceText(l.meters)}` : ""}</span>
      </div>
    </Step>);
    // A walk that ends at a stop is followed by that stop's own node, drawn by the ride.
    if (next?.kind !== "ride" && next) out.push(<Stop key={i + "e"} time={l.arr} above={colorOf(l)} below={colorOf(next)} title={l.toStop > 0 ? r.stops[l.toStop]?.name ?? "" : ""} />);
  });
  out.push(<Stop key="to" time={trip.arr} above={colorOf(legs[legs.length - 1])} below={null} title={to} big />);
  return <div className="timeline">{out}</div>;
}

// A ride: the stop you get on at (with the next departures, live), the ride, and the stop you get off at.
function RideSteps({ leg, wait, r, live, now, onPay, stopAt, prev, below, onPick }: {
  leg: Leg; wait?: Leg; r: Resolved; live?: Arrival[]; now: number; onPay: (at?: LatLon, routeType?: number) => void;
  stopAt: (id: number) => LatLon | null; prev: string | null; below: string | null; onPick: (option: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const opts = options(leg);
  const pick = pickOf(leg);
  const ride = leg;
  const type = routeTypeOf(r, ride.lineId);
  const color = modeColor(type);
  const line = r.lines[ride.lineId];
  const deps = departuresFor(ride, wait, live, now);
  const mine = deps.find(d => String(d.tripId) === String(ride.tripId)) ?? deps[0];
  const between = ride.stops.slice(1, -1);
  const payMode = PAYABLE[type];
  const stopName = (id: number) => r.stops[id]?.name ?? "";
  return <>
    <Stop time={mine ? timeOf(mine) : ride.dep} above={prev} below={color} title={stopName(ride.fromStop)}>
      <DelayNote lineId={ride.lineId} stopId={ride.fromStop} />
      {mine && <div className="tl-leaves">{T("Leaves in", "יוצא בעוד")} <Eta d={mine} now={now} inline />{deps.length > 1 && <span className="dim"> · {T("then ", "אחר כך ")}<NextTimes ds={deps.slice(1, 3)} now={now} /></span>}</div>}
    </Stop>
    <Step color={color}>
      <div className="tl-line">
        {opts.map((o, k) => (
          <button key={k} className={"badge-btn" + (k === pick ? " on" : "")} onClick={() => onPick(k)} disabled={opts.length < 2}>
            <LineBadge number={r.lines[o.lineId]?.number || o.shortName} type={routeTypeOf(r, o.lineId)} />
          </button>
        ))}
      </div>
      {line?.destination && <div className="tl-dest" dir="auto">{T("towards ", "לכיוון ")}{line.destination}</div>}
      {opts.length > 1 && <div className="dim small">{T("Any of these lines will do: tap one to see its times and its route on the map.", "כל אחד מהקווים האלה מתאים: הקישו על אחד כדי לראות את הזמנים והמסלול שלו במפה.")}</div>}
      {wait?.alertText && <Note tone="warn">{wait.alertText}</Note>}
      <button className="link tl-stops" onClick={() => setOpen(!open)} disabled={!between.length}>
        {between.length > 0 && <ChevronGlyph size={12} open={open} />}
        {T(`Ride ${minutesText(Math.round((ride.arr - ride.dep) / 60))}`, `נסיעה ${minutesText(Math.round((ride.arr - ride.dep) / 60))}`)} · {T(`${between.length + 1} stops`, `${between.length + 1} תחנות`)}
      </button>
      {open && <ol className="tl-mini">{between.map(id => <li key={id} dir="auto">{stopName(id) || `#${id}`}</li>)}</ol>}
      {payMode != null && <button className="btn small" onClick={() => onPay(stopAt(ride.fromStop) ?? undefined, payMode)}><PayGlyph size={16} />{T("Pay for this ride", "תשלום על הנסיעה")}</button>}
    </Step>
    <Stop time={ride.arr} above={color} below={below} title={stopName(ride.toStop)}>
      <div className="dim small">{T("Get off here", "יורדים כאן")}</div>
    </Stop>
  </>;
}

// ---- on the way ------------------------------------------------------------------------------

// One card of the live directions, as Moovit splits a way: setting off, each walk, waiting for the
// vehicle, riding it, arriving.
type Card =
  | { kind: "start" }
  | { kind: "walk"; leg: Leg; next?: Leg; wait?: Leg; last: boolean }
  | { kind: "wait"; ride: Leg; wait?: Leg }
  | { kind: "ride"; ride: Leg }
  | { kind: "arrive" };

function cardsOf(trip: Itinerary): Card[] {
  const legs = trip.legs;
  const out: Card[] = [{ kind: "start" }];
  legs.forEach((l, i) => {
    const wait = legs[i - 1]?.kind === "wait" ? legs[i - 1] : undefined;
    if (l.kind === "walk" && l.arr - l.dep >= 30) {
      const after = legs.slice(i + 1).find(x => x.kind !== "wait");
      const nextWait = legs[i + 1]?.kind === "wait" ? legs[i + 1] : undefined;
      out.push({ kind: "walk", leg: l, next: after?.kind === "ride" ? after : undefined, wait: nextWait, last: !after });
    } else if (l.kind === "ride") {
      out.push({ kind: "wait", ride: l, wait }, { kind: "ride", ride: l });
    } else if (l.kind === "taxi" || l.kind === "bike") {
      out.push({ kind: "walk", leg: l, last: !legs.slice(i + 1).some(x => x.kind !== "wait") });
    }
  });
  if (out[out.length - 1].kind !== "walk") out.push({ kind: "arrive" });
  return out;
}

// What the lock screen and the Dynamic Island show for a step of the trip: the next thing to wait for,
// counted down. Before boarding, the vehicle at your stop; on it, getting off (moved by its delay); after
// the last ride, arriving.
function tripLiveOf(trip: Itinerary, r: Resolved, live: Arrival[] | undefined, now: number, to: string, cards: Card[], step: number): TripLive {
  const card = cards[step] ?? cards[0];
  const waitBefore = (l: Leg) => { const k = trip.legs.indexOf(l); return trip.legs[k - 1]?.kind === "wait" ? trip.legs[k - 1] : undefined; };
  const firstRide = trip.legs.find(l => l.kind === "ride");
  const nextRide = card.kind === "wait" || card.kind === "ride" ? card.ride : card.kind === "walk" ? card.next : card.kind === "start" ? firstRide : undefined;
  // Setting off with a walk first reads as the walk.
  const walking = card.kind === "walk" || (card.kind === "start" && trip.legs[0]?.kind === "walk");
  return (() => {
    const base = { accent: getPrefs().accent, depart: trip.dep * 1000, arrive: trip.arr * 1000, step, steps: cards.length };
    if (!nextRide) return {
      ...base, phase: card.kind === "arrive" ? "arrive" : "walk",
      title: card.kind === "arrive" ? T("You've arrived", "הגעתם") : T(`Walk to ${to}`, `הליכה אל ${to}`),
      detail: T(`Arrival at ${clock(trip.arr)}`, `הגעה ב-${clock(trip.arr)}`),
      label: T("Arrive in", "הגעה בעוד"), stop: to, line: "", mode: "walk", color: "#9C9CA5", target: trip.arr * 1000, live: false,
    };
    const type = routeTypeOf(r, nextRide.lineId);
    const numbers = [...new Set(options(nextRide).map(o => r.lines[o.lineId]?.number || o.shortName).filter(Boolean))].slice(0, 2);
    const deps = departuresFor(nextRide, waitBefore(nextRide), live, now);
    const mine = deps.find(d => String(d.tripId) === String(nextRide.tripId)) ?? deps[0];
    const common = { ...base, line: numbers.join(" / "), mode: modeOf(type), color: modeColor(type), live: !!mine && isLive(mine) };
    // The lines that will do, each with where it goes: "27 ראש העין / 72 תחנת רכבת…".
    const lineList = options(nextRide).map(o => `${r.lines[o.lineId]?.number || o.shortName} ${r.lines[o.lineId]?.destination ?? ""}`.trim()).slice(0, 3).join(" / ");
    const from = r.stops[nextRide.fromStop]?.name ?? "", off = r.stops[nextRide.toStop]?.name ?? "";
    if (card.kind === "ride") {
      const late = mine && mine.rtUtc > 0 && mine.staticUtc > 0 ? mine.rtUtc - mine.staticUtc : 0;
      const n = Math.max(1, nextRide.stops.length - 1);
      return { ...common, phase: "ride", title: T(`Ride ${n} stops to ${off}`, `נסיעה ${n} תחנות עד ${off}`), detail: lineList,
        label: T("Get off in", "ירידה בעוד"), stop: off, target: (nextRide.arr + late) * 1000 };
    }
    const several = options(nextRide).length > 1;
    const title = walking ? T(`Walk to ${from}`, `הליכה אל ${from}`)
      : several ? T("Wait for one of these options", "המתינו לאחת מהאפשרויות") : T(`Wait for ${numbers[0] ?? ""}`, `המתינו ל-${numbers[0] ?? ""}`);
    return { ...common, phase: walking ? "walk" : "wait", title, detail: lineList,
      label: T(`${numbers[0] ?? ""} at your stop in`, `${numbers[0] ?? ""} בתחנה בעוד`), stop: from, target: (mine ? timeOf(mine) : nextRide.dep) * 1000 };
  })();
}

function Navigate({ trip, r, live, here, lines, ends, vehicles, from, to, onPay, onShare, onExit, onPick }: {
  trip: Itinerary; r: Resolved; live?: Arrival[]; here: LatLon | null; lines: MapLine[]; ends: MapPoint[]; vehicles: MapPoint[];
  from: string; to: string; onPay: (at?: LatLon, routeType?: number) => void; onShare: () => void; onExit: () => void; onPick: PickLine;
}) {
  const cards = useMemo(() => cardsOf(trip), [trip]);
  const [step, setStep] = useState(0);
  const [follow, setFollow] = useState(true);
  const [alerts, setAlerts] = useState(true);
  const now = useNow(5000);
  const card = cards[step];
  const stopAt = (id: number): LatLon | null => { const s = r.stops[id]; return s && s.lat != null && s.lon != null ? [s.lat, s.lon] : null; };
  const endOf = (l: Leg): LatLon | null => (l.toStop > 0 ? stopAt(l.toStop) : null) ?? (l.shape.length ? l.shape[l.shape.length - 1] : null);
  const go = (to: number) => { setStep(Math.max(0, Math.min(cards.length - 1, to))); setFollow(false); };

  // Keep the screen on while walking through the trip.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as any).wakeLock;
    if (isNative) keepAwake(true);
    else wl?.request("screen").then((l: any) => { lock = l; }).catch(() => {});
    return () => { keepAwake(false); lock?.release().catch(() => {}); };
  }, []);

  // The card moves on by itself: off once you've left, on the vehicle once it pulls away, off it near your stop.
  useEffect(() => {
    if (!here || step >= cards.length - 1) return;
    const c = cards[step];
    const start = lines[0]?.coords[0];
    const near = (p: LatLon | null, m: number) => !!p && metres(here, p) < m;
    if (c.kind === "start" && start && !near(start, 40)) setStep(step + 1);
    else if (c.kind === "walk" && near(endOf(c.leg), 35)) setStep(step + 1);
    // Only once the stop is known: an unknown one isn't a reason to think the rider has left it.
    else if (c.kind === "wait" && stopAt(c.ride.fromStop) && !near(stopAt(c.ride.fromStop), 150)) setStep(step + 1);
    else if (c.kind === "ride" && near(endOf(c.ride), 120)) setStep(step + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1], step]);

  // Nearly there on a ride: the phone says so, once.
  const told = useRef(-1);
  useEffect(() => {
    if (!alerts || !here || card?.kind !== "ride" || told.current === step) return;
    const end = endOf(card.ride);
    if (end && metres(here, end) < 400) { told.current = step; buzz("alert"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1], step, alerts]);

  // The map frames the card's own part of the way, until you ask it to follow you again.
  const stepLeg = card.kind === "walk" ? card.leg : card.kind === "wait" || card.kind === "ride" ? card.ride : null;
  const stepCoords: LatLon[] = card.kind === "start" ? (lines[0]?.coords.slice(0, 2) ?? []) : card.kind === "arrive" ? (lines[lines.length - 1]?.coords.slice(-2) ?? [])
    : card.kind === "wait" ? [stopAt(card.ride.fromStop)].filter(Boolean) as LatLon[]
    : stepLeg ? (stepLeg.shape.length ? stepLeg.shape : stepLeg.stops.map(stopAt).filter(Boolean) as LatLon[]) : [];
  const left = Math.max(0, Math.round((trip.arr - now) / 60));

  // The lock screen and the Dynamic Island: the next thing to wait for, counted down by the system so it
  // runs on with Kav in the background. Before boarding, the vehicle at your stop; on it, getting off
  // (moved by its delay); after the last ride, arriving.
  const tripLive = tripLiveOf(trip, r, live, now, to, cards, step);
  const shown = JSON.stringify(tripLive);
  useEffect(() => { showTrip(to, tripLive); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [shown]);
  useEffect(() => () => endTrip(), []);

  // A swipe on the card turns it, as Moovit's do.
  const touch = useRef<number | null>(null);
  const rtl = document.documentElement.dir === "rtl";
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => { touch.current = e.touches[0].clientX; },
    onTouchEnd: (e: React.TouchEvent) => {
      if (touch.current == null) return;
      const dx = e.changedTouches[0].clientX - touch.current; touch.current = null;
      if (Math.abs(dx) > 50) go(step + ((dx < 0) !== rtl ? 1 : -1));
    },
  };

  const payHere = card.kind === "wait" || card.kind === "ride" ? card.ride : trip.legs.find(l => l.kind === "ride");
  const payMode = payHere ? PAYABLE[routeTypeOf(r, payHere.lineId)] : undefined;

  return (
    <div className="screen live-dir">
      <header className="ld-head">
        <button className="ld-icon" data-back onClick={goBack(onExit)} aria-label={T("Back", "חזרה")}><BackGlyph /></button>
        <div className="ld-title">
          <div>{T("Live Directions", "ניווט חי")}</div>
          <b>{clock(trip.arr)} • {minutesText(left)}</b>
        </div>
        <button className={"ld-icon" + (alerts ? "" : " off")} onClick={() => setAlerts(a => !a)}
          aria-label={alerts ? T("Turn off the get-off alert", "כיבוי ההתראה לירידה") : T("Turn on the get-off alert", "הפעלת ההתראה לירידה")}><BellGlyph off={!alerts} /></button>
      </header>
      <div className="ld-steps">
        <button className="ld-arrow" onClick={() => go(step - 1)} disabled={step === 0} aria-label={T("Previous step", "השלב הקודם")}><BackGlyph size={16} /></button>
        <div className="ld-dots">
          <div className="dots">{cards.map((_, i) => <span key={i} className={i === step ? "on" : ""} onClick={() => go(i)} />)}</div>
          {!follow && <button className="link ld-recenter" onClick={() => setFollow(true)}>{T("Recenter", "מרכוז")}</button>}
        </div>
        <button className="ld-arrow" onClick={() => go(step + 1)} disabled={step === cards.length - 1} aria-label={T("Next step", "השלב הבא")}><BackGlyph size={16} style={{ rotate: "180deg" }} /></button>
      </div>
      <div className="ld-map">
        <MapView className="map-full" lines={lines} points={[...ends, ...vehicles]} user={here} follow={follow ? here : null}
          fit={stepCoords.length ? stepCoords : lines.flatMap(l => l.coords)} fitKey={`nav${trip.guid}:${step}`} onMove={() => setFollow(false)} />
        <button className="plate-btn ld-locate" onClick={() => setFollow(true)} aria-label={T("Recenter", "מרכוז")}><LocateGlyph /></button>
        {/* Pulled down to its heading to see the map, up again for the whole step; sideways for the next step. */}
        <DragSheet key={step} className="ld-card card" detents={el => [0, Math.max(0, el.offsetHeight - 64)]}>
          <div className="sheet-grip" data-grip data-toggle />
          <div {...swipe}><StepCard card={card} trip={trip} r={r} live={live} now={now} here={here} from={from} to={to} endOf={endOf} onPick={onPick} /></div>
        </DragSheet>
      </div>
      <div className="ld-actions">
        <button className="ld-act stop" onClick={onExit}><span className="ld-square" />{T("Stop", "עצירה")}</button>
        {payMode != null && <button className="ld-act" onClick={() => onPay(payHere ? stopAt(payHere.fromStop) ?? undefined : undefined, payMode)}><PayGlyph size={18} />{T("Pay", "תשלום")}</button>}
        <button className="ld-act" onClick={onShare}><ShareGlyph size={18} />{T("Share", "שיתוף")}</button>
      </div>
    </div>
  );
}

function StepCard({ card, trip, r, live, now, here, from, to, endOf, onPick }: {
  card: Card; trip: Itinerary; r: Resolved; live?: Arrival[]; now: number; here: LatLon | null; from: string; to: string;
  endOf: (l: Leg) => LatLon | null; onPick: PickLine;
}) {
  const stop = (id: number) => r.stops[id];
  const far = (l: Leg) => { const e = endOf(l); return here && e ? distanceText(metres(here, e)) : l.meters > 0 ? distanceText(l.meters) : ""; };
  const head = (text: string, end?: React.ReactNode) => <div className="ld-band" data-grip data-toggle><b>{text}</b>{end}</div>;

  if (card.kind === "start") return <>
    {head(T("Start from", "יוצאים מ"))}
    <div className="ld-body">
      <div className="ld-place"><PinGlyph size={22} /><b><bdi>{from}</bdi></b></div>
      <div className="ld-sub">{T(`Leave at ${clock(trip.dep)}`, `יציאה ב-${clock(trip.dep)}`)}</div>
    </div>
  </>;

  if (card.kind === "arrive") return <>
    {head(T("You've arrived", "הגעתם"), <FlagGlyph size={22} />)}
    <div className="ld-body"><div className="ld-place"><PinGlyph size={22} /><b><bdi>{to}</bdi></b></div>
      <div className="ld-sub">{T(`Arrival at ${clock(trip.arr)}`, `הגעה ב-${clock(trip.arr)}`)}</div></div>
  </>;

  if (card.kind === "walk") {
    const l = card.leg;
    const mins = Math.max(1, Math.round((l.arr - l.dep) / 60));
    const target = l.toStop > 0 ? stop(l.toStop) : null;
    const verb = l.kind === "taxi" ? T(`Taxi ${mins} min to`, `מונית ${mins} דק׳ אל`) : l.kind === "bike" ? T(`Ride a bike ${mins} min to`, `אופניים ${mins} דק׳ אל`) : T(`Walk ${mins} min to`, `הליכה ${mins} דק׳ אל`);
    const deps = card.next ? departuresFor(card.next, card.wait, live, now) : [];
    return <>
      {head(verb, card.last ? <FlagGlyph size={22} /> : undefined)}
      <div className="ld-body">
        <div className="ld-place">{target ? <StationMark type={card.next ? routeTypeOf(r, card.next.lineId) : 3} size={24} /> : <PinGlyph size={22} />}
          <div><b><bdi>{target?.name ?? (card.last ? to : "")}</bdi></b>{target?.code && <div className="ld-sub">{T("ID", "מזהה")} {target.code}</div>}</div></div>
        <div className="ld-dist">{far(l)}</div>
        {deps.length > 0 && <div className="ld-pill">{T("Your line arrives in", "הקו שלכם מגיע בעוד")} <Eta d={deps[0]} now={now} inline />
          {deps.length > 1 && <span className="dim">· {T("then ", "אחר כך ")}<NextTimes ds={deps.slice(1, 3)} now={now} /></span>}</div>}
      </div>
    </>;
  }

  if (card.kind === "wait") {
    const opts = options(card.ride);
    return <>
      {head(opts.length > 1 ? T("Wait for one of these options", "המתינו לאחת מהאפשרויות") : T("Wait for", "המתינו ל"))}
      <div className="ld-body ld-options">
        {opts.map((o, k) => {
          const deps = departuresFor(o, card.wait, live, now);
          const line = r.lines[o.lineId];
          return (
            <div key={k} className="ld-option">
              <LineBadge number={line?.number || o.shortName} type={routeTypeOf(r, o.lineId)} />
              <div className="grow"><bdi>{line?.destination ?? ""}</bdi>{deps[0] && isLive(deps[0]) && <div className="ld-live">{T("Arrival time is live", "זמן ההגעה בזמן אמת")}</div>}</div>
              <div className="ld-when">{deps[0] ? <Eta d={deps[0]} now={now} /> : <b>{clock(o.dep)}</b>}{deps.length > 1 && <small>{deps.slice(1, 3).map(d => clock(timeOf(d))).join(", ")}</small>}</div>
            </div>
          );
        })}
        <div className="ld-sub"><bdi>{stop(card.ride.fromStop)?.name ?? ""}</bdi></div>
      </div>
    </>;
  }

  // Riding: where to get off, and the stops of the line you're on, the one you're at lit.
  const opts = options(card.ride);
  const ride = card.ride;
  const pick = pickOf(ride);
  const setPick = (k: number) => onPick(trip.legs.indexOf(card.ride), k);
  const n = Math.max(1, ride.stops.length - 1);
  const mins = Math.max(1, Math.round((ride.arr - ride.dep) / 60));
  const at = here ? ride.stops.map((id, i) => ({ i, m: (() => { const s = stop(id); return s?.lat != null && s?.lon != null ? metres(here, [s.lat, s.lon]) : Infinity; })() }))
    .sort((a, b) => a.m - b.m)[0] : null;
  const color = modeColor(routeTypeOf(r, ride.lineId));
  return <>
    {head(T(`Ride ${n} stops to`, `נסיעה ${n} תחנות אל`), <span>{minutesText(mins)}</span>)}
    <div className="ld-body">
      <div className="ld-place"><StationMark type={routeTypeOf(r, ride.lineId)} size={24} /><div><b><bdi>{stop(ride.toStop)?.name ?? ""}</bdi></b>
        {stop(ride.toStop)?.code && <div className="ld-sub">{T("ID", "מזהה")} {stop(ride.toStop)!.code}</div>}</div></div>
      {opts.length > 1 && <div className="ld-sub">{T("Choose the line you're on, for the right stops:", "בחרו את הקו שאתם בו, בשביל התחנות הנכונות:")}</div>}
      <div className="ld-line">{opts.length > 1
        ? opts.map((o, k) => <button key={k} className={"badge-btn" + (k === pick ? " on" : "")} onClick={() => setPick(k)}><LineBadge number={r.lines[o.lineId]?.number || o.shortName} type={routeTypeOf(r, o.lineId)} /></button>)
        : <LineBadge number={r.lines[ride.lineId]?.number || ride.shortName} type={routeTypeOf(r, ride.lineId)} />}
        <bdi className="dim">{r.lines[ride.lineId]?.destination ?? ""}</bdi></div>
      <ol className="ld-stops" style={{ "--c": color } as React.CSSProperties}>
        {ride.stops.map((id, i) => <li key={id + ":" + i} className={(at && at.i === i && at.m < 300 ? "here " : "") + (i === 0 || i === ride.stops.length - 1 ? "end" : "")}><bdi>{stop(id)?.name ?? `#${id}`}</bdi></li>)}
      </ol>
    </div>
  </>;
}
