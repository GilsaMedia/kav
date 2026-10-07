// Paying for rides with your own Moovit payment account: signing in, buying a ticket from a bus's QR code
// or at a station, ending a train ride, and the tickets, history and bills on the account.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { T, api, useLoad, useNow, clock, shekels, failure, locateOnce, ApiError, type LatLon } from "../core.ts";
import { Header, Spinner, Note, Qr, Sheet } from "../ui.tsx";
import { ModeGlyph, QrGlyph, MinusGlyph, PlusGlyph, BackGlyph } from "../icons.tsx";
import { isNative, scanQr, CameraDenied } from "../native.ts";

interface Price { agorot: number; code: string }
interface Cost { price: Price; full: Price; reasons: string[] }
interface Fare { code: number; radius: number; regionId: number; originRegionId: number; price: Price; full: Price | null; from: string | null; to: string | null; reasons: string[]; cases: string[] }
interface Offer { context: string; profile: string; fares: Fare[] }
interface Quote { main: Cost | null; other: Cost | null }
interface Ticket {
  id: number; ref: string; boughtUtc: number; title: string; price: Price | null; profile: string; agency: string; active: boolean;
  qr: string; endsUtc: number; passenger: string; radius: number; mode: number; fromStopId: number; toStopId: number; anonymous: boolean; needsExit: boolean;
}
interface Wallet { tickets: Ticket[]; window: { fromUtc: number; untilUtc: number; title: string; text: string } | null }
interface StopInfo { id: number; name: string; lat: number | null; lon: number | null }
interface Station { stopId: number; name: string; price: Price | null; full: Price | null; fareCode: number; radius: number; context: string; destinationStopId: number; reasons: string[]; cases: string[] }

// Moovit's refusals said in its words; a step left to finish (409) goes back to signing in.
const UNFINISHED = "kav-pay-unfinished";
function payError(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) window.dispatchEvent(new Event(UNFINISHED));
  return e instanceof ApiError && e.title && e.title !== e.message ? `${e.title}: ${e.message}` : failure(e);
}

const money = (p?: Price | null) => p ? (p.code === "ILS" ? shekels(p.agorot) : `${(p.agorot / 100).toFixed(2)} ${p.code}`) : "";
// Moovit's times are epoch milliseconds or seconds, depending on the call.
const secs = (t: number) => t > 1e12 ? Math.floor(t / 1000) : t;

const MODES = [
  { routeType: 2, label: () => T("Train", "רכבת"), },
  { routeType: 0, label: () => T("Light rail", "רכבת קלה"), },
  { routeType: 5, label: () => T("Carmelit", "כרמלית"), },
];

// The last bus scanned, kept on this phone for a few hours: forgot to pay when getting on, pay for it from
// your seat without scanning again. The fare is asked for and paid from where you are when you pay.
const LAST_BUS = "kav-last-bus", KEEP_BUS_MS = 3 * 3600_000;
type ScannedBus = { qr: string; atMs: number };
function lastBus(): ScannedBus | null {
  try {
    const b = JSON.parse(localStorage.getItem(LAST_BUS) ?? "null") as ScannedBus | null;
    return b?.qr && Date.now() - b.atMs < KEEP_BUS_MS ? b : null;
  } catch { return null; }
}
function keepBus(qr: string) { try { localStorage.setItem(LAST_BUS, JSON.stringify({ qr, atMs: Date.now() })); } catch { /* not kept */ } }
function forgetBus() { try { localStorage.removeItem(LAST_BUS); } catch { /* nothing kept */ } }

async function payAt(): Promise<LatLon | null> { try { return await locateOnce(); } catch { return null; } }

