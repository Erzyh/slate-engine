// Project explorer (left sidebar): the project's folders and files as a tree.
// Click opens a file in its tab (script -> Code, sprite -> Pixel, map -> Map); right click (or the
// + button) has New / Import / Rename / Delete.

import { baseName, extOf } from "@slate/runtime";
import type { Project } from "./project.ts";

export interface ExplorerHooks {
  openScript(path: string): void;
  openSprite(name: string): void;
  openMap(name: string): void;
  newScript(folder: string): void;
  newSprite(folder: string): void;
  newMap(): void;
  newSound(folder: string): void;
  newMusic(folder: string): void;
  playAudio(path: string): void;
  newFolder(parent: string): void;
  importFiles(folder: string): void;
  rename(path: string): void;
  remove(path: string): void;
  removeFolder(folder: string): void;
  setMain(path: string): void;
}

export interface Selection {
  script?: string | null;
  sprite?: string | null;
  map?: string | null;
}

const CARET = '<span class="caret"><svg viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></svg></span>';

function thumb(img: ImageData) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

export class Explorer {
  collapsed = new Set<string>(["sprites/trailer"]);
  private menuEl: HTMLDivElement;

  constructor(private el: HTMLElement, private hooks: ExplorerHooks) {
    this.menuEl = document.createElement("div");
    this.menuEl.className = "ctx-menu hidden";
    document.body.appendChild(this.menuEl);
    window.addEventListener("pointerdown", (e) => {
      if (!this.menuEl.contains(e.target as Node)) this.hideMenu();
    });
    window.addEventListener("blur", () => this.hideMenu());
  }

  hideMenu() {
    this.menuEl.classList.add("hidden");
  }

  /** Open a context menu of [label, action] items at (x, y). */
  menu(x: number, y: number, items: ([string, () => void] | null)[]) {
    this.menuEl.innerHTML = "";
    for (const it of items) {
      if (!it) {
        this.menuEl.appendChild(Object.assign(document.createElement("div"), { className: "sep" }));
        continue;
      }
      const b = document.createElement("button");
      b.textContent = it[0];
      b.onclick = () => {
        this.hideMenu();
        it[1]();
      };
      this.menuEl.appendChild(b);
    }
    this.menuEl.classList.remove("hidden");
    const r = this.menuEl.getBoundingClientRect();
    this.menuEl.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
    this.menuEl.style.top = `${Math.min(y, innerHeight - r.height - 4)}px`;
  }

  /** Items for the + button / a folder's context menu. */
  folderItems(folder: string): ([string, () => void] | null)[] {
    const top = folder.split("/")[0];
    const h = this.hooks;
    const items: ([string, () => void] | null)[] = [];
    if (top === "scripts" || !folder) items.push(["New script", () => h.newScript(top === "scripts" ? folder : "scripts")]);
    if (top === "sprites" || !folder) items.push(["New sprite", () => h.newSprite(top === "sprites" ? folder : "sprites")]);
    if (top === "maps" || !folder) items.push(["New map", () => h.newMap()]);
    if (top === "sounds" || !folder) items.push(["New sound effect", () => h.newSound(top === "sounds" ? folder : "sounds")]);
    if (top === "music" || !folder) items.push(["New music", () => h.newMusic(top === "music" ? folder : "music")]);
    if (folder) items.push(["New folder", () => h.newFolder(folder)]);
    items.push(null, ["Import files", () => h.importFiles(folder || "")]);
    if (folder.includes("/")) items.push(null, ["Rename folder", () => h.rename(folder)], ["Delete folder", () => h.removeFolder(folder)]);
    return items;
  }

