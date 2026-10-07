// Pixel canvas: drawing tools on the active layer/frame of an EditSprite.
//
// Tools: pen (square or round brush, pixel-perfect, dither), eraser, fill (shift: replace color
// everywhere), picker, line, rect, ellipse (shift: filled), and three ways to select: rectangle,
// lasso and magic wand (shift adds, alt subtracts). A selection can be moved, resized with its
// handles, flipped, rotated, filled, cleared, copied and pasted; painting stays inside it.
// Mirror X/Y, onion skin, grid, undo/redo (cel-level for painting, sprite-level for structure).

import { copyImage, type EditSprite } from "./sprite.ts";
import { flip, resample, rotate } from "./ops.ts";

export type Tool = "pen" | "eraser" | "fill" | "picker" | "line" | "rect" | "ellipse" | "select" | "lasso" | "wand";
export type BrushShape = "square" | "circle";
type RGBA = [number, number, number, number];
type SelOp = "replace" | "add" | "subtract";
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const isSelectTool = (t: Tool) => t === "select" || t === "lasso" || t === "wand";

// Endesga 32 - a popular general purpose pixel art palette
const BASE_PALETTE = [
  "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
  "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
  "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
  "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569",
];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A selection: its bounding box and which pixels inside the box are selected (row by row). */
export interface Selection extends Rect {
  mask: Uint8Array;
}

/** Selected pixels lifted off the cel. src / srcMask are kept unscaled so resizing never degrades. */
interface Floating {
  src: ImageData;
  srcMask: ImageData;
  img: ImageData;
  mask: ImageData;
  x: number;
  y: number;
}

