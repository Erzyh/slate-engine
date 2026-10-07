"""Hand-designed pixel art for JELLY JUMP (no AI): every sprite is a character grid below.
Writes games/jelly/sprites/ (NAME.png + NAME.json sheets) and art/preview.png.
Run: python games/jelly/art/art.py
"""
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)

PAL = {
    ".": None,
    "k": "#1b1a2a",                                              # outline
    "a": "#1d6470", "b": "#2c9e8f", "c": "#4fd3a5", "d": "#a2f5c8", "w": "#f4fbff",   # jelly
    "e": "#141225",                                              # eyes
    "G": "#2a6e4a", "g": "#4caf5a", "h": "#9be36a",              # grass
    "D": "#2e1d2b", "r": "#553540", "R": "#7e5242", "L": "#ab7a52",   # dirt
    "S": "#343c5e", "s": "#56688f", "t": "#8ea3c6",              # stone
    "W": "#55301f", "o": "#8c5733", "O": "#c88a4f",              # wood
    "Y": "#b05a26", "y": "#f0a63a", "u": "#ffe27a",              # gold
    "X": "#6e1d3a", "x": "#d4435b", "z": "#ff8f8f",              # red
    "p": "#ff7aa8", "P": "#b84579", "v": "#ffd0e0",              # pink
    "q": "#ffffff", "Q": "#c3d6ee", "n": "#8aa6cc",              # cloud
}

SPRITES = {}

SPRITES["jelly"] = """
................
......kkkk......
....kkddddkk....
...kdwwddccck...
..kdwwdcccccbk..
..kdwdcccccccbk.
.kdddcccccccccbk
.kccweccccwecbbk
.kcceecccceecbbk
.kbceecccceecbbk
.kbppckcckcppbak
.kbbccckkccccbak
.kabbbbbbbbbbaak
..kaaaaaaaaaaak.
...kkkkkkkkkkk..
................
"""

SPRITES["coin"] = """
...kkkk...
..kuuuyk..
.kuuyyyYk.
.kuyyuyYk.
.kuyuyyYk.
.kuyyyyYk.
.kyyyyYYk.
..kyYYYk..
...kkkk...
"""

SPRITES["spiky"] = """
....k.....k.....
...kxk..k.kxk...
..kxxzkkxkxxk...
.kxzzxxxxxxxxk..
.kzzxxxxxxxxxk..
kxzxxwwxxwwxxxk.
kxxxxwekxwekxxk.
kxxxxwekxwekxxk.
kXxxxxxxxxxxxXk.
kXXxxxkkkkxxXXk.
.kXXXXXXXXXXXk..
..kkokkkkkokk...
...kok...kok....
....k.....k.....
"""

SPRITES["spring"] = """
....kkkkkkkk....
..kkxxxxzzxxkk..
.kxxqqxxxxqqxxk.
kxxxqqxxxxqqxxxk
kxzxxxxqqxxxxxXk
kXxxxxxqqxxxxXXk
.kXXXXXXXXXXXXk.
..kkkkkkkkkkkk..
.....kOOOOk.....
.....kOooOk.....
.....kOooOk.....
....kkoooWkk....
"""

SPRITES["flag"] = """
.kk...........
kttk..........
kttkkkkkkkkk..
.ktkppppppvpk.
.ktkpppppvvppk
.ktkpppppppppk
.ktkPpppppppPk
.ktkPPPPPPPPk.
.ktkkkkkkkkk..
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
.ktk..........
kkskk.........
ksssk.........
kSSSSk........
kkkkkk........
"""

SPRITES["bush"] = """
.....kkkk.......
...kkhhggk.kk...
..khhggggkkghk..
.khggggGggggghk.
.kgggGggggGggGk.
kgggGGggggGGggGk
kGggGGgggGGGgGGk
.kGGGGGGGGGGGGk.
..kkkkkkkkkkkk..
"""

SPRITES["flower"] = """
..kk.kk.
.kppkppk
.kpvvppk
..kpvpk.
...kGk..
..kGgGk.
...kGk..
....k...
"""