export function PayScreen({ start, onStarted }: { start: { at?: LatLon; routeType?: number } | null; onStarted: () => void }) {
  const state = useLoad<{ signedIn: boolean; unfinished?: boolean; account?: { name: string; phone: string; connected: boolean } | null }>("pay", s => api("pay/state", undefined, s));
  // Moovit wants a step finished before it takes payments: back to signing in, at that step.
  useEffect(() => {
    const unfinished = () => { setFlow(null); state.reload(); };
    window.addEventListener(UNFINISHED, unfinished);
    return () => window.removeEventListener(UNFINISHED, unfinished);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [flow, setFlow] = useState<null | { kind: "bus"; qr?: string } | { kind: "station"; routeType: number; at?: LatLon } | { kind: "exit"; ticket: Ticket } | { kind: "history" }>(null);
  const [bought, setBought] = useState<Ticket[] | null>(null);
  const [walletKey, setWalletKey] = useState(0);

  // A ride paid from a trip's card: a bus is scanned, a station is the trip's own.
  useEffect(() => {
    if (!start || !state.data?.signedIn) return;
    setFlow(start.routeType === 3 || start.routeType == null ? { kind: "bus" } : { kind: "station", routeType: start.routeType, at: start.at });
    onStarted();
  }, [start, state.data?.signedIn]);

  if (state.loading && !state.data) return <div className="screen"><Header title={T("Pay", "תשלום")} /><div className="pad"><Spinner /></div></div>;
  if (state.error) return <div className="screen"><Header title={T("Pay", "תשלום")} /><div className="pad"><Note tone="error">{state.error}</Note><button className="btn" onClick={state.reload}>{T("Try again", "נסו שוב")}</button></div></div>;
  if (!state.data?.signedIn || state.data.unfinished) return <SignIn onDone={state.reload} />;

  const done = (t: Ticket[]) => { setFlow(null); setBought(t); setWalletKey(k => k + 1); };
  if (flow?.kind === "bus") return <BusPurchase qr={flow.qr} onBack={() => setFlow(null)} onBought={done} />;
  if (flow?.kind === "station") return <StationPurchase routeType={flow.routeType} at={flow.at} onBack={() => setFlow(null)} onBought={done} />;
  if (flow?.kind === "exit") return <TrainExit ticket={flow.ticket} onBack={() => setFlow(null)} onDone={done} />;
  if (flow?.kind === "history") return <History onBack={() => setFlow(null)} />;

  return (
    <div className="screen">
      <Header title={T("Pay", "תשלום")} sub={state.data.account?.name || state.data.account?.phone || ""} />
      <div className="scroll">
        <div className="pad stack">
          {state.data.account && !state.data.account.connected && <Note tone="warn">{T(
            "Moovit's app has the payment account now. Sign in here again to move it back to Kav.",
            "חשבון התשלום עבר לאפליקציה של Moovit. התחברו כאן שוב כדי להחזיר אותו ל-Kav.")}
            <button className="link" onClick={async () => { await api("pay/signout", {}); state.reload(); }}>{T("Sign in again", "התחברות מחדש")}</button></Note>}
          <button className="btn primary big" onClick={() => setFlow({ kind: "bus" })}><QrGlyph size={20} />{T("Scan the QR code on the bus", "סריקת הברקוד באוטובוס")}</button>
          <LastBus key={walletKey} onPay={qr => setFlow({ kind: "bus", qr })} />
          <div className="grid3">
            {MODES.map(m => <button key={m.routeType} className="btn tile" onClick={() => setFlow({ kind: "station", routeType: m.routeType })}><ModeGlyph type={m.routeType} size={26} />{m.label()}</button>)}
          </div>
          <WalletView key={walletKey} highlight={bought} onExit={t => setFlow({ kind: "exit", ticket: t })} />
          <button className="btn" onClick={() => setFlow({ kind: "history" })}>{T("History and bills", "היסטוריה וחיובים")}</button>
          <button className="link center" onClick={async () => { if (confirm(T("Sign out of payments on Kav?", "להתנתק מהתשלומים ב-Kav?"))) { await api("pay/signout", {}); state.reload(); } }}>{T("Sign out", "התנתקות")}</button>
        </div>
      </div>
    </div>
  );
}

// ---- signing in ------------------------------------------------------------------------------

interface InputField { id: string; type: number; hint: string; placeholder: string; max: number }
interface InputStep { id: string; title: string; subtitle: string; button: string; fields: InputField[] }
interface Steps {
  missing: number[]; terms: any; card: { type: string; last4: string } | null;
  cvv: InputStep | null; input: InputStep | null; reconnect: { title: string; text: string } | null;
}

// Moovit's registration steps (MVPaymentRegistrationStep) Kav can walk through, and names for the rest.
const STEP = { PHONE: 1, PAYMENT_METHOD: 8, TERMS: 10, RECONNECT: 14, INPUT: 20, CVV: 21 };
const stepName = (n: number) => ({
  2: T("your name", "השם שלכם"), 3: T("your email", "האימייל שלכם"), 4: T("a credit card", "כרטיס אשראי"), 5: T("your date of birth", "תאריך הלידה"),
  6: T("your ID number", "מספר תעודת הזהות"), 7: T("ID verification", "אימות תעודת זהות"), 8: T("a payment method", "אמצעי תשלום"),
  9: T("a fare profile", "פרופיל נוסע"), 11: T("an external account", "חשבון חיצוני"), 16: T("your address", "הכתובת שלכם"),
  17: T("email verification", "אימות אימייל"), 18: T("a web step", "שלב באתר"), 19: T("a question", "שאלה"),
} as Record<number, string>)[n] ?? `#${n}`;

type Step = { k: "loading" } | { k: "terms"; terms: any } | { k: "phone"; reconnect: Steps["reconnect"] } | { k: "code"; phone: string }
  | { k: "pango"; last4: string } | { k: "input"; cvv: boolean; step: InputStep } | { k: "unfinished"; missing: number[] };

// The next thing Moovit wants, as its own app picks it: terms, the phone (or reconnecting it), the card on the
// account, the CVV, other input. Anything else is finished in Moovit's app.
function nextStep(s: Steps): Step | null {
  const m = s.missing;
  if (m.includes(STEP.TERMS) && s.terms) return { k: "terms", terms: s.terms };
  if (m.includes(STEP.PHONE) || m.includes(STEP.RECONNECT)) return { k: "phone", reconnect: m.includes(STEP.RECONNECT) ? s.reconnect : null };
  if (m.includes(STEP.PAYMENT_METHOD) && s.card) return { k: "pango", last4: s.card.last4 };
  if (m.includes(STEP.CVV) && s.cvv) return { k: "input", cvv: true, step: s.cvv };
  if (m.includes(STEP.INPUT) && s.input) return { k: "input", cvv: false, step: s.input };
  return m.length ? { k: "unfinished", missing: m } : null;
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>({ k: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [elsewhere, setElsewhere] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(e instanceof ApiError && e.title && e.title !== e.message ? `${e.title}: ${e.message}` : failure(e)); }
    setBusy(false);
  };

  // Each answer brings Moovit's list again; the next step follows from it, or Kav is ready.
  const advance = async (s?: Steps | null) => {
    const steps = s ?? await api<Steps>("pay/steps", {});
    const next = nextStep(steps);
    setValues({});
    if (next) { setStep(next); return; }
    const f = await api<{ connected: boolean; steps: Steps }>("pay/finish", {});
    if (f.connected) onDone();
    else setStep(nextStep(f.steps) ?? { k: "unfinished", missing: f.steps.missing });
  };

  useEffect(() => {
    api<Steps>("pay/steps", {}).then(advance).catch(e => { setError(failure(e)); setStep({ k: "phone", reconnect: null }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const verified = async (v: { elsewhere: boolean; steps: Steps | null }) => {
    if (v.elsewhere) setElsewhere(true);
    else await advance(v.steps?.missing.length ? v.steps : null);
  };

  const fieldsOk = step.k === "input" && step.step.fields.every(f => (values[f.id] ?? "").trim().length > 0);
  return (
    <div className="screen">
      <Header title={T("Pay with Moovit", "תשלום עם Moovit")} />
      <div className="scroll">
        <div className="pad stack">
          {step.k === "loading" && <Spinner text={T("Asking Moovit…", "שואלים את Moovit…")} />}
          {step.k === "phone" && (step.reconnect
            ? <Note>{step.reconnect.title && <b>{step.reconnect.title}<br /></b>}{step.reconnect.text || T("Moovit asks to confirm your phone number again.", "Moovit מבקשת לאשר שוב את מספר הטלפון.")}</Note>
            : <Note>{T(
              "Kav pays for rides with your own Moovit payment account (the Ministry of Transport's, run by Pango). Only payments use it; everything else stays anonymous.",
              "Kav משלמת על נסיעות עם חשבון התשלום שלכם ב-Moovit (של משרד התחבורה, בהפעלת פנגו). רק התשלומים משתמשים בו; כל השאר נשאר אנונימי.")}</Note>)}
          {step.k === "terms" && (
            <div className="card pad stack">
              <h2>{step.terms.title}</h2>
              <p className="dim pre">{step.terms.text}</p>
              {step.terms.links.map(([label, url]: [string, string]) => <a key={url} href={url} target="_blank" rel="noreferrer">{label}</a>)}
              <button className="btn primary" disabled={busy} onClick={() => run(async () => { await api("pay/terms", { version: step.terms.version }); await advance(); })}>
                {step.terms.button || T("Let's begin", "בואו נתחיל")}</button>
            </div>
          )}
          {step.k === "phone" && <>
            <label className="dim">{T("Your phone number", "מספר הטלפון שלכם")}</label>
            <input className="field ltr" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d+-]/g, ""))} placeholder="050-123-4567" />
            <button className="btn primary" disabled={busy || phone.replace(/\D/g, "").length < 9}
              onClick={() => run(async () => { await api("pay/send", { phone }); setCode(""); setStep({ k: "code", phone }); })}>{T("Send code", "שליחת קוד")}</button>
          </>}
          {step.k === "code" && <>
            <label className="dim">{T(`The code Moovit sent to ${step.phone}`, `הקוד ש-Moovit שלחה ל-${step.phone}`)}</label>
            <input className="field ltr" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="123456" autoFocus />
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={() => run(async () => verified(await api("pay/verify", { code, takeOver: false })))}>{T("Confirm", "אישור")}</button>
            <button className="link" disabled={busy} onClick={() => run(() => api("pay/send", { phone: step.phone }))}>{T("Send it again", "שליחה מחדש")}</button>
          </>}
          {step.k === "pango" && <>
            <h2>{T("Confirm your card", "אישור הכרטיס")}</h2>
            <Note>{T(`Your payment account pays with the card ending in ${step.last4}. Enter its CVV to use it on this phone. It goes to Moovit once and is kept nowhere.`,
              `חשבון התשלום שלכם משלם בכרטיס שמסתיים ב-${step.last4}. הקלידו את ה-CVV שלו כדי להשתמש בו בטלפון הזה. הוא נשלח ל-Moovit פעם אחת ולא נשמר.`)}</Note>
            <input className="field ltr" type="password" inputMode="numeric" autoComplete="off" value={values.cvv ?? ""} onChange={e => setValues({ cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="CVV" />
            <button className="btn primary" disabled={busy || (values.cvv ?? "").length < 3} onClick={() => run(async () => {
              const d = values.cvv ?? ""; setValues({});
              await api("pay/cvv", { cvv: d });
              await advance();
            })}>{T("Confirm card", "אישור הכרטיס")}</button>
          </>}
          {step.k === "input" && <>
            <h2 dir="auto">{step.step.title || (step.cvv ? T("Confirm your card", "אישור הכרטיס") : T("A few more details", "עוד כמה פרטים"))}</h2>
            {step.step.subtitle && <Note><span dir="auto">{step.step.subtitle}</span></Note>}
            {step.step.fields.map(f => {
              const secret = step.cvv || /cvv/i.test(f.id);
              return <div key={f.id} className="stack">
                {f.hint && <label className="dim" dir="auto">{f.hint}</label>}
                <input className="field ltr" type={secret ? "password" : "text"} inputMode={secret ? "numeric" : undefined} autoComplete="off"
                  maxLength={f.max > 0 ? f.max : undefined} placeholder={f.placeholder || (secret ? "CVV" : "")}
                  value={values[f.id] ?? ""} onChange={e => setValues(v => ({ ...v, [f.id]: secret ? e.target.value.replace(/\D/g, "") : e.target.value }))} />
              </div>;
            })}
            <button className="btn primary" disabled={busy || !fieldsOk} onClick={() => run(async () => {
              const sent = step.step.fields.map(f => ({ id: f.id, value: (values[f.id] ?? "").trim() }));
              setValues({});
              await advance(await api<Steps>("pay/input", { cvv: step.cvv, step: step.step.id, values: sent }));
            })}>{step.step.button || T("Continue", "המשך")}</button>
          </>}
          {step.k === "unfinished" && <>
            <Note>{T(`Moovit still needs ${step.missing.map(stepName).join(", ")} on this account, which Kav can't fill in. Finish it in Moovit's app, then sign in here again.`,
              `Moovit עדיין צריכה ${step.missing.map(stepName).join(", ")} בחשבון, ו-Kav לא יכולה למלא את זה. השלימו באפליקציה של Moovit ואז התחברו כאן שוב.`)}</Note>
            <button className="btn" disabled={busy} onClick={() => run(() => advance())}>{T("Check again", "בדיקה חוזרת")}</button>
            <button className="link center" disabled={busy} onClick={() => run(async () => { await api("pay/signout", {}); setPhone(""); setCode(""); setStep({ k: "loading" }); setAttempt(n => n + 1); })}>{T("Start over", "התחלה מחדש")}</button>
          </>}
          {error && <Note tone="error">{error}</Note>}
        </div>
      </div>
      {elsewhere && (
        <Sheet onClose={() => setElsewhere(false)} title={T("This number is connected to another device", "המספר הזה מחובר למכשיר אחר")}>
          <div className="stack">
            <p className="dim">{T("A payment account can only be connected to one device. If you continue, it moves to Kav and is disconnected from the other one, such as Moovit's app.",
              "חשבון תשלום יכול להיות מחובר למכשיר אחד בלבד. אם תמשיכו, הוא יעבור ל-Kav וינותק מהמכשיר האחר, למשל מהאפליקציה של Moovit.")}</p>
            <button className="btn primary" disabled={busy} onClick={() => run(async () => { const v: any = await api("pay/verify", { code, takeOver: true }); setElsewhere(false); await verified({ ...v, elsewhere: false }); })}>{T("Connect to Kav", "חיבור ל-Kav")}</button>
            <button className="link center" onClick={() => setElsewhere(false)}>{T("Cancel", "ביטול")}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---- today's tickets -------------------------------------------------------------------------

function WalletView({ highlight, onExit }: { highlight: Ticket[] | null; onExit: (t: Ticket) => void }) {
  const wallet = useLoad<Wallet>("wallet", s => api("pay/tickets", undefined, s), 60000);
  const [shown, setShown] = useState<Ticket | null>(highlight?.[0] ?? null);
  const now = useNow(15000);
  const tickets = wallet.data?.tickets ?? [];
  return (
    <div className="stack">
      {wallet.data?.window && wallet.data.window.untilUtc > Date.now() && (
        <Note>{wallet.data.window.title || T(`Free rides until ${clock(secs(wallet.data.window.untilUtc))}`, `נסיעות חינם עד ${clock(secs(wallet.data.window.untilUtc))}`)}
          {wallet.data.window.text && <div className="dim small">{wallet.data.window.text}</div>}</Note>
      )}
      <div className="list-head">{T("Today's tickets", "הכרטיסים של היום")}</div>
      {wallet.loading && !wallet.data && <Spinner />}
      {wallet.error && <Note tone="error">{wallet.error}</Note>}
      {wallet.data && !tickets.length && <div className="dim">{T("No tickets today.", "אין כרטיסים היום.")}</div>}
      {tickets.map(t => {
        const ends = secs(t.endsUtc);
        const valid = t.active && (!ends || ends > now);
        return (
          <div key={`${t.id}:${t.ref}`} className={"card ticket" + (valid ? " valid" : "")} onClick={() => setShown(t)}>
            <div className="ticket-top"><b dir="auto">{t.title}</b><span>{money(t.price)}</span></div>
            <div className="dim small" dir="auto">{[t.agency, t.passenger || (t.anonymous ? T("Guest", "אורח") : t.profile), clock(secs(t.boughtUtc))].filter(Boolean).join(" · ")}</div>
            {valid && ends > 0 && <div className="small">{T(`Valid until ${clock(ends)}`, `בתוקף עד ${clock(ends)}`)}</div>}
            {t.needsExit && t.active && <button className="btn primary small" onClick={e => { e.stopPropagation(); onExit(t); }}>{T("End train ride", "סיום נסיעה ברכבת")}</button>}
          </div>
        );
      })}
      {shown && (
        <Sheet onClose={() => setShown(null)} title={shown.title}>
          <div className="stack center-items">
            {shown.qr ? <Qr text={shown.qr} size={260} /> : <div className="dim">{T("No code on this ticket.", "אין קוד בכרטיס הזה.")}</div>}
            <div dir="auto">{[shown.agency, shown.passenger || shown.profile].filter(Boolean).join(" · ")}</div>
            <div className="dim small">{money(shown.price)} · {clock(secs(shown.boughtUtc))}{shown.endsUtc ? ` → ${clock(secs(shown.endsUtc))}` : ""} · #{shown.ref}</div>
            <div className="dim small">{T("Show this code to the inspector.", "הציגו את הקוד לפקח.")}</div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ---- the fare summary and the Pay button -----------------------------------------------------

function Summary({ quote, fallback, guests, setGuests }: { quote: Quote | null; fallback: Cost | null; guests: number; setGuests: (n: number) => void }) {
  const me = quote?.main ?? fallback;
  const other = quote?.other ?? (fallback ? { price: fallback.full, full: fallback.full, reasons: [] } : null);
  const total = me ? me.price.agorot + guests * (other?.price.agorot ?? 0) : null;
  return (
    <div className="card pad stack">
      <div className="ticket-top"><span>{T("Me", "אני")}</span><b>{money(me?.price)}</b></div>
      {me && me.full.agorot > me.price.agorot && <div className="dim small">{T("Full fare", "מחיר מלא")} {money(me.full)}{me.reasons.length ? " · " + me.reasons.join(", ") : ""}</div>}
      <div className="ticket-top">
        <span>{T("Other passengers", "נוסעים נוספים")}</span>
        <span className="stepper"><button onClick={() => setGuests(Math.max(0, guests - 1))} aria-label="-"><MinusGlyph size={14} /></button><b>{guests}</b><button onClick={() => setGuests(Math.min(9, guests + 1))} aria-label="+"><PlusGlyph size={14} /></button></span>
      </div>
      {guests > 0 && <div className="dim small">{guests} × {money(other?.price)}</div>}
      <div className="ticket-top total"><span>{T("Total", "סה״כ")}</span><b>{total != null ? money({ agorot: total, code: me!.price.code }) : "—"}</b></div>
    </div>
  );
}

function usePurchase(onBought: (t: Ticket[]) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buy = async (call: () => Promise<{ tickets: Ticket[]; unconfirmed?: boolean }>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = await call();
      if (r.unconfirmed) setError(T("Moovit didn't confirm the payment. Check Today's tickets before trying again.", "Moovit לא אישרה את התשלום. בדקו את הכרטיסים של היום לפני שמנסים שוב."));
      else onBought(r.tickets);
    } catch (e) { setError(payError(e)); }
    setBusy(false);
  };
  return { busy, error, setError, buy };
}

// ---- a bus, from its QR code -----------------------------------------------------------------

// The bus scanned earlier and not paid for yet, ready to pay without standing up to scan it again.
function LastBus({ onPay }: { onPay: (qr: string) => void }) {
  const [bus, setBus] = useState(lastBus);
  if (!bus) return null;
  return (
    <div className="card pad stack">
      <div><b>{T("Forgot to pay?", "שכחתם לשלם?")}</b>
        <div className="dim small">{T(`You scanned a bus at ${clock(Math.floor(bus.atMs / 1000))}. Pay for it from here, no need to scan again.`,
          `סרקתם אוטובוס ב-${clock(Math.floor(bus.atMs / 1000))}. אפשר לשלם עליו מכאן, בלי לסרוק שוב.`)}</div></div>
      <button className="btn primary" onClick={() => onPay(bus.qr)}>{T("Pay for this bus", "תשלום על האוטובוס הזה")}</button>
      <button className="link center" onClick={() => { forgetBus(); setBus(null); }}>{T("Forget it", "לא צריך")}</button>
    </div>
  );
}

function BusPurchase({ qr: kept, onBack, onBought }: { qr?: string; onBack: () => void; onBought: (t: Ticket[]) => void }) {
  const [qr, setQrState] = useState<string | null>(kept ?? null);
  const setQr = (code: string | null) => { if (code) keepBus(code); setQrState(code); };
  const offerAt = useRef(0);
  const [manual, setManual] = useState("");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [fare, setFare] = useState<Fare | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guests, setGuests] = useState(0);
  const [loading, setLoading] = useState(false);
  const [noFix, setNoFix] = useState(false);
  const p = usePurchase(t => { forgetBus(); onBought(t); });
  const at = useRef<LatLon | null>(null);

  useEffect(() => {
    if (!qr) return;
    setLoading(true); p.setError(null);
    (async () => {
      at.current = await payAt();
      setNoFix(!at.current);
      const o = await api<Offer>("pay/price", { qr, at: at.current });
      offerAt.current = Date.now();
      setOffer(o);
      if (o.fares.length === 1) setFare(o.fares[0]);
    })().catch(e => p.setError(payError(e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr]);

  useEffect(() => {
    if (!offer || !fare) return;
    setQuote(null);
    api<Quote>("pay/quote", { offer, fare, at: at.current }).then(setQuote, () => setQuote(null));
  }, [offer, fare]);

  const fallback = fare ? { price: fare.price, full: fare.full ?? fare.price, reasons: fare.reasons } : null;
  return (
    <div className="screen">
      <Header title={T("Pay for a bus", "תשלום באוטובוס")} back={onBack} />
      <div className="scroll">
        <div className="pad stack">
          {!qr && <>
            <Scanner onCode={setQr} />
            <div className="dim small">{T("Or type the number under the code:", "או הקלידו את המספר שמתחת לברקוד:")}</div>
            <div className="row-btns">
              <input className="field ltr" inputMode="numeric" value={manual} onChange={e => setManual(e.target.value.trim())} placeholder="123456" />
              <button className="btn" disabled={!manual} onClick={() => setQr(manual)}>{T("Next", "הבא")}</button>
            </div>
          </>}
          {loading && <Spinner text={T("Asking Moovit for the fare…", "שואלים את Moovit על המחיר…")} />}
          {noFix && offer && <Note tone="warn">{T("Kav couldn't find your location, so Moovit priced the ride from the city centre. Check the fare before paying.",
            "Kav לא מצאה את המיקום שלכם, ולכן Moovit תמחרה את הנסיעה ממרכז העיר. בדקו את המחיר לפני התשלום.")}</Note>}
          {offer && !fare && <>
            <div className="list-head">{T("Where are you going?", "לאן נוסעים?")}</div>
            {offer.fares.map((f, k) => (
              <button key={k} className="card row-card" onClick={() => setFare(f)}>
                <span dir="auto">{f.to ?? (f.radius ? T(`Up to ${f.radius / 1000} km`, `עד ${f.radius / 1000} ק״מ`) : T("Ride", "נסיעה"))}</span>
                <b>{money(f.price)}</b>
              </button>
            ))}
          </>}
          {offer && fare && <>
            <div className="dim" dir="auto">{[offer.profile, fare.to ?? (fare.radius ? T(`up to ${fare.radius / 1000} km`, `עד ${fare.radius / 1000} ק״מ`) : "")].filter(Boolean).join(" · ")}</div>
            <Summary quote={quote} fallback={fallback} guests={guests} setGuests={setGuests} />
            <PayButton busy={p.busy} quote={quote} fallback={fallback} guests={guests}
              onPay={() => p.buy(async () => {
                // Moovit's offer goes stale after a while: a fresh one, from where you are now, for the same fare.
                let o: Offer = offer, f: Fare | null = fare;
                if (Date.now() - offerAt.current > 60_000) {
                  at.current = await payAt() ?? at.current;
                  o = await api<Offer>("pay/price", { qr, at: at.current });
                  offerAt.current = Date.now();
                  f = o.fares.find(x => x.code === fare.code && x.regionId === fare.regionId) ?? (o.fares.length === 1 ? o.fares[0] : null);
                  setOffer(o); setFare(f);
                  if (!f) throw new Error(T("The fares changed since you scanned. Choose yours again.", "המחירים השתנו מאז הסריקה. בחרו שוב את המחיר שלכם."));
                  if (f.price.agorot !== fare.price.agorot) throw new Error(T(`The fare is now ${money(f.price)}. Check it and tap Pay again.`, `המחיר עכשיו ${money(f.price)}. בדקו ולחצו שוב על תשלום.`));
                }
                return api("pay/buy", { offer: o, fare: f, at: at.current, count: guests + 1 });
              })} />
            {offer.fares.length > 1 && <button className="link" onClick={() => { setFare(null); setQuote(null); }}>{T("Choose another fare", "בחירת מחיר אחר")}</button>}
          </>}
          {p.error && <Note tone="error">{p.error}</Note>}
          {qr && !p.busy && <button className="link" onClick={() => { setQr(null); setOffer(null); setFare(null); setQuote(null); setNoFix(false); p.setError(null); }}>{T("Scan again", "סריקה מחדש")}</button>}
        </div>
      </div>
    </div>
  );
}

function PayButton({ busy, quote, fallback, guests, onPay }: { busy: boolean; quote: Quote | null; fallback: Cost | null; guests: number; onPay: () => void }) {
  const me = quote?.main ?? fallback;
  const each = quote?.other?.price ?? fallback?.full;
  const total = me ? me.price.agorot + guests * (each?.agorot ?? 0) : null;
  return <button className="btn primary big" disabled={busy || total == null} onClick={onPay}>
    {busy ? T("Paying…", "משלמים…") : T(`Pay ${total != null ? shekels(total) : ""}`, `תשלום ${total != null ? shekels(total) : ""}`)}</button>;
}

function Scanner({ onCode }: { onCode: (code: string) => void }) {
  return isNative ? <NativeScanner onCode={onCode} /> : <WebScanner onCode={onCode} />;
}

// On iPhone the camera opens in a screen of its own as soon as paying for a bus starts.
function NativeScanner({ onCode }: { onCode: (code: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const opened = useRef(false);
  const scan = async () => {
    if (open) return;
    setOpen(true); setError(null);
    try {
      const code = await scanQr({ title: T("Point the camera at the QR code on the bus", "כוונו את המצלמה לברקוד שבאוטובוס"), cancel: T("Cancel", "ביטול"), torch: T("Light", "פנס") });
      if (code) onCode(code);
    } catch (e) {
      setError(e instanceof CameraDenied
        ? T("The camera is off for Kav. Allow it in Settings → Kav → Camera, or type the number.", "המצלמה כבויה עבור Kav. אפשרו אותה בהגדרות → Kav → מצלמה, או הקלידו את המספר.")
        : T("The camera isn't available. Type the number under the code.", "המצלמה אינה זמינה. הקלידו את המספר שמתחת לברקוד."));
    }
    setOpen(false);
  };
  useEffect(() => { if (!opened.current) { opened.current = true; scan(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return <>
    <button className="btn primary big" disabled={open} onClick={scan}><QrGlyph size={20} />{T("Scan the QR code", "סריקת הברקוד")}</button>
    {error && <Note tone="warn">{error}</Note>}
  </>;
}

function WebScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, gone = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(s => {
      if (gone) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      const v = video.current!; v.srcObject = s; v.play().catch(() => {});
      const tick = () => {
        if (gone) return;
        if (v.readyState >= 2 && v.videoWidth) {
          const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(v, 0, 0, w, h);
          const hit = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          if (hit?.data) { navigator.vibrate?.(40); onCode(hit.data); return; }
        }
        timer = window.setTimeout(tick, 200);
      };
      tick();
    }).catch(() => setError(T("Kav can't use the camera. Allow it for this site, or type the number.", "ל-Kav אין גישה למצלמה. אפשרו אותה לאתר הזה, או הקלידו את המספר.")));
    if (!navigator.mediaDevices) setError(T("The camera isn't available here.", "המצלמה אינה זמינה כאן."));
    return () => { gone = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [onCode]);
  return error ? <Note tone="warn">{error}</Note> : <div className="scanner"><video ref={video} playsInline muted /><div className="scanner-frame" /></div>;
}

// ---- at a station ----------------------------------------------------------------------------

interface StationStep { none?: boolean; station: Station | null; pickOrigin: number[]; pickDestination: number[]; title: string; at: LatLon; picks: StopInfo[] }

function StationPurchase({ routeType, at: given, onBack, onBought }: { routeType: number; at?: LatLon; onBack: () => void; onBought: (t: Ticket[]) => void }) {
  const mode = MODES.find(m => m.routeType === routeType)!;
  const [step, setStep] = useState<StationStep | null>(null);
  const [origin, setOrigin] = useState(0);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [guests, setGuests] = useState(0);
  const [loading, setLoading] = useState(true);
  const p = usePurchase(onBought);

  const ask = async (body: object) => {
    setLoading(true); p.setError(null);
    try { setStep(await api<StationStep>("pay/station", { routeType, ...body })); }
    catch (e) { p.setError(payError(e)); }
    setLoading(false);
  };
  useEffect(() => {
    (async () => {
      const at = given ?? await payAt();
      if (!at) { setLoading(false); p.setError(T("Kav needs your location to find the station.", "Kav צריכה את המיקום שלכם כדי למצוא את התחנה.")); return; }
      await ask({ at, exact: !!given });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!step?.station) return;
    setQuote(null);
    api<Quote>("pay/quote", { station: step.station, routeType }).then(setQuote, () => {});
  }, [step?.station, routeType]);

  const pick = (s: StopInfo) => {
    const at = s.lat != null ? [s.lat, s.lon] as LatLon : step!.at;
    if (step!.pickOrigin.length) { setOrigin(s.id); ask({ at, exact: true, origin: s.id }); }
    else ask({ at: step!.at, exact: true, origin, destination: s.id });
  };
  const st = step?.station;
  const fallback = st?.price ? { price: st.price, full: st.full ?? st.price, reasons: st.reasons } : null;

  return (
    <div className="screen">
      <Header title={mode.label()} back={onBack} />
      <div className="scroll">
        <div className="pad stack">
          {loading && <Spinner text={T("Finding the station…", "מחפשים את התחנה…")} />}
          {step?.none && <Note>{T(`No ${mode.label().toLowerCase()} station near you.`, `אין תחנת ${mode.label()} לידכם.`)}</Note>}
          {step && !st && !step.none && <>
            <div className="list-head" dir="auto">{step.title || (step.pickOrigin.length ? T("Which station are you at?", "באיזו תחנה אתם?") : T("Where are you going?", "לאן נוסעים?"))}</div>
            <ul className="list">{step.picks.map(s => <li key={s.id} className="row" onClick={() => pick(s)}><div className="row-main" dir="auto">{s.name}</div></li>)}</ul>
          </>}
          {st && <>
            <h2 dir="auto">{st.name}</h2>
            <Summary quote={quote} fallback={fallback} guests={guests} setGuests={setGuests} />
            <PayButton busy={p.busy} quote={quote} fallback={fallback} guests={guests}
              onPay={() => p.buy(() => api("pay/enter", { station: st, at: step!.at, routeType, count: guests + 1, picked: origin !== 0 }))} />
            {routeType === 2 && <div className="dim small">{T("At the end of the ride, open Pay and end it to get the exit ticket.", "בסוף הנסיעה, פתחו את מסך התשלום וסיימו אותה כדי לקבל כרטיס יציאה.")}</div>}
          </>}
          {p.error && <Note tone="error">{p.error}</Note>}
        </div>
      </div>
    </div>
  );
}

// ---- leaving the train -----------------------------------------------------------------------

interface Exit { stopId: number; name: string; price: Price | null; full: Price | null; pick: number[]; title: string; at: LatLon; picks: StopInfo[] }

function TrainExit({ ticket, onBack, onDone }: { ticket: Ticket; onBack: () => void; onDone: (t: Ticket[]) => void }) {
  const [exit, setExit] = useState<Exit | null>(null);
  const [manual, setManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const p = usePurchase(onDone);
  const ask = async (body: object) => {
    setLoading(true); p.setError(null);
    try { setExit(await api<Exit>("pay/exitPrice", body)); } catch (e) { p.setError(payError(e)); }
    setLoading(false);
  };
  useEffect(() => { payAt().then(at => at ? ask({ at }) : (setLoading(false), p.setError(T("Kav needs your location to find the station.", "Kav צריכה את המיקום שלכם כדי למצוא את התחנה.")))); /* eslint-disable-next-line */ }, []);
  return (
    <div className="screen">
      <Header title={T("End train ride", "סיום נסיעה ברכבת")} back={onBack} />
      <div className="scroll">
        <div className="pad stack">
          {loading && <Spinner />}
          {exit && !exit.price && exit.picks.length > 0 && <>
            <div className="list-head" dir="auto">{exit.title || T("Which station are you leaving at?", "באיזו תחנה אתם יוצאים?")}</div>
            <ul className="list">{exit.picks.map(s => <li key={s.id} className="row" onClick={() => { if (s.lat != null) { setManual(true); ask({ at: [s.lat, s.lon], exact: true }); } }}><div className="row-main" dir="auto">{s.name}</div></li>)}</ul>
          </>}
          {exit?.price && <>
            <h2 dir="auto">{exit.name}</h2>
            <div className="card pad ticket-top"><span>{T("Exit fare", "מחיר היציאה")}</span><b>{money(exit.price)}</b></div>
            <button className="btn primary big" disabled={p.busy} onClick={() => p.buy(() => api("pay/exit", { at: exit.at, fromStopId: ticket.fromStopId, ref: ticket.ref, manual }))}>
              {p.busy ? T("Paying…", "משלמים…") : T(`Pay ${money(exit.price)} and exit`, `תשלום ${money(exit.price)} ויציאה`)}</button>
          </>}
          <button className="link center" disabled={p.busy} onClick={() => {
            if (confirm(T("Cancel this entrance? Only if you didn't ride: it's free.", "לבטל את הכניסה? רק אם לא נסעתם: זה בחינם.")))
              p.buy(async () => ({ tickets: (await api<{ tickets: Ticket[] }>("pay/exit", { at: exit?.at ?? await payAt(), fromStopId: ticket.fromStopId, ref: ticket.ref, cancel: true })).tickets }));
          }}>{T("I didn't ride: cancel the entrance", "לא נסעתי: ביטול הכניסה")}</button>
          {p.error && <Note tone="error">{p.error}</Note>}
        </div>
      </div>
    </div>
  );
}

// ---- history and bills -----------------------------------------------------------------------

function History({ onBack }: { onBack: () => void }) {
  const today = new Date();
  const [month, setMonth] = useState(today.getFullYear() * 12 + today.getMonth());
  const history = useLoad<{ charges: { name: string; atUtc: number; amount: Price | null; full: Price | null }[] }>(`hist:${month}`,
    s => api(`pay/history?month=${month % 12 + 1}&year=${Math.floor(month / 12)}`, undefined, s));
  const billing = useLoad<{ current: { price: Price | null; atUtc: number } | null; past: { price: Price | null; atUtc: number }[] }>("billing", s => api("pay/billing", undefined, s));
  const label = new Date(Math.floor(month / 12), month % 12, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const date = (t: number) => new Date(secs(t) * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div className="screen">
      <Header title={T("History and bills", "היסטוריה וחיובים")} back={onBack} />
      <div className="scroll">
        <div className="pad stack">
          {billing.data?.current && <div className="card pad ticket-top"><span>{T("This period so far", "התקופה הנוכחית עד כה")}</span><b>{money(billing.data.current.price)}</b></div>}
          <div className="row-btns">
            <button className="btn" onClick={() => setMonth(m => m - 1)} aria-label={T("Previous month", "החודש הקודם")}><BackGlyph size={16} /></button>
            <b className="grow center">{label}</b>
            <button className="btn" disabled={month >= today.getFullYear() * 12 + today.getMonth()} onClick={() => setMonth(m => m + 1)} aria-label={T("Next month", "החודש הבא")}><BackGlyph size={16} style={{ rotate: "180deg" }} /></button>
          </div>
          {history.loading && <Spinner />}
          {history.error && <Note tone="error">{history.error}</Note>}
          <ul className="list">
            {history.data?.charges.map((c, k) => (
              <li key={k} className="row"><div className="row-main"><div dir="auto">{c.name}</div><div className="dim small">{date(c.atUtc)} · {clock(secs(c.atUtc))}</div></div><b>{money(c.amount)}</b></li>
            ))}
            {history.data && !history.data.charges.length && <li className="pad dim">{T("No rides this month.", "אין נסיעות בחודש הזה.")}</li>}
          </ul>
          {!!billing.data?.past.length && <>
            <div className="list-head">{T("Past bills", "חיובים קודמים")}</div>
            <ul className="list">{billing.data.past.map((b, k) => <li key={k} className="row"><div className="row-main">{date(b.atUtc)}</div><b>{money(b.price)}</b></li>)}</ul>
          </>}
        </div>
      </div>
    </div>
  );
}
