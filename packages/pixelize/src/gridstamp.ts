// Grid Stamp: turn AI "pixel art" (soft, uneven, off-grid pseudo-pixels) into real pixel art.
//
// The idea is to treat the source like a physical grid board: find the grid the model was
// *trying* to draw on, lay it over the image, and stamp one solid color per cell.
//
//  1. Background  - use real alpha, or key out a flat/gradient border color (e.g. magenta).
//  2. Pitch       - edge-energy profiles along x/y; a Fourier scan over candidate pitches finds
//                   the grid spacing and its phase (where the lines sit).
//  3. Elastic fit - AI pixels drift and vary in size, so each grid line is snapped to the
//                   nearest strong edge with a Viterbi pass that keeps spacing close to the pitch.
//  4. Stamp       - each cell takes the medoid color of its *interior* (edges are where blur and
//                   background halos live), so no blended in-between colors are created.
//  5. Palette     - k-means in OKLab, every cell snapped to the palette.
//  6. Cleanup     - remove stray single pixels and alpha specks that survived.

import { labDist, labToRgb, rgbToLab, type RGB } from "./color.ts";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface StampOptions {
  /** Source pixels per output pixel. "auto" detects it. */
  pitch?: number | "auto";
  minPitch?: number;
  maxPitch?: number;
  /** Raise the pitch if needed so the result's longest side fits. */
  maxSize?: number;
  /** Palette size. 0 keeps every stamped color. */
  colors?: number;
  /** Fixed palette (overrides `colors`). */
  palette?: RGB[];
  /** "auto": real alpha if present, else key out the border color. */
  background?: "auto" | "alpha" | "none" | RGB;
  /** OKLab distance treated as "same as background". Default adapts to the border's spread. */
  bgTolerance?: number;
  /** Let grid lines bend to follow the drawn pixels. */
  elastic?: boolean;
  cleanup?: boolean;
  /**
   * Edge-preserving pre-smoothing passes (0-3). Flattens AI grain inside blocks before stamping.
   * "auto": 2 for scenes (no background), 0 for sprites.
   */
  smooth?: number | "auto";
  /**
   * De-glow passes (0-3): blurry edges and glow halos are pushed to the nearer side
   * (local darkest or brightest color), so soft AI edges become crisp pixel-art edges.
   * "auto": 2 for scenes, 0 for sprites.
   */
  sharpen?: number | "auto";
  /** Merge same-color islands smaller than this many pixels into their surroundings. "auto": 3 for scenes, 0 for sprites. */
  despeckle?: number | "auto";
  /**
   * Scenes: stamp at the image's own (natural) grid, then scale up by a whole number and
   * center-crop to exactly [w, h]. Keeps crisp pixels when the model's blocks are bigger than
   * the target resolution needs (forcing a finer pitch would sample AI grain instead).
   */
  cover?: [number, number];
  /**
   * Make a seamless square tile of this many output pixels: stamp at the natural grid (no scaling,
   * so the drawn shapes survive), take a piece from the middle, and hide the wrap-around seams with
   * minimum-error cuts (image quilting). Pixels are chosen, never blended, so the palette stays exact.
   */
  tile?: number;
  /** Which piece of the texture becomes the tile (0 = center); use 1, 2, 3... for variants. */
  tileVariant?: number;
  /** Crop to the opaque pixels. */
  trim?: boolean;
  padding?: number;
}

export interface StampResult {
  image: RGBAImage;
  palette: RGB[];
  pitch: number;
  /** Grid line positions in source pixels (for overlays). */
  xCuts: number[];
  yCuts: number[];
  /** 0..1, how clearly a grid was found. */
  confidence: number;
  background: RGB | null;
}

const DEFAULTS = {
  pitch: "auto" as number | "auto",
  minPitch: 2,
  // AI "pixel art" blocks are 2-10 source pixels; larger peaks are image structure, not the grid
  maxPitch: 12,
  maxSize: 0,
  colors: 16,
  background: "auto" as StampOptions["background"],
  bgTolerance: 0,
  elastic: true,
  cleanup: true,
  smooth: "auto" as number | "auto",
  sharpen: "auto" as number | "auto",
  despeckle: "auto" as number | "auto",
  trim: true,
  padding: 1,
};

