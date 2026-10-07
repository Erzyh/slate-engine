// The Game view: the game running inside the editor, next to the Pixel / Map / Code views (like a
// game engine's scene + game layout). It is the web build of the player in an iframe; the editor
// sends it the cartridge, then every sprite / map edit; it sends back log() lines and errors.

import { GifWriter, upscale } from "./gif.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** GIF clips: frames per second kept (the game runs at 60), longest clip, smallest width */
const GIF_FPS = 20;
const GIF_MAX_SECONDS = 20;
const GIF_MIN_WIDTH = 480;
const WIDTH = "slate:gameViewWidth";

export interface GameViewHooks {
  log(line: string): void;
  error(text: string): void;
  /** a screenshot or a clip to save */
  save(name: string, bytes: Uint8Array, ext: string, label: string): void;
  status(msg: string): void;
}

export class GameView {
  /** null until checked: does this build include the web player? */
  available: boolean | null = null;
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private queued: Uint8Array | null = null;
  private panel = $("game-panel");
  /** debug flags sent to the player: bit 0 hitboxes, 1 paused, 2 step once, 3 stats */
  private flags = 0;
  // capture: a screenshot is waiting for its frame; a GIF is being recorded
  private shotWanted = false;
  private gif: { writer: GifWriter; scale: number; n: number; started: number; w: number; h: number } | null = null;
  private recTimer = 0;

  constructor(private hooks: GameViewHooks) {
    window.addEventListener("message", (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const m = e.data;
      if (!m || m.slate !== true) return;
      if (m.type === "ready") {
        this.ready = true;
        if (this.queued) this.post(this.queued);
        this.queued = null;
        if (this.flags) this.sendDebug(this.flags);
      } else if (m.type === "frame") this.onFrame(new Uint8Array(m.px), m.w, m.h);
      else if (m.type === "log") hooks.log(m.line);
      else if (m.type === "error") hooks.error(m.text);
    });
    this.wireSplitter();
    this.wireDebug();
    const w = Number(localStorage.getItem(WIDTH));
    if (w > 200) this.setWidth(w);
  }

