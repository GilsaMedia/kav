// Planning a trip: where from and to, the ways there, one of them in detail, and walking through it.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  T, api, usePrefs, setPrefs, useHere, useLoad, useNow, clock, minutesText, distanceText, metres, shekels, failure,
  timeOf, isLive, isCancelled, routeTypeOf, options, modeColor, modeName, MODE_FILTERS, mergeResolved, emptyResolved,
  type Place, type Itinerary, type Leg, type Resolved, type Arrival, type LatLon, type Departure,
} from "../core.ts";
import { Header, LineBadge, Spinner, Note, LiveDot, PlacePicker, SaveFavourite, HERE_NAME, Sheet } from "../ui.tsx";
import { MapView, type MapLine, type MapPoint } from "../MapView.tsx";
import { isNative, keepAwake } from "../native.ts";
import { SwapGlyph, ClockGlyph, StarGlyph, CloseGlyph, RecentGlyph, WalkGlyph, BikeGlyph, TaxiGlyph, DotGlyph, ShareGlyph, PlayGlyph, ChevronGlyph } from "../icons.tsx";

type When = { kind: "now" } | { kind: "depart" | "arrive"; ms: number };

interface PlanResult { itineraries: Itinerary[]; resolved: Resolved; refusal?: { code: number; title: string; detail: string } }

