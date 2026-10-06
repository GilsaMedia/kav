// Thrift binary protocol, as Moovit's app speaks it. Mirrors android/.../data/Thrift.kt.
// Plain Uint8Array and DataView, so it runs in Node and in the iOS app alike.

export const TType = {
  STOP: 0, BOOL: 2, BYTE: 3, DOUBLE: 4, I16: 6, I32: 8, I64: 10,
  STRING: 11, STRUCT: 12, MAP: 13, SET: 14, LIST: 15,
} as const;

// Thrift structs decode to field-id keyed maps.
export type TStruct = Map<number, any>;

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

export class TWriter {
  private buf = new Uint8Array(256);
  private n = 0;

  private room(k: number) {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const next = new Uint8Array(size); next.set(this.buf.subarray(0, this.n)); this.buf = next;
  }
  bytes(): Uint8Array { return this.buf.slice(0, this.n); }

  byte(v: number): this { this.room(1); this.buf[this.n++] = v & 0xff; return this; }
  i16(v: number): this { this.byte(v >>> 8); this.byte(v); return this; }
  i32(v: number): this { for (const s of [24, 16, 8, 0]) this.byte(v >>> s); return this; }
  i64(v: number | bigint | string): this {
    this.room(8); new DataView(this.buf.buffer).setBigInt64(this.n, BigInt(v)); this.n += 8; return this;
  }
  dbl(v: number): this { this.room(8); new DataView(this.buf.buffer).setFloat64(this.n, v); this.n += 8; return this; }
  raw(b: Uint8Array): this { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; return this; }
  str(s: string): this { const r = utf8.encode(s); this.i32(r.length); return this.raw(r); }

  field(type: number, id: number): this { return this.byte(type).i16(id); }
  stop(): this { return this.byte(TType.STOP); }

  i16Field(id: number, v: number) { return this.field(TType.I16, id).i16(v); }
  i32Field(id: number, v: number) { return this.field(TType.I32, id).i32(v); }
  i64Field(id: number, v: number | bigint) { return this.field(TType.I64, id).i64(v); }
  dblField(id: number, v: number) { return this.field(TType.DOUBLE, id).dbl(v); }
  boolField(id: number, v: boolean) { return this.field(TType.BOOL, id).byte(v ? 1 : 0); }
  strField(id: number, v: string) { return this.field(TType.STRING, id).str(v); }
  structField(id: number, inner: TWriter) { this.field(TType.STRUCT, id).raw(inner.bytes()); return this.stop(); }
  i32ListField(id: number, vs: number[]) {
    this.field(TType.LIST, id).byte(TType.I32).i32(vs.length);
    for (const v of vs) this.i32(v);
    return this;
  }
  listField<T>(id: number, elemType: number, items: T[], w: (w: TWriter, t: T) => void) {
    this.field(TType.LIST, id).byte(elemType).i32(items.length);
    for (const it of items) w(this, it);
    return this;
  }
}

export class TReader {
  private p = 0;
  private d: Uint8Array;
  private v: DataView;
  constructor(d: Uint8Array) { this.d = d; this.v = new DataView(d.buffer, d.byteOffset, d.byteLength); }

  hasMore() { return this.p < this.d.length; }
  byte() { return this.d[this.p++]; }
  i16() { const v = this.v.getInt16(this.p); this.p += 2; return v; }
  i32() { const v = this.v.getInt32(this.p); this.p += 4; return v; }
  // A number when it fits; trip ids past 2^53 stay exact as strings.
  i64(): number | string {
    const v = this.v.getBigInt64(this.p); this.p += 8;
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : v.toString();
  }
  dbl() { const v = this.v.getFloat64(this.p); this.p += 8; return v; }
  str() { const n = this.i32(); const s = fromUtf8.decode(this.d.subarray(this.p, this.p + n)); this.p += n; return s; }

  readStruct(): TStruct {
    const out: TStruct = new Map();
    for (;;) {
      const t = this.byte();
      if (t === TType.STOP || t === undefined) return out;
      const id = this.i16();
      out.set(id, this.readValue(t));
    }
  }

  private readValue(t: number): any {
    switch (t) {
      case TType.BOOL: return this.byte() !== 0;
      case TType.BYTE: return this.byte();
      case TType.DOUBLE: return this.dbl();
      case TType.I16: return this.i16();
      case TType.I32: return this.i32();
      case TType.I64: return this.i64();
      case TType.STRING: return this.str();
      case TType.STRUCT: return this.readStruct();
      case TType.LIST: case TType.SET: {
        const et = this.byte(); const n = this.i32();
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = this.readValue(et);
        return out;
      }
      case TType.MAP: {
        const kt = this.byte(); const vt = this.byte(); const n = this.i32();
        const m = new Map();
        for (let i = 0; i < n; i++) m.set(this.readValue(kt), this.readValue(vt));
        return m;
      }
      default: throw new Error(`bad thrift type ${t} at ${this.p}`);
    }
  }
}

// Moovit's tagged-JSON form of Thrift ({"1":{"str":"x"}}), written back as binary. Mirrors ThriftJson.kt.
function typeOf(tag: string): number {
  switch (tag) {
    case "tf": return TType.BOOL; case "i8": case "byte": return TType.BYTE; case "i16": return TType.I16;
    case "i32": return TType.I32; case "i64": return TType.I64; case "dbl": return TType.DOUBLE;
    case "str": return TType.STRING; case "rec": return TType.STRUCT; case "lst": return TType.LIST;
    case "set": return TType.SET; case "map": return TType.MAP;
  }
  throw new Error(`Unknown Thrift type: ${tag}`);
}

export function thriftFields(o: any, w: TWriter = new TWriter()): TWriter {
  for (const key of Object.keys(o)) {
    const wrapped = o[key];
    const tag = Object.keys(wrapped)[0];
    w.field(typeOf(tag), Number(key));
    jsonValue(w, tag, wrapped[tag]);
  }
  return w;
}

function jsonValue(w: TWriter, tag: string, value: any) {
  switch (tag) {
    case "tf": case "i8": case "byte": w.byte(Number(value)); break;
    case "i16": w.i16(Number(value)); break;
    case "i32": w.i32(Number(value)); break;
    case "i64": w.i64(BigInt(value)); break;
    case "dbl": w.dbl(Number(value)); break;
    case "str": w.str(String(value)); break;
    case "rec": thriftFields(value, w); w.stop(); break;
    case "lst": case "set": {
      const [element, count, ...items] = value as any[];
      w.byte(typeOf(element)).i32(count);
      for (const it of items) jsonValue(w, element, it);
      break;
    }
    case "map": {
      const [k, v, , values] = value as any[];
      const keys = Object.keys(values);
      w.byte(typeOf(k)).byte(typeOf(v)).i32(keys.length);
      for (const key of keys) { jsonValue(w, k, key); jsonValue(w, v, values[key]); }
      break;
    }
    default: throw new Error(`Unknown Thrift type: ${tag}`);
  }
}
