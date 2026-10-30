// Saved lists put in your own order: in Edit, each row has a handle, and the row follows the finger up or down
// while the others make room; it's dropped where it's let go.
import { useRef } from "react";
import { T } from "./core.ts";
import { buzz } from "./native.ts";

// The rows are the list's children marked data-row, in the order of the saved list.
export function useReorder(onMove: (from: number, to: number) => void) {
  const list = useRef<HTMLUListElement | null>(null);
  const drag = useRef<{ from: number; to: number; y: number; id: number; rows: HTMLElement[]; mids: number[]; h: number } | null>(null);

  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.rows.forEach(r => { r.style.transform = ""; r.style.transition = ""; r.classList.remove("dragging"); });
    if (d.to !== d.from) { buzz("tap"); onMove(d.from, d.to); }
  };

  const grip = (i: number) => ({
    className: "grip",
    "aria-label": T("Drag to move", "גררו כדי להזיז"),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const rows = [...(list.current?.children ?? [])].filter(el => el.hasAttribute("data-row")) as HTMLElement[];
      if (!rows[i]) return;
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rects = rows.map(r => r.getBoundingClientRect());
      drag.current = { from: i, to: i, y: e.clientY, id: e.pointerId, rows, mids: rects.map(r => r.top + r.height / 2), h: rects[i].height };
      rows.forEach((r, k) => { r.style.transition = k === i ? "none" : "transform .45s var(--spring)"; });
      rows[i].classList.add("dragging");
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y;
      const centre = d.mids[d.from] + dy;
      let to = d.from;
      d.mids.forEach((m, k) => { if (k < d.from && centre < m) to = Math.min(to, k); if (k > d.from && centre > m) to = Math.max(to, k); });
      d.to = to;
      d.rows.forEach((r, k) => {
        if (k === d.from) { r.style.transform = `translateY(${dy}px)`; return; }
        const shift = k > d.from && k <= to ? -d.h : k < d.from && k >= to ? d.h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    },
    onPointerUp: end,
    onPointerCancel: end,
  });

  return { list, grip };
}

// The handle: three short lines, as iOS draws it.
export const GripGlyph = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 100 100" width={size} height={size} className="glyph" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" aria-hidden="true">
    <line x1={20} y1={32} x2={80} y2={32} /><line x1={20} y1={50} x2={80} y2={50} /><line x1={20} y1={68} x2={80} y2={68} />
  </svg>
);
