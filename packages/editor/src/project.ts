// Editor-side model of a Slate project.
//
// A project is a folder of files (see packages/runtime/src/project.ts):
//   slate.json, scripts/**/*.luau, sprites/**/NAME.png (+ NAME.json, NAME.layers.png), maps/**/NAME.json,
//   music/**/NAME.ogg|wav, sounds/**/NAME.wav|ogg
// While editing, sprites are decoded (ImageData, with layers); everything else stays in `cart`
// (settings, maps, scripts, audio as data URLs). toCart() feeds the player, toFiles() saves the folder.

import {
  base64, baseName, decodeFrame, encodeFrame, extOf, fromBase64, packProject, PROJECT_FILE,
  type Cartridge, type SpriteDef, type SpriteMeta, type TileMap,
} from "@slate/runtime";
import { EditSprite } from "./sprite.ts";

export { EditSprite } from "./sprite.ts";

type Listener = (what: "all" | "sprites" | "pixels" | "files", name?: string) => void;

const AUTOSAVE_KEY = "slate:autosave";

export const STARTER_MAIN = `-- main.luau runs first. Put more scripts in scripts/ and load them with require("name").

local x, y = W / 2, H / 2

function init()
end

function update(dt)
  -- arrows / WASD / gamepad. Templates (File > New from template) show a whole game.
  x += axis("x") * 60 * dt
  y += axis("y") * 60 * dt
end

function draw()
  cls("#1a1c2c")
  circ(x, y, 6, "#ffcd75", true)
  text("hello, Slate!", W / 2, 20, "#f4f4f4", { align = "center" })
end
`;

// ------------------------------------------------------------------ images

async function imageData(dataUrl: string): Promise<ImageData> {
  return decodeFrame(dataUrl);
}

function crop(img: ImageData, x: number, y: number, w: number, h: number) {
  const out = new ImageData(w, h);
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return out;
}

/** Cut a sheet into frames (left to right, then top to bottom) - same rules as the player. */
export function splitSheet(img: ImageData, w: number, h: number, count?: number) {
  w = Math.min(w || img.width, img.width);
  h = Math.min(h || img.height, img.height);
  const cols = Math.max(1, Math.floor(img.width / w)), rows = Math.max(1, Math.floor(img.height / h));
  const n = Math.max(1, Math.min(count ?? cols * rows, cols * rows));
  return Array.from({ length: n }, (_, i) => crop(img, (i % cols) * w, Math.floor(i / cols) * h, w, h));
}

/** Frames side by side in one image. */
function joinFrames(frames: ImageData[], rows = 1): ImageData {
  const w = frames[0].width, h = frames[0].height, cols = Math.ceil(frames.length / rows);
  const out = new ImageData(w * cols, h * rows);
  frames.forEach((f, i) => {
    const cx = (i % cols) * w, cy = Math.floor(i / cols) * h;
    for (let r = 0; r < h; r++) out.data.set(f.data.subarray(r * w * 4, (r + 1) * w * 4), ((cy + r) * out.width + cx) * 4);
  });
  return out;
}

const pngBytes = (img: ImageData) => fromBase64(encodeFrame(img));

// ------------------------------------------------------------------ sprites <-> cartridge

async function loadSprite(def: SpriteDef): Promise<EditSprite> {
  let frames = await Promise.all((def.frames ?? []).map(imageData));
  if (!frames.length && def.sheet) frames = splitSheet(await imageData(def.sheet), def.w, def.h, def.count);
  const s = new EditSprite(def.name, frames, def.fps ?? 8);
  if (def.layers?.length) {
    s.layers = await Promise.all(def.layers.map(async (l) => ({ ...l, cels: await Promise.all(l.cels.map(imageData)) })));
  }
  s.tags = (def.tags ?? []).map((t) => ({ ...t }));
  s.flags = (def.flags ?? []).slice();
  s.durations = (def.durations ?? []).slice();
  return s;
}

const isSimple = (s: EditSprite) => {
  const l0 = s.layers[0];
  return s.layers.length === 1 && l0.visible && l0.opacity === 1 && !l0.locked && !l0.alphaLock;
};

