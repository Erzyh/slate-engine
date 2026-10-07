// Sound effect maker: pick a preset, adjust a few clear controls (pitch, length, fade...), open
// "More settings" for the rest of the synth, and save to sounds/NAME.wav for sfx("name").

import { alertBox, confirmBox } from "./modal.ts";
import { defaults, mutate, PRESETS, randomize, render, SAMPLE_RATE, toWav, type SfxParams, type Wave } from "./sfx.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Control {
  key: keyof SfxParams;
  label: string;
  min: number;
  hint?: string;
  /** shows the value in plain units */
  show?: (v: number, p: SfxParams) => string;
}

const hz = (v: number) => {
  const f = (SAMPLE_RATE * 8) / (100 / (v * v + 0.001)) / 8;
  return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`;
};
const secs = (v: number) => `${((v * v * 100000) / SAMPLE_RATE).toFixed(2)} s`;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? "0" : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}`);

const BASIC: Control[] = [
  { key: "freq", label: "Pitch", min: 0, show: hz },
  { key: "slide", label: "Pitch slide", min: -1, hint: "Down ← → up", show: signed },
  { key: "sustain", label: "Length", min: 0, show: secs },
  { key: "decay", label: "Fade out", min: 0, show: secs },
  { key: "punch", label: "Punch", min: 0, hint: "A louder start", show: pct },
  { key: "volume", label: "Volume", min: 0, show: pct },
];

const ADVANCED: [string, Control[]][] = [
  ["Envelope", [{ key: "attack", label: "Fade in", min: 0, show: secs }]],
  ["Pitch", [
    { key: "freqLimit", label: "Lowest pitch", min: 0, hint: "Stops the slide here", show: hz },
    { key: "deltaSlide", label: "Slide acceleration", min: -1, show: signed },
    { key: "vibDepth", label: "Vibrato", min: 0, show: pct },
    { key: "vibSpeed", label: "Vibrato speed", min: 0, show: pct },
    { key: "arpMod", label: "Jump in pitch", min: -1, hint: "Arpeggio: pitch steps once", show: signed },
    { key: "arpSpeed", label: "Jump timing", min: 0, show: pct },
    { key: "repeatSpeed", label: "Repeat", min: 0, hint: "Restarts the sound quickly", show: pct },
  ]],
  ["Tone", [
    { key: "duty", label: "Square width", min: 0, hint: "Square wave only", show: pct },
    { key: "dutySweep", label: "Width sweep", min: -1, show: signed },
    { key: "phaserOffset", label: "Phaser", min: -1, show: signed },
    { key: "phaserSweep", label: "Phaser sweep", min: -1, show: signed },
  ]],
  ["Filters", [
    { key: "lpf", label: "Low-pass", min: 0, hint: "Lower = duller", show: pct },
    { key: "lpfSweep", label: "Low-pass sweep", min: -1, show: signed },
    { key: "lpfResonance", label: "Resonance", min: 0, show: pct },
    { key: "hpf", label: "High-pass", min: 0, hint: "Higher = thinner", show: pct },
    { key: "hpfSweep", label: "High-pass sweep", min: -1, show: signed },
  ]],
];

const PRESET_INFO: [string, string, string][] = [
  ["coin", "Coin", "pickup"],
  ["jump", "Jump", ""],
  ["laser", "Laser", "shoot"],
  ["explosion", "Explosion", ""],
  ["hit", "Hit", "hurt"],
  ["powerup", "Power-up", ""],
  ["blip", "Blip", "menu"],
];

const WAVES: [Wave, string][] = [[0, "Square"], [1, "Saw"], [2, "Sine"], [3, "Noise"]];

/** A labeled slider with its value; returns an updater. */
export function slider(host: HTMLElement, label: string, min: number, max: number, step: number, value: number, show: (v: number) => string, onInput: (v: number) => void, onChange: () => void, hint?: string) {
  const wrap = document.createElement("label");
  wrap.className = "slider";
  const name = Object.assign(document.createElement("span"), { className: "s-name", textContent: label });
  const val = Object.assign(document.createElement("span"), { className: "s-val" });
  const r = document.createElement("input");
  r.type = "range";
  r.min = String(min);
  r.max = String(max);
  r.step = String(step);
  r.value = String(value);
  r.oninput = () => {
    onInput(Number(r.value));
    val.textContent = show(Number(r.value));
  };
  r.onchange = onChange;
  val.textContent = show(value);
  wrap.append(name, val, r);
  if (hint) wrap.appendChild(Object.assign(document.createElement("span"), { className: "s-hint", textContent: hint }));
  host.appendChild(wrap);
  return (v: number) => {
    r.value = String(v);
    val.textContent = show(v);
    r.dispatchEvent(new Event("input-silent"));
  };
}

