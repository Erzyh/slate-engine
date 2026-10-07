// File I/O that works both in the Tauri desktop shell and in a plain browser.

import { playerHtml, type Cartridge } from "@slate/runtime";
import playerJs from "../../runtime/dist/slate-runtime.iife.js?raw";

const isTauri = "__TAURI_INTERNALS__" in window;

/** Save dialog (desktop) or download (browser). Returns the path/name, or null if cancelled. */
export async function saveFile(defaultName: string, data: string | Uint8Array, ext: string, label: string) {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile, writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] });
    if (!path) return null;
    if (typeof data === "string") await writeTextFile(path, data);
    else await writeFile(path, data);
    return path;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: "application/octet-stream" }));
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return defaultName;
}

export const saveText = (name: string, text: string, ext: string, label: string) => saveFile(name, text, ext, label);
export const saveBinary = (name: string, bytes: Uint8Array, ext: string, label: string) => saveFile(name, bytes, ext, label);

export function saveCart(cart: Cartridge) {
  return saveText(`${cart.name}.slate`, JSON.stringify(cart), "slate", "Slate cartridge");
}

export function exportHtml(cart: Cartridge) {
  return saveText(`${cart.name}.html`, playerHtml(playerJs, cart), "html", "HTML");
}

export function pickCartFile(input: HTMLInputElement): Promise<Cartridge | null> {
  return new Promise((resolve) => {
    input.onchange = async () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return resolve(null);
      resolve(JSON.parse(await f.text()) as Cartridge);
    };
    input.click();
  });
}
