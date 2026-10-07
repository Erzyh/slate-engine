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
  /** Editor-only: layered source (frames above are the flattened result the game draws). */
  layers?: { name: string; visible: boolean; opacity: number; cels: string[]; locked?: boolean; alphaLock?: boolean }[];
}

export interface MapLayer {
  name: string;
  visible?: boolean;
  /** Row-major tile indices (frames of the tileset sprite); -1 = empty. */
  data: number[];
}

/** Something placed on a map in the editor (enemy, item, spawn point...). x, y = bottom-center in pixels. */
export interface MapObject {
  id: number;
  type: string;
  sprite?: string;
  x: number;
  y: number;
  props?: Record<string, string | number | boolean>;
}

/** A tile map: a grid of frames from a tileset sprite (one frame = one tile), plus placed objects. */
export interface TileMap {
  name: string;
  tileset: string;
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
  /** music tracks: name -> data URL (OGG Vorbis or WAV), played with music(name) */
  music?: Record<string, string>;
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
