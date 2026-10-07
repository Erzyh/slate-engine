// Build a signed release of the desktop app and the update manifest the installed apps read.
//   node tools/release.mjs [notes-file]
// -> packages/desktop/src-tauri/target/release/bundle/nsis/Slate_<version>_x64-setup.exe (+ .sig)
// -> updater/latest.json   (commit + push it AFTER the GitHub release with the installer is published:
//                           installed apps fetch it from the main branch and then download the installer)
//
// The update signing key lives outside the repo: ~/.tauri/slate-updater.key (or TAURI_SIGNING_PRIVATE_KEY).
// Its public half is in tauri.conf.json. Without the private key no update can be published, so back it up.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const conf = JSON.parse(fs.readFileSync(path.join(root, "packages/desktop/src-tauri/tauri.conf.json"), "utf8"));
const version = conf.version;
const keyFile = path.join(os.homedir(), ".tauri", "slate-updater.key");
const env = { ...process.env };
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!fs.existsSync(keyFile)) throw new Error(`no signing key: ${keyFile} (or set TAURI_SIGNING_PRIVATE_KEY)`);
  env.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(keyFile, "utf8");
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

if (!process.argv.includes("--no-build")) execSync("npm run desktop:build", { cwd: root, env, stdio: "inherit" });

const nsis = path.join(root, "packages/desktop/src-tauri/target/release/bundle/nsis");
const exe = `Slate_${version}_x64-setup.exe`;
const sig = fs.readFileSync(path.join(nsis, `${exe}.sig`), "utf8").trim();
const notesFile = process.argv.slice(2).find((a) => !a.startsWith("--"));
const notes = notesFile ? fs.readFileSync(notesFile, "utf8") : `Slate ${version}`;
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": { signature: sig, url: `https://github.com/Erzyh/slate-engine/releases/download/v${version}/${exe}` },
  },
};
fs.mkdirSync(path.join(root, "updater"), { recursive: true });
fs.writeFileSync(path.join(root, "updater/latest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`built ${exe} and updater/latest.json (v${version})`);
console.log(`next: gh release create v${version} "${path.join(nsis, exe)}"  then commit + push updater/latest.json`);