export function gridStamp(src: RGBAImage, options: StampOptions = {}): StampResult {
  const opt = { ...DEFAULTS, ...options };
  const { width: W, height: H, data } = src;
  const N = W * H;

  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], lab, i * 3);

  // 1. background
  const { fg, bgLab, bgRgb, tol } = backgroundMask(src, lab, opt.background!, opt.bgTolerance);

  // 2. pitch + phase from edge energy
  const ex = edgeProfile(lab, fg, bgLab, W, H, true);
  const ey = edgeProfile(lab, fg, bgLab, W, H, false);
  let pitch: number;
  let confidence: number;
  if (opt.pitch === "auto") {
    ({ pitch, confidence } = detectPitch(ex, ey, opt.minPitch, Math.min(opt.maxPitch, W / 4, H / 4)));
  } else {
    pitch = opt.pitch;
    confidence = pitchScore(ex, ey, pitch);
  }
  if (opt.maxSize > 0) {
    const bb = bbox(fg, W, H);
    const longest = bb ? Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0) : Math.max(W, H);
    pitch = Math.max(pitch, longest / opt.maxSize);
  }

  // Scenes (nothing keyed out) get grain smoothing + despeckling by default.
  // tiles are textures with fine detail (cracks, outlines): scene cleanup would erase it
  const scene = !bgLab && fg.every((v) => v === 1) && !opt.tile;
  const smooth = opt.smooth === "auto" ? 0 : opt.smooth;
  const despeckle = opt.despeckle === "auto" ? (scene ? 3 : 0) : opt.despeckle;
  const sharpen = opt.sharpen === "auto" ? (scene ? 2 : 0) : opt.sharpen;
  if (sharpen > 0) {
    const natural = opt.pitch === "auto" ? pitch : detectPitch(ex, ey, opt.minPitch, Math.min(opt.maxPitch, W / 4, H / 4)).pitch;
    // AI blur is ~1-2px wide regardless of block size; a wider window turns thin lines into double edges
    kramer(lab, W, H, Math.max(1, Math.min(2, Math.round(natural * 0.3))), sharpen);
  }
  if (smooth > 0) {
    // radius follows the size of the blocks the model drew, not the (maybe forced) output pitch
    const natural = opt.pitch === "auto" ? pitch : detectPitch(ex, ey, opt.minPitch, Math.min(opt.maxPitch, W / 4, H / 4)).pitch;
    smoothLab(lab, W, H, Math.max(1, Math.min(4, Math.round(natural * 0.4))), smooth);
  }

  // 3. grid lines
  const xCuts = fitCuts(ex, pitch, W, opt.elastic);
  const yCuts = fitCuts(ey, pitch, H, opt.elastic);
  const gw = xCuts.length - 1, gh = yCuts.length - 1;

  // 4. stamp one color per cell
  const cellLab = new Float32Array(gw * gh * 3);
  const opaque = new Uint8Array(gw * gh);
  const pick: number[] = [];
  for (let cy = 0; cy < gh; cy++) {
    const y0 = yCuts[cy], y1 = yCuts[cy + 1];
    const my = inset(y1 - y0);
    for (let cx = 0; cx < gw; cx++) {
      const x0 = xCuts[cx], x1 = xCuts[cx + 1];
      const mx = inset(x1 - x0);
      pick.length = 0;
      let total = 0;
      for (let y = y0 + my; y < y1 - my; y++) {
        for (let x = x0 + mx; x < x1 - mx; x++) {
          total++;
          if (fg[y * W + x]) pick.push(y * W + x);
        }
      }
      const c = cy * gw + cx;
      if (total === 0 || pick.length * 2 < total) continue;
      opaque[c] = 1;
      medoidColor(lab, pick, cellLab, c * 3);
    }
  }

  // Fringe: silhouette cells that are mostly background-tinted blur (halo) get dropped.
  // Only boundary cells are checked so real colors near the key color inside the sprite survive.
  if (bgLab) {
    for (let pass = 0; pass < 2; pass++) {
      const drop: number[] = [];
      for (let cy = 0; cy < gh; cy++)
        for (let cx = 0; cx < gw; cx++) {
          const c = cy * gw + cx;
          if (!opaque[c]) continue;
          const edge =
            cx === 0 || cy === 0 || cx === gw - 1 || cy === gh - 1 ||
            !opaque[c - 1] || !opaque[c + 1] || !opaque[c - gw] || !opaque[c + gw];
          if (!edge) continue;
          if (labDist(cellLab, c * 3, bgLab, 0) < tol * 2) { drop.push(c); continue; }
          // A halo cell is a blend of the background and its inner neighbor: its color lies on
          // the line between the two.
          for (const n of [c - 1, c + 1, c - gw, c + gw, c - gw - 1, c - gw + 1, c + gw - 1, c + gw + 1]) {
            if (n < 0 || n >= gw * gh || !opaque[n]) continue;
            const t = blendT(bgLab, cellLab, n * 3, cellLab, c * 3);
            if (t > 0.15 && t < 0.85) { drop.push(c); break; }
          }
        }
      for (const c of drop) opaque[c] = 0;
    }
  }

  // 5. palette
  const palLab = opt.palette
    ? paletteFromRgb(opt.palette)
    : opt.colors > 0
      ? kmeans(cellLab, opaque, opt.colors)
      : uniqueColors(cellLab, opaque);
  const k = palLab.length / 3;
  const idx = new Int16Array(gw * gh).fill(-1);
  for (let c = 0; c < gw * gh; c++) {
    if (!opaque[c]) continue;
    let best = 0, bd = Infinity;
    for (let j = 0; j < k; j++) {
      const d = labDist(cellLab, c * 3, palLab, j * 3);
      if (d < bd) { bd = d; best = j; }
    }
    idx[c] = best;
  }

  // 6. cleanup
  if (opt.cleanup) cleanup(idx, gw, gh, palLab);
  if (despeckle > 1) {
    modeFilter(idx, gw, gh);
    despeckleIdx(idx, gw, gh, despeckle);
  }

  const palette: RGB[] = [];
  for (let j = 0; j < k; j++) palette.push(labToRgb(palLab[j * 3], palLab[j * 3 + 1], palLab[j * 3 + 2]));

  // trim + emit
  let ox = 0, oy = 0, ow = gw, oh = gh;
  if (opt.trim) {
    let x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++)
        if (idx[y * gw + x] >= 0) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    if (x1 >= 0) {
      const p = opt.padding;
      ox = x0 - p; oy = y0 - p; ow = x1 - x0 + 1 + 2 * p; oh = y1 - y0 + 1 + 2 * p;
    }
  }
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = x + ox, sy = y + oy;
      if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue;
      const j = idx[sy * gw + sx];
      if (j < 0) continue;
      const o = (y * ow + x) * 4;
      out[o] = palette[j][0]; out[o + 1] = palette[j][1]; out[o + 2] = palette[j][2]; out[o + 3] = 255;
    }
  }

  let image: RGBAImage = { width: ow, height: oh, data: out };
  if (opt.cover) image = coverCrop(image, opt.cover[0], opt.cover[1]);
  if (opt.tile && opt.tile > 0) image = makeTileable(image, opt.tile, opt.tileVariant ?? 0);

  return {
    image,
    palette: palette.filter((_, j) => idx.includes(j)),
    pitch,
    xCuts,
    yCuts,
    confidence,
    background: bgRgb,
  };
}

