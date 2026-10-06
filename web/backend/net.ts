// The national timetable bundle (tools/export_web_bundle.py). Mirrors android/.../data/Net.kt,
// Search.kt and Board.kt.
import { gunzipSync } from "fflate";

export function metres(la1: number, lo1: number, la2: number, lo2: number): number {
  const r = 6_371_000, toR = Math.PI / 180;
  const dLa = (la2 - la1) * toR, dLo = (lo2 - lo1) * toR;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * toR) * Math.cos(la2 * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function searchWords(s: string): string[] {
  return s.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, " ").split(" ").filter(Boolean);
}
const spaced = (s: string) => " " + searchWords(s).join(" ") + " ";

export class Net {
  name: string[] = []; lat!: Float64Array; lon!: Float64Array; code!: Int32Array; cityOf!: Int32Array; city: string[] = [];
  rShort: string[] = []; rLong: string[] = []; rType!: Int32Array; rAgency!: Int32Array; agency: string[] = [];
  tripRoute!: Int32Array; tripStart!: Int32Array; tripDays!: Int32Array; stStop!: Int32Array; stDep!: Int32Array;
  cST!: Int32Array; dStart!: Int32Array; dConn!: Int32Array;
  hay: string[] = []; words: string[] = []; stopType!: Int32Array;
  routeStops = new Map<number, Set<number>>();

