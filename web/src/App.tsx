import { useEffect, useState, type ComponentType } from "react";
import { T, usePrefs, getPrefs, setPrefs, usePlanAsk, clock, type LatLon, type Look } from "./core.ts";
import { AccentPicker } from "./Accent.tsx";
import { Onboarding, SupportPrompt } from "./Onboarding.tsx";
import { Header, stayPut, useLeaving, liveWhy } from "./ui.tsx";
import { DirectionsGlyph, LinesTabGlyph, GearGlyph, CloseGlyph } from "./icons.tsx";
import { isNative, removeMap, getMapState, tryTripLive, say, type LiveResult } from "./native.ts";
import { canNotify, useJobs, removeReminder } from "./remind.ts";
import { PlanScreen } from "./screens/Plan.tsx";
import { StationsScreen } from "./screens/Stations.tsx";
import { LinesScreen } from "./screens/Lines.tsx";
import { PayScreen } from "./screens/Pay.tsx";

type Tab = "plan" | "lines" | "settings";

// As Moovit names and draws them: the tab you are on is filled and lit. Only three, so the bar isn't crowded:
// stops are under Lines, and paying is on the Directions home and on each trip.
const TABS: { tab: Tab; Icon: ComponentType<{ size?: number; on?: boolean }>; label: () => string }[] = [
  { tab: "plan", Icon: DirectionsGlyph, label: () => T("Directions", "מסלולים") },
  { tab: "lines", Icon: LinesTabGlyph, label: () => T("Lines", "קווים") },
  { tab: "settings", Icon: GearGlyph, label: () => T("Settings", "הגדרות") },
];
const tabOf = (t: string | null): Tab => TABS.some(x => x.tab === t) ? t as Tab : "plan";

export function App() {
  const prefs = usePrefs();
  const [tab, setTab] = useState<Tab>(() => tabOf(sessionStorage.getItem("kav-tab")));
  // Paying from a trip: a sheet over it with only the payment, the trip still underneath.
  const [paySheet, setPaySheet] = useState<{ at?: LatLon; routeType?: number; off?: LatLon } | null>(null);
  // Tabs crossfade, as on Android: the screen inside doesn't slide.
  // Directions tapped again while it's open goes back to its home screen, as an iPhone tab does.
  const [planHome, setPlanHome] = useState(0);
  const go = (t: Tab) => { if (t !== tab) stayPut(); else if (t === "plan") setPlanHome(n => n + 1); setTab(t); try { sessionStorage.setItem("kav-tab", t); } catch { /* ignore */ } };

  // A trip asked for from a stop's board opens in Directions.
  const ask = usePlanAsk();
  useEffect(() => { if (ask) go("plan"); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ask?.n]);

  // The first launch sets Kav up before anything else, as on Android.
  if (!prefs.onboarded) return <div className="app" key={prefs.lang}><Onboarding onDone={() => setPrefs({ onboarded: true })} /></div>;

  return (
    <div className="app" key={prefs.lang}>
      <main className="main">
        {/* Screens stay mounted, so a trip or a board is still there after a look at another tab. */}
        <div hidden={tab !== "plan"} className="tab-page"><PlanScreen home={planHome} onPay={(at, routeType, off) => setPaySheet({ at, routeType, off })} /></div>
        <div hidden={tab !== "lines"} className="tab-page"><LinesTab /></div>
        {tab === "settings" && <div className="tab-page"><Settings /></div>}
      </main>
      <nav className="tabbar">
        {TABS.map(({ tab: t, Icon, label }) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => go(t)} aria-current={tab === t ? "page" : undefined}>
            <Icon size={26} on={tab === t} /><span className="tab-label">{label()}</span>
          </button>
        ))}
      </nav>
      {paySheet && <PaySheet start={paySheet} onClose={() => setPaySheet(null)} />}
      {!prefs.supportShown && <SupportPrompt onDone={() => setPrefs({ supportShown: true })} />}
    </div>
  );
}

