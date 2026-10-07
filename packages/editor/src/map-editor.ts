// Tile map editor: paint tiles from a tileset sprite (one frame = one tile) onto map layers.
//
// Tools: pen (multi-tile brush: shift+drag in the palette), erase (also right click),
// fill, rect, picker (also alt+click). Tile flags (solid) are set in the palette.
// Object tool: place / drag / edit scene objects (enemies, items, spawn points) that the game
// reads with objects("map"). Object x, y = bottom-center in map pixels.

import type { MapLayer, MapObject, TileMap } from "@slate/runtime";
import type { EditSprite, Project } from "./project.ts";

export type MapTool = "pen" | "erase" | "fill" | "rect" | "picker" | "object";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Brush {
  w: number;
  h: number;
  tiles: number[];
}

export interface MapHooks {
  /** Map data changed (sync game, autosave). */
  changed(): void;
  status(msg: string, error?: boolean): void;
  /** Tile flags on a sprite changed. */
  flagsChanged(sprite: EditSprite): void;
}

export class MapEditor {
  project: Project | null = null;
  map: TileMap | null = null;
  layer = 0;
  tool: MapTool = "pen";
  zoom = 2;
  grid = true;
  brush: Brush = { w: 1, h: 1, tiles: [0] };

  private canvas = $<HTMLCanvasElement>("map-canvas");
  private palette = $<HTMLCanvasElement>("tile-palette");
  private tileCache = new Map<string, HTMLCanvasElement[]>();
  private undoStack: { map: TileMap; layers: number[][]; objects: string }[] = [];
  private redoStack: { map: TileMap; layers: number[][]; objects: string }[] = [];
  private sel: MapObject | null = null;
  private drag: { dx: number; dy: number; moved: boolean } | null = null;
  private objCache = new Map<string, HTMLCanvasElement>();
  private down = false;
  private erasing = false;
  private start: [number, number] = [0, 0];
  private hover: [number, number] | null = null;
  private before: number[] | null = null;
  private palSel: { a: number; b: number } | null = null;
  private palCols = 8;
  private palZoom = 2;

