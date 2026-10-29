// Each bus operator's own colour, on its lines' plates. The idea and the colours are Sammy Zaionz's (szaionz), from
// the Android app. An operator is known by its name as Moovit or the ministry's timetable writes it: Moovit names it
// the same with the English in brackets, "דן (Dan)". Operators without a colour here keep Kav's own plate.
const ALL: [string, string | null, string][] = [
  ["אגד", "Egged", "#018369"],
  ["אלקטרה אפיקים תחבורה", "Electra Afikim Tachbura", "#B2C44A"],
  ["דן", "Dan", "#0E2A5A"],
  ["גי.בי.טורס", "GB-Tours", "#A42A2A"],
  ["מועצה אזורית אילות", null, "#000000"],
  ["נתיב אקספרס", "Nateev Express", "#E17C30"],
  ["מטרופולין", "Metropoline", "#F79A34"],
  ["סופרבוס", "Superbus", "#003E7E"],
  ["קווים", "Kavim", "#8CBCD8"],
  ["גלים", "Galeem", "#4491CB"],
  ["מועצה אזורית גולן", "Golan", "#6EB742"],
  ["אלקטרה אפיקים", "Electra Afikim", "#7FB90D"],
  ["דן בדרום", "Dan Badarom", "#1C3786"],
  ["דן באר שבע", "Dan Beer-Sheva", "#2F4C9B"],
  ["תנופה", "Tnufa", "#45AA9E"],
  ["בית שמש אקספרס", "Beit Shemesh Express", "#F08B1F"],
  ["אקסטרה", "Extra", "#46C0E6"],
  ["אקסטרה ירושלים", null, "#46C0E6"],
  ["דן נתיבים בעמ", null, "#000000"],
  ["ירושלים-רמאללה איחוד", null, "#008F51"],
  ["ירושלים-אבו-תור-ענאתא איחוד", null, "#31316E"],
  ["ירושלים-אלווסט איחוד", null, "#31316E"],
  ["ירושלים - עיסאוויה מחנה שעפאט איחוד", null, "#008F51"],
  ["ירושלים-דרום איחוד", null, "#31316E"],
  ["ירושלים-צור באהר איחוד", null, "#31316E"],
  ["דרך אגד עוטף ירושלים", null, "#0A66AC"],
];
const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const byName = new Map<string, string>();
for (const [he, en, c] of ALL) { byName.set(flat(he), c); if (en) byName.set(flat(en), c); }

// By name: the Hebrew before any brackets, else the English in them.
export function operatorColour(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const hebrew = flat(name.split("(")[0]);
  const english = flat(name.includes("(") ? name.split("(")[1].split(")")[0] : "");
  return byName.get(hebrew) ?? (english ? byName.get(english) ?? null : null);
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const hex = (c: Rgb) => "#" + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t) as Rgb;
function luminance(c: Rgb) {
  const lin = (x: number) => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]);
}
const contrast = (a: Rgb, b: Rgb) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const WHITE: Rgb = [1, 1, 1], BLACK: Rgb = [0, 0, 0], DARK_INK: Rgb = rgb("#16160F");

// The colour as Kav draws it on its own background: dark ones lifted in the dark looks and pale ones deepened in the
// light one, so Dan's navy still shows on black and Kavim's sky blue on white.
export function onScreen(colour: string, light: boolean): string {
  const c = rgb(colour), towards = light ? BLACK : WHITE;
  let out = c;
  for (let t = 0; t < .7 && (light ? luminance(out) > .4 : luminance(out) < .1); ) { t += .05; out = mix(c, towards, t); }
  return hex(out);
}

// A plate in the operator's colour, with ink that reads on it: [fill, edge, ink]. Operators without a hue (black,
// grey) keep Kav's plain plate.
export function operatorPlate(colour: string | null, light: boolean): [string, string, string] | null {
  if (!colour) return null;
  const c = rgb(colour);
  if (Math.max(...c) - Math.min(...c) <= .15) return null;
  const shown = rgb(onScreen(colour, light));
  let fill = shown;
  for (let t = 0; Math.max(contrast(WHITE, fill), contrast(DARK_INK, fill)) < 4.5 && t < .3; ) { t += .02; fill = mix(shown, BLACK, t); }
  const white = contrast(WHITE, fill);
  const ink = white >= 4.5 || white >= contrast(DARK_INK, fill) ? WHITE : DARK_INK;
  return [hex(fill), hex(mix(fill, BLACK, .2)), hex(ink)];
}