SPRITES["cloud"] = """
..........kkkkk.................
.......kkkqqqqqkk......kkkk.....
......kqqqqqqqqqqk...kkqqqqkk...
...kkkqqqqqqqqqqqqkkkqqqqqqqqk..
..kqqqqqqqqqqqqqqqqqqqqqqqqqqqk.
.kqqqqqqqqqqqqqqqqqqqqqqqqqqqQQk
kQqqqqqqqqqqqqqqqqqqqqqqqqqQQQnk
kQQQqqqqqqqqqqqqqqqqqqqqQQQQnnk.
.kQQQQQQQQqqqqqQQQQQQQQQQnnnkk..
..kknnnnnnQQQQQQnnnnnnnnnkk.....
....kkkkkknnnnnnkkkkkkkkk.......
..........kkkkkk................
"""

# tiles: frames of the "tiles" sprite (16x16 each)
TILES = [
    # 0 grass top
    """
hghhghhhhghhgghh
gGgghgggghgghggg
GgGgggGgggGgggGg
GGGgGGGGgGGGgGGG
RGRRGRRRGRRRRGRR
RRRRRRLRRRRRRRRR
RRLRRRRRRRRRLRRR
RRRRRRRRrRRRRRRR
RrRRRRRRRRRRRRrR
RRRRLRRRRRRLRRRR
RRRRRRRrRRRRRRRR
LRRRRRRRRRRRRRRR
RRRRRRRRRRLRRRrR
RRrRRRRRRRRRRRRR
RRRRRLRRRrRRRRRR
RRRRRRRRRRRRRRRR
""",
    # 1 grass top, left edge
    """
khhghhhhhghhgghh
kgGghgggghgghggg
kGgGggGgggGgggGg
kGGGGGGGgGGGgGGG
krRRGRRRGRRRRGRR
krRRRRLRRRRRRRRR
krLRRRRRRRRRLRRR
krRRRRRRrRRRRRRR
krRRRRRRRRRRRRrR
krRRLRRRRRRLRRRR
krRRRRRrRRRRRRRR
krRRRRRRRRRRRRRR
krRRRRRRRRLRRRrR
krrRRRRRRRRRRRRR
krRRRLRRRrRRRRRR
krRRRRRRRRRRRRRR
""",
    # 2 grass top, right edge
    """
hghhghhhhghhghhk
gGgghgggghgghggk
GgGgggGgggGgggGk
GGGgGGGGgGGGGGGk
RGRRGRRRGRRRRRrk
RRRRRRLRRRRRRRrk
RRLRRRRRRRRRLRrk
RRRRRRRRrRRRRRrk
RrRRRRRRRRRRRRrk
RRRRLRRRRRRLRRrk
RRRRRRRrRRRRRRrk
LRRRRRRRRRRRRRrk
RRRRRRRRRRLRRRrk
RRrRRRRRRRRRRRrk
RRRRRLRRRrRRRRrk
RRRRRRRRRRRRRRrk
""",
    # 3 dirt
    """
RRRRRRRRRRRRRRRR
RRLRRRRRRRRRLRRR
RRRRRRRRrRRRRRRR
RrRRRRRRRRRRRRrR
RRRRLRRRRRRLRRRR
RRRRRRRrRRRRRRRR
LRRRRRRRRRRRRRRR
RRRRRRRRRRLRRRrR
RRrRRRRRRRRRRRRR
RRRRRLRRRrRRRRRR
RRRRRRRRRRRRRRRR
RRLRRRRRRRRRLRRR
RRRRRRRRrRRRRRRR
RrRRRRRRRRRRRRrR
RRRRLRRRRRRLRRRR
RRRRRRRrRRRRRRRR
""",
    # 4 dirt with a buried stone
    """
RRRRRRRRRRRRRRRR
RRLRRRRRRRRRLRRR
RRRRRRRRrRRRRRRR
RrRRRkkkkRRRRRrR
RRRRktttskRLRRRR
RRRktttsssskRRRR
LRRktsssssSkRRRR
RRRksssssSSkRRrR
RRrRkSSSSSkRRRRR
RRRRRkkkkkRrRRRR
RRRRRRRRRRRRRRRR
RRLRRRRRRRRRLRRR
RRRRRRRRrRRRRRRR
RrRRRRRRRRRRRRrR
RRRRLRRRRRRLRRRR
RRRRRRRrRRRRRRRR
""",
    # 5 wooden platform (one-way)
    """
kkkkkkkkkkkkkkkk
kOOOOOOkOOOOOOOk
koooOoookooOooOk
kooooooWkoooooWk
kWWWWWWWkWWWWWWk
kkkkkkkkkkkkkkkk
.kWk........kWk.
.kWk........kWk.
..k..........k..
................
................
................
................
................
................
................
""",
    # 6 stone block
    """
kkkkkkkkkkkkkkkk
kttttttskttttttk
ktsssssSktsssssk
ktsssssSktsssssk
ksSSSSSSksSSSSSk
kkkkkkkkkkkkkkkk
kttkttttttskttsk
ksskssssssSksssk
ksskssssssSksssk
kSSkSSSSSSSkSSSk
kkkkkkkkkkkkkkkk
kttttttskttttttk
ktsssssSktsssssk
ktsssssSktsssssk
ksSSSSSSksSSSSSk
kkkkkkkkkkkkkkkk
""",
    # 7 spikes
    """
................
................
................
................
................
................
...k.......k....
..kqk.....kqk...
..kqk.....kqk...
.kqtsk...kqtsk..
.kqtsk...kqtsk..
ktqtssk.ktqtssk.
ktttsSskttttsSsk
kkkkkkkkkkkkkkkk
kSsSsSsSsSsSsSsk
kkkkkkkkkkkkkkkk
""",
]


