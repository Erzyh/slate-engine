// Pixel canvas: drawing tools on the active layer/frame of an EditSprite.
//
// Tools: pen (brush size, pixel-perfect, dither), eraser, fill (shift: replace color everywhere),
// picker, line, rect, ellipse (shift: filled), select (drag inside to move, copy/cut/paste).
// Mirror X/Y, onion skin, grid, undo/redo (cel-level for painting, sprite-level for structure).

import { copyImage, type EditSprite } from "./sprite.ts";

export type Tool = "pen" | "eraser" | "fill" | "picker" | "line" | "rect" | "ellipse" | "select";
type RGBA = [number, number, number, number];

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

type UndoEntry =
  | { kind: "cel"; layer: number; frame: number; data: Uint8ClampedArray }
  | { kind: "sprite"; snap: EditSprite; frame: number; layer: number };

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
  selection: Rect | null = null;
  private floating: { img: ImageData; x: number; y: number } | null = null;
  private clipboard: ImageData | null = null;

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
  private dragSel: { dx: number; dy: number } | null = null;
  private hover: [number, number] | null = null;

  private playTimer = 0;
  private playFrame: number | null = null;

  /** Pixels changed (live sync to the game). */
  onChange: () => void = () => {};
  /** Frames/layers/tags/size changed (panels must re-render). */
  onStructure: () => void = () => {};
  onColor: () => void = () => {};
  onStatus: (s: string) => void = () => {};
  /** One-shot color pick handler (e.g. "replace color"); return true to consume the pick. */
  onPick: ((rgb: [number, number, number]) => boolean) | null = null;

  constructor(private canvas: HTMLCanvasElement, private paletteEl: HTMLElement) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("pointerdown", (e) => this.pointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.pointerMove(e));
    canvas.addEventListener("pointerleave", () => { this.hover = null; this.render(); });
    window.addEventListener("pointerup", () => this.pointerUp());
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.parentElement!.addEventListener("wheel", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.25 : 0.8));
    }, { passive: false });
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
    if (s) {
      const wrap = this.canvas.parentElement!;
      const fit = Math.floor(Math.min((wrap.clientWidth - 24) / s.w, (wrap.clientHeight - 24) / s.h));
      this.zoom = Math.max(1, Math.min(32, fit || 8));
    }
    this.render();
    this.renderPalette();
  }

  setZoom(z: number) {
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
    if (t !== "select") this.commitFloating();
    this.tool = t;
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

  private inSelection(x: number, y: number) {
    const s = this.floating ? { x: this.floating.x, y: this.floating.y, w: this.floating.img.width, h: this.floating.img.height } : this.selection;
    return !!s && x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h;
  }

  private pointerDown(e: PointerEvent) {
    const cel = this.cel;
    if (!cel || !this.sprite) return;
    this.stopPreview();
    const layer = this.sprite.layers[this.layer];
    if (!layer.visible) {
      this.onStatus("The active layer is hidden - show it to draw on it");
      return;
    }
    if (layer.locked && this.tool !== "picker" && this.tool !== "select" && !e.altKey) {
      this.onStatus("The active layer is locked - unlock it in the Layers panel");
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const [x, y] = this.cellAt(e);
    if (this.tool === "picker" || e.altKey) return this.pick(x, y);

    this.down = true;
    this.erasing = e.button === 2 || this.tool === "eraser";
    this.filled = e.shiftKey;
    this.start = [x, y];
    this.last = [x, y];

    if (this.tool === "select") {
      if (this.inSelection(x, y)) {
        if (!this.floating) this.lift();
        this.dragSel = { dx: x - this.floating!.x, dy: y - this.floating!.y };
      } else {
        this.commitFloating();
        this.selection = { x, y, w: 1, h: 1 };
      }
      this.render();
      return;
    }

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

  private pointerMove(e: PointerEvent) {
    const [x, y] = this.cellAt(e);
    const moved = !this.hover || this.hover[0] !== x || this.hover[1] !== y;
    this.hover = [x, y];
    if (moved && this.sprite) this.onStatus(`${x}, ${y}${this.selection ? `  ·  sel ${this.selection.w}×${this.selection.h}` : ""}`);
    if (!this.down || !this.cel || !this.last) {
      if (moved) this.render();
      return;
    }
    if (x === this.last[0] && y === this.last[1]) return;
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
      case "select": {
        if (this.dragSel && this.floating) {
          this.floating.x = x - this.dragSel.dx;
          this.floating.y = y - this.dragSel.dy;
        } else if (this.selection) {
          const [sx, sy] = this.start;
          this.selection = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx) + 1, h: Math.abs(y - sy) + 1 };
        }
        this.last = [x, y];
        this.render();
        return;
      }
    }
    this.last = [x, y];
    this.changed();
  }

  private pointerUp() {
    if (!this.down) return;
    this.down = false;
    this.dragSel = null;
    this.last = null;
    this.before = null;
    if (this.tool === "select" && this.selection) this.selection = this.clampRect(this.selection);
    this.render();
  }

  // ------------------------------------------------------------ painting

  private setPx(img: ImageData, x: number, y: number) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const layer = this.sprite?.layers[this.layer];
    if (layer?.locked) return;
    // alpha lock: only recolor existing pixels, never add or remove any
    if (layer?.alphaLock && (this.erasing || img.data[(y * img.width + x) * 4 + 3] === 0)) return;
    if (this.selection && !this.floating && !(x >= this.selection.x && y >= this.selection.y && x < this.selection.x + this.selection.w && y < this.selection.y + this.selection.h)) return;
    if (this.dither && !this.erasing && (x + y) % 2 !== 0) return;
    img.data.set(this.erasing ? [0, 0, 0, 0] : this.color, (y * img.width + x) * 4);
  }

  /** Brush footprint + mirrors. */
  private plot(img: ImageData, x: number, y: number) {
    const b = this.brush;
    const o = Math.floor((b - 1) / 2);
    for (let dy = 0; dy < b; dy++) {
      for (let dx = 0; dx < b; dx++) {
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
    const { width: w, height: h, data } = img;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const at = (i: number) => (data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | data[i * 4 + 3];
    const target = at(y * w + x);
    const stack = [y * w + x];
    const seen = new Uint8Array(w * h);
    while (stack.length) {
      const i = stack.pop()!;
      if (seen[i] || at(i) !== target) continue;
      seen[i] = 1;
      this.setPx(img, i % w, (i / w) | 0);
      const px = i % w;
      if (px > 0) stack.push(i - 1);
      if (px < w - 1) stack.push(i + 1);
      if (i >= w) stack.push(i - w);
      if (i < w * (h - 1)) stack.push(i + w);
    }
  }

  /** Shift+fill: replace that exact color everywhere in the cel. */
  private replaceInCel(img: ImageData, x: number, y: number) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const o = (y * img.width + x) * 4;
    const t = img.data.slice(o, o + 4);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] === t[0] && img.data[i + 1] === t[1] && img.data[i + 2] === t[2] && img.data[i + 3] === t[3]) {
        this.setPx(img, (i / 4) % img.width, ((i / 4) / img.width) | 0);
      }
    }
  }

  // ------------------------------------------------------------ selection

  private clampRect(r: Rect): Rect | null {
    const s = this.sprite!;
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
    const x1 = Math.min(s.w, r.x + r.w), y1 = Math.min(s.h, r.y + r.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  private region(img: ImageData, r: Rect) {
    const out = new ImageData(r.w, r.h);
    for (let y = 0; y < r.h; y++) {
      const src = ((r.y + y) * img.width + r.x) * 4;
      out.data.set(img.data.subarray(src, src + r.w * 4), y * r.w * 4);
    }
    return out;
  }

  /** Cut the selected pixels out of the cel into a floating piece that can be dragged. */
  private lift() {
    const cel = this.cel;
    if (!cel || !this.selection) return;
    this.celUndo();
    const r = this.selection;
    this.floating = { img: this.region(cel, r), x: r.x, y: r.y };
    for (let y = 0; y < r.h; y++) cel.data.fill(0, ((r.y + y) * cel.width + r.x) * 4, ((r.y + y) * cel.width + r.x + r.w) * 4);
  }

  commitFloating() {
    const f = this.floating;
    const cel = this.cel;
    if (!f || !cel) {
      this.floating = null;
      return;
    }
    stamp(cel, f.img, f.x, f.y);
    this.selection = this.sprite ? this.clampRect({ x: f.x, y: f.y, w: f.img.width, h: f.img.height }) : null;
    this.floating = null;
    this.changed();
  }

  selectAll() {
    if (!this.sprite) return;
    this.commitFloating();
    this.tool = "select";
    this.selection = { x: 0, y: 0, w: this.sprite.w, h: this.sprite.h };
    this.render();
  }

  deselect() {
    this.commitFloating();
    this.selection = null;
    this.render();
  }

  copy(cut = false) {
    const cel = this.cel;
    if (!cel) return;
    if (this.floating) {
      this.clipboard = copyImage(this.floating.img);
      if (cut) this.floating = null;
      this.changed();
      return;
    }
    const r = this.selection ?? { x: 0, y: 0, w: cel.width, h: cel.height };
    this.clipboard = this.region(cel, r);
    if (cut) this.clearSelection();
  }

  paste() {
    if (!this.clipboard || !this.cel) return;
    this.commitFloating();
    this.celUndo();
    const x = this.selection?.x ?? 0, y = this.selection?.y ?? 0;
    this.floating = { img: copyImage(this.clipboard), x, y };
    this.tool = "select";
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
    const r = this.selection;
    if (!r) return;
    this.celUndo();
    for (let y = 0; y < r.h; y++) cel.data.fill(0, ((r.y + y) * cel.width + r.x) * 4, ((r.y + y) * cel.width + r.x + r.w) * 4);
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
    if (this.onion && this.playFrame === null) {
      if (frame > 0) draw(s.flat(frame - 1), 0.28);
      if (frame < s.frameCount - 1) draw(s.flat(frame + 1), 0.14);
    }
    draw(s.flat(frame));
    if (this.floating && this.playFrame === null) {
      const f = this.floating;
      sg.clearRect(0, 0, W, H);
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
    // selection marquee
    const sel = this.floating ? { x: this.floating.x, y: this.floating.y, w: this.floating.img.width, h: this.floating.img.height } : this.selection;
    if (sel && this.playFrame === null) {
      g.save();
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = "#000";
      g.strokeRect(sel.x * z + 0.5, sel.y * z + 0.5, sel.w * z - 1, sel.h * z - 1);
      g.strokeStyle = "#fff";
      g.lineDashOffset = 4;
      g.strokeRect(sel.x * z + 0.5, sel.y * z + 0.5, sel.w * z - 1, sel.h * z - 1);
      g.restore();
    }
    // brush cursor
    if (this.hover && !this.down && this.playFrame === null && ["pen", "eraser", "line", "rect", "ellipse"].includes(this.tool)) {
      const o = Math.floor((this.brush - 1) / 2);
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 1;
      g.strokeRect((this.hover[0] - o) * z + 0.5, (this.hover[1] - o) * z + 0.5, this.brush * z - 1, this.brush * z - 1);
    }
  }

  /** Base palette plus the colors already used in this sprite. */
  renderPalette() {
    const el = this.paletteEl;
    el.innerHTML = "";
    const cur = this.colorHex();
    const add = (hex: string) => {
      const d = document.createElement("div");
      d.className = "sw" + (hex === cur ? " active" : "");
      d.style.background = hex;
      d.title = hex;
      d.onclick = () => {
        this.setColorHex(hex);
        this.onColor();
      };
      el.appendChild(d);
    };
    BASE_PALETTE.forEach(add);
    const used = new Set<string>();
    for (const l of this.sprite?.layers ?? []) {
      for (const f of l.cels) {
        for (let i = 0; i < f.data.length && used.size < 64; i += 4) {
          if (f.data[i + 3] === 0) continue;
          used.add("#" + [f.data[i], f.data[i + 1], f.data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
        }
      }
    }
    if (used.size) {
      const sep = document.createElement("div");
      sep.className = "sep";
      el.appendChild(sep);
      [...used].forEach(add);
    }
  }
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
