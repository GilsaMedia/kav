import { useRef, useState, type ComponentType } from "react";
import { T, usePrefs, setPrefs, DEFAULT_ACCENT, type LatLon, type Look } from "./core.ts";
import { Header, stayPut } from "./ui.tsx";
import { TripGlyph, StationsGlyph, LinesGlyph, LiveGlyph, PayGlyph, GearGlyph } from "./icons.tsx";
import { isNative, removeMap, getMapState } from "./native.ts";
import { PlanScreen } from "./screens/Plan.tsx";
import { StationsScreen } from "./screens/Stations.tsx";
import { LinesScreen } from "./screens/Lines.tsx";
import { LiveScreen } from "./screens/Live.tsx";
import { PayScreen } from "./screens/Pay.tsx";

type Tab = "plan" | "stations" | "lines" | "live" | "pay" | "settings";

const TABS: { tab: Tab; Icon: ComponentType<{ size?: number }>; label: () => string }[] = [
  { tab: "plan", Icon: TripGlyph, label: () => T("Trip", "מסלול") },
  { tab: "stations", Icon: StationsGlyph, label: () => T("Stations", "תחנות") },
  { tab: "lines", Icon: LinesGlyph, label: () => T("Lines", "קווים") },
  { tab: "live", Icon: LiveGlyph, label: () => T("Live", "חי") },
  { tab: "pay", Icon: PayGlyph, label: () => T("Pay", "תשלום") },
  { tab: "settings", Icon: GearGlyph, label: () => T("Settings", "הגדרות") },
];

