// Sound effect generator: the classic sfxr synth (square / saw / sine / noise + envelope, slides,
// vibrato, arpeggio, duty sweep, phaser, filters), presets and mutation. Output is 16-bit mono WAV.

export type Wave = 0 | 1 | 2 | 3; // square, saw, sine, noise

export interface SfxParams {
  wave: Wave;
  attack: number;
  sustain: number;
  punch: number;
  decay: number;
  freq: number;
  freqLimit: number;
  slide: number;
  deltaSlide: number;
  vibDepth: number;
  vibSpeed: number;
  arpMod: number;
  arpSpeed: number;
  duty: number;
  dutySweep: number;
  repeatSpeed: number;
  phaserOffset: number;
  phaserSweep: number;
  lpf: number;
  lpfSweep: number;
  lpfResonance: number;
  hpf: number;
  hpfSweep: number;
  volume: number;
}

/** Slider metadata: key, label, min (0 or -1). */
export const PARAMS: [keyof SfxParams, string, number][] = [
  ["attack", "Attack", 0],
  ["sustain", "Sustain", 0],
  ["punch", "Punch", 0],
  ["decay", "Decay", 0],
  ["freq", "Pitch", 0],
  ["freqLimit", "Min pitch", 0],
  ["slide", "Slide", -1],
  ["deltaSlide", "Slide accel", -1],
  ["vibDepth", "Vibrato", 0],
  ["vibSpeed", "Vibrato speed", 0],
  ["arpMod", "Arpeggio", -1],
  ["arpSpeed", "Arp speed", 0],
  ["duty", "Square duty", 0],
  ["dutySweep", "Duty sweep", -1],
  ["repeatSpeed", "Repeat", 0],
  ["phaserOffset", "Phaser", -1],
  ["phaserSweep", "Phaser sweep", -1],
  ["lpf", "Low-pass", 0],
  ["lpfSweep", "Low-pass sweep", -1],
  ["lpfResonance", "Resonance", 0],
  ["hpf", "High-pass", 0],
  ["hpfSweep", "High-pass sweep", -1],
];

export function defaults(): SfxParams {
  return {
    wave: 0, attack: 0, sustain: 0.3, punch: 0, decay: 0.4, freq: 0.3, freqLimit: 0, slide: 0, deltaSlide: 0,
    vibDepth: 0, vibSpeed: 0, arpMod: 0, arpSpeed: 0, duty: 0, dutySweep: 0, repeatSpeed: 0, phaserOffset: 0,
    phaserSweep: 0, lpf: 1, lpfSweep: 0, lpfResonance: 0, hpf: 0, hpfSweep: 0, volume: 0.5,
  };
}

const rnd = (r: number) => Math.random() * r;
const pick = (n: number) => Math.floor(Math.random() * n);

