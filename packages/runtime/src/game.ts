// The game: loads a cartridge, runs its script on a fixed 60Hz timestep and exposes the
// drawing/input API to it. Scripts are plain JS with optional init/update/draw functions:
//
//   let x = 0
//   function update(dt) { if (key('right')) x += 1 }
//   function draw() { cls('#000'); spr('hero', x, 50) }

import { beep, sfx } from "./audio.ts";
import { decodeFrame, type Cartridge, type SpriteDef, type TileMap } from "./cart.ts";
import { FONT_HEIGHT, GLYPHS, LINE_HEIGHT, SPACE_WIDTH } from "./font.ts";
import { Input } from "./input.ts";
import { Renderer, type Region } from "./renderer.ts";

const STEP = 1 / 60;

export interface GameOptions {
  onError?: (err: Error | null) => void;
  onLog?: (...args: unknown[]) => void;
  /** Show an FPS / draw-call counter. */
  stats?: boolean;
  /** Start with updates paused (editor). Drawing still runs so edits show immediately. */
  paused?: boolean;
}

type Tag = NonNullable<SpriteDef["tags"]>[number];

interface Sprite {
  w: number;
  h: number;
  fps: number;
  regions: Region[];
  tags: Tag[];
  /** per-frame tile flags (bit 0 = solid) */
  flags: number[];
}

/** Frame index for animation time t (seconds), optionally limited to a tag's range. */
export function animFrame(n: number, fps: number, t: number, tag?: Tag) {
  const from = tag ? tag.from : 0;
  const to = tag ? Math.min(tag.to, n - 1) : n - 1;
  const len = Math.max(1, to - from + 1);
  const step = Math.floor(t * fps);
  if (!tag || tag.dir === "forward") return from + (step % len);
  if (tag.dir === "reverse") return to - (step % len);
  const period = Math.max(1, len * 2 - 2);
  const k = step % period;
  return from + (k < len ? k : period - k);
}

export interface SprOptions {
  frame?: number;
  /** true: play all frames; "name": play that tag. Uses the sprite's fps. */
  anim?: boolean | string;
  /** Animation clock in seconds (default: game time), e.g. time since the walk started. */
  at?: number;
  scale?: number;
  sx?: number;
  sy?: number;
  /** Rotation in radians around the origin. */
  rot?: number;
  /** Origin as a fraction of the size (0..1). Default top-left; 0.5 = center. */
  ox?: number;
  oy?: number;
  flipX?: boolean;
  flipY?: boolean;
  alpha?: number;
  tint?: Color;
  add?: boolean;
}

export interface TextOptions {
  align?: "left" | "center" | "right";
  scale?: number;
  shadow?: Color;
  outline?: Color;
}

export type Color = string | number;

const colorCache = new Map<Color, number>();
/** "#rgb" | "#rrggbb" | "#rrggbbaa" | 0xrrggbb  ->  0xRRGGBBAA */
export function parseColor(c: Color): number {
  let v = colorCache.get(c);
  if (v !== undefined) return v;
  if (typeof c === "number") v = ((c << 8) | 0xff) >>> 0;
  else {
    let h = c.replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    if (h.length === 6) h += "ff";
    v = parseInt(h, 16) >>> 0;
  }
  colorCache.set(c, v);
  return v;
}

function withAlpha(rgba: number, alpha: number) {
  const a = Math.round((rgba & 255) * Math.max(0, Math.min(1, alpha)));
  return ((rgba & 0xffffff00) | a) >>> 0;
}

const SUFFIX = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
/** Big-number formatting for incremental games: 1234 -> "1.23K". */
export function fmt(n: number): string {
  if (!isFinite(n)) return "∞";
  if (Math.abs(n) < 1000) return (Math.abs(n) < 10 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString());
  const tier = Math.min(SUFFIX.length - 1, Math.floor(Math.log10(Math.abs(n)) / 3));
  const v = n / 10 ** (tier * 3);
  return (v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.floor(v).toString()) + SUFFIX[tier];
}

type Script = { init?: () => void; update?: (dt: number) => void; draw?: () => void };