// ---------------------------------------------------------------- background

function backgroundMask(src: RGBAImage, lab: Float32Array, mode: StampOptions["background"], tol: number) {
  const { width: W, height: H, data } = src;
  const N = W * H;
  const fg = new Uint8Array(N).fill(1);

  if (mode === "none") return { fg, bgLab: null, bgRgb: null, tol };

  let clear = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] < 128) clear++;
  if (mode === "alpha" || (mode === "auto" && clear > N * 0.02)) {
    for (let i = 0; i < N; i++) fg[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    return { fg, bgLab: null, bgRgb: null, tol };
  }

  // Background color: explicit, or the median of the border ring.
  const bgLab = new Float32Array(3);
  let bgRgb: RGB = [0, 0, 0];
  const full: number[] = [];
  for (let x = 0; x < W; x++) full.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) full.push(y * W, y * W + W - 1);
  // Strips and layers often stand on the bottom edge: also try just the top edge + upper sides.
  const top: number[] = [];
  for (let x = 0; x < W; x++) top.push(x);
  for (let y = 1; y < H / 2; y++) top.push(y * W, y * W + W - 1);
  let ring = full;
  let ringDist: number[] = [];
  const estimate = (r: number[]) => {
    const ch = (c: number) => r.map((i) => data[i * 4 + c]).sort((a, b) => a - b)[r.length >> 1];
    bgRgb = [ch(0), ch(1), ch(2)];
    rgbToLab(bgRgb[0], bgRgb[1], bgRgb[2], bgLab);
    ringDist = r.map((i) => labDist(lab, i * 3, bgLab, 0)).sort((a, b) => a - b);
    return ringDist[r.length >> 1] <= 0.08;
  };
  if (Array.isArray(mode)) {
    bgRgb = mode;
    rgbToLab(mode[0], mode[1], mode[2], bgLab);
    ringDist = ring.map((i) => labDist(lab, i * 3, bgLab, 0)).sort((a, b) => a - b);
  } else if (!estimate(full)) {
    // If the border isn't mostly one color there is no background to remove (e.g. a scene).
    ring = top;
    // only trust the top edge for saturated key colors (magenta/green screens), not dark skies
    const chroma = () => Math.hypot(bgLab[1], bgLab[2]);
    if (!estimate(top) || chroma() < 0.15) return { fg, bgLab: null, bgRgb: null, tol };
  }
  // Tolerance: a few times the background's own noise, so sprite colors close to the key
  // color (purple next to magenta) are not eaten.
  if (!tol) tol = Math.min(0.12, Math.max(0.04, ringDist[Math.floor(ring.length * 0.9)] * 3));

  // Flood fill from the border. A pixel joins the background if it is close to the global
  // background color, or (for gradients/vignettes) close to the background neighbor it came from.
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const visit = (i: number, from: number) => {
    if (!fg[i]) return;
    const dg = labDist(lab, i * 3, bgLab, 0);
    if (dg < tol || (from >= 0 && dg < tol * 1.5 && labDist(lab, i * 3, lab, from * 3) < tol * 0.2)) {
      fg[i] = 0;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < W; x++) { visit(x, -1); visit((H - 1) * W + x, -1); }
  for (let y = 0; y < H; y++) { visit(y * W, -1); visit(y * W + W - 1, -1); }
  const flood = () => {
    while (head < tail) {
      const i = queue[head++];
      const x = i % W, y = (i / W) | 0;
      if (x > 0) visit(i - 1, i);
      if (x < W - 1) visit(i + 1, i);
      if (y > 0) visit(i - W, i);
      if (y < H - 1) visit(i + W, i);
    }
  };
  flood();

  // Pockets of background enclosed by the sprite (between an arm and the body) are not
  // reachable from the border. Seed from any sizable blob that is clearly background colored.
  const seen = new Uint8Array(N);
  const blob: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!fg[s] || seen[s] || labDist(lab, s * 3, bgLab, 0) >= tol * 0.8) continue;
    blob.length = 0;
    blob.push(s);
    seen[s] = 1;
    for (let b = 0; b < blob.length; b++) {
      const i = blob[b], x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j < 0 || seen[j] || !fg[j] || labDist(lab, j * 3, bgLab, 0) >= tol * 0.8) continue;
        seen[j] = 1;
        blob.push(j);
      }
    }
    if (blob.length >= 48) for (const i of blob) visit(i, -1);
  }
  flood();
  return { fg, bgLab, bgRgb, tol };
}

