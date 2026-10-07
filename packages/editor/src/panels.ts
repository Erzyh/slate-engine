// Pixel tab UI around the canvas: tool options, color + palette, layers, timeline (frames + tag bars),
// image / sheet operations, the color adjustment dialog and keyboard shortcuts.

import { popupMenu } from "./menu.ts";
import { ask, askSize, form } from "./modal.ts";
import { adjust, canvasSize, contentBounds, flip, NO_ADJUST, outline, replaceColor, resample, rotate, type Adjust } from "./ops.ts";
import { isSelectTool, type BrushShape, type PixelEditor, type Tool } from "./pixel-editor.ts";
import { canvasView } from "./canvas-view.ts";
import { buildGif, buildSheet, pngBytes, sliceSheet } from "./sheet.ts";
import { copyImage, type EditSprite, type Tag, type TagDir } from "./sprite.ts";

export interface PanelHooks {
  /** Pixels of the current sprite changed (sync game + thumbnails). */
  pixelsChanged(): void;
  /** Frames/layers/size changed (sprite list, game, autosave). */
  structureChanged(): void;
  status(msg: string, error?: boolean): void;
  /** right side of the status bar: sprite, size, frame, cursor */
  info(msg: string): void;
  saveBinary(name: string, bytes: Uint8Array, ext: string, label: string): Promise<string | null>;
  saveText(name: string, text: string, ext: string, label: string): Promise<string | null>;
  addSprite(name: string, frames: ImageData[]): void;
  /** the project palette changed (saved in slate.json) */
  paletteChanged(colors: string[]): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DIR_NAME: Record<TagDir, string> = { forward: "Forward", reverse: "Reverse", pingpong: "Ping-pong" };
const DIR_MARK: Record<TagDir, string> = { forward: "", reverse: "rev", pingpong: "ping-pong" };
/** tag bar colors, in order */
const TAG_COLORS = ["#7ee2b8", "#8ab4ff", "#f09bd0", "#ffcd75", "#c3a6ff", "#ff9f80", "#7fd7e8"];
const TOOL_NAME: Record<Tool, string> = {
  pen: "Pen", eraser: "Eraser", fill: "Fill", picker: "Color picker", line: "Line", rect: "Rectangle", ellipse: "Ellipse",
  select: "Select", lasso: "Lasso", wand: "Magic wand", hitbox: "Hitbox",
};
const TOOL_HINT: Partial<Record<Tool, string>> = {
  fill: "Shift+click replaces that color everywhere",
  picker: "Alt+click picks with any tool",
  rect: "Shift: filled",
  ellipse: "Shift: filled",
  select: "Shift adds · Alt subtracts · drag inside to move · handles resize",
  lasso: "Shift adds · Alt subtracts · drag inside to move · handles resize",
  wand: "Shift adds · Alt subtracts · drag inside to move · handles resize",
  hitbox: "Drag to draw the collision box · in code: hitbox(\"name\", x, y)",
};
/** frame thumbnail width + gap (tag bars line up with it) */
const FRAME_STEP = 48;

function thumb(img: ImageData) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

export class PixelPanels {
  private rangeFrom = 0;
  private rangeTo = 0;
  private activeTag: number | null = null;
  private adjustSnap: EditSprite | null = null;
  private cursor: [number, number] | null = null;

  constructor(private ed: PixelEditor, private hooks: PanelHooks) {
    this.wireToolbar();
    ed.onZoom = () => this.updateZoom();
    this.wireColor();
    this.wireLayers();
    this.wireTimeline();
    this.wireSheetInput();
    this.wireAdjust();
    ed.onStructure = () => {
      this.refresh();
      hooks.structureChanged();
    };
    ed.onStatus = (s) => hooks.status(s);
    ed.onCursor = (x, y, sel) => {
      this.cursor = [x, y];
      this.showInfo(sel);
      if (ed.tool === "hitbox") this.showHitbox();
    };
    ed.onPalette = (colors) => hooks.paletteChanged(colors);
  }

  get sprite() {
    return this.ed.sprite;
  }

  setProjectPalette(colors: string[]) {
    this.ed.projectColors = [...colors];
    this.ed.renderPalette();
  }

