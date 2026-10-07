// The gestures an iPhone hand expects: a swipe in from the leading edge goes back (an arrow follows the
// finger and the back button under it is pressed on release), and a sheet pulled down by its top closes.
import { buzz } from "./native.ts";

const EDGE = 28;      // how close to the edge a back swipe has to start, in px
const COMMIT = 80;    // how far it has to travel to go back

const shown = (el: Element) => el.getClientRects().length > 0;

// The back (or close) button of whatever is on top: the last one in the page that can be seen.
function backButton(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-back]")].filter(shown);
  return all[all.length - 1] ?? null;
}

export function installGestures() {
  const arrow = document.createElement("div");
  arrow.className = "edge-back";
  arrow.innerHTML = `<svg viewBox="0 0 100 100" width="22" height="22" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M64 18L30 50l34 32"/></svg>`;
  document.body.appendChild(arrow);

  let start: { x: number; y: number; rtl: boolean; target: HTMLElement } | null = null;
  let dx = 0;

  const show = (p: number) => {
    const rtl = start?.rtl;
    arrow.style.opacity = String(Math.min(1, p * 1.4));
    arrow.style.transform = `translateY(-50%) translateX(${(rtl ? -1 : 1) * (p * 46 - 46)}px) scale(${0.7 + 0.3 * Math.min(1, p)})`;
    arrow.classList.toggle("ready", p >= 1);
  };
  const reset = () => { start = null; dx = 0; arrow.style.opacity = "0"; arrow.classList.remove("ready"); };

  document.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const rtl = document.documentElement.dir === "rtl";
    const fromEdge = rtl ? window.innerWidth - t.clientX < EDGE : t.clientX < EDGE;
    const target = fromEdge ? backButton() : null;
    if (!target) return;
    start = { x: t.clientX, y: t.clientY, rtl, target };
    arrow.style.top = `${t.clientY}px`;
    arrow.classList.toggle("rtl", rtl);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!start) return;
    const t = e.touches[0];
    dx = start.rtl ? start.x - t.clientX : t.clientX - start.x;
    // A scroll, not a swipe back.
    if (Math.abs(t.clientY - start.y) > Math.max(40, dx)) { reset(); return; }
    show(Math.max(0, dx) / COMMIT);
  }, { passive: true });

  document.addEventListener("touchend", () => {
    if (start && dx >= COMMIT) { buzz("tap"); start.target.click(); }
    reset();
  }, { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });

  // A sheet pulled down from its top (the grip or the first bit of it) closes.
  let pull: { y: number; sheet: HTMLElement } | null = null;
  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    const sheet = (e.target as HTMLElement).closest?.(".pay-sheet, .sheet") as HTMLElement | null;
    // A wheel in the sheet scrolls by itself; the sheet stays put under it.
    if (!sheet || (e.target as HTMLElement).closest(".time-wheel")) return;
    const top = sheet.getBoundingClientRect().top;
    const scroller = sheet.querySelector(".scroll") as HTMLElement | null;
    if (t.clientY - top > 90 && (scroller?.scrollTop ?? sheet.scrollTop) > 0) return;
    pull = { y: t.clientY, sheet };
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!pull) return;
    const d = e.touches[0].clientY - pull.y;
    pull.sheet.style.transform = d > 0 ? `translateY(${d}px)` : "";
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!pull) return;
    const d = e.changedTouches[0].clientY - pull.y;
    const sheet = pull.sheet;
    pull = null;
    sheet.style.transition = "transform .25s cubic-bezier(.22,1,.36,1)";
    sheet.style.transform = "";
    setTimeout(() => { sheet.style.transition = ""; }, 260);
    if (d > 120) {
      const close = sheet.querySelector<HTMLElement>("[data-back]");
      if (close) close.click(); else (sheet.parentElement as HTMLElement | null)?.click();
    }
  }, { passive: true });
}
