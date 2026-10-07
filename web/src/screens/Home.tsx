// The Trip tab before a destination is chosen, laid out as Moovit's home: a search bar, the way to each
// saved place right now, paying for a ride, the saved places and the trips planned lately.
import { useRef, useState } from "react";
import {
  T, api, usePrefs, getPrefs, setPrefs, useHere, useLoad, useNow, clock, agoText, routeTypeOf, soonest,
  type Place, type Favourite, type Itinerary, type Resolved, type RecentTrip, type LatLon, type Boarding,
  minutesTo, timeOf, isLive,
} from "../core.ts";
import { LineBadge, LiveWaves, NextTimes } from "../ui.tsx";
import { SearchGlyph, TripGlyph, BriefcaseGlyph, PinGlyph, MoreGlyph, FromToGlyph, PayGlyph } from "../icons.tsx";

interface PlanResult { itineraries: Itinerary[]; resolved: Resolved }

const HOME = ["home", "בית"], WORK = ["work", "עבודה", "school", "בית ספר", "office", "משרד"];
function placeGlyph(label: string) {
  const l = label.trim().toLowerCase();
  if (HOME.includes(l)) return <TripGlyph size={22} />;
  if (WORK.includes(l)) return <BriefcaseGlyph size={22} />;
  return <PinGlyph size={22} />;
}

export type Opened = { to: Place; it: Itinerary; resolved: Resolved };

export function Home({ onSearch, onGo, onOpen, onTrip, onPay, onAdd }: {
  onSearch: () => void; onGo: (to: Place) => void; onOpen: (o: Opened) => void; onTrip: (t: RecentTrip) => void; onPay: () => void; onAdd: () => void;
}) {
  const prefs = usePrefs();
  const here = useHere();
  // The frequent destinations: the saved places, or the latest trips' ends while there are none.
  const frequent: Favourite[] = prefs.favourites.length ? prefs.favourites
    : prefs.trips.slice(0, 3).map(t => ({ ...t.to, label: t.to.name }));

  return (
    <div className="scroll home">
      <div className="pad">
        <button className="home-search glass" onClick={onSearch}>
          <span>{T("Where do you want to go?", "לאן תרצו להגיע?")}</span>
          <span className="home-search-icon"><SearchGlyph size={18} /></span>
        </button>
      </div>

      {frequent.length > 0 && <Frequent places={frequent} here={here} onGo={onGo} onOpen={onOpen} />}

      <button className="home-row home-pay" onClick={onPay}>
        <span className="home-row-icon lit"><PayGlyph size={24} /></span>
        <b className="grow">{T("Pay for a new ride", "תשלום על נסיעה חדשה")}</b>
        <span className="home-pill">{T("Start", "התחלה")}</span>
      </button>

      <div className="home-head"><span>{T("Favorites", "מועדפים")}</span><button className="link" onClick={onAdd}>{T("Add", "הוספה")}</button></div>
      <ul className="list home-list">
        {!prefs.favourites.length && <li className="pad dim small">{T("Save Home, Work or any place to get there in one tap.", "שמרו את הבית, העבודה או כל מקום כדי להגיע אליו בהקשה אחת.")}</li>}
        {prefs.favourites.map(f => (
          <li key={f.label + f.lat} className="home-fav" onClick={() => onGo(f)}>
            <span className="home-row-icon">{placeGlyph(f.label)}</span>
            <div className="row-main">
              <div className="dest" dir="auto">{f.label}</div>
              <QuickWay to={f} here={here} brief />
              {f.label !== f.name && <div className="dim small" dir="auto">{f.name}{f.detail ? ` · ${f.detail}` : ""}</div>}
            </div>
            <FavMenu f={f} />
          </li>
        ))}
      </ul>

      {prefs.trips.length > 0 && <>
        <div className="home-head"><span>{T("Recent Trips", "נסיעות אחרונות")}</span><button className="link" onClick={() => setPrefs({ trips: [] })}>{T("Clear", "ניקוי")}</button></div>
        <ul className="list home-list">
          {prefs.trips.map(t => (
            <li key={t.at} className="home-trip" onClick={() => onTrip(t)}>
              <span className="home-row-icon dim"><FromToGlyph size={30} /></span>
              <div className="row-main">
                <div dir="auto">{t.from?.name ?? T("Current location", "המיקום הנוכחי")}</div>
                <div className="dest" dir="auto">{t.to.name}</div>
              </div>
              <span className="dim small">{agoText(t.at)}</span>
            </li>
          ))}
        </ul>
      </>}
    </div>
  );
}

// One card per frequent destination, swiped sideways, with dots under them.
function Frequent({ places, here, onGo, onOpen }: { places: Favourite[]; here: LatLon | null; onGo: (p: Place) => void; onOpen: (o: Opened) => void }) {
  const [at, setAt] = useState(0);
  // The way each card shows, so a tap opens that very ride rather than every way there.
  const shown = useRef(new Map<number, { it: Itinerary; resolved: Resolved }>());
  const strip = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = strip.current; if (!el) return;
    setAt(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };
  return (
    <div className="frequent">
      <div className="frequent-strip" ref={strip} onScroll={onScroll}>
        {places.map((p, i) => (
          <button key={p.label + p.lat} className="card frequent-card" onClick={() => { const w = shown.current.get(i); if (w) onOpen({ to: p, ...w }); else onGo(p); }}>
            <div className="frequent-head">{T("My Frequent Destination", "היעד הקבוע שלי")}</div>
            <div className="frequent-to" dir="auto">{T("To: ", "אל: ")}{p.label}</div>
            {/* Only the card in view asks Moovit, and its neighbours once swiped to. */}
            {Math.abs(i - at) <= 1 ? <QuickWay to={p} here={here} onWay={w => { if (w) shown.current.set(i, w); else shown.current.delete(i); }} /> : <div className="frequent-wait" />}
          </button>
        ))}
      </div>
      {places.length > 1 && <div className="dots">{places.map((p, i) => <span key={p.label + p.lat} className={i === at ? "on" : ""} />)}</div>}
    </div>
  );
}

