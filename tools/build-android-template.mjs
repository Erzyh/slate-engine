// Build the Android shell (packages/desktop/android) into the APK template the editor exports
// Android games from: packages/desktop/src-tauri/android/template.apk (committed; users need no SDK).
// Needs the Android SDK (build-tools + platforms/android-35; ANDROID_HOME or the default location)
// and a JDK (javac, jar).  Run: node tools/build-android-template.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "packages/desktop/android");
const out = path.join(root, "packages/desktop/src-tauri/android/template.apk");
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "Library/Android"), "Android/Sdk");
const win = process.platform === "win32";
const newest = (dir, filter = () => true) => fs.readdirSync(dir).filter(filter).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const tools = path.join(sdk, "build-tools", newest(path.join(sdk, "build-tools"), (d) => !d.startsWith("37")));
const platform = path.join(sdk, "platforms", "android-35", "android.jar");

// d8 needs JAVA_HOME; when it's missing or stale, use the JDK that javac on PATH belongs to
const env = { ...process.env };
if (!env.JAVA_HOME || !fs.existsSync(env.JAVA_HOME)) {
  const found = execFileSync(win ? "where" : "which", ["javac"]).toString();
  const javac = found.split("\n")[0].trim();
  env.JAVA_HOME = path.dirname(path.dirname(fs.realpathSync(javac)));
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: win && cmd.endsWith(".bat"), env });

const work = fs.mkdtempSync(path.join(os.tmpdir(), "slate-android-"));
console.log(`build-tools ${path.basename(tools)}, platform android-35, work ${work}`);

// the app icon
const icon = path.join(src, "res/mipmap-xxxhdpi/ic_launcher.png");
fs.mkdirSync(path.dirname(icon), { recursive: true });
fs.copyFileSync(path.join(root, "packages/desktop/src-tauri/icons/128x128@2x.png"), icon);

// resources + manifest
const aapt2 = path.join(tools, `aapt2${win ? ".exe" : ""}`);
run(aapt2, ["compile", "--dir", path.join(src, "res"), "-o", path.join(work, "res.zip")]);
const base = path.join(work, "base.apk");
run(aapt2, [
  "link", "-o", base, "-I", platform, "--manifest", path.join(src, "AndroidManifest.xml"), path.join(work, "res.zip"),
  "--min-sdk-version", "24", "--target-sdk-version", "35", "--version-code", "1", "--version-name", "1.0",
]);

// code
const classes = path.join(work, "classes");
run("javac", ["--release", "11", "-nowarn", "-cp", platform, "-d", classes, path.join(src, "src/dev/slate/player/MainActivity.java")]);
const dexOut = path.join(work, "dex");
fs.mkdirSync(dexOut);
const pkg = path.join(classes, "dev/slate/player");
const classFiles = fs.readdirSync(pkg).map((f) => path.join(pkg, f));
run(path.join(tools, `d8${win ? ".bat" : ""}`), ["--release", "--min-api", "24", "--lib", platform, "--output", dexOut, ...classFiles]);
run("jar", ["uf", base, "-C", dexOut, "classes.dex"]);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(base, out);
console.log(`wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
fs.rmSync(work, { recursive: true, force: true });
