// Start screen: new project, open a folder, recent projects, templates and examples (with a preview
// drawn from each project's first map screen).

import { TILE_STRIDE, type Cartridge, type SpriteDef } from "@slate/runtime";
import { example, template } from "./examples.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface WelcomeHooks {
  newProject(template: string): void;
  openFolder(): void;
  openRecent(path: string): void;
  openExample(id: string): void;
  recent(): { path: string; name: string }[];
  version: string;
}

const TEMPLATES: [string, string, string][] = [
  ["platformer", "Platformer", "Run, jump, stomp enemies and reach the flag."],
  ["topdown", "Top-down", "Explore, swing a sword, collect gems."],
  ["shmup", "Shooter", "A vertical shoot 'em up with waves of enemies."],
];
const EXAMPLES: [string, string, string][] = [
  ["jelly", "Jelly Jump", "A finished platformer with a squishy hero."],
  ["star-barrage", "Star Barrage", "A bullet hell with bosses and upgrades."],
];

async function image(url: string) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** frame i of a sprite as [image, sx, sy] */
async function frameOf(def: SpriteDef, i: number): Promise<[HTMLImageElement, number, number] | null> {
  if (def.sheet) {
    const img = await image(def.sheet);
    const cols = Math.max(1, Math.floor(img.width / def.w));
    const cells = cols * Math.max(1, Math.floor(img.height / def.h));
    if (i >= cells) i = 0;
    return [img, (i % cols) * def.w, Math.floor(i / cols) * def.h];
  }
  return def.frames[i] ? [await image(def.frames[i]), 0, 0] : null;
}

/** Draw the first screen of the cartridge's first map (tiles + objects). */
async function preview(cart: Cartridge, c: HTMLCanvasElement) {
  const [w, h] = cart.resolution;
  // previews are 16:9; tall games (shooters) are shown sideways-centered
  c.width = Math.max(w, Math.round((h * 16) / 9));
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = cart.background ?? "#000";
  g.fillRect(0, 0, c.width, c.height);
  const ox = Math.floor((c.width - w) / 2);
  const m = cart.maps?.[0];
  const sprites = new Map(cart.sprites.map((s) => [s.name, s]));
  const ts = m ? sprites.get(m.tileset) : undefined;
  // tall games (shooters) and maps without tiles: a composed shot of the game's sprites
  if (!m || !ts || h > w) return showcase(cart, g, ox, w, h);
  const tiles = new Map<number, [HTMLImageElement, number, number] | null>();
  for (const layer of m.layers) {
    if (!layer.visible) continue;
    for (let ty = 0; ty < m.h && ty * ts.h < h; ty++) {
      for (let tx = 0; tx < m.w && tx * ts.w < w; tx++) {
        const v = layer.data[ty * m.w + tx];
        if (v < 0) continue;
        if (!tiles.has(v)) {
          // tile values pack the tileset when a map uses several
          const set = sprites.get((m.tilesets?.length ? m.tilesets : [m.tileset])[Math.floor(v / TILE_STRIDE)]);
          tiles.set(v, set ? await frameOf(set, v % TILE_STRIDE) : null);
        }
        const f = tiles.get(v);
        if (f) g.drawImage(f[0], f[1], f[2], ts.w, ts.h, ox + tx * ts.w, ty * ts.h, ts.w, ts.h);
      }
    }
  }
  for (const o of m.objects ?? []) {
    const s = o.sprite ? sprites.get(o.sprite) : null;
    if (!s || o.x > w + s.w || o.y > h + s.h) continue;
    const f = await frameOf(s, 0);
    if (f) g.drawImage(f[0], f[1], f[2], s.w, s.h, ox + Math.round(o.x - s.w / 2), Math.round(o.y - s.h), s.w, s.h);
  }
}