type UndoEntry =
  | { kind: "cel"; layer: number; frame: number; data: Uint8ClampedArray }
  | { kind: "sprite"; snap: EditSprite; frame: number; layer: number };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export class PixelEditor {
  sprite: EditSprite | null = null;
  frame = 0;
  layer = 0;
  tool: Tool = "pen";
  color: RGBA = [255, 255, 255, 255];
  zoom = 8;
  grid = true;
  mirrorX = false;
  mirrorY = false;
  onion = false;
  /** light checkerboard (dark outlines are easier to see) */
  lightBg = false;
  pixelPerfect = true;
  dither = false;
  brush = 1;
  brushShape: BrushShape = "square";
  /** magic wand: only the touching area of the color (off: that color everywhere) */
  wandContiguous = true;
  selection: Selection | null = null;
  private floating: Floating | null = null;
  private clipboard: { img: ImageData; mask: ImageData } | null = null;

  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private ctx: CanvasRenderingContext2D;
  private scratch = document.createElement("canvas");

  // stroke state
  private down = false;
  private erasing = false;
  private filled = false;
  private start: [number, number] = [0, 0];
  private last: [number, number] | null = null;
  private before: Uint8ClampedArray | null = null; // active cel at stroke start
  private trail: [number, number][] = []; // pixel-perfect history
  private hover: [number, number] | null = null;
  // selection gestures
  private dragSel: { dx: number; dy: number } | null = null;
  private selOp: SelOp = "replace";
  private dragRect: Rect | null = null;
  private lassoPts: [number, number][] | null = null;
  private scaling: { handle: Handle; box: Rect } | null = null;
  private moved = false;
  private needFit = false;

  private playTimer = 0;
  private playFrame: number | null = null;

  /** Pixels changed (live sync to the game). */
  onChange: () => void = () => {};
  /** Frames/layers/tags/size changed (panels must re-render). */
  onStructure: () => void = () => {};
  onColor: () => void = () => {};
  onStatus: (s: string) => void = () => {};
  onZoom: () => void = () => {};
  /** Cursor position over the sprite (x, y) and the selection size, for the status bar. */
  onCursor: (x: number, y: number, sel: { w: number; h: number } | null) => void = () => {};
  /** The project's own palette colors; changes are reported with onPalette. */
  projectColors: string[] = [];
  onPalette: (colors: string[]) => void = () => {};
  /** One-shot color pick handler (e.g. "replace color"); return true to consume the pick. */
  onPick: ((rgb: [number, number, number]) => boolean) | null = null;

  constructor(private canvas: HTMLCanvasElement, private paletteEl: HTMLElement) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.render(); });
    window.addEventListener("pointerup", () => this.pointerUp());
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => {
      if (!this.needFit) return;
      this.fit();
      this.render();
      this.onZoom();
    }).observe(canvas.parentElement!);
  }

  get cel(): ImageData | null {
    return this.sprite?.layers[this.layer]?.cels[this.frame] ?? null;
  }

  setSprite(s: EditSprite | null, frame = 0) {
    this.commitFloating();
    this.stopPreview();
    this.sprite = s;
    this.selection = null;
    this.frame = Math.min(frame, (s?.frameCount ?? 1) - 1);
    this.layer = Math.min(this.layer, (s?.layers.length ?? 1) - 1);
    this.needFit = !!s;
    this.fit();
    this.render();
    this.renderPalette();
  }

  /** Zoom so the sprite fills the view (once the view has a size: it may still be hidden). */
  private fit() {
    const s = this.sprite;
    const wrap = this.canvas.parentElement!;
    if (!s || !this.needFit || wrap.clientWidth < 100 || wrap.clientHeight < 100) return;
    this.needFit = false;
    const fit = Math.floor(Math.min((wrap.clientWidth - 80) / s.w, (wrap.clientHeight - 80) / s.h));
    this.zoom = Math.max(1, Math.min(32, fit));
  }

  setZoom(z: number) {
    this.needFit = false;
    this.zoom = Math.max(1, Math.min(48, Math.round(z)));
    this.render();
  }

  setColorHex(hex: string) {
    const v = parseInt(hex.slice(1), 16);
    this.color = [(v >> 16) & 255, (v >> 8) & 255, v & 255, 255];
    this.renderPalette();
  }

  colorHex() {
    return "#" + this.color.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("");
  }

  setTool(t: Tool) {
    if (!isSelectTool(t)) this.commitFloating();
    this.tool = t;
    this.canvas.style.cursor = "";
    this.render();
  }

  // ------------------------------------------------------------ undo

  private pushUndo(e: UndoEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private celUndo() {
    if (this.cel) this.pushUndo({ kind: "cel", layer: this.layer, frame: this.frame, data: this.cel.data.slice() });
  }

  /** Call before any structural change (layers, frames, size, whole-sprite filters). */
  snapshot(snap?: EditSprite) {
    if (this.sprite) this.pushUndo({ kind: "sprite", snap: snap ?? this.sprite.clone(), frame: this.frame, layer: this.layer });
  }

  undo(redo = false) {
    this.commitFloating();
    const s = this.sprite;
    const from = redo ? this.redoStack : this.undoStack;
    const to = redo ? this.undoStack : this.redoStack;
    const e = from.pop();
    if (!e || !s) return;
    if (e.kind === "cel") {
      const cel = s.layers[e.layer]?.cels[e.frame];
      if (!cel) return;
      to.push({ kind: "cel", layer: e.layer, frame: e.frame, data: cel.data.slice() });
      cel.data.set(e.data);
      this.frame = e.frame;
      this.layer = e.layer;
    } else {
      to.push({ kind: "sprite", snap: s.clone(), frame: this.frame, layer: this.layer });
      s.restore(e.snap);
      this.frame = Math.min(e.frame, s.frameCount - 1);
      this.layer = Math.min(e.layer, s.layers.length - 1);
      this.selection = null;
      this.onStructure();
    }
    this.changed();
  }

  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  // ------------------------------------------------------------ pointer

  private cellAt(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [Math.floor((e.clientX - r.left) / this.zoom), Math.floor((e.clientY - r.top) / this.zoom)];
  }

  /** The box of the floating piece or the selection. */
  private selBox(): Rect | null {
    const f = this.floating;
    if (f) return { x: f.x, y: f.y, w: f.img.width, h: f.img.height };
    return this.selection;
  }

  /** Is pixel (x, y) selected (in the floating piece while one is lifted)? */
  private inSelection(x: number, y: number) {
    const f = this.floating;
    if (f) {
      const i = x - f.x, j = y - f.y;
      return i >= 0 && j >= 0 && i < f.mask.width && j < f.mask.height && f.mask.data[(j * f.mask.width + i) * 4 + 3] > 0;
    }
    return selHas(this.selection, x, y);
  }

  /** The resize handle under the pointer, if any (only with a selection tool). */
  private handleAt(e: PointerEvent): Handle | null {
    const b = this.selBox();
    if (!b || !isSelectTool(this.tool)) return null;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    for (const h of HANDLES) {
      const [hx, hy] = handlePos(b, h, this.zoom);
      if (Math.abs(px - hx) <= 6 && Math.abs(py - hy) <= 6) return h;
    }
    return null;
  }

  private pointerDown(e: PointerEvent) {
    const cel = this.cel;
    if (!cel || !this.sprite || e.button === 1) return;
    this.stopPreview();
    const layer = this.sprite.layers[this.layer];
    const selecting = isSelectTool(this.tool);
    if (!layer.visible) {
      this.onStatus("The active layer is hidden - show it to draw on it");
      return;
    }
    if (layer.locked && this.tool !== "picker" && !selecting && !e.altKey) {
      this.onStatus("The active layer is locked - unlock it in the Layers panel");
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.cellAt(e);
    if (this.tool === "picker" || (e.altKey && !selecting)) return this.pick(x, y);

    this.down = true;
    this.moved = false;
    this.erasing = e.button === 2 || this.tool === "eraser";
    this.filled = e.shiftKey;
    this.start = [x, y];
    this.last = [x, y];

    if (selecting) return this.selectDown(e, x, y);

    this.commitFloating();
    this.celUndo();
    this.before = cel.data.slice();
    this.trail = [[x, y]];
    if (this.tool === "fill") {
      if (e.shiftKey) this.replaceInCel(cel, x, y);
      else this.floodFill(cel, x, y);
      this.down = false;
      this.changed();
      return;
    }
    if (this.tool === "pen" || this.tool === "eraser") this.plot(cel, x, y);
    this.changed();
  }

  private selectDown(e: PointerEvent, x: number, y: number) {
    const handle = this.handleAt(e);
    if (handle) {
      if (!this.floating) this.lift();
      const f = this.floating!;
      this.scaling = { handle, box: { x: f.x, y: f.y, w: f.img.width, h: f.img.height } };
      this.render();
      return;
    }
    const op: SelOp = e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";
    if (op === "replace" && this.inSelection(x, y)) {
      if (!this.floating) this.lift();
      this.dragSel = { dx: x - this.floating!.x, dy: y - this.floating!.y };
      this.render();
      return;
    }
    this.commitFloating();
    this.selOp = op;
    if (this.tool === "wand") {
      this.down = false;
      this.applySelection(this.wandMask(x, y));
    } else if (this.tool === "select") this.dragRect = { x, y, w: 1, h: 1 };
    else this.lassoPts = [[x, y]];
    this.render();
  }

  private pointerMove(e: PointerEvent) {
    const [x, y] = this.cellAt(e);
    const moved = !this.hover || this.hover[0] !== x || this.hover[1] !== y;
    this.hover = [x, y];
    if (moved && this.sprite) {
      const b = this.selBox();
      this.onCursor(x, y, b ? { w: b.w, h: b.h } : null);
    }
    if (this.scaling) return this.scaleTo(e);
    if (!this.down && isSelectTool(this.tool)) {
      const h = this.handleAt(e);
      this.canvas.style.cursor = h ? `${h}-resize` : this.inSelection(x, y) ? "move" : "";
    }
    if (!this.down || !this.cel || !this.last) {
      if (moved) this.render();
      return;
    }
    if (x === this.last[0] && y === this.last[1]) return;
    this.moved = true;
    const cel = this.cel;

    switch (this.tool) {
      case "pen":
      case "eraser": {
        let [x0, y0] = this.last;
        for (const [px, py] of line(x0, y0, x, y).slice(1)) {
          this.trail.push([px, py]);
          this.plot(cel, px, py);
          if (this.pixelPerfect && this.tool === "pen" && this.brush === 1) this.fixCorner(cel);
          x0 = px;
          y0 = py;
        }
        break;
      }
      case "line":
      case "rect":
      case "ellipse": {
        cel.data.set(this.before!);
        let pts: [number, number][];
        if (this.tool === "line") pts = line(this.start[0], this.start[1], x, y);
        else if (this.tool === "rect") pts = rectPts(this.start[0], this.start[1], x, y, this.filled);
        else pts = ellipsePts(this.start[0], this.start[1], x, y, this.filled);
        for (const [px, py] of pts) this.plot(cel, px, py);
        break;
      }
      case "select":
      case "lasso":
      case "wand": {
        if (this.dragSel && this.floating) {
          this.floating.x = x - this.dragSel.dx;
          this.floating.y = y - this.dragSel.dy;
        } else if (this.dragRect) {
          const [sx, sy] = this.start;
          this.dragRect = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx) + 1, h: Math.abs(y - sy) + 1 };
        } else if (this.lassoPts) {
          // fill gaps so fast strokes still enclose what they pass
          const [lx, ly] = this.lassoPts[this.lassoPts.length - 1];
          this.lassoPts.push(...line(lx, ly, x, y).slice(1));
        }
        this.last = [x, y];
        this.render();
        return;
      }
    }
    this.last = [x, y];
    this.changed();
  }

  /** Dragging a resize handle: new box from the pointer (Shift on a corner keeps the proportions). */
  private scaleTo(e: PointerEvent) {
    const f = this.floating, s = this.scaling;
    if (!f || !s) return;
    const r = this.canvas.getBoundingClientRect();
    const px = Math.round((e.clientX - r.left) / this.zoom), py = Math.round((e.clientY - r.top) / this.zoom);
    const b = s.box, h = s.handle;
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    if (h.includes("w")) x0 = Math.min(px, x1 - 1);
    if (h.includes("e")) x1 = Math.max(px, x0 + 1);
    if (h.includes("n")) y0 = Math.min(py, y1 - 1);
    if (h.includes("s")) y1 = Math.max(py, y0 + 1);
    if (e.shiftKey && h.length === 2) {
      const k = Math.max((x1 - x0) / b.w, (y1 - y0) / b.h);
      const w = Math.max(1, Math.round(b.w * k)), hh = Math.max(1, Math.round(b.h * k));
      if (h.includes("w")) x0 = x1 - w; else x1 = x0 + w;
      if (h.includes("n")) y0 = y1 - hh; else y1 = y0 + hh;
    }
    const w = x1 - x0, hh = y1 - y0;
    if (w !== f.img.width || hh !== f.img.height) {
      f.img = resample(f.src, w, hh);
      f.mask = resample(f.srcMask, w, hh);
    }
    f.x = x0;
    f.y = y0;
    this.onCursor(px, py, { w, h: hh });
    this.render();
  }

  private pointerUp() {
    if (!this.down && !this.scaling) return;
    this.down = false;
    this.dragSel = null;
    this.last = null;
    this.before = null;
    this.scaling = null;
    const s = this.sprite;
    if (this.dragRect && s) {
      const r = clampRect(this.dragRect, s.w, s.h);
      if (!this.moved && this.selOp === "replace") this.selection = null; // a click outside deselects
      else if (r) this.applySelection(rectMask(r, s.w, s.h));
    } else if (this.lassoPts && s) {
      if (this.lassoPts.length < 3 && this.selOp === "replace") this.selection = null;
      else this.applySelection(polygonMask(this.lassoPts, s.w, s.h));
    }
    this.dragRect = null;
    this.lassoPts = null;
    this.render();
  }

  // ------------------------------------------------------------ painting

  private setPx(img: ImageData, x: number, y: number) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const layer = this.sprite?.layers[this.layer];
    if (layer?.locked) return;
    // alpha lock: only recolor existing pixels, never add or remove any
    if (layer?.alphaLock && (this.erasing || img.data[(y * img.width + x) * 4 + 3] === 0)) return;
    // with a selection, painting stays inside it
    if (this.selection && !this.floating && !selHas(this.selection, x, y)) return;
    if (this.dither && !this.erasing && (x + y) % 2 !== 0) return;
    img.data.set(this.erasing ? [0, 0, 0, 0] : this.color, (y * img.width + x) * 4);
  }

  /** Brush footprint + mirrors. */
  private plot(img: ImageData, x: number, y: number) {
    const b = this.brush;
    const o = Math.floor((b - 1) / 2);
    const m = brushMask(b, this.brushShape);
    for (let dy = 0; dy < b; dy++) {
      for (let dx = 0; dx < b; dx++) {
        if (!m[dy * b + dx]) continue;
        const px = x + dx - o, py = y + dy - o;
        this.setPx(img, px, py);
        if (this.mirrorX) this.setPx(img, img.width - 1 - px, py);
        if (this.mirrorY) this.setPx(img, px, img.height - 1 - py);
        if (this.mirrorX && this.mirrorY) this.setPx(img, img.width - 1 - px, img.height - 1 - py);
      }
    }
  }

  /** Pixel-perfect: remove the middle pixel of an L-shaped corner (classic Aseprite behavior). */
  private fixCorner(img: ImageData) {
    const t = this.trail;
    if (t.length < 3) return;
    const [a, b, c] = t.slice(-3);
    const lShape = (a[0] === b[0] || a[1] === b[1]) && (b[0] === c[0] || b[1] === c[1]) && a[0] !== c[0] && a[1] !== c[1];
    if (!lShape || !this.before) return;
    const o = (b[1] * img.width + b[0]) * 4;
    img.data.set(this.before.subarray(o, o + 4), o);
    t.splice(t.length - 2, 1);
  }

  private pick(x: number, y: number) {
    const s = this.sprite!;
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
    // pick from the active layer first, then from the composite
    let src = this.cel!;
    const o = (y * s.w + x) * 4;
    if (src.data[o + 3] === 0) src = s.flat(this.frame);
    if (src.data[o + 3] === 0) return;
    if (this.onPick?.([src.data[o], src.data[o + 1], src.data[o + 2]])) return;
    this.color = [src.data[o], src.data[o + 1], src.data[o + 2], 255];
    this.renderPalette();
    this.onColor();
  }

  private floodFill(img: ImageData, x: number, y: number) {
    for (const i of sameColor(img, x, y, true)) this.setPx(img, i % img.width, (i / img.width) | 0);
  }

  /** Shift+fill: replace that exact color everywhere in the cel. */
  private replaceInCel(img: ImageData, x: number, y: number) {
    for (const i of sameColor(img, x, y, false)) this.setPx(img, i % img.width, (i / img.width) | 0);
  }

  // ------------------------------------------------------------ selection

  /** Combine a whole-sprite mask with the current selection (replace / add / subtract). */
  private applySelection(full: Uint8Array) {
    const s = this.sprite;
    if (!s) return;
    if (this.selOp !== "replace" && this.selection) {
      const cur = toFull(this.selection, s.w, s.h);
      for (let i = 0; i < full.length; i++) full[i] = this.selOp === "add" ? cur[i] | full[i] : cur[i] & (full[i] ^ 1);
    } else if (this.selOp === "subtract") return;
    this.selection = fromFull(full, s.w, s.h);
  }

  /** Magic wand: the touching area of the clicked color (or that color everywhere). */
  private wandMask(x: number, y: number) {
    const s = this.sprite!;
    const full = new Uint8Array(s.w * s.h);
    for (const i of sameColor(this.cel!, x, y, this.wandContiguous)) full[i] = 1;
    return full;
  }

  /** Cut the selected pixels out of the cel into a floating piece that can be dragged or resized. */
  private lift() {
    const cel = this.cel;
    const sel = this.selection;
    if (!cel || !sel) return;
    this.celUndo();
    const src = new ImageData(sel.w, sel.h);
    const srcMask = new ImageData(sel.w, sel.h);
    for (let j = 0; j < sel.h; j++)
      for (let i = 0; i < sel.w; i++) {
        if (!sel.mask[j * sel.w + i]) continue;
        const o = ((sel.y + j) * cel.width + sel.x + i) * 4, d = (j * sel.w + i) * 4;
        src.data.set(cel.data.subarray(o, o + 4), d);
        srcMask.data[d + 3] = 255;
        cel.data.fill(0, o, o + 4);
      }
    this.floating = { src, srcMask, img: copyImage(src), mask: copyImage(srcMask), x: sel.x, y: sel.y };
  }

  commitFloating() {
    const f = this.floating;
    const cel = this.cel;
    const s = this.sprite;
    if (!f || !cel || !s) {
      this.floating = null;
      return;
    }
    stamp(cel, f.img, f.x, f.y);
    const full = new Uint8Array(s.w * s.h);
    for (let j = 0; j < f.mask.height; j++)
      for (let i = 0; i < f.mask.width; i++) {
        const x = f.x + i, y = f.y + j;
        if (x >= 0 && y >= 0 && x < s.w && y < s.h && f.mask.data[(j * f.mask.width + i) * 4 + 3]) full[y * s.w + x] = 1;
      }
    this.selection = fromFull(full, s.w, s.h);
    this.floating = null;
    this.changed();
  }

  get hasSelection() {
    return !!(this.selection || this.floating);
  }

  selectAll() {
    if (!this.sprite) return;
    this.commitFloating();
    if (!isSelectTool(this.tool)) this.tool = "select";
    this.selection = fromFull(new Uint8Array(this.sprite.w * this.sprite.h).fill(1), this.sprite.w, this.sprite.h);
    this.render();
  }

  deselect() {
    this.commitFloating();
    this.selection = null;
    this.render();
  }

  invertSelection() {
    const s = this.sprite;
    if (!s) return;
    this.commitFloating();
    const full = this.selection ? toFull(this.selection, s.w, s.h) : new Uint8Array(s.w * s.h);
    for (let i = 0; i < full.length; i++) full[i] ^= 1;
    this.selection = fromFull(full, s.w, s.h);
    this.render();
  }

  /** Paint every selected pixel with the current color. */
  fillSelection() {
    this.commitFloating();
    const cel = this.cel, sel = this.selection;
    if (!cel || !sel || this.sprite?.layers[this.layer].locked) return false;
    this.celUndo();
    for (let j = 0; j < sel.h; j++)
      for (let i = 0; i < sel.w; i++)
        if (sel.mask[j * sel.w + i]) cel.data.set(this.color, ((sel.y + j) * cel.width + sel.x + i) * 4);
    this.changed();
    return true;
  }

  /** Flip or rotate the selected pixels (lifting them first). Returns false without a selection. */
  transformSelection(op: "flip-h" | "flip-v" | "rot-cw" | "rot-ccw") {
    if (!this.floating) this.lift();
    const f = this.floating;
    if (!f) return false;
    if (op === "flip-h" || op === "flip-v") {
      const h = op === "flip-h";
      f.src = flip(f.src, h);
      f.srcMask = flip(f.srcMask, h);
      f.img = flip(f.img, h);
      f.mask = flip(f.mask, h);
    } else {
      const cw = op === "rot-cw";
      const [w, h] = [f.img.width, f.img.height];
      f.src = rotate(f.src, cw);
      f.srcMask = rotate(f.srcMask, cw);
      f.img = rotate(f.img, cw);
      f.mask = rotate(f.mask, cw);
      // turn around the center
      f.x += Math.floor((w - h) / 2);
      f.y += Math.floor((h - w) / 2);
    }
    this.changed();
    return true;
  }

  copy(cut = false) {
    const cel = this.cel;
    if (!cel) return;
    if (this.floating) {
      this.clipboard = { img: copyImage(this.floating.img), mask: copyImage(this.floating.mask) };
      if (cut) this.floating = null;
      this.changed();
      return;
    }
    const sel = this.selection ?? fromFull(new Uint8Array(cel.width * cel.height).fill(1), cel.width, cel.height)!;
    const img = new ImageData(sel.w, sel.h), mask = new ImageData(sel.w, sel.h);
    for (let j = 0; j < sel.h; j++)
      for (let i = 0; i < sel.w; i++) {
        if (!sel.mask[j * sel.w + i]) continue;
        const o = ((sel.y + j) * cel.width + sel.x + i) * 4, d = (j * sel.w + i) * 4;
        img.data.set(cel.data.subarray(o, o + 4), d);
        mask.data[d + 3] = 255;
      }
    this.clipboard = { img, mask };
    if (cut) this.clearSelection();
  }

  paste() {
    const c = this.clipboard;
    if (!c || !this.cel) return;
    this.commitFloating();
    this.celUndo();
    const x = this.selection?.x ?? 0, y = this.selection?.y ?? 0;
    this.floating = { src: copyImage(c.img), srcMask: copyImage(c.mask), img: copyImage(c.img), mask: copyImage(c.mask), x, y };
    if (!isSelectTool(this.tool)) this.tool = "select";
    this.onStructure();
    this.render();
  }

  clearSelection() {
    const cel = this.cel;
    if (!cel) return;
    if (this.floating) {
      this.floating = null;
      this.changed();
      return;
    }
    const sel = this.selection;
    if (!sel) return;
    this.celUndo();
    for (let j = 0; j < sel.h; j++)
      for (let i = 0; i < sel.w; i++)
        if (sel.mask[j * sel.w + i]) cel.data.fill(0, ((sel.y + j) * cel.width + sel.x + i) * 4, ((sel.y + j) * cel.width + sel.x + i) * 4 + 4);
    this.changed();
  }

  nudge(dx: number, dy: number) {
    if (!this.selection && !this.floating) return false;
    if (!this.floating) this.lift();
    this.floating!.x += dx;
    this.floating!.y += dy;
    this.render();
    return true;
  }

  // ------------------------------------------------------------ animation preview

  /** Play frames (optionally limited to a tag) on the canvas without changing the edit frame. */
  preview(tag: import("./sprite.ts").Tag | null) {
    this.stopPreview();
    const s = this.sprite;
    if (!s || s.frameCount < 2) return;
    const t0 = performance.now();
    const tick = () => {
      this.playFrame = s.tagFrame(tag, (performance.now() - t0) / 1000);
      this.render();
      this.playTimer = requestAnimationFrame(tick);
    };
    tick();
  }

  stopPreview() {
    if (!this.playTimer) return;
    cancelAnimationFrame(this.playTimer);
    this.playTimer = 0;
    this.playFrame = null;
    this.render();
  }

  get previewing() {
    return this.playTimer !== 0;
  }

  // ------------------------------------------------------------ rendering

  changed() {
    this.render();
    this.onChange();
  }

  render() {
    const s = this.sprite;
    const c = this.canvas;
    if (!s) {
      c.width = c.height = 0;
      return;
    }
    const z = this.zoom;
    const W = s.w, H = s.h;
    if (c.width !== W * z || c.height !== H * z) {
      c.width = W * z;
      c.height = H * z;
    }
    const g = this.ctx;
    g.imageSmoothingEnabled = false;
    const cs = Math.max(4, z);
    for (let y = 0; y < H * z; y += cs)
      for (let x = 0; x < W * z; x += cs) {
        const even = ((x / cs + y / cs) & 1) === 0;
        g.fillStyle = this.lightBg ? (even ? "#d9dde6" : "#c7ccd8") : even ? "#2a2538" : "#221e2e";
        g.fillRect(x, y, cs, cs);
      }
    this.scratch.width = W;
    this.scratch.height = H;
    const sg = this.scratch.getContext("2d")!;
    const draw = (img: ImageData, alpha = 1) => {
      sg.putImageData(img, 0, 0);
      g.globalAlpha = alpha;
      g.drawImage(this.scratch, 0, 0, c.width, c.height);
      g.globalAlpha = 1;
    };
    const frame = this.playFrame ?? this.frame;
    const live = this.playFrame === null;
    if (this.onion && live) {
      if (frame > 0) draw(s.flat(frame - 1), 0.28);
      if (frame < s.frameCount - 1) draw(s.flat(frame + 1), 0.14);
    }
    draw(s.flat(frame));
    const f = this.floating;
    if (f && live) {
      this.scratch.width = f.img.width;
      this.scratch.height = f.img.height;
      sg.putImageData(f.img, 0, 0);
      g.drawImage(this.scratch, f.x * z, f.y * z, f.img.width * z, f.img.height * z);
    }
    if (this.grid && z >= 6) {
      g.strokeStyle = "rgba(255,255,255,0.07)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x++) { g.moveTo(x * z + 0.5, 0); g.lineTo(x * z + 0.5, c.height); }
      for (let y = 0; y <= H; y++) { g.moveTo(0, y * z + 0.5); g.lineTo(c.width, y * z + 0.5); }
      g.stroke();
    }
    if (!live) return;

    // selection outline (marching-ants style: black and white dashes)
    const ants = () => {
      g.save();
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = "#000";
      g.stroke();
      g.strokeStyle = "#fff";
      g.lineDashOffset = 4;
      g.stroke();
      g.restore();
    };
    if (f) {
      const mw = f.mask.width;
      maskPath(g, f.x, f.y, mw, f.mask.height, (i, j) => f.mask.data[(j * mw + i) * 4 + 3] > 0, z);
      ants();
    } else if (this.selection) {
      const sel = this.selection;
      maskPath(g, sel.x, sel.y, sel.w, sel.h, (i, j) => sel.mask[j * sel.w + i] === 1, z);
      ants();
    }
    if (this.dragRect) {
      const r = this.dragRect;
      g.beginPath();
      g.rect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1);
      ants();
    }
    if (this.lassoPts) {
      g.beginPath();
      for (const [i, [px, py]] of this.lassoPts.entries()) {
        if (i === 0) g.moveTo((px + 0.5) * z, (py + 0.5) * z);
        else g.lineTo((px + 0.5) * z, (py + 0.5) * z);
      }
      ants();
    }
    // resize handles
    const box = this.selBox();
    if (box && isSelectTool(this.tool) && !this.dragRect && !this.lassoPts) {
      g.fillStyle = "#fff";
      g.strokeStyle = "#000";
      g.lineWidth = 1;
      for (const h of HANDLES) {
        const [hx, hy] = handlePos(box, h, z);
        g.fillRect(Math.round(hx) - 3, Math.round(hy) - 3, 7, 7);
        g.strokeRect(Math.round(hx) - 3.5, Math.round(hy) - 3.5, 8, 8);
      }
    }
    // brush cursor, in the brush's own shape
    if (this.hover && !this.down && ["pen", "eraser", "line", "rect", "ellipse"].includes(this.tool)) {
      const b = this.brush, o = Math.floor((b - 1) / 2), m = brushMask(b, this.brushShape);
      maskPath(g, this.hover[0] - o, this.hover[1] - o, b, b, (i, j) => m[j * b + i] === 1, z);
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 1;
      g.stroke();
    }
  }

  /** Add the current color to the project palette. */
  addProjectColor(hex = this.colorHex()) {
    if (this.projectColors.includes(hex)) return;
    this.projectColors = [...this.projectColors, hex];
    this.onPalette(this.projectColors);
    this.renderPalette();
  }

  removeProjectColor(hex: string) {
    this.projectColors = this.projectColors.filter((c) => c !== hex);
    this.onPalette(this.projectColors);
    this.renderPalette();
  }

  /** Project colors, the base palette, and the colors already used in this sprite. */
  renderPalette() {
    const el = this.paletteEl;
    el.innerHTML = "";
    const cur = this.colorHex();
    const section = (label: string, colors: string[], o: { removable?: boolean; empty?: string } = {}) => {
      const head = document.createElement("div");
      head.className = "pal-label";
      head.textContent = label;
      const grid = document.createElement("div");
      grid.className = "pal-grid";
      for (const hex of colors) {
        const d = document.createElement("div");
        d.className = "sw" + (hex === cur ? " active" : "");
        d.style.background = hex;
        d.title = o.removable ? `${hex} · right click to remove` : hex;
        d.onclick = () => {
          this.setColorHex(hex);
          this.onColor();
        };
        if (o.removable) {
          d.oncontextmenu = (e) => {
            e.preventDefault();
            this.removeProjectColor(hex);
          };
        }
        grid.appendChild(d);
      }
      if (!colors.length && o.empty) grid.appendChild(Object.assign(document.createElement("div"), { className: "pal-empty", textContent: o.empty }));
      el.append(head, grid);
    };
    section("Project colors", this.projectColors, { removable: true, empty: "Pick a color and press Add" });
    section("Palette", BASE_PALETTE);
    const used = new Set<string>();
    for (const l of this.sprite?.layers ?? []) {
      for (const f of l.cels) {
        for (let i = 0; i < f.data.length && used.size < 32; i += 4) {
          if (f.data[i + 3] === 0) continue;
          used.add("#" + [f.data[i], f.data[i + 1], f.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
        }
      }
    }
    if (used.size) section("In this sprite", [...used]);
  }

}

// ------------------------------------------------------------ brushes

const brushCache = new Map<string, Uint8Array>();

/** Which cells of a b×b brush are painted. Round brushes are tuned to look clean at small sizes. */
export function brushMask(b: number, shape: BrushShape) {
  const key = `${shape}${b}`;
  let m = brushCache.get(key);
  if (m) return m;
  m = new Uint8Array(b * b);
  const c = (b - 1) / 2;
  // a radius a little under b/2 trims the corners: 3 -> plus, 4 -> rounded square, 5+ -> circle
  const r2 = (b / 2 - 0.25) ** 2;
  for (let y = 0; y < b; y++)
    for (let x = 0; x < b; x++) m[y * b + x] = shape === "square" || b <= 2 || (x - c) ** 2 + (y - c) ** 2 <= r2 ? 1 : 0;
  brushCache.set(key, m);
  return m;
}

// ------------------------------------------------------------ selection helpers

function selHas(sel: Selection | null, x: number, y: number) {
  if (!sel) return false;
  const i = x - sel.x, j = y - sel.y;
  return i >= 0 && j >= 0 && i < sel.w && j < sel.h && sel.mask[j * sel.w + i] === 1;
}

function clampRect(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** A selection as a whole-sprite mask. */
function toFull(sel: Selection, W: number, H: number) {
  const full = new Uint8Array(W * H);
  for (let j = 0; j < sel.h; j++)
    for (let i = 0; i < sel.w; i++) {
      const x = sel.x + i, y = sel.y + j;
      if (x >= 0 && y >= 0 && x < W && y < H && sel.mask[j * sel.w + i]) full[y * W + x] = 1;
    }
  return full;
}

/** A whole-sprite mask as a selection trimmed to its box (null when nothing is selected). */
function fromFull(full: Uint8Array, W: number, H: number): Selection | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (full[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) mask.set(full.subarray((y0 + j) * W + x0, (y0 + j) * W + x0 + w), j * w);
  return { x: x0, y: y0, w, h, mask };
}

function rectMask(r: Rect, W: number, H: number) {
  const full = new Uint8Array(W * H);
  for (let y = r.y; y < r.y + r.h; y++) full.fill(1, y * W + r.x, y * W + r.x + r.w);
  return full;
}

/** Pixels whose centers are inside the lasso polygon, plus the pixels the lasso passed over. */
function polygonMask(pts: [number, number][], W: number, H: number) {
  const full = new Uint8Array(W * H);
  let minY = H, maxY = -1;
  for (const [, y] of pts) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, minY); y <= Math.min(H - 1, maxY); y++) {
    // even-odd scanline through the pixel centers (points are pixel centers too)
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) full[y * W + x] = 1;
  }
  for (const [x, y] of pts) if (x >= 0 && y >= 0 && x < W && y < H) full[y * W + x] = 1;
  return full;
}

