// Tile map editor: paint tiles from tileset sprites (one frame = one tile) onto map layers.
//
// A map can use several tilesets (ground, decorations...): the palette shows one at a time and
// switching it only changes what you paint. Tile values pack the tileset: index * TILE_STRIDE + frame.
// Tools: pen (multi-tile brush: shift+drag in the palette), erase (also right click),
// fill, rect, picker (also alt+click). Tile flags (solid) are set in the palette.
// Autotile: a 4x4 block of a tileset marked as one terrain; painting it picks the right edge and
// corner tile from the neighbors.
// Object tool: place / drag / edit scene objects (enemies, items, spawn points) that the game
// reads with objects("map"). Object x, y = bottom-center in map pixels. Sprites can also be
// dragged from the file list onto the map.

import { ask, askSize, codeName, confirmBox, form } from "./modal.ts";
import { popupMenu } from "./menu.ts";
import { resolveObject, TILE_STRIDE, type MapLayer, type MapObject, type ObjectTemplate, type TileMap } from "@slate/runtime";
import type { EditSprite, Project } from "./project.ts";
import { canvasView, type CanvasView } from "./canvas-view.ts";

const AUTOTILE_HELP = `Draw 16 tiles as a 4×4 block, select the block in the palette and right click it.

The top-left 3×3 is a filled area: corners, edges and the middle.
The right column is a pillar one tile wide: top, middle, bottom.
The bottom row is a ledge one tile high: left, middle, right.
The bottom-right tile stands alone.`;

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
  /** Tile flags (or autotiles) on a sprite changed. */
  flagsChanged(sprite: EditSprite): void;
  /** "Play from here": run the game starting at (x, y) map pixels on this map. */
  playFrom(map: string, x: number, y: number): void;
  /** object templates changed (they live in slate.json) */
  templatesChanged(): void;
}

/** An autotile terrain: 16 tiles laid out 4x4 (a 3x3 block for areas, a column, a row, a single). */
interface Terrain {
  set: number;
  tiles: number[];
}

export class MapEditor {
  project: Project | null = null;
  map: TileMap | null = null;
  layer = 0;
  tool: MapTool = "pen";
  zoom = 2;
  private view: CanvasView;
  private needFit = false;
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
  /** which of the map's tilesets the palette shows */
  private active = 0;
  /** "Play from here" waits for a click on the map */
  private picking = false;
  /** the template new objects are made from (null = from the fields) */
  private tpl: string | null = null;

