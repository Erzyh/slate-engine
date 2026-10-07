// Slate Synth in the browser: procedural loops from oscillators and noise (no samples, so the result
// is yours). A port of tools/slate_synth.py: drums, bass, arpeggio, pad and a generated melody over a
// chord progression. Output loops seamlessly (the tail wraps around to the start).

export const SR = 22050;

const NOTE_PC: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const QUALITY: Record<string, number[]> = { "": [0, 4, 7], m: [0, 3, 7], m7: [0, 3, 7, 10], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], sus: [0, 5, 7], dim: [0, 3, 6], "5": [0, 7, 12] };
const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11],
};
const DRUMS: Record<string, Record<string, string>> = {
  four: { k: "x...x...x...x...", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", o: "..x...x...x...x." },
  four16: { k: "x...x...x...x...", s: "....x.......x...", h: "XxxxXxxxXxxxXxxx" },
  drive: { k: "x...x...x...x..x", s: "....x.......x.x.", h: "XxxxXxxxXxxxXxxx", o: "..x...x...x...x." },
  double: { k: "x.x.x.x.x.x.x.x.", s: "....x.......x...", c: "....x.......x...", h: "XxxxXxxxXxxxXxxx" },
  half: { k: "x.......x.x.....", s: "........x.......", h: "x.x.x.x.x.x.x.x." },
  sparse: { k: "x.......x.......", s: "............x...", h: "....x.......x..." },
  hats: { h: "x.x.x.x.x.x.x.x.", o: "......x.......x." },
};
const BASS: Record<string, string> = {
  pulse: "r.r.r.r.r.r.r.r.", oct: "r.o.r.o.r.o.r.o.", "16": "rrrrrrrrrrrrrrrr", sync: "r..r..r.r..r.r..",
  gallop: "r.rr.rr.r.rr.rr.", walk: "r.r.f.f.o.o.f.t.", long: "r---------------", half: "r-------f-------",
};
const RHYTHMS: [number, number][][] = [
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]],
  [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
  [[0, 2], [2, 1], [3, 0.5], [3.5, 0.5]],
  [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 2]],
  [[0, 1], [1, 1], [2, 2]],
  [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
  [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
];

type Wave = "square" | "saw" | "tri" | "sine" | "bell";

export interface Style {
  label: string;
  desc: string;
  bpm: number;
  key: string;
  scale: string;
  prog: string[];
  drums: string;
  bass: string;
  bassWave: Wave;
  bassCutoff: number;
  arpRate: number;
  arpWave: Wave;
  arpDuty: number;
  pad: boolean;
  leadWave: Wave;
}

export const STYLES: Record<string, Style> = {
  adventure: { label: "Adventure", desc: "bright, heroic", bpm: 128, key: "C", scale: "major", prog: ["C", "G", "Am", "F"], drums: "four", bass: "oct", bassWave: "saw", bassCutoff: 1000, arpRate: 8, arpWave: "square", arpDuty: 0.5, pad: true, leadWave: "square" },
  action: { label: "Action", desc: "fast, driving", bpm: 150, key: "A", scale: "minor", prog: ["Am", "F", "C", "G"], drums: "drive", bass: "16", bassWave: "saw", bassCutoff: 1300, arpRate: 16, arpWave: "square", arpDuty: 0.25, pad: true, leadWave: "saw" },
  chiptune: { label: "Chiptune", desc: "classic 8-bit", bpm: 140, key: "G", scale: "major", prog: ["G", "Em", "C", "D"], drums: "four16", bass: "oct", bassWave: "square", bassCutoff: 2200, arpRate: 16, arpWave: "square", arpDuty: 0.125, pad: false, leadWave: "square" },
  calm: { label: "Calm", desc: "soft, peaceful", bpm: 88, key: "D", scale: "major", prog: ["Dmaj7", "Bm7", "Gmaj7", "A"], drums: "sparse", bass: "long", bassWave: "tri", bassCutoff: 700, arpRate: 8, arpWave: "tri", arpDuty: 0.5, pad: true, leadWave: "bell" },
  dungeon: { label: "Dungeon", desc: "dark, tense", bpm: 100, key: "D", scale: "harmonic", prog: ["Dm", "Bb", "A", "Dm"], drums: "half", bass: "pulse", bassWave: "saw", bassCutoff: 600, arpRate: 8, arpWave: "square", arpDuty: 0.25, pad: true, leadWave: "square" },
  boss: { label: "Boss", desc: "heavy, urgent", bpm: 165, key: "E", scale: "harmonic", prog: ["Em", "C", "D", "B"], drums: "double", bass: "gallop", bassWave: "saw", bassCutoff: 1200, arpRate: 16, arpWave: "saw", arpDuty: 0.5, pad: true, leadWave: "saw" },
  dreamy: { label: "Title screen", desc: "dreamy, slow", bpm: 100, key: "Bb", scale: "major", prog: ["Bb", "Gm", "Eb", "F"], drums: "hats", bass: "half", bassWave: "tri", bassCutoff: 800, arpRate: 8, arpWave: "tri", arpDuty: 0.5, pad: true, leadWave: "bell" },
};

export interface SongOptions {
  style: string;
  bpm: number;
  bars: number;
  /** semitones up / down from the style's key */
  transpose: number;
  seed: number;
  parts: { drums: boolean; bass: boolean; chords: boolean; arp: boolean; melody: boolean };
}

const midiF = (m: number) => 440 * 2 ** ((m - 69) / 12);

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lowpass(x: Float32Array, cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] = y;
  }
  return x;
}