/** Indices of the pixels with the same RGBA as (x, y): touching it, or anywhere. */
function sameColor(img: ImageData, x: number, y: number, contiguous: boolean): number[] {
  const { width: w, height: h, data } = img;
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  // every fully transparent pixel counts as the same "color"
  const at = (i: number) => (data[i * 4 + 3] === 0 ? 0 : ((data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | data[i * 4 + 3]));
  const target = at(y * w + x);
  const out: number[] = [];
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (at(i) === target) out.push(i);
    return out;
  }
  const stack = [y * w + x];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i] || at(i) !== target) continue;
    seen[i] = 1;
    out.push(i);
    const px = i % w;
    if (px > 0) stack.push(i - 1);
    if (px < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  return out;
}

/** The outline of a pixel mask (at ox, oy) as a path, in zoomed canvas pixels. */
function maskPath(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, has: (i: number, j: number) => boolean, z: number) {
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && has(i, j);
  g.beginPath();
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!has(i, j)) continue;
      const x0 = (ox + i) * z + 0.5, y0 = (oy + j) * z + 0.5, x1 = (ox + i + 1) * z - 0.5, y1 = (oy + j + 1) * z - 0.5;
      if (!inside(i, j - 1)) { g.moveTo(x0 - 0.5, y0); g.lineTo(x1 + 0.5, y0); }
      if (!inside(i, j + 1)) { g.moveTo(x0 - 0.5, y1); g.lineTo(x1 + 0.5, y1); }
      if (!inside(i - 1, j)) { g.moveTo(x0, y0 - 0.5); g.lineTo(x0, y1 + 0.5); }
      if (!inside(i + 1, j)) { g.moveTo(x1, y0 - 0.5); g.lineTo(x1, y1 + 0.5); }
    }
}

