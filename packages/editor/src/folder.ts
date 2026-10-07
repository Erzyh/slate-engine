// Where a project lives on disk. Desktop: a folder path via the Slate app. Browser (Chromium):
// a folder handle via the File System Access API. Saving writes only files that changed.

import { base64, fromBase64 } from "@slate/runtime";
import { isTauri } from "./native.ts";

export interface ProjectFolder {
  /** shown in the title bar */
  label: string;
  read(): Promise<{ files: Map<string, Uint8Array>; dirs: string[] }>;
  write(files: Map<string, Uint8Array>, remove: string[], dirs: string[]): Promise<void>;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

function desktopFolder(dir: string): ProjectFolder {
  return {
    label: dir,
    async read() {
      const r = await invoke<{ files: { path: string; b64: string }[]; dirs: string[] }>("project_read", { dir });
      return { files: new Map(r.files.map((f) => [f.path, fromBase64(f.b64)])), dirs: r.dirs };
    },
    async write(files, remove, dirs) {
      await invoke("project_write", {
        dir,
        files: [...files].map(([path, bytes]) => ({ path, b64: base64(bytes) })),
        remove,
        dirs,
      });
    },
  };
}

// ------------------------------------------------------------------ browser (File System Access API)

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

const TOP = new Set(["slate.json", "scripts", "sprites", "maps", "music", "sounds"]);

function browserFolder(root: DirHandle): ProjectFolder {
  const dirOf = async (path: string, create: boolean) => {
    let d: FileSystemDirectoryHandle = root;
    for (const part of path.split("/").slice(0, -1)) d = await d.getDirectoryHandle(part, { create });
    return d;
  };
  return {
    label: root.name,
    async read() {
      const files = new Map<string, Uint8Array>(), dirs: string[] = [];
      const walk = async (d: DirHandle, rel: string) => {
        for await (const h of d.values()) {
          const p = rel ? `${rel}/${h.name}` : h.name;
          if (!rel && !TOP.has(h.name)) continue;
          if (h.kind === "directory") {
            dirs.push(p);
            await walk(h as DirHandle, p);
          } else {
            files.set(p, new Uint8Array(await (await (h as FileSystemFileHandle).getFile()).arrayBuffer()));
          }
        }
      };
      await walk(root, "");
      return { files, dirs };
    },
    async write(files, remove, dirs) {
      for (const d of dirs) await dirOf(d + "/x", true);
      for (const [path, bytes] of files) {
        const fh = await (await dirOf(path, true)).getFileHandle(path.slice(path.lastIndexOf("/") + 1), { create: true });
        const w = await fh.createWritable();
        await w.write(bytes as BlobPart);
        await w.close();
      }
      for (const path of remove) {
        try {
          await (await dirOf(path, false)).removeEntry(path.slice(path.lastIndexOf("/") + 1));
        } catch {
          // already gone
        }
      }
    },
  };
}

/** Reopen a desktop project folder by path (the last one used). */
export async function openFolderPath(dir: string): Promise<ProjectFolder | null> {
  if (!isTauri) return null;
  return (await invoke<string>("project_probe", { dir })) === "project" ? desktopFolder(dir) : null;
}

export const canUseFolders = () => isTauri || "showDirectoryPicker" in window;

/** Ask for a folder. mode "open" needs a slate.json in it; "save" wants a new or empty folder. */
export async function pickFolder(mode: "open" | "save"): Promise<ProjectFolder | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: mode === "open" ? "Open a Slate project folder" : "Choose a folder for the project" });
    if (!dir || Array.isArray(dir)) return null;
    const kind = await invoke<string>("project_probe", { dir });
    if (mode === "open" && kind !== "project") throw new Error("That folder has no slate.json - pick a Slate project folder");
    if (mode === "save" && kind === "other" && !confirm(`"${dir}" is not empty. Save the project into it anyway?\n(Only slate.json and the scripts/ sprites/ maps/ music/ sounds/ folders are written.)`)) return null;
    return desktopFolder(dir);
  }
  if ("showDirectoryPicker" in window) {
    try {
      const h = await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({ mode: "readwrite" });
      if (mode === "open") {
        try {
          await h.getFileHandle("slate.json");
        } catch {
          throw new Error("That folder has no slate.json - pick a Slate project folder");
        }
      }
      return browserFolder(h);
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      throw e;
    }
  }
  throw new Error("Project folders need the Slate desktop app (or Chrome / Edge)");
}

/** Cheap content fingerprint, to save only files that changed. */
export function fingerprint(bytes: Uint8Array) {
  let h = 2166136261 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619);
  return `${bytes.length}:${h >>> 0}`;
}
