// The gestures an iPhone hand expects: a swipe in from the leading edge goes back (an arrow follows the
// finger and the back button under it is pressed on release), and a sheet pulled down by its top closes,
// following the finger, dimming what's behind less as it goes, and thrown away at the speed it was let go.
import { buzz } from "./native.ts";
import { Velocity, FLING, SETTLE, glide, gliding, hold, liveOffset, project, rubberband } from "./motion.ts";

const EDGE = 28;      // how close to the edge a back swipe has to start, in px
const COMMIT = 80;    // how far it has to travel to go back

const shown = (el: Element) => el.getClientRects().length > 0;

// The back (or close) button of whatever is on top: the last one in the page that can be seen.
function backButton(): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("[data-back]")].filter(shown);
  return all[all.length - 1] ?? null;
}

export function installGestures() {
  // Without a touch listener, WebKit doesn't light :active under the finger, and pressing feels dead.
  document.addEventListener("touchstart", () => {}, { passive: true });

  const arrow = document.createElement("div");
  arrow.className = "edge-back";
  arrow.innerHTML = `<svg viewBox="0 0 100 100" width="22" height="22" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M64 18L30 50l34 32"/></svg>`;
  document.body.appendChild(arrow);

  let start: { x: number; y: number; rtl: boolean; target: HTMLElement } | null = null;
  let dx = 0, ready = false;
  const edgeVel = new Velocity();
  // The arrow at a progress p (0 hidden, 1 ready): under the finger it follows at once; let go, it slides back
  // out on a transition of its own.
  const showArrow = (p: number, animate: boolean) => {
    const rtl = arrow.classList.contains("rtl");
    arrow.style.transition = animate ? "transform .3s cubic-bezier(.25, 1, .5, 1), opacity .2s, background-color .2s, color .2s" : "background-color .2s, color .2s";
    arrow.style.opacity = String(Math.min(1, p * 1.4));
    arrow.style.transform = `translateY(-50%) translateX(${(rtl ? -1 : 1) * (Math.min(p, 1.4) * 46 - 46)}px) scale(${0.7 + 0.3 * Math.min(1, p)})`;
  };

  const reset = () => {
    if (!start && !dx) return;
    start = null; dx = 0; ready = false;
    arrow.classList.remove("ready");
    showArrow(0, true);
  };

  document.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const rtl = document.documentElement.dir === "rtl";
    const fromEdge = rtl ? window.innerWidth - t.clientX < EDGE : t.clientX < EDGE;
    const target = fromEdge ? backButton() : null;
    if (!target) return;
    start = { x: t.clientX, y: t.clientY, rtl, target };
    edgeVel.reset(0);
    arrow.style.top = `${t.clientY}px`;
    arrow.classList.toggle("rtl", rtl);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!start) return;
    const t = e.touches[0];
    dx = start.rtl ? start.x - t.clientX : t.clientX - start.x;
    edgeVel.add(dx);
    // A scroll, not a swipe back.
    if (Math.abs(t.clientY - start.y) > Math.max(40, dx)) { reset(); return; }
    const p = Math.max(0, dx) / COMMIT;
    // Past the point of going back it gives only a little more, and says so once, with a tick.
    showArrow(p <= 1 ? p : 1 + rubberband(p - 1, 1), false);
    if ((p >= 1) !== ready) { ready = p >= 1; arrow.classList.toggle("ready", ready); if (ready) buzz("tap"); }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    // A quick flick in from the edge goes back too, even if it was short.
    if (start && (dx >= COMMIT || (dx > 24 && dx + project(edgeVel.get()) >= COMMIT * 1.5))) start.target.click();
    reset();
  }, { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });

  // A sheet pulled down from its top (the grip or the first bit of it) closes.
  let pull: { y: number; sheet: HTMLElement; backdrop: HTMLElement | null; base: number; d: number } | null = null;
  const pullVel = new Velocity();
  const dim = (backdrop: HTMLElement | null, d: number, h: number, animate: boolean) => {
    if (!backdrop) return;
    backdrop.classList.toggle("pulling", !animate);
    backdrop.style.setProperty("--pull", String(Math.max(0, Math.min(1, d / Math.max(1, h)))));
  };

  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    const sheet = (e.target as HTMLElement).closest?.(".pay-sheet, .sheet") as HTMLElement | null;
    // A wheel in the sheet scrolls by itself; the sheet stays put under it.
    if (!sheet || (e.target as HTMLElement).closest(".time-wheel")) return;
    const top = sheet.getBoundingClientRect().top;
    const scroller = sheet.querySelector(".scroll") as HTMLElement | null;
    if (t.clientY - top > 90 && (scroller?.scrollTop ?? sheet.scrollTop) > 0) return;
    // Caught on its way back: it stays under the finger from where it is.
    const base = gliding(sheet) ? liveOffset(sheet) : 0;
    if (base) hold(sheet, base);
    pull = { y: t.clientY, sheet, backdrop: sheet.parentElement, base, d: base };
    pullVel.reset(t.clientY);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!pull) return;
    const y = e.touches[0].clientY;
    pullVel.add(y);
    // Down it follows the finger; up is the content's to scroll.
    pull.d = Math.max(0, pull.base + y - pull.y);
    hold(pull.sheet, pull.d);
    dim(pull.backdrop, pull.d, pull.sheet.offsetHeight, false);
  }, { passive: true });

  const release = () => {
    if (!pull) return;
    const { sheet, backdrop, d } = pull;
    pull = null;
    const v = pullVel.get();
    const h = sheet.offsetHeight;
    // Closed if pulled far enough, or flicked down hard enough that it would have coasted that far.
    if (d > 0 && (d > Math.min(160, h * 0.35) || (v > 300 && d + project(v) > h * 0.5))) {
      const close = sheet.querySelector<HTMLElement>("[data-back]");
      // It leaves at the speed it was thrown, down the way it was going, rather than playing its own exit.
      sheet.classList.add("flung");
      glide(sheet, d, h + 40, Math.max(v, 600), { response: 0.3 });
      dim(backdrop, h, h, true);
      if (close) close.click(); else (sheet.parentElement as HTMLElement | null)?.click();
      return;
    }
    if (d !== 0) { glide(sheet, d, 0, v, Math.abs(v) > 400 ? FLING : SETTLE); dim(backdrop, 0, h, true); }
  };
  document.addEventListener("touchend", release, { passive: true });
  document.addEventListener("touchcancel", release, { passive: true });
}
