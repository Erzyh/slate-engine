// Pack a game folder into a .slate cartridge.
// npm run cart -- games/jelly [--exe]
//
// Folders with a slate.json are Slate projects (see packages/runtime/src/project.ts) and are packed
// by build-project.ts. Older folders with a game.json use the stamping pipeline in this file:
// game.json lists sprites. A sprite with "src" is stamped from a raw (AI) image with Grid Stamp
// into sprites/<name>.png the first time (or with --restamp). After that the PNG in sprites/
// is the source of truth, so hand edits are kept.
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { gridStamp, type StampOptions } from "../packages/pixelize/src/gridstamp.ts";
import { readPng, writePng } from "../packages/pixelize/src/cli.ts";
import { playerHtml } from "../packages/runtime/src/export.ts";

interface SpriteSpec extends StampOptions {
  src?: string;
  fps?: number;
  /** Tilesets: several stamped sources become the frames of one sprite (all the same size). */
  frames?: (StampOptions & { src: string })[];
  flags?: number[];
  /** Split the stamped image into a cols×rows grid of frames (VFX / animation sheets). */
  sheet?: [number, number];
  /** Split the stamped image into vertical slices this many pixels wide (edge strips). */
  slice?: number;
  tags?: { name: string; from: number; to: number; dir: string }[];
}

type Img = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

function cropImg(img: Img, x0: number, y0: number, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}

function pngDataUrl(img: Img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  return `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
}

const [dir, ...flags] = process.argv.slice(2);
if (!dir) {
  console.error("usage: npm run cart -- <game dir> [--restamp]");
  process.exit(1);
}
// project folders (slate.json) are packed as they are; game.json folders use the stamping pipeline below
if (fs.existsSync(path.join(dir, "slate.json"))) {
  const { buildProject } = await import("./build-project.ts");
  buildProject(dir, flags);
  process.exit(0);
}
const restamp = flags.includes("--restamp");
const game = JSON.parse(fs.readFileSync(path.join(dir, "game.json"), "utf8"));
const spriteDir = path.join(dir, "sprites");
fs.mkdirSync(spriteDir, { recursive: true });

const sprites = [];
for (const [name, spec] of Object.entries(game.sprites as Record<string, SpriteSpec>)) {
  const file = path.join(spriteDir, `${name}.png`);
  if (spec.frames) {
    // one PNG per frame: sprites/<name>_<i>.png
    const frames: string[] = [];
    spec.frames.forEach((f, i) => {
      const ff = path.join(spriteDir, `${name}_${i}.png`);
      if (restamp || !fs.existsSync(ff)) {
        const { src, ...opt } = f;
        const r = gridStamp(readPng(path.join(dir, src)), opt);
        writePng(ff, r.image);
        console.log(`stamp ${`${name}[${i}]`.padEnd(12)} ${r.image.width}x${r.image.height}  pitch ${r.pitch.toFixed(2)}`);
      }
      frames.push(`data:image/png;base64,${fs.readFileSync(ff).toString("base64")}`);
    });
    const first = PNG.sync.read(fs.readFileSync(path.join(spriteDir, `${name}_0.png`)));
    sprites.push({ name, w: first.width, h: first.height, fps: spec.fps ?? 8, frames, flags: spec.flags });
    continue;
  }
  if (spec.src && (restamp || !fs.existsSync(file))) {
    const { src, fps, sheet: _sheet, slice: _slice, tags: _tags, ...opt } = spec;
    const r = gridStamp(readPng(path.join(dir, src)), opt);
    writePng(file, r.image);
    console.log(`stamp ${name.padEnd(10)} ${r.image.width}x${r.image.height}  pitch ${r.pitch.toFixed(2)}  colors ${r.palette.length}`);
  }
  if (spec.sheet || spec.slice) {
    const img = readPng(file);
    const cells: Img[] = [];
    if (spec.sheet) {
      const [cols, rows] = spec.sheet;
      const fw = Math.floor(img.width / cols), fh = Math.floor(img.height / rows);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push(cropImg(img, c * fw, r * fh, fw, fh));
    } else {
      const fw = spec.slice!;
      for (let x = 0; x + fw <= img.width; x += fw) cells.push(cropImg(img, x, 0, fw, img.height));
    }
    sprites.push({ name, w: cells[0].width, h: cells[0].height, fps: spec.fps ?? 12, frames: cells.map(pngDataUrl), tags: spec.tags });
    continue;
  }
  const buf = fs.readFileSync(file);
  const png = PNG.sync.read(buf);
  sprites.push({
    name,
    w: png.width,
    h: png.height,
    fps: spec.fps ?? 8,
    frames: [`data:image/png;base64,${buf.toString("base64")}`],
  });
}

const cart = {
  slate: 1,
  name: game.name,
  resolution: game.resolution,
  background: game.background,
  sprites,
  maps: fs.existsSync(path.join(dir, "maps.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "maps.json"), "utf8")) : [],
  // code may be split over several files; they are concatenated in order
  code: ([] as string[]).concat(game.code).map((f) => `-- ${f}\n${fs.readFileSync(path.join(dir, f), "utf8")}`).join("\n"),
  lang: String([].concat(game.code)[0]).endsWith(".luau") ? "luau" : "js",
  // "music": { "name": "music/file.ogg" } -> embedded data URLs (OGG Vorbis or WAV)
  music: Object.fromEntries(
    Object.entries((game.music ?? {}) as Record<string, string>).map(([name, file]) => {
      const mime = file.endsWith(".wav") ? "audio/wav" : "audio/ogg";
      return [name, `data:${mime};base64,${fs.readFileSync(path.join(dir, file)).toString("base64")}`];
    }),
  ),
};
const out = path.join(dir, `${game.name}.slate`);
fs.writeFileSync(out, JSON.stringify(cart));
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${sprites.length} sprites, ${Object.keys(cart.music).length} music)`);

if (flags.includes("--html")) {
  const player = path.resolve(import.meta.dirname, "../packages/runtime/dist/slate-runtime.iife.js");
  if (!fs.existsSync(player)) throw new Error("build the runtime first: npm run build:runtime");
  const html = path.join(dir, `${game.name}.html`);
  fs.writeFileSync(html, playerHtml(fs.readFileSync(player, "utf8"), cart as never));
  console.log(`wrote ${html} (${(fs.statSync(html).size / 1024).toFixed(0)} KB)`);
}

// Native executable: the prebuilt player with the cartridge appended.
// Layout: [player exe][cartridge json][u64 length LE]["SLATECRT"]
if (flags.includes("--exe")) {
  const player = path.resolve(import.meta.dirname, "../native/target/release/slate-player.exe");
  if (!fs.existsSync(player)) throw new Error("build the player first: cargo build --release (in native/)");
  const json = Buffer.from(JSON.stringify(cart));
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  const exe = path.join(dir, "build", `${game.title ?? game.name}.exe`);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, Buffer.concat([fs.readFileSync(player), json, len, Buffer.from("SLATECRT")]));
  console.log(`wrote ${exe} (${(fs.statSync(exe).size / 1024 / 1024).toFixed(2)} MB)`);
}
