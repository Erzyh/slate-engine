// UI tab: screens for HUDs and menus, laid out with the mouse. The preview is the real player
// (in an iframe, like the Game view) drawing UI.screen(name) with sample values, so text and
// sprites look exactly as in the game; selection boxes are drawn over it.
// Screens live in slate.json ("screens"); game code draws one with UI.screen("hud").

import type { Cartridge } from "@slate/runtime";
import { ask, confirmBox } from "./modal.ts";
import type { Project } from "./project.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type UiKind = "text" | "sprite" | "bar" | "panel" | "button";

export interface UiElement {
  id: string;
  kind: UiKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  color?: string;
  bg?: string;
  border?: string;
  align?: "left" | "center" | "right";
  scale?: number;
  font?: string;
  outline?: string;
  sprite?: string;
  frame?: number;
  repeat?: string;
  gap?: number;
  value?: string;
  max?: string;
  visible?: string;
  /** where x, y are measured from: tl t tr l c r bl b br (default tl) */
  anchor?: string;
}

export interface UiScreen {
  elements: UiElement[];
  /** sample values for the preview: "G.coins" -> 12 */
  preview?: Record<string, string | number | boolean>;
}

export interface UiHooks {
  changed(): void;
  status(msg: string, error?: boolean): void;
  /** the cartridge the game gets (sprites, maps, screens) */
  cart(): Cartridge;
}

const RESIZABLE: UiKind[] = ["panel", "bar", "button"];
const ANCHORS: [string, string][] = [["tl", "Top left"], ["t", "Top"], ["tr", "Top right"], ["l", "Left"], ["c", "Center"], ["r", "Right"], ["bl", "Bottom left"], ["b", "Bottom"], ["br", "Bottom right"]];

/** The point an anchor stands for on a w x h screen. */
export function anchorPoint(anchor: string | undefined, w: number, h: number): [number, number] {
  const a = anchor ?? "tl";
  const fx = a.includes("r") ? 1 : a.includes("l") ? 0 : 0.5;
  const fy = a[0] === "b" ? 1 : a[0] === "t" ? 0 : 0.5;
  return [fx * w, fy * h];
}
const DEFAULTS: Record<UiKind, Partial<UiElement>> = {
  text: { text: "SCORE {G.score}", color: "#f4f4f4", align: "left" },
  sprite: { frame: 0 },
  bar: { w: 60, h: 6, value: "G.hp", max: "10", color: "#a7f070" },
  panel: { w: 80, h: 30, bg: "#1a1c2cc0", border: "#f4f4f4" },
  button: { w: 60, h: 14, text: "START" },
};

export class UiEditor {
  project: Project | null = null;
  screen = "";
  private sel: UiElement | null = null;
  private zoom = 3;
  private frame: HTMLIFrameElement | null = null;
  private ready = false;
  private script = "";
  private undoStack: string[] = [];
  private drag: { mode: "move" | "size"; dx: number; dy: number; w: number; h: number } | null = null;
  private pushTimer = 0;
  private overlay = $<HTMLCanvasElement>("ui-overlay");

  constructor(private hooks: UiHooks) {
    window.addEventListener("message", (e) => {
      if (!this.frame || e.source !== this.frame.contentWindow || e.data?.slate !== true) return;
      if (e.data.type === "ready") {
        this.ready = true;
        this.push(true);
      }
    });
    for (const b of document.querySelectorAll<HTMLElement>("#ui-tools button[data-add]")) b.onclick = () => this.add(b.dataset.add as UiKind);
    $("ui-new").onclick = () => void this.newScreen();
    $("ui-rename").onclick = () => void this.renameScreen();
    $("ui-del").onclick = () => void this.deleteScreen();
    $<HTMLSelectElement>("ui-screen").onchange = (e) => this.select((e.target as HTMLSelectElement).value);
    $("ui-zoom-in").onclick = () => this.setZoom(this.zoom + 1);
    $("ui-zoom-out").onclick = () => this.setZoom(this.zoom - 1);
    $<HTMLTextAreaElement>("ui-preview").onchange = (e) => this.setPreview((e.target as HTMLTextAreaElement).value);
    this.overlay.addEventListener("pointerdown", (e) => this.down(e));
    this.overlay.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", () => this.up());
  }