/** Where handle h of box b sits, in zoomed canvas pixels. */
function handlePos(b: Rect, h: Handle, z: number): [number, number] {
  const x = h.includes("w") ? b.x * z : h.includes("e") ? (b.x + b.w) * z : (b.x + b.w / 2) * z;
  const y = h.includes("n") ? b.y * z : h.includes("s") ? (b.y + b.h) * z : (b.y + b.h / 2) * z;
  return [x, y];
}

// ------------------------------------------------------------ geometry helpers

export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

function rectPts(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const out: [number, number][] = [];
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++)
      if (filled || x === ax || x === bx || y === ay || y === by) out.push([x, y]);
  return out;
}

/** Pixel ellipse inside the box (x0,y0)-(x1,y1): midpoint-style, symmetric, no gaps. */
function ellipsePts(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
  const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const out: [number, number][] = [];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      if (filled || edge) out.push([x, y]);
    }
  return out;
}

/** Draw src over dst at (x, y) (opaque pixels only). */
export function stamp(dst: ImageData, src: ImageData, x: number, y: number) {
  for (let sy = 0; sy < src.height; sy++) {
    const ty = y + sy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const tx = x + sx;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (sy * src.width + sx) * 4;
      if (src.data[si + 3] === 0) continue;
      dst.data.set(src.data.subarray(si, si + 4), (ty * dst.width + tx) * 4);
    }
  }
}
