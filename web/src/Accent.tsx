// The accent: a wheel of pale colours, the Android app's presets, and a small preview of Kav wearing it.
import { useRef } from "react";
import { T, usePrefs, setPrefs, DEFAULT_ACCENT } from "./core.ts";
import { SearchGlyph } from "./icons.tsx";

const MAX_SAT = .62;
const PRESETS: { en: string; he: string; hue: number; sat: number }[] = [
  { en: "Blue", he: "כחול", hue: 219, sat: .40 }, { en: "Green", he: "ירוק", hue: 140, sat: .38 },
  { en: "Teal", he: "טורקיז", hue: 178, sat: .42 }, { en: "Violet", he: "סגול", hue: 262, sat: .34 },
  { en: "Amber", he: "ענבר", hue: 44, sat: .48 }, { en: "Pink", he: "ורוד", hue: 338, sat: .36 },
  { en: "White", he: "לבן", hue: 0, sat: 0 },
];

// HSV with full value, as Compose's Color.hsv.
function hsv(h: number, s: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map(v => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function toHsv(hex: string): [number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max === 0 ? 0 : d / max];
}

export function AccentPicker() {
  const prefs = usePrefs();
  const wheel = useRef<HTMLDivElement>(null);
  const [hue, sat] = toHsv(/^#[0-9a-f]{6}$/i.test(prefs.accent) ? prefs.accent : DEFAULT_ACCENT);
  const pick = (e: React.PointerEvent) => {
    const box = wheel.current!.getBoundingClientRect();
    const r = box.width / 2, dx = e.clientX - box.left - r, dy = e.clientY - box.top - r;
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    setPrefs({ accent: hsv(h, Math.min(1, Math.hypot(dx, dy) / (r * .92)) * MAX_SAT) });
  };
  const a = hue * Math.PI / 180, dist = Math.min(1, sat / MAX_SAT) * 50 * .92;
  return (
    <>
      <div ref={wheel} className="wheel" aria-label={T("Colour wheel", "גלגל צבעים")}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
        onPointerMove={e => { if (e.buttons) pick(e); }}>
        <span className="wheel-dot" style={{ left: `${50 + Math.cos(a) * dist}%`, top: `${50 + Math.sin(a) * dist}%`, background: prefs.accent }} />
      </div>
      <div className="swatches">
        {PRESETS.map(p => {
          const on = (p.sat < .02 && sat < .02) || (Math.abs(p.hue - hue) < 2 && Math.abs(p.sat - sat) < .02);
          return <button key={p.en} className={"swatch" + (on ? " on" : "")} style={{ background: hsv(p.hue, p.sat) }}
            aria-label={T(p.en, p.he)} onClick={() => setPrefs({ accent: hsv(p.hue, p.sat) })} />;
        })}
      </div>
    </>
  );
}

// A corner of Kav in the chosen look and accent: the search bar, a departure, the live dot and a button.
export function AccentPreview() {
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview-head"><b>{T("Home", "בית")}</b></div>
      <div className="preview-search card"><SearchGlyph size={14} /><span>{T("Where to?", "לאן?")}</span></div>
      <div className="preview-card card">
        <div className="preview-band"><span>{T("Wait for", "המתנה ל־")}</span><span>{T("Resume", "המשך")}</span></div>
        <div className="preview-row"><span className="badge small">472</span><span className="grow dim">{T("to Tel Aviv", "לתל אביב")}</span><span className="dep live">{T("3 min", "3 דק׳")}</span></div>
      </div>
      <div className="preview-row"><span className="live-dot" /><span className="grow dep live">{T("Live", "בזמן אמת")}</span><span className="preview-btn">{T("Start", "התחלה")}</span></div>
    </div>
  );
}
