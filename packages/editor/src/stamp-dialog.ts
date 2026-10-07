// Grid Stamp dialog: load an image, preview the detected grid over it, tweak, stamp.

import { gridStamp, type RGBAImage, type StampOptions, type StampResult } from "@slate/pixelize";
import type { PluginHost } from "./plugins.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class StampDialog {
  private el = $("stamp-dialog");
  private srcCanvas = $<HTMLCanvasElement>("stamp-src");
  private outCanvas = $<HTMLCanvasElement>("stamp-out");
  private src: RGBAImage | null = null;
  private srcBitmap: HTMLCanvasElement | null = null;
  private result: StampResult | null = null;
  private srcZoom = 1;
  /** Until the user zooms by hand, the source view keeps fitting its panel. */
  private autoFit = true;
  private timer = 0;
  onStamp: (name: string, img: ImageData) => void = () => {};
  private host: PluginHost | null = null;
  private generating = false;

  constructor() {
    $("stamp-close").onclick = () => this.close();
    $("stamp-file").onclick = () => $("stamp-input").click();
    $<HTMLInputElement>("stamp-input").onchange = (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void this.loadBlob(f, f.name);
      (e.target as HTMLInputElement).value = "";
    };
    for (const id of ["stamp-pitch", "stamp-colors", "stamp-max", "stamp-bg", "stamp-elastic", "stamp-cleanup", "stamp-despeckle", "stamp-cover", "stamp-tile", "stamp-variant"]) {
      $(id).addEventListener("input", () => this.schedule());
    }
    $("stamp-ok").onclick = () => this.commit();
    $("ai-go").onclick = () => void this.generate();
    $("ai-gen").onchange = () => this.renderAiOptions();
    $<HTMLInputElement>("ai-prompt").addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.generate();
    });
    this.el.addEventListener("dragover", (e) => e.preventDefault());
    this.el.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files[0];
      if (f) void this.loadBlob(f, f.name);
    });
    $("stamp-src-wrap").addEventListener("wheel", (e) => {
      e.preventDefault();
      this.autoFit = false;
      this.srcZoom = Math.max(0.1, Math.min(8, this.srcZoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.drawSource();
    }, { passive: false });
    const ro = new ResizeObserver(() => {
      this.drawSource();
      this.drawResult();
    });
    ro.observe($("stamp-src-wrap"));
    ro.observe(this.outCanvas.parentElement!);
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  open() {
    this.el.classList.remove("hidden");
    if (this.host?.generators.length) $("ai-prompt").focus();
    else if (!this.src) $("stamp-input").click();
  }

  // ------------------------------------------------------------ AI generation (plugins)

  attachPlugins(host: PluginHost) {
    this.host = host;
    this.refreshAI();
  }

  refreshAI() {
    const gens = this.host?.generators ?? [];
    $("stamp-ai").classList.toggle("hidden", gens.length === 0);
    const sel = $<HTMLSelectElement>("ai-gen");
    const prev = sel.value;
    sel.innerHTML = "";
    gens.forEach((g, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = g.name;
      sel.appendChild(o);
    });
    if (prev && Number(prev) < gens.length) sel.value = prev;
    this.renderAiOptions();
  }

  private renderAiOptions() {
    const box = $("ai-opts");
    box.innerHTML = "";
    const g = this.host?.generators[Number($<HTMLSelectElement>("ai-gen").value)];
    for (const opt of g?.options ?? []) {
      const s = document.createElement("select");
      s.dataset.key = opt.key;
      s.title = opt.label ?? opt.key;
      for (const v of opt.values) {
        const o = document.createElement("option");
        o.value = o.textContent = v;
        s.appendChild(o);
      }
      box.appendChild(s);
    }
  }

  private async generate() {
    const host = this.host;
    const g = host?.generators[Number($<HTMLSelectElement>("ai-gen").value)];
    const prompt = $<HTMLInputElement>("ai-prompt").value.trim();
    if (!host || !g || !prompt || this.generating) return;
    const opts: Record<string, string> = {};
    for (const s of $("ai-opts").querySelectorAll<HTMLSelectElement>("select")) opts[s.dataset.key!] = s.value;
    const status = $("ai-status");
    this.generating = true;
    $<HTMLButtonElement>("ai-go").disabled = true;
    try {
      const r = await host.generate(g, prompt, opts, (t) => (status.textContent = t));
      if (r.background) $<HTMLSelectElement>("stamp-bg").value = r.background === "none" ? "none" : "auto";
      if (r.colors) $<HTMLInputElement>("stamp-colors").value = String(r.colors);
      if (r.tile) $<HTMLInputElement>("stamp-tile").value = String(this.targetSize() ?? 32);
      const name = prompt.toLowerCase().replace(/^(a|an|the)\s+/, "").split(/\s+/).slice(0, 2).join("_");
      await this.loadBlob(new Blob([r.bytes as BlobPart], { type: "image/png" }), name);
      status.textContent = "Done - adjust and stamp";
    } catch (err) {
      status.textContent = `Failed: ${(err as Error).message}`;
    } finally {
      this.generating = false;
      $<HTMLButtonElement>("ai-go").disabled = false;
    }
  }

  close() {
    this.el.classList.add("hidden");
  }

  async loadBlob(blob: Blob, name = "image") {
    this.el.classList.remove("hidden");
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height);
    this.src = { width: c.width, height: c.height, data: data.data };
    this.srcBitmap = c;
    this.autoFit = true;
    $<HTMLInputElement>("stamp-name").value = name.replace(/\.[^.]+$/, "").replace(/[^\w-]/g, "_").slice(0, 24);
    this.run();
  }

  private options(): StampOptions {
    const pitch = Number($<HTMLInputElement>("stamp-pitch").value);
    $("stamp-pitch-v").textContent = pitch < 2 ? "auto" : pitch.toFixed(1);
    const despeckle = $<HTMLSelectElement>("stamp-despeckle").value;
    const cover = $<HTMLInputElement>("stamp-cover").value.match(/(\d+)\s*[x×]\s*(\d+)/);
    return {
      pitch: pitch < 2 ? "auto" : pitch,
      colors: Number($<HTMLInputElement>("stamp-colors").value),
      maxSize: Number($<HTMLInputElement>("stamp-max").value),
      background: $<HTMLSelectElement>("stamp-bg").value as StampOptions["background"],
      elastic: $<HTMLInputElement>("stamp-elastic").checked,
      cleanup: $<HTMLInputElement>("stamp-cleanup").checked,
      despeckle: despeckle === "auto" ? "auto" : Number(despeckle),
      tile: Number($<HTMLInputElement>("stamp-tile").value) || undefined,
      tileVariant: Number($<HTMLInputElement>("stamp-variant").value) || 0,
      cover: cover ? [Number(cover[1]), Number(cover[2])] : undefined,
    };
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.run(), 120);
  }

  private run() {
    if (!this.src) return;
    const t0 = performance.now();
    this.result = gridStamp(this.src, this.options());
    const ms = performance.now() - t0;
    const r = this.result;
    $("stamp-info").textContent =
      `${r.image.width}×${r.image.height} · pitch ${r.pitch.toFixed(2)} · ${r.palette.length} colors · ` +
      `grid ${Math.round(r.confidence * 100)}% · ${ms.toFixed(0)}ms`;
    this.drawSource();
    this.drawResult();
  }

  private drawSource() {
    const c = this.srcCanvas, src = this.srcBitmap;
    if (!src) return;
    const wrap = c.parentElement!;
    if (wrap.clientWidth === 0) return; // not laid out yet; the ResizeObserver calls back
    if (this.autoFit) this.srcZoom = Math.min(1, (wrap.clientWidth - 4) / src.width, (wrap.clientHeight - 4) / src.height);
    const z = this.srcZoom;
    c.width = Math.round(src.width * z);
    c.height = Math.round(src.height * z);
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = z < 1;
    g.drawImage(src, 0, 0, c.width, c.height);
    const r = this.result;
    if (!r) return;
    // Grid lines are only meaningful when they are at least a few screen pixels apart.
    if (r.pitch * z < 3) return;
    g.strokeStyle = "rgba(0,255,255,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    for (const x of r.xCuts) { g.moveTo(Math.round(x * z) + 0.5, 0); g.lineTo(Math.round(x * z) + 0.5, c.height); }
    for (const y of r.yCuts) { g.moveTo(0, Math.round(y * z) + 0.5); g.lineTo(c.width, Math.round(y * z) + 0.5); }
    g.stroke();
  }

  private drawResult() {
    const r = this.result;
    if (!r) return;
    const c = this.outCanvas;
    const wrap = c.parentElement!;
    if (wrap.clientWidth === 0) return;
    const img = new ImageData(new Uint8ClampedArray(r.image.data), r.image.width, r.image.height);
    const z = Math.max(1, Math.floor(Math.min((wrap.clientWidth - 16) / img.width, (wrap.clientHeight - 16) / img.height)));
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(img, 0, 0);
    c.style.width = `${img.width * z}px`;
    c.style.height = `${img.height * z}px`;
  }

  private commit() {
    const r = this.result;
    if (!r) return;
    const img = new ImageData(new Uint8ClampedArray(r.image.data), r.image.width, r.image.height);
    const target = $<HTMLSelectElement>("stamp-target").value;
    if (target) this.onStampFrame(target, img);
    else this.onStamp($<HTMLInputElement>("stamp-name").value.trim() || "sprite", img);
    this.close();
  }

  /** Add the result as a new frame of an existing sprite (e.g. a tile in a tileset). */
  onStampFrame: (sprite: string, img: ImageData) => void = () => {};

  /** Fill the "stamp into" list; sprites with their tile size. */
  setTargets(sprites: { name: string; w: number; h: number; frames: number }[]) {
    const sel = $<HTMLSelectElement>("stamp-target");
    const prev = sel.value;
    sel.innerHTML = '<option value="">→ new sprite</option>';
    for (const s of sprites) {
      const o = document.createElement("option");
      o.value = s.name;
      o.textContent = `→ add frame to ${s.name} (${s.w}×${s.h})`;
      sel.appendChild(o);
    }
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    this.targets = sprites;
    const sync = () => {
      $("stamp-name").classList.toggle("hidden", sel.value !== "");
      // stamping a tile into a tileset: match its tile size
      const size = this.targetSize();
      const tile = $<HTMLInputElement>("stamp-tile");
      if (size && Number(tile.value) > 0 && Number(tile.value) !== size) {
        tile.value = String(size);
        this.schedule();
      }
    };
    sync();
    sel.onchange = sync;
  }

  private targets: { name: string; w: number; h: number }[] = [];

  private targetSize() {
    const t = this.targets.find((s) => s.name === $<HTMLSelectElement>("stamp-target").value);
    return t ? Math.min(t.w, t.h) : null;
  }
}