function highpass(x: Float32Array, cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * Math.min(cutoff, SR * 0.45)) / SR);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    x[i] = x[i] - y;
  }
  return x;
}

/** oscillator at a fixed frequency (or a frequency per sample) */
function osc(kind: Wave, f: number | Float32Array, n: number, duty = 0.5, detune = 0, phase = 0) {
  const out = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const fi = typeof f === "number" ? f : f[i];
    ph = (ph + (fi * (1 + detune)) / SR) % 1;
    out[i] = kind === "square" ? (ph < duty ? 1 : -1) : kind === "saw" ? 2 * ph - 1 : kind === "tri" ? 4 * Math.abs(ph - 0.5) - 1 : Math.sin(2 * Math.PI * ph);
  }
  return out;
}

function adsr(n: number, a = 0.005, d = 0.15, s = 0.6, r = 0.05, gate = n / SR) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = t < a ? t / Math.max(a, 1e-4) : s + (1 - s) * Math.exp(-(t - a) / Math.max(d, 1e-4));
    out[i] = e * (t > gate ? Math.max(0, Math.min(1, 1 - (t - gate) / Math.max(r, 1e-4))) : 1);
  }
  return out;
}

const mul = (a: Float32Array, b: Float32Array) => {
  for (let i = 0; i < a.length; i++) a[i] *= b[i];
  return a;
};

let KIT: Record<string, Float32Array> | null = null;
function kit() {
  if (KIT) return KIT;
  const r = rng(99);
  const noise = (n: number) => Float32Array.from({ length: n }, () => r() * 2 - 1);
  const len = (s: number) => Math.round(s * SR);
  const mk = (s: number, fn: (t: number, i: number) => number) => {
    const n = len(s);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = fn(i / SR, i);
    return out;
  };
  let ph = 0;
  const kick = mk(0.42, (t) => {
    ph += (46 + 120 * Math.exp(-t * 32)) / SR;
    return Math.tanh(Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5) * 1.5);
  });
  const sn = highpass(noise(len(0.24)), 1500);
  const snare = mk(0.24, (t, i) => sn[i] * Math.exp(-t * 17) * 0.9 + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 26) * 0.55);
  const clap = new Float32Array(len(0.24));
  for (const d of [0, 0.011, 0.022]) {
    const k = len(d);
    const nz = highpass(noise(clap.length - k), 900);
    for (let i = 0; i < nz.length; i++) clap[k + i] += nz[i] * Math.exp((-i / SR) * 30) * 0.6;
  }
  const hn = highpass(noise(len(0.05)), 7000);
  const hat = mk(0.05, (t, i) => hn[i] * Math.exp(-t * 80) * 0.5);
  const on = highpass(noise(len(0.3)), 6000);
  const ohat = mk(0.3, (t, i) => on[i] * Math.exp(-t * 11) * 0.4);
  const cn = highpass(noise(len(2)), 3500);
  const crash = mk(2, (t, i) => cn[i] * Math.exp(-t * 1.7) * 0.4);
  KIT = { k: kick, s: snare, c: clap, h: hat, o: ohat, crash };
  return KIT;
}

