// Music maker: pick a style, set tempo / length / key, choose the instruments, press New melody until
// it sounds right, then save a seamless loop to music/NAME.wav for music("name").

import { confirmBox } from "./modal.ts";
import { renderSong, SR, stereoWav, STYLES, type SongOptions } from "./music.ts";
import { drawWave, slider } from "./sfx-dialog.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const KEYS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const PC: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const PARTS: [keyof SongOptions["parts"], string, string][] = [
  ["drums", "Drums", "kick, snare, hats"],
  ["bass", "Bass", "the low line"],
  ["chords", "Chords", "soft pad"],
  ["arp", "Arpeggio", "fast chord notes"],
  ["melody", "Melody", "the tune"],
];

export class MusicDialog {
  private el = $("music-dialog");
  private o: SongOptions = { style: "adventure", bpm: 128, bars: 16, transpose: 0, seed: 1, parts: { drums: true, bass: true, chords: true, arp: true, melody: true } };
  private song: [Float32Array, Float32Array] | null = null;
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private setters: Record<string, (v: number) => void> = {};
  private folder = "music";
  private timer = 0;
  onSave: (folder: string, name: string, wav: Uint8Array) => void = () => {};
  exists: (name: string) => boolean = () => false;

  constructor() {
    const styles = $("music-styles");
    for (const [id, st] of Object.entries(STYLES)) {
      const b = document.createElement("button");
      b.dataset.style = id;
      b.innerHTML = "<span></span><span class=\"desc\"></span>";
      b.children[0].textContent = st.label;
      b.children[1].textContent = st.desc;
      b.onclick = () => this.setStyle(id);
      styles.appendChild(b);
    }
    const song = $("music-song");
    this.setters.bpm = slider(song, "Tempo", 60, 200, 1, this.o.bpm, (v) => `${v} BPM`, (v) => (this.o.bpm = v), () => this.rebuild(true));
    this.setters.bars = slider(song, "Length", 4, 32, 4, this.o.bars, (v) => `${v} bars · ${this.seconds(v)} s`, (v) => (this.o.bars = v), () => this.rebuild(true));
    this.setters.transpose = slider(song, "Key", -6, 6, 1, 0, (v) => this.keyName(v), (v) => (this.o.transpose = v), () => this.rebuild(true), "Higher or lower");
    const parts = $("music-parts");
    for (const [key, label, desc] of PARTS) {
      const card = document.createElement("label");
      card.className = "instrument";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.o.parts[key];
      cb.onchange = () => {
        this.o.parts[key] = cb.checked;
        this.rebuild(true);
      };
      const text = document.createElement("span");
      text.innerHTML = '<div class="i-name"></div><div class="i-desc"></div>';
      text.querySelector(".i-name")!.textContent = label;
      text.querySelector(".i-desc")!.textContent = desc;
      card.append(cb, text);
      parts.appendChild(card);
    }
    $("music-new").onclick = () => {
      this.o.seed = Math.floor(Math.random() * 1e9);
      this.rebuild(true);
    };
    $("music-play").onclick = () => (this.src ? this.stop() : this.play());
    $("music-close").onclick = () => this.close();
    $("music-cancel").onclick = () => this.close();
    $("music-save").onclick = () => void this.save();
    const name = $<HTMLInputElement>("music-name");
    name.oninput = () => {
      name.value = name.value.replace(/[^\w-]/g, "_");
      this.showCode();
    };
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === " " && !(e.target instanceof HTMLInputElement && e.target.type !== "range")) {
        e.preventDefault();
        if (this.src) this.stop();
        else this.play();
      }
    });
    this.el.addEventListener("mousedown", (e) => {
      if (e.target === this.el) this.close();
    });
    new ResizeObserver(() => this.draw()).observe($("music-canvas"));
  }

  get isOpen() {
    return !this.el.classList.contains("hidden");
  }

  private seconds(bars: number) {
    return Math.round((bars * 4 * 60) / this.o.bpm);
  }

  private keyName(t: number) {
    const st = STYLES[this.o.style];
    const minor = st.scale !== "major" && st.scale !== "lydian";
    return `${KEYS[(PC[st.key] + t + 12) % 12]} ${minor ? "minor" : "major"}`;
  }

  open(folder = "music") {
    this.folder = folder;
    this.el.classList.remove("hidden");
    if (!this.song) this.setStyle("adventure");
    if (!$<HTMLInputElement>("music-name").value) $<HTMLInputElement>("music-name").value = this.freeName("theme");
    this.showCode();
    requestAnimationFrame(() => this.draw());
  }

  close() {
    this.stop();
    this.el.classList.add("hidden");
  }

  private setStyle(id: string) {
    const st = STYLES[id];
    this.o.style = id;
    this.o.bpm = st.bpm;
    this.o.transpose = 0;
    this.setters.bpm(st.bpm);
    this.setters.transpose(0);
    this.setters.bars(this.o.bars);
    for (const b of $("music-styles").querySelectorAll<HTMLElement>("button")) b.classList.toggle("active", b.dataset.style === id);
    this.rebuild(true);
  }

  private showCode() {
    $("music-code").textContent = `In code: music("${$<HTMLInputElement>("music-name").value || "name"}")`;
  }

  private freeName(base: string) {
    let n = base;
    for (let i = 2; this.exists(n); i++) n = `${base}${i}`;
    return n;
  }

  /** Render again (debounced), and keep playing if it was playing. */
  private rebuild(replay: boolean) {
    clearTimeout(this.timer);
    $("music-len").textContent = "Rendering…";
    this.timer = window.setTimeout(() => {
      const playing = !!this.src;
      this.song = renderSong(this.o);
      this.setters.bars(this.o.bars);
      this.draw();
      if (playing && replay) this.play();
    }, 30);
  }

  private draw() {
    if (!this.song) return;
    const [L, R] = this.song;
    const mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    drawWave($<HTMLCanvasElement>("music-canvas"), mono, "#8ab4ff");
    $("music-len").textContent = `${(L.length / SR).toFixed(1)} s loop`;
  }

  private play() {
    if (!this.song) return;
    this.stop();
    this.ctx ??= new AudioContext();
    const [L, R] = this.song;
    const buf = this.ctx.createBuffer(2, L.length, SR);
    buf.copyToChannel(L as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(R as Float32Array<ArrayBuffer>, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.ctx.destination);
    src.start();
    this.src = src;
    $("music-play").innerHTML = '<svg><use href="#i-stop" /></svg>Stop';
  }

  private stop() {
    this.src?.stop();
    this.src = null;
    $("music-play").innerHTML = '<svg><use href="#i-play" /></svg>Play';
  }

  private async save() {
    const name = $<HTMLInputElement>("music-name").value.trim();
    if (!name || !this.song) return $("music-name").focus();
    if (this.exists(name) && !(await confirmBox(`Replace "${name}"?`, "A track with this name already exists.", { ok: "Replace", danger: true }))) return;
    this.onSave(this.folder, name, stereoWav(this.song[0], this.song[1]));
    $<HTMLInputElement>("music-name").value = this.freeName(name.replace(/\d+$/, ""));
    this.showCode();
  }
}