// Lines and stops, one tab: a switch at the top between the two, each keeping its place.
function LinesTab() {
  usePrefs(); // the words follow the language
  const [part, setPart] = useState<"lines" | "stops">(() => sessionStorage.getItem("kav-lines-part") === "stops" ? "stops" : "lines");
  const pick = (p: "lines" | "stops") => { if (p !== part) stayPut(); setPart(p); try { sessionStorage.setItem("kav-lines-part", p); } catch { /* ignore */ } };
  const head = (
    <header className="header">
      <div className="segmented hub-switch">
        <button className={part === "lines" ? "on" : ""} onClick={() => pick("lines")}>{T("Lines", "קווים")}</button>
        <button className={part === "stops" ? "on" : ""} onClick={() => pick("stops")}>{T("Stops", "תחנות")}</button>
      </div>
    </header>
  );
  return <>
    <div hidden={part !== "lines"} className="tab-page"><LinesScreen head={head} /></div>
    <div hidden={part !== "stops"} className="tab-page"><StationsScreen head={head} /></div>
  </>;
}

// A new GitHub issue with Kav's version and the phone filled in.
const ISSUES = "https://github.com/GilsaMedia/kav/issues/new";
function issueUrl(kind: "bug" | "idea") {
  const about = `Kav for iPhone ${__KAV_VERSION__} · ${navigator.userAgent.match(/OS [\d_]+/)?.[0]?.replace(/_/g, ".") ?? navigator.platform}`;
  const body = kind === "bug" ? `What happened:\n\nWhat you expected:\n\nSteps:\n1. \n\n---\n${about}` : `What you'd like Kav to do:\n\nWhy:\n\n---\n${about}`;
  return `${ISSUES}?labels=${kind === "bug" ? "bug" : "enhancement"}&body=${encodeURIComponent(body)}`;
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
          <label className="toggle card pad">
            <div>
              <div>{T("Line badges like Moovit's", "תגיות קו כמו ב-Moovit")}</div>
              <div className="dim small">{T("Bus lines on a grey badge over a strip of their operator's colour, rather than on that colour.", "קווי אוטובוס על תגית אפורה עם פס בצבע המפעיל, במקום על הצבע עצמו.")}</div>
            </div>
            <input type="checkbox" className="switch" checked={prefs.moovitBadges} onChange={e => setPrefs({ moovitBadges: e.target.checked })} />
          </label>
          <div className="list-head">{T("Map", "מפה")}</div>
          <div className="segmented">
            <button className={prefs.mapStyle !== "satellite" ? "on" : ""} onClick={() => setPrefs({ mapStyle: "kav" })}>{T("Kav's map", "המפה של Kav")}</button>
            <button className={prefs.mapStyle === "satellite" ? "on" : ""} onClick={() => setPrefs({ mapStyle: "satellite" })}>{T("Satellite", "לוויין")}</button>
          </div>
          {prefs.mapStyle === "satellite" && <div className="dim small">{T("Photos from Esri, loaded online as you look around. Kav's own map works with no connection.",
            "תמונות מ-Esri, נטענות מהרשת בזמן שאתם מסתכלים. המפה של Kav עובדת גם בלי חיבור.")}</div>}
          <LockScreenTest />
          <div className="list-head">{T("Accent", "צבע הדגשה")}</div>
          <div className="card pad stack center-items"><AccentPicker /></div>
          {canNotify && <Notifications />}
          <label className="toggle card pad">
            <div>
              <div>{T("Read trip alerts out loud", "הקראת התראות בנסיעה")}</div>
              <div className="dim small">{T("In Live Directions: each step as you reach it, your bus two minutes away, and getting off at the next stop.", "בניווט החי: כל שלב כשמגיעים אליו, האוטובוס שלכם בעוד שתי דקות, והירידה בתחנה הבאה.")}</div>
            </div>
            <input type="checkbox" className="switch" checked={prefs.spokenAlerts}
              onChange={e => { setPrefs({ spokenAlerts: e.target.checked }); if (e.target.checked) say(T("Alerts will sound like this", "כך יישמעו ההתראות")); }} />
          </label>
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
          <div className="list-head">{T("Help and feedback", "עזרה ומשוב")}</div>
          <div className="row-btns">
            <a className="btn" href={issueUrl("bug")} target="_blank" rel="noreferrer">{T("Found a bug", "מצאתי באג")}</a>
            <a className="btn" href={issueUrl("idea")} target="_blank" rel="noreferrer">{T("Request a feature", "בקשת פיצ׳ר")}</a>
          </div>
          <a className="btn" href="https://www.buymeacoffee.com/Noamm" target="_blank" rel="noreferrer">{T("Buy Kav's author a coffee", "קנו קפה למפתח של Kav")}</a>
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

// The trip on the lock screen and in the Dynamic Island: a sample to see it, and why not when it can't.
function LockScreenTest() {
  const [result, setResult] = useState<LiveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const why = liveWhy;
  const run = async () => {
    setBusy(true);
    const now = Date.now();
    setResult(await tryTripLive({
      phase: "wait", title: T("Wait for one of these options", "המתינו לאחת מהאפשרויות"), detail: T("72 Train station / 27 Rosh HaAyin", "72 תחנת רכבת / 27 ראש העין"),
      label: T("72 at your stop in", "72 בתחנה בעוד"), stop: T("Sample trip", "נסיעה לדוגמה"), line: "72 / 27", mode: "bus", color: "#3E9B5C",
      accent: getPrefs().accent, target: now + 4 * 60_000, depart: now - 60_000, arrive: now + 12 * 60_000, live: true, step: 1, steps: 5,
    }));
    setBusy(false);
  };
  return (
    <div className="card pad stack">
      <div>
        <div>{T("Lock screen and Dynamic Island", "מסך נעילה ו-Dynamic Island")}</div>
        <div className="dim small">{T("While you follow a trip, Kav shows the next step and a live countdown there, as Moovit does.", "בזמן נסיעה, Kav מציגה שם את השלב הבא וספירה לאחור בזמן אמת, כמו Moovit.")}</div>
      </div>
      <button className="btn" onClick={run} disabled={busy}>{T("Try it", "נסו את זה")}</button>
      {result && <div className={"small " + (result.ok ? "dim" : "")} style={result.ok ? undefined : { color: "var(--problem)" }}>{why(result)}</div>}
    </div>
  );
}

// What Kav will tell you about while it's closed: the reminders you set. Nothing else comes unless you've
// started a ride, and then only about that ride.
function Notifications() {
  const jobs = useJobs();
  return <>
    <div className="list-head">{T("Notifications", "התראות")}</div>
    <div className="card pad stack">
      <div className="dim small">{T(
        "Kav only tells you about a ride you started with Start: your vehicle coming to your stop, getting off, and a new alert on its lines while you're on it. A reminder to leave, if you set one on a trip, comes 5 minutes before it's time to go, moved by the bus's live time.",
        "Kav מודיעה רק על נסיעה שהתחלתם עם \"יציאה לדרך\": הקו שלכם מגיע לתחנה, הירידה, והודעה חדשה על הקווים שלה בזמן שאתם בה. תזכורת לצאת, אם הגדרתם אחת לנסיעה, מגיעה 5 דקות לפני שצריך לצאת, ומתעדכנת לפי זמן האמת של האוטובוס.")}</div>
      {!jobs.reminders.length && <div className="dim">{T("No reminders.", "אין תזכורות.")}</div>}
      {jobs.reminders.map(r => (
        <div key={r.id} className="row-card notif-row">
          <div className="grow"><div>{T(`Leave for ${r.dest}`, `יציאה אל ${r.dest}`)}</div>
            <div className="dim small">{clock(Math.floor((r.at ?? r.leaveMs - 5 * 60_000) / 1000))} · {r.line}</div></div>
          <button className="icon-btn" onClick={() => removeReminder(r.id)} aria-label={T("Remove", "הסרה")}><CloseGlyph size={14} /></button>
        </div>
      ))}
    </div>
  </>;
}

function PaySheet({ start, onClose }: { start: { at?: LatLon; routeType?: number; off?: LatLon }; onClose: () => void }) {
  const [leaving, leave] = useLeaving(onClose, 260);
  return (
    <div className={"pay-sheet-backdrop" + (leaving ? " leaving" : "")} onClick={leave}>
      <div className="pay-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={T("Pay", "תשלום")}>
        <div className="trip-grip" />
        <button className="plate-btn pay-sheet-close" data-back onClick={leave} aria-label={T("Close", "סגירה")}><CloseGlyph size={18} /></button>
        <PayScreen start={start} onStarted={() => {}} />
      </div>
    </div>
  );
}