export const PRESETS: Record<string, () => SfxParams> = {
  coin() {
    const p = defaults();
    p.freq = 0.4 + rnd(0.5);
    p.sustain = rnd(0.1);
    p.decay = 0.1 + rnd(0.4);
    p.punch = 0.3 + rnd(0.3);
    if (pick(2)) {
      p.arpSpeed = 0.5 + rnd(0.2);
      p.arpMod = 0.2 + rnd(0.4);
    }
    return p;
  },
  laser() {
    const p = defaults();
    p.wave = pick(3) as Wave;
    if (p.wave === 2 && pick(2)) p.wave = pick(2) as Wave;
    p.freq = 0.5 + rnd(0.5);
    p.freqLimit = Math.max(0.2, p.freq - 0.2 - rnd(0.6));
    p.slide = -0.15 - rnd(0.2);
    if (pick(3) === 0) {
      p.freq = 0.3 + rnd(0.6);
      p.freqLimit = rnd(0.1);
      p.slide = -0.35 - rnd(0.3);
    }
    if (pick(2)) {
      p.duty = rnd(0.5);
      p.dutySweep = rnd(0.2);
    } else {
      p.duty = 0.4 + rnd(0.5);
      p.dutySweep = -rnd(0.7);
    }
    p.sustain = 0.1 + rnd(0.2);
    p.decay = rnd(0.4);
    if (pick(2)) p.punch = rnd(0.3);
    if (pick(3) === 0) {
      p.phaserOffset = rnd(0.2);
      p.phaserSweep = -rnd(0.2);
    }
    if (pick(2)) p.hpf = rnd(0.3);
    return p;
  },
  explosion() {
    const p = defaults();
    p.wave = 3;
    if (pick(2)) {
      p.freq = 0.1 + rnd(0.4);
      p.slide = -0.1 + rnd(0.4);
    } else {
      p.freq = 0.2 + rnd(0.7);
      p.slide = -0.2 - rnd(0.2);
    }
    p.freq *= p.freq;
    if (pick(5) === 0) p.slide = 0;
    if (pick(3) === 0) p.repeatSpeed = 0.3 + rnd(0.5);
    p.sustain = 0.1 + rnd(0.3);
    p.decay = 0.3 + rnd(0.5);
    if (pick(2) === 0) {
      p.phaserOffset = -0.3 + rnd(0.9);
      p.phaserSweep = -rnd(0.3);
    }
    p.punch = 0.2 + rnd(0.6);
    if (pick(2)) {
      p.vibDepth = rnd(0.7);
      p.vibSpeed = rnd(0.6);
    }
    if (pick(3) === 0) {
      p.arpSpeed = 0.6 + rnd(0.3);
      p.arpMod = 0.8 - rnd(1.6);
    }
    return p;
  },
  powerup() {
    const p = defaults();
    if (pick(2)) p.wave = 1;
    else p.duty = rnd(0.6);
    if (pick(2)) {
      p.freq = 0.2 + rnd(0.3);
      p.slide = 0.1 + rnd(0.4);
      p.repeatSpeed = 0.4 + rnd(0.4);
    } else {
      p.freq = 0.2 + rnd(0.3);
      p.slide = 0.05 + rnd(0.2);
      if (pick(2)) {
        p.vibDepth = rnd(0.7);
        p.vibSpeed = rnd(0.6);
      }
    }
    p.sustain = rnd(0.4);
    p.decay = 0.1 + rnd(0.4);
    return p;
  },
  hit() {
    const p = defaults();
    p.wave = pick(3) as Wave;
    if (p.wave === 2) p.wave = 3;
    if (p.wave === 0) p.duty = rnd(0.6);
    p.freq = 0.2 + rnd(0.6);
    p.slide = -0.3 - rnd(0.4);
    p.sustain = rnd(0.1);
    p.decay = 0.1 + rnd(0.2);
    if (pick(2)) p.hpf = rnd(0.3);
    return p;
  },
  jump() {
    const p = defaults();
    p.wave = 0;
    p.duty = rnd(0.6);
    p.freq = 0.3 + rnd(0.3);
    p.slide = 0.1 + rnd(0.2);
    p.sustain = 0.1 + rnd(0.3);
    p.decay = 0.1 + rnd(0.2);
    if (pick(2)) p.hpf = rnd(0.3);
    if (pick(2)) p.lpf = 1 - rnd(0.6);
    return p;
  },
  blip() {
    const p = defaults();
    p.wave = pick(2) as Wave;
    if (p.wave === 0) p.duty = rnd(0.6);
    p.freq = 0.2 + rnd(0.4);
    p.sustain = 0.1 + rnd(0.1);
    p.decay = rnd(0.2);
    p.hpf = 0.1;
    return p;
  },
};

