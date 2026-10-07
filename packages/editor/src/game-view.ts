// The Game view: the game running inside the editor, next to the Pixel / Map / Code views (like a
// game engine's scene + game layout). It is the web build of the player in an iframe; the editor
// sends it the cartridge, then every sprite / map edit; it sends back log() lines and errors.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const WIDTH = "slate:gameViewWidth";

export interface GameViewHooks {
  log(line: string): void;
  error(text: string): void;
}

export class GameView {
  /** null until checked: does this build include the web player? */
  available: boolean | null = null;
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private queued: Uint8Array | null = null;
  private panel = $("game-panel");

  constructor(private hooks: GameViewHooks) {
    window.addEventListener("message", (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow) return;
      const m = e.data;
      if (!m || m.slate !== true) return;
      if (m.type === "ready") {
        this.ready = true;
        if (this.queued) this.post(this.queued);
        this.queued = null;
      } else if (m.type === "log") hooks.log(m.line);
      else if (m.type === "error") hooks.error(m.text);
    });
    this.wireSplitter();
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

  stop() {
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    $("game-host").classList.remove("running");
  }

  focus() {
    this.frame?.focus();
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
