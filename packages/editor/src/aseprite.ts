// Read Aseprite files (.aseprite / .ase): image layers, frames with their durations, and tags.
// Groups are flattened (their visibility still applies), cel opacity is baked into the pixels,
// blend modes other than normal are drawn as normal. Format: aseprite.org/docs/ase-file-specs

import type { Layer, Tag } from "./sprite.ts";

export interface AseSprite {
  w: number;
  h: number;
  layers: Layer[];
  durations: number[];
  tags: Tag[];
}

class Reader {
  o = 0;
  constructor(private v: DataView) {}
  u8() { return this.v.getUint8(this.o++); }
  u16() { const n = this.v.getUint16(this.o, true); this.o += 2; return n; }
  i16() { const n = this.v.getInt16(this.o, true); this.o += 2; return n; }
  u32() { const n = this.v.getUint32(this.o, true); this.o += 4; return n; }
  skip(n: number) { this.o += n; }
  str() {
    const n = this.u16();
    const s = new TextDecoder().decode(new Uint8Array(this.v.buffer, this.v.byteOffset + this.o, n));
    this.o += n;
    return s;
  }
  bytes(n: number) {
    const b = new Uint8Array(this.v.buffer, this.v.byteOffset + this.o, n);
    this.o += n;
    return b;
  }
}

