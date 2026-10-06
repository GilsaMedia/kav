import { useState } from "react";
import { T, usePrefs, setPrefs, type LatLon, type Look } from "./core.ts";
import { Header } from "./ui.tsx";
import { isNative, removeMap, getMapState } from "./native.ts";
import { PlanScreen } from "./screens/Plan.tsx";
import { StationsScreen } from "./screens/Stations.tsx";
import { LinesScreen } from "./screens/Lines.tsx";
import { LiveScreen } from "./screens/Live.tsx";
import { PayScreen } from "./screens/Pay.tsx";

type Tab = "plan" | "stations" | "lines" | "live" | "pay" | "settings";

const TABS: { tab: Tab; icon: string; label: () => string }[] = [
  { tab: "plan", icon: "⌖", label: () => T("Trip", "מסלול") },
  { tab: "stations", icon: "◉", label: () => T("Stations", "תחנות") },
  { tab: "lines", icon: "≡", label: () => T("Lines", "קווים") },
  { tab: "live", icon: "◎", label: () => T("Live", "חי") },
  { tab: "pay", icon: "₪", label: () => T("Pay", "תשלום") },
  { tab: "settings", icon: "⚙", label: () => T("Settings", "הגדרות") },
];

export function App() {
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("kav-tab") as Tab) || "plan");
  const [payStart, setPayStart] = useState<{ at?: LatLon; routeType?: number } | null>(null);
  const go = (t: Tab) => { setTab(t); try { sessionStorage.setItem("kav-tab", t); } catch { /* ignore */ } };

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
      <nav className="tabbar">
        {TABS.map(t => (
          <button key={t.tab} className={tab === t.tab ? "on" : ""} onClick={() => go(t.tab)}>
            <span className="tab-icon">{t.icon}</span><span className="tab-label">{t.label()}</span>
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
          <div className="list-head">{T("Privacy", "פרטיות")}</div>
          <label className="toggle card pad">
            <div>
              <div>{T("Private search", "חיפוש פרטי")}</div>
              <div className="dim small">{T("Moovit only sees the centre of the town you're in when you search, not your exact location.",
                "בזמן חיפוש Moovit רואה רק את מרכז העיר שבה אתם נמצאים, ולא את המיקום המדויק שלכם.")}</div>
            </div>
            <input type="checkbox" checked={prefs.privateSearch} onChange={e => setPrefs({ privateSearch: e.target.checked })} />
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
