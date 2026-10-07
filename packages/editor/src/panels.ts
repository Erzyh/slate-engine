// Pixel tab UI around the canvas: toolbar, layers panel, timeline (frames + tags),
// image/sheet menus, color adjustment dialog and keyboard shortcuts.

import { adjust, canvasSize, contentBounds, flip, NO_ADJUST, outline, replaceColor, resample, rotate, type Adjust } from "./ops.ts";
import type { PixelEditor, Tool } from "./pixel-editor.ts";
import { buildGif, buildSheet, pngBytes, sliceSheet } from "./sheet.ts";
import { copyImage, type EditSprite, type Tag, type TagDir } from "./sprite.ts";

export interface PanelHooks {
  /** Pixels of the current sprite changed (sync game + thumbnails). */
  pixelsChanged(): void;
  /** Frames/layers/size changed (sprite list, game, autosave). */
  structureChanged(): void;
  status(msg: string, error?: boolean): void;
  saveBinary(name: string, bytes: Uint8Array, ext: string, label: string): Promise<string | null>;
  saveText(name: string, text: string, ext: string, label: string): Promise<string | null>;
  addSprite(name: string, frames: ImageData[]): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DIR_ICON: Record<TagDir, string> = { forward: "→", reverse: "←", pingpong: "↔" };
const NEXT_DIR: Record<TagDir, TagDir> = { forward: "reverse", reverse: "pingpong", pingpong: "forward" };

function thumb(img: ImageData) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

function askSize(msg: string, def: string): [number, number] | null {
  const m = prompt(msg, def)?.match(/(\d+)\s*[x×*, ]\s*(\d+)/);
  if (!m) return null;
  return [Math.max(1, Math.min(1024, +m[1])), Math.max(1, Math.min(1024, +m[2]))];
}

export class PixelPanels {
  private rangeFrom = 0;
  private rangeTo = 0;
  private activeTag: number | null = null;
  private adjustSnap: EditSprite | null = null;

  constructor(private ed: PixelEditor, private hooks: PanelHooks) {
    this.wireToolbar();
    this.wireLayers();
    this.wireTimeline();
    this.wireMenus();
    this.wireAdjust();
    ed.onStructure = () => {
      this.refresh();
      hooks.structureChanged();
    };
    ed.onStatus = (s) => hooks.status(s);
  }

  get sprite() {
    return this.ed.sprite;
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
  }

