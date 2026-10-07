// Whole-image operations for the pixel editor: transforms, outline, color replace,
// hue/saturation/lightness/brightness/contrast. All work on straight-alpha RGBA ImageData.

import type { EditSprite } from "./sprite.ts";

export function flip(img: ImageData, horizontal: boolean) {
  const { width: w, height: h } = img;
  const out = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = horizontal ? w - 1 - x : x, sy = horizontal ? y : h - 1 - y;
      out.data.set(img.data.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * w + x) * 4);
    }
  return out;
}

export function rotate(img: ImageData, clockwise: boolean) {
  const { width: w, height: h } = img;
  const out = new ImageData(h, w);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nx = clockwise ? h - 1 - y : y, ny = clockwise ? x : w - 1 - x;
      out.data.set(img.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * h + nx) * 4);
    }
  return out;
}

/** Nearest-neighbor resample to an exact size. */
export function resample(img: ImageData, nw: number, nh: number) {
  const out = new ImageData(nw, nh);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / nw));
      const sy = Math.min(img.height - 1, Math.floor((y * img.height) / nh));
      out.data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * nw + x) * 4);
    }
  return out;
}

/** Change the canvas size; content anchored at (ox, oy) in the new canvas. */
export function canvasSize(img: ImageData, nw: number, nh: number, ox = 0, oy = 0) {
  const out = new ImageData(nw, nh);
  for (let y = 0; y < img.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= nh) continue;
    for (let x = 0; x < img.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= nw) continue;
      out.data.set(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), (ty * nw + tx) * 4);
    }
  }
  return out;
}

/** Bounding box of opaque pixels across every cel of the sprite. */
export function contentBounds(s: EditSprite) {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (const l of s.layers)
    for (const c of l.cels)
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (c.data[(y * c.width + x) * 4 + 3]) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 1px outline around opaque pixels (4-neighborhood, or 8 with corners). */
export function outline(img: ImageData, color: [number, number, number, number], corners = false) {
  const { width: w, height: h, data } = img;
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      let near = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
      if (!near && corners) near = solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1);
      if (near) out.data.set(color, (y * w + x) * 4);
    }
  return out;
}

export function replaceColor(img: ImageData, from: [number, number, number], to: [number, number, number, number]) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] && d[i] === from[0] && d[i + 1] === from[1] && d[i + 2] === from[2]) d.set(to, i);
  }
  return out;
}

// ------------------------------------------------------------ color adjustment

export interface Adjust {
  /** degrees, -180..180 */
  hue: number;
  /** -100..100 */
  saturation: number;
  /** -100..100 (HSL lightness shift) */
  lightness: number;
  /** -100..100 (additive) */
  brightness: number;
  /** -100..100 */
  contrast: number;
}

export const NO_ADJUST: Adjust = { hue: 0, saturation: 0, lightness: 0, brightness: 0, contrast: 0 };

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

/** Adjusts colors; identical input colors always map to identical outputs (palette stays clean). */
export function adjust(img: ImageData, a: Adjust) {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const d = out.data;
  const cache = new Map<number, number>();
  const contrast = (a.contrast + 100) / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let v = cache.get(key);
    if (v === undefined) {
      let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      h += a.hue / 360;
      s = a.saturation >= 0 ? s + (1 - s) * (a.saturation / 100) : s * (1 + a.saturation / 100);
      l = a.lightness >= 0 ? l + (1 - l) * (a.lightness / 100) : l * (1 + a.lightness / 100);
      let [r, g, b] = hslToRgb(h, Math.min(1, Math.max(0, s)), Math.min(1, Math.max(0, l)));
      const add = (a.brightness / 100) * 255;
      [r, g, b] = [r, g, b].map((c) => (c - 128) * contrast + 128 + add);
      v = (clamp8(r) << 16) | (clamp8(g) << 8) | clamp8(b);
      cache.set(key, v);
    }
    d[i] = (v >> 16) & 255;
    d[i + 1] = (v >> 8) & 255;
    d[i + 2] = v & 255;
  }
  return out;
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