function saveSprite(s: EditSprite, withLayers = true): SpriteDef {
  const def: SpriteDef = { name: s.name, w: s.w, h: s.h, fps: s.fps, frames: s.frames.map(encodeFrame) };
  if (s.tags.length) def.tags = s.tags.map((t) => ({ ...t }));
  if (s.flags.some((f) => f)) def.flags = s.flags.slice(0, s.frameCount).map((f) => f ?? 0);
  if (s.durations.some((d) => d > 0)) def.durations = Array.from({ length: s.frameCount }, (_, i) => s.durations[i] ?? 0);
  if (withLayers && !isSimple(s)) {
    def.layers = s.layers.map((l) => ({
      name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, alphaLock: l.alphaLock, cels: l.cels.map(encodeFrame),
    }));
  }
  return def;
}

// ------------------------------------------------------------------ the project

export class Project {
  sprites: EditSprite[] = [];
  /** Where a map's file lives (map name -> folder); default "maps". */
  mapFolders = new Map<string, string>();
  /** Where an audio file lives ("music:name" / "sounds:name" -> folder). */
  audioFolders = new Map<string, string>();
  /** Folders that exist even when empty (made in the explorer). */
  folders = new Set<string>(["scripts", "sprites", "maps", "music", "sounds"]);
  /** The folder this project was opened from / saved to (desktop path or browser handle id). */
  location: string | null = null;
  private listeners: Listener[] = [];

  constructor(public cart: Cartridge) {
    cart.scripts ??= {};
    cart.music ??= {};
    cart.sounds ??= {};
    cart.maps ??= [];
    cart.lang ??= "luau";
    // single-file cartridges become a project with scripts/main.luau
    if (!Object.keys(cart.scripts).length && cart.lang === "luau") {
      cart.scripts["scripts/main.luau"] = cart.code || STARTER_MAIN;
      cart.main = "scripts/main.luau";
    }
    cart.main ??= "scripts/main.luau";
    cart.code = "";
  }

  get maps() {
    return (this.cart.maps ??= []);
  }

  get scripts() {
    return this.cart.scripts!;
  }