  /** Light refresh after painting: thumbnails only. */
  refreshThumbs() {
    const s = this.sprite;
    if (!s) return;
    const fl = $("frame-list").children[this.ed.frame] as HTMLCanvasElement | undefined;
    fl?.getContext("2d")!.putImageData(s.flat(this.ed.frame), 0, 0);
    const layerEls = $("layer-list").children;
    s.layers.forEach((l, i) => {
      const el = layerEls[s.layers.length - 1 - i] as HTMLElement | undefined;
      el?.querySelector("canvas")?.getContext("2d")!.putImageData(l.cels[this.ed.frame], 0, 0);
    });
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

  // ------------------------------------------------------------ toolbar

  setTool(t: Tool) {
    this.ed.setTool(t);
    for (const b of document.querySelectorAll<HTMLElement>("#tools button")) b.classList.toggle("active", b.dataset.tool === t);
  }

  private updateZoom() {
    $("zoom-label").textContent = `${this.ed.zoom}x`;
  }

  private wireToolbar() {
    const ed = this.ed;
    for (const b of document.querySelectorAll<HTMLElement>("#tools button")) b.onclick = () => this.setTool(b.dataset.tool as Tool);
    ed.onColor = () => ($<HTMLInputElement>("color").value = ed.colorHex());
    $<HTMLInputElement>("color").oninput = (e) => ed.setColorHex((e.target as HTMLInputElement).value);
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
    $("zoom-in").onclick = () => { ed.setZoom(ed.zoom + Math.max(1, ed.zoom >> 2)); this.updateZoom(); };
    $("zoom-out").onclick = () => { ed.setZoom(ed.zoom - Math.max(1, ed.zoom >> 2)); this.updateZoom(); };
  }

  private setBrush(n: number) {
    this.ed.brush = Math.max(1, Math.min(16, Math.round(n) || 1));
    $<HTMLInputElement>("brush").value = String(this.ed.brush);
    this.ed.render();
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
      eye.textContent = l.visible ? "◉" : "○";
      eye.title = "Show / hide";
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
      const toggle = (cls: string, icon: string, on: boolean, title: string, flip: () => void) => {
        const b = document.createElement("button");
        b.className = `lock ${cls}` + (on ? " on" : "");
        b.title = title;
        b.innerHTML = `<svg><use href="#${icon}" /></svg>`;
        b.onclick = (ev) => {
          ev.stopPropagation();
          flip();
          this.renderLayers();
          this.hooks.structureChanged();
        };
        return b;
      };
      const alpha = toggle("alpha", "i-alpha", !!l.alphaLock, "Lock transparency: paint only over existing pixels", () => (l.alphaLock = !l.alphaLock));
      const lock = toggle("full", "i-lock", !!l.locked, "Lock layer: no painting", () => (l.locked = !l.locked));
      el.append(eye, thumb(l.cels[this.ed.frame]), name, alpha, lock);
      el.onclick = () => {
        this.ed.commitFloating();
        this.ed.layer = i;
        this.renderLayers();
      };
      el.ondblclick = () => {
        const n = prompt("Layer name", l.name)?.trim();
        if (n) {
          l.name = n;
          this.renderLayers();
          this.hooks.structureChanged();
        }
      };
      list.appendChild(el);
    }
    $<HTMLInputElement>("layer-opacity").value = String(Math.round((s.layers[this.ed.layer]?.opacity ?? 1) * 100));
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
      const c = thumb(s.flat(i));
      if (i === this.ed.frame) c.classList.add("active");
      else if (i >= a && i <= b && a !== b) c.classList.add("in-range");
      const tags = s.tags.filter((t) => i >= t.from && i <= t.to).map((t) => t.name);
      const ms = s.durations[i] ?? 0;
      c.title = `Frame ${i + 1} · ${Math.round(s.frameMs(i))} ms${ms > 0 ? " (own)" : ""}${tags.length ? ` · ${tags.join(", ")}` : ""}`;
      if (ms > 0) c.classList.add("timed");
      c.onclick = (e) => {
        this.ed.commitFloating();
        this.ed.stopPreview();
        if (e.shiftKey) this.rangeTo = i;
        else this.rangeFrom = this.rangeTo = i;
        this.ed.frame = i;
        this.ed.render();
        this.renderFrames();
        this.renderLayers();
        this.setPlayButton();
      };
      list.appendChild(c);
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
  }

