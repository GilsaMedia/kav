// Small pieces every screen uses.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BackGlyph, ModeGlyph, modeOf, StationMark, StarGlyph, RecentGlyph, PinGlyph, LocateGlyph, SearchGlyph } from "./icons.tsx";
import qrcode from "qrcode-generator";
import {
  T, api, usePrefs, getPrefs, setPrefs, remember, useHere, modeName, distanceText, metres, currentHere, locateOnce, failure,
  clock, timeOf, isLive, isCancelled, type Place, type Departure,
} from "./core.ts";

// ---- when it comes ---------------------------------------------------------------------------

// Late by two minutes or more against the timetable.
export const isLate = (d: Departure) => d.rtUtc > 0 && d.staticUtc > 0 && d.rtUtc - d.staticUtc >= 120;

// Moovit's signal: two arcs over the time, breathing while the vehicle reports where it is.
export const LiveWaves = () => (
  <svg className="waves" viewBox="0 0 16 10" width={14} height={9} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <path className="w1" d="M5.5 7.5a3.5 3.5 0 0 1 5 0" /><path className="w2" d="M2.5 4.8a7.5 7.5 0 0 1 11 0" />
  </svg>
);

// The time a departure really comes: one number, as Moovit shows it. A late one says so instead of adding
// its delay on top ("3 min, delayed", never "1 min +2").
export function Eta({ d, now, inline }: { d: Departure; now: number; inline?: boolean }) {
  const t = timeOf(d);
  if (isCancelled(d)) return <span className={"eta cancelled" + (inline ? " inline" : "")}><b>{clock(d.staticUtc)}</b><small>{T("cancelled", "בוטל")}</small></span>;
  const mins = Math.max(0, Math.round((t - now) / 60));
  const live = isLive(d), late = isLate(d);
  const label = mins <= 0 ? T("now", "עכשיו") : mins < 60 ? T(`in ${mins} minutes`, `בעוד ${mins} דקות`) : clock(t);
  return (
    <span className={"eta" + (live ? " live" : "") + (late ? " late" : "") + (inline ? " inline" : "")} aria-label={label + (late ? T(", delayed", ", באיחור") : "")}>
      {live && <LiveWaves />}
      {mins <= 0 ? <b>{T("now", "עכשיו")}</b> : mins < 60 ? <><b>{mins}</b><small>{T("min", "דק׳")}</small></> : <b>{clock(t)}</b>}
      {late && <small className="eta-late">{T("delayed", "באיחור")}</small>}
    </span>
  );
}

// The ones after the first, small: "12, 25 min".
export function NextTimes({ ds, now }: { ds: Departure[]; now: number }) {
  if (!ds.length) return null;
  const parts = ds.map(d => { const m = Math.max(0, Math.round((timeOf(d) - now) / 60)); return m < 60 ? String(m) : clock(timeOf(d)); });
  const allMinutes = ds.every(d => timeOf(d) - now < 3600);
  return <span className="next-times">{parts.join(", ")}{allMinutes ? " " + T("min", "דק׳") : ""}</span>;
}

// Going back, the screen underneath fades up where it is instead of sliding in. Tabs crossfade the same way.
let stayTimer = 0;
export function stayPut() {
  const html = document.documentElement;
  html.style.setProperty("--slide", "0px");
  clearTimeout(stayTimer);
  stayTimer = window.setTimeout(() => html.style.removeProperty("--slide"), 420);
}
export const goBack = (back: () => void) => () => { stayPut(); back(); };

export function Header({ title, sub, back, right }: { title: string; sub?: string; back?: () => void; right?: ReactNode }) {
  return (
    <header className="header">
      {back && <button className="plate-btn" onClick={goBack(back)} aria-label={T("Back", "חזרה")}><BackGlyph /></button>}
      <div className="header-text">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </header>
  );
}

// The Android app's plates (fill, edge, ink). Buses and everything else wear glass.
const PLATES: Record<string, [string, string, string]> = {
  rail: ["#1F6FD0", "#1854A3", "#F3F7FC"], tram: ["#D8232A", "#A81A20", "#FCF4F4"], taxi: ["#F5C518", "#C79D0E", "#16160F"],
  carmelit: ["#0A822E", "#086423", "#F2FBF4"], rakavlit: ["#8950D4", "#693EA3", "#F7F4FD"],
};
function plateFor(type: number) {
  const m = modeOf(type);
  return type === 2 ? PLATES.rail : m === "tram" ? PLATES.tram : m === "taxi" ? PLATES.taxi
    : m === "funicular" ? PLATES.carmelit : m === "cable" || m === "gondola" ? PLATES.rakavlit : null;
}

