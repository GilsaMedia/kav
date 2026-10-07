// How late a line really runs, from what Kav has seen of it: a short note where you wait for it, and the
// whole picture (by weekday, and the hours that stand out) on the line's page.
import { T, api, useLoad } from "./core.ts";

interface Bucket { day: number; hour: number; n: number; delayMin: number }
interface Report {
  n: number; delayMin: number; lateShare: number; weeks: number;
  byDay: { day: number; n: number; delayMin: number }[]; patterns: Bucket[]; now: Bucket | null;
}

const DAY = () => [T("Sun", "א׳"), T("Mon", "ב׳"), T("Tue", "ג׳"), T("Wed", "ד׳"), T("Thu", "ה׳"), T("Fri", "ו׳"), T("Sat", "ש׳")];
const DAYS = () => [T("Sundays", "בימי ראשון"), T("Mondays", "בימי שני"), T("Tuesdays", "בימי שלישי"), T("Wednesdays", "בימי רביעי"),
  T("Thursdays", "בימי חמישי"), T("Fridays", "בימי שישי"), T("Saturdays", "בשבתות")];
const hh = (h: number) => `${String((h + 24) % 24).padStart(2, "0")}:00`;

// "10 min late", "on time", "2 min early".
function lateness(min: number) {
  const m = Math.round(Math.abs(min));
  if (m < 2) return T("on time", "בזמן");
  return min > 0 ? T(`${m} min late`, `באיחור של ${m} דק׳`) : T(`${m} min early`, `מקדים ב-${m} דק׳`);
}

const useReport = (lineId: number, stopId?: number) =>
  useLoad<Report>(lineId > 0 ? `delays:${lineId}:${stopId ?? ""}` : null, s => api(`delays?line=${lineId}${stopId ? `&stop=${stopId}` : ""}`, undefined, s));

// One line where you wait: how late it usually is about now on this weekday, or in general. Nothing until
// Kav has seen enough to say.
export function DelayNote({ lineId, stopId }: { lineId: number; stopId?: number }) {
  const r = useReport(lineId, stopId).data;
  if (!r) return null;
  if (r.now && r.now.n >= 2 && Math.abs(r.now.delayMin) >= 2)
    return <div className="delay-note">{T(`Usually ${lateness(r.now.delayMin)} around this time on ${DAYS()[r.now.day]} (${r.now.n} rides seen)`,
      `${DAYS()[r.now.day]} בשעה הזו בדרך כלל ${lateness(r.now.delayMin)} (${r.now.n} נסיעות נצפו)`)}</div>;
  if (r.n >= 3 && Math.abs(r.delayMin) >= 2)
    return <div className="delay-note">{T(`Usually ${lateness(r.delayMin)} here (${r.n} rides seen)`, `בדרך כלל ${lateness(r.delayMin)} כאן (${r.n} נסיעות נצפו)`)}</div>;
  return null;
}

// The line's page: the overall picture, each weekday, and the hours that stand out.
export function DelayStats({ lineId, stopId, stopName }: { lineId: number; stopId?: number; stopName?: string }) {
  const rep = useReport(lineId, stopId);
  const r = rep.data;
  if (!r) return null;
  if (!r.n) return <div className="dim small">{T(
    "Kav learns how late this line runs from the live times it sees while you use it: each time a bus reaches a stop, its delay is kept on this phone. Nothing seen yet.",
    "Kav לומדת כמה הקו הזה מאחר מזמני האמת שהיא רואה בזמן השימוש: בכל פעם שאוטובוס מגיע לתחנה, האיחור שלו נשמר בטלפון. עדיין לא נצפה כלום.")}</div>;
  const max = Math.max(5, ...r.byDay.map(d => Math.abs(d.delayMin)));
  return (
    <div className="stack delay-stats">
      <div className="card pad stack">
        <div className="ticket-top"><b>{stopName ? T(`At ${stopName}`, `בתחנה ${stopName}`) : T("Along the line", "לאורך הקו")}</b><b className={r.delayMin >= 2 ? "late" : ""}>{lateness(r.delayMin)}</b></div>
        <div className="dim small">{T(`${r.n} rides seen over ${r.weeks} ${r.weeks === 1 ? "week" : "weeks"} · ${Math.round(r.lateShare * 100)}% of them 3+ min late`,
          `${r.n} נסיעות נצפו ב-${r.weeks} שבועות · ${Math.round(r.lateShare * 100)}% מהן באיחור של 3 דק׳ ומעלה`)}</div>
      </div>
      <div className="list-head">{T("By day", "לפי יום")}</div>
      <div className="delay-days">
        {r.byDay.map(d => (
          <div key={d.day} className={"delay-day" + (d.n ? "" : " none")}>
            <span>{DAY()[d.day]}</span>
            <span className="delay-bar"><i style={{ width: `${d.n ? Math.max(4, Math.abs(d.delayMin) / max * 100) : 0}%` }} className={d.delayMin >= 3 ? "late" : d.delayMin <= -2 ? "early" : ""} /></span>
            <span className="dim small">{d.n ? `${lateness(d.delayMin)} · ${d.n}` : "—"}</span>
          </div>
        ))}
      </div>
      {r.patterns.length > 0 && <>
        <div className="list-head">{T("When it's off", "מתי זה חורג")}</div>
        <ul className="list">
          {r.patterns.map(p => (
            <li key={`${p.day}:${p.hour}`} className="row">
              <div className="row-main"><div>{DAYS()[p.day]} {hh(p.hour)}–{hh(p.hour + 1)}</div>
                <div className="dim small">{T(`${p.n} rides seen`, `${p.n} נסיעות נצפו`)}</div></div>
              <b className={p.delayMin >= 3 ? "late" : ""}>{lateness(p.delayMin)}</b>
            </li>
          ))}
        </ul>
      </>}
    </div>
  );
}
