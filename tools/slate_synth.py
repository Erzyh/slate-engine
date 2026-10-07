"""Slate synth: procedural chiptune / synthwave music for Slate games.

Everything is synthesized from oscillators and noise (no samples), so the output is yours to use.
A Track is a number of bars at a tempo over a chord progression; parts are added per bar range:

    from slate_synth import Track
    tr = Track(bpm=128, key="A", scale="minor", prog=["Am", "F", "C", "G"], bars=32, seed=1)
    tr.drums(0, 32, "four")
    tr.bass(0, 32, "oct")
    tr.arp(4, 32)
    tr.lead(8, 24, tr.melody(8, 16))
    tr.save("stage1.ogg")              # loop=True tracks wrap their tail around for a seamless loop

Drum and bass patterns are 16-step strings (one bar); see DRUMS and BASS below.
Needs numpy + scipy; OGG export needs ffmpeg on PATH.
"""
import os, subprocess, tempfile, wave

import numpy as np
from scipy.signal import lfilter

SR = 44100

NOTE_PC = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}
QUALITY = {"": [0, 4, 7], "m": [0, 3, 7], "m7": [0, 3, 7, 10], "7": [0, 4, 7, 10], "maj7": [0, 4, 7, 11], "sus": [0, 5, 7], "dim": [0, 3, 6], "5": [0, 7, 12]}
SCALES = {"minor": [0, 2, 3, 5, 7, 8, 10], "harmonic": [0, 2, 3, 5, 7, 8, 11], "dorian": [0, 2, 3, 5, 7, 9, 10],
          "phrygian": [0, 1, 3, 5, 7, 8, 10], "major": [0, 2, 4, 5, 7, 9, 11], "lydian": [0, 2, 4, 6, 7, 9, 11]}

# 16 steps per bar. k kick, s snare, c clap, h hat (X = accent), o open hat, t tom
DRUMS = {
    "four":   {"k": "x...x...x...x...", "s": "....x.......x...", "h": "x.x.x.x.x.x.x.x.", "o": "..x...x...x...x."},
    "four16": {"k": "x...x...x...x...", "s": "....x.......x...", "h": "XxxxXxxxXxxxXxxx"},
    "drive":  {"k": "x...x...x...x..x", "s": "....x.......x.x.", "h": "XxxxXxxxXxxxXxxx", "o": "..x...x...x...x."},
    "double": {"k": "x.x.x.x.x.x.x.x.", "s": "....x.......x...", "c": "....x.......x...", "h": "XxxxXxxxXxxxXxxx"},
    "half":   {"k": "x.......x.x.....", "s": "........x.......", "h": "x.x.x.x.x.x.x.x."},
    "tribal": {"k": "x..x..x...x..x..", "t": "...x.....x...x.x", "s": "....x.......x...", "h": "x.xXx.xXx.xXx.xX"},
    "sparse": {"k": "x.......x.......", "s": "............x...", "h": "....x.......x..."},
    "break":  {"k": "x.........x.....", "h": "..x...x...x...x."},
    "hats":   {"h": "x.x.x.x.x.x.x.x.", "o": "......x.......x."},
}
# r root, o octave, f fifth, t third, . rest, - hold
BASS = {
    "pulse": "r.r.r.r.r.r.r.r.",
    "oct":   "r.o.r.o.r.o.r.o.",
    "16":    "rrrrrrrrrrrrrrrr",
    "sync":  "r..r..r.r..r.r..",
    "gallop": "r.rr.rr.r.rr.rr.",
    "walk":  "r.r.f.f.o.o.f.t.",
    "long":  "r---------------",
    "half":  "r-------f-------",
}
RHYTHMS = [  # one bar each: (beat, length)
    [(0, 1), (1, 0.5), (1.5, 0.5), (2, 1.5), (3.5, 0.5)],
    [(0, 1.5), (1.5, 0.5), (2, 1), (3, 1)],
    [(0, 0.5), (0.5, 0.5), (1, 1), (2, 0.5), (2.5, 0.5), (3, 1)],
    [(0, 2), (2, 1), (3, 0.5), (3.5, 0.5)],
    [(0, 0.75), (0.75, 0.75), (1.5, 0.5), (2, 2)],
    [(0, 1), (1, 1), (2, 2)],
    [(0.5, 0.5), (1, 0.5), (1.5, 1), (2.5, 0.5), (3, 1)],
    [(0, 0.5), (0.5, 1), (1.5, 0.5), (2, 0.5), (2.5, 1.5)],
]