  private get screens(): Record<string, UiScreen> {
    return ((this.project!.cart as Cartridge & { screens?: Record<string, UiScreen> }).screens ??= {});
  }

  private get cur(): UiScreen | null {
    return this.project ? (this.screens[this.screen] ?? null) : null;
  }

  setProject(p: Project) {
    this.project = p;
    this.undoStack = [];
    this.select(Object.keys(this.screens)[0] ?? "");
  }

  /** The tab became visible (or hidden): run the preview only while it shows. */
  setVisible(on: boolean) {
    if (on) {
      this.fit();
      this.refresh();
      this.startPreview();
    } else this.stopPreview();
  }

  select(name: string) {
    this.screen = name;
    this.sel = null;
    this.refresh();
    if (this.frame) this.push(true);
  }

  refresh() {
    const sel = $<HTMLSelectElement>("ui-screen");
    sel.innerHTML = "";
    for (const n of Object.keys(this.project ? this.screens : {})) {
      const o = document.createElement("option");
      o.value = o.textContent = n;
      sel.appendChild(o);
    }
    sel.value = this.screen;
    const has = !!this.cur;
    $("ui-empty").classList.toggle("hidden", has);
    $("ui-stage").classList.toggle("hidden", !has);
    for (const id of ["ui-rename", "ui-del"]) $<HTMLButtonElement>(id).disabled = !has;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#ui-tools button")) b.disabled = !has;
    $("ui-code").textContent = has ? `UI.screen("${this.screen}")  · draw it after Cam.reset()` : "";
    const pv = this.cur?.preview ?? {};
    $<HTMLTextAreaElement>("ui-preview").value = Object.entries(pv).map(([k, v]) => `${k}=${v}`).join("\n");
    this.layout();
    this.renderList();
    this.renderProps();
    this.draw();
  }

  // ------------------------------------------------------------ preview (the real player)

  private startPreview() {
    if (this.frame || !this.cur) return;
    const f = document.createElement("iframe");
    f.className = "ui-frame";
    f.src = "player/index.html?embed";
    this.ready = false;
    this.script = "";
    $("ui-host").appendChild(f);
    this.frame = f;
  }

  private stopPreview() {
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
  }

  /** The preview script: sample values, the first map as a backdrop, the screen on top. */
  private previewScript() {
    const lit = (v: string | number | boolean) => (typeof v === "string" ? JSON.stringify(v) : String(v));
    const sets = Object.entries(this.cur?.preview ?? {}).map(([k, v]) => `set(${JSON.stringify(k)}, ${lit(v)})`).join("\n");
    const backdrop = this.project?.maps[0]?.name ?? "";
    return `-- Slate UI preview
local function set(path, v)
  local t = _G
  local parts = string.split(path, ".")
  for i = 1, #parts - 1 do
    t[parts[i]] = t[parts[i]] or {}
    t = t[parts[i]]
  end
  t[parts[#parts]] = v
end
${sets}
function draw()
  cls(${JSON.stringify(this.project?.cart.background ?? "#1a1c2c")})
  ${backdrop ? `map(${JSON.stringify(backdrop)}, 0, 0)\n  rect(0, 0, W, H, "#0b0d1a66")` : ""}
  if __screen(${JSON.stringify(this.screen)}) then UI.screen(${JSON.stringify(this.screen)}) end
end
`;
  }

  /** Send the cartridge to the preview (debounced; `now` skips the wait). */
  private push(now = false) {
    clearTimeout(this.pushTimer);
    const go = () => {
      if (!this.frame || !this.ready || !this.project) return;
      const cart = { ...this.hooks.cart(), scripts: { "scripts/preview.luau": this.previewScript() }, main: "scripts/preview.luau" };
      const bytes = new TextEncoder().encode(JSON.stringify(cart)).buffer;
      this.frame.contentWindow?.postMessage({ slate: true, type: "cart", bytes }, "*", [bytes]);
    };
    if (now) go();
    else this.pushTimer = window.setTimeout(go, 120);
  }

