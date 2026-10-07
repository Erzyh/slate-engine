// Build the web player: the same Rust/Luau player as the .exe, compiled to WebAssembly.
//   npm run web:build      -> native/target/wasm32-wasip1/release/slate-player.wasm
//   (then `npm run cart -- <folder> --web`, or Export > Web in the desktop app after desktop:build)
//
// Needs the wasm32-wasip1 Rust target (rustup target add wasm32-wasip1) and wasi-sdk 34+
// (https://github.com/WebAssembly/wasi-sdk/releases) for Luau's C++. Set WASI_SDK to its folder,
// or unpack it to ~/.slate-tools/wasi-sdk-*.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function findSdk() {
  if (process.env.WASI_SDK) return process.env.WASI_SDK;
  const dir = path.join(os.homedir(), ".slate-tools");
  const found = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith("wasi-sdk-") && !d.endsWith(".gz")).sort().pop() : null;
  if (!found) {
    console.error("wasi-sdk not found: set WASI_SDK, or unpack wasi-sdk to ~/.slate-tools/ (https://github.com/WebAssembly/wasi-sdk/releases)");
    // --optional (desktop:build): skip; the app is then built without Web export
    process.exit(process.argv.includes("--optional") ? 0 : 1);
  }
  return path.join(dir, found);
}

const sdk = findSdk().replaceAll("\\", "/");
const exe = process.platform === "win32" ? ".exe" : "";
const sysroot = `${sdk}/share/wasi-sysroot`;
// wasm exception handling carries Luau's C++ exceptions (script errors) across the Rust callbacks
const flags = `--sysroot=${sysroot} -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -include stdlib.h`;
const env = {
  ...process.env,
  CC_wasm32_wasip1: `${sdk}/bin/clang${exe}`,
  CXX_wasm32_wasip1: `${sdk}/bin/clang++${exe}`,
  AR_wasm32_wasip1: `${sdk}/bin/llvm-ar${exe}`,
  CXXSTDLIB_wasm32_wasip1: "c++",
  CFLAGS_wasm32_wasip1: flags,
  CXXFLAGS_wasm32_wasip1: flags,
  CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS: [
    `-C link-arg=-L${sysroot}/lib/wasm32-wasip1/eh`,
    "-C link-arg=-lc++abi",
    "-C link-arg=-lunwind",
    // slate.js runs the constructors and then main itself (_start would run the destructors right after)
    "-C link-arg=--export=__wasm_call_ctors",
  ].join(" "),
};
const root = path.resolve(import.meta.dirname, "..");
execFileSync("cargo", ["build", "--release", "-p", "slate-player", "--target", "wasm32-wasip1", "--manifest-path", path.join(root, "native/Cargo.toml")], {
  env,
  stdio: "inherit",
});
const wasm = path.join(root, "native/target/wasm32-wasip1/release/slate-player.wasm");
console.log(`built ${wasm} (${(fs.statSync(wasm).size / 1024 / 1024).toFixed(2)} MB)`);
