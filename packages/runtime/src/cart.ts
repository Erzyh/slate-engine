// The .slate cartridge: one JSON file holding sprites, code and settings.

export interface SpriteDef {
  name: string;
  w: number;
  h: number;
  /** PNG data URLs, one per animation frame (or empty when `sheet` is used). */
  frames: string[];
  /** One PNG holding all frames (w x h each, left to right then top to bottom) - project folders use this. */
  sheet?: string;
  /** Number of frames in `sheet` (default: every cell). */
  count?: number;
  /** Per-frame duration in milliseconds (0 = use fps), like Aseprite. */
  durations?: number[];
  /** Animation speed when drawn with `anim`. */
  fps?: number;
  /** Named frame ranges: spr("hero", x, y, { anim: "walk" }). */
  tags?: { name: string; from: number; to: number; dir: "forward" | "reverse" | "pingpong" }[];
  /** Per-frame bit flags, used when the sprite is a tileset (bit 0 = solid). */
  flags?: number[];
  /** Hitbox [x, y, w, h] from the sprite's top-left: hitbox(name, x, y) in game code. */
  box?: [number, number, number, number];
  /** Editor-only: autotile terrains, 16 frames each (4x4 block order). */
  autotiles?: number[][];
  /** Animated tiles: these frames cycle wherever any of them is placed on a map. */
  tileAnims?: { frames: number[]; fps: number }[];
  /** Editor-only: layered source (frames above are the flattened result the game draws). */
  layers?: { name: string; visible: boolean; opacity: number; cels: string[]; locked?: boolean; alphaLock?: boolean }[];
}

export interface MapLayer {
  name: string;
  visible?: boolean;
  /** Row-major tile values; -1 = empty. value = tileset index * TILE_STRIDE + frame. */
  data: number[];
  /** Scroll speed relative to the camera (background scenery; such layers never collide). */
  parallax?: [number, number];
  /** Repeat sideways forever. */
  repeatX?: boolean;
}

/** Something placed on a map in the editor (enemy, item, spawn point...). x, y = bottom-center in pixels. */
export interface MapObject {
  id: number;
  type: string;
  sprite?: string;
  x: number;
  y: number;
  props?: Record<string, string | number | boolean>;
  /** made from an object template: its type, sprite and props come from there (props here add to / override them) */
  template?: string;
}

/** An object template (prefab): defined once, placed on any map, edited in one place. */
export interface ObjectTemplate {
  type: string;
  sprite?: string;
  props?: Record<string, string | number | boolean>;
}

/** Objects with what their templates give them (what the game sees). */
export function resolveObject(o: MapObject, templates: Record<string, ObjectTemplate> | undefined): MapObject {
  const t = o.template ? templates?.[o.template] : undefined;
  if (!t) return o;
  const props = { ...(t.props ?? {}), ...(o.props ?? {}) };
  const out: MapObject = { ...o, type: t.type };
  if (t.sprite) out.sprite = t.sprite;
  else delete out.sprite;
  if (Object.keys(props).length) out.props = props;
  else delete out.props;
  return out;
}

/** A copy of the maps with every template instance filled in. */
export function resolveTemplates(maps: TileMap[] | undefined, templates: Record<string, ObjectTemplate> | undefined): TileMap[] | undefined {
  if (!maps || !templates || !Object.keys(templates).length) return maps;
  return maps.map((m) => (m.objects?.some((o) => o.template) ? { ...m, objects: m.objects.map((o) => resolveObject(o, templates)) } : m));
}

/** Tile values pack the tileset: value = index in `tilesets` * TILE_STRIDE + frame. */
export const TILE_STRIDE = 4096;

/** A tile map: a grid of frames from tileset sprites (one frame = one tile), plus placed objects. */
export interface TileMap {
  name: string;
  /** the first tileset (it sets the tile size) */
  tileset: string;
  /** every tileset the map uses, in tile-value order (missing = just `tileset`) */
  tilesets?: string[];
  w: number;
  h: number;
  layers: MapLayer[];
  objects?: MapObject[];
}

export interface Cartridge {
  slate: 1;
  name: string;
  resolution: [number, number];
  background?: string;
  sprites: SpriteDef[];
  maps?: TileMap[];
  /** Single-file code (older cartridges). Projects use `scripts` + `main`. */
  code: string;
  /** Project scripts: path ("scripts/player.luau") -> source; loaded with require("player"). */
  scripts?: Record<string, string>;
  /** The script that runs first (default "scripts/main.luau"). */
  main?: string;
  /** Window title of exported games. */
  title?: string;
  /** Sound effects: name -> data URL (WAV / OGG), played with sfx(name). */
  sounds?: Record<string, string>;
  /** Editor info: sub-folders of files ("sprites:jelly_p1" -> "sprites/trailer"); the player ignores it. */
  folders?: Record<string, string>;
  /** "luau" runs on the native player; "js" (or missing) is the legacy web runtime. */
  lang?: "luau" | "js";
  /** the first language for tr() (slate.json "language") */
  language?: string;
  /** false: no on-screen d-pad / buttons on phones */
  touchControls?: boolean;
  /** "pixel" (default), "fit", "expand" */
  scale?: "pixel" | "fit" | "expand";
  /** music tracks: name -> data URL (OGG Vorbis or WAV), played with music(name) */
  music?: Record<string, string>;
  /** start in fullscreen (F11 / Alt+Enter toggle it) */
  fullscreen?: boolean;
  /** the project's own palette colors (editor only) */
  palette?: string[];
  /** editor "Play from here": where the game should start (playtest() in game code) */
  playtest?: { map: string; x: number; y: number };
  /** particle presets: fx:burst(x, y, "name") */
  particles?: Record<string, ParticlePreset>;
  /** object templates (editor; instances are resolved before the game sees them) */
  templates?: Record<string, ObjectTemplate>;
  /** UI screens made in the UI tab (HUDs, menus): drawn with UI.screen(name) */
  screens?: Record<string, { elements: Record<string, unknown>[]; preview?: Record<string, string | number | boolean> }>;
}

/** Particle burst options (angles in radians), as Particles:burst takes them. */
export interface ParticlePreset {
  count?: number;
  colors?: string[];
  speed?: number;
  angle?: number;
  spread?: number;
  life?: number;
  gravity?: number;
  drag?: number;
  size?: number;
  shrink?: boolean;
  add?: boolean;
  radius?: number;
  rate?: number;
}

export function emptyCartridge(name = "untitled"): Cartridge {
  return {
    slate: 1,
    name,
    resolution: [320, 180],
    sprites: [],
    lang: "luau",
    code: [
      "local x = 160",
      "",
      "function update(dt)",
      '  if key("left") then x -= 2 end',
      '  if key("right") then x += 2 end',
      "end",
      "",
      "function draw()",
      '  cls("#1d1b2a")',
      '  text("HELLO SLATE", x, 90, "#ffcc66", { align = "center" })',
      "end",
      "",
    ].join("\n"),
  };
}

export async function decodeFrame(dataUrl: string): Promise<ImageData> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}

export function encodeFrame(img: ImageData): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