// ---------------------------------------------------------------- pitch

/** e[k] = color change between pixel k-1 and k, summed across the other axis. */
function edgeProfile(lab: Float32Array, fg: Uint8Array, bgLab: Float32Array | null, W: number, H: number, alongX: boolean) {
  const len = alongX ? W : H;
  const e = new Float64Array(len + 1);
  const outer = alongX ? H : W;
  const zero = bgLab ?? new Float32Array(3);
  for (let o = 0; o < outer; o++) {
    for (let k = 1; k < len; k++) {
      const a = alongX ? o * W + k - 1 : (k - 1) * W + o;
      const b = alongX ? o * W + k : k * W + o;
      if (!fg[a] && !fg[b]) continue;
      const pa = fg[a] ? lab : zero, ia = fg[a] ? a * 3 : 0;
      const pb = fg[b] ? lab : zero, ib = fg[b] ? b * 3 : 0;
      e[k] += labDist(pa, ia, pb, ib);
    }
  }
  return e;
}

function fourier(e: Float64Array, p: number) {
  let re = 0, im = 0;
  const w = (2 * Math.PI) / p;
  for (let k = 1; k < e.length; k++) {
    if (e[k] === 0) continue;
    re += e[k] * Math.cos(w * k);
    im -= e[k] * Math.sin(w * k);
  }
  return { re, im };
}

function sum(e: Float64Array) {
  let s = 0;
  for (const v of e) s += v;
  return s || 1;
}

/**
 * Remove the slow envelope (the sprite's overall silhouette) by subtracting a moving average
 * one period wide. What remains is only the oscillation that repeats every `p` pixels.
 */
function detrend(e: Float64Array, prefix: Float64Array, p: number) {
  const n = e.length;
  const out = new Float64Array(n);
  const half = p / 2;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, Math.round(k - half)), b = Math.min(n, Math.round(k + half));
    out[k] = e[k] - (prefix[b] - prefix[a]) / Math.max(1, b - a);
  }
  return out;
}

function prefixSum(e: Float64Array) {
  const p = new Float64Array(e.length + 1);
  for (let i = 0; i < e.length; i++) p[i + 1] = p[i] + e[i];
  return p;
}

const prefixCache = new WeakMap<Float64Array, Float64Array>();
function pitchScore(ex: Float64Array, ey: Float64Array, p: number) {
  let px = prefixCache.get(ex);
  if (!px) prefixCache.set(ex, (px = prefixSum(ex)));
  let py = prefixCache.get(ey);
  if (!py) prefixCache.set(ey, (py = prefixSum(ey)));
  const a = fourier(detrend(ex, px, p), p), b = fourier(detrend(ey, py, p), p);
  return (Math.hypot(a.re, a.im) + Math.hypot(b.re, b.im)) / (sum(ex) + sum(ey));
}