  render(p: Project, sel: Selection, dirty: Set<string>, main: string) {
    const scroll = this.el.scrollTop;
    this.el.innerHTML = "";
    const files = p.paths().filter((x) => x !== "slate.json");
    const folders = new Set<string>(p.folders);
    for (const f of files) {
      const parts = f.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    }
    const children = (dir: string) => {
      const depth = dir ? dir.split("/").length : 0;
      const subdirs = [...folders].filter((f) => f.startsWith(dir ? dir + "/" : "") && f.split("/").length === depth + 1).sort();
      const here = files.filter((f) => f.startsWith(dir + "/") && f.split("/").length === depth + 1);
      return { subdirs, here };
    };
    const order = ["scripts", "sprites", "maps", "music", "sounds"];
    const tops = [...folders].filter((f) => !f.includes("/")).sort((a, b) => order.indexOf(a) - order.indexOf(b));

    const addFolder = (dir: string, depth: number) => {
      const open = !this.collapsed.has(dir);
      const row = document.createElement("div");
      row.className = "tree-row folder" + (open ? " open" : "");
      row.style.paddingLeft = `${4 + depth * 14}px`;
      const { subdirs, here } = children(dir);
      const n = files.filter((f) => f.startsWith(dir + "/")).length;
      row.innerHTML = `${CARET}<span class="name"></span><span class="count"></span>`;
      row.querySelector(".name")!.textContent = depth === 0 ? dir : dir.slice(dir.lastIndexOf("/") + 1);
      row.querySelector(".count")!.textContent = n ? String(n) : "";
      row.onclick = () => {
        if (open) this.collapsed.add(dir);
        else this.collapsed.delete(dir);
        this.render(p, sel, dirty, main);
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        this.menu(e.clientX, e.clientY, this.folderItems(dir));
      };
      this.el.appendChild(row);
      if (!open) return;
      for (const d of subdirs) addFolder(d, depth + 1);
      for (const f of here) addFile(f, depth + 1);
    };

    const addFile = (path: string, depth: number) => {
      const top = path.split("/")[0];
      const name = baseName(path);
      const row = document.createElement("div");
      // files line up with their folder's name (past the caret)
      row.style.paddingLeft = `${4 + depth * 14 + 6}px`;
      row.title = path;
      let active = false;
      let open = () => {};
      if (top === "sprites") {
        const s = p.get(name);
        row.className = "tree-row sprite-item";
        if (s) row.appendChild(thumb(s.flat(0)));
        const nameEl = Object.assign(document.createElement("span"), { className: "name", textContent: name });
        const size = Object.assign(document.createElement("span"), { className: "size" });
        if (s) {
          size.textContent = `${s.w}×${s.h}`;
          row.title = `${path} · ${s.w}×${s.h}${s.frameCount > 1 ? ` · ${s.frameCount} frames` : ""}${s.tags.length ? ` · ${s.tags.map((t) => t.name).join(", ")}` : ""}`;
        }
        row.append(nameEl, size);
        active = sel.sprite === name;
        open = () => this.hooks.openSprite(name);
        // drag onto the map to place it as an object
        row.draggable = true;
        row.ondragstart = (e) => {
          e.dataTransfer?.setData("application/x-slate-sprite", name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
        };
      } else {
        row.className = "tree-row file";
        row.innerHTML = `<span class="name"></span><span class="size"></span>`;
        row.querySelector(".name")!.textContent = top === "scripts" ? path.slice(path.lastIndexOf("/") + 1) : name;
        if (top === "scripts" && path === main) row.querySelector(".size")!.outerHTML = '<span class="badge" title="Runs first">main</span>';
        if (top === "maps") {
          const m = p.maps.find((x) => x.name === name);
          if (m) row.querySelector(".size")!.textContent = `${m.w}×${m.h}`;
          active = sel.map === name;
          open = () => this.hooks.openMap(name);
        } else if (top === "scripts") {
          active = sel.script === path;
          if (path === main) row.title = `${path} (runs first)`;
          open = () => this.hooks.openScript(path);
        } else {
          row.querySelector(".size")!.textContent = extOf(path);
          row.title = `${path} · click to listen · in code: ${top === "music" ? `music("${name}")` : `sfx("${name}")`}`;
          open = () => this.hooks.playAudio(path);
        }
      }
      if (dirty.has(path)) row.classList.add("dirty");
      if (active) row.classList.add("active");
      row.onclick = open;
      row.oncontextmenu = (e) => {
        e.preventDefault();
        const items: ([string, () => void] | null)[] = [["Open", open], ["Rename", () => this.hooks.rename(path)]];
        if (top === "scripts" && path !== main) items.push(["Run first (main)", () => this.hooks.setMain(path)]);
        items.push(null, ["Delete", () => this.hooks.remove(path)]);
        this.menu(e.clientX, e.clientY, items);
      };
      this.el.appendChild(row);
    };

    for (const t of tops) addFolder(t, 0);
    this.el.scrollTop = scroll;
  }
}