  get nStops() { return this.lat.length; }
  cityName(s: number) { return this.city[this.cityOf[s]] ?? ""; }
  agencyOf(r: number) { return this.agency[this.rAgency[r]] ?? ""; }
  tripLast(t: number) { return this.stStop[this.tripStart[t + 1] - 1]; }
  runsOn(t: number, day: number) { return (this.tripDays[t] & (1 << day)) !== 0; }
  tripOf(st: number) {
    let lo = 0, hi = this.tripRoute.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (this.tripStart[mid] <= st) lo = mid; else hi = mid - 1; }
    return lo;
  }

  // Parsing takes a few seconds on a phone, so it gives way to the screen now and then.
  static async fromBytes(raw: Uint8Array): Promise<Net> {
    const b = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    const n = new Net(); await n.parse(b); return n;
  }

  private async parse(b: Uint8Array) {
    const pause = () => new Promise(r => setTimeout(r, 0));
    const utf8 = new TextDecoder();
    let p = 0;
    const vi = () => {
      let sh = 0, r = 0, x: number;
      do { x = b[p++]; r += (x & 0x7f) * 2 ** sh; sh += 7; } while (x & 0x80);
      return r % 2 === 1 ? -(r + 1) / 2 : r / 2;
    };
    const vs = () => { const n = vi(); const s = utf8.decode(b.subarray(p, p + n)); p += n; return s; };
    const magic = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (magic !== "KAV5") throw new Error(`bad bundle: ${magic}`);
    p = 4;
    const nS = vi(), nR = vi(), nT = vi(), nC = vi(), nST = vi();
    this.agency = Array.from({ length: vi() }, vs);
    this.city = Array.from({ length: nC }, vs);
    this.lat = new Float64Array(nS); this.lon = new Float64Array(nS); this.code = new Int32Array(nS); this.cityOf = new Int32Array(nS);
    let la = 0, lo = 0;
    for (let i = 0; i < nS; i++) {
      la += vi(); lo += vi();
      this.lat[i] = la / 1e5; this.lon[i] = lo / 1e5;
      this.code[i] = vi(); this.cityOf[i] = vi(); this.name.push(vs());
    }
    this.rType = new Int32Array(nR); this.rAgency = new Int32Array(nR);
    for (let i = 0; i < nR; i++) { this.rShort.push(vs()); this.rLong.push(vs()); this.rType[i] = vi(); this.rAgency[i] = vi(); }
    this.tripRoute = new Int32Array(nT); this.tripStart = new Int32Array(nT + 1); this.tripDays = new Int32Array(nT);
    this.stStop = new Int32Array(nST); this.stDep = new Int32Array(nST);
    let k = 0;
    for (let t = 0; t < nT; t++) {
      if (t % 20000 === 0) await pause();
      this.tripRoute[t] = vi(); this.tripDays[t] = vi();
      const n = vi();
      let pt = vi(), ps = 0;
      this.tripStart[t] = k;
      for (let j = 0; j < n; j++) {
        const d = pt + vi() + vi(); const s = ps + vi();
        this.stDep[k] = d; this.stStop[k] = s; k++; pt = d; ps = s;
      }
    }
    this.tripStart[nT] = k;
    await pause();
    for (let i = 0; i < nS; i++) {
      this.hay.push((this.name[i] + " " + this.cityName(i)).toLowerCase());
      this.words.push(spaced(this.code[i] > 0 ? `${this.name[i]} ${this.code[i]}` : this.name[i]));
    }
    this.stopType = new Int32Array(nS).fill(-1);
    for (let t = 0; t < nT; t++) {
      const type = this.rType[this.tripRoute[t]];
      for (let i = this.tripStart[t]; i < this.tripStart[t + 1]; i++) {
        const s = this.stStop[i];
        if (this.stopType[s] < 0 || type < this.stopType[s]) this.stopType[s] = type;
      }
    }
    await pause();
    this.buildConnections();
  }

  private buildConnections() {
    const nT = this.tripRoute.length;
    let m = 0, maxT = 0;
    for (let t = 0; t < nT; t++) {
      const a = this.tripStart[t], z = this.tripStart[t + 1] - 1;
      if (z > a) m += z - a;
      for (let i = a; i < z; i++) if (this.stDep[i] > maxT) maxT = this.stDep[i];
    }
    const span = maxT + 2;
    const cnt = new Int32Array(span + 2);
    for (let t = 0; t < nT; t++) for (let i = this.tripStart[t]; i < this.tripStart[t + 1] - 1; i++) cnt[this.stDep[i] + 1]++;
    for (let i = 0; i <= span; i++) cnt[i + 1] += cnt[i];
    this.cST = new Int32Array(m);
    for (let t = 0; t < nT; t++) for (let i = this.tripStart[t]; i < this.tripStart[t + 1] - 1; i++) this.cST[cnt[this.stDep[i]]++] = i;
    const nS = this.lat.length;
    this.dStart = new Int32Array(nS + 1);
    const deg = new Int32Array(nS);
    for (let i = 0; i < m; i++) deg[this.stStop[this.cST[i]]]++;
    for (let s = 0; s < nS; s++) this.dStart[s + 1] = this.dStart[s] + deg[s];
    const fill = this.dStart.slice(0, nS);
    this.dConn = new Int32Array(m);
    for (let i = 0; i < m; i++) this.dConn[fill[this.stStop[this.cST[i]]]++] = i;
  }

  // Like Moovit's own stop search: every typed word has to start a word of the name, code or city.
  searchStops(q: string, at: [number, number] | null, limit = 40): number[] {
    const need = searchWords(q).map(w => " " + w);
    if (!need.length) return [];
    const hits: number[] = [];
    const codes = new Set<number>();
    for (let i = 0; i < this.words.length; i++) {
      const w = this.words[i] + spaced(this.cityName(i)).slice(1);
      if (need.every(t => w.includes(t)) && (this.code[i] <= 0 || !codes.has(this.code[i]))) { codes.add(this.code[i]); hits.push(i); }
    }
    if (!at) return hits.sort((a, b) => this.name[a].localeCompare(this.name[b])).slice(0, limit);
    const sq = (i: number) => (at[0] - this.lat[i]) ** 2 + (at[1] - this.lon[i]) ** 2;
    return hits.sort((a, b) => sq(a) - sq(b)).slice(0, limit);
  }

  nearestStops(la: number, lo: number, k = 24, radius = 2500): [number, number][] {
    const out: [number, number][] = [];
    const dLat = radius / 111_000 + 0.001, dLon = radius / 93_000 + 0.001;
    for (let i = 0; i < this.lat.length; i++) {
      if (Math.abs(this.lat[i] - la) > dLat || Math.abs(this.lon[i] - lo) > dLon) continue;
      const d = metres(la, lo, this.lat[i], this.lon[i]);
      if (d < radius) out.push([i, d]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, k);
  }

  // Trips past midnight are written as 24:00 and later; tomorrow's follow today's.
  departuresAt(stop: number, now: number, today: number, limit = 60): [number, number][] {
    const yesterday = (today + 6) % 7, tomorrow = (today + 1) % 7;
    const out: [number, number][] = [];
    for (let i = this.dStart[stop]; i < this.dStart[stop + 1]; i++) {
      const c = this.dConn[i], st = this.cST[c], dep = this.stDep[st], t = this.tripOf(st);
      if (dep >= now && this.runsOn(t, today)) out.push([c, dep]);
      if (dep - 86_400 >= now && this.runsOn(t, yesterday)) out.push([c, dep - 86_400]);
      if (dep < 86_400 && this.runsOn(t, tomorrow)) out.push([c, dep + 86_400]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, limit);
  }

  // The line numbers that call at a stop.
  routesAt(stop: number): Set<string> {
    const out = new Set<string>();
    for (let i = this.dStart[stop]; i < this.dStart[stop + 1]; i++) out.add(this.rShort[this.tripRoute[this.tripOf(this.cST[this.dConn[i]])]]);
    return out;
  }

  // The town around a point: the nearest stops' locality, as the average of its stops.
  private centres: ([number, number] | null)[] | null = null;
  cityAround(la: number, lo: number): { name: string; lat: number; lon: number } | null {
    if (!this.centres) {
      const sLa = new Float64Array(this.city.length), sLo = new Float64Array(this.city.length), n = new Int32Array(this.city.length);
      for (let s = 0; s < this.nStops; s++) { const c = this.cityOf[s]; if (!this.city[c]) continue; sLa[c] += this.lat[s]; sLo[c] += this.lon[s]; n[c]++; }
      this.centres = this.city.map((_, c) => n[c] ? [sLa[c] / n[c], sLo[c] / n[c]] : null);
    }
    const own = this.nearestStops(la, lo, 8).find(([s]) => this.cityName(s))?.[0];
    const c = own != null ? this.cityOf[own] : -1;
    const centre = this.centres[c];
    return centre ? { name: this.city[c], lat: centre[0], lon: centre[1] } : null;
  }

  // The station of a mode (GTFS route type) nearest a point, within 1.5 km.
  nearestOfType(la: number, lo: number, type: number): number | null {
    let best = -1, bestM = 1500;
    for (let i = 0; i < this.nStops; i++) {
      if (this.stopType[i] !== type) continue;
      const d = metres(la, lo, this.lat[i], this.lon[i]);
      if (d < bestM) { bestM = d; best = i; }
    }
    return best < 0 ? null : best;
  }
}
