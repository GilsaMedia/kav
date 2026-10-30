// A panel you drag up and down by hand, as Apple Maps' and Moovit's are: it rests at a few heights
// (detents), stays under the finger, and when let go it carries on at the finger's speed to the height the
// flick was heading for. It can be caught again while it's still moving. Only at its highest does its
// content scroll, so there is never a box scrolling inside a box.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Spring, Velocity, FLING, SETTLE, project, rubberband } from "./motion.ts";
import { buzz } from "./native.ts";

export interface DragSheetProps {
  // How far down the panel sits at each resting height, in px from fully up (0 first), given its own size.
  detents: (el: HTMLElement) => number[];
  // Which resting height it starts at.
  start?: number;
  // Rises into place from below when it first appears.
  enter?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  // Tapping this part (marked data-toggle) moves it between its first two heights.
  onDetent?: (i: number) => void;
}

export function DragSheet({ detents, start = 0, enter, className, style, children, onDetent }: DragSheetProps) {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(start);
  const atRef = useRef(at); atRef.current = at;
  const stops = useRef<number[] | null>(null);
  const dragging = useRef(false);
  const spring = useRef<Spring | null>(null);
  if (!spring.current) spring.current = new Spring(0, y => { if (el.current) el.current.style.transform = `translate3d(0, ${y}px, 0)`; });

  // The resting heights depend on the panel's size and the screen's; measured again when either changes,
  // and the panel eases to where its height now is.
  const measure = () => {
    const node = el.current;
    if (!node) return;
    const next = detents(node);
    const prev = stops.current;
    if (prev && prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1)) return;
    stops.current = next;
    const y = next[Math.min(atRef.current, next.length - 1)] ?? 0;
    if (!prev) {
      if (enter) { spring.current!.set(node.offsetHeight); spring.current!.to(y, SETTLE); }
      else spring.current!.set(y);
    } else if (!dragging.current) spring.current!.to(y, SETTLE);
  };
  // Once before it's first drawn; after that only when a size changes. Measuring on every render would force
  // a layout each time the trip's live times tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, []);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (el.current) ro.observe(el.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); spring.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i: number, velocity?: number, opts = SETTLE) => {
    const s = stops.current ?? [0];
    const n = Math.max(0, Math.min(s.length - 1, i));
    if (n !== atRef.current) { setAt(n); atRef.current = n; onDetent?.(n); }
    spring.current!.to(s[n], opts, velocity);
  };

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let x0 = 0, y0 = 0, base = 0, mode: "drag" | "scroll" | null = null;
    const vel = new Velocity();

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; mode = null;
      vel.reset(y0);
      // Caught while it's moving: it stops where it is, under the finger, rather than where it was going.
      const sp = spring.current!;
      if (sp.moving) { sp.stop(); mode = "drag"; dragging.current = true; }
      base = sp.value;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY, dy = y - y0;
      vel.add(y);
      if (mode === null) {
        if (Math.abs(dy) < 8) return;
        // Sideways is a swipe to another page (Live Directions' steps), not the panel's to move.
        if (Math.abs(e.touches[0].clientX - x0) > Math.abs(dy)) { mode = "scroll"; return; }
        // Down while the content is at its top, or any way while the panel isn't fully up: the panel moves.
        // Otherwise the content scrolls.
        const top = atRef.current === 0;
        const scrolledToTop = node.scrollTop <= 0;
        const onGrip = !!(e.target as HTMLElement).closest?.("[data-grip]");
        mode = onGrip || !top || (dy > 0 && scrolledToTop) ? "drag" : "scroll";
        if (mode === "drag") { dragging.current = true; y0 = y; base = spring.current!.value; }
        return;
      }
      if (mode !== "drag") return;
      e.preventDefault();
      const s = stops.current ?? [0], lo = s[0], hi = s[s.length - 1];
      let pos = base + dy;
      // Past either end it gives, less the further it goes.
      if (pos < lo) pos = lo + rubberband(pos - lo, node.offsetHeight);
      if (pos > hi) pos = hi + rubberband(pos - hi, node.offsetHeight);
      spring.current!.set(pos);
    };
    const end = () => {
      if (mode === "drag") {
        const s = stops.current ?? [0];
        const v = vel.get();
        const pos = spring.current!.value;
        // Where the flick was heading, as a scroll would coast there; the nearest height to that.
        const aim = pos + project(v);
        const i = s.reduce((best, d, k) => Math.abs(d - aim) < Math.abs(s[best] - aim) ? k : best, 0);
        if (i !== atRef.current) buzz("tap");
        // Thrown, it lands with a little give; set down slowly, it just settles.
        go(i, v, Math.abs(v) > 400 ? FLING : SETTLE);
      }
      dragging.current = false;
      mode = null;
    };
    node.addEventListener("touchstart", start, { passive: true });
    node.addEventListener("touchmove", move, { passive: false });
    node.addEventListener("touchend", end, { passive: true });
    node.addEventListener("touchcancel", end, { passive: true });
    return () => {
      node.removeEventListener("touchstart", start);
      node.removeEventListener("touchmove", move);
      node.removeEventListener("touchend", end);
      node.removeEventListener("touchcancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={el} className={"drag-sheet" + (at === 0 ? " up" : "") + (className ? " " + className : "")} style={style}
      onClick={e => { if ((e.target as HTMLElement).closest("[data-toggle]")) go(atRef.current === 0 ? 1 : 0); }}>
      {children}
    </div>
  );
}