  constructor(private hooks: MapHooks) {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.pointerDown(e));
    c.addEventListener("pointermove", (e) => this.pointerMove(e));
    c.addEventListener("pointerleave", () => { this.hover = null; this.render(); });
    window.addEventListener("pointerup", () => this.pointerUp());
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.parentElement!.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    this.palette.addEventListener("pointerdown", (e) => this.palDown(e));
    this.palette.addEventListener("pointermove", (e) => { if (e.buttons) this.palMove(e); });
    this.wireUi();
  }

  get tileset(): EditSprite | null {
    return (this.map && this.project?.get(this.map.tileset)) ?? null;
  }

  // ------------------------------------------------------------ project / map selection

  setProject(p: Project) {
    this.project = p;
    this.tileCache.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.selectMap(p.maps[0]?.name ?? null);
  }

  selectMap(name: string | null) {
    this.map = (name && this.project?.maps.find((m) => m.name === name)) || null;
    this.sel = null;
    this.layer = 0;
    this.brush = { w: 1, h: 1, tiles: [0] };
    this.palSel = { a: 0, b: 0 };
    this.fitZoom();
    this.refresh();
  }

  /** Re-render everything (after a project or sprite change). */
  refresh() {
    this.renderMapList();
    this.renderTilesetList();
    this.renderLayers();
    this.renderPalette();
    this.renderObjectPanel();
    this.render();
  }

  /** A sprite's pixels changed: drop its cached tile images. */
  invalidate(sprite: string) {
    this.tileCache.delete(sprite);
    if (this.objCache.delete(sprite)) this.render();
    if (this.map?.tileset === sprite) {
      this.renderPalette();
      this.render();
    }
  }

  private tiles(): HTMLCanvasElement[] {
    const t = this.tileset;
    if (!t) return [];
    let list = this.tileCache.get(t.name);
    if (!list || list.length !== t.frameCount) {
      list = t.frames.map((img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d")!.putImageData(img, 0, 0);
        return c;
      });
      this.tileCache.set(t.name, list);
    }
    return list;
  }

  private fitZoom() {
    const t = this.tileset, m = this.map;
    if (!t || !m) return;
    const wrap = this.canvas.parentElement!;
    const fit = Math.floor(Math.min((wrap.clientWidth - 24) / (m.w * t.w), (wrap.clientHeight - 24) / (m.h * t.h)));
    this.zoom = Math.max(1, Math.min(8, fit || 2));
  }

  setZoom(z: number) {
    this.zoom = Math.max(1, Math.min(12, Math.round(z)));
    $("map-zoom").textContent = `${this.zoom}x`;
    this.render();
  }

  setTool(t: MapTool) {
    this.tool = t;
    for (const b of document.querySelectorAll<HTMLElement>("#map-tools button")) b.classList.toggle("active", b.dataset.tool === t);
    this.render();
  }

  // ------------------------------------------------------------ undo

  private snapshot() {
    const m = this.map;
    if (!m) return;
    this.undoStack.push({ map: m, layers: m.layers.map((l) => l.data.slice()), objects: JSON.stringify(m.objects ?? []) });
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(redo = false) {
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const e = from.pop();
    if (!e) return;
    to.push({ map: e.map, layers: e.map.layers.map((l) => l.data.slice()), objects: JSON.stringify(e.map.objects ?? []) });
    // layer count can differ if layers were added since; restore what matches
    e.map.layers.forEach((l, i) => { if (e.layers[i] && e.layers[i].length === l.data.length) l.data = e.layers[i]; });
    e.map.objects = JSON.parse(e.objects);
    this.sel = null;
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
  }

  // ------------------------------------------------------------ painting

  private cellAt(e: PointerEvent): [number, number] {
    const t = this.tileset!;
    const r = this.canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / (t.w * this.zoom)), Math.floor((e.clientY - r.top) / (t.h * this.zoom))];
  }

  private data(): number[] | null {
    return this.map?.layers[this.layer]?.data ?? null;
  }

  private setTile(tx: number, ty: number, v: number) {
    const m = this.map!, d = this.data()!;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
    d[ty * m.w + tx] = v;
  }

  /** Stamp the brush with its top-left at (tx, ty); erasing clears the brush footprint. */
  private stampBrush(tx: number, ty: number) {
    const b = this.brush;
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) this.setTile(tx + x, ty + y, this.erasing ? -1 : b.tiles[y * b.w + x]);
  }

  private pointerDown(e: PointerEvent) {
    if (!this.map || !this.tileset || !this.data()) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (this.tool === "object") return this.objDown(e);
    const [tx, ty] = this.cellAt(e);
    if (this.tool === "picker" || e.altKey) return this.pickAt(tx, ty);
    this.erasing = e.button === 2 || this.tool === "erase";
    this.snapshot();
    this.before = this.data()!.slice();
    this.down = true;
    this.start = [tx, ty];
    if (this.tool === "fill") {
      this.fill(tx, ty);
      this.down = false;
      this.done();
      return;
    }
    if (this.tool === "rect") this.rect(tx, ty);
    else this.stampBrush(tx, ty);
    this.render();
  }

  private pointerMove(e: PointerEvent) {
    if (!this.map || !this.tileset) return;
    const [tx, ty] = this.cellAt(e);
    const moved = !this.hover || this.hover[0] !== tx || this.hover[1] !== ty;
    this.hover = [tx, ty];
    if (moved) {
      const v = this.data()?.[ty * this.map.w + tx];
      $("map-info").textContent = `tile ${tx}, ${ty}${v !== undefined && v >= 0 ? ` · #${v}` : ""} · ${this.map.w}×${this.map.h} tiles`;
    }
    if (this.tool === "object") {
      if (this.drag) this.objMove(e);
      else if (moved) this.render();
      return;
    }
    if (!this.down) {
      if (moved) this.render();
      return;
    }
    if (!moved) return;
    if (this.tool === "rect") {
      const d = this.data()!;
      for (let i = 0; i < d.length; i++) d[i] = this.before![i];
      this.rect(tx, ty);
    } else {
      this.stampBrush(tx, ty);
    }
    this.render();
  }

  private pointerUp() {
    if (this.drag) {
      if (this.drag.moved) this.hooks.changed();
      else this.undoStack.pop(); // a click without a move changes nothing
      this.drag = null;
      return;
    }
    if (!this.down) return;
    this.down = false;
    this.done();
  }

  private done() {
    this.before = null;
    this.render();
    this.hooks.changed();
  }

  /** Rect tool: tile the brush pattern over the dragged rectangle. */
  private rect(tx: number, ty: number) {
    const [sx, sy] = this.start;
    const [x0, x1] = [Math.min(sx, tx), Math.max(sx, tx)];
    const [y0, y1] = [Math.min(sy, ty), Math.max(sy, ty)];
    const b = this.brush;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        this.setTile(x, y, this.erasing ? -1 : b.tiles[((y - y0) % b.h) * b.w + ((x - x0) % b.w)]);
  }

  private fill(tx: number, ty: number) {
    const m = this.map!, d = this.data()!;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
    const target = d[ty * m.w + tx];
    const b = this.brush;
    const stack = [[tx, ty]];
    const seen = new Uint8Array(m.w * m.h);
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      if (seen[i] || d[i] !== target) continue;
      seen[i] = 1;
      d[i] = this.erasing ? -1 : b.tiles[(((y - ty) % b.h) + b.h) % b.h * b.w + ((((x - tx) % b.w) + b.w) % b.w)];
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private pickAt(tx: number, ty: number) {
    const m = this.map!;
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return;
    // topmost visible layer with a tile there
    for (let i = m.layers.length - 1; i >= 0; i--) {
      const l = m.layers[i];
      const v = l.data[ty * m.w + tx];
      if (l.visible !== false && v >= 0) {
        this.brush = { w: 1, h: 1, tiles: [v] };
        this.palSel = { a: v, b: v };
        this.layer = i;
        this.renderLayers();
        this.renderPalette();
        this.setTool("pen");
        return;
      }
    }
  }

  // ------------------------------------------------------------ rendering

  render() {
    const m = this.map, t = this.tileset, c = this.canvas;
    $("map-zoom").textContent = `${this.zoom}x`;
    $("map-empty").classList.toggle("hidden", !!(m && t));
    if (!m || !t) {
      c.width = c.height = 0;
      return;
    }
    const z = this.zoom, tw = t.w * z, th = t.h * z;
    if (c.width !== m.w * tw || c.height !== m.h * th) {
      c.width = m.w * tw;
      c.height = m.h * th;
    }
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#16121e";
    g.fillRect(0, 0, c.width, c.height);
    const tiles = this.tiles();
    m.layers.forEach((l, li) => {
      if (l.visible === false) return;
      g.globalAlpha = li === this.layer || !$<HTMLInputElement>("map-dim").checked ? 1 : 0.35;
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          const v = l.data[y * m.w + x];
          if (v >= 0 && tiles[v]) g.drawImage(tiles[v], x * tw, y * th, tw, th);
        }
    });
    g.globalAlpha = 1;
    if (this.grid && tw >= 8) {
      g.strokeStyle = "rgba(255,255,255,0.08)";
      g.beginPath();
      for (let x = 0; x <= m.w; x++) { g.moveTo(x * tw + 0.5, 0); g.lineTo(x * tw + 0.5, c.height); }
      for (let y = 0; y <= m.h; y++) { g.moveTo(0, y * th + 0.5); g.lineTo(c.width, y * th + 0.5); }
      g.stroke();
    }
    this.drawObjects(g, z);
    // brush preview
    if (this.hover && !this.down && (this.tool === "pen" || this.tool === "rect" || this.tool === "fill")) {
      const [hx, hy] = this.hover;
      const b = this.brush;
      g.globalAlpha = 0.6;
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          const v = b.tiles[y * b.w + x];
          if (v >= 0 && tiles[v]) g.drawImage(tiles[v], (hx + x) * tw, (hy + y) * th, tw, th);
        }
      g.globalAlpha = 1;
      g.strokeStyle = "#ffcc4d";
      g.strokeRect(hx * tw + 0.5, hy * th + 0.5, b.w * tw - 1, b.h * th - 1);
    } else if (this.hover && this.tool === "erase") {
      g.strokeStyle = "#ff6b7a";
      g.strokeRect(this.hover[0] * tw + 0.5, this.hover[1] * th + 0.5, this.brush.w * tw - 1, this.brush.h * th - 1);
    }
  }

  // ------------------------------------------------------------ tile palette

  private renderPalette() {
    const t = this.tileset, c = this.palette;
    if (!t) {
      c.width = c.height = 0;
      $<HTMLInputElement>("tile-solid").disabled = true;
      return;
    }
    const tiles = this.tiles();
    const wrapW = c.parentElement!.clientWidth - 4;
    this.palZoom = Math.max(1, Math.min(4, Math.floor(wrapW / (t.w * 4))));
    const tw = t.w * this.palZoom, th = t.h * this.palZoom;
    this.palCols = Math.max(1, Math.floor(wrapW / (tw + 1)));
    const rows = Math.ceil(tiles.length / this.palCols);
    c.width = this.palCols * (tw + 1);
    c.height = rows * (th + 1);
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    tiles.forEach((tile, i) => {
      const x = (i % this.palCols) * (tw + 1), y = Math.floor(i / this.palCols) * (th + 1);
      g.fillStyle = "#221e2e";
      g.fillRect(x, y, tw, th);
      g.drawImage(tile, x, y, tw, th);
      if ((t.flags[i] ?? 0) & 1) {
        g.fillStyle = "#ff6b7a";
        g.fillRect(x + tw - 5, y, 5, 5);
      }
    });
    const sel = this.selectedTiles();
    g.strokeStyle = "#ffcc4d";
    g.lineWidth = 2;
    for (const i of sel) {
      const x = (i % this.palCols) * (tw + 1), y = Math.floor(i / this.palCols) * (th + 1);
      g.strokeRect(x + 1, y + 1, tw - 2, th - 2);
    }
    const solid = $<HTMLInputElement>("tile-solid");
    solid.disabled = sel.length === 0;
    solid.checked = sel.length > 0 && sel.every((i) => (t.flags[i] ?? 0) & 1);
  }

  private selectedTiles() {
    return this.brush.tiles.filter((v) => v >= 0);
  }

  private palIndex(e: PointerEvent) {
    const t = this.tileset!;
    const r = this.palette.getBoundingClientRect();
    const tw = t.w * this.palZoom + 1, th = t.h * this.palZoom + 1;
    const col = Math.min(this.palCols - 1, Math.floor((e.clientX - r.left) / tw));
    const row = Math.floor((e.clientY - r.top) / th);
    const i = row * this.palCols + col;
    return i < t.frameCount ? i : -1;
  }

  private palDown(e: PointerEvent) {
    if (!this.tileset) return;
    const i = this.palIndex(e);
    if (i < 0) return;
    this.palette.setPointerCapture(e.pointerId);
    this.palSel = { a: e.shiftKey && this.palSel ? this.palSel.a : i, b: i };
    this.applyPalSel();
  }

  private palMove(e: PointerEvent) {
    if (!this.tileset || !this.palSel) return;
    const i = this.palIndex(e);
    if (i < 0 || i === this.palSel.b) return;
    this.palSel.b = i;
    this.applyPalSel();
  }

  /** A rectangle selected in the palette becomes a multi-tile brush. */
  private applyPalSel() {
    const { a, b } = this.palSel!;
    const cols = this.palCols;
    const [x0, x1] = [Math.min(a % cols, b % cols), Math.max(a % cols, b % cols)];
    const [y0, y1] = [Math.min(Math.floor(a / cols), Math.floor(b / cols)), Math.max(Math.floor(a / cols), Math.floor(b / cols))];
    const n = this.tileset!.frameCount;
    const tiles: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push(y * cols + x < n ? y * cols + x : -1);
    this.brush = { w: x1 - x0 + 1, h: y1 - y0 + 1, tiles };
    if (this.tool === "erase" || this.tool === "picker") this.setTool("pen");
    this.renderPalette();
  }

  // ------------------------------------------------------------ side panels

  private renderMapList() {
    const sel = $<HTMLSelectElement>("map-select");
    sel.innerHTML = "";
    for (const m of this.project?.maps ?? []) {
      const o = document.createElement("option");
      o.value = o.textContent = m.name;
      sel.appendChild(o);
    }
    if (this.map) sel.value = this.map.name;
  }

  private renderTilesetList() {
    const sel = $<HTMLSelectElement>("map-tileset");
    sel.innerHTML = "";
    for (const s of this.project?.sprites ?? []) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = `${s.name} (${s.w}×${s.h}, ${s.frameCount})`;
      sel.appendChild(o);
    }
    if (this.map) sel.value = this.map.tileset;
    sel.disabled = !this.map;
  }

  private renderLayers() {
    const list = $("map-layer-list");
    list.innerHTML = "";
    const m = this.map;
    if (!m) return;
    for (let i = m.layers.length - 1; i >= 0; i--) {
      const l = m.layers[i];
      const el = document.createElement("div");
      el.className = "layer" + (i === this.layer ? " active" : "");
      const eye = document.createElement("button");
      const visible = l.visible !== false;
      eye.className = "eye" + (visible ? "" : " off");
      eye.textContent = visible ? "◉" : "○";
      eye.onclick = (ev) => {
        ev.stopPropagation();
        l.visible = !visible;
        this.renderLayers();
        this.render();
        this.hooks.changed();
      };
      const name = document.createElement("span");
      name.className = "lname";
      name.textContent = l.name;
      el.append(eye, name);
      el.onclick = () => { this.layer = i; this.renderLayers(); this.render(); };
      el.ondblclick = () => {
        const n = prompt("Layer name (map(..., { layer = \"name\" }) in code)", l.name)?.trim();
        if (n) { l.name = n; this.renderLayers(); this.hooks.changed(); }
      };
      list.appendChild(el);
    }
  }

  private newMap() {
    const p = this.project;
    if (!p) return;
    if (!p.sprites.length) return this.hooks.status("Make a tileset first: a sprite whose frames are the tiles", true);
    const tileset = this.tileset?.name ?? $<HTMLSelectElement>("map-tileset").value ?? p.sprites[0].name;
    const t = p.get(tileset) ?? p.sprites[0];
    const [rw, rh] = p.cart.resolution;
    const def = `${Math.ceil(rw / t.w)}x${Math.ceil(rh / t.h)}`;
    const size = prompt(`New map using tileset "${t.name}" (${t.w}×${t.h} tiles). Size in tiles:`, def)?.match(/(\d+)\s*[x×]\s*(\d+)/);
    if (!size) return;
    const w = Math.min(1024, +size[1]), h = Math.min(1024, +size[2]);
    let name = "level", i = 2;
    while (p.maps.some((m) => m.name === name)) name = `level${i++}`;
    const layer = (n: string): MapLayer => ({ name: n, visible: true, data: new Array(w * h).fill(-1) });
    p.maps.push({ name, tileset: t.name, w, h, layers: [layer("back"), layer("main")] });
    this.selectMap(name);
    this.layer = 1;
    this.renderLayers();
    this.hooks.changed();
    this.hooks.status(`Map "${name}" created · draw it in code with map("${name}", 0, 0)`);
  }

  private resizeMap() {
    const m = this.map;
    if (!m) return;
    const size = prompt("Map size in tiles (content stays top-left)", `${m.w}x${m.h}`)?.match(/(\d+)\s*[x×]\s*(\d+)/);
    if (!size) return;
    const w = Math.min(1024, +size[1]), h = Math.min(1024, +size[2]);
    this.undoStack = [];
    for (const l of m.layers) {
      const d = new Array(w * h).fill(-1);
      for (let y = 0; y < Math.min(h, m.h); y++) for (let x = 0; x < Math.min(w, m.w); x++) d[y * w + x] = l.data[y * m.w + x];
      l.data = d;
    }
    m.w = w;
    m.h = h;
    this.render();
    this.hooks.changed();
  }

  private wireUi() {
    this.wireObjects();
    for (const b of document.querySelectorAll<HTMLElement>("#map-tools button")) b.onclick = () => this.setTool(b.dataset.tool as MapTool);
    $<HTMLSelectElement>("map-select").onchange = (e) => this.selectMap((e.target as HTMLSelectElement).value);
    $("map-new").onclick = () => this.newMap();
    $("map-resize").onclick = () => this.resizeMap();
    $("map-del").onclick = () => {
      const p = this.project, m = this.map;
      if (!p || !m || !confirm(`Delete map "${m.name}"?`)) return;
      p.maps.splice(p.maps.indexOf(m), 1);
      this.selectMap(p.maps[0]?.name ?? null);
      this.hooks.changed();
    };
    $("map-rename").onclick = () => {
      const m = this.map;
      if (!m) return;
      const n = prompt("Map name (used in code: map(\"name\", x, y))", m.name)?.trim().replace(/[^\w-]/g, "_");
      if (!n || this.project!.maps.some((x) => x.name === n)) return;
      m.name = n;
      this.renderMapList();
      this.hooks.changed();
    };
    $<HTMLSelectElement>("map-tileset").onchange = (e) => {
      const m = this.map;
      if (!m) return;
      m.tileset = (e.target as HTMLSelectElement).value;
      this.brush = { w: 1, h: 1, tiles: [0] };
      this.palSel = { a: 0, b: 0 };
      this.refresh();
      this.hooks.changed();
    };
    $<HTMLInputElement>("map-grid").onchange = (e) => { this.grid = (e.target as HTMLInputElement).checked; this.render(); };
    $<HTMLInputElement>("map-dim").onchange = () => this.render();
    $("map-zoom-in").onclick = () => this.setZoom(this.zoom + 1);
    $("map-zoom-out").onclick = () => this.setZoom(this.zoom - 1);
    $<HTMLInputElement>("tile-solid").onchange = (e) => {
      const t = this.tileset;
      if (!t) return;
      const on = (e.target as HTMLInputElement).checked;
      for (const i of this.selectedTiles()) t.flags[i] = on ? (t.flags[i] ?? 0) | 1 : (t.flags[i] ?? 0) & ~1;
      this.renderPalette();
      this.hooks.flagsChanged(t);
    };
    const layerOp = (fn: (m: TileMap) => void) => {
      const m = this.map;
      if (!m) return;
      this.undoStack = [];
      fn(m);
      this.layer = Math.max(0, Math.min(this.layer, m.layers.length - 1));
      this.renderLayers();
      this.render();
      this.hooks.changed();
    };
    $("map-layer-add").onclick = () => layerOp((m) => {
      m.layers.splice(this.layer + 1, 0, { name: `layer${m.layers.length + 1}`, visible: true, data: new Array(m.w * m.h).fill(-1) });
      this.layer++;
    });
    $("map-layer-del").onclick = () => layerOp((m) => { if (m.layers.length > 1) m.layers.splice(this.layer, 1); });
    $("map-layer-up").onclick = () => layerOp((m) => {
      const i = this.layer;
      if (i < m.layers.length - 1) { [m.layers[i], m.layers[i + 1]] = [m.layers[i + 1], m.layers[i]]; this.layer++; }
    });
    $("map-layer-down").onclick = () => layerOp((m) => {
      const i = this.layer;
      if (i > 0) { [m.layers[i], m.layers[i - 1]] = [m.layers[i - 1], m.layers[i]]; this.layer--; }
    });
  }

  // ------------------------------------------------------------ scene objects

  private objects(): MapObject[] {
    return (this.map!.objects ??= []);
  }

  private mapPos(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / this.zoom, (e.clientY - r.top) / this.zoom];
  }

  /** Snap to half a tile; hold Alt for free placement. */
  private snap(v: number, step: number, free: boolean) {
    return free ? Math.round(v) : Math.round(v / step) * step;
  }

  private objImage(sprite?: string): HTMLCanvasElement | null {
    if (!sprite) return null;
    let c = this.objCache.get(sprite);
    if (!c) {
      const s = this.project?.get(sprite);
      if (!s) return null;
      const img = s.flat(0);
      c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.putImageData(img, 0, 0);
      this.objCache.set(sprite, c);
    }
    return c;
  }

  /** Bounding box (map pixels) of an object: its sprite anchored bottom-center, or a 12px marker. */
  private objBox(o: MapObject) {
    const img = this.objImage(o.sprite);
    const w = img ? img.width : 12, h = img ? img.height : 12;
    return { x: o.x - w / 2, y: o.y - h, w, h };
  }

  private objAt(px: number, py: number) {
    const list = this.objects();
    for (let i = list.length - 1; i >= 0; i--) {
      const b = this.objBox(list[i]);
      if (px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h) return list[i];
    }
    return null;
  }

  private objDown(e: PointerEvent) {
    const [px, py] = this.mapPos(e);
    const hit = this.objAt(px, py);
    if (e.button === 2) {
      if (hit) {
        this.sel = hit;
        this.deleteSelected();
      }
      return;
    }
    this.snapshot();
    if (hit) {
      this.sel = hit;
      this.drag = { dx: px - hit.x, dy: py - hit.y, moved: false };
    } else {
      const t = this.tileset!;
      const list = this.objects();
      const o: MapObject = {
        id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        type: $<HTMLInputElement>("obj-type").value.trim() || "object",
        x: this.snap(px, t.w / 2, e.altKey),
        y: this.snap(py, t.h / 2, e.altKey),
      };
      const sprite = $<HTMLSelectElement>("obj-sprite").value;
      if (sprite) o.sprite = sprite;
      const props = this.parseProps($<HTMLTextAreaElement>("obj-props").value);
      if (Object.keys(props).length) o.props = props;
      list.push(o);
      this.sel = o;
      this.drag = { dx: 0, dy: 0, moved: true };
      this.hooks.status(`Placed "${o.type}" #${o.id} · in code: for _, o in objects("${this.map!.name}") do ... end`);
    }
    this.renderObjectPanel();
    this.render();
  }

  private objMove(e: PointerEvent) {
    if (!this.sel || !this.drag) return;
    const t = this.tileset!;
    const [px, py] = this.mapPos(e);
    const nx = this.snap(px - this.drag.dx, t.w / 2, e.altKey);
    const ny = this.snap(py - this.drag.dy, t.h / 2, e.altKey);
    if (nx === this.sel.x && ny === this.sel.y) return;
    this.sel.x = nx;
    this.sel.y = ny;
    this.drag.moved = true;
    this.renderObjectPanel();
    this.render();
  }

  private deleteSelected() {
    if (!this.sel || !this.map) return;
    this.snapshot();
    const list = this.objects();
    list.splice(list.indexOf(this.sel), 1);
    this.sel = null;
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
  }

  private parseProps(text: string) {
    const out: Record<string, string | number | boolean> = {};
    for (const line of text.split(/\n|,/)) {
      const m = line.match(/^\s*([\w-]+)\s*[=:]\s*(.*?)\s*$/);
      if (!m) continue;
      const v = m[2];
      out[m[1]] = v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(Number(v)) ? Number(v) : v;
    }
    return out;
  }

  private drawObjects(g: CanvasRenderingContext2D, z: number) {
    const m = this.map;
    if (!m?.objects?.length) return;
    const editing = this.tool === "object";
    g.font = "11px Consolas, monospace";
    g.textAlign = "center";
    for (const o of m.objects) {
      const b = this.objBox(o);
      const img = this.objImage(o.sprite);
      g.globalAlpha = editing || o === this.sel ? 1 : 0.85;
      if (img) {
        g.drawImage(img, b.x * z, b.y * z, b.w * z, b.h * z);
      } else {
        // marker: diamond
        const cx = o.x * z, cy = (o.y - 6) * z, r = 6 * z;
        g.fillStyle = "#ffcc4d";
        g.beginPath();
        g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      if (editing) {
        const sel = o === this.sel;
        g.strokeStyle = sel ? "#ffcc4d" : "rgba(255,255,255,0.35)";
        g.setLineDash(sel ? [] : [3, 3]);
        g.strokeRect(b.x * z + 0.5, b.y * z + 0.5, b.w * z - 1, b.h * z - 1);
        g.setLineDash([]);
        const label = o.type;
        const tw = g.measureText(label).width + 8;
        g.fillStyle = sel ? "#ffcc4d" : "rgba(10,8,16,0.8)";
        g.fillRect(o.x * z - tw / 2, b.y * z - 15, tw, 14);
        g.fillStyle = sel ? "#2a1d00" : "#e8e2f5";
        g.fillText(label, o.x * z, b.y * z - 4);
      }
    }
  }

  private renderObjectPanel() {
    const sel = $<HTMLSelectElement>("obj-sprite");
    const keep = this.sel?.sprite ?? sel.value;
    sel.innerHTML = '<option value="">(marker)</option>';
    for (const s of this.project?.sprites ?? []) {
      const o = document.createElement("option");
      o.value = o.textContent = s.name;
      sel.appendChild(o);
    }
    sel.value = keep && this.project?.get(keep) ? keep : "";
    $("obj-count").textContent = String(this.map?.objects?.length ?? 0);
    const o = this.sel;
    $<HTMLButtonElement>("obj-del").disabled = !o;
    if (o) {
      $<HTMLInputElement>("obj-type").value = o.type;
      $<HTMLTextAreaElement>("obj-props").value = Object.entries(o.props ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
      $("obj-pos").textContent = `#${o.id} at ${o.x}, ${o.y}`;
    } else {
      $("obj-pos").textContent = "new objects use these";
    }
  }

  private wireObjects() {
    // editing the fields updates the selected object (or sets the defaults for the next one)
    const apply = () => {
      const o = this.sel;
      if (!o) return;
      this.snapshot();
      o.type = $<HTMLInputElement>("obj-type").value.trim() || "object";
      const sprite = $<HTMLSelectElement>("obj-sprite").value;
      if (sprite) o.sprite = sprite;
      else delete o.sprite;
      const props = this.parseProps($<HTMLTextAreaElement>("obj-props").value);
      if (Object.keys(props).length) o.props = props;
      else delete o.props;
      this.render();
      this.hooks.changed();
    };
    $("obj-type").addEventListener("change", apply);
    $("obj-sprite").addEventListener("change", apply);
    $("obj-props").addEventListener("change", apply);
    $("obj-del").onclick = () => this.deleteSelected();
  }

  /** Map-tab shortcuts. Returns true if handled. */
  handleKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { this.undo(e.shiftKey); return true; }
    if (mod && k === "y") { this.undo(true); return true; }
    if (mod) return false;
    if (this.tool === "object" && this.sel && (e.key === "Delete" || e.key === "Backspace")) { this.deleteSelected(); return true; }
    if (this.tool === "object" && this.sel && e.key.startsWith("Arrow")) {
      this.snapshot();
      const d = e.shiftKey ? 8 : 1;
      if (e.key === "ArrowLeft") this.sel.x -= d;
      if (e.key === "ArrowRight") this.sel.x += d;
      if (e.key === "ArrowUp") this.sel.y -= d;
      if (e.key === "ArrowDown") this.sel.y += d;
      this.renderObjectPanel();
      this.render();
      this.hooks.changed();
      return true;
    }
    const tools: Record<string, MapTool> = { b: "pen", e: "erase", g: "fill", u: "rect", i: "picker", o: "object" };
    if (tools[k]) { this.setTool(tools[k]); return true; }
    if (e.key === "+" || e.key === "=") { this.setZoom(this.zoom + 1); return true; }
    if (e.key === "-") { this.setZoom(this.zoom - 1); return true; }
    return false;
  }
}
