// First launch, as on Android: a language, a look, a colour, what plans may use, and the map.
import { useState, useSyncExternalStore } from "react";
import { T, usePrefs, setPrefs, MODE_FILTERS, type Look } from "./core.ts";
import { isNative, getMapState, subscribeMap, downloadMap, MAP_BYTES } from "./native.ts";
import { AccentPicker, AccentPreview } from "./Accent.tsx";
import { stayPut, Sheet } from "./ui.tsx";
import { BackGlyph, ModeGlyph } from "./icons.tsx";

const ALL_TYPES = MODE_FILTERS.flatMap(f => f.types);
const PAGES = isNative ? 5 : 4;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const prefs = usePrefs();
  const [page, setPage] = useState(0);
  const next = () => setPage(p => p + 1);
  const back = () => { stayPut(); setPage(p => p - 1); };
  const last = page === PAGES - 1;

  return (
    <div className="setup screen" key={page}>
      <div className="setup-top">
        {page > 0 ? <button className="plate-btn" onClick={back} aria-label={T("Back", "חזרה")}><BackGlyph /></button> : <span />}
        <div className="setup-dots">{Array.from({ length: PAGES }, (_, i) => <span key={i} className={i === page ? "on" : ""} />)}</div>
      </div>
      <div className="setup-body">
        {page === 0 && <>
          <h1>בחרו שפה</h1>
          <h1 className="dim">Choose a language</h1>
          <div className="setup-gap" />
          <div className="stack">
            <SetupButton lit={prefs.lang === "he"} onClick={() => setPrefs({ lang: "he" })}>עברית</SetupButton>
            <SetupButton lit={prefs.lang === "en"} onClick={() => setPrefs({ lang: "en" })}>English</SetupButton>
          </div>
        </>}

        {page === 1 && <>
          <h1>{T("Pick a look", "בחרו מראה")}</h1>
          <p className="setup-note">{T(
            "OLED black, light or dark, with liquid glass or solid on top. The preview changes as you tap, and Settings has this again later.",
            "שחור OLED, בהיר או כהה, עם זכוכית נוזלית או משטחים אטומים. התצוגה המקדימה משתנה כשאתם מקישים, ואפשר לשנות זאת שוב בהגדרות.")}</p>
          <AccentPreview />
          <LookChoices />
        </>}

        {page === 2 && <>
          <h1>{T("Pick a colour", "בחרו צבע")}</h1>
          <p className="setup-note">{T(
            "Kav is grey with one colour on top. Drag the dot, or take a preset; the preview follows as you go, and Settings has this again later.",
            "Kav אפורה עם צבע אחד מעליה. גררו את הנקודה או בחרו גוון מוכן; התצוגה המקדימה מתעדכנת תוך כדי, ואפשר לשנות זאת שוב בהגדרות.")}</p>
          <AccentPreview />
          <div className="setup-gap" />
          <div className="stack center-items"><AccentPicker /></div>
        </>}

        {page === 3 && <>
          <h1>{T("What should a plan show?", "מה מסלול יכול לכלול?")}</h1>
          <p className="setup-note">{T(
            "Everything is on. Switch off what you never take and the planner leaves it out. The chips above your trips change the same list.",
            "הכול פעיל. כבו את מה שאתם אף פעם לא נוסעים בו והמתכנן ישמיט אותו. הכפתורים מעל המסלולים משנים את אותה רשימה.")}</p>
          <ModeSwitches />
        </>}

        {page === 4 && <MapStep />}
      </div>
      <div className="setup-foot">
        {last ? <FinishButton onDone={onDone} /> : <SetupButton lit onClick={next}>{T("Next", "הבא")}</SetupButton>}
      </div>
    </div>
  );
}