export function randomize(): SfxParams {
  const p = defaults();
  const cube = (x: number) => x * x * x;
  p.wave = pick(4) as Wave;
  p.freq = Math.pow(rnd(2) - 1, 2);
  if (pick(2)) p.freq = Math.pow(rnd(2) - 1, 3) + 0.5;
  p.slide = Math.pow(rnd(2) - 1, 5);
  if (p.freq > 0.7 && p.slide > 0.2) p.slide = -p.slide;
  if (p.freq < 0.2 && p.slide < -0.05) p.slide = -p.slide;
  p.deltaSlide = Math.pow(rnd(2) - 1, 3);
  p.duty = rnd(2) - 1;
  p.dutySweep = Math.pow(rnd(2) - 1, 3);
  p.vibDepth = Math.pow(rnd(2) - 1, 3);
  p.vibSpeed = rnd(2) - 1;
  p.attack = cube(rnd(2) - 1);
  p.sustain = Math.pow(rnd(2) - 1, 2);
  p.decay = rnd(2) - 1;
  p.punch = Math.pow(rnd(0.8), 2);
  if (p.attack + p.sustain + p.decay < 0.2) {
    p.sustain += 0.2 + rnd(0.3);
    p.decay += 0.2 + rnd(0.3);
  }
  p.lpfResonance = rnd(2) - 1;
  p.lpf = 1 - Math.pow(rnd(1), 3);
  p.lpfSweep = Math.pow(rnd(2) - 1, 3);
  if (p.lpf < 0.1 && p.lpfSweep < -0.05) p.lpfSweep = -p.lpfSweep;
  p.hpf = Math.pow(rnd(1), 5);
  p.hpfSweep = Math.pow(rnd(2) - 1, 5);
  p.phaserOffset = Math.pow(rnd(2) - 1, 3);
  p.phaserSweep = Math.pow(rnd(2) - 1, 3);
  p.repeatSpeed = rnd(2) - 1;
  p.arpSpeed = rnd(2) - 1;
  p.arpMod = rnd(2) - 1;
  return clampAll(p);
}

export function mutate(src: SfxParams): SfxParams {
  const p = { ...src };
  for (const [k] of PARAMS) if (pick(2)) (p[k] as number) += rnd(0.1) - 0.05;
  return clampAll(p);
}

function clampAll(p: SfxParams): SfxParams {
  for (const [k, , min] of PARAMS) p[k] = Math.max(min, Math.min(1, p[k] as number)) as never;
  return p;
}

export const SAMPLE_RATE = 44100;