  async check() {
    if (this.available !== null) return this.available;
    try {
      const r = await fetch("player/slate-player.wasm", { method: "HEAD", cache: "no-store" });
      this.available = r.ok;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  get running() {
    return !!this.frame;
  }

  get visible() {
    return !this.panel.classList.contains("hidden");
  }

  show(on = true) {
    this.panel.classList.toggle("hidden", !on);
    window.dispatchEvent(new Event("resize"));
  }

  /** Start (or restart) the game with this cartridge. */
  start(cart: Uint8Array) {
    this.stop();
    this.flags &= ~2; // a restart runs
    this.syncDebugUi();
    this.show(true);
    const f = document.createElement("iframe");
    f.className = "game-frame";
    f.allow = "autoplay; fullscreen; gamepad";
    f.src = "player/index.html?embed";
    this.ready = false;
    this.queued = cart;
    $("game-host").appendChild(f);
    $("game-host").classList.add("running");
    this.frame = f;
    f.addEventListener("load", () => f.focus());
  }

  /** Live edits (sprites, maps): the running game reloads them and keeps its state. */
  update(cart: Uint8Array) {
    if (!this.frame) return;
    if (this.ready) this.post(cart);
    else this.queued = cart;
  }

  /** Save the next frame as a PNG (scaled up so it's easy to share). */
  screenshot() {
    if (!this.frame || !this.ready) return;
    this.shotWanted = true;
    this.sendDebug(this.flags | 32);
  }

  get recording() {
    return this.gif !== null;
  }

  /** Start / stop recording a GIF. */
  toggleRecord() {
    if (this.gif) return this.finishGif();
    if (!this.frame || !this.ready) return;
    this.gif = { writer: null as unknown as GifWriter, scale: 1, n: 0, started: performance.now(), w: 0, h: 0 };
    this.flags |= 16;
    this.sendDebug(this.flags);
    this.syncDebugUi();
    this.recTimer = window.setInterval(() => this.syncDebugUi(), 250);
  }

  private onFrame(px: Uint8Array, w: number, h: number) {
    if (this.shotWanted) {
      this.shotWanted = false;
      void this.savePng(px, w, h);
    }
    const g = this.gif;
    if (!g) return;
    // the game sends 60 frames a second; keep every third
    if (g.n++ % (60 / GIF_FPS) !== 0) return;
    if (!g.writer) {
      g.scale = Math.max(1, Math.min(4, Math.ceil(GIF_MIN_WIDTH / w)));
      g.w = w;
      g.h = h;
      g.writer = new GifWriter(w * g.scale, h * g.scale);
    }
    if (w !== g.w || h !== g.h) return;
    g.writer.addFrame(upscale(px, w, h, g.scale), Math.round(100 / GIF_FPS));
    if (performance.now() - g.started > GIF_MAX_SECONDS * 1000) this.finishGif();
  }

  private finishGif() {
    const g = this.gif;
    this.gif = null;
    clearInterval(this.recTimer);
    this.flags &= ~16;
    this.sendDebug(this.flags);
    this.syncDebugUi();
    if (!g?.writer?.frames) return this.hooks.status("Nothing recorded");
    const bytes = g.writer.finish();
    this.hooks.save("clip.gif", bytes, "gif", "GIF animation");
    this.hooks.status(`Recorded ${(g.writer.frames / GIF_FPS).toFixed(1)} s · ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);
  }

  private async savePng(px: Uint8Array, w: number, h: number) {
    const k = Math.max(1, Math.min(6, Math.ceil(960 / w)));
    const c = document.createElement("canvas");
    c.width = w * k;
    c.height = h * k;
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(upscale(px, w, h, k).buffer as ArrayBuffer), w * k, h * k), 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (blob) this.hooks.save("screenshot.png", new Uint8Array(await blob.arrayBuffer()), "png", "PNG image");
  }

  stop() {
    if (this.gif) this.finishGif();
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    $("game-host").classList.remove("running");
  }

  focus() {
    this.frame?.focus();
  }

  get paused() {
    return (this.flags & 2) !== 0;
  }

  /** Pause / resume game time. */
  togglePause() {
    if (!this.frame) return;
    this.flags ^= 2;
    this.sendDebug(this.flags);
    this.syncDebugUi();
  }

  /** One frame forward while paused. */
  step() {
    if (this.frame && this.paused) this.sendDebug(this.flags | 4);
  }

  private sendDebug(flags: number) {
    if (this.ready) this.frame?.contentWindow?.postMessage({ slate: true, type: "debug", flags }, "*");
  }

  private syncDebugUi() {
    const pause = $("game-pause");
    pause.textContent = this.paused ? "Resume" : "Pause";
    pause.classList.toggle("on", this.paused);
    $<HTMLButtonElement>("game-step").disabled = !this.paused;
    const rec = $("game-rec");
    rec.classList.toggle("rec", !!this.gif);
    if (this.gif) {
      const s = Math.floor((performance.now() - this.gif.started) / 1000);
      rec.textContent = `Stop  ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    } else rec.textContent = "Record GIF";
  }

  private wireDebug() {
    const bit = (id: string, b: number) => {
      const el = $<HTMLInputElement>(id);
      el.onchange = () => {
        this.flags = el.checked ? this.flags | b : this.flags & ~b;
        this.sendDebug(this.flags);
      };
    };
    bit("game-boxes", 1);
    bit("game-stats", 8);
    $("game-pause").onclick = () => this.togglePause();
    $("game-step").onclick = () => this.step();
    $("game-shot").onclick = () => this.screenshot();
    $("game-rec").onclick = () => this.toggleRecord();
    // keys work while the game has focus too: the player page forwards them
    window.addEventListener("message", (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow || e.data?.slate !== true || e.data.type !== "key") return;
      this.key(e.data.key);
    });
    window.addEventListener("keydown", (e) => {
      if (this.frame && this.key(e.key)) e.preventDefault();
    });
  }

  /** F6 pause, F7 step, F8 screenshot, F9 record */
  private key(k: string) {
    if (k === "F6") this.togglePause();
    else if (k === "F7") this.step();
    else if (k === "F8") this.screenshot();
    else if (k === "F9") this.toggleRecord();
    else return false;
    return true;
  }

  private post(cart: Uint8Array) {
    const copy = cart.slice().buffer;
    this.frame?.contentWindow?.postMessage({ slate: true, type: "cart", bytes: copy }, "*", [copy]);
  }

  private setWidth(w: number) {
    const max = Math.max(320, window.innerWidth - 640);
    const v = Math.max(280, Math.min(max, w));
    document.documentElement.style.setProperty("--game-w", `${v}px`);
    return v;
  }

  /** drag the left edge to resize */
  private wireSplitter() {
    const s = $("game-splitter");
    s.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing");
      const move = (ev: PointerEvent) => this.setWidth(window.innerWidth - ev.clientX);
      const up = () => {
        s.removeEventListener("pointermove", move);
        document.body.classList.remove("resizing");
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--game-w"));
        if (w) localStorage.setItem(WIDTH, String(w));
        window.dispatchEvent(new Event("resize"));
      };
      s.addEventListener("pointermove", move);
      s.addEventListener("pointerup", up, { once: true });
    });
  }
}
