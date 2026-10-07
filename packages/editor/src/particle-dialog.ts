// Particle editor: presets with a live preview. Presets live in slate.json ("particles") and games
// use them by name: fx:burst(x, y, "explosion") or, for the ones with a rate, fx:emit(x, y, "smoke", dt).
// The preview runs the same rules as Particles in std.luau.

import type { ParticlePreset } from "@slate/runtime";
import { ask, confirmBox } from "./modal.ts";
import { slider } from "./sfx-dialog.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DEG = Math.PI / 180;
/** preview size in game pixels */
const PW = 200, PH = 120;

const TEMPLATES: [string, string, ParticlePreset][] = [
  ["explosion", "Explosion", { count: 30, colors: ["#ffcd75", "#ef7d57", "#b13e53", "#ffffff"], speed: 110, angle: -90 * DEG, spread: 180 * DEG, life: 0.6, gravity: 60, drag: 2, size: 3, shrink: true, add: true }],
  ["sparkle", "Sparkle", { count: 14, colors: ["#ffffff", "#73eff7", "#ffcd75"], speed: 40, angle: -90 * DEG, spread: 180 * DEG, life: 0.7, gravity: -10, drag: 1, size: 1, shrink: true, add: true }],
  ["hit", "Hit", { count: 10, colors: ["#ffffff", "#ffcd75"], speed: 90, angle: -90 * DEG, spread: 180 * DEG, life: 0.25, gravity: 0, drag: 6, size: 2, shrink: true }],
  ["dust", "Dust", { count: 8, colors: ["#c2c3c7", "#94b0c2"], speed: 30, angle: -90 * DEG, spread: 50 * DEG, life: 0.4, gravity: 40, drag: 3, size: 2, shrink: true }],
  ["smoke", "Smoke", { count: 1, rate: 14, colors: ["#566c86", "#333c57", "#94b0c2"], speed: 14, angle: -90 * DEG, spread: 25 * DEG, life: 1.4, gravity: -12, drag: 0.5, size: 4, shrink: true, radius: 2 }],
  ["fire", "Fire", { count: 1, rate: 40, colors: ["#ffcd75", "#ef7d57", "#b13e53"], speed: 26, angle: -90 * DEG, spread: 20 * DEG, life: 0.55, gravity: -30, drag: 0, size: 3, shrink: true, add: true, radius: 2 }],
];

interface P {
  x: number; y: number; vx: number; vy: number; g: number; drag: number; life: number; max: number; c: string; s: number; shrink: boolean; add: boolean;
}

export interface ParticleHooks {
  presets(): Record<string, ParticlePreset>;
  changed(): void;
}

export class ParticleDialog {
  private el = $("particle-dialog");
  private name = "";
  private list: P[] = [];
  private raf = 0;
  private acc = 0;
  private nextBurst = 0;
  private setters: Record<string, (v: number) => void> = {};

