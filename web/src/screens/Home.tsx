// The Trip tab before a destination is chosen, laid out as Moovit's home: a search bar, the way to each
// saved place right now, paying for a ride, the saved places and the trips planned lately.
import { useRef, useState } from "react";
import {
  T, api, usePrefs, getPrefs, setPrefs, useHere, useLoad, useNow, clock, agoText, timeOf, isLive, routeTypeOf, options,
  type Place, type Favourite, type Itinerary, type Resolved, type RecentTrip, type LatLon,
} from "../core.ts";
import { LineBadge, LiveWaves } from "../ui.tsx";
import { SearchGlyph, TripGlyph, BriefcaseGlyph, PinGlyph, MoreGlyph, FromToGlyph, PayGlyph } from "../icons.tsx";

interface PlanResult { itineraries: Itinerary[]; resolved: Resolved }

const HOME = ["home", "בית"], WORK = ["work", "עבודה", "school", "בית ספר", "office", "משרד"];
function placeGlyph(label: string) {
  const l = label.trim().toLowerCase();
  if (HOME.includes(l)) return <TripGlyph size={22} />;
  if (WORK.includes(l)) return <BriefcaseGlyph size={22} />;
  return <PinGlyph size={22} />;
}

export function Home({ onSearch, onGo, onTrip, onPay, onAdd }: {
  onSearch: () => void; onGo: (to: Place) => void; onTrip: (t: RecentTrip) => void; onPay: () => void; onAdd: () => void;
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

      {frequent.length > 0 && <Frequent places={frequent} here={here} onGo={onGo} />}

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
function Frequent({ places, here, onGo }: { places: Favourite[]; here: LatLon | null; onGo: (p: Place) => void }) {
  const [at, setAt] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = strip.current; if (!el) return;
    setAt(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };
  return (
    <div className="frequent">
      <div className="frequent-strip" ref={strip} onScroll={onScroll}>
        {places.map((p, i) => (
          <button key={p.label + p.lat} className="card frequent-card" onClick={() => onGo(p)}>
            <div className="frequent-head">{T("My Frequent Destination", "היעד הקבוע שלי")}</div>
            <div className="frequent-to" dir="auto">{T("To: ", "אל: ")}{p.label}</div>
            {/* Only the card in view asks Moovit, and its neighbours once swiped to. */}
            {Math.abs(i - at) <= 1 ? <QuickWay to={p} here={here} /> : <div className="frequent-wait" />}
          </button>
        ))}
      </div>
      {places.length > 1 && <div className="dots">{places.map((p, i) => <span key={p.label + p.lat} className={i === at ? "on" : ""} />)}</div>}
    </div>
  );
}

// The best way there right now: how long, when it arrives, which lines, when the first one leaves.
function QuickWay({ to, here, brief }: { to: Place; here: LatLon | null; brief?: boolean }) {
  const prefs = usePrefs();
  const now = useNow(15000);
  // A fresh plan every two minutes, from roughly where you are.
  const key = here ? `quick:${to.lat},${to.lon}:${here[0].toFixed(3)},${here[1].toFixed(3)}:${prefs.modes.join()}:${Math.floor(Date.now() / 120000)}` : null;
  const plan = useLoad<PlanResult>(key, s => api("plan", {
    from: here, to: [to.lat, to.lon], routeTypes: prefs.modes.length ? prefs.modes : undefined, when: 0, timeType: 2,
  }, s), 120000, true);
  if (!here) return brief ? null : <div className="dim small frequent-wait">{T("Waiting for your location…", "ממתינים למיקום שלכם…")}</div>;
  const best = plan.data?.itineraries.find(it => it.legs.some(l => l.kind === "ride")) ?? plan.data?.itineraries[0];
  if (!best) return brief ? null : <div className="dim small frequent-wait">{plan.loading ? T("Finding the way…", "מחפשים דרך…") : plan.error ? T("No way found right now.", "לא נמצאה דרך כרגע.") : ""}</div>;
  const r = plan.data!.resolved;
  const mins = Math.max(1, Math.round((best.arr - best.dep) / 60));
  const ride = best.legs.find(l => l.kind === "ride");
  const numbers = ride ? options(ride).map(o => r.lines[o.lineId]?.number || o.shortName).filter(Boolean) : [];
  const badge = ride && <LineBadge number={[...new Set(numbers)].slice(0, 3).join(" / ")} type={routeTypeOf(r, ride.lineId)} />;
  if (brief) return <div className="quick brief">{badge}<span className="dim">{T(`Duration: ${mins} min`, `משך: ${mins} דק׳`)}</span></div>;
  const first = ride?.nextDeps[0];
  const leaves = ride ? Math.max(0, Math.round(((first ? timeOf(first) : ride.dep) - now) / 60)) : null;
  const live = !!first && isLive(first);
  return (
    <div className="quick">
      <div><b>{T(`${mins} min`, `${mins} דק׳`)}</b> <span className="dim">• {T(`Arrive at ${clock(best.arr)}`, `הגעה ב-${clock(best.arr)}`)}</span></div>
      {badge && <div className="quick-lines">{badge}</div>}
      {leaves != null && <div className="quick-leaves">{T("Leaves in", "יוצא בעוד")} <span className={live ? "live-text" : ""}>{live && <LiveWaves />}<b>{leaves}</b> {T("min", "דק׳")}</span></div>}
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