def midi_f(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def parse_chord(name):
    """'Am' -> (root midi in octave 3, intervals)."""
    r = name[:2] if len(name) > 1 and name[1] in "#b" else name[:1]
    return 48 + NOTE_PC[r], QUALITY[name[len(r):]]


def lowpass(x, cutoff):
    a = 1 - np.exp(-2 * np.pi * min(cutoff, SR * 0.45) / SR)
    return lfilter([a], [1, -(1 - a)], x)


def highpass(x, cutoff):
    return x - lowpass(x, cutoff)


def osc(kind, f, n, duty=0.5, detune=0.0, phase=0.0):
    t = np.arange(n) / SR
    f = np.asarray(f, float)
    if f.ndim:
        ph = (np.cumsum(f * (1 + detune)) / SR + phase) % 1.0
    else:
        ph = (f * (1 + detune) * t + phase) % 1.0
    if kind == "square":
        return np.where(ph < duty, 1.0, -1.0)
    if kind == "saw":
        return 2 * ph - 1
    if kind == "tri":
        return 4 * np.abs(ph - 0.5) - 1
    return np.sin(2 * np.pi * ph)


def adsr(n, a=0.005, d=0.15, s=0.6, r=0.05, gate=None):
    t = np.arange(n) / SR
    gate = n / SR if gate is None else gate
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = np.clip(1 - (t - gate) / max(r, 1e-4), 0, 1)
    return e * np.where(t > gate, rel, 1)


class Track:
    def __init__(self, bpm, key, scale, prog, bars, loop=True, seed=1, tail=3.0):
        self.bpm, self.bars, self.loop = bpm, bars, loop
        self.beat = 60 / bpm
        self.bar = self.beat * 4
        self.step = self.beat / 4
        self.length = bars * self.bar
        self.n = int(round(self.length * SR))
        extra = 0 if loop else int(tail * SR)
        self.L = np.zeros(self.n + extra)
        self.R = np.zeros(self.n + extra)
        self.key = NOTE_PC[key]
        self.scale = SCALES[scale]
        self.prog = [parse_chord(c) for c in prog]
        self.rng = np.random.default_rng(seed)
        self._kit = None

    # ------------------------------------------------------------ mixing

    def add(self, sig, t, gain=1.0, pan=0.0):
        """mix a signal in at time t (s). Loop tracks wrap the tail to the start."""
        i = int(round(t * SR))
        sig = sig * gain
        lg, rg = 1 - max(0, pan), 1 + min(0, pan)
        total = len(self.L)
        while len(sig):
            if i >= total:
                if not self.loop:
                    return
                i -= self.n
            k = min(len(sig), total - i)
            self.L[i:i + k] += sig[:k] * lg
            self.R[i:i + k] += sig[:k] * rg
            sig = sig[k:]
            i += k

    def chord(self, bar):
        return self.prog[int(bar) % len(self.prog)]

    def bar_t(self, bar):
        return bar * self.bar

    # ------------------------------------------------------------ drum kit

    @property
    def kit(self):
        if self._kit is None:
            r = np.random.default_rng(99)
            def noise(n):
                return r.uniform(-1, 1, n)
            n = int(0.42 * SR)
            t = np.arange(n) / SR
            kick = np.sin(2 * np.pi * np.cumsum(46 + 120 * np.exp(-t * 32)) / SR) * np.exp(-t * 7.5)
            kick[:160] += noise(160) * np.linspace(0.5, 0, 160)
            n = int(0.24 * SR); t = np.arange(n) / SR
            snare = highpass(noise(n), 1500) * np.exp(-t * 17) * 0.9 + np.sin(2 * np.pi * 185 * t) * np.exp(-t * 26) * 0.55
            clap = np.zeros(n)
            for d in (0, 0.011, 0.022):
                k = int(d * SR)
                clap[k:] += highpass(noise(n - k), 900) * np.exp(-np.arange(n - k) / SR * 30) * 0.6
            n = int(0.05 * SR); t = np.arange(n) / SR
            hat = highpass(noise(n), 7000) * np.exp(-t * 80) * 0.5
            n = int(0.3 * SR); t = np.arange(n) / SR
            ohat = highpass(noise(n), 6000) * np.exp(-t * 11) * 0.4
            n = int(2.0 * SR); t = np.arange(n) / SR
            crash = highpass(noise(n), 3500) * np.exp(-t * 1.7) * 0.4
            n = int(0.35 * SR); t = np.arange(n) / SR
            tom = np.sin(2 * np.pi * np.cumsum(90 + 80 * np.exp(-t * 18)) / SR) * np.exp(-t * 9)
            n = int(2.4 * SR); t = np.arange(n) / SR
            impact = np.tanh(np.sin(2 * np.pi * np.cumsum(36 + 60 * np.exp(-t * 6)) / SR) * np.exp(-t * 1.9) * 1.4 + lowpass(noise(n), 2500) * np.exp(-t * 5) * 0.6)
            self._kit = dict(k=np.tanh(kick * 1.5), s=snare, c=clap, h=hat, o=ohat, crash=crash, t=tom, impact=impact)
        return self._kit

    def drums(self, b0, b1, pattern="four", gain=1.0, fill=True):
        """16-step drum pattern from DRUMS (or a dict). fill=True adds a snare fill on the last bar of every 8."""
        pat = DRUMS[pattern] if isinstance(pattern, str) else pattern
        vols = {"k": 0.95, "s": 0.6, "c": 0.45, "h": 0.28, "o": 0.22, "t": 0.5}
        pans = {"h": 0.3, "o": -0.25, "t": -0.2}
        for b in range(b0, b1):
            last8 = fill and (b - b0) % 8 == 7
            for ch, steps in pat.items():
                for i, c in enumerate(steps):
                    if c == ".":
                        continue
                    if last8 and ch in "sc" and i >= 8:
                        continue
                    v = vols[ch] * (1.25 if c == "X" else 0.85 if (ch == "h" and c == "x") else 1)
                    self.add(self.kit[ch], self.bar_t(b) + i * self.step, v * gain, pans.get(ch, 0))
            if last8:
                for i in range(8, 16):
                    self.add(self.kit["s"], self.bar_t(b) + i * self.step, (0.3 + 0.05 * (i - 8)) * gain)

    def crash(self, bar, gain=1.0):
        self.add(self.kit["crash"], self.bar_t(bar), 0.75 * gain)

    def impact(self, bar, gain=1.0):
        self.add(self.kit["impact"], self.bar_t(bar), 0.8 * gain)

    def riser(self, b0, bars=2, gain=1.0):
        dur = bars * self.bar
        n = int(dur * SR)
        t = np.arange(n) / SR
        noise = np.random.default_rng(5).uniform(-1, 1, n)
        out = np.zeros(n)
        for i in range(0, n, 2048):   # sweep a low-pass upwards
            k = (i / n) ** 2
            out[i:i + 2048] = lowpass(noise[i:i + 2048], 300 + 9000 * k)
        tone = np.sin(2 * np.pi * np.cumsum(200 * 2 ** (3 * t / dur)) / SR) * 0.2
        self.add((out * 1.4 + tone) * (t / dur) ** 2, self.bar_t(b0), 0.5 * gain)

    # ------------------------------------------------------------ tonal parts

    def bass(self, b0, b1, pattern="pulse", wave="saw", octave=-2, cutoff=900, gain=1.0):
        steps = BASS.get(pattern, pattern)
        for b in range(b0, b1):
            root, iv = self.chord(b)
            third = iv[1] if len(iv) > 1 else 4
            i = 0
            while i < 16:
                c = steps[i]
                if c in "rotf":
                    ln = 1
                    while i + ln < 16 and steps[i + ln] == "-":
                        ln += 1
                    m = root + 12 * octave + {"r": 0, "o": 12, "f": 7, "t": third}[c]
                    dur = ln * self.step
                    n = int((dur + 0.03) * SR)
                    f = midi_f(m)
                    s = osc(wave, f, n) * 0.6 + osc("square", f / 2, n) * 0.35
                    s = lowpass(s, cutoff) * adsr(n, 0.003, dur * 0.7, 0.4, 0.03, gate=dur - 0.02)
                    self.add(np.tanh(s * 1.6), self.bar_t(b) + i * self.step, 0.38 * gain)
                    i += ln
                else:
                    i += 1

    def arp(self, b0, b1, rate=16, order=(0, 1, 2, 3, 2, 1, 0, 2), wave="square", duty=0.25, octave=1,
            cutoff=5000, gain=1.0, echo=True, decay=0.09):
        step = self.bar / rate
        for b in range(b0, b1):
            root, iv = self.chord(b)
            tones = list(iv) + [iv[0] + 12, iv[1] + 12 if len(iv) > 1 else 12]
            for i in range(rate):
                m = root + 12 * octave + tones[order[(b * rate + i) % len(order)] % len(tones)]
                n = int(step * SR * 1.6)
                s = osc(wave, midi_f(m), n, duty) * adsr(n, 0.002, decay, 0.0)
                s = lowpass(s, cutoff)
                t = self.bar_t(b) + i * step
                pan = 0.3 if i % 2 else -0.3
                self.add(s, t, 0.12 * gain, pan)
                if echo:
                    self.add(s, t + self.beat * 0.75, 0.045 * gain, -pan)

    def pad(self, b0, b1, octave=0, cutoff=1500, gain=1.0, wave="saw"):
        for b in range(b0, b1):
            root, iv = self.chord(b)
            n = int((self.bar + 0.5) * SR)
            s = np.zeros(n)
            for k in iv:
                f = midi_f(root + 12 * octave + k)
                for dt in (-0.006, 0.0, 0.007):
                    s += osc(wave, f, n, detune=dt, phase=self.rng.random())
            s = lowpass(s / (3 * len(iv)), cutoff) * adsr(n, 0.35, 10, 1.0, 0.45, gate=self.bar)
            self.add(s, self.bar_t(b), 0.2 * gain)

    def lead(self, b0, b1, notes, wave="saw", octave=0, cutoff=2800, gain=1.0, vibrato=0.004, echo=True, detune=0.003):
        """notes: list of (bar offset, beat, midi, beats) from melody(); repeated to fill b0..b1."""
        span = max(1, int(np.ceil(max(nb + (bt + ln) / 4 for nb, bt, _, ln in notes)))) if notes else 1
        for rep in range(b0, b1, span):
            for nb, bt, m, ln in notes:
                bar = rep + nb
                if bar >= b1:
                    continue
                dur = ln * self.beat
                n = int((dur + 0.06) * SR)
                tt = np.arange(n) / SR
                f = midi_f(m + 12 * octave) * (1 + vibrato * np.sin(2 * np.pi * 5.5 * tt) * np.minimum(1, tt * 2.5))
                if wave == "bell":
                    s = np.sin(2 * np.pi * np.cumsum(f) / SR + 2.2 * np.exp(-tt * 6) * np.sin(2 * np.pi * np.cumsum(f * 3.5) / SR))
                    e = np.exp(-tt * 3.2)
                else:
                    s = osc(wave, f, n) * 0.55 + osc("square", f, n, 0.5, detune=detune) * 0.45
                    s = lowpass(s, cutoff)
                    e = adsr(n, 0.008, dur, 0.65, 0.06, gate=dur - 0.03)
                t = self.bar_t(bar) + bt * self.beat
                self.add(s * e, t, 0.15 * gain)
                if echo:
                    self.add(s * e, t + self.beat * 0.75, 0.055 * gain, 0.5)
                    self.add(s * e, t + self.beat * 1.5, 0.03 * gain, -0.5)

    # ------------------------------------------------------------ melody

    def _deg_to_midi(self, deg, base=60):
        o, d = divmod(deg, 7)
        return base + self.key + 12 * o + self.scale[d]

    def _nearest_chord_tone(self, m, bar):
        root, iv = self.chord(bar)
        pcs = {(root + k) % 12 for k in iv}
        for d in (0, -1, 1, -2, 2, -3, 3):
            if (m + d) % 12 in pcs:
                return m + d
        return m

    def melody(self, b0, bars, register=72, seed=None):
        """A A' B A'' phrase (2 bars per motif) that follows the chords; returns notes relative to b0."""
        r = np.random.default_rng(seed) if seed is not None else self.rng
        base = register - 12 - self.key

        def motif():
            out, deg = [], 0
            for bo in range(2):
                for bt, ln in RHYTHMS[r.integers(len(RHYTHMS))]:
                    out.append((bo, bt, ln, deg))
                    deg += int(r.choice([-2, -1, -1, 1, 1, 2, 0, 3, -3]))
                    deg = max(-4, min(6, deg))
            return out

        def realize(m, bar0, ending=None):
            notes = []
            root, _ = self.chord(bar0)
            start_deg = min(range(-7, 14), key=lambda d: abs(self._deg_to_midi(d, base) - (root + 24 + (register - 72))))
            for i, (bo, bt, ln, deg) in enumerate(m):
                md = self._deg_to_midi(start_deg + deg, base)
                if bt in (0, 2) or i == len(m) - 1:
                    md = self._nearest_chord_tone(md, bar0 + bo)
                if ending is not None and i == len(m) - 1:
                    md = self._nearest_chord_tone(md + ending, bar0 + bo)
                    ln = max(ln, 1.5)
                notes.append((bar0 - b0 + bo, bt, md, ln * 0.92))
            return notes

        a, b = motif(), motif()
        out = []
        for k in range(0, bars, 8):
            out += realize(a, b0 + k)
            out += realize(a, b0 + k + 2, ending=2)
            out += realize(b, b0 + k + 4)
            out += realize(a, b0 + k + 6, ending=-1)
        return [n for n in out if n[0] < bars]

    # ------------------------------------------------------------ output

    def master(self, target_rms=0.17):
        mix = np.stack([self.L, self.R], 1)
        mix = highpass(mix.T, 25).T
        peak = np.max(np.abs(mix)) + 1e-9
        mix = np.tanh(mix / peak * 1.8) / np.tanh(1.8)
        rms = np.sqrt((mix ** 2).mean()) + 1e-9
        mix *= min(0.98 / np.max(np.abs(mix)), target_rms / rms)
        if not self.loop:
            fade = int(0.05 * SR)
            mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
        return mix

    def save(self, path, quality=3):
        mix = self.master()
        pcm = (np.clip(mix, -1, 1) * 32767).astype(np.int16)
        wav = path if path.endswith(".wav") else tempfile.mktemp(suffix=".wav")
        with wave.open(wav, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        if wav != path:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", str(quality), path], check=True)
            os.remove(wav)
        return len(mix) / SR