function SetupButton({ lit, onClick, children, disabled }: { lit?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <button className={"setup-btn" + (lit ? " lit" : "")} onClick={onClick} disabled={disabled}>{children}</button>;
}

function LookChoices() {
  const prefs = usePrefs();
  const looks: [Look, string][] = [["black", "OLED"], ["light", T("Light", "בהיר")], ["dark", T("Dark", "כהה")]];
  return <>
    <div className="setup-head">{T("look", "מראה")}</div>
    <div className="chips">{looks.map(([look, name]) =>
      <button key={look} className={"chip" + (prefs.look === look ? " on" : "")} onClick={() => setPrefs({ look })}>{name}</button>)}</div>
    <div className="setup-head">{T("glass", "זכוכית")}</div>
    <div className="chips">
      <button className={"chip recommended" + (prefs.liquid ? " on" : "")} onClick={() => setPrefs({ liquid: true })}>{T("Liquid glass", "זכוכית נוזלית")}</button>
      <button className={"chip" + (!prefs.liquid ? " on" : "")} onClick={() => setPrefs({ liquid: false })}>{T("Solid", "אחיד")}</button>
    </div>
    <div className="dim small setup-hint">{T("Liquid glass is the one we recommend.", "זכוכית נוזלית היא האפשרות המומלצת.")}</div>
  </>;
}

// prefs.modes lists the modes a plan may use; empty means all of them.
function ModeSwitches() {
  const prefs = usePrefs();
  const allowed = prefs.modes.length ? prefs.modes : ALL_TYPES;
  const set = (types: number[], on: boolean) => {
    const now = on ? [...new Set([...allowed, ...types])] : allowed.filter(t => !types.includes(t));
    if (!now.length) return; // something has to be left to plan with
    setPrefs({ modes: ALL_TYPES.every(t => now.includes(t)) ? [] : now });
  };
  return (
    <div className="card setup-modes">
      {MODE_FILTERS.map(f => {
        const on = f.types.every(t => allowed.includes(t));
        return (
          <label key={f.types.join()} className="toggle setup-mode">
            <span className="row-icon"><ModeGlyph type={f.types[0]} size={20} /></span>
            <span className="grow">{f.label()}</span>
            <input type="checkbox" className="switch" checked={on} onChange={e => set(f.types, e.target.checked)} />
          </label>
        );
      })}
    </div>
  );
}

function useMap() { return useSyncExternalStore(subscribeMap, getMapState); }

function MapStep() {
  const map = useMap();
  const mb = Math.round(MAP_BYTES / 1_048_576);
  return <>
    <h1>{T("Download the map", "הורדת המפה")}</h1>
    <p className="setup-note">{T(
      `Kav keeps its map on your phone instead of loading tiles from a server as you go, so nothing tracks where you look. It's about ${mb} MB for all of Israel, once. After that the map works with no signal.`,
      `Kav מחזיקה את המפה בטלפון שלכם במקום לטעון אריחים משרת תוך כדי תנועה, כך שאף אחד לא עוקב אחרי מה שאתם מסתכלים עליו. זה בערך ${mb} MB לכל ישראל, פעם אחת. אחרי זה המפה עובדת גם בלי קליטה.`)}</p>
    {map.k === "downloading" && <div className="stack">
      <div className="progress wide"><div style={{ width: `${Math.max(2, map.progress * 100)}%` }} /></div>
      <div className="dim small">{T(`Downloading… ${Math.floor(map.progress * 100)}%`, `מורידים… ${Math.floor(map.progress * 100)}%`)}</div>
    </div>}
    {map.k === "failed" && <div className="note error">{T(`Couldn't download it. ${map.why}`, `ההורדה לא הצליחה. ${map.why}`)}</div>}
    {map.k === "ready" && <div className="note">{T("Got it. The map stays on your phone from now on.", "מוכן. מעכשיו המפה נשארת בטלפון שלכם.")}</div>}
  </>;
}

function FinishButton({ onDone }: { onDone: () => void }) {
  const map = useMap();
  if (!isNative || map.k === "ready") return <SetupButton lit onClick={onDone}>{T("Done", "סיום")}</SetupButton>;
  return <>
    {map.k === "downloading" ? <SetupButton lit disabled onClick={() => {}}>{T("Downloading…", "מורידים…")}</SetupButton>
      : <SetupButton lit onClick={downloadMap}>{map.k === "failed" ? T("Try again", "נסו שוב") : T("Download", "הורדה")}</SetupButton>}
    {/* The download carries on in the background; the map screens offer it again until it's there. */}
    <button className="link center" onClick={onDone}>{T("Later", "אחר כך")}</button>
  </>;
}

// ---- once, after setup: a word about supporting Kav --------------------------------------------

const COFFEE_URL = "https://www.buymeacoffee.com/Noamm";
const REPO_URL = "https://github.com/ImNoammm/kav";

export function SupportPrompt({ onDone }: { onDone: () => void }) {
  return (
    <Sheet onClose={onDone} title={T("Enjoying Kav?", "נהנים מקו?")}>
      <div className="stack">
        <p className="setup-note">{T(
          "Kav is made to protect every user's privacy and to make riding the bus a little more bearable (as much as possible).",
          "קו מפותחת במטרה לשמור על הפרטיות של כל משתמש ולהפוך את השימוש באוטובוסים לחוויה נסבלת יותר (כמה שאפשר).")}</p>
        <p className="setup-note">{T(
          "If you'd like to support Kav's development, you're welcome to tap the button below. If that's not an option for you, you can show your support with ",
          "אם תרצו לתרום להמשך הפיתוח של האפליקציה, אתם מוזמנים ללחוץ על הכפתור למטה. אם אין לכם אפשרות, אתם מוזמנים להביע תמיכה דרך ")}
          <a href={REPO_URL} target="_blank" rel="noreferrer">{T("a star on GitHub", "כוכב בגיטהאב")}</a>.</p>
        <p className="dim small">{T(
          "*Donating is just a thank-you and 100% optional. You won't lose any features if you can't :)",
          "*תרומה היא אות הערכה בלבד, והיא אופציונלית לגמרי. לא תאבדו אף פיצ'ר אם אין ביכולתכם לתרום :)")}</p>
        <a className="setup-btn lit" href={COFFEE_URL} target="_blank" rel="noreferrer" onClick={() => setTimeout(onDone, 0)}>{T("Buy me a coffee", "קנו לי קפה")}</a>
        <button className="setup-btn" onClick={onDone}>{T("Have you seen the economy??", "ראית את מצב האקונומיה??")}</button>
      </div>
    </Sheet>
  );
}