function detectPitch(ex: Float64Array, ey: Float64Array, minP: number, maxP: number) {
  const ps: number[] = [], ss: number[] = [];
  for (let p = minP; p <= maxP; p += 0.02) {
    ps.push(p);
    ss.push(pitchScore(ex, ey, p));
  }
  let max = 0;
  for (const s of ss) max = Math.max(max, s);
  if ((globalThis as any).process?.env?.STAMP_DEBUG) {
    const peaks = ps
      .map((p, i) => [p, ss[i]] as const)
      .filter((_, i) => i > 0 && i < ss.length - 1 && ss[i] >= ss[i - 1] && ss[i] >= ss[i + 1])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    console.log("peaks", peaks.map(([p, s]) => `${p.toFixed(2)}:${s.toFixed(3)}`).join(" "));
  }
  // A grid of pitch P also resonates at P/2, P/3 (harmonics) but cancels out at 2P, so the
  // strongest peak is the fundamental in practice.
  let best = ps[0], bestS = ss[0];
  for (let i = 1; i < ss.length; i++) if (ss[i] > bestS) { best = ps[i]; bestS = ss[i]; }
  return { pitch: best, confidence: bestS };
}

// ---------------------------------------------------------------- grid fit

function fitCuts(e: Float64Array, pitch: number, len: number, elastic: boolean): number[] {
  const f = fourier(e, pitch);
  const phase = ((-Math.atan2(f.im, f.re) / (2 * Math.PI)) * pitch + pitch * 4) % pitch;

  let cuts: number[];
  if (!elastic) {
    cuts = [];
    for (let x = phase; x < len; x += pitch) if (x > 0) cuts.push(Math.round(x));
  } else {
    cuts = viterbiCuts(e, pitch, len, phase);
  }

  // Close the grid at the borders, merging edge slivers thinner than half a cell.
  const all = [0, ...cuts.filter((c) => c > 0 && c < len), len];
  if (all.length > 2 && all[1] < pitch * 0.5) all.splice(1, 1);
  if (all.length > 2 && len - all[all.length - 2] < pitch * 0.5) all.splice(all.length - 2, 1);
  return all;
}

/** Choose cut positions that sit on strong edges while keeping spacing near `pitch`. */
function viterbiCuts(e: Float64Array, pitch: number, len: number, phase: number): number[] {
  // smoothed, mean-normalized edge strength
  const s = new Float64Array(len + 1);
  let mean = 0;
  for (let k = 1; k < len; k++) {
    s[k] = 0.25 * (e[k - 1] ?? 0) + 0.5 * e[k] + 0.25 * (e[k + 1] ?? 0);
    mean += s[k];
  }
  mean = mean / Math.max(1, len - 1) || 1;
  for (let k = 0; k <= len; k++) s[k] = Math.min(s[k] / mean, 8);

  const gMin = Math.max(1, Math.round(pitch * 0.6));
  const gMax = Math.max(gMin + 1, Math.round(pitch * 1.4));
  const lambda = 3;
  const best = new Float64Array(len + 1).fill(-Infinity);
  const prev = new Int32Array(len + 1).fill(-1);

  for (let x = 1; x < len; x++) {
    // phase prior: tiny pull toward the globally detected lattice
    const d = (((x - phase) % pitch) + pitch) % pitch;
    const off = Math.min(d, pitch - d) / pitch;
    const gain = s[x] - 0.5 * off * off;
    if (x <= gMax) best[x] = (gain * x) / pitch;
    // gain is weighted by the gap it closes, so the total does not grow with the number of
    // cuts: otherwise textured areas (edges everywhere) would get an over-fine grid.
    for (let g = gMin; g <= gMax && x - g >= 1; g++) {
      const v = best[x - g] - lambda * ((g - pitch) / pitch) ** 2 + (gain * g) / pitch;
      if (v > best[x]) { best[x] = v; prev[x] = x - g; }
    }
  }
  let end = -1, endV = -Infinity;
  for (let x = Math.max(1, len - gMax); x < len; x++) if (best[x] > endV) { endV = best[x]; end = x; }
  const cuts: number[] = [];
  for (let x = end; x > 0; x = prev[x]) cuts.push(x);
  return cuts.reverse();
}

/**
 * If color c ≈ mix(inner, bg, t), return t (share of background); otherwise -1.
 * "≈" means c is within a small distance of the segment and the two ends are far apart.
 */
