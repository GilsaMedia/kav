import { useState, type ComponentType } from "react";
import { T, usePrefs, setPrefs, type LatLon, type Look } from "./core.ts";
import { AccentPicker } from "./Accent.tsx";
import { Onboarding, SupportPrompt } from "./Onboarding.tsx";
import { Header, stayPut } from "./ui.tsx";
import { DirectionsGlyph, StationTabGlyph, LinesTabGlyph, LiveTabGlyph, TicketGlyph, GearGlyph } from "./icons.tsx";
import { isNative, removeMap, getMapState } from "./native.ts";
import { PlanScreen } from "./screens/Plan.tsx";
import { StationsScreen } from "./screens/Stations.tsx";
import { LinesScreen } from "./screens/Lines.tsx";
import { LiveScreen } from "./screens/Live.tsx";
import { PayScreen } from "./screens/Pay.tsx";

type Tab = "plan" | "stations" | "lines" | "live" | "pay" | "settings";

// As Moovit names and draws them: the tab you are on is filled and lit.
const TABS: { tab: Tab; Icon: ComponentType<{ size?: number; on?: boolean }>; label: () => string }[] = [
  { tab: "plan", Icon: DirectionsGlyph, label: () => T("Directions", "מסלולים") },
  { tab: "stations", Icon: StationTabGlyph, label: () => T("Stations", "תחנות") },
  { tab: "lines", Icon: LinesTabGlyph, label: () => T("Lines", "קווים") },
  { tab: "live", Icon: LiveTabGlyph, label: () => T("Live", "חי") },
  { tab: "pay", Icon: TicketGlyph, label: () => T("Tickets", "כרטיסים") },
  { tab: "settings", Icon: GearGlyph, label: () => T("Settings", "הגדרות") },
];

export function App() {
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("kav-tab") as Tab) || "plan");
  const [liveSeen, setLiveSeen] = useState(false);
  if (tab === "live" && !liveSeen) setLiveSeen(true);
  const [payStart, setPayStart] = useState<{ at?: LatLon; routeType?: number } | null>(null);
  // Tabs crossfade, as on Android: the screen inside doesn't slide.
  const go = (t: Tab) => { if (t !== tab) stayPut(); setTab(t); try { sessionStorage.setItem("kav-tab", t); } catch { /* ignore */ } };

  // The first launch sets Kav up before anything else, as on Android.
  if (!prefs.onboarded) return <div className="app" key={prefs.lang}><Onboarding onDone={() => setPrefs({ onboarded: true })} /></div>;

  return (
    <div className="app" key={prefs.lang}>
      <main className="main">
        {/* Screens stay mounted, so a trip or a board is still there after a look at another tab. */}
        <div hidden={tab !== "plan"} className="tab-page"><PlanScreen onPay={(at, routeType) => { setPayStart({ at, routeType }); go("pay"); }} /></div>
        <div hidden={tab !== "stations"} className="tab-page"><StationsScreen /></div>
        <div hidden={tab !== "lines"} className="tab-page"><LinesScreen /></div>
        {/* Live stays too once opened: its map and vehicles are there when you come back. */}
        {(tab === "live" || liveSeen) && <div hidden={tab !== "live"} className="tab-page"><LiveScreen /></div>}
        {tab === "pay" && <div className="tab-page"><PayScreen start={payStart} onStarted={() => setPayStart(null)} /></div>}
        {tab === "settings" && <div className="tab-page"><Settings /></div>}
      </main>
      <nav className="tabbar">
        {TABS.map(({ tab: t, Icon, label }) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)} aria-current={tab === t ? "page" : undefined}>
            <Icon size={26} on={tab === t} /><span className="tab-label">{label()}</span>
          </button>
        ))}
      </nav>
      {!prefs.supportShown && <SupportPrompt onDone={() => setPrefs({ supportShown: true })} />}
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
          <button className="btn" onClick={() => setPrefs({ onboarded: false })}>{T("Run setup again", "הפעלת ההגדרה הראשונית מחדש")}</button>
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
