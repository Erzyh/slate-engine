// Animated GIF writer for Game view clips. Frames are encoded as they arrive (each with its own
// palette, so a long clip never piles up raw pixels). Pixel art rarely has more than 256 colors in
// one frame; when it does, colors are reduced to a 3-3-2 palette.

export class GifWriter {
  private parts: Uint8Array[] = [];
  frames = 0;

  constructor(private w: number, private h: number) {
    const head = [...new TextEncoder().encode("GIF89a"), w & 255, w >> 8, h & 255, h >> 8, 0x00, 0, 0];
    // loop forever (NETSCAPE2.0 extension)
    const loop = [0x21, 0xff, 0x0b, ...new TextEncoder().encode("NETSCAPE2.0"), 0x03, 0x01, 0, 0, 0x00];
    this.parts.push(new Uint8Array([...head, ...loop]));
  }

  /** Add one frame of RGBA pixels (w x h), shown for `delay` hundredths of a second. */
  addFrame(rgba: Uint8Array | Uint8ClampedArray, delay: number) {
    const { w, h } = this;
    const n = w * h;
    const index = new Uint8Array(n);
    const colors = new Map<number, number>();
    const px = new Uint32Array(rgba.buffer, rgba.byteOffset, n);
    let reduce = false;
    for (let i = 0; i < n; i++) {
      const c = px[i] & 0xffffff;
      let k = colors.get(c);
      if (k === undefined) {
        if (colors.size === 256) {
          reduce = true;
          break;
        }
        k = colors.size;
        colors.set(c, k);
      }
      index[i] = k;
    }
    let palette: number[];
    if (reduce) {
      // 3 bits red, 3 green, 2 blue
      palette = [];
      for (let k = 0; k < 256; k++) palette.push(Math.round(((k >> 5) * 255) / 7), Math.round((((k >> 2) & 7) * 255) / 7), Math.round(((k & 3) * 255) / 3));
      for (let i = 0; i < n; i++) {
        const c = px[i];
        index[i] = ((c & 0xff) >> 5 << 5) | (((c >> 8) & 0xff) >> 5 << 2) | (((c >> 16) & 0xff) >> 6);
      }
    } else {
      palette = [];
      for (const c of colors.keys()) palette.push(c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff);
    }
    const count = palette.length / 3;
    const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, count))));
    while (palette.length < 3 << bits) palette.push(0);
    const gce = [0x21, 0xf9, 0x04, 0x04, delay & 255, delay >> 8, 0, 0];
    const desc = [0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0x80 | (bits - 1)];
    const min = Math.max(2, bits);
    this.parts.push(new Uint8Array([...gce, ...desc, ...palette, min]), lzw(index, min));
    this.frames++;
  }

  finish() {
    this.parts.push(new Uint8Array([0x3b]));
    const total = this.parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** GIF LZW: variable-width codes, LSB first, in sub-blocks of up to 255 bytes. */
function lzw(index: Uint8Array, min: number) {
  const out: number[] = [];
  let block: number[] = [];
  let acc = 0, accBits = 0;
  const emit = (code: number, size: number) => {
    acc |= code << accBits;
    accBits += size;
    while (accBits >= 8) {
      block.push(acc & 255);
      acc >>>= 8;
      accBits -= 8;
      if (block.length === 255) {
        out.push(255, ...block);
        block = [];
      }
    }
  };
  const clear = 1 << min, eoi = clear + 1;
  let size = min + 1, next = eoi + 1;
  let table = new Map<number, number>();
  emit(clear, size);
  let cur = index[0];
  for (let i = 1; i < index.length; i++) {
    const k = index[i];
    const key = (cur << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      cur = hit;
      continue;
    }
    emit(cur, size);
    if (next === 4096) {
      emit(clear, size);
      next = eoi + 1;
      size = min + 1;
      table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    cur = k;
  }
  emit(cur, size);
  emit(eoi, size);
  if (accBits > 0) block.push(acc & 255);
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return new Uint8Array(out);
}

/** Nearest-neighbor upscale of RGBA pixels. */
export function upscale(px: Uint8Array, w: number, h: number, k: number) {
  if (k === 1) return px;
  const out = new Uint8Array(w * k * h * k * 4);
  const src = new Uint32Array(px.buffer, px.byteOffset, w * h);
  const dst = new Uint32Array(out.buffer);
  for (let y = 0; y < h * k; y++) {
    const row = Math.floor(y / k) * w;
    for (let x = 0; x < w * k; x++) dst[y * w * k + x] = src[row + Math.floor(x / k)];
  }
  return out;
}