function blendT(bg: Float32Array, inner: Float32Array, ii: number, c: Float32Array, ci: number) {
  const dx = bg[0] - inner[ii], dy = bg[1] - inner[ii + 1], dz = bg[2] - inner[ii + 2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 0.15 * 0.15) return -1;
  const t = ((c[ci] - inner[ii]) * dx + (c[ci + 1] - inner[ii + 1]) * dy + (c[ci + 2] - inner[ii + 2]) * dz) / len2;
  const px = inner[ii] + dx * t - c[ci], py = inner[ii + 1] + dy * t - c[ci + 1], pz = inner[ii + 2] + dz * t - c[ci + 2];
  return Math.sqrt(px * px + py * py + pz * pz) < 0.025 ? t : -1;
}

// ---------------------------------------------------------------- stamping

function inset(size: number) {
  return size >= 3 ? Math.max(1, Math.round(size * 0.2)) : 0;
}

/** Most central color of the sample (an actual color, never a blend), then denoised. */
function medoidColor(lab: Float32Array, pick: number[], out: Float32Array, o: number) {
  let sample = pick;
  if (pick.length > 64) {
    const step = pick.length / 64;
    sample = [];
    for (let i = 0; i < 64; i++) sample.push(pick[Math.floor(i * step)]);
  }
  let best = sample[0], bd = Infinity;
  for (const a of sample) {
    let d = 0;
    for (const b of sample) d += labDist(lab, a * 3, lab, b * 3);
    if (d < bd) { bd = d; best = a; }
  }
  let L = 0, A = 0, B = 0, n = 0;
  for (const a of sample) {
    if (labDist(lab, a * 3, lab, best * 3) < 0.04) {
      L += lab[a * 3]; A += lab[a * 3 + 1]; B += lab[a * 3 + 2]; n++;
    }
  }
  out[o] = L / n; out[o + 1] = A / n; out[o + 2] = B / n;
}

// ---------------------------------------------------------------- palette

function paletteFromRgb(p: RGB[]) {
  const out = new Float32Array(p.length * 3);
  p.forEach((c, j) => rgbToLab(c[0], c[1], c[2], out, j * 3));
  return out;
}

function uniqueColors(cellLab: Float32Array, opaque: Uint8Array) {
  const seen = new Map<string, number>();
  const out: number[] = [];
  for (let c = 0; c < opaque.length; c++) {
    if (!opaque[c]) continue;
    const rgb = labToRgb(cellLab[c * 3], cellLab[c * 3 + 1], cellLab[c * 3 + 2]);
    const key = rgb.join(",");
    if (seen.has(key)) continue;
    seen.set(key, out.length / 3);
    out.push(cellLab[c * 3], cellLab[c * 3 + 1], cellLab[c * 3 + 2]);
  }
  return new Float32Array(out);
}

function kmeans(cellLab: Float32Array, opaque: Uint8Array, k: number) {
  const pts: number[] = [];
  for (let c = 0; c < opaque.length; c++) if (opaque[c]) pts.push(c);
  if (pts.length === 0) return new Float32Array(0);
  k = Math.min(k, pts.length);

  // deterministic k-means++ seeding
  let seed = 0x9e3779b9;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cent = new Float32Array(k * 3);
  const d2 = new Float64Array(pts.length).fill(Infinity);
  let first = pts[Math.floor(rnd() * pts.length)];
  cent.set(cellLab.subarray(first * 3, first * 3 + 3), 0);
  for (let j = 1; j < k; j++) {
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const d = labDist(cellLab, pts[i] * 3, cent, (j - 1) * 3);
      d2[i] = Math.min(d2[i], d * d);
      total += d2[i];
    }
    let r = rnd() * total, pick = pts.length - 1;
    for (let i = 0; i < pts.length; i++) {
      r -= d2[i];
      if (r <= 0) { pick = i; break; }
    }
    cent.set(cellLab.subarray(pts[pick] * 3, pts[pick] * 3 + 3), j * 3);
  }

  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 24; iter++) {
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = labDist(cellLab, pts[i] * 3, cent, j * 3);
        if (d < bd) { bd = d; best = j; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const acc = new Float64Array(k * 4);
    for (let i = 0; i < pts.length; i++) {
      const j = assign[i];
      acc[j * 4] += cellLab[pts[i] * 3];
      acc[j * 4 + 1] += cellLab[pts[i] * 3 + 1];
      acc[j * 4 + 2] += cellLab[pts[i] * 3 + 2];
      acc[j * 4 + 3]++;
    }
    for (let j = 0; j < k; j++) {
      const n = acc[j * 4 + 3];
      if (n > 0) for (let c = 0; c < 3; c++) cent[j * 3 + c] = acc[j * 4 + c] / n;
    }
    if (iter > 0 && moved === 0) break;
  }
  return cent;
}

// ---------------------------------------------------------------- scene cleanup

