// The gestures an iPhone hand expects: a swipe in from the leading edge goes back (an arrow follows the
// finger and the back button under it is pressed on release), and a sheet pulled down by its top closes,
// following the finger, dimming what's behind as it goes, and thrown away at the speed it was let go.
import { buzz } from "./native.ts";
import { Spring, Velocity, FLING, SETTLE, project, rubberband } from "./motion.ts";

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
  // The arrow's progress, sprung, so it slides back out from wherever it is when the swipe is let go.
  const arrowSpring = new Spring(0, p => {
    const rtl = arrow.classList.contains("rtl");
    arrow.style.opacity = String(Math.min(1, p * 1.4));
    arrow.style.transform = `translateY(-50%) translateX(${(rtl ? -1 : 1) * (Math.min(p, 1.4) * 46 - 46)}px) scale(${0.7 + 0.3 * Math.min(1, p)})`;
  }, 0.004);

  const reset = () => {
    if (!start && !arrowSpring.value) return;
    start = null; dx = 0; ready = false;
    arrow.classList.remove("ready");
    arrowSpring.to(0, SETTLE);
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
    arrowSpring.set(p <= 1 ? p : 1 + rubberband(p - 1, 1));
    if ((p >= 1) !== ready) { ready = p >= 1; arrow.classList.toggle("ready", ready); if (ready) buzz("tap"); }
  }, { passive: true });

  document.addEventListener("touchend", () => {
    // A quick flick in from the edge goes back too, even if it was short.
    if (start && (dx >= COMMIT || (dx > 24 && dx + project(edgeVel.get()) >= COMMIT * 1.5))) start.target.click();
    reset();
  }, { passive: true });
  document.addEventListener("touchcancel", reset, { passive: true });

  // A sheet pulled down from its top (the grip or the first bit of it) closes.
  let pull: { y: number; sheet: HTMLElement; backdrop: HTMLElement | null; spring: Spring; base: number } | null = null;
  const pullVel = new Velocity();
  const springs = new WeakMap<HTMLElement, Spring>();
  const springOf = (sheet: HTMLElement, backdrop: HTMLElement | null) => {
    let s = springs.get(sheet);
    if (!s) {
      s = new Spring(0, y => {
        sheet.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
        // What's behind comes back into view as the sheet goes.
        backdrop?.style.setProperty("--pull", String(Math.max(0, Math.min(1, y / Math.max(1, sheet.offsetHeight)))));
      });
      springs.set(sheet, s);
    }
    return s;
  };

  document.addEventListener("touchstart", e => {
    const t = e.touches[0];
    const sheet = (e.target as HTMLElement).closest?.(".pay-sheet, .sheet") as HTMLElement | null;
    // A wheel in the sheet scrolls by itself; the sheet stays put under it.
    if (!sheet || (e.target as HTMLElement).closest(".time-wheel")) return;
    const top = sheet.getBoundingClientRect().top;
    const scroller = sheet.querySelector(".scroll") as HTMLElement | null;
    if (t.clientY - top > 90 && (scroller?.scrollTop ?? sheet.scrollTop) > 0) return;
    const backdrop = sheet.parentElement;
    const spring = springOf(sheet, backdrop);
    // Caught on its way back: it stays under the finger from where it is.
    spring.stop();
    pull = { y: t.clientY, sheet, backdrop, spring, base: spring.value };
    pullVel.reset(t.clientY);
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!pull) return;
    const y = e.touches[0].clientY;
    pullVel.add(y);
    const d = pull.base + y - pull.y;
    // Down it follows the finger; up is the content's to scroll.
    pull.spring.set(Math.max(0, d));
  }, { passive: true });

  const release = () => {
    if (!pull) return;
    const { sheet, spring } = pull;
    pull = null;
    const v = pullVel.get(), d = spring.value;
    const h = sheet.offsetHeight;
    // Closed if pulled far enough, or flicked down hard enough that it would have coasted that far.
    if (d > 0 && (d > Math.min(160, h * 0.35) || (v > 300 && d + project(v) > h * 0.5))) {
      const close = sheet.querySelector<HTMLElement>("[data-back]");
      // It leaves at the speed it was thrown, down the way it was going, rather than playing its own exit.
      sheet.classList.add("flung");
      spring.to(h + 40, { damping: 1, response: 0.32 }, Math.max(v, 600));
      if (close) close.click(); else (sheet.parentElement as HTMLElement | null)?.click();
      return;
    }
    if (d !== 0) spring.to(0, Math.abs(v) > 400 ? FLING : SETTLE, v);
  };
  document.addEventListener("touchend", release, { passive: true });
  document.addEventListener("touchcancel", release, { passive: true });
}