export class Game {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly width: number;
  readonly height: number;
  private sprites = new Map<string, Sprite>();
  private maps = new Map<string, TileMap>();
  private glyphs = new Map<string, { region: Region; width: number }>();
  private script: Script = {};
  private raf = 0;
  private last = 0;
  private acc = 0;
  private camX = 0;
  private camY = 0;
  private bg: number;
  private fps = 60;
  private frames = 0;
  private fpsTime = 0;
  error: Error | null = null;
  playing: boolean;
  time = 0;

  private constructor(public canvas: HTMLCanvasElement, public cart: Cartridge, private opts: GameOptions) {
    [this.width, this.height] = cart.resolution;
    this.renderer = new Renderer(canvas, this.width, this.height);
    this.input = new Input(canvas, this.renderer);
    this.bg = parseColor(cart.background ?? "#000000");
    this.playing = !opts.paused;
    this.buildFont();
  }

  static async create(canvas: HTMLCanvasElement, cart: Cartridge, opts: GameOptions = {}) {
    const g = new Game(canvas, cart, opts);
    await Promise.all(cart.sprites.map((s) => g.loadSprite(s)));
    g.setMaps(cart.maps ?? []);
    g.restart();
    return g;
  }

  // ------------------------------------------------------------ assets

  private buildFont() {
    for (const [ch, glyph] of GLYPHS) {
      const img = new ImageData(glyph.width, FONT_HEIGHT);
      glyph.rows.forEach((row, y) => {
        for (let x = 0; x < glyph.width; x++) {
          if (row[x] === "#") img.data.set([255, 255, 255, 255], (y * glyph.width + x) * 4);
        }
      });
      this.glyphs.set(ch, { region: this.renderer.upload(img), width: glyph.width });
    }
  }

  async loadSprite(def: SpriteDef) {
    const frames = await Promise.all(def.frames.map(decodeFrame));
    this.setSpriteImages(def.name, frames, def.fps, def.tags, def.flags);
  }

  /** Replace all tile maps (deep-copied: the game may mset() its own copy). */
  setMaps(maps: TileMap[]) {
    this.maps = new Map(maps.map((m) => [m.name, { ...m, layers: m.layers.map((l) => ({ ...l, data: l.data.slice() })) }]));
  }

  /** Replace a sprite's pixels. Same-size frames are updated in place (instant live edit). */
  setSpriteImages(name: string, frames: ImageData[], fps = 8, tags: Tag[] = [], flags: number[] = []) {
    const old = this.sprites.get(name);
    const regions = frames.map((img, i) => this.renderer.upload(img, old?.regions[i]));
    this.sprites.set(name, { w: frames[0]?.width ?? 0, h: frames[0]?.height ?? 0, fps, regions, tags, flags });
  }

  removeSprite(name: string) {
    this.sprites.delete(name);
  }

  renameSprite(from: string, to: string) {
    const s = this.sprites.get(from);
    if (!s) return;
    this.sprites.delete(from);
    this.sprites.set(to, s);
  }

  // ------------------------------------------------------------ lifecycle