export function App() {
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("kav-tab") as Tab) || "plan");
  const [payStart, setPayStart] = useState<{ at?: LatLon; routeType?: number } | null>(null);
  // Tabs crossfade, as on Android: the screen inside doesn't slide.
  const go = (t: Tab) => { if (t !== tab) stayPut(); setTab(t); try { sessionStorage.setItem("kav-tab", t); } catch { /* ignore */ } };

  return (
    <div className="app" key={prefs.lang}>
      <main className="main">
        {/* Screens stay mounted, so a trip or a board is still there after a look at another tab. */}
        <div hidden={tab !== "plan"} className="tab-page"><PlanScreen onPay={(at, routeType) => { setPayStart({ at, routeType }); go("pay"); }} /></div>
        <div hidden={tab !== "stations"} className="tab-page"><StationsScreen /></div>
        <div hidden={tab !== "lines"} className="tab-page"><LinesScreen /></div>
        {tab === "live" && <div className="tab-page"><LiveScreen /></div>}
        {tab === "pay" && <div className="tab-page"><PayScreen start={payStart} onStarted={() => setPayStart(null)} /></div>}
        {tab === "settings" && <div className="tab-page"><Settings /></div>}
      </main>
      <nav className="tabbar" style={{ "--n": TABS.length, "--i": TABS.findIndex(t => t.tab === tab) } as React.CSSProperties}>
        <span className="tab-ind" aria-hidden="true" />
        {TABS.map(({ tab: t, Icon, label }) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)} aria-current={tab === t ? "page" : undefined}>
            <Icon size={20} /><span className="tab-label">{label()}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Settings() {
  const prefs = usePrefs();
  const looks: { look: Look; label: string }[] = [
    { look: "black", label: T("OLED black", "שחור OLED") }, { look: "dark", label: T("Dark", "כהה") }, { look: "light", label: T("Light", "בהיר") },
  ];
  return (
    <div className="screen">
      <Header title={T("Settings", "הגדרות")} />
      <div className="scroll">
        <div className="pad stack">
          <div className="list-head">{T("Language", "שפה")}</div>
          <div className="segmented">
            <button className={prefs.lang === "he" ? "on" : ""} onClick={() => setPrefs({ lang: "he" })}>עברית</button>
            <button className={prefs.lang === "en" ? "on" : ""} onClick={() => setPrefs({ lang: "en" })}>English</button>
          </div>
          <div className="list-head">{T("Look", "מראה")}</div>
          <div className="segmented">{looks.map(l => <button key={l.look} className={prefs.look === l.look ? "on" : ""} onClick={() => setPrefs({ look: l.look })}>{l.label}</button>)}</div>
          <label className="toggle card pad">
            <div>
              <div>{T("Liquid glass", "זכוכית נוזלית")}</div>
              <div className="dim small">{T("Bars and buttons show the page through them. Off, they're solid.", "הסרגלים והכפתורים שקופים ומראים את הדף מאחוריהם. כבוי, הם אטומים.")}</div>
            </div>
            <input type="checkbox" className="switch" checked={prefs.liquid} onChange={e => setPrefs({ liquid: e.target.checked })} />
          </label>
          <div className="list-head">{T("Accent", "צבע הדגשה")}</div>
          <div className="card pad stack center-items"><AccentPicker /></div>
          <div className="list-head">{T("Privacy", "פרטיות")}</div>
          <label className="toggle card pad">
            <div>
              <div>{T("Private search", "חיפוש פרטי")}</div>
              <div className="dim small">{T("Moovit only sees the centre of the town you're in when you search, not your exact location.",
                "בזמן חיפוש Moovit רואה רק את מרכז העיר שבה אתם נמצאים, ולא את המיקום המדויק שלכם.")}</div>
            </div>
            <input type="checkbox" className="switch" checked={prefs.privateSearch} onChange={e => setPrefs({ privateSearch: e.target.checked })} />
          </label>
          <div className="list-head">{T("Saved", "שמורים")}</div>
          <button className="btn" onClick={() => { if (confirm(T("Clear recent places?", "לנקות את המקומות האחרונים?"))) setPrefs({ recents: [] }); }}>{T("Clear recent places", "ניקוי מקומות אחרונים")}</button>
          {isNative && getMapState().k === "ready" && <button className="btn" onClick={() => { if (confirm(T("Remove the map from this phone? It can be downloaded again.", "להסיר את המפה מהטלפון? אפשר להוריד אותה שוב."))) removeMap(); }}>{T("Remove the map (185 MB)", "הסרת המפה (185 MB)")}</button>}
          <p className="dim small">{isNative ? T(
            "Kav plans with Moovit, reads the Ministry of Transport's timetable from inside the app, and draws OpenStreetMap from a file on this phone. No ads, no account, no analytics.",
            "Kav מתכננת עם Moovit, קוראת את לוח הזמנים של משרד התחבורה מתוך האפליקציה, ומציירת את OpenStreetMap מקובץ שבטלפון. בלי פרסומות, בלי חשבון ובלי מעקב.") : T(
            "Kav for the web runs on your own computer: it plans with Moovit, reads the Ministry of Transport's timetable, and draws OpenStreetMap from a file on that computer. No ads, no account, no analytics.",
            "Kav לרשת רצה על המחשב שלכם: היא מתכננת עם Moovit, קוראת את לוח הזמנים של משרד התחבורה, ומציירת את OpenStreetMap מקובץ שעל המחשב. בלי פרסומות, בלי חשבון ובלי מעקב.")}</p>
          <p className="dim small">Map data © OpenStreetMap contributors, Protomaps · Timetable: Israel Ministry of Transport · <a href="https://github.com/ImNoammm/kav" target="_blank" rel="noreferrer">Kav</a> (GPL-3.0)</p>
        </div>
      </div>
    </div>
  );
}

// ---- the accent: a wheel of pale colours and the Android app's presets --------------------------

const MAX_SAT = .62;
const PRESETS: { en: string; he: string; hue: number; sat: number }[] = [
  { en: "Blue", he: "כחול", hue: 219, sat: .40 }, { en: "Green", he: "ירוק", hue: 140, sat: .38 },
  { en: "Teal", he: "טורקיז", hue: 178, sat: .42 }, { en: "Violet", he: "סגול", hue: 262, sat: .34 },
  { en: "Amber", he: "ענבר", hue: 44, sat: .48 }, { en: "Pink", he: "ורוד", hue: 338, sat: .36 },
  { en: "White", he: "לבן", hue: 0, sat: 0 },
];

// HSV with full value, as Compose's Color.hsv.
function hsv(h: number, s: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function toHsv(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max === 0 ? 0 : d / max];
}

function AccentPicker() {
  const prefs = usePrefs();
  const wheel = useRef<HTMLDivElement>(null);
  const [hue, sat] = toHsv(/^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : DEFAULT_ACCENT);
  const pick = (e: React.PointerEvent) => {
    const box = wheel.current!.getBoundingClientRect();
    const r = box.width / 2, dx = e.clientX - box.left - r, dy = e.clientY - box.top - r;
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    setPrefs({ accent: hsv(h, Math.min(1, Math.hypot(dx, dy) / (r * .92)) * MAX_SAT) });
  };
  const a = hue * Math.PI / 180, dist = Math.min(1, sat / MAX_SAT) * 50 * .92;
  return (
    <>
      <div ref={wheel} className="wheel" aria-label={T("Colour wheel", "גלגל צבעים")}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
        onPointerMove={e => { if (e.buttons) pick(e); }}>
        <span className="wheel-dot" style={{ left: `${50 + Math.cos(a) * dist}%`, top: `${50 + Math.sin(a) * dist}%`, background: prefs.accent }} />
      </div>
      <div className="swatches">
        {PRESETS.map(p => {
          const on = (p.sat < .02 && sat < .02) || (Math.abs(p.hue - hue) < 2 && Math.abs(p.sat - sat) < .02);
          return <button key={p.en} className={"swatch" + (on ? " on" : "")} style={{ background: hsv(p.hue, p.sat) }}
            aria-label={T(p.en, p.he)} onClick={() => setPrefs({ accent: hsv(p.hue, p.sat) })} />;
        })}
      </div>
    </>
  );
}