/**
 * Seamless tile by image quilting. A (size+ov)² block is taken from the middle; for the wrap-around
 * overlap a per-row (then per-column) cut is found by dynamic programming where the continuation
 * of the far edge and the original near edge differ least, so the tile repeats without a visible seam.
 */
export function makeTileable(img: RGBAImage, size: number, variant = 0): RGBAImage {
  size = Math.max(2, Math.min(size, img.width, img.height));
  const ov = Math.max(1, Math.min(Math.floor(size / 3), img.width - size, img.height - size));
  const bw = size + ov;
  if (img.width < bw || img.height < bw) {
    // no room for an overlap: plain center crop
    return crop(img, Math.floor((img.width - size) / 2), Math.floor((img.height - size) / 2), size, size);
  }
  // variants walk the block around the texture (golden-ratio steps spread them evenly)
  const fx = variant ? (0.5 + variant * 0.618) % 1 : 0.5, fy = variant ? (0.5 + variant * 0.382) % 1 : 0.5;
  const B = crop(img, Math.floor((img.width - bw) * fx), Math.floor((img.height - bw) * fy), bw, bw);
  const px = (im: RGBAImage, x: number, y: number) => (y * im.width + x) * 4;
  const diff = (a: RGBAImage, ai: number, b: RGBAImage, bi: number) =>
    Math.abs(a.data[ai] - b.data[bi]) + Math.abs(a.data[ai + 1] - b.data[bi + 1]) + Math.abs(a.data[ai + 2] - b.data[bi + 2]);

  /** cut[i] in 0..ov for each of `lines` lines; cost(i, k) = mismatch when switching at k. */
  const bestCut = (lines: number, cost: (i: number, k: number) => number) => {
    const acc: number[][] = [];
    const from: number[][] = [];
    for (let i = 0; i < lines; i++) {
      acc.push([]);
      from.push([]);
      for (let k = 0; k <= ov; k++) {
        const c = cost(i, k);
        if (i === 0) { acc[i][k] = c; from[i][k] = k; continue; }
        let best = Infinity, arg = k;
        for (const d of [-1, 0, 1]) {
          const j = k + d;
          if (j < 0 || j > ov) continue;
          if (acc[i - 1][j] < best) { best = acc[i - 1][j]; arg = j; }
        }
        acc[i][k] = best + c;
        from[i][k] = arg;
      }
    }
    const cut = new Array(lines);
    let k = acc[lines - 1].indexOf(Math.min(...acc[lines - 1]));
    for (let i = lines - 1; i >= 0; i--) { cut[i] = k; k = from[i][k]; }
    return cut as number[];
  };

  // horizontal wrap: columns [0, ov) take the continuation B[x + size] left of the cut, the original right of it
  const hc = bestCut(bw, (y, k) => (k >= ov ? 0 : diff(B, px(B, size + k, y), B, px(B, k, y))));
  const H: RGBAImage = { width: size, height: bw, data: new Uint8ClampedArray(size * bw * 4) };
  for (let y = 0; y < bw; y++)
    for (let x = 0; x < size; x++) {
      const sx = x < ov && x < hc[y] ? size + x : x;
      H.data.set(B.data.subarray(px(B, sx, y), px(B, sx, y) + 4), px(H, x, y));
    }
  // vertical wrap, same idea on rows
  const vc = bestCut(size, (x, k) => (k >= ov ? 0 : diff(H, px(H, x, size + k), H, px(H, x, k))));
  const T: RGBAImage = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sy = y < ov && y < vc[x] ? size + y : y;
      T.data.set(H.data.subarray(px(H, x, sy), px(H, x, sy) + 4), px(T, x, y));
    }
  return T;
}

function crop(img: RGBAImage, x0: number, y0: number, w: number, h: number): RGBAImage {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

/** Integer nearest upscale so the image covers w×h, then center-crop to exactly w×h. */
function coverCrop(img: RGBAImage, w: number, h: number): RGBAImage {
  const k = Math.max(1, Math.ceil(Math.max(w / img.width, h / img.height) - 1e-6));
  const ox = Math.floor((img.width * k - w) / 2), oy = Math.floor((img.height * k - h) / 2);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + oy) / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + ox) / k));
      const si = (sy * img.width + sx) * 4;
      out.set(img.data.subarray(si, si + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Kramer/Bruckner edge sharpening: every pixel becomes either the darkest or the brightest
 * color in its neighborhood, whichever it is closer to. A soft ramp between two colors (blur,
 * glow, antialiasing) collapses into a hard edge, while flat areas are untouched.
 */
function kramer(lab: Float32Array, W: number, H: number, r: number, passes: number) {
  let src = lab;
  for (let pass = 0; pass < passes; pass++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        let lo = i, hi = i;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = (yy * W + xx) * 3;
            if (src[j] < src[lo]) lo = j;
            if (src[j] > src[hi]) hi = j;
          }
        }
        // only act on real edges; tiny lightness differences are texture, not blur
        const t = labDist(src, lo, src, hi) < 0.08 ? i : labDist(src, i, src, lo) <= labDist(src, i, src, hi) ? lo : hi;
        dst[i] = src[t]; dst[i + 1] = src[t + 1]; dst[i + 2] = src[t + 2];
      }
    }
    src = dst;
  }
  lab.set(src);
}