  constructor(private hooks: MapHooks) {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.pointerDown(e));
    c.addEventListener("pointermove", (e) => this.pointerMove(e));
    c.addEventListener("pointerleave", () => { this.hover = null; this.render(); });
    window.addEventListener("pointerup", () => this.pointerUp());
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => {
      if (!this.needFit) return;
      this.fitZoom();
      if (!this.needFit) this.setZoom(this.zoom);
    }).observe(c.parentElement!);
    this.view = canvasView(c.parentElement!, c, { zoom: () => this.zoom, setZoom: (z) => this.setZoom(z), levels: [1, 2, 3, 4, 5, 6, 8, 10, 12] });
    this.palette.addEventListener("pointerdown", (e) => this.palDown(e));
    this.palette.addEventListener("pointermove", (e) => { if (e.buttons) this.palMove(e); });
    this.palette.addEventListener("contextmenu", (e) => this.palMenu(e));
    // a sprite dropped on the tiles panel joins the map's tilesets
    const tilesPanel = this.palette.closest<HTMLElement>(".tileset-panel")!;
    tilesPanel.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes("application/x-slate-sprite") || !this.map) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      tilesPanel.classList.add("drop-target");
    });
    tilesPanel.addEventListener("dragleave", (e) => {
      if (!tilesPanel.contains(e.relatedTarget as Node)) tilesPanel.classList.remove("drop-target");
    });
    tilesPanel.addEventListener("drop", (e) => {
      tilesPanel.classList.remove("drop-target");
      const name = e.dataTransfer?.getData("application/x-slate-sprite");
      if (!name || !this.map) return;
      e.preventDefault();
      this.dropTileset(name);
    });
    // sprites dragged from the file list become objects
    c.parentElement!.addEventListener("dragover", (e) => {
      const types = e.dataTransfer?.types ?? [];
      if ((types.includes("application/x-slate-sprite") || types.includes("application/x-slate-template")) && this.map && this.tileset && e.dataTransfer) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    c.parentElement!.addEventListener("drop", (e) => {
      if (!this.map || !this.tileset) return;
      const tpl = e.dataTransfer?.getData("application/x-slate-template");
      if (tpl) {
        e.preventDefault();
        return this.dropTemplate(tpl, e);
      }
      const name = e.dataTransfer?.getData("application/x-slate-sprite");
      if (!name) return;
      e.preventDefault();
      this.dropSprite(name, e);
    });
    this.wireUi();
  }

  /** The map's tilesets, in tile-value order. */
  private sets(): string[] {
    const m = this.map;
    return m ? (m.tilesets?.length ? m.tilesets : [m.tileset]) : [];
  }

  /** The first tileset: it sets the tile size. */
  get tileset(): EditSprite | null {
    return (this.map && this.project?.get(this.map.tileset)) ?? null;
  }

  /** The tileset the palette shows. */
  private get palSet(): EditSprite | null {
    const name = this.sets()[this.active];
    return name ? (this.project?.get(name) ?? null) : null;
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
    this.active = 0;
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
    if (this.sets().includes(sprite)) {
      this.renderPalette();
      this.render();
    }
  }

  /** The tile images of a tileset (the palette's by default). */
  private tiles(t: EditSprite | null = this.palSet): HTMLCanvasElement[] {
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

  /** The image of a tile value (any of the map's tilesets); animated tiles show their current frame. */
  private tileImg(v: number, animate = true): HTMLCanvasElement | null {
    if (v < 0) return null;
    const name = this.sets()[Math.floor(v / TILE_STRIDE)];
    const t = name ? this.project?.get(name) : null;
    if (!t) return null;
    let f = v % TILE_STRIDE;
    if (animate && t.tileAnims.length) {
      const now = performance.now() / 1000;
      for (const a of t.tileAnims) {
        const i = a.frames.indexOf(f);
        if (i >= 0) {
          f = a.frames[(i + Math.floor(now * a.fps)) % a.frames.length];
          break;
        }
      }
    }
    return this.tiles(t)[f] ?? null;
  }

  /** Keep animated tiles moving while the map is on screen. */
  private animTimer = window.setInterval(() => {
    if (this.down || !this.map || !this.canvas.offsetParent) return;
    if (this.sets().some((n) => (this.project?.get(n)?.tileAnims.length ?? 0) > 0)) this.render();
  }, 100);

  /** Zoom so the map fills the view (once the view has a size: the Map tab may be hidden). */
  private fitZoom() {
    const t = this.tileset, m = this.map;
    const wrap = this.canvas.parentElement!;
    this.needFit = true;
    if (!t || !m || wrap.clientWidth < 100 || wrap.clientHeight < 100) return;
    this.needFit = false;
    const fit = Math.floor(Math.min((wrap.clientWidth - 80) / (m.w * t.w), (wrap.clientHeight - 80) / (m.h * t.h)));
    this.zoom = Math.max(1, Math.min(8, fit || 2));
  }

  setZoom(z: number) {
    this.needFit = false;
    this.zoom = Math.max(1, Math.min(12, Math.round(z)));
    $("map-zoom").textContent = `${this.zoom * 100}%`;
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
    this.autotile();
  }

  // ------------------------------------------------------------ autotile

  /** Tile value -> its terrain, for every autotile block of the map's tilesets. */
  private terrains() {
    const out = new Map<number, Terrain>();
    this.sets().forEach((name, set) => {
      for (const tiles of this.project?.get(name)?.autotiles ?? []) {
        const t: Terrain = { set, tiles };
        for (const f of tiles) out.set(set * TILE_STRIDE + f, t);
      }
    });
    return out;
  }

  private get autoOn() {
    return $<HTMLInputElement>("map-auto").checked;
  }

  /** Re-pick every terrain tile on the layer from its neighbors (edges, corners, columns, rows). */
  private autotile() {
    if (!this.autoOn || !this.map) return;
    const terr = this.terrains();
    if (!terr.size) return;
    const m = this.map, d = this.data()!;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? undefined : terr.get(d[y * m.w + x]));
    const next = d.slice();
    for (let y = 0; y < m.h; y++)
      for (let x = 0; x < m.w; x++) {
        const t = at(x, y);
        if (!t) continue;
        const n = at(x, y - 1) === t, s = at(x, y + 1) === t, w = at(x - 1, y) === t, e = at(x + 1, y) === t;
        const col = w ? (e ? 1 : 2) : e ? 0 : 3;
        const row = n ? (s ? 1 : 2) : s ? 0 : 3;
        next[y * m.w + x] = t.set * TILE_STRIDE + t.tiles[row * 4 + col];
      }
    for (let i = 0; i < d.length; i++) d[i] = next[i];
  }

  private pointerDown(e: PointerEvent) {
    if (!this.map || !this.tileset || !this.data() || e.button === 1) return;
    if (this.picking) {
      this.stopPicking();
      const [px, py] = this.mapPos(e);
      if (e.button === 0) this.hooks.playFrom(this.map.name, Math.round(px), Math.round(py));
      return;
    }
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
      this.autotile();
      this.down = false;
      this.done();
      return;
    }
    if (this.tool === "rect") {
      this.rect(tx, ty);
      this.autotile();
    } else this.stampBrush(tx, ty);
    this.render();
  }

  private pointerMove(e: PointerEvent) {
    if (!this.map || !this.tileset) return;
    const [tx, ty] = this.cellAt(e);
    const moved = !this.hover || this.hover[0] !== tx || this.hover[1] !== ty;
    this.hover = [tx, ty];
    if (moved) {
      const v = this.data()?.[ty * this.map.w + tx];
      const what = v !== undefined && v >= 0 ? ` · ${this.sets()[Math.floor(v / TILE_STRIDE)] ?? "?"} #${v % TILE_STRIDE}` : "";
      $("status-info").textContent = `tile ${tx}, ${ty}${what} · ${this.map.w}×${this.map.h} tiles`;
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
      this.autotile();
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
        this.active = Math.floor(v / TILE_STRIDE);
        this.palSel = { a: v % TILE_STRIDE, b: v % TILE_STRIDE };
        this.layer = i;
        this.renderTilesetList();
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
    $("map-zoom").textContent = `${this.zoom * 100}%`;
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
    m.layers.forEach((l, li) => {
      if (l.visible === false) return;
      g.globalAlpha = li === this.layer || !$<HTMLInputElement>("map-dim").checked ? 1 : 0.35;
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++) {
          const img = this.tileImg(l.data[y * m.w + x]);
          if (img) g.drawImage(img, x * tw, y * th, tw, th);
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
    if (this.picking && this.hover) {
      g.strokeStyle = "#7cff6b";
      g.lineWidth = 2;
      g.strokeRect(this.hover[0] * tw + 1, this.hover[1] * th + 1, tw - 2, th - 2);
      g.lineWidth = 1;
    } else if (this.hover && !this.down && (this.tool === "pen" || this.tool === "rect" || this.tool === "fill")) {
      const [hx, hy] = this.hover;
      const b = this.brush;
      g.globalAlpha = 0.6;
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          const img = this.tileImg(b.tiles[y * b.w + x]);
          if (img) g.drawImage(img, (hx + x) * tw, (hy + y) * th, tw, th);
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
    const t = this.palSet, c = this.palette;
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
      // (the palette shows every frame as it is; the map plays animated ones)
      g.fillStyle = "#221e2e";
      g.fillRect(x, y, tw, th);
      g.drawImage(tile, x, y, tw, th);
      if ((t.flags[i] ?? 0) & 1) {
        g.fillStyle = "#ff6b7a";
        g.fillRect(x + tw - 5, y, 5, 5);
      }
      if (t.tileAnims.some((a) => a.frames.includes(i))) {
        // a little "play" mark
        g.fillStyle = "#7cff6b";
        g.beginPath();
        g.moveTo(x + 1, y + 1);
        g.lineTo(x + 6, y + 3.5);
        g.lineTo(x + 1, y + 6);
        g.fill();
      }
      if (t.autotiles.some((a) => a.includes(i))) {
        g.fillStyle = "#5b8cf0";
        g.beginPath();
        g.moveTo(x, y + th);
        g.lineTo(x + 6, y + th);
        g.lineTo(x, y + th - 6);
        g.fill();
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

  /** Frames of the palette's tileset in the brush. */
  private selectedTiles() {
    return this.brush.tiles.filter((v) => v >= 0 && Math.floor(v / TILE_STRIDE) === this.active).map((v) => v % TILE_STRIDE);
  }

  private palIndex(e: PointerEvent) {
    const t = this.palSet!;
    const r = this.palette.getBoundingClientRect();
    const tw = t.w * this.palZoom + 1, th = t.h * this.palZoom + 1;
    const col = Math.min(this.palCols - 1, Math.floor((e.clientX - r.left) / tw));
    const row = Math.floor((e.clientY - r.top) / th);
    const i = row * this.palCols + col;
    return i < t.frameCount ? i : -1;
  }

  private palDown(e: PointerEvent) {
    if (!this.palSet || e.button !== 0) return;
    const i = this.palIndex(e);
    if (i < 0) return;
    this.palette.setPointerCapture(e.pointerId);
    this.palSel = { a: e.shiftKey && this.palSel ? this.palSel.a : i, b: i };
    this.applyPalSel();
  }

  private palMove(e: PointerEvent) {
    if (!this.palSet || !this.palSel) return;
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
    const n = this.palSet!.frameCount;
    const base = this.active * TILE_STRIDE;
    const tiles: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push(y * cols + x < n ? base + y * cols + x : -1);
    this.brush = { w: x1 - x0 + 1, h: y1 - y0 + 1, tiles };
    if (this.tool === "erase" || this.tool === "picker") this.setTool("pen");
    this.renderPalette();
  }

  /** Right click in the palette: make a 4x4 selection an autotile terrain, or undo that. */
  private palMenu(e: MouseEvent) {
    e.preventDefault();
    const t = this.palSet;
    if (!t) return;
    const sel = this.selectedTiles();
    const block = this.brush.w === 4 && this.brush.h === 4 && sel.length === 16;
    const hit = t.autotiles.findIndex((a) => sel.some((f) => a.includes(f)));
    popupMenu(e.clientX, e.clientY, [
      {
        label: "Make autotile from this 4×4 block",
        disabled: !block,
        action: () => {
          t.autotiles = t.autotiles.filter((a) => !a.some((f) => sel.includes(f)));
          t.autotiles.push(sel);
          this.renderPalette();
          this.hooks.flagsChanged(t);
          this.hooks.status("Autotile made · paint any of its tiles and the edges sort themselves out");
        },
      },
      {
        label: "Remove autotile",
        disabled: hit < 0,
        action: () => {
          t.autotiles.splice(hit, 1);
          this.renderPalette();
          this.hooks.flagsChanged(t);
        },
      },
      "-",
      {
        label: `Make animated tile from ${sel.length} tiles`,
        disabled: sel.length < 2,
        action: async () => {
          const r = await form({
            title: "Animated tile",
            message: "These tiles play in order wherever any of them is on a map (water, torches, flowers).",
            fields: [{ key: "fps", label: "Frames per second", type: "number", value: 6, min: 1, max: 60 }],
            ok: "Make",
          });
          if (!r) return;
          t.tileAnims = t.tileAnims.filter((a) => !a.frames.some((f) => sel.includes(f)));
          t.tileAnims.push({ frames: sel, fps: Math.max(1, Number(r.fps) || 6) });
          this.renderPalette();
          this.hooks.flagsChanged(t);
        },
      },
      {
        label: "Stop animating",
        disabled: !t.tileAnims.some((a) => a.frames.some((f) => sel.includes(f))),
        action: () => {
          t.tileAnims = t.tileAnims.filter((a) => !a.frames.some((f) => sel.includes(f)));
          this.renderPalette();
          this.hooks.flagsChanged(t);
        },
      },
      "-",
      { label: "How to lay out an autotile", action: () => void confirmBox("Autotile layout", AUTOTILE_HELP, { ok: "Got it", cancel: "" }) },
    ]);
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

  /** One tab per tileset of the map; the active tab is what the palette paints with. */
  private renderTilesetList() {
    const box = $("map-tilesets");
    box.innerHTML = "";
    $<HTMLButtonElement>("map-tileset-add").disabled = !this.map;
    this.sets().forEach((name, i) => {
      const b = document.createElement("button");
      b.className = "ts-tab" + (i === this.active ? " active" : "");
      b.textContent = name;
      const t = this.project?.get(name);
      b.title = t ? `${t.frameCount} tiles of ${t.w}×${t.h} · right click for options` : `${name} (missing)`;
      b.onclick = () => {
        this.active = i;
        this.brush = { w: 1, h: 1, tiles: [i * TILE_STRIDE] };
        this.palSel = { a: 0, b: 0 };
        this.renderTilesetList();
        this.renderPalette();
      };
      b.oncontextmenu = (e) => {
        e.preventDefault();
        popupMenu(e.clientX, e.clientY, [{ label: "Remove from this map", disabled: this.sets().length < 2, action: () => void this.removeTileset(i) }]);
      };
      box.appendChild(b);
    });
  }

  private addTilesetMenu(e: MouseEvent) {
    const m = this.map, first = this.tileset;
    if (!m || !this.project) return;
    const used = this.sets();
    const items = this.project.sprites
      .filter((s) => !used.includes(s.name))
      .map((s) => {
        const fits = !first || (s.w === first.w && s.h === first.h);
        return { label: `${s.name}   ${s.w}×${s.h}${s.frameCount > 1 ? ` · ${s.frameCount} tiles` : ""}`, disabled: !fits, action: () => this.addTileset(s.name) };
      });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(r.left, r.bottom + 4, items.length ? items : [{ label: "Every sprite is already in this map", disabled: true, action: () => {} }]);
  }

  /** A sprite dropped on the tiles panel: switch to it if the map has it, else add it. */
  private dropTileset(name: string) {
    const i = this.sets().indexOf(name);
    if (i >= 0) {
      this.active = i;
      this.brush = { w: 1, h: 1, tiles: [i * TILE_STRIDE] };
      this.palSel = { a: 0, b: 0 };
      this.renderTilesetList();
      this.renderPalette();
      return;
    }
    const s = this.project?.get(name), first = this.tileset;
    if (!s) return;
    if (first && (s.w !== first.w || s.h !== first.h))
      return this.hooks.status(`"${name}" is ${s.w}×${s.h}, but this map's tiles are ${first.w}×${first.h}`, true);
    this.addTileset(name);
  }

  private addTileset(name: string) {
    const m = this.map;
    if (!m) return;
    m.tilesets = [...this.sets(), name];
    this.active = m.tilesets.length - 1;
    this.brush = { w: 1, h: 1, tiles: [this.active * TILE_STRIDE] };
    this.palSel = { a: 0, b: 0 };
    this.refresh();
    this.hooks.changed();
    this.hooks.status(`"${name}" added · paint with it, the tiles already on the map stay as they are`);
  }

  private async removeTileset(i: number) {
    const m = this.map;
    if (!m) return;
    const sets = this.sets();
    const inUse = m.layers.reduce((n, l) => n + l.data.filter((v) => v >= 0 && Math.floor(v / TILE_STRIDE) === i).length, 0);
    if (inUse && !(await confirmBox(`Remove "${sets[i]}" from this map?`, `${inUse} of its tiles are on the map and will be erased.`, { ok: "Remove", danger: true }))) return;
    this.undoStack = [];
    for (const l of m.layers)
      l.data = l.data.map((v) => {
        if (v < 0) return v;
        const set = Math.floor(v / TILE_STRIDE);
        return set === i ? -1 : set > i ? v - TILE_STRIDE : v;
      });
    const next = sets.filter((_, k) => k !== i);
    m.tileset = next[0];
    if (next.length > 1) m.tilesets = next;
    else delete m.tilesets;
    this.active = 0;
    this.brush = { w: 1, h: 1, tiles: [0] };
    this.palSel = { a: 0, b: 0 };
    this.refresh();
    this.hooks.changed();
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
      eye.innerHTML = `<svg><use href="#${visible ? "i-eye" : "i-eye-off"}" /></svg>`;
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
      el.ondblclick = () => void this.layerSettings(l);
      el.oncontextmenu = (e) => {
        e.preventDefault();
        popupMenu(e.clientX, e.clientY, [{ label: "Layer settings…", action: () => void this.layerSettings(l) }]);
      };
      if (l.parallax || l.repeatX) {
        const tag = document.createElement("span");
        tag.className = "ltag";
        tag.textContent = l.parallax ? `×${l.parallax[0]}` : "repeat";
        tag.title = "Background layer: scrolls at its own speed, never collides";
        el.appendChild(tag);
      }
      list.appendChild(el);
    }
  }

  /** Name, parallax and repeat of a map layer. */
  private async layerSettings(l: MapLayer) {
    const p = l.parallax ?? [1, 1];
    const r = await form({
      title: "Layer settings",
      message: "Scroll speed 1 moves with the camera. Less than 1 is a far background (0.5 = half speed, 0 = fixed), more than 1 a foreground. Layers that don't move at 1 are scenery: they never collide.",
      fields: [
        { key: "name", label: "Name", value: l.name, hint: 'In code: map(name, x, y, { layer = "name" })' },
        { key: "px", label: "Scroll speed X", type: "number", value: p[0], half: true },
        { key: "py", label: "Scroll speed Y", type: "number", value: p[1], half: true },
        { key: "repeat", label: "Repeat sideways forever (backgrounds)", type: "checkbox", value: !!l.repeatX },
      ],
      ok: "Save",
    });
    if (!r) return;
    l.name = String(r.name).trim() || l.name;
    const px = Number(r.px), py = Number(r.py);
    if (Number.isFinite(px) && Number.isFinite(py) && (px !== 1 || py !== 1)) l.parallax = [px, py];
    else delete l.parallax;
    if (r.repeat) l.repeatX = true;
    else delete l.repeatX;
    this.renderLayers();
    this.hooks.changed();
  }

  private async newMap() {
    const p = this.project;
    if (!p) return;
    if (!p.sprites.length) return this.hooks.status("Make a tileset first: a sprite whose frames are the tiles", true);
    const t = this.palSet ?? p.sprites.find((s) => s.frameCount > 1) ?? p.sprites[0];
    const [rw, rh] = p.cart.resolution;
    const size = await askSize("New map", Math.ceil(rw / t.w), Math.ceil(rh / t.h), { message: `Tiles from "${t.name}" (${t.w}×${t.h} pixels each). One screen is ${Math.ceil(rw / t.w)}×${Math.ceil(rh / t.h)} tiles.`, unit: "tiles", ok: "Create" });
    if (!size) return;
    const [w, h] = size;
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

  private async resizeMap() {
    const m = this.map;
    if (!m) return;
    const size = await askSize("Resize map", m.w, m.h, { message: "The tiles stay in the top-left corner.", unit: "tiles", ok: "Resize" });
    if (!size) return;
    const [w, h] = size;
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
    $("map-del").onclick = async () => {
      const p = this.project, m = this.map;
      if (!p || !m || !(await confirmBox(`Delete the map "${m.name}"?`, "Its tiles and objects are removed.", { ok: "Delete", danger: true }))) return;
      p.maps.splice(p.maps.indexOf(m), 1);
      this.selectMap(p.maps[0]?.name ?? null);
      this.hooks.changed();
    };
    $("map-rename").onclick = async () => {
      const m = this.map;
      if (!m) return;
      const n = await ask("Rename map", m.name, { message: 'Used in code: map("name", x, y)', clean: codeName, ok: "Rename" });
      if (!n || this.project!.maps.some((x) => x.name === n)) return;
      m.name = n;
      this.renderMapList();
      this.hooks.changed();
    };
    $("map-tileset-add").onclick = (e) => this.addTilesetMenu(e);
    $("map-play-here").onclick = () => this.startPicking();
    const auto = $<HTMLInputElement>("map-auto");
    try { auto.checked = localStorage.getItem("slate:autotile") !== "0"; } catch {}
    auto.onchange = () => {
      try { localStorage.setItem("slate:autotile", auto.checked ? "1" : "0"); } catch {}
    };
    $<HTMLInputElement>("map-grid").onchange = (e) => { this.grid = (e.target as HTMLInputElement).checked; this.render(); };
    $<HTMLInputElement>("map-dim").onchange = () => this.render();
    $("map-zoom-in").onclick = () => this.view.zoomTo(this.view.step(1));
    $("map-zoom-out").onclick = () => this.view.zoomTo(this.view.step(-1));
    $<HTMLInputElement>("tile-solid").onchange = (e) => {
      const t = this.palSet;
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

  private get templates(): Record<string, ObjectTemplate> {
    return (this.project!.cart.templates ??= {});
  }

  /** An object as the game sees it (its template filled in). */
  private shown(o: MapObject) {
    return resolveObject(o, this.project?.cart.templates);
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
    const img = this.objImage(this.shown(o).sprite);
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
      const tpl = this.tpl ? this.templates[this.tpl] : null;
      const o: MapObject = {
        id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1,
        type: tpl ? tpl.type : $<HTMLInputElement>("obj-type").value.trim() || "object",
        x: this.snap(px, t.w / 2, e.altKey),
        y: this.snap(py, t.h / 2, e.altKey),
      };
      if (tpl) o.template = this.tpl!;
      else {
        const sprite = $<HTMLSelectElement>("obj-sprite").value;
        if (sprite) o.sprite = sprite;
        const props = this.parseProps($<HTMLTextAreaElement>("obj-props").value);
        if (Object.keys(props).length) o.props = props;
      }
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

  /** A sprite dropped from the file list: a new object of that sprite where it was dropped. */
  private dropSprite(name: string, e: DragEvent) {
    const s = this.project?.get(name), t = this.tileset;
    if (!s || !t || !this.map) return;
    const r = this.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / this.zoom, py = (e.clientY - r.top) / this.zoom;
    this.snapshot();
    const list = this.objects();
    // the drop point is the sprite's center; objects are anchored bottom-center
    const o: MapObject = {
      id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1,
      type: name,
      sprite: name,
      x: this.snap(px, t.w / 2, e.altKey),
      y: this.snap(py + s.h / 2, t.h / 2, e.altKey),
    };
    list.push(o);
    this.sel = o;
    this.setTool("object");
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
    this.hooks.status(`Placed "${name}" · in code: objects("${this.map.name}", "${name}")`);
  }

  /** A template chip dropped on the map: a copy of it there. */
  private dropTemplate(name: string, e: DragEvent) {
    const t = this.templates[name], tile = this.tileset;
    if (!t || !tile || !this.map) return;
    const r = this.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / this.zoom, py = (e.clientY - r.top) / this.zoom;
    const h = (t.sprite && this.project?.get(t.sprite)?.h) || 12;
    this.snapshot();
    const list = this.objects();
    const o: MapObject = { id: list.reduce((m, x) => Math.max(m, x.id), 0) + 1, type: t.type, template: name, x: this.snap(px, tile.w / 2, e.altKey), y: this.snap(py + h / 2, tile.h / 2, e.altKey) };
    list.push(o);
    this.sel = o;
    this.setTool("object");
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
  }

  /** "Play from here": the next click on the map starts the game there (or right away at `at`). */
  startPicking(at?: [number, number]) {
    if (!this.map || !this.tileset) return this.hooks.status("Open a map first", true);
    if (at) return this.hooks.playFrom(this.map.name, Math.round(at[0]), Math.round(at[1]));
    this.picking = true;
    this.canvas.classList.add("picking");
    this.hooks.status("Click where the player should start · Esc cancels");
    this.render();
  }

  private stopPicking() {
    this.picking = false;
    this.canvas.classList.remove("picking");
    this.render();
  }

  /** Map pixels under the mouse: the bottom-center of the hovered tile. */
  private get hoverPos(): [number, number] | null {
    const t = this.tileset;
    return this.hover && t ? [(this.hover[0] + 0.5) * t.w, (this.hover[1] + 1) * t.h] : null;
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
      const img = this.objImage(this.shown(o).sprite);
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
        const label = o.template ? `${this.shown(o).type} ◆` : o.type;
        const tw = g.measureText(label).width + 8;
        g.fillStyle = sel ? "#ffcc4d" : "rgba(10,8,16,0.8)";
        g.fillRect(o.x * z - tw / 2, b.y * z - 15, tw, 14);
        g.fillStyle = sel ? "#2a1d00" : "#e8e2f5";
        g.fillText(label, o.x * z, b.y * z - 4);
      }
    }
  }

  /** Template chips: click one to place it, drag one onto the map, "Free" for plain objects. */
  private renderTemplates() {
    const box = $("obj-templates");
    box.innerHTML = "";
    const names = Object.keys(this.project?.cart.templates ?? {});
    if (this.tpl && !names.includes(this.tpl)) this.tpl = null;
    if (!names.length) return;
    const free = document.createElement("button");
    free.className = "free" + (this.tpl === null ? " active" : "");
    free.textContent = "Free";
    free.title = "New objects use the fields below";
    free.onclick = () => { this.tpl = null; this.sel = null; this.renderObjectPanel(); };
    box.appendChild(free);
    for (const n of names) {
      const t = this.templates[n];
      const b = document.createElement("button");
      b.className = n === this.tpl ? "active" : "";
      const img = this.objImage(t.sprite);
      if (img) {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d")!.drawImage(img, 0, 0);
        b.appendChild(c);
      }
      b.append(n);
      b.title = `Template "${n}" · click, then click the map to place · or drag it onto the map · right click for options`;
      b.draggable = true;
      b.ondragstart = (e) => e.dataTransfer?.setData("application/x-slate-template", n);
      b.onclick = () => {
        this.tpl = n;
        this.sel = null;
        this.setTool("object");
        this.renderObjectPanel();
      };
      b.oncontextmenu = (e) => {
        e.preventDefault();
        popupMenu(e.clientX, e.clientY, [
          { label: "Rename…", action: () => void this.renameTemplate(n) },
          { label: "Delete template", action: () => void this.deleteTemplate(n) },
        ]);
      };
      box.appendChild(b);
    }
  }

  private async saveTemplate() {
    const o = this.sel;
    if (!o || !this.project) return;
    const r = this.shown(o);
    let base = r.type.replace(/[^\w-]/g, "_") || "object", name = base, i = 2;
    while (this.templates[name]) name = `${base}${i++}`;
    const n = await ask("Save as template", name, { message: "Place it on any map; changing the template changes every copy.", ok: "Save", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n) return;
    if (this.templates[n] && !(await confirmBox(`Replace the template "${n}"?`, "Every copy will change to this one.", { ok: "Replace", danger: true }))) return;
    this.snapshot();
    this.templates[n] = { type: r.type, ...(r.sprite ? { sprite: r.sprite } : {}), ...(r.props ? { props: { ...r.props } } : {}) };
    o.template = n;
    delete o.props;
    delete o.sprite;
    this.tpl = n;
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
    this.hooks.templatesChanged();
  }

  private async renameTemplate(old: string) {
    const n = await ask("Rename template", old, { ok: "Rename", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n || n === old || this.templates[n]) return;
    this.templates[n] = this.templates[old];
    delete this.templates[old];
    for (const m of this.project?.maps ?? []) for (const o of m.objects ?? []) if (o.template === old) o.template = n;
    if (this.tpl === old) this.tpl = n;
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
    this.hooks.templatesChanged();
  }

  private async deleteTemplate(n: string) {
    const uses = (this.project?.maps ?? []).reduce((k, m) => k + (m.objects ?? []).filter((o) => o.template === n).length, 0);
    if (!(await confirmBox(`Delete the template "${n}"?`, uses ? `Its ${uses} copies stay on the maps as normal objects.` : "No map uses it.", { ok: "Delete", danger: true }))) return;
    const t = this.templates[n];
    // copies keep what the template gave them
    for (const m of this.project?.maps ?? [])
      for (const o of m.objects ?? [])
        if (o.template === n) {
          Object.assign(o, resolveObject(o, { [n]: t }));
          delete o.template;
        }
    delete this.templates[n];
    this.renderObjectPanel();
    this.render();
    this.hooks.changed();
    this.hooks.templatesChanged();
  }

  private renderObjectPanel() {
    this.renderTemplates();
    const sel = $<HTMLSelectElement>("obj-sprite");
    const editingTpl = this.sel?.template ? this.templates[this.sel.template] : !this.sel && this.tpl ? this.templates[this.tpl] : null;
    const keep = editingTpl ? editingTpl.sprite : (this.sel?.sprite ?? sel.value);
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
    $("obj-tpl-save").classList.toggle("hidden", !o || !!o.template);
    $("obj-tpl-detach").classList.toggle("hidden", !o?.template);
    const note = $("obj-tpl-note");
    const tplName = o?.template ?? (!o ? this.tpl : null);
    note.classList.toggle("hidden", !tplName);
    if (tplName) {
      note.innerHTML = o
        ? 'Copy of <b></b>: type and sprite change the template (every copy). Props here are just this one\'s.'
        : 'Placing <b></b>: click the map. Changes here change the template.';
      note.querySelector("b")!.textContent = tplName;
    }
    const props = $<HTMLTextAreaElement>("obj-props");
    if (o) {
      $<HTMLInputElement>("obj-type").value = this.shown(o).type;
      props.value = Object.entries(o.props ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
      props.placeholder = o.template ? Object.entries(this.templates[o.template]?.props ?? {}).map(([k, v]) => `${k}=${v}`).join("\n") || "hp=10" : "hp=10\npath=sine";
      $("obj-pos").textContent = `#${o.id} at ${o.x}, ${o.y}`;
    } else {
      if (editingTpl) {
        $<HTMLInputElement>("obj-type").value = editingTpl.type;
        props.value = Object.entries(editingTpl.props ?? {}).map(([k, v]) => `${k}=${v}`).join("\n");
      }
      props.placeholder = "hp=10\npath=sine";
      $("obj-pos").textContent = editingTpl ? "" : "new objects use these";
    }
  }

  private wireObjects() {
    // editing the fields updates the selected object (or sets the defaults for the next one)
    const apply = () => {
      const o = this.sel;
      const type = $<HTMLInputElement>("obj-type").value.trim() || "object";
      const sprite = $<HTMLSelectElement>("obj-sprite").value;
      const props = this.parseProps($<HTMLTextAreaElement>("obj-props").value);
      // a template (through one of its copies, or the one being placed): type / sprite go to the template
      const tname = o?.template ?? (!o ? this.tpl : null);
      const t = tname ? this.templates[tname] : null;
      if (t) {
        this.snapshot();
        t.type = type;
        if (sprite) t.sprite = sprite;
        else delete t.sprite;
        if (o) {
          o.type = type;
          if (Object.keys(props).length) o.props = props;
          else delete o.props;
        } else if (Object.keys(props).length) t.props = props;
        else delete t.props;
        this.renderTemplates();
        this.render();
        this.hooks.changed();
        this.hooks.templatesChanged();
        return;
      }
      if (!o) return;
      this.snapshot();
      o.type = type;
      if (sprite) o.sprite = sprite;
      else delete o.sprite;
      if (Object.keys(props).length) o.props = props;
      else delete o.props;
      this.render();
      this.hooks.changed();
    };
    $("obj-type").addEventListener("change", apply);
    $("obj-sprite").addEventListener("change", apply);
    $("obj-props").addEventListener("change", apply);
    $("obj-del").onclick = () => this.deleteSelected();
    $("obj-tpl-save").onclick = () => void this.saveTemplate();
    $("obj-tpl-detach").onclick = () => {
      const o = this.sel;
      if (!o?.template) return;
      this.snapshot();
      Object.assign(o, this.shown(o));
      delete o.template;
      this.renderObjectPanel();
      this.render();
      this.hooks.changed();
    };
  }

  /** Map-tab shortcuts. Returns true if handled. */
  handleKey(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { this.undo(e.shiftKey); return true; }
    if (mod && k === "y") { this.undo(true); return true; }
    if (mod) return false;
    if (this.picking && e.key === "Escape") {
      this.stopPicking();
      this.hooks.status("");
      return true;
    }
    // P over the map: play from the hovered tile at once
    if (k === "p") {
      this.startPicking(this.hoverPos ?? undefined);
      return true;
    }
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
    if (e.key === "+" || e.key === "=") { $("map-zoom-in").click(); return true; }
    if (e.key === "-") { $("map-zoom-out").click(); return true; }
    return false;
  }
}
