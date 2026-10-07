// Grid Stamp CLI
// npx tsx packages/pixelize/src/cli.ts in.png out.png [--pitch auto|N] [--colors 16] [--max N] [--cover WxH]
//   [--smooth 0-3] [--despeckle N]
//   [--bg auto|alpha|none|#rrggbb] [--no-elastic] [--no-cleanup] [--no-trim] [--debug]
// --debug also writes out_view.png (x4) and out_grid.png (detected grid over the source).
import fs from "node:fs";
import { PNG } from "pngjs";
import { gridStamp, type RGBAImage, type StampOptions } from "./gridstamp.ts";

export function readPng(file: string): RGBAImage {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

export function writePng(file: string, img: RGBAImage) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  fs.writeFileSync(file, PNG.sync.write(png));
}

function scale(img: RGBAImage, s: number): RGBAImage {
  const w = img.width * s, h = img.height * s;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (((y / s) | 0) * img.width + ((x / s) | 0)) * 4;
      out.set(img.data.subarray(si, si + 4), (y * w + x) * 4);
    }
  return { width: w, height: h, data: out };
}

function gridOverlay(img: RGBAImage, xs: number[], ys: number[]): RGBAImage {
  const out = new Uint8ClampedArray(img.data);
  const mark = (x: number, y: number) => {
    const o = (y * img.width + x) * 4;
    out[o] = 0; out[o + 1] = 255; out[o + 2] = 255; out[o + 3] = 255;
  };
  for (const x of xs) if (x < img.width) for (let y = 0; y < img.height; y++) mark(x, y);
  for (const y of ys) if (y < img.height) for (let x = 0; x < img.width; x++) mark(x, y);
  return { width: img.width, height: img.height, data: out };
}

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const opt: StampOptions = {};
  let debug = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--pitch") { const v = next(); opt.pitch = v === "auto" ? "auto" : Number(v); }
    else if (a === "--colors") opt.colors = Number(next());
    else if (a === "--max") opt.maxSize = Number(next());
    else if (a === "--cover") { const [w, h] = next().split("x").map(Number); opt.cover = [w, h]; }
    else if (a === "--smooth") opt.smooth = Number(next());
    else if (a === "--sharpen") opt.sharpen = Number(next());
    else if (a === "--tile") opt.tile = Number(next());
    else if (a === "--variant") opt.tileVariant = Number(next());
    else if (a === "--despeckle") opt.despeckle = Number(next());
    else if (a === "--bg") {
      const v = next();
      opt.background = v.startsWith("#")
        ? [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]
        : (v as StampOptions["background"]);
    }
    else if (a === "--tol") opt.bgTolerance = Number(next());
    else if (a === "--no-elastic") opt.elastic = false;
    else if (a === "--no-cleanup") opt.cleanup = false;
    else if (a === "--no-trim") opt.trim = false;
    else if (a === "--debug") debug = true;
    else pos.push(a);
  }
  return { pos, opt, debug };
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("pixelize/src/cli.ts");
if (isMain) {
  const { pos, opt, debug } = parseArgs(process.argv.slice(2));
  if (pos.length < 2) {
    console.error("usage: cli.ts in.png out.png [--pitch auto|N] [--colors 16] [--max N] [--bg auto|alpha|none|#rrggbb] [--debug]");
    process.exit(1);
  }
  const [inFile, outFile] = pos;
  const src = readPng(inFile);
  const t0 = performance.now();
  const r = gridStamp(src, opt);
  const ms = performance.now() - t0;
  writePng(outFile, r.image);
  if (debug) {
    writePng(outFile.replace(/\.png$/, "_view.png"), scale(r.image, 4));
    writePng(outFile.replace(/\.png$/, "_grid.png"), gridOverlay(src, r.xCuts, r.yCuts));
  }
  console.log(
    `${inFile} -> ${r.image.width}x${r.image.height}  pitch ${r.pitch.toFixed(2)}  ` +
      `confidence ${r.confidence.toFixed(2)}  colors ${r.palette.length}  ` +
      `bg ${r.background ? "#" + r.background.map((c) => c.toString(16).padStart(2, "0")).join("") : "-"}  ${ms.toFixed(0)}ms`,
  );
}