/** background, the player near the bottom, a few enemies near the top */
async function showcase(cart: Cartridge, g: CanvasRenderingContext2D, ox: number, w: number, h: number) {
  const find = (re: RegExp) => cart.sprites.find((s) => re.test(s.name));
  const back = find(/^(space|nebula|background|bg)$/);
  if (back) {
    const f = await frameOf(back, 0);
    if (f) {
      const k = Math.max(w / back.w, h / back.h);
      g.drawImage(f[0], f[1], f[2], back.w, back.h, ox + (w - back.w * k) / 2, (h - back.h * k) / 2, back.w * k, back.h * k);
    }
  } else {
    g.fillStyle = "#94b0c2";
    for (let i = 0; i < 70; i++) g.fillRect(ox + ((i * 97) % w), (i * 53) % h, 1, 1);
  }
  const draw = async (s: SpriteDef, frame: number, cx: number, cy: number, k: number) => {
    const f = await frameOf(s, Math.min(frame, Math.max(0, (s.count ?? (s.sheet ? frame + 1 : s.frames.length)) - 1)));
    if (f) g.drawImage(f[0], f[1], f[2], s.w, s.h, Math.round(cx - (s.w * k) / 2), Math.round(cy - (s.h * k) / 2), s.w * k, s.h * k);
  };
  const player = find(/^(ship|player|hero)$/);
  const skip = /^(ship|player|hero|heart|shot|orb|bullets?|tiles|space|nebula|planet|asteroid|background|bg)$|^vfx/;
  const foes = cart.sprites.filter((s) => !skip.test(s.name) && s.w <= 96 && s.h <= 96).slice(0, 3);
  // big enough to read on a small card: the player about a fifth of the height
  const k = Math.max(1, Math.floor((h * 0.2) / Math.max(16, player?.h ?? 16)));
  const span = Math.min(g.canvas.width, w * 2.2);
  const x0 = (g.canvas.width - span) / 2;
  for (const [i, s] of foes.entries()) await draw(s, 0, x0 + (span * (i + 1)) / (foes.length + 1), h * 0.3 + (i % 2) * h * 0.08, k);
  if (player) await draw(player, 1, ox + w / 2, h * 0.78, k);
}

export class Welcome {
  private el = $("welcome");
  private drawn = false;

  constructor(private hooks: WelcomeHooks) {
    $("w-new").onclick = () => hooks.newProject("");
    $("w-open").onclick = () => hooks.openFolder();
    $("w-close").onclick = () => this.hide();
    $("w-version").textContent = `Slate ${hooks.version}`;
    this.el.addEventListener("mousedown", (e) => {
      if (e.target === this.el) this.hide();
    });
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  show() {
    this.el.classList.remove("hidden");
    this.renderRecent();
    if (!this.drawn) {
      this.drawn = true;
      void this.renderCards();
    }
  }

  hide() {
    this.el.classList.add("hidden");
  }

  private renderRecent() {
    const box = $("w-recent");
    box.innerHTML = "";
    const list = this.hooks.recent();
    if (!list.length) {
      box.innerHTML = '<div class="empty">Projects you open appear here.</div>';
      return;
    }
    for (const r of list) {
      const b = document.createElement("button");
      b.innerHTML = '<span class="r-name"></span><span class="r-path"></span>';
      b.querySelector(".r-name")!.textContent = r.name;
      b.querySelector(".r-path")!.textContent = r.path;
      b.title = r.path;
      b.onclick = () => this.hooks.openRecent(r.path);
      box.appendChild(b);
    }
  }

  private async renderCards() {
    const card = (host: HTMLElement, title: string, desc: string, cart: Cartridge | null, open: () => void) => {
      const b = document.createElement("button");
      b.className = "w-card";
      const c = document.createElement("canvas");
      b.innerHTML = '<span class="w-text"><span class="w-title"></span><span class="w-desc"></span></span>';
      b.prepend(c);
      b.querySelector(".w-title")!.textContent = title;
      b.querySelector(".w-desc")!.textContent = desc;
      b.onclick = open;
      host.appendChild(b);
      if (cart) void preview(cart, c).catch(() => {});
    };
    for (const [id, title, desc] of TEMPLATES) card($("w-templates"), title, desc, template(id), () => this.hooks.newProject(id));
    for (const [id, title, desc] of EXAMPLES) card($("w-examples"), title, desc, example(id), () => this.hooks.openExample(id));
  }
}