class Track {
  beat: number;
  bar: number;
  step: number;
  n: number;
  L: Float32Array;
  R: Float32Array;
  key: number;
  scale: number[];
  prog: [number, number[]][];
  rand: () => number;

  constructor(bpm: number, key: string, scale: string, prog: string[], bars: number, transpose: number, seed: number) {
    this.beat = 60 / bpm;
    this.bar = this.beat * 4;
    this.step = this.beat / 4;
    this.n = Math.round(bars * this.bar * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.key = (NOTE_PC[key] + transpose + 12) % 12;
    this.scale = SCALES[scale];
    this.prog = prog.map((c) => {
      const r = c.length > 1 && "#b".includes(c[1]) ? c.slice(0, 2) : c[0];
      return [48 + ((NOTE_PC[r] + transpose + 12) % 12), QUALITY[c.slice(r.length)] ?? QUALITY[""]];
    });
    this.rand = rng(seed);
  }

  /** mix a signal in at t seconds; the tail wraps around to the start (seamless loop) */
  add(sig: Float32Array, t: number, gain = 1, pan = 0) {
    const lg = (1 - Math.max(0, pan)) * gain, rg = (1 + Math.min(0, pan)) * gain;
    let i = Math.round(t * SR) % this.n;
    for (let k = 0; k < sig.length; k++) {
      this.L[i] += sig[k] * lg;
      this.R[i] += sig[k] * rg;
      if (++i >= this.n) i = 0;
    }
  }

  chord(bar: number) {
    return this.prog[Math.floor(bar) % this.prog.length];
  }

  drums(bars: number, pattern: string) {
    const pat = DRUMS[pattern];
    const vols: Record<string, number> = { k: 0.95, s: 0.6, c: 0.45, h: 0.28, o: 0.22 };
    const pans: Record<string, number> = { h: 0.3, o: -0.25 };
    const k = kit();
    for (let b = 0; b < bars; b++) {
      const last8 = b % 8 === 7;
      for (const [ch, steps] of Object.entries(pat)) {
        for (let i = 0; i < 16; i++) {
          const c = steps[i];
          if (c === ".") continue;
          if (last8 && "sc".includes(ch) && i >= 8) continue;
          const v = vols[ch] * (c === "X" ? 1.25 : ch === "h" && c === "x" ? 0.85 : 1);
          this.add(k[ch], b * this.bar + i * this.step, v, pans[ch] ?? 0);
        }
      }
      if (last8 && (pat.s || pat.c)) for (let i = 8; i < 16; i++) this.add(k.s, b * this.bar + i * this.step, 0.3 + 0.05 * (i - 8));
    }
    this.add(k.crash, 0, 0.6);
  }

  bass(bars: number, pattern: string, wave: Wave, cutoff: number) {
    const steps = BASS[pattern];
    for (let b = 0; b < bars; b++) {
      const [root, iv] = this.chord(b);
      const third = iv[1] ?? 4;
      let i = 0;
      while (i < 16) {
        const c = steps[i];
        if ("rotf".includes(c)) {
          let ln = 1;
          while (i + ln < 16 && steps[i + ln] === "-") ln++;
          const m = root - 24 + ({ r: 0, o: 12, f: 7, t: third } as Record<string, number>)[c];
          const dur = ln * this.step;
          const n = Math.round((dur + 0.03) * SR);
          const f = midiF(m);
          const a = osc(wave, f, n), q = osc("square", f / 2, n);
          for (let j = 0; j < n; j++) a[j] = a[j] * 0.6 + q[j] * 0.35;
          mul(lowpass(a, cutoff), adsr(n, 0.003, dur * 0.7, 0.4, 0.03, dur - 0.02));
          for (let j = 0; j < n; j++) a[j] = Math.tanh(a[j] * 1.6);
          this.add(a, b * this.bar + i * this.step, 0.38);
          i += ln;
        } else i++;
      }
    }
  }

  arp(bars: number, rate: number, wave: Wave, duty: number) {
    const order = [0, 1, 2, 3, 2, 1, 0, 2];
    const step = this.bar / rate;
    for (let b = 0; b < bars; b++) {
      const [root, iv] = this.chord(b);
      const tones = [...iv, iv[0] + 12, (iv[1] ?? 0) + 12];
      for (let i = 0; i < rate; i++) {
        const m = root + 12 + tones[order[(b * rate + i) % order.length] % tones.length];
        const n = Math.round(step * SR * 1.6);
        const s = lowpass(mul(osc(wave === "bell" ? "tri" : wave, midiF(m), n, duty), adsr(n, 0.002, 0.09, 0)), 5000);
        const t = b * this.bar + i * step;
        const pan = i % 2 ? 0.3 : -0.3;
        this.add(s, t, 0.12, pan);
        this.add(s, t + this.beat * 0.75, 0.045, -pan);
      }
    }
  }

  pad(bars: number) {
    for (let b = 0; b < bars; b++) {
      const [root, iv] = this.chord(b);
      const n = Math.round((this.bar + 0.5) * SR);
      const s = new Float32Array(n);
      for (const k of iv) {
        const f = midiF(root + k);
        for (const dt of [-0.006, 0, 0.007]) {
          const o = osc("saw", f, n, 0.5, dt, this.rand());
          for (let j = 0; j < n; j++) s[j] += o[j] / (3 * iv.length);
        }
      }
      mul(lowpass(s, 1500), adsr(n, 0.35, 10, 1, 0.45, this.bar));
      this.add(s, b * this.bar, 0.2);
    }
  }

  private degToMidi(deg: number, base: number) {
    const o = Math.floor(deg / 7), d = ((deg % 7) + 7) % 7;
    return base + this.key + 12 * o + this.scale[d];
  }

  private nearestChordTone(m: number, bar: number) {
    const [root, iv] = this.chord(bar);
    const pcs = new Set(iv.map((k) => (root + k) % 12));
    for (const d of [0, -1, 1, -2, 2, -3, 3]) if (pcs.has((((m + d) % 12) + 12) % 12)) return m + d;
    return m;
  }

  /** A A' B A'' phrases (2 bars per motif) that follow the chords: [bar, beat, midi, beats][] */
  melody(bars: number, register = 72) {
    const r = this.rand;
    const base = register - 12 - this.key;
    const motif = () => {
      const out: [number, number, number, number][] = [];
      let deg = 0;
      for (let bo = 0; bo < 2; bo++) {
        for (const [bt, ln] of RHYTHMS[Math.floor(r() * RHYTHMS.length)]) {
          out.push([bo, bt, ln, deg]);
          deg += [-2, -1, -1, 1, 1, 2, 0, 3, -3][Math.floor(r() * 9)];
          deg = Math.max(-4, Math.min(6, deg));
        }
      }
      return out;
    };
    const realize = (m: [number, number, number, number][], bar0: number, ending?: number) => {
      const [root] = this.chord(bar0);
      let best = 0, bestD = 1e9;
      for (let d = -7; d < 14; d++) {
        const dist = Math.abs(this.degToMidi(d, base) - (root + 24 + (register - 72)));
        if (dist < bestD) [best, bestD] = [d, dist];
      }
      return m.map(([bo, bt, ln, deg], i): [number, number, number, number] => {
        let md = this.degToMidi(best + deg, base);
        if (bt === 0 || bt === 2 || i === m.length - 1) md = this.nearestChordTone(md, bar0 + bo);
        if (ending !== undefined && i === m.length - 1) {
          md = this.nearestChordTone(md + ending, bar0 + bo);
          ln = Math.max(ln, 1.5);
        }
        return [bar0 + bo, bt, md, ln * 0.92];
      });
    };
    const a = motif(), b = motif();
    const out: [number, number, number, number][] = [];
    for (let k = 0; k < bars; k += 8) {
      out.push(...realize(a, k), ...realize(a, k + 2, 2), ...realize(b, k + 4), ...realize(a, k + 6, -1));
    }
    return out.filter((n) => n[0] < bars);
  }

  lead(notes: [number, number, number, number][], wave: Wave) {
    for (const [bar, bt, m, ln] of notes) {
      const dur = ln * this.beat;
      const n = Math.round((dur + 0.06) * SR);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        f[i] = midiF(m) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t * 2.5));
      }
      let s: Float32Array;
      if (wave === "bell") {
        s = new Float32Array(n);
        let p1 = 0, p2 = 0;
        for (let i = 0; i < n; i++) {
          const t = i / SR;
          p1 += f[i] / SR;
          p2 += (f[i] * 3.5) / SR;
          s[i] = Math.sin(2 * Math.PI * p1 + 2.2 * Math.exp(-t * 6) * Math.sin(2 * Math.PI * p2)) * Math.exp(-t * 3.2);
        }
      } else {
        const a = osc(wave, f, n), q = osc("square", f, n, 0.5, 0.003);
        for (let i = 0; i < n; i++) a[i] = a[i] * 0.55 + q[i] * 0.45;
        s = mul(lowpass(a, 2800), adsr(n, 0.008, dur, 0.65, 0.06, dur - 0.03));
      }
      const t = bar * this.bar + bt * this.beat;
      this.add(s, t, 0.15);
      this.add(s, t + this.beat * 0.75, 0.055, 0.5);
      this.add(s, t + this.beat * 1.5, 0.03, -0.5);
    }
  }

  master(): [Float32Array, Float32Array] {
    highpass(this.L, 25);
    highpass(this.R, 25);
    let peak = 1e-9;
    for (let i = 0; i < this.n; i++) peak = Math.max(peak, Math.abs(this.L[i]), Math.abs(this.R[i]));
    const k = 1.8 / peak, norm = Math.tanh(1.8);
    let sum = 0, top = 1e-9;
    for (let i = 0; i < this.n; i++) {
      this.L[i] = Math.tanh(this.L[i] * k) / norm;
      this.R[i] = Math.tanh(this.R[i] * k) / norm;
      sum += this.L[i] ** 2 + this.R[i] ** 2;
      top = Math.max(top, Math.abs(this.L[i]), Math.abs(this.R[i]));
    }
    const rms = Math.sqrt(sum / (2 * this.n)) + 1e-9;
    const g = Math.min(0.98 / top, 0.17 / rms);
    for (let i = 0; i < this.n; i++) {
      this.L[i] *= g;
      this.R[i] *= g;
    }
    return [this.L, this.R];
  }
}

/** Render a loop; returns the left and right channels at SR. */
export function renderSong(o: SongOptions): [Float32Array, Float32Array] {
  const st = STYLES[o.style];
  const tr = new Track(o.bpm, st.key, st.scale, st.prog, o.bars, o.transpose, o.seed);
  if (o.parts.drums) tr.drums(o.bars, st.drums);
  if (o.parts.bass) tr.bass(o.bars, st.bass, st.bassWave, st.bassCutoff);
  if (o.parts.chords && st.pad) tr.pad(o.bars);
  if (o.parts.arp) tr.arp(o.bars, st.arpRate, st.arpWave, st.arpDuty);
  if (o.parts.melody) tr.lead(tr.melody(o.bars, st.leadWave === "bell" ? 79 : 74), st.leadWave);
  return tr.master();
}

/** 16-bit stereo WAV */
export function stereoWav(L: Float32Array, R: Float32Array, rate = SR): Uint8Array {
  const n = L.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), true);
    v.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), true);
  }
  return new Uint8Array(buf);
}
