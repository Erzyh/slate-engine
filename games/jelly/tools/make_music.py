"""JELLY JUMP theme (tools/slate_synth.py): bouncy C major, 116 BPM, loops.
Run: python games/jelly/tools/make_music.py"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(GAME)), "tools"))
from slate_synth import Track  # noqa: E402


def theme():
    tr = Track(116, "C", "major", ["C", "Am", "F", "G"], 32, seed=7)
    mel = tr.melody(0, 8, register=76, seed=8)
    mel2 = tr.melody(0, 8, register=79, seed=9)
    tr.pad(0, 32, cutoff=1600, gain=0.55)
    tr.drums(0, 4, "hats", gain=0.7, fill=False)
    tr.bass(0, 32, "walk", wave="tri", cutoff=900, gain=1.1)
    tr.arp(4, 32, rate=8, wave="square", duty=0.5, octave=1, cutoff=3200, gain=0.75, order=(0, 2, 1, 2, 0, 3, 1, 2))
    tr.drums(4, 28, "four", gain=0.75)
    tr.lead(4, 12, mel, wave="square", cutoff=3000)
    tr.lead(12, 20, mel2, wave="bell", gain=1.0)
    tr.lead(20, 28, mel, wave="square", cutoff=3200)
    tr.drums(28, 32, "half", gain=0.6, fill=False)
    tr.lead(28, 32, mel2, wave="bell", gain=0.8)
    return tr


if __name__ == "__main__":
    os.makedirs(os.path.join(GAME, "music"), exist_ok=True)
    print("theme", theme().save(os.path.join(GAME, "music", "theme.ogg"), quality=2), "s")
