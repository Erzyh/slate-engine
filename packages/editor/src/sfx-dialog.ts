// Sound effect dialog: presets, sliders, Mutate / Random, live preview, save as sounds/NAME.wav.

import { defaults, mutate, PARAMS, PRESETS, randomize, render, SAMPLE_RATE, toWav, type SfxParams, type Wave } from "./sfx.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class SfxDialog {
  private el = $("sfx-dialog");
  private p: SfxParams = defaults();
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private sliders = new Map<keyof SfxParams, HTMLInputElement>();
  private folder = "sounds";
  /** Save callback: returns an error message, or null when saved. */
  onSave: (folder: string, name: string, wav: Uint8Array) => string | null = () => null;
  exists: (name: string) => boolean = () => false;

  constructor() {
    const presets = $("sfx-presets");
    for (const name of Object.keys(PRESETS)) {
      const b = document.createElement("button");
      b.textContent = name;
      b.onclick = () => {
        this.set(PRESETS[name]());
        $<HTMLInputElement>("sfx-name").value = this.freeName(name);
        this.play();
      };
      presets.appendChild(b);
    }
    const host = $("sfx-sliders");
    for (const [key, label, min] of PARAMS) {
      const l = document.createElement("label");
      l.textContent = label;
      const r = document.createElement("input");
      r.type = "range";
      r.min = String(min);
      r.max = "1";
      r.step = "0.01";
      r.oninput = () => {
        (this.p[key] as number) = Number(r.value);
        this.drawWave();
      };
      r.onchange = () => this.play();
      l.appendChild(r);
      host.appendChild(l);
      this.sliders.set(key, r);
    }
    $<HTMLSelectElement>("sfx-wave").onchange = (e) => {
      this.p.wave = Number((e.target as HTMLSelectElement).value) as Wave;
      this.drawWave();
      this.play();
    };
    const vol = $<HTMLInputElement>("sfx-volume");
    vol.oninput = () => (this.p.volume = Number(vol.value));
    vol.onchange = () => this.play();
    $("sfx-mutate").onclick = () => {
      this.set(mutate(this.p));
      this.play();
    };
    $("sfx-random").onclick = () => {
      this.set(randomize());
      this.play();
    };
    $("sfx-play").onclick = () => this.play();
    $("sfx-close").onclick = () => this.close();
    $("sfx-save").onclick = () => this.save();
    $<HTMLInputElement>("sfx-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.save();
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
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  open(folder = "sounds") {
    this.folder = folder;
    this.el.classList.remove("hidden");
    if (!$<HTMLInputElement>("sfx-name").value) {
      this.set(PRESETS.coin());
      $<HTMLInputElement>("sfx-name").value = this.freeName("coin");
    }
    $("sfx-play").focus();
  }

  close() {
    this.src?.stop();
    this.el.classList.add("hidden");
  }

  private freeName(base: string) {
    let n = base;
    for (let i = 2; this.exists(n); i++) n = `${base}${i}`;
    return n;
  }

  private set(p: SfxParams) {
    this.p = p;
    for (const [k, r] of this.sliders) r.value = String(p[k]);
    $<HTMLSelectElement>("sfx-wave").value = String(p.wave);
    $<HTMLInputElement>("sfx-volume").value = String(p.volume);
    this.drawWave();
  }

  private samples() {
    return render(this.p);
  }

  private drawWave(samples = this.samples()) {
    const c = $<HTMLCanvasElement>("sfx-wavecanvas");
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "#7fd1ff";
    const step = Math.max(1, samples.length / c.width);
    for (let x = 0; x < c.width; x++) {
      let peak = 0;
      const from = Math.floor(x * step);
      for (let i = from; i < Math.min(samples.length, from + step); i++) peak = Math.max(peak, Math.abs(samples[i]));
      const h = Math.max(1, peak * c.height);
      if (from < samples.length) g.fillRect(x, (c.height - h) / 2, 1, h);
    }
    $("sfx-len").textContent = `${(samples.length / SAMPLE_RATE).toFixed(2)} s`;
  }

  play() {
    const s = this.samples();
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

  private save() {
    const name = $<HTMLInputElement>("sfx-name").value.trim().replace(/[^\w-]/g, "_");
    if (!name) return $("sfx-name").focus();
    if (this.exists(name) && !confirm(`Replace the sound "${name}"?`)) return;
    const s = this.samples();
    if (!s.length) return;
    const err = this.onSave(this.folder, name, toWav(s));
    if (err) return alert(err);
    $<HTMLInputElement>("sfx-name").value = this.freeName(name.replace(/\d+$/, ""));
  }
}