  // ------------------------------------------------------------ layout

  /** The largest zoom that shows the whole screen. */
  private fit() {
    const wrap = $("ui-wrap");
    const [w, h] = this.project?.cart.resolution ?? [320, 180];
    if (wrap.clientWidth < 100) return;
    this.zoom = Math.max(1, Math.min(6, Math.floor(Math.min((wrap.clientWidth - 80) / w, (wrap.clientHeight - 80) / h))));
  }

  private setZoom(z: number) {
    this.zoom = Math.max(1, Math.min(6, z));
    this.layout();
    this.draw();
  }

  private layout() {
    const [w, h] = this.project?.cart.resolution ?? [320, 180];
    const stage = $("ui-stage");
    stage.style.width = `${w * this.zoom}px`;
    stage.style.height = `${h * this.zoom}px`;
    this.overlay.width = w * this.zoom;
    this.overlay.height = h * this.zoom;
    $("ui-zoom").textContent = `${this.zoom * 100}%`;
  }

  /** An element's box in game pixels (text is measured roughly: the preview shows the real thing). */
  private box(e: UiElement) {
    const [W, H] = this.project?.cart.resolution ?? [320, 180];
    const [ax, ay] = anchorPoint(e.anchor, W, H);
    const ex = e.x + ax, ey = e.y + ay;
    const sc = e.scale ?? 1;
    if (e.kind === "text") {
      const t = (e.text ?? "").replace(/\{[^}]*\}/g, "000");
      let w = 0;
      const erx = (e.font ?? "").startsWith("erx");
      for (const ch of t) w += ch.charCodeAt(0) > 127 || erx ? 12 : ch === " " ? 3 : 6;
      w *= sc;
      const h = (erx ? 12 : 8) * sc;
      const x = e.align === "center" ? ex - w / 2 : e.align === "right" ? ex - w : ex;
      return { x, y: ey, w: Math.max(4, w), h };
    }
    if (e.kind === "sprite") {
      const s = e.sprite ? this.project?.get(e.sprite) : null;
      const sw = (s?.w ?? 8) * sc, sh = (s?.h ?? 8) * sc;
      const n = Math.max(1, Number(this.cur?.preview?.[e.repeat ?? ""] ?? 1) || 1);
      return { x: ex, y: ey, w: n * sw + (n - 1) * (e.gap ?? 1), h: sh };
    }
    return { x: ex, y: ey, w: e.w ?? 40, h: e.h ?? 10 };
  }

  private draw() {
    const g = this.overlay.getContext("2d")!;
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const s = this.cur;
    if (!s) return;
    const z = this.zoom;
    for (const e of s.elements) {
      const b = this.box(e);
      const on = e === this.sel;
      g.strokeStyle = on ? "#ffcd75" : "rgba(255,255,255,0.22)";
      g.setLineDash(on ? [] : [3, 3]);
      g.lineWidth = 1;
      g.strokeRect(Math.round(b.x * z) + 0.5, Math.round(b.y * z) + 0.5, Math.round(b.w * z) - 1, Math.round(b.h * z) - 1);
      g.setLineDash([]);
      if (on && RESIZABLE.includes(e.kind)) {
        g.fillStyle = "#ffcd75";
        g.fillRect((b.x + b.w) * z - 4, (b.y + b.h) * z - 4, 8, 8);
      }
    }
  }

  // ------------------------------------------------------------ editing

  private snapshot() {
    if (!this.cur) return;
    this.undoStack.push(JSON.stringify(this.cur));
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  undo() {
    const last = this.undoStack.pop();
    if (!last || !this.project) return;
    this.screens[this.screen] = JSON.parse(last);
    this.sel = null;
    this.changed(true);
  }

  private changed(full = false) {
    this.hooks.changed();
    if (full) {
      this.renderList();
      this.renderProps();
    }
    this.draw();
    this.push();
  }

  private add(kind: UiKind) {
    const s = this.cur;
    if (!s) return;
    this.snapshot();
    const [w, h] = this.project!.cart.resolution;
    let n = 1;
    while (s.elements.some((e) => e.id === `${kind}${n}`)) n++;
    // new elements step down from the top-left so they don't land on each other
    const k = s.elements.length;
    const e: UiElement = { id: `${kind}${n}`, kind, x: 8 + (k % 6) * 12, y: 8 + ((k * 18) % Math.max(20, h - 30)), ...structuredClone(DEFAULTS[kind]) };
    if (kind === "sprite") e.sprite = this.project!.sprites.find((sp) => sp.name === "heart")?.name ?? this.project!.sprites[0]?.name;
    s.elements.push(e);
    this.sel = e;
    this.changed(true);
  }

  private remove() {
    const s = this.cur;
    if (!s || !this.sel) return;
    this.snapshot();
    s.elements.splice(s.elements.indexOf(this.sel), 1);
    this.sel = null;
    this.changed(true);
  }

  private duplicate() {
    const s = this.cur;
    if (!s || !this.sel) return;
    this.snapshot();
    const e = { ...structuredClone(this.sel), x: this.sel.x + 4, y: this.sel.y + 4, id: `${this.sel.id}_copy` };
    s.elements.push(e);
    this.sel = e;
    this.changed(true);
  }

  private at(ev: PointerEvent): [number, number] {
    const r = this.overlay.getBoundingClientRect();
    return [(ev.clientX - r.left) / this.zoom, (ev.clientY - r.top) / this.zoom];
  }

  private down(ev: PointerEvent) {
    const s = this.cur;
    if (!s || ev.button !== 0) return;
    const [px, py] = this.at(ev);
    // the resize handle of the selected element first
    if (this.sel && RESIZABLE.includes(this.sel.kind)) {
      const b = this.box(this.sel);
      if (Math.abs(px - (b.x + b.w)) * this.zoom < 7 && Math.abs(py - (b.y + b.h)) * this.zoom < 7) {
        this.snapshot();
        this.drag = { mode: "size", dx: px, dy: py, w: b.w, h: b.h };
        this.overlay.setPointerCapture(ev.pointerId);
        return;
      }
    }
    let hit: UiElement | null = null;
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const b = this.box(s.elements[i]);
      if (px >= b.x && py >= b.y && px < b.x + b.w && py < b.y + b.h) {
        hit = s.elements[i];
        break;
      }
    }
    this.sel = hit;
    if (hit) {
      this.snapshot();
      this.drag = { mode: "move", dx: px - hit.x, dy: py - hit.y, w: 0, h: 0 };
      this.overlay.setPointerCapture(ev.pointerId);
    }
    this.renderList();
    this.renderProps();
    this.draw();
  }

  private move(ev: PointerEvent) {
    const e = this.sel, d = this.drag;
    if (!e || !d) {
      // cursor feedback
      const s = this.cur;
      if (!s) return;
      const [px, py] = this.at(ev);
      let cur = "";
      if (this.sel && RESIZABLE.includes(this.sel.kind)) {
        const b = this.box(this.sel);
        if (Math.abs(px - (b.x + b.w)) * this.zoom < 7 && Math.abs(py - (b.y + b.h)) * this.zoom < 7) cur = "nwse-resize";
      }
      this.overlay.style.cursor = cur || (s.elements.some((el) => { const b = this.box(el); return px >= b.x && py >= b.y && px < b.x + b.w && py < b.y + b.h; }) ? "move" : "");
      return;
    }
    const [px, py] = this.at(ev);
    if (d.mode === "move") {
      e.x = Math.round(px - d.dx);
      e.y = Math.round(py - d.dy);
    } else {
      e.w = Math.max(4, Math.round(d.w + px - d.dx));
      e.h = Math.max(4, Math.round(d.h + py - d.dy));
    }
    this.renderProps();
    this.changed();
  }

  private up() {
    if (!this.drag) return;
    this.drag = null;
    this.renderProps();
  }

  /** UI-tab shortcuts. */
  handleKey(ev: KeyboardEvent) {
    const e = this.sel;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === "z") { this.undo(); return true; }
    if (!e) return false;
    if (mod && ev.key.toLowerCase() === "d") { this.duplicate(); return true; }
    if (ev.key === "Delete" || ev.key === "Backspace") { this.remove(); return true; }
    const step = ev.shiftKey ? 8 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[ev.key]) {
      this.snapshot();
      e.x += moves[ev.key][0];
      e.y += moves[ev.key][1];
      this.renderProps();
      this.changed();
      return true;
    }
    if (ev.key === "Escape") { this.sel = null; this.renderList(); this.renderProps(); this.draw(); return true; }
    return false;
  }

  // ------------------------------------------------------------ panels

  private renderList() {
    const list = $("ui-list");
    list.innerHTML = "";
    const s = this.cur;
    if (!s) return;
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const e = s.elements[i];
      const row = document.createElement("div");
      row.className = "layer" + (e === this.sel ? " active" : "");
      const kind = Object.assign(document.createElement("span"), { className: "ui-kind", textContent: e.kind });
      const name = Object.assign(document.createElement("span"), { className: "lname", textContent: e.id });
      row.append(kind, name);
      row.onclick = () => { this.sel = e; this.renderList(); this.renderProps(); this.draw(); };
      list.appendChild(row);
    }
    if (!s.elements.length) list.innerHTML = '<div class="pal-empty" style="padding:8px 12px">Add text, sprites, bars, panels and buttons with the tools on the left.</div>';
  }

  private renderProps() {
    const box = $("ui-props");
    box.innerHTML = "";
    const e = this.sel;
    if (!e) {
      box.innerHTML = '<div class="pal-empty" style="padding:4px 0 8px">Select an element, or add one.</div>';
      return;
    }
    const field = (label: string, key: keyof UiElement, type: "text" | "number" | "color" | "select" = "text", opts?: { options?: [string, string][]; hint?: string; half?: boolean }) => {
      const wrap = document.createElement("label");
      wrap.className = "ui-field" + (opts?.half ? " half" : "");
      wrap.append(Object.assign(document.createElement("span"), { textContent: label }));
      let input: HTMLInputElement | HTMLSelectElement;
      if (type === "select") {
        input = document.createElement("select");
        for (const [v, l] of opts?.options ?? []) input.appendChild(Object.assign(document.createElement("option"), { value: v, textContent: l }));
        input.value = String(e[key] ?? "");
      } else {
        input = document.createElement("input");
        input.type = type === "color" ? "text" : type;
        input.value = e[key] === undefined ? "" : String(e[key]);
        input.spellcheck = false;
        if (type === "color") input.placeholder = "#rrggbb(aa)";
      }
      input.onchange = () => {
        this.snapshot();
        const v = input.value.trim();
        const r = e as unknown as Record<string, unknown>;
        if (v === "") delete r[key];
        else r[key] = type === "number" ? Number(v) : v;
        if (key === "id" || key === "kind") this.renderList();
        this.changed();
      };
      wrap.appendChild(input);
      if (opts?.hint) wrap.append(Object.assign(document.createElement("small"), { textContent: opts.hint }));
      box.appendChild(wrap);
    };
    field("Name", "id", "text", { hint: e.kind === "button" ? "UI.screen() returns it when clicked" : undefined });
    {
      const wrap = document.createElement("label");
      wrap.className = "ui-field";
      wrap.append(Object.assign(document.createElement("span"), { textContent: "Anchor" }));
      const sel = document.createElement("select");
      for (const [v, l] of ANCHORS) sel.appendChild(Object.assign(document.createElement("option"), { value: v, textContent: l }));
      sel.value = e.anchor ?? "tl";
      sel.onchange = () => {
        this.snapshot();
        const [W, H] = this.project?.cart.resolution ?? [320, 180];
        const [ox, oy] = anchorPoint(e.anchor, W, H);
        const [nx, ny] = anchorPoint(sel.value, W, H);
        // stay in place: only what x, y are measured from changes
        e.x += ox - nx;
        e.y += oy - ny;
        if (sel.value === "tl") delete e.anchor;
        else e.anchor = sel.value;
        this.renderProps();
        this.changed();
      };
      wrap.appendChild(sel);
      wrap.append(Object.assign(document.createElement("small"), { textContent: "stays at that corner / edge if the resolution changes" }));
      box.appendChild(wrap);
    }
    field("X", "x", "number", { half: true });
    field("Y", "y", "number", { half: true });
    if (RESIZABLE.includes(e.kind)) {
      field("Width", "w", "number", { half: true });
      field("Height", "h", "number", { half: true });
    }
    if (e.kind === "text" || e.kind === "button") field("Text", "text", "text", { hint: "{G.coins} shows a game value · {wave}...{/} effects" });
    if (e.kind === "text") {
      field("Color", "color", "color", { half: true });
      field("Outline", "outline", "color", { half: true });
      field("Align", "align", "select", { options: [["left", "Left"], ["center", "Center"], ["right", "Right"]], half: true });
      field("Scale", "scale", "number", { half: true });
      field("Font", "font", "select", { options: [["", "Default"], ["pico", "Pico (English)"], ["erx", "ERX A"], ["erx_b", "ERX B"]] });
    }
    if (e.kind === "sprite") {
      field("Sprite", "sprite", "select", { options: (this.project?.sprites ?? []).map((s) => [s.name, s.name]) });
      field("Frame", "frame", "number", { half: true });
      field("Scale", "scale", "number", { half: true });
      field("Repeat by", "repeat", "text", { hint: "a value like G.lives: draws it that many times (hearts)", half: false });
    }
    if (e.kind === "bar") {
      field("Value", "value", "text", { hint: "a game value, like G.hp", half: true });
      field("Max", "max", "text", { half: true });
      field("Color", "color", "color", { half: true });
      field("Back", "bg", "color", { half: true });
    }
    if (e.kind === "panel") {
      field("Color", "bg", "color", { half: true });
      field("Border", "border", "color", { half: true });
    }
    field("Show when", "visible", "text", { hint: "optional: a value like G.paused; hidden when false / 0 / nil" });
    const del = document.createElement("button");
    del.className = "ghost";
    del.textContent = "Delete element";
    del.onclick = () => this.remove();
    box.appendChild(del);
  }

  private setPreview(text: string) {
    const s = this.cur;
    if (!s) return;
    const pv: Record<string, string | number | boolean> = {};
    for (const line of text.split(/\n|,/)) {
      const m = line.match(/^\s*([\w.]+)\s*[=:]\s*(.*?)\s*$/);
      if (!m) continue;
      const v = m[2];
      pv[m[1]] = v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(Number(v)) ? Number(v) : v;
    }
    s.preview = pv;
    this.hooks.changed();
    this.push(true);
    this.draw();
  }

  // ------------------------------------------------------------ screens

  private async newScreen() {
    if (!this.project) return;
    let base = Object.keys(this.screens).length ? "screen" : "hud", name = base, i = 2;
    while (this.screens[name]) name = `${base}${i++}`;
    const n = await ask("New screen", name, { message: "A HUD, a title menu, a game over screen… Draw it in code with UI.screen(\"name\").", ok: "Create", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n || this.screens[n]) return;
    this.screens[n] = {
      elements: n === "hud" ? [
        { id: "score", kind: "text", x: 4, y: 4, text: "SCORE {G.score}", color: "#f4f4f4", outline: "#1a1c2c" },
      ] : [],
      preview: n === "hud" ? { "G.score": 1200 } : {},
    };
    this.hooks.changed();
    this.select(n);
    this.startPreview();
  }

  private async renameScreen() {
    if (!this.cur) return;
    const n = await ask("Rename screen", this.screen, { ok: "Rename", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n || n === this.screen || this.screens[n]) return;
    this.screens[n] = this.screens[this.screen];
    delete this.screens[this.screen];
    this.hooks.changed();
    this.hooks.status(`Renamed · update the code: UI.screen("${n}")`);
    this.select(n);
  }

  private async deleteScreen() {
    if (!this.cur || !(await confirmBox(`Delete the screen "${this.screen}"?`, "Code that draws it will stop with an error.", { ok: "Delete", danger: true }))) return;
    delete this.screens[this.screen];
    this.hooks.changed();
    this.select(Object.keys(this.screens)[0] ?? "");
    if (!this.cur) this.stopPreview();
  }
}