export function PlanScreen({ onPay }: { onPay: (at?: LatLon, routeType?: number) => void }) {
  const prefs = usePrefs();
  const here = useHere();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [when, setWhen] = useState<When>({ kind: "now" });
  const [timeSheet, setTimeSheet] = useState(false);
  const [searchKey, setSearchKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [saving, setSaving] = useState<Place | null>(null);

  const fromAt = (): LatLon | null => from ? [from.lat, from.lon] : here;
  const plan = useLoad<PlanResult>(searchKey, signal => {
    const f = fromAt();
    if (!f || !to) throw new Error(T("Waiting for your location…", "ממתינים למיקום שלכם…"));
    const types = prefs.modes.length ? prefs.modes : undefined;
    return api("plan", {
      from: f, to: [to.lat, to.lon], routeTypes: types,
      when: when.kind === "now" ? 0 : when.ms, timeType: when.kind === "arrive" ? 1 : 2,
    }, signal);
  });

  // A new search whenever the ends, the time or the modes change.
  useEffect(() => {
    if (!to || (!from && !here)) return;
    setChosen(null);
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

  const swap = () => { const f = from; setFrom(to); setTo(f ?? { name: HERE_NAME(), detail: "", lat: here?.[0] ?? 0, lon: here?.[1] ?? 0, type: -1 }); };

  if (picking) {
    return <PlacePicker title={picking === "from" ? T("From", "מאיפה") : T("To", "לאן")} allowHere
      onClose={() => setPicking(null)}
      onPick={p => { (picking === "from" ? setFrom : setTo)(p.type === -1 && picking === "from" ? null : p); setPicking(null); }} />;
  }

  if (chosen != null && its[chosen] && plan.data) {
    return <TripDetail trip={its[chosen]} resolved={plan.data.resolved} from={from?.name ?? HERE_NAME()} to={to?.name ?? ""}
      onBack={() => setChosen(null)} onPay={onPay} />;
  }

  const whenText = when.kind === "now" ? T("Leave now", "יציאה עכשיו")
    : `${when.kind === "depart" ? T("Leave at", "יציאה ב-") : T("Arrive by", "הגעה עד ")}${new Date(when.ms).toLocaleString(prefs.lang === "he" ? "he-IL" : "en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="screen">
      <Header title={T("Where to?", "לאן נוסעים?")} />
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
        <div className="chips scroll-x">
          <button className={"chip" + (when.kind !== "now" ? " on" : "")} onClick={() => setTimeSheet(true)}><ClockGlyph size={16} />{whenText}</button>
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

      {timeSheet && <TimeSheet when={when} onDone={w => { setWhen(w); setTimeSheet(false); }} onClose={() => setTimeSheet(false)} />}
      {saving && <SaveFavourite place={saving} onDone={() => setSaving(null)} />}
    </div>
  );
}

function TimeSheet({ when, onDone, onClose }: { when: When; onDone: (w: When) => void; onClose: () => void }) {
  const [kind, setKind] = useState<When["kind"]>(when.kind);
  const initial = when.kind === "now" ? Date.now() : when.ms;
  const local = (ms: number) => { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
  const [value, setValue] = useState(local(initial));
  return (
    <Sheet onClose={onClose} title={T("When", "מתי")}>
      <div className="stack">
        <div className="segmented">
          {(["now", "depart", "arrive"] as const).map(k => (
            <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
              {k === "now" ? T("Now", "עכשיו") : k === "depart" ? T("Leave at", "יציאה ב-") : T("Arrive by", "הגעה עד")}
            </button>
          ))}
        </div>
        {kind !== "now" && <input className="field" type="datetime-local" value={value} onChange={e => setValue(e.target.value)} />}
        <button className="btn primary" onClick={() => onDone(kind === "now" ? { kind } : { kind, ms: new Date(value).getTime() })}>{T("Done", "סיום")}</button>
      </div>
    </Sheet>
  );
}

// ---- one way there, at a glance --------------------------------------------------------------

function legLabel(l: Leg, r: Resolved) {
  const line = r.lines[l.lineId];
  return line?.number || l.shortName || "";
}

function ItineraryCard({ it, resolved, onClick }: { it: Itinerary; resolved: Resolved; onClick: () => void }) {
  const firstRide = it.legs.find(l => l.kind === "ride");
  const mins = Math.max(0, Math.round((it.arr - it.dep) / 60));
  return (
    <button className="card it-card" onClick={onClick}>
      <div className="it-top">
        <span className="it-time">{clock(it.dep)} – {clock(it.arr)}</span>
        <span className="it-dur">{minutesText(mins)}</span>
      </div>
      <div className="it-legs">
        {it.legs.filter(l => l.kind !== "wait").map((l, i) => (
          <span key={i} className="it-leg">
            {i > 0 && <span className="sep">›</span>}
            {l.kind === "ride" ? options(l).slice(0, 3).map((o, k) => <LineBadge key={k} number={legLabel(o, resolved)} type={routeTypeOf(resolved, o.lineId)} small />)
              : l.kind === "walk" ? <span className="walk"><WalkGlyph size={13} />{l.arr > l.dep ? Math.max(1, Math.round((l.arr - l.dep) / 60)) : ""}</span>
              : l.kind === "taxi" ? <LineBadge number={T("Taxi", "מונית")} type={715} small />
              : l.kind === "bike" ? <BikeGlyph size={16} /> : <span className="dim">•</span>}
          </span>
        ))}
      </div>
      <div className="it-foot dim">
        {firstRide && <span>{T("from", "מ")}{" "}<span dir="auto">{resolved.stops[firstRide.fromStop]?.name ?? ""}</span> · {clock(firstRide.dep)}</span>}
        {it.fare > 0 && <span> · {shekels(it.fare)}</span>}
      </div>
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
  if (liveHere.length) return liveHere;
  const seen = new Set<string>();
  return planned.filter(d => { const k = `${d.tripId}:${timeOf(d)}`; if (seen.has(k)) return false; seen.add(k); return timeOf(d) >= now - 60; })
    .sort((a, b) => timeOf(a) - timeOf(b));
}

function DepTime({ d, now }: { d: Departure; now: number }) {
  const t = timeOf(d);
  if (isCancelled(d)) return <span className="dep cancelled">{clock(d.staticUtc)} {T("cancelled", "בוטל")}</span>;
  const mins = Math.round((t - now) / 60);
  const late = d.rtUtc > 0 && d.staticUtc > 0 ? Math.round((d.rtUtc - d.staticUtc) / 60) : 0;
  return (
    <span className={"dep" + (isLive(d) ? " live" : "")}>
      {isLive(d) && <LiveDot />}{mins <= 30 ? minutesText(mins) : clock(t)}
      {late >= 2 && <span className="late"> +{late}</span>}
      {d.platform && <span className="dim"> · {T("platform", "רציף")} {d.platform}</span>}
    </span>
  );
}

const PAYABLE: Record<number, number> = { 3: 3, 0: 0, 2: 2, 7: 5, 5: 5 }; // GTFS route type -> Moovit pay mode

function TripDetail({ trip, resolved: first, from, to, onBack, onPay }: {
  trip: Itinerary; resolved: Resolved; from: string; to: string; onBack: () => void; onPay: (at?: LatLon, routeType?: number) => void;
}) {
  const live = useTripLive(trip);
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

  if (navigating) return <Navigate trip={trip} r={r} live={live.data?.arrivals} here={here} lines={lines} ends={ends} vehicles={vehicles} onExit={() => setNavigating(false)} />;

  return (
    <div className="screen">
      <Header title={`${clock(trip.dep)} – ${clock(trip.arr)}`} sub={`${minutesText(Math.round((trip.arr - trip.dep) / 60))}${trip.fare > 0 ? " · " + shekels(trip.fare) : ""}`}
        back={onBack} right={<button className="plate-btn" onClick={share} aria-label={T("Share", "שיתוף")}><ShareGlyph /></button>} />
      <MapView className="map-half" lines={lines} points={[...ends, ...vehicles]} fit={all} fitKey={trip.guid} user={here} />
      <div className="scroll">
        <div className="pad stack">
          {shareNote && <Note>{shareNote}</Note>}
          <button className="btn primary" onClick={() => setNavigating(true)}><PlayGlyph size={14} />{T("Start", "יציאה לדרך")}</button>
          <ol className="legs">
            {legs.map((l, i) => {
              if (l.kind === "wait") return null;
              const prev = legs[i - 1]?.kind === "wait" ? legs[i - 1] : undefined;
              return <LegRow key={i} leg={l} wait={prev} r={r} live={live.data?.arrivals} now={now} last={i === legs.length - 1} dest={to} onPay={onPay} stopAt={stopAt} />;
            })}
          </ol>
          {live.error && <Note tone="warn">{T("Live times are unavailable right now.", "זמני אמת אינם זמינים כרגע.")}</Note>}
        </div>
      </div>
    </div>
  );
}

function LegRow({ leg, wait, r, live, now, last, dest, onPay, stopAt }: {
  leg: Leg; wait?: Leg; r: Resolved; live?: Arrival[]; now: number; last: boolean; dest: string;
  onPay: (at?: LatLon, routeType?: number) => void; stopAt: (id: number) => LatLon | null;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(0);
  const stopName = (id: number) => r.stops[id]?.name ?? "";
  if (leg.kind === "walk") {
    const mins = Math.max(1, Math.round((leg.arr - leg.dep) / 60));
    const target = leg.toStop > 0 ? stopName(leg.toStop) : last ? dest : "";
    return (
      <li className="leg walk-leg">
        <span className="leg-icon"><WalkGlyph size={18} /></span>
        <div>
          <div>{T("Walk", "הליכה")} {minutesText(mins)}{leg.meters > 0 ? ` · ${distanceText(leg.meters)}` : ""}</div>
          {target && <div className="dim" dir="auto">{T("to", "אל")} {target}</div>}
        </div>
      </li>
    );
  }
  if (leg.kind === "ride") {
    const opts = options(leg);
    const ride = opts[pick] ?? leg;
    const type = routeTypeOf(r, ride.lineId);
    const line = r.lines[ride.lineId];
    const deps = departuresFor(ride, wait, live, now);
    const mine = deps.find(d => String(d.tripId) === String(ride.tripId)) ?? deps[0];
    const between = ride.stops.slice(1, -1);
    const payMode = PAYABLE[type];
    return (
      <li className="leg ride-leg" style={{ borderColor: modeColor(type) }}>
        <div className="leg-head">
          {opts.map((o, k) => (
            <button key={k} className={"badge-btn" + (k === pick ? " on" : "")} onClick={() => setPick(k)}>
              <LineBadge number={r.lines[o.lineId]?.number || o.shortName} type={routeTypeOf(r, o.lineId)} />
            </button>
          ))}
          <span className="dim small">{modeName(type)}{line?.destination ? <> · {T("to", "ל")}<span dir="auto">{line.destination}</span></> : ""}</span>
        </div>
        <div className="leg-stop"><b dir="auto">{stopName(ride.fromStop)}</b> <span className="dim">{clock(ride.dep)}</span></div>
        <div className="deps">{deps.slice(0, 4).map((d, k) => <DepTime key={k} d={d} now={now} />)}{!deps.length && mine == null && <span className="dim">{clock(ride.dep)}</span>}</div>
        {wait?.alertText && <Note tone="warn">{wait.alertText}</Note>}
        {between.length > 0 && <button className="link" onClick={() => setOpen(!open)}><ChevronGlyph size={12} open={open} />{T(`${between.length + 1} stops`, `${between.length + 1} תחנות`)} · {minutesText(Math.round((ride.arr - ride.dep) / 60))}</button>}
        {open && <ul className="stops-mini">{between.map(s => <li key={s} dir="auto">{stopName(s) || `#${s}`}</li>)}</ul>}
        <div className="leg-stop"><b dir="auto">{stopName(ride.toStop)}</b> <span className="dim">{clock(ride.arr)}</span></div>
        {payMode != null && <button className="btn small" onClick={() => onPay(stopAt(ride.fromStop) ?? undefined, payMode)}>{T("Pay for this ride", "תשלום על הנסיעה")}</button>}
      </li>
    );
  }
  if (leg.kind === "taxi") return <li className="leg"><span className="leg-icon"><TaxiGlyph size={18} /></span><div>{T("Taxi", "מונית")} · {minutesText(Math.round((leg.arr - leg.dep) / 60))}</div></li>;
  if (leg.kind === "bike") return <li className="leg"><span className="leg-icon"><BikeGlyph size={18} /></span><div>{T("Bike", "אופניים")} · {minutesText(Math.round((leg.arr - leg.dep) / 60))}</div></li>;
  return <li className="leg"><span className="leg-icon"><DotGlyph size={14} /></span><div className="dim">{minutesText(Math.round((leg.arr - leg.dep) / 60))}</div></li>;
}

// ---- on the way ------------------------------------------------------------------------------

function Navigate({ trip, r, live, here, lines, ends, vehicles, onExit }: {
  trip: Itinerary; r: Resolved; live?: Arrival[]; here: LatLon | null; lines: MapLine[]; ends: MapPoint[]; vehicles: MapPoint[]; onExit: () => void;
}) {
  const steps = trip.legs.map((l, i) => ({ l, i })).filter(s => s.l.kind !== "wait");
  const [step, setStep] = useState(0);
  const [follow, setFollow] = useState(true);
  const now = useNow(5000);
  const cur = steps[step]?.l;
  const stopAt = (id: number): LatLon | null => { const s = r.stops[id]; return s && s.lat != null && s.lon != null ? [s.lat, s.lon] : null; };
  const endOf = (l: Leg): LatLon | null => (l.toStop > 0 ? stopAt(l.toStop) : null) ?? (l.shape.length ? l.shape[l.shape.length - 1] : null);

  // Keep the screen on while walking through the trip.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as any).wakeLock;
    if (isNative) keepAwake(true);
    else wl?.request("screen").then((l: any) => { lock = l; }).catch(() => {});
    return () => { keepAwake(false); lock?.release().catch(() => {}); };
  }, []);

  // The step moves on by itself near the end of a walk or a ride.
  useEffect(() => {
    if (!here || !cur || step >= steps.length - 1) return;
    const end = endOf(cur);
    if (end && metres(here, end) < (cur.kind === "ride" ? 120 : 35)) setStep(s => s + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [here?.[0], here?.[1], step]);

  const prevWait = cur && trip.legs[steps[step].i - 1]?.kind === "wait" ? trip.legs[steps[step].i - 1] : undefined;
  let title = "", detail = "";
  if (cur?.kind === "walk") {
    const end = endOf(cur);
    title = cur.toStop > 0 ? T(`Walk to ${r.stops[cur.toStop]?.name ?? "the stop"}`, `ללכת אל ${r.stops[cur.toStop]?.name ?? "התחנה"}`) : T("Walk to your destination", "ללכת אל היעד");
    detail = here && end ? distanceText(metres(here, end)) : minutesText(Math.round((cur.arr - cur.dep) / 60));
  } else if (cur?.kind === "ride") {
    const line = r.lines[cur.lineId];
    title = T(`Take ${line?.number ?? "the line"} to ${r.stops[cur.toStop]?.name ?? ""}`, `לעלות על ${line?.number ?? "הקו"} עד ${r.stops[cur.toStop]?.name ?? ""}`);
    const end = endOf(cur);
    const deps = departuresFor(cur, prevWait, live, now);
    const d = deps.find(x => String(x.tripId) === String(cur.tripId)) ?? deps[0];
    detail = here && end && step > 0 && metres(here, stopAt(cur.fromStop) ?? here) > 150
      ? T(`${distanceText(metres(here, end))} to get off`, `${distanceText(metres(here, end))} עד הירידה`)
      : d ? T(`leaves ${minutesText(Math.round((timeOf(d) - now) / 60))}`, `יוצא ${minutesText(Math.round((timeOf(d) - now) / 60))}`) + (isLive(d) ? " ●" : "") : "";
  } else if (cur) { title = T("Continue", "המשיכו"); }

  return (
    <div className="screen nav">
      <MapView className="map-full" lines={lines} points={[...ends, ...vehicles]} user={here} follow={follow ? here : null}
        fit={lines.flatMap(l => l.coords)} fitKey={"nav" + trip.guid} onMove={() => {}} />
      <div className="nav-card card">
        <div className="nav-step dim small">{T(`Step ${step + 1} of ${steps.length}`, `שלב ${step + 1} מתוך ${steps.length}`)}</div>
        <div className="nav-title" dir="auto">{title}</div>
        <div className="nav-detail">{detail}</div>
        {!here && <div className="dim small">{T("Waiting for your location…", "ממתינים למיקום…")}</div>}
        <div className="row-btns">
          <button className="btn" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>{T("Back", "הקודם")}</button>
          <button className="btn" onClick={() => setFollow(f => !f)}>{follow ? T("Free map", "מפה חופשית") : T("Follow me", "מעקב")}</button>
          {step < steps.length - 1
            ? <button className="btn primary" onClick={() => setStep(s => s + 1)}>{T("Next", "הבא")}</button>
            : <button className="btn primary" onClick={onExit}>{T("Arrived", "הגעתי")}</button>}
        </div>
        <button className="link center" onClick={onExit}>{T("End trip", "סיום הנסיעה")}</button>
      </div>
    </div>
  );
}
