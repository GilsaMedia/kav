// Motion as an iPhone moves things: springs that start from wherever a thing is on screen, at the speed the
// finger left it, so a drag and the settle after it are one movement, and anything moving can be caught again.
// Springs are described as Apple's are: a damping ratio (1 settles without overshooting, lower bounces) and a
// response (about how long, in seconds, it takes to get there).

export interface SpringOpts { damping?: number; response?: number }

// Calm for things that just move; a little give only after a flick, when the hand threw it there.
export const SETTLE: SpringOpts = { damping: 1, response: 0.4 };
export const FLING: SpringOpts = { damping: 0.82, response: 0.36 };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// One animated number. `to` re-aims it from where it is now, keeping its speed, so a change of mind mid-flight
// bends the movement instead of stopping it dead.
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private raf = 0;
  private last = 0;
  private k = 0;
  private c = 0;
  private done?: () => void;

  constructor(value: number, private onUpdate: (v: number) => void) {
    this.value = this.target = value;
  }

  get moving() { return this.raf !== 0; }

  to(target: number, opts: SpringOpts = SETTLE, velocity?: number, done?: () => void) {
    this.target = target;
    if (velocity != null) this.velocity = velocity;
    this.done = done;
    const { damping = 1, response = 0.4 } = opts;
    const w = (2 * Math.PI) / Math.max(0.05, response);
    this.k = w * w;
    this.c = 2 * damping * w;
    if (reduced()) { this.set(target); done?.(); return; }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }

  // Straight there, without moving: under the finger, or when nothing should animate.
  set(v: number) {
    this.stop();
    this.value = this.target = v;
    this.velocity = 0;
    this.onUpdate(v);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number) => {
    // Small fixed steps, so a dropped frame doesn't change the path.
    let dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -this.k * (this.value - this.target) - this.c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
      dt -= h;
    }
    if (Math.abs(this.value - this.target) < 0.25 && Math.abs(this.velocity) < 4) {
      this.raf = 0;
      this.value = this.target;
      this.velocity = 0;
      this.onUpdate(this.value);
      const done = this.done; this.done = undefined; done?.();
      return;
    }
    this.onUpdate(this.value);
    this.raf = requestAnimationFrame(this.tick);
  };
}

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
