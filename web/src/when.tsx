// When to travel, chosen as in Moovit: a pill that says it ("Depart now ⌄"), a list of choices, and a wheel of
// day, hour and minute for a time of your own.
import { useEffect, useRef, useState } from "react";
import { T, usePrefs } from "./core.ts";
import { Sheet } from "./ui.tsx";
import { ChevronGlyph, CloseGlyph } from "./icons.tsx";

export type When = { kind: "now" } | { kind: "last" } | { kind: "depart" | "arrive"; ms: number };

const MIN = 60_000;
// The wheel's days: a week back (Moovit shows the past too) and a month ahead.
const DAYS_BACK = 7, DAYS_AHEAD = 30;

const locale = () => document.documentElement.lang === "he" ? "he-IL" : "en-GB";
const midnight = (ms: number, plusDays = 0) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + plusDays); return d.getTime(); };
const daysFromToday = (ms: number) => Math.round((midnight(ms) - midnight(Date.now())) / 86_400_000);

function dayName(offset: number) {
  if (offset === 0) return T("Today", "היום");
  if (offset === 1) return T("Tomorrow", "מחר");
  return new Date(midnight(Date.now(), offset)).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
}

export function whenText(w: When): string {
  if (w.kind === "now") return T("Depart now", "יציאה עכשיו");
  if (w.kind === "last") return T("Latest departure", "היציאה האחרונה");
  const off = daysFromToday(w.ms);
  const day = off === 0 ? "" : dayName(off) + " ";
  const hm = new Date(w.ms).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return w.kind === "depart" ? T(`Depart ${day}${hm}`, `יציאה ${day}${hm}`) : T(`Arrive by ${day}${hm}`, `הגעה עד ${day}${hm}`);
}

export function WhenButton({ when, onClick }: { when: When; onClick: () => void }) {
  usePrefs(); // the words follow the language
  return <button className="when-btn" onClick={onClick}>{whenText(when)}<ChevronGlyph size={14} /></button>;
}

export function WhenSheet({ when, onDone, onClose }: { when: When; onDone: (w: When) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"depart" | "arrive" | null>(null);
  // ±15 minutes from the time already chosen, or from now; a departure moved back to now is "now".
  const shift = (minutes: number) => {
    const base = when.kind === "depart" || when.kind === "arrive" ? when.ms : Date.now();
    const kind = when.kind === "arrive" ? "arrive" : "depart";
    const ms = base + minutes * MIN;
    onDone(kind === "depart" && Math.abs(ms - Date.now()) < MIN ? { kind: "now" } : { kind, ms });
  };
  if (mode) return <Sheet onClose={onClose}><TimeWheel when={when} mode={mode} onDone={onDone} onClose={onClose} /></Sheet>;
  return (
    <Sheet onClose={onClose}>
      <div className="when-list">
        {when.kind !== "now" && <button className="when-row accent" onClick={() => onDone({ kind: "now" })}>{T("Depart now", "יציאה עכשיו")}</button>}
        <button className="when-row" onClick={() => setMode("depart")}>{T("Set your departure time", "קביעת שעת יציאה")}</button>
        <button className="when-row" onClick={() => setMode("arrive")}>{T("Set desired arrival time", "קביעת שעת הגעה רצויה")}</button>
        <button className={"when-row" + (when.kind === "last" ? " on" : "")} onClick={() => onDone({ kind: "last" })}>{T("Latest departure", "היציאה האחרונה")}</button>
        <button className="when-row" onClick={() => shift(-15)}><bdi>-15</bdi> {T("min", "דק׳")}</button>
        <button className="when-row" onClick={() => shift(15)}><bdi>+15</bdi> {T("min", "דק׳")}</button>
      </div>
    </Sheet>
  );
}

function TimeWheel({ when, mode, onDone, onClose }: { when: When; mode: "depart" | "arrive"; onDone: (w: When) => void; onClose: () => void }) {
  const start = new Date(when.kind === "depart" || when.kind === "arrive" ? when.ms : Date.now());
  const [day, setDay] = useState(Math.min(Math.max(daysFromToday(start.getTime()), -DAYS_BACK), DAYS_AHEAD) + DAYS_BACK);
  const [hour, setHour] = useState(start.getHours());
  const [minute, setMinute] = useState(start.getMinutes());
  const days = Array.from({ length: DAYS_BACK + DAYS_AHEAD + 1 }, (_, i) => dayName(i - DAYS_BACK));
  const done = () => {
    const d = new Date(midnight(Date.now(), day - DAYS_BACK));
    d.setHours(hour, minute, 0, 0);
    onDone({ kind: mode, ms: d.getTime() });
  };
  return <>
    <div className="when-head">
      <button className="when-x" onClick={onClose} aria-label={T("Close", "סגירה")}><CloseGlyph size={14} /></button>
      <b>{mode === "depart" ? T("Set your departure time", "קביעת שעת יציאה") : T("Set desired arrival time", "קביעת שעת הגעה רצויה")}</b>
      <span />
    </div>
    <div className="wheels" dir="ltr">
      <Wheel items={days} index={day} onChange={setDay} grow />
      <Wheel items={Array.from({ length: 24 }, (_, i) => String(i))} index={hour} onChange={setHour} />
      <Wheel items={Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))} index={minute} onChange={setMinute} />
    </div>
    <button className="btn primary big when-done" onClick={done}>{T("Done", "סיום")}</button>
  </>;
}

const ITEM = 40; // px, as .time-wheel-item

// One column of the wheel: it scrolls and snaps, and the row in the band is the value.
function Wheel({ items, index, onChange, grow }: { items: string[]; index: number; onChange: (i: number) => void; grow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current) ref.current.scrollTop = index * ITEM; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM)));
    if (i !== index) onChange(i);
  };
  return (
    <div className={"time-wheel" + (grow ? " grow" : "")} ref={ref} onScroll={onScroll}>
      {items.map((t, i) => (
        <div key={i} className={"time-wheel-item" + (i === index ? " on" : "")}
          onClick={() => ref.current?.scrollTo({ top: i * ITEM, behavior: "smooth" })}>{t}</div>
      ))}
    </div>
  );
}
