// Tiny synth for game-jam sound effects. No files needed.

export type Wave = "square" | "sine" | "triangle" | "sawtooth" | "noise";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Play a tone. `slide` bends the pitch to freq*slide over the duration. */
export function beep(freq = 440, dur = 0.1, wave: Wave = "square", vol = 0.5, slide = 1) {
  const ac = audio();
  const t = ac.currentTime;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  g.connect(master!);
  if (wave === "noise") {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.setValueAtTime(freq / 440, t);
    src.connect(g);
    src.start(t);
    src.stop(t + dur);
    return;
  }
  const o = ac.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  o.connect(g);
  o.start(t);
  o.stop(t + dur);
}

const PRESETS: Record<string, () => void> = {
  click: () => beep(660, 0.05, "square", 0.3, 1.5),
  coin: () => { beep(988, 0.06, "square", 0.3); setTimeout(() => beep(1319, 0.12, "square", 0.3), 60); },
  buy: () => { beep(523, 0.06, "triangle", 0.5); setTimeout(() => beep(784, 0.1, "triangle", 0.5), 50); setTimeout(() => beep(1047, 0.15, "triangle", 0.5), 110); },
  error: () => beep(150, 0.15, "sawtooth", 0.3, 0.7),
  hit: () => beep(300, 0.08, "noise", 0.5),
  jump: () => beep(300, 0.15, "square", 0.3, 2.5),
  explode: () => beep(120, 0.4, "noise", 0.6, 0.3),
  powerup: () => [0, 1, 2, 3].forEach((i) => setTimeout(() => beep(440 * 1.26 ** i, 0.08, "square", 0.3), i * 60)),
};

export function sfx(name: string) {
  try {
    PRESETS[name]?.();
  } catch {
    // audio can fail before the first user gesture; sound is never worth crashing over
  }
}