/** Draws samples as a filled waveform. */
export function drawWave(c: HTMLCanvasElement, samples: Float32Array, color = "#ffcd75") {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#262832";
  g.fillRect(0, Math.floor(h / 2), w, Math.max(1, Math.round(dpr)));
  g.fillStyle = color;
  const step = samples.length / w;
  for (let x = 0; x < w; x++) {
    let lo = 0, hi = 0;
    const from = Math.floor(x * step), to = Math.min(samples.length, Math.floor((x + 1) * step) + 1);
    for (let i = from; i < to; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (from >= samples.length) break;
    const y0 = h / 2 - hi * (h / 2 - 2), y1 = h / 2 - lo * (h / 2 - 2);
    g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
}

export class SfxDialog {
  private el = $("sfx-dialog");
  private p: SfxParams = defaults();
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private setters = new Map<keyof SfxParams, (v: number) => void>();
  private folder = "sounds";
  private preset = "";
  /** Save callback. */
  onSave: (folder: string, name: string, wav: Uint8Array) => void = () => {};
  exists: (name: string) => boolean = () => false;

  constructor() {
    const presets = $("sfx-presets");
    for (const [id, label, desc] of PRESET_INFO) {
      const b = document.createElement("button");
      b.dataset.preset = id;
      b.innerHTML = `<span></span><span class="desc"></span>`;
      b.children[0].textContent = label;
      b.children[1].textContent = desc;
      b.onclick = () => {
        this.set(PRESETS[id](), id);
        $<HTMLInputElement>("sfx-name").value = this.freeName(id);
        this.showCode();
        this.play();
      };
      presets.appendChild(b);
    }
    const seg = $("sfx-wave");
    for (const [w, label] of WAVES) {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.wave = String(w);
      b.onclick = () => {
        this.p.wave = w;
        this.markWave();
        this.play();
      };
      seg.appendChild(b);
    }
    const add = (host: HTMLElement, c: Control) => {
      const set = slider(host, c.label, c.min, 1, 0.01, this.p[c.key] as number, (v) => (c.show ? c.show(v, this.p) : v.toFixed(2)), (v) => {
        (this.p[c.key] as number) = v;
        this.drawWave();
      }, () => this.play(), c.hint);
      this.setters.set(c.key, set);
    };
    for (const c of BASIC) add($("sfx-basic"), c);
    const adv = $("sfx-advanced");
    for (const [title, list] of ADVANCED) {
      adv.appendChild(Object.assign(document.createElement("div"), { className: "section-label", textContent: title }));
      const grid = Object.assign(document.createElement("div"), { className: "slider-grid" });
      adv.appendChild(grid);
      for (const c of list) add(grid, c);
    }
    $("sfx-more").onclick = () => {
      const open = adv.classList.toggle("hidden") === false;
      $("sfx-more").classList.toggle("open", open);
    };
    $("sfx-mutate").onclick = () => {
      this.set(mutate(this.p), this.preset);
      this.play();
    };
    $("sfx-random").onclick = () => {
      this.set(randomize(), "");
      this.play();
    };
    $("sfx-play").onclick = () => this.play();
    $("sfx-close").onclick = () => this.close();
    $("sfx-cancel").onclick = () => this.close();
    $("sfx-save").onclick = () => void this.save();
    const name = $<HTMLInputElement>("sfx-name");
    name.oninput = () => {
      name.value = name.value.replace(/[^\w-]/g, "_");
      this.showCode();
    };
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.save();
    });
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === " " && !(e.target instanceof HTMLInputElement && e.target.type !== "range")) {
        e.preventDefault();
        this.play();
      }
    });
    this.el.addEventListener("mousedown", (e) => {
      if (e.target === this.el) this.close();
    });
    new ResizeObserver(() => this.drawWave()).observe($("sfx-wavecanvas"));
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  open(folder = "sounds") {
    this.folder = folder;
    this.el.classList.remove("hidden");
    if (!$<HTMLInputElement>("sfx-name").value) {
      this.set(PRESETS.coin(), "coin");
      $<HTMLInputElement>("sfx-name").value = this.freeName("coin");
    }
    this.showCode();
    requestAnimationFrame(() => this.drawWave());
    $("sfx-play").focus();
  }

  close() {
    this.src?.stop();
    this.el.classList.add("hidden");
  }

  private showCode() {
    const n = $<HTMLInputElement>("sfx-name").value || "name";
    $("sfx-code").textContent = `In code: sfx("${n}")`;
  }

  private freeName(base: string) {
    let n = base;
    for (let i = 2; this.exists(n); i++) n = `${base}${i}`;
    return n;
  }

  private markWave() {
    for (const b of $("sfx-wave").querySelectorAll<HTMLElement>("button")) b.classList.toggle("active", Number(b.dataset.wave) === this.p.wave);
  }

  private set(p: SfxParams, preset: string) {
    this.p = p;
    this.preset = preset;
    for (const [k, set] of this.setters) set(p[k] as number);
    this.markWave();
    for (const b of $("sfx-presets").querySelectorAll<HTMLElement>("button")) b.classList.toggle("active", b.dataset.preset === preset);
    this.drawWave();
  }

  private drawWave(samples = render(this.p)) {
    drawWave($<HTMLCanvasElement>("sfx-wavecanvas"), samples);
    $("sfx-len").textContent = `${(samples.length / SAMPLE_RATE).toFixed(2)} s`;
  }

  play() {
    const s = render(this.p);
    this.drawWave(s);
    if (!s.length) return;
    this.ctx ??= new AudioContext();
    this.src?.stop();
    const buf = this.ctx.createBuffer(1, s.length, SAMPLE_RATE);
    buf.copyToChannel(s, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
    this.src = src;
  }

  private async save() {
    const name = $<HTMLInputElement>("sfx-name").value.trim();
    if (!name) return $("sfx-name").focus();
    if (this.exists(name) && !(await confirmBox(`Replace "${name}"?`, "A sound with this name already exists.", { ok: "Replace", danger: true }))) return;
    const s = render(this.p);
    if (!s.length) return alertBox("Nothing to save", "This sound is silent. Make it longer or louder.");
    this.onSave(this.folder, name, toWav(s));
    $<HTMLInputElement>("sfx-name").value = this.freeName(name.replace(/\d+$/, ""));
    this.showCode();
  }
}