/**
 * Edge-preserving smoothing in OKLab (a small bilateral filter, repeated). Pixels only average
 * with neighbors of similar color, so AI grain inside a block flattens while edges stay sharp.
 */
function smoothLab(lab: Float32Array, W: number, H: number, r: number, passes: number) {
  const sigma = 0.05;
  const inv = 1 / (2 * sigma * sigma);
  let src = lab;
  for (let pass = 0; pass < passes; pass++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 3;
        let L = 0, A = 0, B = 0, wsum = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = (yy * W + xx) * 3;
            const dl = src[j] - src[i], da = src[j + 1] - src[i + 1], db = src[j + 2] - src[i + 2];
            const w = Math.exp(-(dl * dl + da * da + db * db) * inv);
            L += src[j] * w; A += src[j + 1] * w; B += src[j + 2] * w;
            wsum += w;
          }
        }
        dst[i] = L / wsum; dst[i + 1] = A / wsum; dst[i + 2] = B / wsum;
      }
    }
    src = dst;
  }
  lab.set(src);
}

/**
 * Majority filter: a pixel takes the color held by at least 5 of its 8 neighbors.
 * Removes grain and jagged single steps while straight edges and corners survive.
 */
function modeFilter(idx: Int16Array, w: number, h: number) {
  const src = idx.slice();
  const counts = new Map<number, number>();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (src[i] < 0) continue;
      counts.clear();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = src[i + dy * w + dx];
          if (v >= 0) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      for (const [v, n] of counts) {
        if (n >= 5 && v !== src[i]) {
          idx[i] = v;
          break;
        }
      }
    }
  }
}

/** Islands of one palette color smaller than minSize become the color that surrounds them most. */
function despeckleIdx(idx: Int16Array, w: number, h: number, minSize: number) {
  for (let pass = 0; pass < 2; pass++) {
    const seen = new Uint8Array(w * h);
    const comp: number[] = [];
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || idx[s] < 0) continue;
      const color = idx[s];
      comp.length = 0;
      comp.push(s);
      seen[s] = 1;
      for (let k = 0; k < comp.length && comp.length < minSize; k++) {
        const i = comp[k], x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
          if (j < 0 || seen[j] || idx[j] !== color) continue;
          seen[j] = 1;
          comp.push(j);
        }
      }
      if (comp.length >= minSize) continue;
      const votes = new Map<number, number>();
      for (const i of comp) {
        const x = i % w;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) {
          if (j < 0 || idx[j] === color || idx[j] < 0) continue;
          votes.set(idx[j], (votes.get(idx[j]) ?? 0) + 1);
        }
      }
      let best = -1, bv = 0;
      for (const [c, v] of votes) if (v > bv) { bv = v; best = c; }
      if (best >= 0) for (const i of comp) idx[i] = best;
    }
  }
}

// ---------------------------------------------------------------- cleanup

function cleanup(idx: Int16Array, w: number, h: number, palLab: Float32Array) {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : idx[y * w + x]);
  const src = idx.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x];
      const n4 = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      // alpha specks: lone opaque pixel / pinhole
      if (v >= 0 && n4.every((n) => n < 0)) { idx[y * w + x] = -1; continue; }
      if (v < 0) {
        if (n4.every((n) => n >= 0)) idx[y * w + x] = mode(n4);
        continue;
      }
      // a stray pixel unlike all 8 neighbors, but only slightly different from the dominant one
      const n8: number[] = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (dx || dy) { const n = at(x + dx, y + dy); if (n >= 0) n8.push(n); }
      if (n8.includes(v)) continue;
      const m = mode(n8);
      if (n8.filter((n) => n === m).length >= 4 && labDist(palLab, v * 3, palLab, m * 3) < 0.12) idx[y * w + x] = m;
    }
  }
}

function mode(xs: number[]) {
  const count = new Map<number, number>();
  let best = xs[0], bc = 0;
  for (const x of xs) {
    const c = (count.get(x) ?? 0) + 1;
    count.set(x, c);
    if (c > bc) { bc = c; best = x; }
  }
  return best;
}

function bbox(fg: Uint8Array, W: number, H: number) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (fg[y * W + x]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
