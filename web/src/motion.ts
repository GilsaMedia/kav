// Motion as an iPhone moves things: a thing let go carries on at the speed the finger left it, toward where a
// flick was heading, and can be caught again mid-flight. The movement after the finger is a CSS transition, so
// iOS runs it off the main thread (Core Animation), smooth even while the app is busy; its curve is chosen so
// it starts at the finger's speed, and catching it reads where it is on screen right now.

export interface GlideOpts { response?: number; bounce?: boolean }

// Calm for things that just move; a little give only after a flick, when the hand threw it there.
export const SETTLE: GlideOpts = { response: 0.42 };
export const FLING: GlideOpts = { response: 0.4, bounce: true };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Where a thing is on screen this instant, even halfway through a transition.
export function liveOffset(el: HTMLElement, axis: "x" | "y" = "y"): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = new DOMMatrixReadOnly(t);
  return axis === "x" ? m.m41 : m.m42;
}

const place = (axis: "x" | "y", v: number) => axis === "y" ? `translate3d(0, ${v}px, 0)` : `translate3d(${v}px, 0, 0)`;

// Straight there, under the finger.
export function hold(el: HTMLElement, v: number, axis: "x" | "y" = "y") {
  el.style.transition = "none";
  el.style.transform = v ? place(axis, v) : "";
}

// From where it is to `to`, starting at `velocity` (px/s). The curve's first handle is tilted so its starting
// slope is that speed, so there's no seam between the drag and the glide. Calls done once it's there, unless
// it's caught or re-aimed first.
export function glide(el: HTMLElement, from: number, to: number, velocity = 0, opts: GlideOpts = SETTLE, axis: "x" | "y" = "y", done?: () => void) {
  const dist = to - from;
  if (reduced() || Math.abs(dist) < 0.5) { hold(el, to, axis); done?.(); return; }
  const secs = Math.min(0.62, Math.max(0.24, (opts.response ?? 0.42) * (opts.bounce ? 1.25 : 1.1)));
  // Speed relative to the whole trip, per unit of the curve's time: the slope the curve should start with.
  const slope = Math.max(-2, Math.min(5, (velocity * secs) / dist));
  const x1 = 0.3, y1 = slope > 0 ? Math.max(0.12, slope * x1) : slope * x1;
  const curve = opts.bounce ? `cubic-bezier(${x1}, ${y1.toFixed(3)}, 0.32, 1.12)` : `cubic-bezier(${x1}, ${y1.toFixed(3)}, 0.25, 1)`;
  // Start from exactly where it is (the finger's last place, or where it was caught), then let go.
  hold(el, from, axis);
  void el.offsetWidth;
  el.style.transition = `transform ${secs.toFixed(3)}s ${curve}`;
  el.style.transform = to ? place(axis, to) : "";
  const token = Symbol();
  (el as HTMLElement & { _glide?: symbol })._glide = token;
  const end = () => {
    el.removeEventListener("transitionend", end);
    if ((el as HTMLElement & { _glide?: symbol })._glide !== token) return;
    el.style.transition = "";
    done?.();
  };
  el.addEventListener("transitionend", end);
  setTimeout(end, secs * 1000 + 80);
}

export const gliding = (el: HTMLElement) => !!el.style.transition && el.style.transition !== "none";

// Where a flick would come to rest if it were left to slow down as a scroll does (Apple's own projection).
export function project(velocity: number, rate = 0.998) {
  return (velocity / 1000) * rate / (1 - rate);
}

// Past an edge the thing follows less and less, as if held back by something elastic.
export function rubberband(over: number, size: number, c = 0.55) {
  const sign = over < 0 ? -1 : 1, d = Math.abs(over);
  return sign * (d * size * c) / (size + c * d);
}

// The finger's speed, from the last tenth of a second of its path, in px per second.
export class Velocity {
  private pts: { v: number; t: number }[] = [];
  reset(v: number) { this.pts = [{ v, t: performance.now() }]; }
  add(v: number) {
    const t = performance.now();
    this.pts.push({ v, t });
    while (this.pts.length > 2 && t - this.pts[0].t > 100) this.pts.shift();
  }
  get(): number {
    const p = this.pts;
    if (p.length < 2) return 0;
    const a = p[0], b = p[p.length - 1];
    // A finger held still before letting go has no speed left.
    if (performance.now() - b.t > 80) return 0;
    const dt = (b.t - a.t) / 1000;
    return dt > 0 ? (b.v - a.v) / dt : 0;
  }
}