  constructor(private hooks: ParticleHooks) {
    $("pt-close").onclick = $("pt-done").onclick = () => this.close();
    this.el.addEventListener("mousedown", (e) => { if (e.target === this.el) this.close(); });
    $("pt-new").onclick = () => void this.create();
    $("pt-del").onclick = () => void this.remove();
    const c = $<HTMLCanvasElement>("pt-canvas");
    c.width = PW;
    c.height = PH;
    c.onpointerdown = (e) => {
      const r = c.getBoundingClientRect();
      this.burst(((e.clientX - r.left) / r.width) * PW, ((e.clientY - r.top) / r.height) * PH);
    };
    const tl = $("pt-templates");
    for (const [id, label, p] of TEMPLATES) {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = () => void this.create(id, p);
      tl.appendChild(b);
    }
    this.buildControls();
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  open(name?: string) {
    this.el.classList.remove("hidden");
    const names = Object.keys(this.hooks.presets());
    this.select(name && names.includes(name) ? name : names[0] ?? "");
    const loop = () => {
      this.step(1 / 60);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  close() {
    this.el.classList.add("hidden");
    cancelAnimationFrame(this.raf);
    this.list = [];
  }

  private get preset(): ParticlePreset | null {
    return this.hooks.presets()[this.name] ?? null;
  }

  private select(name: string) {
    this.name = name;
    this.list = [];
    this.renderList();
    const p = this.preset;
    $("pt-editor").classList.toggle("disabled", !p);
    if (!p) {
      $("pt-code").textContent = "Make a preset: pick one under Start from, or New";
      return;
    }
    const set = this.setters;
    set.count(p.count ?? 20);
    set.rate(p.rate ?? 0);
    set.speed(p.speed ?? 80);
    set.angle(Math.round(((p.angle ?? -Math.PI / 2) / DEG)));
    set.spread(Math.round(((p.spread ?? Math.PI) / DEG)));
    set.life(p.life ?? 0.6);
    set.gravity(p.gravity ?? 0);
    set.drag(p.drag ?? 0);
    set.size(p.size ?? 1);
    set.radius(p.radius ?? 0);
    $<HTMLInputElement>("pt-shrink").checked = p.shrink !== false;
    $<HTMLInputElement>("pt-add").checked = !!p.add;
    this.renderColors();
    this.showCode();
  }

  private renderList() {
    const box = $("pt-list");
    box.innerHTML = "";
    const names = Object.keys(this.hooks.presets());
    if (!names.length) box.innerHTML = '<div class="empty muted small">No presets yet</div>';
    for (const n of names) {
      const b = document.createElement("button");
      b.textContent = n;
      b.className = n === this.name ? "active" : "";
      b.title = "Double click to rename";
      b.onclick = () => this.select(n);
      b.ondblclick = () => void this.rename(n);
      box.appendChild(b);
    }
    $<HTMLButtonElement>("pt-del").disabled = !this.preset;
  }

  private async create(id = "particles", from?: ParticlePreset) {
    const all = this.hooks.presets();
    let name = id, i = 2;
    while (all[name]) name = `${id}${i++}`;
    const n = await ask("New particle preset", name, { message: 'Used in code: fx:burst(x, y, "name")', ok: "Create", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n) return;
    if (all[n] && !(await confirmBox(`Replace "${n}"?`, "A preset with this name exists.", { ok: "Replace", danger: true }))) return;
    all[n] = structuredClone(from ?? TEMPLATES[0][2]);
    this.hooks.changed();
    this.select(n);
  }

  private async rename(old: string) {
    const all = this.hooks.presets();
    const n = await ask("Rename preset", old, { ok: "Rename", clean: (v) => v.replace(/[^\w-]/g, "_") });
    if (!n || n === old || all[n]) return;
    all[n] = all[old];
    delete all[old];
    this.hooks.changed();
    this.select(n);
  }

  private async remove() {
    const all = this.hooks.presets();
    if (!this.preset || !(await confirmBox(`Delete "${this.name}"?`, "Code that uses it will stop with an error.", { ok: "Delete", danger: true }))) return;
    delete all[this.name];
    this.hooks.changed();
    this.select(Object.keys(all)[0] ?? "");
  }

  private edit(fn: (p: ParticlePreset) => void) {
    const p = this.preset;
    if (!p) return;
    fn(p);
    this.showCode();
  }

  private buildControls() {
    const host = $("pt-sliders");
    const num = (key: string, label: string, min: number, max: number, step: number, show: (v: number) => string, apply: (p: ParticlePreset, v: number) => void, hint?: string) => {
      this.setters[key] = slider(host, label, min, max, step, 0, show, (v) => this.edit((p) => apply(p, v)), () => this.hooks.changed(), hint);
    };
    num("count", "Count", 1, 200, 1, (v) => String(v), (p, v) => (p.count = v), "particles per burst");
    num("rate", "Rate", 0, 200, 1, (v) => (v ? `${v}/s` : "burst"), (p, v) => (v ? (p.rate = v) : delete p.rate), "0 = bursts; more = keeps emitting (fx:emit)");
    num("speed", "Speed", 0, 400, 1, (v) => `${v}`, (p, v) => (p.speed = v));
    num("angle", "Direction", -180, 180, 1, (v) => `${v}°`, (p, v) => (p.angle = v * DEG), "-90 = up");
    num("spread", "Spread", 0, 180, 1, (v) => `±${v}°`, (p, v) => (p.spread = v * DEG), "180 = all around");
    num("life", "Life", 0.05, 4, 0.05, (v) => `${v.toFixed(2)} s`, (p, v) => (p.life = v));
    num("gravity", "Gravity", -400, 600, 5, (v) => `${v}`, (p, v) => (p.gravity = v), "minus rises (smoke, fire)");
    num("drag", "Drag", 0, 10, 0.1, (v) => v.toFixed(1), (p, v) => (p.drag = v), "slows down");
    num("size", "Size", 1, 8, 1, (v) => `${v} px`, (p, v) => (p.size = v));
    num("radius", "Area", 0, 40, 1, (v) => `${v} px`, (p, v) => (v ? (p.radius = v) : delete p.radius), "start spread around the point");
    $<HTMLInputElement>("pt-shrink").onchange = (e) => { this.edit((p) => (p.shrink = (e.target as HTMLInputElement).checked)); this.hooks.changed(); };
    $<HTMLInputElement>("pt-add").onchange = (e) => {
      this.edit((p) => ((e.target as HTMLInputElement).checked ? (p.add = true) : delete p.add));
      this.hooks.changed();
    };
  }

  private renderColors() {
    const box = $("pt-colors");
    box.innerHTML = "";
    const p = this.preset;
    if (!p) return;
    p.colors ??= ["#ffffff"];
    p.colors.forEach((c, i) => {
      const sw = document.createElement("label");
      sw.className = "pt-sw";
      sw.style.background = c;
      sw.title = `${c} · click to change, right click to remove`;
      const input = document.createElement("input");
      input.type = "color";
      input.value = c;
      input.oninput = () => { p.colors![i] = input.value; sw.style.background = input.value; };
      input.onchange = () => this.hooks.changed();
      sw.appendChild(input);
      sw.oncontextmenu = (e) => {
        e.preventDefault();
        if (p.colors!.length < 2) return;
        p.colors!.splice(i, 1);
        this.renderColors();
        this.hooks.changed();
      };
      box.appendChild(sw);
    });
    const add = document.createElement("button");
    add.className = "pt-add ghost";
    add.textContent = "+";
    add.title = "Add a color";
    add.onclick = () => {
      p.colors!.push(p.colors![p.colors!.length - 1] ?? "#ffffff");
      this.renderColors();
      this.hooks.changed();
    };
    box.appendChild(add);
  }

  private showCode() {
    const p = this.preset;
    $("pt-code").textContent = p ? (p.rate ? `fx:emit(x, y, "${this.name}", dt)` : `fx:burst(x, y, "${this.name}")`) : "";
  }

  // ------------------------------------------------------------ preview (same rules as std.luau)

  private burst(x: number, y: number, n?: number) {
    const o = this.preset;
    if (!o) return;
    const colors = o.colors?.length ? o.colors : ["#ffffff"];
    const r = o.radius ?? 0;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < (n ?? o.count ?? 20); i++) {
      const a = (o.angle ?? -Math.PI / 2) + rnd(-(o.spread ?? Math.PI), o.spread ?? Math.PI);
      const v = rnd(0.3, 1) * (o.speed ?? 80);
      const life = rnd(0.5, 1) * (o.life ?? 0.6);
      const ra = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * r;
      this.list.push({
        x: x + Math.cos(ra) * rr, y: y + Math.sin(ra) * rr, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: o.gravity ?? 0, drag: o.drag ?? 0,
        life, max: life, c: colors[Math.floor(Math.random() * colors.length)], s: o.size ?? 1, shrink: o.shrink !== false, add: !!o.add,
      });
    }
  }

  private step(dt: number) {
    const o = this.preset;
    if (o?.rate) {
      this.acc += o.rate * dt;
      const n = Math.floor(this.acc);
      if (n > 0) {
        this.acc -= n;
        this.burst(PW / 2, PH * 0.7, n);
      }
    } else if (o) {
      this.nextBurst -= dt;
      if (this.nextBurst <= 0) {
        this.nextBurst = Math.max(1, (o.life ?? 0.6) + 0.4);
        this.burst(PW / 2, PH / 2);
      }
    }
    this.list = this.list.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) return false;
      p.vy += p.g * dt;
      const k = 1 - p.drag * dt;
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return true;
    });
  }

  private draw() {
    const g = $<HTMLCanvasElement>("pt-canvas").getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#1a1c2c";
    g.fillRect(0, 0, PW, PH);
    for (const p of this.list) {
      const s = p.shrink ? Math.max(1, Math.ceil((p.s * p.life) / p.max)) : p.s;
      g.globalCompositeOperation = p.add ? "lighter" : "source-over";
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
    }
    g.globalCompositeOperation = "source-over";
  }
}
