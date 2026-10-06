// Small pieces every screen uses.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import qrcode from "qrcode-generator";
import {
  T, api, usePrefs, getPrefs, setPrefs, remember, useHere, modeColor, modeName, distanceText, metres, currentHere, locateOnce, failure,
  type Place,
} from "./core.ts";

export function Header({ title, sub, back, right }: { title: string; sub?: string; back?: () => void; right?: ReactNode }) {
  return (
    <header className="header">
      {back && <button className="icon-btn back" onClick={back} aria-label={T("Back", "חזרה")}>‹</button>}
      <div className="header-text">
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right}
    </header>
  );
}

export function LineBadge({ number, type, small }: { number: string; type: number; small?: boolean }) {
  const bg = modeColor(type);
  // Trains are named for their whole route ("Herzliya - Jerusalem/Yitzhak Navon"): the mode reads better on a badge.
  const text = !number || number.length > 8 ? modeName(type) : number;
  return <span className={"badge" + (small ? " small" : "")} style={{ background: bg, color: type === 715 ? "#16160F" : "#fff" }} dir="auto" title={number}>{text}</span>;
}

export function Spinner({ text }: { text?: string }) {
  return <div className="spinner-row"><span className="spinner" />{text && <span>{text}</span>}</div>;
}

export function Note({ children, tone }: { children: ReactNode; tone?: "error" | "warn" }) {
  return <div className={"note" + (tone ? " " + tone : "")}>{children}</div>;
}

export function LiveDot() { return <span className="live-dot" aria-label={T("live", "בזמן אמת")} />; }

export function Sheet({ children, onClose, title }: { children: ReactNode; onClose: () => void; title?: string }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
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

  return (
    <div className="overlay">
      <Header title={title} back={onClose} />
      <div className="pad">
        <input ref={input} className="field" value={q} onChange={e => setQ(e.target.value)} dir="auto"
          placeholder={T("Search a place, address or stop", "חיפוש מקום, כתובת או תחנה")} enterKeyHint="search" />
      </div>
      <div className="scroll">
        {err && <div className="pad"><Note tone="error">{err}</Note></div>}
        {!results && (
          <ul className="list">
            {allowHere && <li className="row" onClick={pickHere}><span className="row-icon">◎</span><div className="row-main"><div>{HERE_NAME()}</div></div></li>}
            {prefs.favourites.map(f => (
              <li key={"f" + f.label + f.lat} className="row" onClick={() => pick(f)}>
                <span className="row-icon">★</span>
                <div className="row-main"><div>{f.label}</div><div className="dim">{f.name}</div></div>
              </li>
            ))}
            {prefs.recents.length > 0 && <li className="list-head">{T("Recent", "אחרונים")}</li>}
            {prefs.recents.map((p, i) => (
              <li key={"r" + i} className="row" onClick={() => pick(p)}>
                <span className="row-icon">↺</span>
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
                <span className="row-icon">⌖</span>
                <div className="row-main"><div dir="auto">{p.name}</div>{p.detail && <div className="dim" dir="auto">{p.detail}</div>}</div>
                <span className="dim small">{far(p)}</span>
              </li>
            ))}
            {results.stops.length > 0 && <li className="list-head">{T("Stops", "תחנות")}</li>}
            {results.stops.map(s => (
              <li key={"s" + s.i} className="row" onClick={() => pick({ name: s.name, detail: s.city, lat: s.lat, lon: s.lon, type: 1 })}>
                <span className="row-icon" style={{ color: modeColor(s.type) }}>●</span>
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
          {[T("Home", "בית"), T("Work", "עבודה")].map(n => <button key={n} className="chip" onClick={() => setLabel(n)}>{n}</button>)}
        </div>
        <input className="field" value={label} onChange={e => setLabel(e.target.value)} dir="auto" />
        <button className="btn primary" onClick={save} disabled={!label.trim()}>{T("Save", "שמירה")}</button>
      </div>
    </Sheet>
  );
}
