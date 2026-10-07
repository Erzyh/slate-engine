// Bridge to the native player (desktop app only). Luau cartridges run in their own native
// window; edits are pushed to it and hot-reloaded (pixels keep game state, code restarts it).

import type { Cartridge } from "@slate/runtime";

export const isTauri = "__TAURI_INTERNALS__" in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Start the game window, or hot-reload it if it's already open. Returns true if it was started. */
export function runNative(cart: Cartridge) {
  return invoke<boolean>("run_cart", { json: JSON.stringify(cart) });
}

/** Push edits to the running game. Returns false if no game window is open. */
export function updateNative(cart: Cartridge) {
  return invoke<boolean>("update_cart", { json: JSON.stringify(cart) });
}

export function stopNative() {
  return invoke<void>("stop_cart");
}

export function nativeRunning() {
  return isTauri ? invoke<boolean>("is_running") : Promise.resolve(false);
}

/** Save dialog + write a standalone .exe. Returns the path, or null if cancelled. */
export async function exportWindows(cart: Cartridge) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `${cart.name}.exe`, filters: [{ name: "Windows game", extensions: ["exe"] }] });
  if (!path) return null;
  const bytes = await invoke<number>("export_windows", { json: JSON.stringify(cart), path });
  return { path, bytes };
}

export async function exportWeb(cart: Cartridge) {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({ defaultPath: `${cart.name}-web.zip`, filters: [{ name: "Web game (zip)", extensions: ["zip"] }] });
  if (!path) return null;
  const bytes = await invoke<number>("export_web", { json: JSON.stringify(cart), path });
  return { path, bytes };
}

/** New log() output since `offset` and the game's current error (desktop only). */
export function playerOutput(offset: number) {
  return isTauri ? invoke<{ error: string; log: string; offset: number }>("player_output", { offset }).catch(() => null) : Promise.resolve(null);
}