// The best way there right now: how long, when it arrives, which lines, when the first one leaves.
function QuickWay({ to, here, brief, onWay }: {
  to: Place; here: LatLon | null; brief?: boolean; onWay?: (w: { it: Itinerary; resolved: Resolved } | null) => void;
}) {
  const prefs = usePrefs();
  const now = useNow(15000);
  // A fresh plan every two minutes, from roughly where you are.
  const key = here ? `quick:${to.lat},${to.lon}:${here[0].toFixed(3)},${here[1].toFixed(3)}:${prefs.modes.join()}:${Math.floor(Date.now() / 120000)}` : null;
  const plan = useLoad<PlanResult>(key, s => api("plan", {
    from: here, to: [to.lat, to.lon], routeTypes: prefs.modes.length ? prefs.modes : undefined, when: 0, timeType: 2,
  }, s), 120000, true);
  if (!here) return brief ? null : <div className="dim small frequent-wait">{T("Waiting for your location…", "ממתינים למיקום שלכם…")}</div>;
  const pick = plan.data ? soonest(plan.data.itineraries, plan.data.resolved, now) : null;
  if (!pick) return brief ? null : <div className="dim small frequent-wait">{plan.loading ? T("Finding the way…", "מחפשים דרך…") : plan.error ? T("No way found right now.", "לא נמצאה דרך כרגע.") : ""}</div>;
  const { it: best, b } = pick;
  onWay?.({ it: best, resolved: plan.data!.resolved });
  const r = plan.data!.resolved;
  const mins = Math.max(1, Math.round((best.arr - now) / 60));
  const badge = b && <LineBadge number={b.numbers.join(" / ")} type={routeTypeOf(r, b.ride.lineId)} />;
  if (brief) return <div className="quick brief">{badge}{b ? <Arrives b={b} now={now} short /> : <span className="dim">{T(`${mins} min`, `${mins} דק׳`)}</span>}</div>;
  return (
    <div className="quick">
      <div><b>{T(`${mins} min`, `${mins} דק׳`)}</b> <span className="dim">• {T(`Arrive at ${clock(best.arr)}`, `הגעה ב-${clock(best.arr)}`)}</span></div>
      {badge && <div className="quick-lines">{badge}</div>}
      {b && <Arrives b={b} now={now} />}
    </div>
  );
}

// When the vehicle is at your stop, and how long you ride it. The soonest one is shown even when the walk
// is longer than the wait ("probably too soon"), then the two after it.
export function Arrives({ b, now, short }: { b: Boarding; now: number; short?: boolean }) {
  const first = b.next[0] ?? b.dep;
  const at = first ? timeOf(first) : b.at;
  const live = first ? isLive(first) : b.live;
  const m = minutesTo(at, now);
  const tooSoon = b.walkMin > 0 && at - now < b.walkMin * 60;
  const after = b.next.slice(first === b.next[0] ? 1 : 0, (first === b.next[0] ? 1 : 0) + 2);
  const when = <span className={(live ? "live-text" : "soon-text") + (m <= 0 ? " arriving" : "")}>{live && <LiveWaves />}
    <b>{m <= 0 ? T("now", "עכשיו") : m >= 60 ? clock(at) : m}</b>{m > 0 && m < 60 && " " + T("min", "דק׳")}</span>;
  const lead = m <= 0 ? T("Here", "מגיע") : m >= 60 ? T("Here at", "מגיע ב-") : T("Here in", "מגיע בעוד");
  const soon = tooSoon && <span className="too-soon"> · {T("probably too soon", "כנראה מוקדם מדי")}</span>;
  const then = after.length > 0 && <span className="dim"> · {T("then ", "אחר כך ")}<NextTimes ds={after} now={now} /></span>;
  if (short) return <span className="arrives short">{lead} {when}{soon}{then}<span className="dim"> · {T(`ride ${b.rideMin} min`, `נסיעה ${b.rideMin} דק׳`)}</span></span>;
  return (
    <div className="arrives">
      <div>{m <= 0 ? T("At your stop", "בתחנה שלך") : m >= 60 ? T("At your stop at", "בתחנה שלך ב-") : T("At your stop in", "בתחנה שלך בעוד")} {when}{soon}</div>
      {after.length > 0 && <div className="dim small">{T("then ", "אחר כך ")}<NextTimes ds={after} now={now} /></div>}
      <div className="dim small"><bdi>{b.stop}</bdi>{b.walkMin > 0 ? T(` · ${b.walkMin} min walk`, ` · ${b.walkMin} דק׳ הליכה`) : ""}</div>
      <div className="dim small">{T(`Ride: ${b.rideMin} min`, `זמן נסיעה: ${b.rideMin} דק׳`)}</div>
    </div>
  );
}

function FavMenu({ f }: { f: Favourite }) {
  const remove = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(T(`Remove ${f.label} from your favorites?`, `להסיר את ${f.label} מהמועדפים?`))) setPrefs({ favourites: getPrefs().favourites.filter(x => x.label !== f.label || x.lat !== f.lat) });
  };
  return <button className="icon-btn" onClick={remove} aria-label={T("More", "עוד")}><MoreGlyph size={18} /></button>;
}
