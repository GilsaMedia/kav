// The Android app's glyphs, drawn the same way: thin round strokes on a square, in the current colour.
import type { CSSProperties, ReactNode } from "react";

type Props = { size?: number; className?: string; style?: CSSProperties; flip?: boolean };

function Glyph({ size = 20, className, style, flip, w = 9, children }: Props & { w?: number; children: ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={"glyph" + (flip ? " flip" : "") + (className ? " " + className : "")}
      style={style} fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const L = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} />;

// ---- the tab bar -----------------------------------------------------------------------------

export const TripGlyph = (p: Props) => <Glyph {...p}>
  {L(10, 45, 50, 12)}{L(50, 12, 90, 45)}{L(23, 40, 23, 86)}{L(23, 86, 77, 86)}
  {L(77, 86, 77, 40)}{L(43, 86, 43, 62)}{L(43, 62, 59, 62)}{L(59, 62, 59, 86)}
</Glyph>;

export const StationsGlyph = (p: Props) => <Glyph {...p}>
  <circle cx={50} cy={34} r={20} />{L(50, 54, 50, 86)}{L(32, 86, 68, 86)}
</Glyph>;

export const LinesGlyph = (p: Props) => <Glyph {...p}>
  {[22, 50, 78].map((y, i) => <g key={y}><circle cx={18} cy={y} r={8.5} fill="currentColor" stroke="none" />{L(34, y, i === 1 ? 86 : 70, y)}</g>)}
</Glyph>;

export const LiveGlyph = (p: Props) => <Glyph {...p}>
  <circle cx={50} cy={50} r={14} fill="currentColor" stroke="none" />
  <circle cx={50} cy={50} r={30} /><circle cx={50} cy={50} r={46} strokeWidth={6.3} />
</Glyph>;

export const PayGlyph = (p: Props) => <Glyph {...p}>
  <rect x={8} y={22} width={84} height={58} rx={11} />{L(8, 42, 92, 42)}{L(22, 63, 44, 63)}
</Glyph>;

export const GearGlyph = ({ badge, ...p }: Props & { badge?: boolean }) => <Glyph {...p} w={9.5}>
  {Array.from({ length: 8 }, (_, i) => {
    const a = i * Math.PI / 4, dx = Math.cos(a), dy = Math.sin(a);
    return <line key={i} x1={50 + dx * 28} y1={50 + dy * 28} x2={50 + dx * 40} y2={50 + dy * 40} />;
  })}
  <circle cx={50} cy={50} r={27} strokeWidth={10} /><circle cx={50} cy={50} r={11.5} strokeWidth={8.5} />
  {badge && <><circle cx={92} cy={8} r={26} fill="var(--bg)" stroke="none" /><circle cx={92} cy={8} r={17} fill="var(--accent)" stroke="none" /></>}
</Glyph>;

// ---- everyday marks --------------------------------------------------------------------------

// Points back: mirrored right to left with the page.
export const BackGlyph = (p: Props) => <Glyph {...p} w={11} flip>{L(66, 16, 30, 50)}{L(30, 50, 66, 84)}</Glyph>;
export const ChevronGlyph = ({ open, ...p }: Props & { open?: boolean }) =>
  <Glyph {...p} w={11} className={"chevron" + (open ? " open" : "")}>{L(36, 18, 68, 50)}{L(68, 50, 36, 82)}</Glyph>;

export const ShareGlyph = (p: Props) => <Glyph {...p}>
  {L(26, 50, 72, 20)}{L(26, 50, 72, 80)}
  <g fill="currentColor" stroke="none"><circle cx={72} cy={20} r={13} /><circle cx={26} cy={50} r={13} /><circle cx={72} cy={80} r={13} /></g>
</Glyph>;

export const SwapGlyph = (p: Props) => <Glyph {...p}>
  {L(32, 84, 32, 16)}{L(16, 32, 32, 16)}{L(32, 16, 48, 32)}
  {L(68, 16, 68, 84)}{L(52, 68, 68, 84)}{L(68, 84, 84, 68)}
</Glyph>;

export const ClockGlyph = (p: Props) => <Glyph {...p}><circle cx={50} cy={50} r={38} />{L(50, 50, 50, 28)}{L(50, 50, 66, 58)}</Glyph>;

export const WalkGlyph = (p: Props) => <Glyph {...p} w={11}>
  <circle cx={52} cy={14} r={12} fill="currentColor" stroke="none" />
  {L(52, 28, 48, 56)}{L(48, 56, 34, 88)}{L(48, 56, 66, 84)}{L(52, 36, 72, 46)}
</Glyph>;

export const BikeGlyph = (p: Props) => <Glyph {...p} w={8}>
  <circle cx={24} cy={66} r={17} /><circle cx={76} cy={66} r={17} />
  {L(24, 66, 42, 36)}{L(42, 36, 66, 36)}{L(66, 36, 76, 66)}{L(42, 36, 52, 66)}{L(52, 66, 66, 36)}{L(38, 26, 50, 26)}{L(62, 26, 70, 26)}
</Glyph>;

export const TaxiGlyph = (p: Props) => <Glyph {...p} w={11}>
  {L(8, 74, 92, 74)}{L(8, 54, 8, 74)}{L(92, 54, 92, 74)}{L(8, 54, 26, 54)}{L(26, 54, 34, 34)}{L(34, 34, 68, 34)}
  {L(68, 34, 78, 54)}{L(78, 54, 92, 54)}{L(40, 34, 40, 22)}{L(62, 34, 62, 22)}{L(40, 22, 62, 22)}
  <g fill="currentColor" stroke="none"><circle cx={28} cy={80} r={7} /><circle cx={72} cy={80} r={7} /></g>
</Glyph>;

export const StarGlyph = ({ filled, ...p }: Props & { filled?: boolean }) => <Glyph {...p} w={7}>
  <polygon points="50,9 61.8,35.6 90.4,38.4 69,57.6 75.2,85.6 50,71 24.8,85.6 31,57.6 9.6,38.4 38.2,35.6" fill={filled ? "currentColor" : "none"} />
</Glyph>;

export const RecentGlyph = (p: Props) => <Glyph {...p}>
  <path d="M18 50a32 32 0 1 0 9.4-22.6" />{L(16, 16, 27.4, 27.4)}{L(27.4, 27.4, 14, 34)}{L(50, 32, 50, 52)}{L(50, 52, 62, 60)}
</Glyph>;

export const PinGlyph = (p: Props) => <Glyph {...p}>
  <path d="M50 90C50 90 20 60 20 38a30 30 0 0 1 60 0c0 22-30 52-30 52z" /><circle cx={50} cy={38} r={10} />
</Glyph>;

export const LocateGlyph = (p: Props) => <Glyph {...p}>
  <circle cx={50} cy={50} r={28} /><circle cx={50} cy={50} r={9} fill="currentColor" stroke="none" />
  {L(50, 6, 50, 20)}{L(50, 80, 50, 94)}{L(6, 50, 20, 50)}{L(80, 50, 94, 50)}
</Glyph>;

export const SearchGlyph = (p: Props) => <Glyph {...p} w={10}><circle cx={40} cy={40} r={29} />{L(63, 63, 88, 88)}</Glyph>;
export const CloseGlyph = (p: Props) => <Glyph {...p} w={10}>{L(22, 22, 78, 78)}{L(78, 22, 22, 78)}</Glyph>;
export const PlayGlyph = (p: Props) => <Glyph {...p} w={8}><path d="M28 16v68l58-34z" fill="currentColor" /></Glyph>;
export const MinusGlyph = (p: Props) => <Glyph {...p} w={10}>{L(22, 50, 78, 50)}</Glyph>;
export const PlusGlyph = (p: Props) => <Glyph {...p} w={10}>{L(22, 50, 78, 50)}{L(50, 22, 50, 78)}</Glyph>;

export const QrGlyph = (p: Props) => <Glyph {...p} w={8}>
  <rect x={10} y={10} width={30} height={30} rx={5} /><rect x={60} y={10} width={30} height={30} rx={5} /><rect x={10} y={60} width={30} height={30} rx={5} />
  <g fill="currentColor" stroke="none"><rect x={20} y={20} width={10} height={10} /><rect x={70} y={20} width={10} height={10} /><rect x={20} y={70} width={10} height={10} />
    <rect x={60} y={60} width={12} height={12} /><rect x={78} y={78} width={12} height={12} /><rect x={78} y={60} width={12} height={8} /><rect x={60} y={80} width={10} height={10} /></g>
</Glyph>;

export const DotGlyph = (p: Props) => <Glyph {...p}><circle cx={50} cy={50} r={12} fill="currentColor" stroke="none" /></Glyph>;

// ---- modes: the same drawings as the Android app's map and badges ----------------------------

export type Mode = "tram" | "subway" | "train" | "bus" | "ferry" | "cable" | "gondola" | "funicular" | "taxi" | "other";

export function modeOf(type: number): Mode {
  switch (type) {
    case 0: case 12: return "tram";
    case 1: return "subway";
    case 2: return "train";
    case 3: case 11: case 711: return "bus";
    case 4: return "ferry";
    case 5: return "cable";
    case 6: return "gondola";
    case 7: return "funicular";
    case 8: case 715: return "taxi";
    default: return "other";
  }
}

const MODE_PATHS: Partial<Record<Mode, string[]>> = {
  tram: [
    "M15 0h-4C9.528 0 8.238 0.808 7.544 2H8.77C9.32 1.388 10.115 1 11 1h4c0.885 0 1.68 0.388 2.23 1h1.226C17.762 0.808 16.472 0 15 0z",
    "M14.5 0.5h1l-2 3.5h-1z",
    "M11.5 0.5h-1l2 3.5h1zM17 4H9C6.791 4 5 5.791 5 8v9c0 2.209 3.582 4 8 4s8-1.791 8-4V8c0-2.209-1.791-4-4-4zM8 17c-0.552 0-1-0.448-1-1s0.448-1 1-1 1 0.448 1 1-0.448 1-1 1zm10 0c-0.552 0-1-0.448-1-1s0.448-1 1-1 1 0.448 1 1-0.448 1-1 1zm1-5s0 2-6 2-6-2-6-2V8c0-1.105 0.895-2 2-2h8c1.105 0 2 0.895 2 2v4zM8.349 21.646L6.004 26h1.704l2.113-3.926zm7.83 0.428L18.292 26h1.704l-2.345-4.354z",
  ],
  subway: [
    "M13 4c-4.971 0-9 3.358-9 7.5v5C4 18.847 5.612 21 7.6 21h10.8c1.988 0 3.6-2.153 3.6-4.5v-5C22 7.358 17.971 4 13 4zM7.5 19c-0.552 0-1-0.448-1-1s0.448-1 1-1 1 0.448 1 1-0.448 1-1 1zm11 0c-0.552 0-1-0.448-1-1s0.448-1 1-1 1 0.448 1 1-0.448 1-1 1zm1.5-4H6v-3.5C6 8.467 9.14 6 13 6s7 2.467 7 5.5V15zm-3 7l0.536 1H8.464L9 22H7.144L5 26h16l-2.144-4H17zm-9.608 3l0.536-1h10.144l0.536 1H7.392z",
    "M23.5 20.5c1.431-2.089 2.5-4.777 2.5-7.5 0-7.18-5.82-13-13-13S0 5.820 0 13c0 2.723 1.069 5.411 2.5 7.5V17C2.046 15.796 2 14.361 2 13 2 6.935 6.935 2 13 2s11 4.935 11 11c0 1.361-0.046 2.296-0.5 3.5v4z",
  ],
  train: [
    "M21 7.177C21 4.623 19.142 3.6 16.569 3.6H16.2V2.8c0-0.442-0.358-0.8-0.8-0.8h-4.8c-0.442 0-0.8 0.358-0.8 0.8v0.8H9.308C6.735 3.6 5 4.623 5 7.177V16.4l1.412 1.592-0.731 0.829c-0.333 0-0.434 0.619-0.132 0.779 0 0 7.367 1.644 7.451 1.6l7.327-1.615c0.302-0.16 0.202-0.767-0.132-0.767L19.4 17.92 21 16.4V7.177zM9.4 18.4c-0.663 0-1.2-0.537-1.2-1.2 0-0.663 0.537-1.2 1.2-1.2 0.663 0 1.2 0.537 1.2 1.2 0 0.663-0.537 1.2-1.2 1.2zm7.2 0c-0.663 0-1.2-0.537-1.2-1.2 0-0.663 0.537-1.2 1.2-1.2 0.663 0 1.2 0.537 1.2 1.2 0 0.663-0.537 1.2-1.2 1.2zm2.4-5.765c0 0.71-2.431 1.714-6 1.714s-6-1.004-6-1.714V7.597C7 6.651 7.48 5.5 8.5 5.5h9c0.995 0 1.5 1.151 1.5 2.097v5.038zM7.5 25h11v1h-11zm0-2h11v1h-11z",
    "M8.349 21.646L6.004 26h1.704l2.113-3.926zm7.83 0.428L18.292 26h1.704l-2.345-4.354z",
  ],
  bus: [
    "M22.5 7V6c0-2.303-0.638-4-2.952-4H6.714C4.4 2 3.5 3.697 3.5 6v1H2v4h1.5l0.071 11.429C3.571 23.296 4.275 24 5.143 24H7c0.868 0 1.5-0.632 1.5-1.5V21h9v1.5c0 0.868 0.632 1.5 1.5 1.5h1.857c0.868 0 1.571-0.704 1.571-1.571L22.5 11H24V7h-1.5zM6.714 19.278c-0.864 0-1.571-0.704-1.571-1.564 0-0.86 0.707-1.564 1.571-1.564s1.571 0.704 1.571 1.564c0.001 0.86-0.706 1.564-1.571 1.564zM13 15c-3.866 0-7.5-1.605-7.5-2.381V5.968C5.5 4.934 5.895 4 7 4h12.25c1.105 0 1.25 0.934 1.25 1.968v6.651C20.5 13.395 16.866 15 13 15zm7.857 2.714c0 0.86-0.707 1.564-1.571 1.564s-1.571-0.704-1.571-1.564c0-0.86 0.707-1.564 1.571-1.564s1.571 0.704 1.571 1.564z",
  ],
  ferry: [
    "M22.257 10.03C21.812 8.249 20.212 7 18.377 7H15.5V4.5C15.5 4.224 15.276 4 15 4s-0.5 0.224-0.5 0.5V7H11V4.5C11 4.224 10.776 4 10.5 4S10 4.224 10 4.5V7H7.623c-1.835 0-3.435 1.249-3.881 3.03L2.5 13h21l-1.243-2.97zM8.5 11H5.438S6.522 9 7.44 9H8.5v2zm4 0h-3V9h3v2zm4 0h-3V9h3v2zm1 0V9h1.060c0.918 0 2.002 2 2.002 2H17.5zm-8.834 8.5c2.11 0 3.135-0.237 4.221-0.487 1.093-0.252 2.222-0.513 4.446-0.513 2.224 0 3.354 0.261 4.446 0.513 0.433 0.1 0.86 0.197 1.347 0.278L26 14H1l-1 4.5c2.223 0 3.353 0.261 4.446 0.513 1.085 0.25 2.11 0.487 4.220 0.487zm14.459 1.291c-0.487-0.081-0.913-0.178-1.347-0.278C20.687 20.261 19.557 20 17.333 20s-3.353 0.261-4.446 0.513C11.801 20.763 10.776 21 8.666 21c-2.109 0-3.135-0.237-4.22-0.487C3.353 20.261 2.223 20 0 20v1c2.11 0 3.135 0.237 4.22 0.487C5.313 21.739 6.442 22 8.666 22c2.224 0 3.354-0.261 4.446-0.513C14.198 21.237 15.223 21 17.333 21s3.135 0.237 4.221 0.487C22.646 21.739 22.776 22 25 22v-1c-1.268 0-1.141-0.086-1.875-0.209z",
  ],
  cable: [
    "M5 26h1.856L9 22H7.144zm12-4l2.144 4H21l-2.144-4zM4.5 20h17v1h-17zM23 10v8h-1V5c0.552 0 1-0.448 1-1s-0.448-1-1-1h-4.5V2H18c0-1.105-2.239-2-5-2S8 0.895 8 2h0.5v1H4C3.448 3 3 3.448 3 4s0.448 1 1 1v13H3v-8H2v9h22v-9h-1zm-3-5v6h-4V5h4zm-6.035 10.25C13.853 15.681 13.465 16 13 16c-0.465 0-0.853-0.319-0.965-0.75C12.015 15.17 12 15.087 12 15c0-0.552 0.448-1 1-1s1 0.448 1 1c0 0.087-0.015 0.17-0.035 0.25zM11 11V5h4v6h-4zm-1-6v6H6V5h4z",
  ],
  gondola: [
    "M12.5 2.5h1V7h-1z",
    "M12.5 2.5h1v6h-1z",
    "M12.5 7.5h1l-2 2.5h-1z",
    "M13.5 7.5h-1l2 2.5h1zM22 1.01L4 5V3.99L22 0zM18 10H8c-2.2 0-5 2.287-5 4.471v5.967C3 22.352 4.484 24.094 6.619 25c0.932 0.458 1.294 1 3.381 1h6c2.087 0 2.449-0.542 3.381-1C21.516 24.094 23 22.352 23 20.438v-5.967C23 12.287 20.2 10 18 10zm3 4.471V18h-4v-6h1c1.215 0 3 1.513 3 2.471zM16 12v6h-6v-6h6zM5 14.471C5 13.513 6.785 12 8 12h1v6H5v-3.529z",
  ],
  funicular: [
    "M23 6.799C23 4.673 21.159 3 18.889 3H7.111C4.841 3 3 4.673 3 6.799v12.849L23 15.7V6.799zM21 13H5V7.121C5 6.044 5.947 5 7.111 5h11.778C20.053 5 21 6.044 21 7.121V13z",
    "M9 4.958h1V5H9zM9 5h1v8H9zm7-0.042h1V5h-1zM16 5h1v8h-1zm8 12.021l-22 4.5v1.958l22-4.5z",
  ],
};

export function ModeGlyph({ type, size = 13, style, className }: { type: number; size?: number; style?: CSSProperties; className?: string }) {
  const mode = modeOf(type);
  const paths = MODE_PATHS[mode];
  if (mode === "taxi") return <TaxiGlyph size={size} style={style} className={className} />;
  if (!paths) return <Glyph size={size} style={style} className={className} w={11}><circle cx={50} cy={50} r={30} /></Glyph>;
  return (
    <svg viewBox="0 0 26 26" width={size} height={size} className={"glyph" + (className ? " " + className : "")} style={style} fill="currentColor" aria-hidden="true">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

// The mark a stop wears in lists: a light plate (round for the metro) with the mode cut out of it.
export function StationMark({ type, size = 18 }: { type: number; size?: number }) {
  const subway = modeOf(type) === "subway";
  return (
    <span className="station-mark" style={{ width: size, height: size, borderRadius: subway ? "50%" : size * .22 }}>
      <ModeGlyph type={type} size={Math.round(size * .68)} />
    </span>
  );
}