  /** Re-render everything that depends on the sprite. */
  refresh() {
    const s = this.sprite;
    this.rangeFrom = this.rangeTo = this.ed.frame;
    if (this.activeTag !== null && !s?.tags[this.activeTag]) this.activeTag = null;
    $<HTMLInputElement>("fps").value = String(s?.fps ?? 8);
    this.showFrameMs();
    this.renderLayers();
    this.renderFrames();
    this.renderTags();
    this.updateZoom();
    this.showColor();
    this.showHitbox();
    this.cursor = null;
    this.showInfo(null);
  }

  /** Light refresh after painting: thumbnails only. */
  refreshThumbs() {
    const s = this.sprite;
    if (!s) return;
    const fl = $("frame-list").children[this.ed.frame]?.querySelector("canvas");
    fl?.getContext("2d")!.putImageData(s.flat(this.ed.frame), 0, 0);
    const layerEls = $("layer-list").children;
    s.layers.forEach((l, i) => {
      const el = layerEls[s.layers.length - 1 - i] as HTMLElement | undefined;
      el?.querySelector("canvas")?.getContext("2d")!.putImageData(l.cels[this.ed.frame], 0, 0);
    });
  }

  private showInfo(sel: { w: number; h: number } | null) {
    const s = this.sprite;
    if (!s) return this.hooks.info("");
    const parts = [s.name, `${s.w}×${s.h}`, `frame ${this.ed.frame + 1} / ${s.frameCount}`];
    if (this.cursor) parts.push(`x ${this.cursor[0]}, y ${this.cursor[1]}`);
    if (sel) parts.push(`selection ${sel.w}×${sel.h}`);
    this.hooks.info(parts.join("   ·   "));
  }

  private structural(fn: (s: EditSprite) => void) {
    const s = this.sprite;
    if (!s) return;
    this.ed.commitFloating();
    this.ed.snapshot();
    fn(s);
    this.ed.frame = Math.min(this.ed.frame, s.frameCount - 1);
    this.ed.layer = Math.max(0, Math.min(this.ed.layer, s.layers.length - 1));
    this.ed.render();
    this.ed.onStructure();
  }

  // ------------------------------------------------------------ tools + options

  setTool(t: Tool) {
    this.ed.setTool(t);
    for (const b of document.querySelectorAll<HTMLElement>("#tools button")) b.classList.toggle("active", b.dataset.tool === t);
    // the options bar shows only what applies to this tool
    $("tool-name").textContent = TOOL_NAME[t];
    const brush = t === "pen" || t === "eraser" || t === "line";
    $("opt-brush").classList.toggle("hidden", !brush);
    $("opt-mirror").classList.toggle("hidden", !(brush || t === "fill" || t === "rect" || t === "ellipse"));
    $("opt-select").classList.toggle("hidden", !isSelectTool(t));
    $("opt-contiguous").classList.toggle("hidden", t !== "wand");
    $("opt-hitbox").classList.toggle("hidden", t !== "hitbox");
    this.showHitbox();
    $("opt-hint").textContent = TOOL_HINT[t] ?? "";
  }

  /** The hitbox numbers in the options bar. */
  showHitbox() {
    const b = this.ed.hitbox;
    $("hitbox-info").textContent = b ? `x ${b.x}  y ${b.y}  w ${b.w}  h ${b.h}` : "none: the whole sprite";
  }

  private updateZoom() {
    $("zoom-label").textContent = `${this.ed.zoom * 100}%`;
  }