/** Render to float samples (-1..1) at 44.1 kHz. */
export function render(p: SfxParams): Float32Array<ArrayBuffer> {
  // the original synth runs at 44.1 kHz with 8x supersampling
  let fperiod = 100 / (p.freq * p.freq + 0.001);
  const fmaxperiod = 100 / (p.freqLimit * p.freqLimit + 0.001);
  let fslide = 1 - Math.pow(p.slide, 3) * 0.01;
  const fdslide = -Math.pow(p.deltaSlide, 3) * 0.000001;
  let squareDuty = 0.5 - p.duty * 0.5;
  const squareSlide = -p.dutySweep * 0.00005;
  const arpMod = p.arpMod >= 0 ? 1 - Math.pow(p.arpMod, 2) * 0.9 : 1 + Math.pow(p.arpMod, 2) * 10;
  let arpTime = 0;
  let arpLimit = Math.floor(Math.pow(1 - p.arpSpeed, 2) * 20000 + 32);
  if (p.arpSpeed === 1) arpLimit = 0;

  const envLen = [p.attack * p.attack * 100000, p.sustain * p.sustain * 100000, p.decay * p.decay * 100000].map(Math.floor);
  const total = envLen[0] + envLen[1] + envLen[2];

  let fltp = 0, fltdp = 0;
  let fltw = Math.pow(p.lpf, 3) * 0.1;
  const fltwd = 1 + p.lpfSweep * 0.0001;
  let fltdmp = 5 / (1 + Math.pow(p.lpfResonance, 2) * 20) * (0.01 + fltw);
  if (fltdmp > 0.8) fltdmp = 0.8;
  let fltphp = 0;
  let flthp = Math.pow(p.hpf, 2) * 0.1;
  const flthpd = 1 + p.hpfSweep * 0.0003;

  const vibSpeed = Math.pow(p.vibSpeed, 2) * 0.01;
  const vibAmp = p.vibDepth * 0.5;
  let vibPhase = 0;

  let phaserOffset = Math.pow(p.phaserOffset, 2) * 1020 * (p.phaserOffset < 0 ? -1 : 1);
  const phaserDelta = Math.pow(p.phaserSweep, 2) * (p.phaserSweep < 0 ? -1 : 1);
  const phaserBuf = new Float32Array(1024);
  let ipp = 0;
  const noise = new Float32Array(32).map(() => Math.random() * 2 - 1);
  const repLimit = p.repeatSpeed === 0 ? 0 : Math.floor(Math.pow(1 - p.repeatSpeed, 2) * 20000 + 32);
  let repTime = 0;

  const startPeriod = fperiod;
  const startSlide = fslide;
  const startDuty = squareDuty;
  let phase = 0;
  let envStage = 0, envTime = 0;
  const out = new Float32Array(total);
  const gain = 2 * p.volume;

  for (let i = 0; i < total; i++) {
    if (repLimit && ++repTime >= repLimit) {
      repTime = 0;
      fperiod = startPeriod;
      fslide = startSlide;
      squareDuty = startDuty;
      arpTime = 0;
    }
    arpTime++;
    if (arpLimit !== 0 && arpTime >= arpLimit) {
      arpLimit = 0;
      fperiod *= arpMod;
    }
    fslide += fdslide;
    fperiod *= fslide;
    if (fperiod > fmaxperiod) {
      fperiod = fmaxperiod;
      if (p.freqLimit > 0) break;
    }
    let rfperiod = fperiod;
    if (vibAmp > 0) {
      vibPhase += vibSpeed;
      rfperiod = fperiod * (1 + Math.sin(vibPhase) * vibAmp);
    }
    const period = Math.max(8, Math.floor(rfperiod));
    squareDuty = Math.min(0.5, Math.max(0, squareDuty + squareSlide));

    envTime++;
    while (envStage < 3 && envTime > envLen[envStage]) {
      envTime = 0;
      envStage++;
    }
    let env = 0;
    if (envStage === 0) env = envTime / envLen[0];
    else if (envStage === 1) env = 1 + Math.pow(1 - envTime / envLen[1], 1) * 2 * p.punch;
    else if (envStage === 2) env = 1 - envTime / envLen[2];

    phaserOffset += phaserDelta;
    const iphase = Math.min(1023, Math.abs(Math.floor(phaserOffset)));
    if (flthpd !== 0) flthp = Math.min(0.1, Math.max(0.00001, flthp * flthpd));

    let ssample = 0;
    for (let si = 0; si < 8; si++) {
      phase++;
      if (phase >= period) {
        phase %= period;
        if (p.wave === 3) for (let n = 0; n < 32; n++) noise[n] = Math.random() * 2 - 1;
      }
      const fp = phase / period;
      let sample: number;
      if (p.wave === 0) sample = fp < squareDuty ? 0.5 : -0.5;
      else if (p.wave === 1) sample = 1 - fp * 2;
      else if (p.wave === 2) sample = Math.sin(fp * 2 * Math.PI);
      else sample = noise[Math.floor(phase * 32 / period) % 32];
      // low-pass
      const pp = fltp;
      fltw = Math.min(0.1, Math.max(0, fltw * fltwd));
      if (p.lpf !== 1) {
        fltdp += (sample - fltp) * fltw;
        fltdp -= fltdp * fltdmp;
      } else {
        fltp = sample;
        fltdp = 0;
      }
      fltp += fltdp;
      // high-pass
      fltphp += fltp - pp;
      fltphp -= fltphp * flthp;
      sample = fltphp;
      // phaser
      phaserBuf[ipp & 1023] = sample;
      sample += phaserBuf[(ipp - iphase + 1024) & 1023];
      ipp = (ipp + 1) & 1023;
      ssample += sample * env;
    }
    out[i] = Math.max(-1, Math.min(1, (ssample / 8) * gain));
  }
  // trim the tail if the pitch limit cut the sound short
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.slice(0, end);
}

export function toWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  return new Uint8Array(buf);
}
