// Sprite sheet / GIF export and sheet import.

import type { EditSprite, Tag } from "./sprite.ts";

/** Flattened frames laid out in a grid (cols = 0: one row). Returns the PNG-ready image and Aseprite-style JSON. */
export function buildSheet(s: EditSprite, cols = 0, padding = 0, tag: Tag | null = null) {
  const from = tag ? tag.from : 0;
  const to = tag ? tag.to : s.frameCount - 1;
  const frames = Array.from({ length: to - from + 1 }, (_, i) => s.flat(from + i));
  const n = frames.length;
  const c = cols > 0 ? Math.min(cols, n) : n;
  const r = Math.ceil(n / c);
  const W = c * s.w + (c - 1) * padding, H = r * s.h + (r - 1) * padding;
  const img = new ImageData(W, H);
  const meta: Record<string, unknown> = {};
  const frameInfo: Record<string, unknown> = {};
  frames.forEach((f, i) => {
    const x = (i % c) * (s.w + padding), y = Math.floor(i / c) * (s.h + padding);
    for (let row = 0; row < s.h; row++) img.data.set(f.data.subarray(row * s.w * 4, (row + 1) * s.w * 4), ((y + row) * W + x) * 4);
    frameInfo[`${s.name} ${i}.png`] = {
      frame: { x, y, w: s.w, h: s.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: s.w, h: s.h },
      sourceSize: { w: s.w, h: s.h },
      duration: Math.round(1000 / s.fps),
    };
  });
  Object.assign(meta, {
    app: "Slate",
    version: "1",
    image: `${s.name}.png`,
    format: "RGBA8888",
    size: { w: W, h: H },
    scale: "1",
    frameTags: (tag ? [] : s.tags).map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.dir })),
  });
  return { image: img, json: JSON.stringify({ frames: frameInfo, meta }, null, 2) };
}

export async function pngBytes(img: ImageData, scale = 1): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = img.width * scale;
  c.height = img.height * scale;
  const g = c.getContext("2d")!;
  const tmp = document.createElement("canvas");
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Slice a sheet image into frames of fw×fh (row-major, skipping fully empty cells at the end). */
export function sliceSheet(img: ImageData, fw: number, fh: number): ImageData[] {
  const out: ImageData[] = [];
  for (let y = 0; y + fh <= img.height; y += fh)
    for (let x = 0; x + fw <= img.width; x += fw) {
      const f = new ImageData(fw, fh);
      for (let row = 0; row < fh; row++) f.data.set(img.data.subarray(((y + row) * img.width + x) * 4, ((y + row) * img.width + x + fw) * 4), row * fw * 4);
      out.push(f);
    }
  while (out.length > 1 && out[out.length - 1].data.every((v, i) => i % 4 !== 3 || v === 0)) out.pop();
  return out;
}

// ------------------------------------------------------------ GIF

/** Animated GIF of the sprite (or one tag), scaled up by an integer. Transparent pixels stay transparent. */
export function buildGif(s: EditSprite, scale = 4, tag: Tag | null = null): Uint8Array {
  const order: number[] = [];
  if (!tag) for (let i = 0; i < s.frameCount; i++) order.push(i);
  else if (tag.dir === "reverse") for (let i = tag.to; i >= tag.from; i--) order.push(i);
  else {
    for (let i = tag.from; i <= tag.to; i++) order.push(i);
    if (tag.dir === "pingpong") for (let i = tag.to - 1; i > tag.from; i--) order.push(i);
  }
  const frames = order.map((i) => s.flat(i));
  // global palette: index 0 = transparent
  const colors = new Map<number, number>();
  const palette: number[] = [0];
  const indexOf = (r: number, g: number, b: number) => {
    let key = (r << 16) | (g << 8) | b;
    let idx = colors.get(key);
    if (idx !== undefined) return idx;
    if (palette.length >= 256) {
      // palette full: snap to nearest existing color
      let best = 1, bd = Infinity;
      for (let j = 1; j < palette.length; j++) {
        const p = palette[j];
        const d = (((p >> 16) & 255) - r) ** 2 + (((p >> 8) & 255) - g) ** 2 + ((p & 255) - b) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      colors.set(key, best);
      return best;
    }
    idx = palette.length;
    palette.push(key);
    colors.set(key, idx);
    return idx;
  };
  const W = s.w * scale, H = s.h * scale;
  const indexed = frames.map((f) => {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (((y / scale) | 0) * s.w + ((x / scale) | 0)) * 4;
        px[y * W + x] = f.data[o + 3] < 128 ? 0 : indexOf(f.data[o], f.data[o + 1], f.data[o + 2]);
      }
    return px;
  });
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const size = 1 << bits;

  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
  u16(W);
  u16(H);
  out.push(0x80 | (bits - 1), 0, 0);
  for (let i = 0; i < size; i++) {
    const c = palette[i] ?? 0;
    out.push((c >> 16) & 255, (c >> 8) & 255, c & 255);
  }
  // loop forever
  out.push(0x21, 0xff, 11, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const delay = Math.max(2, Math.round(100 / s.fps));
  for (const px of indexed) {
    out.push(0x21, 0xf9, 4, 0x09, delay & 255, delay >> 8, 0, 0); // dispose: restore bg, transparent idx 0
    out.push(0x2c);
    u16(0); u16(0); u16(W); u16(H);
    out.push(0);
    const minCode = Math.max(2, bits);
    out.push(minCode);
    const data = lzw(px, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

function lzw(pixels: Uint8Array, minCode: number): number[] {
  const clear = 1 << minCode, eoi = clear + 1;
  const out: number[] = [];
  let cur = 0, nbits = 0;
  let size = minCode + 1;
  const emit = (code: number) => {
    cur |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(cur & 255);
      cur >>= 8;
      nbits -= 8;
    }
  };
  // key = prefix code * 256 + next pixel
  let dict = new Map<number, number>();
  let next = eoi + 1;
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      size = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (nbits > 0) out.push(cur & 255);
  return out;
}
