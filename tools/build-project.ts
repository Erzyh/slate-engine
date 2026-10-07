// Build a Slate project folder (slate.json + scripts/ sprites/ maps/ music/ sounds/):
//   build/<name>.slate   the packed cartridge (what the editor's Examples and the player load)
//   build/<Title>.exe    with --exe: a standalone Windows game (player + cartridge)
//   build/web/ + build/<Title>-web.zip   with --web: a browser build (upload the zip to itch.io as HTML)
// Used by `npm run cart -- <folder> [--exe] [--web]` when the folder has a slate.json.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { isProjectPath, packProject, type ProjectSettings } from "../packages/runtime/src/project.ts";

/** Every project file under dir, as "/"-separated relative paths. */
export function readProjectFiles(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (!isProjectPath(p)) continue;
      if (e.isDirectory()) walk(p);
      else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk("");
  return files;
}

export function writeExe(cartJson: string, exePath: string) {
  const player = path.resolve(import.meta.dirname, "../native/target/release/slate-player.exe");
  if (!fs.existsSync(player)) throw new Error("build the player first: npm run native:build");
  const json = Buffer.from(cartJson);
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(json.length));
  fs.mkdirSync(path.dirname(exePath), { recursive: true });
  fs.writeFileSync(exePath, Buffer.concat([fs.readFileSync(player), json, len, Buffer.from("SLATECRT")]));
}

/** A .zip of name -> bytes (deflated), enough for itch.io uploads. */
export function zip(files: [string, Uint8Array][]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // utf-8 names
    head.writeUInt16LE(8, 8); // deflate
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/** The web player's files (page, loader, wasm) plus the game. */
export function webFiles(cartJson: string): [string, Uint8Array][] {
  const root = path.resolve(import.meta.dirname, "..");
  const wasm = path.join(root, "native/target/wasm32-wasip1/release/slate-player.wasm");
  if (!fs.existsSync(wasm)) throw new Error("build the web player first: npm run web:build");
  const web = (f: string) => new Uint8Array(fs.readFileSync(path.join(root, "native/web", f)));
  return [
    ["index.html", web("index.html")],
    ["mq_js_bundle.js", web("mq_js_bundle.js")],
    ["slate.js", web("slate.js")],
    ["slate-player.wasm", new Uint8Array(fs.readFileSync(wasm))],
    ["game.slate", new Uint8Array(Buffer.from(cartJson))],
    ["licenses.txt", new Uint8Array(Buffer.from(webLicenses(root)))],
  ];
}

/** Slate's MIT license, third-party notices and the bundled fonts' OFL, as one text. */
function webLicenses(root: string) {
  const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
  const fonts = ["A", "B", "GL"].map((n) => read(`native/player/fonts/LICENSE-ERXPIXEL_${n}.txt`));
  return ["Slate player", read("LICENSE"), read("native/player/THIRD_PARTY.txt"), "ERXPIXEL fonts", ...fonts].join("\n\n");
}

export function buildProject(dir: string, flags: string[]) {
  const files = readProjectFiles(dir);
  const cart = packProject(files);
  const settings = JSON.parse(new TextDecoder().decode(files.get("slate.json"))) as ProjectSettings;
  const json = JSON.stringify(cart);
  const out = path.join(dir, "build", `${settings.name}.slate`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  const n = (o?: object) => Object.keys(o ?? {}).length;
  console.log(`wrote ${out} (${(json.length / 1024).toFixed(0)} KB · ${n(cart.scripts)} scripts, ${cart.sprites.length} sprites, ${cart.maps?.length ?? 0} maps, ${n(cart.music)} music, ${n(cart.sounds)} sounds)`);
  if (flags.includes("--exe")) {
    const exe = path.join(dir, "build", `${settings.title ?? settings.name}.exe`);
    writeExe(json, exe);
    console.log(`wrote ${exe} (${(fs.statSync(exe).size / 1024 / 1024).toFixed(2)} MB)`);
  }
  if (flags.includes("--web")) {
    const files = webFiles(json);
    const webDir = path.join(dir, "build", "web");
    fs.mkdirSync(webDir, { recursive: true });
    for (const [name, data] of files) fs.writeFileSync(path.join(webDir, name), data);
    const out = path.join(dir, "build", `${settings.title ?? settings.name}-web.zip`);
    fs.writeFileSync(out, zip(files));
    console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB) - upload to itch.io as an HTML game; or open build/web/ with any web server`);
  }
}