export function LineBadge({ number, type, small }: { number: string; type: number; small?: boolean }) {
  const plate = plateFor(type);
  // Trains are named for their whole route ("Herzliya - Jerusalem/Yitzhak Navon"): the mode reads better on a badge.
  const text = !number || number.length > 8 ? modeName(type) : number;
  const style = plate ? { "--plate-fill": plate[0], "--plate-edge": plate[1], "--plate-ink": plate[2], "--plate-glyph": plate[2] } as CSSProperties : undefined;
  return <span className={"badge" + (small ? " small" : "")} style={style} dir="auto" title={number}>
    <ModeGlyph type={type} size={small ? 11 : 12} />{text}
  </span>;
}

// FastOutSlowIn, cubic-bezier(.4, 0, .2, 1), for the loader's dot.
function fastOutSlowIn(x: number) {
  const bez = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (bez(m, .4, .2) < x) lo = m; else hi = m; }
  return bez((lo + hi) / 2, 0, 1);
}

// A dot riding a line through three stops, as the Android app shows while it waits.
export function LoadingPulse({ text, wide }: { text?: string; wide?: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const w = wide ? 200 : 150, h = 32, inset = 10, y = h / 2;
  const stops = [0, .5, 1].map(f => inset + f * (w - inset * 2));
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const svg = ref.current;
      if (!svg) return;
      const glow = ((now - t0) % 1500) / 1500;
      const x = stops[0] + fastOutSlowIn(glow) * (stops[2] - stops[0]);
      svg.querySelector(".lp-run")!.setAttribute("x2", String(x));
      svg.querySelectorAll(".lp-dot").forEach(d => d.setAttribute("cx", String(x)));
      svg.querySelectorAll<SVGCircleElement>(".lp-stop").forEach((c, i) => {
        const passed = x >= stops[i] - 1, near = Math.min(1, Math.max(0, 1 - Math.abs(x - stops[i]) / (w * .22)));
        c.setAttribute("r", passed ? "5.5" : "4.5");
        c.style.fill = passed ? "var(--accent)" : "none";
        c.style.stroke = passed ? "none" : "var(--s4)";
        c.style.opacity = passed ? String(.55 + .45 * near) : "1";
      });
      const halo = svg.querySelector<SVGCircleElement>(".lp-halo")!;
      halo.setAttribute("r", String(11 * (1 + glow)));
      halo.style.opacity = x >= stops[2] - 1 ? String(.25 * (1 - glow)) : "0";
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [w]);
  return (
    <div className={"loading" + (wide ? " wide" : "")} role="status" aria-label={text}>
      <svg ref={ref} width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="glyph flip">
        <line x1={stops[0]} y1={y} x2={stops[2]} y2={y} stroke="var(--s4)" strokeWidth={3} strokeLinecap="round" />
        <line className="lp-run" x1={stops[0]} y1={y} x2={stops[0]} y2={y} stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" />
        <circle className="lp-halo" cx={stops[2]} cy={y} r={11} fill="var(--accent)" opacity={0} />
        {stops.map(sx => <g key={sx}><circle cx={sx} cy={y} r={7} fill="var(--bg)" /><circle className="lp-stop" cx={sx} cy={y} r={4.5} strokeWidth={2} /></g>)}
        <circle className="lp-dot" cx={stops[0]} cy={y} r={9} fill="var(--bg)" />
        <circle className="lp-dot" cx={stops[0]} cy={y} r={6} fill="var(--accent)" />
      </svg>
      {text && <span>{text}</span>}
    </div>
  );
}

export function Spinner({ text, wide }: { text?: string; wide?: boolean }) {
  return <LoadingPulse text={text} wide={wide} />;
}

// Plays the way out, then lets the caller unmount it.
export function useLeaving(onGone: () => void, ms = 230): [boolean, () => void] {
  const [leaving, setLeaving] = useState(false);
  const gone = useRef(onGone);
  gone.current = onGone;
  const leave = () => { if (leaving) return; setLeaving(true); window.setTimeout(() => gone.current(), ms); };
  return [leaving, leave];
}

export function Note({ children, tone }: { children: ReactNode; tone?: "error" | "warn" }) {
  return <div className={"note" + (tone ? " " + tone : "")}>{children}</div>;
}

export function LiveDot() { return <span className="live-dot" aria-label={T("live", "בזמן אמת")} />; }

