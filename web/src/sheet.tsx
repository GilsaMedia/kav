// A panel you drag up and down by hand, as Apple Maps' and Moovit's are: it rests at a few heights
// (detents), follows the finger, and settles at the nearest one (or the next one, on a flick). Only at
// its highest does its content scroll, so there is never a box scrolling inside a box.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface DragSheetProps {
  // How far down the panel sits at each resting height, in px from fully up (0 first), given its own size.
  detents: (el: HTMLElement) => number[];
  // Which resting height it starts at.
  start?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  // Tapping this part (marked data-toggle) moves it between its first two heights.
  onDetent?: (i: number) => void;
}

export function DragSheet({ detents, start = 0, className, style, children, onDetent }: DragSheetProps) {
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(start);
  const [stops, setStops] = useState<number[]>([0]);
  const [drag, setDrag] = useState<number | null>(null);
  const atRef = useRef(at); atRef.current = at;
  const stopsRef = useRef(stops); stopsRef.current = stops;

  // The resting heights depend on the panel's size and the screen's; measured again when either changes.
  const measure = () => {
    if (!el.current) return;
    const next = detents(el.current);
    setStops(prev => prev.length === next.length && prev.every((v, i) => Math.abs(v - next[i]) < 1) ? prev : next);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (el.current) ro.observe(el.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i: number) => { const n = Math.max(0, Math.min(stopsRef.current.length - 1, i)); setAt(n); onDetent?.(n); };

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let y0 = 0, base = 0, t0 = 0, mode: "drag" | "scroll" | null = null, last = 0, lastT = 0, v = 0;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      y0 = last = e.touches[0].clientY; t0 = lastT = performance.now(); v = 0;
      base = stopsRef.current[atRef.current] ?? 0; mode = null;
    };
    const move = (e: TouchEvent) => {
      const y = e.touches[0].clientY, dy = y - y0;
      const now = performance.now();
      v = (y - last) / Math.max(1, now - lastT); last = y; lastT = now;
      if (mode === null) {
        if (Math.abs(dy) < 6) return;
        // Down while the content is at its top, or any way while the panel isn't fully up: the panel moves.
        // Otherwise the content scrolls.
        const top = atRef.current === 0;
        const scrolledToTop = node.scrollTop <= 0;
        const onGrip = !!(e.target as HTMLElement).closest?.("[data-grip]");
        mode = onGrip || !top || (dy > 0 && scrolledToTop) ? "drag" : "scroll";
      }
      if (mode !== "drag") return;
      e.preventDefault();
      const s = stopsRef.current, lo = s[0], hi = s[s.length - 1];
      let pos = base + dy;
      // A little give past either end.
      if (pos < lo) pos = lo - Math.sqrt(lo - pos) * 4;
      if (pos > hi) pos = hi + Math.sqrt(pos - hi) * 4;
      setDrag(pos);
    };
    const end = () => {
      if (mode === "drag") {
        const s = stopsRef.current;
        const pos = base + (last - y0);
        // A flick goes to the next height its way; a slow drag to the nearest.
        let i = s.reduce((best, d, k) => Math.abs(d - pos) < Math.abs(s[best] - pos) ? k : best, 0);
        if (Math.abs(v) > 0.5 && performance.now() - t0 < 600) {
          const cur = atRef.current;
          i = v > 0 ? Math.min(s.length - 1, Math.max(cur + 1, i)) : Math.max(0, Math.min(cur - 1, i));
        }
        go(i);
      }
      setDrag(null);
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

  const y = drag ?? stops[Math.min(at, stops.length - 1)] ?? 0;
  return (
    <div ref={el} className={"drag-sheet" + (at === 0 ? " up" : "") + (drag != null ? " dragging" : "") + (className ? " " + className : "")}
      style={{ ...style, transform: `translateY(${y}px)` }}
      onClick={e => { if ((e.target as HTMLElement).closest("[data-toggle]")) go(atRef.current === 0 ? 1 : 0); }}>
      {children}
    </div>
  );
}