async function inflate(data: Uint8Array) {
  // cel pixels are zlib streams ("deflate" in the Compression Streams API)
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface RawLayer {
  name: string;
  visible: boolean;
  opacity: number;
  image: boolean;
  level: number;
}

interface RawCel {
  layer: number;
  frame: number;
  x: number;
  y: number;
  opacity: number;
  w: number;
  h: number;
  px: Uint8Array | null;
  link: number;
}

export async function readAseprite(buf: ArrayBuffer): Promise<AseSprite> {
  const r = new Reader(new DataView(buf));
  r.u32(); // file size
  if (r.u16() !== 0xa5e0) throw new Error("not an Aseprite file");
  const frames = r.u16(), w = r.u16(), h = r.u16(), depth = r.u16();
  const flags = r.u32();
  r.skip(2 + 4 + 4);
  const transparent = r.u8();
  r.skip(3);
  r.skip(128 - r.o); // the rest of the header
  if (depth !== 32 && depth !== 16 && depth !== 8) throw new Error(`unsupported color depth ${depth}`);
  const layerOpacity = (flags & 1) !== 0;

  const layers: RawLayer[] = [];
  const cels: RawCel[] = [];
  const durations: number[] = [];
  const tags: Tag[] = [];
  let palette: number[][] = [];

  for (let f = 0; f < frames; f++) {
    const start = r.o;
    const size = r.u32();
    if (r.u16() !== 0xf1fa) throw new Error("broken frame");
    const oldChunks = r.u16();
    durations.push(r.u16());
    r.skip(2);
    const newChunks = r.u32();
    const chunks = newChunks || oldChunks;
    for (let c = 0; c < chunks; c++) {
      const cStart = r.o;
      const cSize = r.u32();
      const type = r.u16();
      if (type === 0x2004) {
        const lflags = r.u16(), ltype = r.u16(), level = r.u16();
        r.skip(4);
        r.u16(); // blend mode
        const opacity = r.u8();
        r.skip(3);
        layers.push({ name: r.str(), visible: (lflags & 1) !== 0, opacity: layerOpacity ? opacity / 255 : 1, image: ltype === 0, level });
      } else if (type === 0x2005) {
        const layer = r.u16(), x = r.i16(), y = r.i16(), opacity = r.u8(), ctype = r.u16();
        r.skip(2 + 5);
        const cel: RawCel = { layer, frame: f, x, y, opacity: opacity / 255, w: 0, h: 0, px: null, link: -1 };
        if (ctype === 1) cel.link = r.u16();
        else if (ctype === 0 || ctype === 2) {
          cel.w = r.u16();
          cel.h = r.u16();
          const rest = r.bytes(cStart + cSize - r.o);
          cel.px = ctype === 2 ? await inflate(rest) : rest.slice();
        }
        if (ctype !== 3) cels.push(cel);
      } else if (type === 0x2018) {
        const n = r.u16();
        r.skip(8);
        for (let i = 0; i < n; i++) {
          const from = r.u16(), to = r.u16(), dir = r.u8();
          r.skip(2 + 6 + 3 + 1);
          tags.push({ name: r.str(), from, to, dir: dir === 1 ? "reverse" : dir >= 2 ? "pingpong" : "forward" });
        }
      } else if (type === 0x2019) {
        const n = r.u32(), first = r.u32(), last = r.u32();
        r.skip(8);
        if (palette.length < n) palette = palette.concat(Array.from({ length: n - palette.length }, () => [0, 0, 0, 0]));
        for (let i = first; i <= last; i++) {
          const pf = r.u16();
          palette[i] = [r.u8(), r.u8(), r.u8(), r.u8()];
          if (pf & 1) r.str();
        }
      } else if ((type === 0x0004 || type === 0x0011) && !palette.length) {
        // old palette chunks (files from old versions): packets of colors
        const packets = r.u16();
        let i = 0;
        for (let p = 0; p < packets; p++) {
          i += r.u8();
          let n = r.u8() || 256;
          while (n--) {
            const k = type === 0x0011 ? 4 : 1; // 0x0011 stores 6-bit colors
            palette[i++] = [Math.min(255, r.u8() * k), Math.min(255, r.u8() * k), Math.min(255, r.u8() * k), 255];
          }
        }
      }
      r.o = cStart + cSize;
    }
    r.o = start + size;
  }

  // a layer shows only if it and every group above it are visible
  const shown: boolean[] = [];
  const stack: boolean[] = [];
  for (const l of layers) {
    stack.length = l.level;
    const parentShown = stack.every((v) => v);
    shown.push(l.visible && parentShown);
    stack[l.level] = l.visible;
  }

  const rgba = (px: Uint8Array, i: number, out: Uint8ClampedArray, o: number, layerIsBg: boolean) => {
    if (depth === 32) out.set(px.subarray(i * 4, i * 4 + 4), o);
    else if (depth === 16) {
      const v = px[i * 2];
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = px[i * 2 + 1];
    } else {
      const k = px[i];
      if (k === transparent && !layerIsBg) return;
      const c = palette[k] ?? [0, 0, 0, 0];
      out[o] = c[0];
      out[o + 1] = c[1];
      out[o + 2] = c[2];
      out[o + 3] = c[3];
    }
  };

  const out: Layer[] = [];
  layers.forEach((l, li) => {
    if (!l.image) return;
    const imgs = Array.from({ length: frames }, () => new ImageData(w, h));
    const mine = cels.filter((c) => c.layer === li);
    const at = new Map(mine.map((c) => [c.frame, c]));
    for (const c0 of mine) {
      const c = c0.link >= 0 ? at.get(c0.link) : c0;
      if (!c?.px) continue;
      const dst = imgs[c0.frame].data;
      for (let y = 0; y < c.h; y++) {
        const ty = c.y + y;
        if (ty < 0 || ty >= h) continue;
        for (let x = 0; x < c.w; x++) {
          const tx = c.x + x;
          if (tx < 0 || tx >= w) continue;
          const o = (ty * w + tx) * 4;
          rgba(c.px, y * c.w + x, dst, o, false);
          if (c.opacity < 1) dst[o + 3] = Math.round(dst[o + 3] * c.opacity);
        }
      }
    }
    out.push({ name: l.name, visible: shown[li], opacity: l.opacity, cels: imgs });
  });
  if (!out.length) out.push({ name: "Layer 1", visible: true, opacity: 1, cels: Array.from({ length: frames }, () => new ImageData(w, h)) });
  return { w, h, layers: out, durations, tags };
}