  static async load(cart: Cartridge) {
    const p = new Project(cart);
    p.sprites = await Promise.all(cart.sprites.map(loadSprite));
    for (const path of Object.keys(p.scripts)) p.addFolders(path);
    // sub-folders recorded in the cartridge
    for (const [key, dir] of Object.entries(cart.folders ?? {})) {
      const [kind, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      if (kind === "sprites") {
        const s = p.get(name);
        if (s) s.folder = dir;
      } else if (kind === "maps") p.mapFolders.set(name, dir);
      else p.audioFolders.set(key, dir);
      p.addFolders(`${dir}/x`);
    }
    return p;
  }

  /** Open a project folder's files (path -> bytes). */
  static async fromFiles(files: Map<string, Uint8Array>, dirs: string[] = []) {
    const p = await Project.load(packProject(files));
    for (const path of files.keys()) {
      const top = path.split("/")[0];
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const name = baseName(path), ext = extOf(path);
      if (top === "sprites" && ext === "png" && !path.endsWith(".layers.png")) {
        const s = p.get(name);
        if (!s) continue;
        s.folder = folder;
        const meta: SpriteMeta = files.has(path.replace(/\.png$/i, ".json")) ? JSON.parse(new TextDecoder().decode(files.get(path.replace(/\.png$/i, ".json")))) : {};
        const layered = files.get(path.replace(/\.png$/i, ".layers.png"));
        if (layered && meta.layers?.length) {
          const img = await imageData(`data:image/png;base64,${base64(layered)}`);
          const cels = splitSheet(img, s.w, s.h);
          const n = s.frameCount;
          s.layers = meta.layers.map((l, li) => ({ ...l, cels: cels.slice(li * n, li * n + n) }));
        }
      } else if (top === "maps" && ext === "json") p.mapFolders.set(name, folder);
      else if (top === "music" || top === "sounds") p.audioFolders.set(`${top}:${name}`, folder);
      p.addFolders(path);
    }
    for (const d of dirs) p.folders.add(d);
    return p;
  }

  addFolders(path: string) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) this.folders.add(parts.slice(0, i).join("/"));
  }

  on(fn: Listener) {
    this.listeners.push(fn);
  }

  emit(what: "all" | "sprites" | "pixels" | "files", name?: string) {
    for (const fn of this.listeners) fn(what, name);
  }

  get(name: string) {
    return this.sprites.find((s) => s.name === name);
  }

  uniqueName(base: string) {
    base = base.replace(/[^\w-]/g, "_") || "sprite";
    let name = base, i = 2;
    while (this.get(name)) name = `${base}${i++}`;
    return name;
  }

  addSprite(name: string, frames: ImageData[], fps = 8, folder = "sprites") {
    const s = new EditSprite(this.uniqueName(name), frames, fps);
    s.folder = folder;
    this.sprites.push(s);
    this.emit("sprites", s.name);
    return s;
  }

  removeSprite(name: string) {
    this.sprites = this.sprites.filter((s) => s.name !== name);
    this.emit("sprites");
  }

  // ------------------------------------------------------------ scripts and other files

  /** Every file path in the project (what the explorer shows). */
  paths(): string[] {
    const out = [PROJECT_FILE, ...Object.keys(this.scripts)];
    for (const s of this.sprites) out.push(`${s.folder}/${s.name}.png`);
    for (const m of this.maps) out.push(`${this.mapFolders.get(m.name) ?? "maps"}/${m.name}.json`);
    for (const [kind, rec] of [["music", this.cart.music!], ["sounds", this.cart.sounds!]] as const) {
      for (const [name, url] of Object.entries(rec)) {
        out.push(`${this.audioFolders.get(`${kind}:${name}`) ?? kind}/${name}.${url.startsWith("data:audio/wav") ? "wav" : "ogg"}`);
      }
    }
    return out.sort();
  }

  uniquePath(path: string) {
    const taken = new Set(this.paths());
    if (!taken.has(path)) return path;
    const dot = path.lastIndexOf(".");
    for (let i = 2; ; i++) {
      const p = `${path.slice(0, dot)}${i}${path.slice(dot)}`;
      if (!taken.has(p)) return p;
    }
  }

  addScript(path: string, text = "") {
    path = this.uniquePath(path);
    this.scripts[path] = text;
    this.addFolders(path);
    this.emit("files", path);
    return path;
  }

  /** Rename / move a file (scripts, sprites, maps, audio). Returns false if the name is taken. */
  renamePath(from: string, to: string) {
    if (from === to) return true;
    if (this.paths().includes(to)) return false;
    const top = from.split("/")[0];
    const folder = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    if (top === "scripts" && from in this.scripts) {
      this.scripts[to] = this.scripts[from];
      delete this.scripts[from];
      if (this.cart.main === from) this.cart.main = to;
    } else if (top === "sprites") {
      const s = this.get(baseName(from));
      if (!s) return false;
      if (this.get(baseName(to)) && baseName(to) !== s.name) return false;
      s.name = baseName(to);
      s.folder = folder;
    } else if (top === "maps") {
      const m = this.maps.find((x) => x.name === baseName(from));
      if (!m) return false;
      this.mapFolders.delete(m.name);
      m.name = baseName(to);
      this.mapFolders.set(m.name, folder);
    } else if (top === "music" || top === "sounds") {
      const rec = top === "music" ? this.cart.music! : this.cart.sounds!;
      const url = rec[baseName(from)];
      delete rec[baseName(from)];
      rec[baseName(to)] = url;
      this.audioFolders.set(`${top}:${baseName(to)}`, folder);
    }
    this.addFolders(to);
    this.emit("files", to);
    return true;
  }

  deletePath(path: string) {
    const top = path.split("/")[0];
    if (top === "scripts") delete this.scripts[path];
    else if (top === "sprites") this.removeSprite(baseName(path));
    else if (top === "maps") this.maps.splice(this.maps.findIndex((m) => m.name === baseName(path)), 1);
    else if (top === "music") delete this.cart.music![baseName(path)];
    else if (top === "sounds") delete this.cart.sounds![baseName(path)];
    this.emit("files");
  }

  /** Delete a folder and everything in it. */
  deleteFolder(folder: string) {
    for (const p of this.paths()) if (p.startsWith(folder + "/")) this.deletePath(p);
    for (const f of [...this.folders]) if (f === folder || f.startsWith(folder + "/")) this.folders.delete(f);
    this.emit("files");
  }

  addAudio(kind: "music" | "sounds", name: string, bytes: Uint8Array, ext: string, folder: string = kind) {
    const rec = kind === "music" ? this.cart.music! : this.cart.sounds!;
    rec[name] = `data:audio/${ext === "wav" ? "wav" : "ogg"};base64,${base64(bytes)}`;
    this.audioFolders.set(`${kind}:${name}`, folder);
    this.emit("files");
  }

  // ------------------------------------------------------------ output

  /** Cartridge for the player and for exports (no editor-only layer data). */
  toCart(): Cartridge {
    return { ...this.cart, code: "", sprites: this.sprites.map((s) => saveSprite(s, false)) };
  }

  /** Cartridge with everything (layers, folders too), for .slate files and autosave. */
  toFullCart(): Cartridge {
    const folders: Record<string, string> = {};
    for (const s of this.sprites) if (s.folder !== "sprites") folders[`sprites:${s.name}`] = s.folder;
    for (const [n, d] of this.mapFolders) if (d !== "maps") folders[`maps:${n}`] = d;
    for (const [k, d] of this.audioFolders) if (d !== k.slice(0, k.indexOf(":"))) folders[k] = d;
    return { ...this.cart, code: "", folders, sprites: this.sprites.map((s) => saveSprite(s, true)) };
  }

  /** The project as files: path -> bytes. */
  toFiles(): Map<string, Uint8Array> {
    const enc = new TextEncoder();
    const json = (o: unknown) => enc.encode(JSON.stringify(o, null, 2) + "\n");
    const files = new Map<string, Uint8Array>();
    const c = this.cart;
    files.set(PROJECT_FILE, json({ name: c.name, title: c.title ?? c.name, resolution: c.resolution, background: c.background, main: c.main, ...(c.fullscreen ? { fullscreen: true } : {}), ...(c.palette?.length ? { palette: c.palette } : {}) }));
    for (const [path, src] of Object.entries(this.scripts)) files.set(path, enc.encode(src));
    for (const s of this.sprites) {
      const base = `${s.folder}/${s.name}`;
      files.set(`${base}.png`, pngBytes(joinFrames(s.frames)));
      const meta: SpriteMeta = {};
      if (s.frameCount > 1) Object.assign(meta, { w: s.w, h: s.h });
      if (s.fps !== 8) meta.fps = s.fps;
      if (s.durations.some((d) => d > 0)) meta.durations = Array.from({ length: s.frameCount }, (_, i) => s.durations[i] ?? 0);
      if (s.tags.length) meta.tags = s.tags.map((t) => ({ ...t }));
      if (s.flags.some((f) => f)) meta.flags = s.flags.slice(0, s.frameCount).map((f) => f ?? 0);
      if (!isSimple(s)) {
        meta.layers = s.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, alphaLock: l.alphaLock }));
        files.set(`${base}.layers.png`, pngBytes(joinFrames(s.layers.flatMap((l) => l.cels), s.layers.length)));
      }
      if (Object.keys(meta).length) files.set(`${base}.json`, json(meta));
    }
    for (const m of this.maps) files.set(`${this.mapFolders.get(m.name) ?? "maps"}/${m.name}.json`, enc.encode(JSON.stringify(m)));
    for (const [kind, rec] of [["music", c.music!], ["sounds", c.sounds!]] as const) {
      for (const [name, url] of Object.entries(rec)) {
        const ext = url.startsWith("data:audio/wav") ? "wav" : "ogg";
        files.set(`${this.audioFolders.get(`${kind}:${name}`) ?? kind}/${name}.${ext}`, fromBase64(url));
      }
    }
    return files;
  }

  autosave() {
    // with audio when it fits in browser storage, otherwise without (a saved folder has everything)
    const full = this.toFullCart();
    for (const cart of [full, { ...full, music: {}, sounds: {} }]) {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(cart));
        return;
      } catch {
        // too big: try the smaller one
      }
    }
  }

  static restore(): Cartridge | null {
    try {
      const s = localStorage.getItem(AUTOSAVE_KEY);
      return s ? (JSON.parse(s) as Cartridge) : null;
    } catch {
      return null;
    }
  }
}

export type { TileMap };