def grid(src):
    rows = [r for r in src.strip("\n").split("\n")]
    w = max(len(r) for r in rows)
    return [r.ljust(w, ".") for r in rows]


def to_image(src):
    rows = grid(src.replace("k", "k"))
    im = Image.new("RGBA", (len(rows[0]), len(rows)))
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            c = PAL[ch]
            if c:
                im.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return im


# extra animation frames (frame 0 is the sprite above) and their tags / durations (ms)
ANIM = {
    "spiky": {
        # walk: the legs step out
        "frames": [SPRITES["spiky"].replace(
            "...kok...kok....\n....k.....k.....",
            "..kok.....kok...\n..kk.......kk...")],
        "tags": [{"name": "walk", "from": 0, "to": 1, "dir": "forward"}],
        "durations": [160, 160],
    },
}
TILE_FLAGS = [1, 1, 1, 1, 1, 2, 1, 4]   # bit 0 solid, bit 1 one-way platform, bit 2 hazard


def save_sheet(path, frames, meta=None):
    """frames side by side in one PNG (+ NAME.json when there is something to say)."""
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, (i * w, 0))
    sheet.save(path + ".png")
    if meta:
        json.dump({"w": w, "h": h, **meta}, open(path + ".json", "w"), indent=1)


def build():
    out = os.path.join(GAME, "sprites")
    os.makedirs(os.path.join(out, "trailer"), exist_ok=True)
    images = {n: to_image(s) for n, s in SPRITES.items()}
    for n, im in images.items():
        if n in ANIM:
            a = ANIM[n]
            save_sheet(os.path.join(out, n), [im] + [to_image(f) for f in a["frames"]],
                       {"fps": 8, "tags": a["tags"], "durations": a["durations"]})
        else:
            save_sheet(os.path.join(out, n), [im])
    tiles = [to_image(t) for t in TILES]
    assert all(im.size == (16, 16) for im in tiles)
    save_sheet(os.path.join(out, "tiles"), tiles, {"flags": TILE_FLAGS})
    # pink recolor steps for the trailer's "edit while it runs" demo: base, light, dark, darkest
    pink = {"c": "#ff7aa8", "d": "#ffc6dc", "b": "#c94f86", "a": "#7a2a5c"}
    order = ["c", "d", "b", "a"]
    for i in range(1, 5):
        pal = dict(PAL)
        for ch in order[:i]:
            pal[ch] = pink[ch]
        pal["p"] = "#ffb0c8"
        im = Image.new("RGBA", images["jelly"].size)
        for y, row in enumerate(grid(SPRITES["jelly"])):
            for x, ch in enumerate(row):
                if pal[ch]:
                    im.putpixel((x, y), tuple(int(pal[ch][j:j + 2], 16) for j in (1, 3, 5)) + (255,))
        im.save(os.path.join(out, "trailer", f"jelly_p{i}.png"))
    # preview sheet (10x)
    items = list(images.values()) + [to_image(f) for a in ANIM.values() for f in a["frames"]] + tiles
    z, pad = 10, 12
    w = sum(i.width * z + pad for i in items) + pad
    h = max(i.height for i in items) * z + pad * 2
    sheet = Image.new("RGBA", (w, h), (90, 140, 210, 255))
    x = pad
    for im in items:
        sheet.alpha_composite(im.resize((im.width * z, im.height * z), Image.NEAREST), (x, pad))
        x += im.width * z + pad
    sheet.save(os.path.join(HERE, "preview.png"))
    return images, tiles


if __name__ == "__main__":
    build()
    print("ok")