export function Sheet({ children, onClose, title }: { children: ReactNode; onClose: () => void; title?: string }) {
  const [leaving, leave] = useLeaving(onClose);
  return (
    <div className={"sheet-backdrop" + (leaving ? " leaving" : "")} onClick={leave}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog">
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Qr({ text, size = 240 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M"); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ---- choosing a place ------------------------------------------------------------------------

interface GtfsStop { i: number; name: string; city: string; code: number; lat: number; lon: number; type: number }

export const HERE_NAME = () => T("Current location", "המיקום הנוכחי");

export function PlacePicker({ title, onPick, onClose, allowHere = true }: {
  title: string; onPick: (p: Place) => void; onClose: () => void; allowHere?: boolean;
}) {
  const prefs = usePrefs();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ places: Place[]; stops: GtfsStop[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const here = useHere();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setResults(null); return; }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      const at = currentHere();
      api(`places?q=${encodeURIComponent(text)}${at ? `&lat=${at[0]}&lon=${at[1]}` : ""}`, undefined, ac.signal)
        .then(setResults, e => { if (!ac.signal.aborted) setErr(failure(e)); })
        .finally(() => { if (!ac.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q]);

  const pick = (p: Place) => { remember(p); onPick(p); };
  const pickHere = async () => {
    setErr(null);
    try { const at = await locateOnce(); onPick({ name: HERE_NAME(), detail: "", lat: at[0], lon: at[1], type: -1 }); }
    catch (e) { setErr((e as Error).message); }
  };
  const far = (p: { lat: number; lon: number }) => here ? distanceText(metres(here, [p.lat, p.lon])) : "";
  const [leaving, leave] = useLeaving(onClose, 240);

  return (
    <div className={"overlay" + (leaving ? " leaving" : "")}>
      <Header title={title} back={leave} />
      <div className="pad search-field">
        <SearchGlyph size={18} />
        <input ref={input} className="field" value={q} onChange={e => setQ(e.target.value)} dir="auto"
          placeholder={T("Search a place, address or stop", "חיפוש מקום, כתובת או תחנה")} enterKeyHint="search" />
      </div>
      <div className="scroll">
        {err && <div className="pad"><Note tone="error">{err}</Note></div>}
        {!results && (
          <ul className="list">
            {allowHere && <li className="row" onClick={pickHere}><span className="row-icon lit"><LocateGlyph size={18} /></span><div className="row-main"><div>{HERE_NAME()}</div></div></li>}
            {prefs.favourites.map(f => (
              <li key={"f" + f.label + f.lat} className="row" onClick={() => pick(f)}>
                <span className="row-icon lit"><StarGlyph size={18} filled /></span>
                <div className="row-main"><div>{f.label}</div><div className="dim">{f.name}</div></div>
              </li>
            ))}
            {prefs.recents.length > 0 && <li className="list-head">{T("Recent", "אחרונים")}</li>}
            {prefs.recents.map((p, i) => (
              <li key={"r" + i} className="row" onClick={() => pick(p)}>
                <span className="row-icon"><RecentGlyph size={18} /></span>
                <div className="row-main"><div dir="auto">{p.name}</div>{p.detail && <div className="dim" dir="auto">{p.detail}</div>}</div>
                <span className="dim small">{far(p)}</span>
              </li>
            ))}
          </ul>
        )}
        {results && (
          <ul className="list">
            {busy && <li className="pad"><Spinner /></li>}
            {results.places.map((p, i) => (
              <li key={"p" + i} className="row" onClick={() => pick(p)}>
                <span className="row-icon"><PinGlyph size={18} /></span>
                <div className="row-main"><div dir="auto">{p.name}</div>{p.detail && <div className="dim" dir="auto">{p.detail}</div>}</div>
                <span className="dim small">{far(p)}</span>
              </li>
            ))}
            {results.stops.length > 0 && <li className="list-head">{T("Stops", "תחנות")}</li>}
            {results.stops.map(s => (
              <li key={"s" + s.i} className="row" onClick={() => pick({ name: s.name, detail: s.city, lat: s.lat, lon: s.lon, type: 1 })}>
                <span className="row-icon"><StationMark type={s.type} /></span>
                <div className="row-main"><div dir="auto">{s.name}</div><div className="dim">{s.city}{s.code > 0 ? ` · ${s.code}` : ""}</div></div>
                <span className="dim small">{far(s)}</span>
              </li>
            ))}
            {!busy && !results.places.length && !results.stops.length && <li className="pad dim">{results.error ? failure(new Error(results.error)) : T("Nothing found", "לא נמצאו תוצאות")}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SaveFavourite({ place, onDone }: { place: Place; onDone: () => void }) {
  const [label, setLabel] = useState(place.name);
  const save = () => {
    const favourites = [...getPrefs().favourites.filter(f => f.label !== label), { ...place, label }];
    setPrefs({ favourites });
    onDone();
  };
  return (
    <Sheet onClose={onDone} title={T("Save place", "שמירת מקום")}>
      <div className="stack">
        <div className="chips">
          {[T("Home", "בית"), T("Work", "עבודה")].map(n => <button key={n} className={"chip" + (label === n ? " on" : "")} onClick={() => setLabel(n)}>{n}</button>)}
        </div>
        <input className="field" value={label} onChange={e => setLabel(e.target.value)} dir="auto" />
        <button className="btn primary" onClick={save} disabled={!label.trim()}>{T("Save", "שמירה")}</button>
      </div>
    </Sheet>
  );
}