  /** Recompile the cartridge code from scratch and call init(). */
  restart(code = this.cart.code) {
    this.cart.code = code;
    this.time = 0;
    this.acc = 0;
    this.setError(null);
    try {
      const api = this.api();
      const names = Object.keys(api);
      const fn = new Function(
        ...names,
        `"use strict";\n${code}\n;return {` +
          ["init", "update", "draw"].map((n) => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(",") +
          "};",
      );
      this.script = fn(...names.map((n) => api[n]));
      this.script.init?.();
    } catch (e) {
      this.script = {};
      this.setError(e as Error);
    }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  play() {
    this.playing = true;
    this.last = performance.now();
    this.input.flush();
  }

  pause() {
    this.playing = false;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.destroy();
    this.renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private setError(e: Error | null) {
    this.error = e;
    this.opts.onError?.(e);
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick);
    // rAF timestamps can be slightly older than performance.now() taken in play(): never go negative
    const dt = Math.max(0, Math.min(0.25, (now - (this.last || now)) / 1000));
    this.last = now;

    if (this.playing && !this.error) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 5) {
        this.input.beginTick();
        try {
          this.script.update?.(STEP);
        } catch (e) {
          this.setError(e as Error);
        }
        this.input.endTick();
        this.acc -= STEP;
        this.time += STEP;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }

    this.renderer.begin(this.bg);
    this.camX = this.camY = 0;
    this.renderer.setBlend(false);
    if (!this.error) {
      try {
        this.script.draw?.();
      } catch (e) {
        this.setError(e as Error);
      }
    }
    this.camX = this.camY = 0;
    this.renderer.setBlend(false);
    if (this.error) this.drawError(this.error);
    if (this.opts.stats) {
      this.frames++;
      if (now - this.fpsTime > 500) {
        this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
        this.frames = 0;
        this.fpsTime = now;
      }
      const s = `${this.fps} FPS  ${this.renderer.drawCalls + 1} DC`;
      this.rect(0, 0, this.textw(s) + 4, 10, 0x000000aa);
      this.text(s, 2, 2, 0x7cfc00ff);
    }
    this.renderer.present();
  };

  private drawError(e: Error) {
    const lines = wrap(`ERROR: ${e.message}`, Math.floor((this.width - 8) / 6));
    const h = lines.length * LINE_HEIGHT + 6;
    this.rect(0, this.height - h, this.width, h, 0x7a1020ee);
    lines.forEach((l, i) => this.text(l, 4, this.height - h + 4 + i * LINE_HEIGHT, 0xffffffff));
  }

  // ------------------------------------------------------------ drawing primitives

  private rect(x: number, y: number, w: number, h: number, rgba: number) {
    this.renderer.rect(this.renderer.white, Math.round(x - this.camX), Math.round(y - this.camY), Math.round(w), Math.round(h), rgba);
  }

  private textw(str: string, scale = 1) {
    let w = 0, best = 0;
    for (const ch of str) {
      if (ch === "\n") { best = Math.max(best, w); w = 0; continue; }
      const g = this.glyphs.get(ch);
      w += ((g ? g.width : SPACE_WIDTH) + 1) * scale;
    }
    return Math.max(best, w) - (str.length ? scale : 0);
  }

  private text(str: string, x: number, y: number, rgba: number, o: TextOptions = {}) {
    const scale = o.scale ?? 1;
    if (o.outline !== undefined) {
      const oc = parseColor(o.outline);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]])
        this.text(str, x + dx * scale, y + dy * scale, oc, { ...o, outline: undefined, shadow: undefined });
    }
    if (o.shadow !== undefined) this.text(str, x + scale, y + scale, parseColor(o.shadow), { ...o, outline: undefined, shadow: undefined });
    let cy = Math.round(y - this.camY);
    for (const line of str.split("\n")) {
      const lw = this.textw(line, scale);
      let cx = Math.round(x - this.camX - (o.align === "center" ? lw / 2 : o.align === "right" ? lw : 0));
      for (const ch of line) {
        const g = this.glyphs.get(ch);
        if (g) this.renderer.rect(g.region, cx, cy, g.width * scale, FONT_HEIGHT * scale, rgba);
        cx += ((g ? g.width : SPACE_WIDTH) + 1) * scale;
      }
      cy += LINE_HEIGHT * scale;
    }
  }

  // ------------------------------------------------------------ tile maps

  private mapLayer(m: TileMap, layer: string | number) {
    return typeof layer === "number" ? m.layers[layer] : m.layers.find((l) => l.name === layer);
  }

  /** Draw a map's visible layers (or one layer) with its top-left at (x, y); only on-screen tiles. */
  private drawMap(name: string, x: number, y: number, layer?: string | number, rgba = 0xffffffff) {
    const m = this.maps.get(name);
    const t = m && this.sprites.get(m.tileset);
    if (!m || !t || !t.w || !t.h) return;
    const ox = Math.round(x - this.camX), oy = Math.round(y - this.camY);
    const tx0 = Math.max(0, Math.floor(-ox / t.w)), ty0 = Math.max(0, Math.floor(-oy / t.h));
    const tx1 = Math.min(m.w, Math.ceil((this.width - ox) / t.w)), ty1 = Math.min(m.h, Math.ceil((this.height - oy) / t.h));
    const layers = layer === undefined ? m.layers.filter((l) => l.visible !== false) : [this.mapLayer(m, layer)].filter(Boolean);
    for (const l of layers) {
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const v = l!.data[ty * m.w + tx];
          if (v < 0 || v >= t.regions.length) continue;
          this.renderer.rect(t.regions[v], ox + tx * t.w, oy + ty * t.h, t.w, t.h, rgba);
        }
      }
    }
  }

  // ------------------------------------------------------------ script API

  private api(): Record<string, unknown> {
    const r = this.renderer;
    const input = this.input;
    const storeKey = (k: string) => `slate:${this.cart.name}:${k}`;

    return {
      W: this.width,
      H: this.height,
      mouse: input.mouse,

      cls: (c: Color = "#000") => r.clear(parseColor(c)),
      camera: (x = 0, y = 0) => { this.camX = Math.round(x); this.camY = Math.round(y); },
      blend: (mode: "normal" | "add" = "normal") => r.setBlend(mode === "add"),

      spr: (name: string, x: number, y: number, o: SprOptions = {}) => {
        const s = this.sprites.get(name);
        if (!s || s.regions.length === 0) return;
        const n = s.regions.length;
        const f = o.anim
          ? animFrame(n, s.fps, o.at ?? this.time, typeof o.anim === "string" ? s.tags.find((t) => t.name === o.anim) : undefined)
          : ((o.frame ?? 0) % n + n) % n;
        const sx = (o.sx ?? 1) * (o.scale ?? 1), sy = (o.sy ?? 1) * (o.scale ?? 1);
        const w = s.w * sx, h = s.h * sy;
        let rgba = o.tint !== undefined ? parseColor(o.tint) : 0xffffffff;
        if (o.alpha !== undefined) rgba = withAlpha(rgba, o.alpha);
        if (o.add) r.setBlend(true);
        const ox = (o.ox ?? 0) * w, oy = (o.oy ?? 0) * h;
        if (!o.rot) {
          r.rect(s.regions[f], Math.round(x - ox - this.camX), Math.round(y - oy - this.camY), w, h, rgba, o.flipX, o.flipY);
        } else {
          const c = Math.cos(o.rot), sn = Math.sin(o.rot);
          const px = x - this.camX, py = y - this.camY;
          const pt = (lx: number, ly: number) => [px + lx * c - ly * sn, py + lx * sn + ly * c];
          const [a, b, cc, d] = [pt(-ox, -oy), pt(w - ox, -oy), pt(w - ox, h - oy), pt(-ox, h - oy)];
          r.quad(s.regions[f], a[0], a[1], b[0], b[1], cc[0], cc[1], d[0], d[1], rgba, o.flipX, o.flipY);
        }
        if (o.add) r.setBlend(false);
      },
      sprite: (name: string) => {
        const s = this.sprites.get(name);
        return s ? { w: s.w, h: s.h, frames: s.regions.length } : null;
      },

      rect: (x: number, y: number, w: number, h: number, c: Color = "#fff") => this.rect(x, y, w, h, parseColor(c)),
      rectline: (x: number, y: number, w: number, h: number, c: Color = "#fff") => {
        const k = parseColor(c);
        this.rect(x, y, w, 1, k); this.rect(x, y + h - 1, w, 1, k);
        this.rect(x, y + 1, 1, h - 2, k); this.rect(x + w - 1, y + 1, 1, h - 2, k);
      },
      line: (x0: number, y0: number, x1: number, y1: number, c: Color = "#fff") => {
        const k = parseColor(c);
        x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (let i = 0; i < 4096; i++) {
          this.rect(x0, y0, 1, 1, k);
          if (x0 === x1 && y0 === y1) break;
          const e2 = 2 * err;
          if (e2 >= dy) { err += dy; x0 += sx; }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      },
      circ: (cx: number, cy: number, rad: number, c: Color = "#fff", fill = true) => {
        const k = parseColor(c);
        rad = Math.round(rad);
        for (let y = -rad; y <= rad; y++) {
          const half = Math.round(Math.sqrt(rad * rad - y * y + rad * 0.8));
          if (fill) this.rect(cx - half, cy + y, half * 2 + 1, 1, k);
          else { this.rect(cx - half, cy + y, 1, 1, k); this.rect(cx + half, cy + y, 1, 1, k); }
        }
      },
      text: (str: unknown, x: number, y: number, c: Color = "#fff", o?: TextOptions) => this.text(String(str), x, y, parseColor(c), o),
      textw: (str: unknown, scale = 1) => this.textw(String(str), scale),

      key: (k: string) => input.key(k),
      keyp: (k: string) => input.keyp(k),
      hit: (x: number, y: number, w: number, h: number) => {
        const m = input.mouse;
        return m.inside && m.x >= x - this.camX && m.y >= y - this.camY && m.x < x + w - this.camX && m.y < y + h - this.camY;
      },

      // ---------------------------------------------------------------- tile maps
      map: (name: string, x = 0, y = 0, o: { layer?: string | number; tint?: Color } = {}) =>
        this.drawMap(name, x, y, o.layer, o.tint === undefined ? 0xffffffff : parseColor(o.tint)),
      mget: (name: string, tx: number, ty: number, layer: string | number = 0) => {
        const m = this.maps.get(name);
        const l = m && this.mapLayer(m, layer);
        if (!m || !l || tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return -1;
        return l.data[Math.floor(ty) * m.w + Math.floor(tx)];
      },
      mset: (name: string, tx: number, ty: number, tile: number, layer: string | number = 0) => {
        const m = this.maps.get(name);
        const l = m && this.mapLayer(m, layer);
        if (!m || !l || tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
        l.data[Math.floor(ty) * m.w + Math.floor(tx)] = tile;
      },
      /** Objects placed on a map in the editor, optionally only one type. Returns fresh copies. */
      objects: (name: string, type?: string) => {
        const m = this.maps.get(name);
        return (m?.objects ?? [])
          .filter((o) => type === undefined || o.type === type)
          .map((o) => ({ ...o, ...(o.props ?? {}), props: { ...(o.props ?? {}) } }));
      },
      mapinfo: (name: string) => {
        const m = this.maps.get(name);
        const t = m && this.sprites.get(m.tileset);
        return m ? { w: m.w, h: m.h, tw: t?.w ?? 0, th: t?.h ?? 0 } : null;
      },
      fget: (sprite: string, frame: number, bit = 0) => (((this.sprites.get(sprite)?.flags[frame] ?? 0) >> bit) & 1) === 1,
      /** Is the pixel (px, py) of map `name` (drawn at 0,0) on a tile with flag `bit` (solid by default)? */
      msolid: (name: string, px: number, py: number, bit = 0) => {
        const m = this.maps.get(name);
        const t = m && this.sprites.get(m.tileset);
        if (!m || !t || !t.w || !t.h) return false;
        const tx = Math.floor(px / t.w), ty = Math.floor(py / t.h);
        if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return false;
        return m.layers.some((l) => {
          const v = l.data[ty * m.w + tx];
          return v >= 0 && ((t.flags[v] ?? 0) >> bit) & 1;
        });
      },

      t: () => this.time,
      rnd: (a = 1, b?: number) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
      irnd: (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1)),
      pick: <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)],
      clamp: (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v)),
      lerp: (a: number, b: number, t: number) => a + (b - a) * t,
      fmt,

      save: (k: string, v: unknown) => {
        try { localStorage.setItem(storeKey(k), JSON.stringify(v)); } catch { /* storage unavailable */ }
      },
      load: <T,>(k: string, fallback: T): T => {
        try {
          const s = localStorage.getItem(storeKey(k));
          return s === null ? fallback : (JSON.parse(s) as T);
        } catch {
          return fallback;
        }
      },
      wipe: (k: string) => { try { localStorage.removeItem(storeKey(k)); } catch { /* ignore */ } },

      sfx,
      beep,
      log: (...a: unknown[]) => (this.opts.onLog ?? console.log)(...a),
    };
  }
}

function wrap(s: string, cols: number) {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if ((line + " " + word).trim().length > cols) { if (line) out.push(line); line = word; }
      else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out.slice(0, 6);
}
