// Slate project folders <-> cartridges.
//
// A project is a folder of plain files (friendly to git and to other tools):
//
//   slate.json            { "name", "title", "resolution": [w, h], "background", "main": "scripts/main.luau" }
//   scripts/**/*.luau     game code; main runs first, the rest load with require("path/in/scripts")
//   sprites/**/NAME.png   a sprite: one frame, or a sheet of frames left to right
//   sprites/**/NAME.json  optional sprite settings: { w, h, count, fps, durations, tags, flags, box, layers }
//   sprites/**/NAME.layers.png   editor-only layered source (rows = layers, columns = frames)
//   maps/**/NAME.json     tile maps (tiles + placed objects)
//   music/**/NAME.ogg     music(name)      (.ogg or .wav)
//   sounds/**/NAME.wav    sfx(name)        (.wav or .ogg)
//
// packProject() turns the files into a single cartridge for the player and for exports.

import { resolveTemplates, type Cartridge, type SpriteDef, type TileMap } from "./cart.ts";

export interface ProjectSettings {
  name: string;
  title?: string;
  resolution: [number, number];
  background?: string;
  main?: string;
  /** start in fullscreen */
  fullscreen?: boolean;
  /** the project's own palette colors (editor) */
  palette?: string[];
  /** particle presets */
  particles?: Cartridge["particles"];
  /** object templates */
  templates?: Cartridge["templates"];
}

/** Settings stored next to a sprite's PNG (sprites/NAME.json). */
export interface SpriteMeta {
  w?: number;
  h?: number;
  count?: number;
  fps?: number;
  durations?: number[];
  tags?: SpriteDef["tags"];
  flags?: number[];
  /** hitbox [x, y, w, h] */
  box?: [number, number, number, number];
  /** autotile terrains: 16 frames each */
  autotiles?: number[][];
  /** animated tiles */
  tileAnims?: { frames: number[]; fps: number }[];
  /** editor-only layer info; pixels in NAME.layers.png (rows = layers, columns = frames) */
  layers?: { name: string; visible: boolean; opacity: number; locked?: boolean; alphaLock?: boolean }[];
}

export const PROJECT_FILE = "slate.json";
export const FOLDERS = ["scripts", "sprites", "maps", "music", "sounds"] as const;

const dec = new TextDecoder();

export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64.slice(b64.indexOf(",") + 1));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Width and height from a PNG header. */
export function pngSize(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [v.getUint32(16), v.getUint32(20)];
}

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
export const extOf = (path: string) => path.slice(path.lastIndexOf(".") + 1).toLowerCase();
export const text = (bytes: Uint8Array) => dec.decode(bytes);

/** Build a runnable cartridge from project files (path -> bytes, "/" separated, relative to the project). */
export function packProject(files: Map<string, Uint8Array>): Cartridge {
  const settingsFile = files.get(PROJECT_FILE);
  if (!settingsFile) throw new Error(`${PROJECT_FILE} not found`);
  const settings = JSON.parse(text(settingsFile)) as ProjectSettings;
  const cart: Cartridge = {
    slate: 1,
    name: settings.name,
    resolution: settings.resolution,
    background: settings.background,
    sprites: [],
    maps: [],
    code: "",
    lang: "luau",
    scripts: {},
    main: settings.main ?? "scripts/main.luau",
    music: {},
    sounds: {},
    folders: {},
  };
  if (settings.title) cart.title = settings.title;
  if (settings.fullscreen) cart.fullscreen = true;
  if (settings.palette?.length) cart.palette = settings.palette;
  if (settings.particles && Object.keys(settings.particles).length) cart.particles = settings.particles;
  if (settings.templates && Object.keys(settings.templates).length) cart.templates = settings.templates;
  const folderOf = (kind: string, name: string, path: string) => {
    const dir = path.slice(0, path.lastIndexOf("/"));
    if (dir !== kind) cart.folders![`${kind}:${name}`] = dir;
  };
  const paths = [...files.keys()].sort();
  const seen = new Map<string, string>();
  const unique = (kind: string, name: string, path: string) => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) throw new Error(`two ${kind} named "${name}": ${seen.get(key)} and ${path}`);
    seen.set(key, path);
  };
  for (const path of paths) {
    const bytes = files.get(path)!;
    const [top] = path.split("/");
    const ext = extOf(path);
    if (top === "scripts" && (ext === "luau" || ext === "lua")) {
      cart.scripts![path] = text(bytes);
    } else if (top === "sprites" && ext === "png" && !path.endsWith(".layers.png")) {
      const name = baseName(path);
      unique("sprites", name, path);
      folderOf("sprites", name, path);
      const metaFile = files.get(path.replace(/\.png$/i, ".json"));
      const meta: SpriteMeta = metaFile ? JSON.parse(text(metaFile)) : {};
      const [iw, ih] = pngSize(bytes);
      const def: SpriteDef = {
        name, w: meta.w ?? iw, h: meta.h ?? ih, fps: meta.fps ?? 8, frames: [],
        sheet: `data:image/png;base64,${base64(bytes)}`,
      };
      if (meta.count) def.count = meta.count;
      if (meta.durations?.some((d) => d > 0)) def.durations = meta.durations;
      if (meta.tags?.length) def.tags = meta.tags;
      if (meta.flags?.some((f) => f)) def.flags = meta.flags;
      if (meta.box) def.box = meta.box;
      if (meta.autotiles?.length) def.autotiles = meta.autotiles;
      if (meta.tileAnims?.length) def.tileAnims = meta.tileAnims;
      cart.sprites.push(def);
    } else if (top === "maps" && ext === "json") {
      const name = baseName(path);
      unique("maps", name, path);
      folderOf("maps", name, path);
      cart.maps!.push({ ...(JSON.parse(text(bytes)) as TileMap), name });
    } else if ((top === "music" || top === "sounds") && (ext === "ogg" || ext === "wav")) {
      const name = baseName(path);
      unique(top, name, path);
      folderOf(top, name, path);
      (top === "music" ? cart.music! : cart.sounds!)[name] = `data:audio/${ext === "wav" ? "wav" : "ogg"};base64,${base64(bytes)}`;
    }
  }
  if (!cart.scripts![cart.main!]) throw new Error(`main script "${cart.main}" not found`);
  cart.maps = resolveTemplates(cart.maps, cart.templates);
  return cart;
}

/** Which files make up a project (everything else in the folder is left alone). */
export function isProjectPath(path: string) {
  return path === PROJECT_FILE || (FOLDERS as readonly string[]).includes(path.split("/")[0]);
}
