"""Generates the Star Barrage soundtrack with tools/slate_synth.py -> games/star-barrage/music/*.ogg

  title      hangar / title screen     96 BPM  D minor   calm synthwave
  stage1     Nebula Frontier          128 BPM  A minor   upbeat
  stage2     Asteroid Belt            120 BPM  E minor   tribal drums, syncopated bass
  stage3     Crimson Expanse          136 BPM  C minor   aggressive
  stage4     Frozen Rings             112 BPM  F# minor  airy bells
  stage5     The Core                 142 BPM  Bb minor  dark and fast
  boss       stage bosses             150 BPM  G minor   driving
  lastboss   OVERMIND                 156 BPM  D minor   epic
  clear      stage clear jingle (no loop)
  gameover   game over jingle (no loop)
Run: python games/star-barrage/tools/make_music.py [names...]
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(GAME)), "tools"))
from slate_synth import Track  # noqa: E402

OUT = os.path.join(GAME, "music")


def title():
    tr = Track(96, "D", "dorian", ["Dm7", "Bbmaj7", "Fmaj7", "C"], 16, seed=11)
    tr.pad(0, 16, cutoff=1200, gain=1.1)
    tr.arp(0, 16, rate=8, wave="tri", octave=1, cutoff=2600, gain=0.9, order=(0, 2, 1, 3, 2, 4, 3, 1))
    tr.drums(4, 16, "half", gain=0.55, fill=False)
    tr.bass(4, 16, "half", wave="tri", cutoff=600, gain=0.9)
    tr.lead(8, 16, tr.melody(8, 8, register=79), wave="bell", gain=0.9)
    return tr


def stage1():
    tr = Track(128, "A", "minor", ["Am", "F", "C", "G"], 32, seed=21)
    mel_a = tr.melody(0, 8)
    mel_b = tr.melody(0, 8, register=79, seed=22)
    tr.drums(0, 4, "hats", fill=False)
    tr.bass(0, 4, "pulse", cutoff=500)
    tr.arp(0, 4, cutoff=1500)
    tr.pad(0, 32, gain=0.5)
    tr.drums(4, 12, "four"); tr.bass(4, 12, "oct"); tr.arp(4, 12); tr.lead(4, 12, mel_a)
    tr.crash(12); tr.drums(12, 20, "four16"); tr.bass(12, 20, "oct"); tr.arp(12, 20); tr.lead(12, 20, mel_b)
    tr.drums(20, 24, "sparse", gain=0.6, fill=False); tr.bass(20, 24, "long", cutoff=500); tr.arp(20, 24, wave="tri", gain=0.8); tr.pad(20, 24, gain=0.8)
    tr.riser(22, 2)
    tr.crash(24); tr.drums(24, 32, "drive"); tr.bass(24, 32, "oct"); tr.arp(24, 32); tr.lead(24, 32, mel_a)
    return tr


def stage2():
    tr = Track(120, "E", "harmonic", ["Em", "C", "Am", "B"], 32, seed=31)
    mel = tr.melody(0, 8, register=69)
    mel2 = tr.melody(0, 8, register=76, seed=32)
    tr.drums(0, 8, "tribal", gain=0.9)
    tr.bass(0, 32, "sync", cutoff=650, gain=1.15)
    tr.pad(0, 32, gain=0.45, cutoff=1000)
    tr.arp(4, 32, rate=8, wave="square", duty=0.5, octave=1, cutoff=2200, gain=0.8, order=(0, 2, 1, 2))
    tr.crash(8); tr.drums(8, 24, "tribal"); tr.lead(8, 16, mel, wave="square", cutoff=2000); tr.lead(16, 24, mel2, wave="square", cutoff=2400)
    tr.drums(24, 28, "break", fill=False); tr.riser(26, 2)
    tr.crash(28); tr.drums(28, 32, "four"); tr.lead(28, 32, mel, wave="square", cutoff=2000)
    return tr


def stage3():
    tr = Track(136, "C", "harmonic", ["Cm", "Ab", "Bb", "G"], 32, seed=41)
    mel = tr.melody(0, 8, register=72)
    mel2 = tr.melody(0, 8, register=77, seed=42)
    tr.impact(0)
    tr.drums(0, 4, "break", fill=False); tr.bass(0, 4, "16", cutoff=700)
    tr.drums(4, 16, "drive"); tr.bass(4, 16, "16", cutoff=1300); tr.arp(4, 32, wave="saw", cutoff=3000, gain=0.75)
    tr.lead(8, 16, mel, cutoff=3400)
    tr.crash(16); tr.drums(16, 24, "double"); tr.bass(16, 24, "gallop", cutoff=1300); tr.lead(16, 24, mel2, cutoff=3800)
    tr.drums(24, 28, "half", fill=False); tr.bass(24, 28, "long", cutoff=600); tr.pad(24, 28, gain=0.9); tr.riser(26, 2)
    tr.crash(28); tr.drums(28, 32, "drive"); tr.bass(28, 32, "16", cutoff=1300); tr.lead(28, 32, mel, cutoff=3400)
    return tr


def stage4():
    tr = Track(112, "F#", "minor", ["F#m", "D", "A", "E"], 32, seed=51)
    mel = tr.melody(0, 8, register=81)
    mel2 = tr.melody(0, 8, register=76, seed=52)
    tr.pad(0, 32, cutoff=2200, gain=1.0)
    tr.arp(0, 32, rate=16, wave="tri", octave=2, cutoff=6000, gain=0.7, order=(0, 1, 2, 3, 4, 3, 2, 1), decay=0.2)
    tr.drums(4, 12, "sparse", gain=0.7, fill=False); tr.bass(4, 32, "half", wave="tri", cutoff=500)
    tr.lead(8, 16, mel, wave="bell", gain=0.9)
    tr.crash(16); tr.drums(16, 28, "half", gain=0.8); tr.lead(16, 24, mel2, wave="saw", cutoff=1800, gain=0.8)
    tr.lead(24, 32, mel, wave="bell", gain=0.9)
    tr.drums(28, 32, "sparse", gain=0.6, fill=False)
    return tr


def stage5():
    tr = Track(142, "Bb", "harmonic", ["Bbm", "Gb", "Ab", "F"], 32, seed=61)
    mel = tr.melody(0, 8, register=70)
    mel2 = tr.melody(0, 8, register=77, seed=62)
    tr.impact(0)
    tr.drums(0, 4, "hats", fill=False); tr.bass(0, 32, "16", wave="square", cutoff=900); tr.pad(0, 32, gain=0.55, cutoff=900)
    tr.drums(4, 16, "four16"); tr.arp(4, 32, rate=16, wave="square", duty=0.125, octave=1, cutoff=3500, gain=0.8)
    tr.lead(8, 16, mel, cutoff=2600)
    tr.crash(16); tr.drums(16, 28, "double"); tr.lead(16, 24, mel2, cutoff=3200); tr.lead(24, 28, mel, cutoff=2600)
    tr.riser(26, 2)
    tr.crash(28); tr.drums(28, 32, "drive"); tr.lead(28, 32, mel2, cutoff=3200)
    return tr


def boss():
    tr = Track(150, "G", "harmonic", ["Gm", "Eb", "F", "D"], 24, seed=71)
    mel = tr.melody(0, 8, register=74)
    mel2 = tr.melody(0, 8, register=79, seed=72)
    tr.impact(0); tr.crash(0)
    tr.drums(0, 2, "break", fill=False); tr.bass(0, 2, "long", cutoff=700)
    tr.drums(2, 10, "drive"); tr.bass(2, 10, "gallop", cutoff=1400); tr.arp(2, 24, wave="saw", cutoff=3200, gain=0.7); tr.lead(2, 10, mel, cutoff=3500)
    tr.crash(10); tr.drums(10, 18, "double"); tr.bass(10, 18, "16", cutoff=1500); tr.lead(10, 18, mel2, cutoff=4000)
    tr.drums(18, 24, "four16"); tr.bass(18, 24, "gallop", cutoff=1400); tr.pad(18, 24, gain=0.7); tr.lead(18, 24, mel, cutoff=3500)
    tr.riser(22, 2)
    return tr


def lastboss():
    tr = Track(156, "D", "harmonic", ["Dm", "Bb", "Gm", "A"], 32, seed=81)
    mel = tr.melody(0, 8, register=74)
    mel2 = tr.melody(0, 8, register=81, seed=82)
    tr.impact(0); tr.crash(0)
    tr.pad(0, 32, cutoff=2000, gain=1.1)
    tr.drums(0, 4, "half", fill=False); tr.bass(0, 4, "long", cutoff=700)
    tr.drums(4, 16, "double"); tr.bass(4, 16, "gallop", cutoff=1500); tr.arp(4, 32, wave="square", duty=0.25, cutoff=4000, gain=0.75)
    tr.lead(4, 12, mel, cutoff=3500); tr.lead(4, 12, mel, octave=-1, cutoff=1500, gain=0.5, echo=False)
    tr.lead(12, 16, mel2, cutoff=4000)
    tr.impact(16); tr.drums(16, 20, "break", fill=False); tr.bass(16, 20, "long", cutoff=600); tr.riser(18, 2)
    tr.crash(20); tr.drums(20, 32, "double"); tr.bass(20, 32, "16", cutoff=1600)
    tr.lead(20, 28, mel2, cutoff=4200); tr.lead(20, 28, mel2, octave=-1, cutoff=1600, gain=0.5, echo=False)
    tr.lead(28, 32, mel, cutoff=3500)
    return tr


def clear():
    tr = Track(150, "C", "major", ["C", "F", "G", "C"], 2, loop=False, seed=91, tail=2.5)
    notes = [(0, 0, 72, 0.5), (0, 0.5, 76, 0.5), (0, 1, 79, 0.5), (0, 1.5, 84, 0.5),
             (0, 2, 77, 0.5), (0, 2.5, 81, 0.5), (0, 3, 84, 0.5), (0, 3.5, 89, 0.5),
             (1, 0, 86, 0.5), (1, 0.5, 83, 0.5), (1, 1, 79, 0.5), (1, 1.5, 83, 0.5), (1, 2, 84, 2.5)]
    tr.prog = [tr.prog[0], tr.prog[1]]
    tr.crash(0)
    for b in (0, 1):
        for i in range(4):
            tr.add(tr.kit["k"], tr.bar_t(b) + i * tr.beat, 0.7)
    tr.lead(0, 2, notes, wave="square", cutoff=5000, gain=1.2)
    tr.pad(0, 2, gain=0.8)
    tr.crash(2, gain=0.6)
    tr.add(tr.kit["k"], tr.bar_t(1) + 2 * tr.beat, 0.9)
    return tr


def gameover():
    tr = Track(76, "A", "minor", ["Am", "Dm"], 2, loop=False, seed=93, tail=3.0)
    notes = [(0, 0, 76, 0.75), (0, 0.75, 74, 0.75), (0, 1.5, 72, 0.5), (0, 2, 71, 1), (0, 3, 69, 1), (1, 0, 64, 3.5)]
    tr.lead(0, 2, notes, wave="tri", cutoff=2500, gain=1.3, vibrato=0.008)
    tr.pad(0, 2, cutoff=900, gain=1.0)
    tr.bass(0, 2, "long", wave="tri", cutoff=400)
    return tr


SONGS = dict(title=title, stage1=stage1, stage2=stage2, stage3=stage3, stage4=stage4, stage5=stage5,
             boss=boss, lastboss=lastboss, clear=clear, gameover=gameover)

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name in sys.argv[1:] or SONGS:
        secs = SONGS[name]().save(os.path.join(OUT, f"{name}.ogg"), quality=2)
        size = os.path.getsize(os.path.join(OUT, f"{name}.ogg")) / 1024
        print(f"{name:9s} {secs:5.1f}s  {size:6.0f} KB", flush=True)