  private renderTags() {
    const list = $("tag-list");
    list.innerHTML = "";
    const s = this.sprite;
    if (!s) return;
    s.tags.forEach((t, i) => {
      const el = document.createElement("span");
      el.className = "tag" + (i === this.activeTag ? " active" : "");
      el.title = `${t.name}: frames ${t.from + 1}-${t.to + 1} · in code: spr("${s.name}", x, y, { anim = "${t.name}" })`;
      const label = document.createElement("span");
      label.textContent = `${t.name} ${t.from + 1}–${t.to + 1}`;
      const dir = document.createElement("button");
      dir.textContent = DIR_ICON[t.dir];
      dir.title = "Direction: forward / reverse / ping-pong";
      dir.onclick = (e) => {
        e.stopPropagation();
        this.structural(() => (t.dir = NEXT_DIR[t.dir]));
      };
      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Delete tag";
      del.onclick = (e) => {
        e.stopPropagation();
        this.structural((sp) => sp.tags.splice(i, 1));
      };
      el.append(label, dir, del);
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
      el.ondblclick = () => {
        const n = prompt("Tag name (used in code: anim = \"name\")", t.name)?.trim();
        if (n) this.structural(() => (t.name = n.replace(/[^\w-]/g, "_")));
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
    b.textContent = this.ed.previewing ? "■" : "▶";
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
    $("tag-add").onclick = () => {
      const s = this.sprite;
      if (!s) return;
      const [from, to] = [Math.min(this.rangeFrom, this.rangeTo), Math.max(this.rangeFrom, this.rangeTo)];
      const name = prompt(`Tag name for frames ${from + 1}-${to + 1} (e.g. idle, walk, attack)`, s.tags.length ? "" : "idle")?.trim();
      if (!name) return;
      this.structural((sp) => {
        sp.tags.push({ name: name.replace(/[^\w-]/g, "_"), from, to, dir: "forward" });
        this.activeTag = sp.tags.length - 1;
      });
    };
  }

  // ------------------------------------------------------------ menus

  private wireMenus() {
    $<HTMLSelectElement>("image-menu").onchange = (e) => {
      const sel = e.target as HTMLSelectElement;
      const v = sel.value;
      sel.value = "";
      this.imageOp(v);
    };
    $<HTMLSelectElement>("sheet-menu").onchange = (e) => {
      const sel = e.target as HTMLSelectElement;
      const v = sel.value;
      sel.value = "";
      void this.sheetOp(v);
    };
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
      const size = askSize(`Frame size in pixels (sheet is ${img.width}×${img.height})`, `${guess}x${guess}`);
      if (!size) return;
      const frames = sliceSheet(img, size[0], size[1]);
      this.hooks.addSprite(f.name.replace(/\.[^.]+$/, ""), frames);
      this.hooks.status(`Imported ${frames.length} frames of ${size[0]}×${size[1]}`);
    };
  }

  private imageOp(op: string) {
    const ed = this.ed;
    const s = this.sprite;
    if (!s) return;
    const color = ed.color;
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
        const size = askSize("Canvas size (width x height) - content stays centered", `${s.w}x${s.h}`);
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

  private async sheetOp(op: string) {
    const s = this.sprite;
    if (op === "import-sheet") return $("sheet-input").click();
    if (!s) return;
    const tag = this.activeTag !== null ? s.tags[this.activeTag] : null;
    try {
      if (op === "export-sheet") {
        const cols = Number(prompt("Columns (0 = all frames in one row)", "0") ?? "x");
        if (Number.isNaN(cols)) return;
        const { image, json } = buildSheet(s, cols, 0, tag);
        const base = tag ? `${s.name}_${tag.name}` : s.name;
        const p = await this.hooks.saveBinary(`${base}.png`, await pngBytes(image), "png", "PNG image");
        if (!p) return;
        await this.hooks.saveText(`${base}.json`, json, "json", "Sheet data (Aseprite format)");
        this.hooks.status(`Exported ${image.width}×${image.height} sheet + JSON`);
      } else if (op === "export-gif") {
        const scale = Number(prompt("Scale (integer)", String(Math.max(1, Math.floor(256 / Math.max(s.w, s.h))))) ?? "x");
        if (!scale || Number.isNaN(scale)) return;
        const gif = buildGif(s, Math.max(1, Math.min(16, Math.round(scale))), tag);
        const p = await this.hooks.saveBinary(`${tag ? `${s.name}_${tag.name}` : s.name}.gif`, gif, "gif", "Animated GIF");
        if (p) this.hooks.status(`Exported GIF (${(gif.length / 1024).toFixed(0)} KB)`);
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
      if (k === "z") { ed.undo(e.shiftKey); this.refresh(); return true; }
      if (k === "y") { ed.undo(true); this.refresh(); return true; }
      if (k === "c") { ed.copy(); return true; }
      if (k === "x") { ed.copy(true); return true; }
      if (k === "v") { if (this.sprite) { ed.paste(); this.setTool("select"); } return true; }
      if (k === "a") { ed.selectAll(); this.setTool("select"); return true; }
      if (k === "d") { ed.deselect(); return true; }
      return false;
    }
    const tools: Record<string, Tool> = { b: "pen", e: "eraser", g: "fill", i: "picker", l: "line", u: "rect", o: "ellipse", m: "select" };
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