  private wireToolbar() {
    const ed = this.ed;
    for (const b of document.querySelectorAll<HTMLElement>("#tools button")) b.onclick = () => this.setTool(b.dataset.tool as Tool);
    const check = (id: string, fn: (v: boolean) => void) => {
      $<HTMLInputElement>(id).onchange = (e) => {
        fn((e.target as HTMLInputElement).checked);
        ed.render();
      };
    };
    check("pixel-perfect", (v) => (ed.pixelPerfect = v));
    check("dither", (v) => (ed.dither = v));
    check("mirror-x", (v) => (ed.mirrorX = v));
    check("mirror-y", (v) => (ed.mirrorY = v));
    check("grid", (v) => (ed.grid = v));
    check("onion", (v) => (ed.onion = v));
    check("light-bg", (v) => (ed.lightBg = v));
    $<HTMLInputElement>("brush").onchange = (e) => this.setBrush(Number((e.target as HTMLInputElement).value));
    for (const b of $("brush-shape").querySelectorAll<HTMLElement>("button")) {
      b.onclick = () => {
        ed.brushShape = b.dataset.shape as BrushShape;
        for (const o of $("brush-shape").children) o.classList.toggle("active", o === b);
        ed.render();
      };
    }
    check("wand-contiguous", (v) => (ed.wandContiguous = v));
    for (const b of $("opt-select").querySelectorAll<HTMLElement>("button[data-sel]")) b.onclick = () => this.command(`sel-${b.dataset.sel}`);
    $("hitbox-clear").onclick = () => { ed.setHitbox(null); this.showHitbox(); };
    $("hitbox-fit").onclick = () => {
      // the box around the visible pixels of every frame
      const s = this.sprite;
      if (!s) return;
      let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
      for (let f = 0; f < s.frameCount; f++) {
        const d = s.flat(f).data;
        for (let y = 0; y < s.h; y++)
          for (let x = 0; x < s.w; x++)
            if (d[(y * s.w + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      if (x1 >= 0) ed.setHitbox({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
      this.showHitbox();
    };
    const view = canvasView($("canvas-wrap"), $<HTMLCanvasElement>("pixel-canvas"), {
      zoom: () => ed.zoom,
      setZoom: (z) => ed.setZoom(z),
      levels: [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48],
      changed: () => this.updateZoom(),
    });
    $("zoom-in").onclick = () => view.zoomTo(view.step(1));
    $("zoom-out").onclick = () => view.zoomTo(view.step(-1));
    this.setTool("pen");
  }

  private setBrush(n: number) {
    this.ed.brush = Math.max(1, Math.min(16, Math.round(n) || 1));
    $<HTMLInputElement>("brush").value = String(this.ed.brush);
    this.ed.render();
  }

  // ------------------------------------------------------------ color

  private showColor() {
    const hex = this.ed.colorHex();
    $<HTMLInputElement>("color").value = hex;
    $("color-swatch").style.background = hex;
    if (document.activeElement !== $("color-hex")) $<HTMLInputElement>("color-hex").value = hex;
  }

  private wireColor() {
    const ed = this.ed;
    ed.onColor = () => this.showColor();
    $<HTMLInputElement>("color").oninput = (e) => {
      ed.setColorHex((e.target as HTMLInputElement).value);
      this.showColor();
    };
    const hexIn = $<HTMLInputElement>("color-hex");
    hexIn.oninput = () => {
      const v = hexIn.value.trim();
      const m = v.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
      if (!m) return;
      const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
      ed.setColorHex(`#${h.toLowerCase()}`);
      this.showColor();
    };
    hexIn.onblur = () => this.showColor();
    $("palette-add").onclick = () => ed.addProjectColor();
  }

  // ------------------------------------------------------------ layers

  private renderLayers() {
    const list = $("layer-list");
    list.innerHTML = "";
    const s = this.sprite;
    if (!s) return;
    for (let i = s.layers.length - 1; i >= 0; i--) {
      const l = s.layers[i];
      const el = document.createElement("div");
      el.className = "layer" + (i === this.ed.layer ? " active" : "");
      const eye = document.createElement("button");
      eye.className = "eye" + (l.visible ? "" : " off");
      eye.innerHTML = `<svg><use href="#${l.visible ? "i-eye" : "i-eye-off"}" /></svg>`;
      eye.title = l.visible ? "Hide" : "Show";
      eye.onclick = (e) => {
        e.stopPropagation();
        l.visible = !l.visible;
        this.ed.render();
        this.renderLayers();
        this.renderFrames();
        this.hooks.pixelsChanged();
      };
      const name = document.createElement("span");
      name.className = "lname";
      name.textContent = l.name;
      const toggle = (cls: string, icon: string, on: boolean, title: string, flipIt: () => void) => {
        const b = document.createElement("button");
        b.className = `lock ${cls}` + (on ? " on" : "");
        b.title = title;
        b.innerHTML = `<svg><use href="#${icon}" /></svg>`;
        b.onclick = (ev) => {
          ev.stopPropagation();
          flipIt();
          this.renderLayers();
          this.hooks.structureChanged();
        };
        return b;
      };
      const alpha = toggle("alpha", "i-alpha", !!l.alphaLock, "Lock transparency: paint only over existing pixels", () => (l.alphaLock = !l.alphaLock));
      const lock = toggle("full", "i-lock", !!l.locked, "Lock layer", () => (l.locked = !l.locked));
      el.append(eye, thumb(l.cels[this.ed.frame]), name, alpha, lock);
      el.onclick = () => {
        this.ed.commitFloating();
        this.ed.layer = i;
        this.renderLayers();
      };
      el.ondblclick = async () => {
        const n = await ask("Rename layer", l.name, { ok: "Rename" });
        if (n) {
          l.name = n;
          this.renderLayers();
          this.hooks.structureChanged();
        }
      };
      list.appendChild(el);
    }
    const op = Math.round((s.layers[this.ed.layer]?.opacity ?? 1) * 100);
    $<HTMLInputElement>("layer-opacity").value = String(op);
    $("layer-opacity-v").textContent = `${op}%`;
  }

  private wireLayers() {
    $("layer-add").onclick = () => this.structural((s) => {
      s.addLayer(this.ed.layer + 1);
      this.ed.layer++;
    });
    $("layer-dup").onclick = () => this.structural((s) => {
      s.duplicateLayer(this.ed.layer);
      this.ed.layer++;
    });
    $("layer-del").onclick = () => this.structural((s) => s.removeLayer(this.ed.layer));
    $("layer-merge").onclick = () => this.structural((s) => {
      if (this.ed.layer === 0) return;
      s.mergeDown(this.ed.layer);
      this.ed.layer--;
    });
    const move = (d: number) => this.structural((s) => {
      const i = this.ed.layer, j = i + d;
      if (j < 0 || j >= s.layers.length) return;
      [s.layers[i], s.layers[j]] = [s.layers[j], s.layers[i]];
      this.ed.layer = j;
    });
    $("layer-up").onclick = () => move(1);
    $("layer-down").onclick = () => move(-1);
    let snapped = false;
    const op = $<HTMLInputElement>("layer-opacity");
    op.oninput = () => {
      const l = this.sprite?.layers[this.ed.layer];
      if (!l) return;
      if (!snapped) {
        this.ed.snapshot();
        snapped = true;
      }
      l.opacity = Number(op.value) / 100;
      $("layer-opacity-v").textContent = `${op.value}%`;
      this.ed.render();
      this.hooks.pixelsChanged();
    };
    op.onchange = () => {
      snapped = false;
      this.renderFrames();
      this.hooks.structureChanged();
    };
  }

  // ------------------------------------------------------------ timeline

  /** The selected frame's own duration (empty = it uses the sprite's FPS). */
  private showFrameMs() {
    const s = this.sprite;
    const d = s?.durations[this.ed.frame] ?? 0;
    $<HTMLInputElement>("frame-ms").value = d > 0 ? String(d) : "";
    $<HTMLInputElement>("frame-ms").placeholder = s ? `${Math.round(1000 / Math.max(1, s.fps))}` : "auto";
  }

  private renderFrames() {
    this.showFrameMs();
    const list = $("frame-list");
    list.innerHTML = "";
    const s = this.sprite;
    if (!s) return;
    const [a, b] = [Math.min(this.rangeFrom, this.rangeTo), Math.max(this.rangeFrom, this.rangeTo)];
    for (let i = 0; i < s.frameCount; i++) {
      const box = document.createElement("div");
      box.className = "frame";
      const c = thumb(s.flat(i));
      if (i === this.ed.frame) box.classList.add("active");
      else if (i >= a && i <= b && a !== b) box.classList.add("in-range");
      const ms = s.durations[i] ?? 0;
      if (ms > 0) box.classList.add("timed");
      const tags = s.tags.filter((t) => i >= t.from && i <= t.to).map((t) => t.name);
      box.title = `Frame ${i + 1} · ${Math.round(s.frameMs(i))} ms${ms > 0 ? " (own time)" : ""}${tags.length ? ` · ${tags.join(", ")}` : ""}`;
      const num = Object.assign(document.createElement("span"), { className: "num", textContent: String(i + 1) });
      box.append(c, num);
      box.onclick = (e) => {
        this.ed.commitFloating();
        this.ed.stopPreview();
        if (e.shiftKey) this.rangeTo = i;
        else this.rangeFrom = this.rangeTo = i;
        this.ed.frame = i;
        this.ed.render();
        this.renderFrames();
        this.renderLayers();
        this.setPlayButton();
        this.showInfo(null);
      };
      list.appendChild(box);
    }
  }

  private gotoFrame(i: number) {
    const s = this.sprite;
    if (!s) return;
    this.ed.commitFloating();
    this.ed.frame = (i + s.frameCount) % s.frameCount;
    this.rangeFrom = this.rangeTo = this.ed.frame;
    this.ed.render();
    this.renderFrames();
    this.renderLayers();
    this.showInfo(null);
  }

  /** Tags as colored bars over the frames they cover. */
  private renderTags() {
    const list = $("tag-list");
    list.innerHTML = "";
    const s = this.sprite;
    if (!s) return;
    s.tags.forEach((t, i) => {
      const el = document.createElement("div");
      el.className = "tag-bar" + (i === this.activeTag ? " active" : "");
      el.style.left = `${t.from * FRAME_STEP}px`;
      el.style.width = `${(t.to - t.from + 1) * FRAME_STEP - 4}px`;
      el.style.background = TAG_COLORS[i % TAG_COLORS.length];
      el.title = `${t.name}: frames ${t.from + 1}-${t.to + 1}, ${DIR_NAME[t.dir].toLowerCase()} · in code: Anim.new("${s.name}", "${t.name}") · right click for options`;
      el.appendChild(Object.assign(document.createElement("span"), { textContent: t.name }));
      if (DIR_MARK[t.dir]) el.appendChild(Object.assign(document.createElement("span"), { className: "dir", textContent: DIR_MARK[t.dir] }));
      el.onclick = () => {
        this.activeTag = this.activeTag === i ? null : i;
        if (this.activeTag !== null) {
          this.rangeFrom = t.from;
          this.rangeTo = t.to;
          this.ed.frame = t.from;
          this.ed.render();
          if (this.ed.previewing) this.ed.preview(t);
        }
        this.renderFrames();
        this.renderTags();
      };
      const rename = async () => {
        const n = await ask("Rename tag", t.name, { message: 'Used in code: anim = "name"', clean: (v) => v.replace(/[^\w-]/g, "_"), ok: "Rename" });
        if (n) this.structural(() => (t.name = n));
      };
      el.ondblclick = () => void rename();
      el.oncontextmenu = (e) => {
        e.preventDefault();
        popupMenu(e.clientX, e.clientY, [
          { label: "Rename", action: () => void rename() },
          { header: "Play direction" },
          ...(["forward", "reverse", "pingpong"] as TagDir[]).map((d) => ({ label: DIR_NAME[d], checked: t.dir === d, action: () => this.structural(() => (t.dir = d)) })),
          "-",
          { label: "Delete tag", action: () => this.structural((sp) => sp.tags.splice(i, 1)) },
        ]);
      };
      list.appendChild(el);
    });
  }

  private togglePreview() {
    if (this.ed.previewing) this.ed.stopPreview();
    else this.ed.preview(this.activeTag !== null ? this.sprite?.tags[this.activeTag] ?? null : null);
    this.setPlayButton();
  }

  private setPlayButton() {
    const b = $("anim-play");
    b.classList.toggle("playing", this.ed.previewing);
    b.innerHTML = `<svg><use href="#${this.ed.previewing ? "i-stop" : "i-play"}" /></svg>`;
  }

  private wireTimeline() {
    $("anim-play").onclick = () => this.togglePreview();
    $("frame-add").onclick = () => this.structural((s) => {
      s.insertFrame(this.ed.frame + 1);
      this.ed.frame++;
    });
    $("frame-dup").onclick = () => this.structural((s) => {
      s.insertFrame(this.ed.frame + 1, this.ed.frame);
      this.ed.frame++;
    });
    $("frame-del").onclick = () => this.structural((s) => s.removeFrame(this.ed.frame));
    const move = (d: number) => this.structural((s) => {
      const i = this.ed.frame, j = i + d;
      if (j < 0 || j >= s.frameCount) return;
      s.moveFrame(i, j);
      this.ed.frame = j;
    });
    $("frame-left").onclick = () => move(-1);
    $("frame-right").onclick = () => move(1);
    $<HTMLInputElement>("fps").onchange = (e) => {
      const s = this.sprite;
      if (!s) return;
      s.fps = Math.max(1, Math.min(60, Number((e.target as HTMLInputElement).value) || 8));
      if (this.ed.previewing) this.ed.preview(this.activeTag !== null ? s.tags[this.activeTag] : null);
      this.hooks.structureChanged();
    };
    $<HTMLInputElement>("frame-ms").onchange = (e) => {
      const v = Math.max(0, Math.min(10000, Math.round(Number((e.target as HTMLInputElement).value) || 0)));
      // with a range selected (shift+click), every frame in it gets the duration
      const [a, b] = [Math.min(this.rangeFrom, this.rangeTo), Math.max(this.rangeFrom, this.rangeTo)];
      this.structural((s) => {
        while (s.durations.length < s.frameCount) s.durations.push(0);
        for (let i = a; i <= b; i++) s.durations[i] = v;
        if (s.durations.every((d) => !d)) s.durations = [];
      });
      if (this.ed.previewing) this.ed.preview(this.activeTag !== null ? this.sprite!.tags[this.activeTag] : null);
      this.renderFrames();
      this.hooks.structureChanged();
    };
    $("tag-add").onclick = async () => {
      const s = this.sprite;
      if (!s) return;
      const [from, to] = [Math.min(this.rangeFrom, this.rangeTo), Math.max(this.rangeFrom, this.rangeTo)];
      const name = await ask("Add tag", s.tags.length ? "" : "idle", {
        message: `Frames ${from + 1} to ${to + 1}. Shift+click frames first to tag a range. Used in code: anim = "name".`,
        placeholder: "walk",
        clean: (v) => v.replace(/[^\w-]/g, "_"),
        ok: "Add",
      });
      if (!name) return;
      this.structural((sp) => {
        sp.tags.push({ name, from, to, dir: "forward" });
        this.activeTag = sp.tags.length - 1;
      });
    };
  }

  // ------------------------------------------------------------ menu commands

  /** Edit menu commands for the pixel editor. */
  command(cmd: string) {
    const ed = this.ed;
    switch (cmd) {
      case "undo": ed.undo(false); this.refresh(); break;
      case "redo": ed.undo(true); this.refresh(); break;
      case "copy": ed.copy(); break;
      case "cut": ed.copy(true); break;
      case "paste": if (this.sprite) { ed.paste(); this.setTool(ed.tool); } break;
      case "select-all": ed.selectAll(); this.setTool(ed.tool); break;
      case "deselect": ed.deselect(); break;
      case "sel-invert": case "invert-selection": ed.invertSelection(); if (!isSelectTool(ed.tool)) this.setTool("select"); break;
      case "sel-fill": case "fill-selection": if (!ed.fillSelection()) this.hooks.status("Select something first"); break;
      case "sel-clear": ed.clearSelection(); break;
      case "sel-flip-h": case "sel-flip-v": case "sel-rot-cw": case "sel-rot-ccw":
        if (!ed.transformSelection(cmd.slice(4) as "flip-h")) this.hooks.status("Select something first");
        break;
    }
  }

  private wireSheetInput() {
    $<HTMLInputElement>("sheet-input").onchange = async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      const bmp = await createImageBitmap(f, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext("2d")!;
      g.drawImage(bmp, 0, 0);
      const img = g.getImageData(0, 0, c.width, c.height);
      const guess = Math.min(img.width, img.height);
      const size = await askSize("Import sprite sheet", guess, guess, { message: `The sheet is ${img.width} × ${img.height}. Enter the size of one frame.`, ok: "Import" });
      if (!size) return;
      const frames = sliceSheet(img, size[0], size[1]);
      this.hooks.addSprite(f.name.replace(/\.[^.]+$/, ""), frames);
      this.hooks.status(`Imported ${frames.length} frames of ${size[0]}×${size[1]}`);
    };
  }

  async imageOp(op: string) {
    const ed = this.ed;
    const s = this.sprite;
    if (!s) return;
    const color = ed.color;
    switch (op) {
      case "flip-h":
      case "flip-v":
      case "rot-cw":
      case "rot-ccw":
        // with a selection, only the selected pixels turn
        if (ed.hasSelection) return void ed.transformSelection(op);
    }
    switch (op) {
      case "flip-h":
      case "flip-v":
        return this.structural((sp) => sp.mapCels((c) => flip(c, op === "flip-h")));
      case "rot-cw":
      case "rot-ccw":
        return this.structural((sp) => sp.mapCels((c) => rotate(c, op === "rot-cw")));
      case "outline":
      case "outline8":
        return this.structural((sp) => {
          const l = sp.layers[ed.layer];
          l.cels[ed.frame] = outline(l.cels[ed.frame], color, op === "outline8");
        });
      case "replace":
        this.setTool("picker");
        this.hooks.status(`Click the color to replace with ${ed.colorHex()} (all frames and layers)`);
        ed.onPick = (rgb) => {
          ed.onPick = null;
          this.structural((sp) => sp.mapCels((c) => replaceColor(c, rgb, color)));
          this.setTool("pen");
          this.hooks.status("Color replaced");
          return true;
        };
        return;
      case "adjust":
        return this.openAdjust();
      case "scale2":
      case "scale05": {
        const f = op === "scale2" ? 2 : 0.5;
        const nw = Math.max(1, Math.round(s.w * f)), nh = Math.max(1, Math.round(s.h * f));
        return this.structural((sp) => sp.mapCels((c) => resample(c, nw, nh)));
      }
      case "canvas": {
        const size = await askSize("Canvas size", s.w, s.h, { message: "The pixels stay centered.", ok: "Resize" });
        if (!size) return;
        const [nw, nh] = size;
        const ox = Math.floor((nw - s.w) / 2), oy = Math.floor((nh - s.h) / 2);
        return this.structural((sp) => sp.mapCels((c) => canvasSize(c, nw, nh, ox, oy)));
      }
      case "trim": {
        const b = contentBounds(s);
        if (!b) return;
        return this.structural((sp) => sp.mapCels((c) => canvasSize(c, b.w, b.h, -b.x, -b.y)));
      }
    }
  }

  async sheetOp(op: string) {
    const s = this.sprite;
    if (op === "import-sheet") return $("sheet-input").click();
    if (!s) return;
    const tag = this.activeTag !== null ? s.tags[this.activeTag] : null;
    try {
      if (op === "export-sheet") {
        const r = await form({
          title: "Export sprite sheet",
          message: tag ? `Frames of the tag "${tag.name}".` : "All frames.",
          ok: "Export",
          fields: [{ key: "cols", label: "Columns", type: "number", value: 0, min: 0, hint: "0 = every frame in one row" }],
        });
        if (!r) return;
        const { image, json } = buildSheet(s, Math.max(0, Math.round(Number(r.cols))), 0, tag);
        const base = tag ? `${s.name}_${tag.name}` : s.name;
        const p = await this.hooks.saveBinary(`${base}.png`, await pngBytes(image), "png", "PNG image");
        if (!p) return;
        await this.hooks.saveText(`${base}.json`, json, "json", "Sheet data (Aseprite format)");
        this.hooks.status(`Exported a ${image.width}×${image.height} sheet and its JSON`);
      } else if (op === "export-gif") {
        const r = await form({
          title: "Export animated GIF",
          message: tag ? `Frames of the tag "${tag.name}".` : "All frames.",
          ok: "Export",
          fields: [{ key: "scale", label: "Scale", type: "number", value: Math.max(1, Math.floor(256 / Math.max(s.w, s.h))), min: 1, max: 16 }],
        });
        if (!r) return;
        const gif = buildGif(s, Math.max(1, Math.min(16, Math.round(Number(r.scale)) || 1)), tag);
        const p = await this.hooks.saveBinary(`${tag ? `${s.name}_${tag.name}` : s.name}.gif`, gif, "gif", "Animated GIF");
        if (p) this.hooks.status(`Exported a GIF (${(gif.length / 1024).toFixed(0)} KB)`);
      }
    } catch (err) {
      this.hooks.status(String(err), true);
    }
  }

  // ------------------------------------------------------------ adjust colors

  private readAdjust(): Adjust {
    const v = (id: string) => Number($<HTMLInputElement>(id).value);
    return { hue: v("adj-hue"), saturation: v("adj-saturation"), lightness: v("adj-lightness"), brightness: v("adj-brightness"), contrast: v("adj-contrast") };
  }

  private openAdjust() {
    const s = this.sprite;
    if (!s) return;
    this.ed.commitFloating();
    this.adjustSnap = s.clone();
    for (const k of Object.keys(NO_ADJUST)) $<HTMLInputElement>(`adj-${k}`).value = "0";
    this.previewAdjust();
    $("adjust-dialog").classList.remove("hidden");
  }

  private previewAdjust() {
    const s = this.sprite, snap = this.adjustSnap;
    if (!s || !snap) return;
    const a = this.readAdjust();
    for (const k of Object.keys(a) as (keyof Adjust)[]) {
      const span = $<HTMLInputElement>(`adj-${k}`).parentElement!.querySelector("span");
      if (span) span.textContent = String(a[k]);
    }
    const scope = $<HTMLSelectElement>("adj-scope").value;
    s.restore(snap);
    s.layers.forEach((l, li) => {
      l.cels = l.cels.map((c, fi) => {
        const hit = scope === "sprite" || (li === this.ed.layer && (scope === "layer" || fi === this.ed.frame));
        return hit ? adjust(c, a) : c;
      });
    });
    this.ed.render();
  }

  private closeAdjust(apply: boolean) {
    const s = this.sprite, snap = this.adjustSnap;
    this.adjustSnap = null;
    $("adjust-dialog").classList.add("hidden");
    if (!s || !snap) return;
    if (!apply) {
      s.restore(snap);
      this.ed.render();
      return;
    }
    this.ed.snapshot(snap);
    this.ed.onStructure();
  }

  private wireAdjust() {
    for (const k of Object.keys(NO_ADJUST)) $(`adj-${k}`).addEventListener("input", () => this.previewAdjust());
    $("adj-scope").onchange = () => this.previewAdjust();
    $("adjust-reset").onclick = () => {
      for (const k of Object.keys(NO_ADJUST)) $<HTMLInputElement>(`adj-${k}`).value = "0";
      this.previewAdjust();
    };
    $("adjust-ok").onclick = () => this.closeAdjust(true);
    $("adjust-cancel").onclick = () => this.closeAdjust(false);
    $("adjust-close").onclick = () => this.closeAdjust(false);
  }

  get dialogOpen() {
    return !$("adjust-dialog").classList.contains("hidden");
  }

  // ------------------------------------------------------------ keyboard

  /** Pixel-editing shortcuts. Returns true if the key was handled. */
  handleKey(e: KeyboardEvent): boolean {
    const ed = this.ed;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (this.dialogOpen) {
      if (e.key === "Escape") this.closeAdjust(false);
      if (e.key === "Enter") this.closeAdjust(true);
      return true;
    }
    if (mod) {
      if (k === "z") { this.command(e.shiftKey ? "redo" : "undo"); return true; }
      if (k === "y") { this.command("redo"); return true; }
      if (k === "c") { this.command("copy"); return true; }
      if (k === "x") { this.command("cut"); return true; }
      if (k === "v") { this.command("paste"); return true; }
      if (k === "a") { this.command("select-all"); return true; }
      if (k === "d") { this.command("deselect"); return true; }
      if (k === "i" && e.shiftKey) { this.command("invert-selection"); return true; }
      return false;
    }
    if (e.altKey && e.key === "Backspace") { this.command("fill-selection"); return true; }
    const tools: Record<string, Tool> = { b: "pen", e: "eraser", g: "fill", i: "picker", l: "line", u: "rect", o: "ellipse", m: "select", q: "lasso", w: "wand", h: "hitbox" };
    if (tools[k]) { this.setTool(tools[k]); return true; }
    switch (e.key) {
      case "[": this.setBrush(ed.brush - 1); return true;
      case "]": this.setBrush(ed.brush + 1); return true;
      case "+": case "=": $("zoom-in").click(); return true;
      case "-": $("zoom-out").click(); return true;
      case "Delete": case "Backspace": ed.clearSelection(); return true;
      case "Escape": ed.deselect(); return true;
      case "Enter": this.togglePreview(); return true;
      case "ArrowLeft": if (!ed.nudge(-1, 0)) this.gotoFrame(ed.frame - 1); return true;
      case "ArrowRight": if (!ed.nudge(1, 0)) this.gotoFrame(ed.frame + 1); return true;
      case "ArrowUp": ed.nudge(0, -1); return true;
      case "ArrowDown": ed.nudge(0, 1); return true;
      case ",": this.gotoFrame(ed.frame - 1); return true;
      case ".": this.gotoFrame(ed.frame + 1); return true;
    }
    return false;
  }
}

export type { Tag };
export { copyImage };
