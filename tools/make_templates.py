"""Art and levels for the starter templates (templates/platformer, topdown, shmup).
Every sprite is a hand-made character grid; tiles add a little seeded texture.
Run: python tools/make_templates.py   (writes sprites/, maps/, slate.json; scripts/ are hand-written)
"""
import json, os, random
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates")

PAL = {
    ".": None,
    "k": "#1a1c2c", "w": "#f4f4f4", "l": "#94b0c2", "m": "#566c86", "d": "#333c57",
    "R": "#7a2140", "r": "#b13e53", "o": "#ef7d57", "y": "#ffcd75", "Y": "#d8925a",
    "g": "#a7f070", "G": "#38b764", "t": "#257179", "T": "#1d4d50",
    "n": "#29366f", "b": "#3b5dc9", "c": "#41a6f6", "C": "#73eff7",
    "p": "#5d275d", "P": "#8f3f8f", "q": "#c06bc0",
    "B": "#8a5a3a", "D": "#5a3a2a", "s": "#c8a46a", "S": "#a0804e",
}


def rgba(ch):
    c = PAL[ch]
    if c is None:
        return (0, 0, 0, 0)
    return (int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16), 255)


def grid(rows, w, h):
    rows = [r for r in rows]
    assert len(rows) == h, (len(rows), h, rows)
    for r in rows:
        assert len(r) == w, (len(r), w, r)
    img = Image.new("RGBA", (w, h))
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            img.putpixel((x, y), rgba(ch))
    return img


def sheet(frames):
    w, h = frames[0].size
    out = Image.new("RGBA", (w * len(frames), h))
    for i, f in enumerate(frames):
        out.paste(f, (i * w, 0))
    return out


def save_sprite(game, name, frames, meta=None):
    d = os.path.join(ROOT, game, "sprites")
    os.makedirs(d, exist_ok=True)
    sheet(frames).save(os.path.join(d, name + ".png"))
    w, h = frames[0].size
    m = {"w": w, "h": h}
    m.update(meta or {})
    if len(frames) > 1 or meta:
        json.dump(m, open(os.path.join(d, name + ".json"), "w"), indent=1)
    return frames


def pad(rows, top, h=16, w=16):
    blank = "." * w
    out = [blank] * top + rows
    return out + [blank] * (h - len(out))


def tag(name, a, b, dir="forward"):
    return {"name": name, "from": a, "to": b, "dir": dir}


# ------------------------------------------------------------------ the hero (shared)

BODY_SIDE = [
    ".....kkkkkk.....",
    "...kkyyyyyykk...",
    "..kyywwyyyyyyk..",
    "..kywyyyyyyyyk..",
    ".kyyyyyykyyykyk.",
    ".kyyyyyykyyykyk.",
    ".koyyyyyyyyyyok.",
    ".kooyyyyyyyyook.",
    "..kooooooooook..",
    "...kkkkkkkkkk...",
]
BODY_FRONT = BODY_SIDE[:4] + [
    ".kyyyykyykyyyyk.",
    ".kyyyykyykyyyyk.",
] + BODY_SIDE[6:]
BODY_BACK = BODY_SIDE[:4] + [
    ".kyyyyyyyyyyyyk.",
    ".koyyyyyyyyyyok.",
] + BODY_SIDE[6:]
# a squashed body (one row shorter) for breathing
SQUASH = lambda b: b[:3] + b[4:]

FEET = ["....kook..kook..", "....kkkk..kkkk.."]
FEET_BACK = ["..kook...kook...", "..kkkk...kkkk..."]
FEET_FRONT = ["....kook....kook", "....kkkk....kkkk"]
FEET_WIDE = ["..kook......kook", "..kkkk......kkkk"]


def hero_frame(body, feet, top):
    return grid(pad(body + feet, top), 16, 16)


# ------------------------------------------------------------------ tiles

def tile(fn, seed):
    rnd = random.Random(seed)
    img = Image.new("RGBA", (16, 16))
    for y in range(16):
        for x in range(16):
            ch = fn(x, y, rnd)
            img.putpixel((x, y), rgba(ch))
    return img


def dirt(x, y, r):
    return "D" if r.random() < 0.10 else ("S" if r.random() < 0.05 else "B")


def grass_top(x, y, r):
    edge = 2 + (1 if (x * 7 + 3) % 5 == 0 else 0)
    if y == 0:
        return "g"
    if y < edge:
        return "G" if r.random() < 0.25 else "g"
    if y == edge:
        return "G"
    if y == edge + 1:
        return "D"
    return dirt(x, y, r)


def stone(x, y, r):
    # 2 rows of blocks with offset mortar lines
    by = y % 8
    off = 0 if (y // 8) % 2 == 0 else 4
    bx = (x + off) % 8
    if by == 7 or bx == 7:
        return "d"
    if by == 0 or bx == 0:
        return "l"
    return "m" if r.random() > 0.08 else "d"


def plank(x, y, r):
    if y > 5:
        return "."
    if y == 0:
        return "k"
    if y == 1:
        return "s"
    if y == 5:
        return "k"
    if x % 8 == 0:
        return "D"
    return "S" if y == 4 else "B"


SPIKES = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...k.......k....",
    "..kwk.....kwk...",
    "..kwk.....kwk...",
    ".kwlmk...kwlmk..",
    ".kwlmk...kwlmk..",
    "kwllmmk.kwllmmk.",
    "kwllmmk.kwllmmk.",
    "kmmmmmdkkmmmmmdk",
    "kddddddkkddddddk",
    "kkkkkkkkkkkkkkkk",
]

COIN = [
    ["..kkkk..", ".kyyyyk.", "kyywyyYk", "kywyyyYk", "kyyyyyYk", "kyyyyYYk", ".kYYYYk.", "..kkkk.."],
    ["...kk...", "..kyyk..", "..kwyk..", "..kyyk..", "..kyyk..", "..kyYk..", "..kYYk..", "...kk..."],
    ["...kk...", "...yk...", "...yk...", "...yk...", "...yk...", "...Yk...", "...Yk...", "...kk..."],
    ["...kk...", "..kyyk..", "..kywk..", "..kyyk..", "..kyyk..", "..kYyk..", "..kYYk..", "...kk..."],
]

HEART = [
    [".kk.kk..", "krrkrrk.", "krwrrrk.", "krrrrRk.", ".krrRk..", "..kRk...", "...k....", "........"],
    [".kk.kk..", "kddkddk.", "kdmdddk.", "kddddd k".replace(" ", "d"), ".kdddk..", "..kdk...", "...k....", "........"],
]

SLIME = [
    pad([
        "......kkkk......",
        "....kkgggGkk....",
        "...kgwggggggk...",
        "..kgwggkggkgGk..",
        "..kggggkggkgGk..",
        "..kGgggggggGGk..",
        "..kGGGGGGGGGtk..",
        "...kkkkkkkkkk...",
    ], 8),
    pad([
        ".....kkkkkk.....",
        "...kkgggggGkk...",
        "..kgwggkggkggGk.",
        ".kgggggkggkgggGk",
        ".kGGggggggggGGtk",
        "..kkkkkkkkkkkkk.",
    ], 10),
]

FLAG = [
    [
        "..kk............",
        "..kwkkkkkkk.....",
        "..kwkrrrrrrkk...",
        "..kwkrwrrrrrrk..",
        "..kwkrrrrrrrRk..",
        "..kwkrrrrrRRk...",
        "..kwkkkkkkkk....",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        ".kmmmk..........",
        "kmllmmk.........",
        "kkkkkkk.........",
    ],
    [
        "..kk............",
        "..kwkkkkkkkk....",
        "..kwkrrrrrrrk...",
        "..kwkrwrrrrrrkk.",
        "..kwkrrrrrrrRRk.",
        "..kwkrrrrrRRkk..",
        "..kwkkkkkkkk....",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        "..kwk...........",
        ".kmmmk..........",
        "kmllmmk.........",
        "kkkkkkk.........",
    ],
]


# ------------------------------------------------------------------ platformer

def platformer():
    g = "platformer"
    save_sprite(g, "hero", [
        hero_frame(BODY_SIDE, FEET, 4),                # 0 idle
        hero_frame(SQUASH(BODY_SIDE), FEET, 5),        # 1 idle (breath)
        hero_frame(BODY_SIDE, FEET_BACK, 4),           # 2 run
        hero_frame(BODY_SIDE, FEET, 3),                # 3 run (up)
        hero_frame(BODY_SIDE, FEET_FRONT, 4),          # 4 run
        hero_frame(BODY_SIDE, FEET, 3),                # 5 run (up)
        hero_frame(BODY_SIDE, FEET, 2),                # 6 jump
        hero_frame(BODY_SIDE, FEET_WIDE, 4),           # 7 fall
    ], {"fps": 10, "tags": [tag("idle", 0, 1), tag("run", 2, 5), tag("jump", 6, 6), tag("fall", 7, 7)],
        "durations": [500, 500, 90, 90, 90, 90, 100, 100]})
    save_sprite(g, "slime", [grid(f, 16, 16) for f in SLIME], {"fps": 3, "tags": [tag("walk", 0, 1)]})
    save_sprite(g, "coin", [grid(f, 8, 8) for f in COIN], {"fps": 8, "tags": [tag("spin", 0, 3)], "durations": [420, 90, 70, 90]})
    save_sprite(g, "heart", [grid(f, 8, 8) for f in HEART])
    save_sprite(g, "flag", [grid(f, 16, 16) for f in FLAG], {"fps": 4, "tags": [tag("wave", 0, 1)]})
    # tiles: 0 grass, 1 dirt, 2 stone, 3 plank (jump-through), 4 spikes
    tiles = [tile(grass_top, 1), tile(dirt, 2), tile(stone, 3), tile(plank, 4), grid(SPIKES, 16, 16)]
    save_sprite(g, "tiles", tiles, {"flags": [1, 1, 1, 2, 4]})

    # The level is built from a ground-height profile so every jump stays fair:
    # pits are at most 3 tiles wide and steps at most 2 tiles high (a full jump clears ~4 x 3 tiles).
    W, H = 80, 12
    rows = [["."] * W for _ in range(H)]
    top = [9] * W                       # first ground row per column (None = pit)

    def pit(a, b):
        for x in range(a, b + 1):
            top[x] = None

    def ground(a, b, row):
        for x in range(a, b + 1):
            top[x] = row

    pit(12, 14)
    ground(25, 30, 8)
    pit(31, 33)
    ground(45, 48, 7)
    pit(49, 51)
    pit(64, 65)
    for x in range(W):
        if top[x] is None:
            rows[10][x], rows[11][x] = "^", "#"
        else:
            for y in range(top[x], H):
                rows[y][x] = "#"
    for x in (56, 57):                  # a spike strip on the ground: jump it
        rows[9][x] = "^"
    for x in range(38, 40):             # a 2-tile stone step
        rows[7][x] = rows[8][x] = "X"
    for x in range(17, 22):             # jump-through planks
        rows[6][x] = "="
    for x in range(49, 52):
        rows[6][x] = "="
    for x in range(69, 73):
        rows[6][x] = "="

    def put(x, y, ch):
        rows[y][x] = ch

    put(2, 8, "P")
    for x in (6, 7, 8):
        put(x, 7, "o")
    for x in (12, 13, 14):              # coins arc over the first pit
        put(x, 6, "o")
    for x in (18, 19, 20):
        put(x, 5, "o")
    put(22, 8, "s")
    for x in (27, 28):
        put(x, 6, "o")
    put(42, 8, "s")
    for x in (45, 46, 47):
        put(x, 5, "o")
    for x in (49, 50, 51):
        put(x, 4, "o")
    put(60, 8, "s")
    for x in (70, 71):
        put(x, 4, "o")
    put(74, 8, "s")
    put(77, 8, "F")
    level = ["".join(r) for r in rows]
    save_level(g, "level1", level, {"#": None, "X": 2, "=": 3, "^": 4}, {"o": ("coin", "coin"), "s": ("slime", "slime"), "F": ("goal", "flag"), "P": ("start", "hero")})


def save_level(game, name, rows, tiles, objs):
    h, w = len(rows), len(rows[0])
    data, objects = [-1] * (w * h), []
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            if ch == "#":
                data[y * w + x] = 0 if y == 0 or rows[y - 1][x] != "#" else 1
            elif ch in tiles and tiles[ch] is not None:
                data[y * w + x] = tiles[ch]
            elif ch in objs:
                typ, spr = objs[ch]
                objects.append({"id": len(objects) + 1, "type": typ, "sprite": spr, "x": x * 16 + 8, "y": y * 16 + 16})
    d = os.path.join(ROOT, game, "maps")
    os.makedirs(d, exist_ok=True)
    m = {"name": name, "tileset": "tiles", "w": w, "h": h, "layers": [{"name": "main", "visible": True, "data": data}], "objects": objects}
    json.dump(m, open(os.path.join(d, name + ".json"), "w"), separators=(",", ":"))


# ------------------------------------------------------------------ top-down

BAT = [
    pad([
        ".kk..........kk.",
        ".kpk...kk...kpk.",
        ".kppk.kqqk.kppk.",
        "..kppkqqqqkppk..",
        "..kpppqwqwppk...",
        "...kkpqkqkpk....",
        ".....kqqqqk.....",
        "......kkkk......",
    ], 4),
    pad([
        "......kkkk......",
        ".....kqqqqk.....",
        "..kkkpqwqwpkkk..",
        ".kpppqqkqkqpppk.",
        "kppkkpqqqqpkkppk",
        "kpk..kpkkpk..kpk",
        ".k....k..k....k.",
    ], 5),
]

GEM = [
    ["..kkkk..", ".kCwCck.", "kCwCCcbk", "kCCCcbbk", ".kCcbbk.", "..kcbk..", "...kk...", "........"],
    ["..kkkk..", ".kwCCck.", "kCCwCcbk", "kCCCcbbk", ".kCcbbk.", "..kcbk..", "...kk...", "........"],
]


# a stone block seen from above: bevelled slab (light top/left edge, dark bottom/right), a few cracks
WALL_TOP = [
    "kkkkkkkkkkkkkkkk",
    "kwllllllllllllmk",
    "klllllllllllllmk",
    "kllmmmmmmmmmmlmk",
    "kllmmmmmmmmmmlmk",
    "kllmmmmdmmmmmlmk",
    "kllmmmmmdmmmmlmk",
    "kllmmmmmmmmmmlmk",
    "kllmmmmmmmmmmlmk",
    "kllmmmmmmmdmmlmk",
    "kllmmmmmmmmdmlmk",
    "kllmmmmmmmmmmlmk",
    "kllmmmmmmmmmmlmk",
    "klmmmmmmmmmmmmdk",
    "kmddddddddddddddk"[:16],
    "kkkkkkkkkkkkkkkk",
]


# hand-drawn ground tiles: a few tufts / flowers / pebbles, placed so the tiles repeat calmly
GRASS = [
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggGgGgggggggggg",
    "ggggGggggggggggg",
    "gggggggggggggggg",
    "gggggggggggGgGgg",
    "ggggggggggggGggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "ggGgGggggggggggg",
    "gggGgggggggggggg",
    "gggggggggggggggg",
    "gggggggggGgGgggg",
    "ggggggggggGggggg",
    "gggggggggggggggg",
]
GRASS_FLOWERS = [
    "gggggggggggggggg",
    "gggggwgggggggggg",
    "ggggwywgggggGgGg",
    "gggggwgggggggGgg",
    "gggggGgggggggggg",
    "gggggggggggggggg",
    "gggggggggggggggg",
    "ggGgGggggggqgggg",
    "gggGgggggggqgggg",
    "ggggggggggqyqggg",
    "gggggggggggqgggg",
    "gggggggggggGgggg",
    "gggggggggggggggg",
    "gggggggwgggggggg",
    "ggggggwywggggggg",
    "gggggggwgggggggg",
]
PATH = [
    "ssssssssssssssss",
    "ssssssssssssssss",
    "sssSSsssssssssss",
    "sssSsssssssssYss",
    "ssssssssssssssss",
    "ssssssssssssssss",
    "ssssssssSSssssss",
    "sssssssSSsssssss",
    "ssssssssssssssss",
    "sYssssssssssssss",
    "ssssssssssssssss",
    "sssssssssssSSsss",
    "ssssssssssssSsss",
    "ssssSsssssssssss",
    "ssssssssssssssss",
    "ssssssssssssssss",
]
WATER = [
    "cccccccccccccccc",
    "cccccccccccccccc",
    "ccCCCccccccccccc",
    "cCcccCcccccccccc",
    "cccccccccccccccc",
    "cccccccccCCCcccc",
    "ccccccccCcccCccc",
    "cccccccccccccccc",
    "cccccccccccccccc",
    "cccccccccccccccc",
    "cccCCCcccccccccc",
    "ccCcccCccccccccc",
    "cccccccccccccccc",
    "cccccccccccCCCcc",
    "ccccccccccCcccCc",
    "cccccccccccccccc",
]


def grass(x, y, r, flowers=False):
    if flowers and r.random() < 0.04:
        return r.choice("wyq")
    v = r.random()
    return "G" if v < 0.07 else "g"


def path(x, y, r):
    v = r.random()
    return "S" if v < 0.15 else ("Y" if v < 0.2 else "s")


def wall(x, y, r):
    if y < 4:
        return "l" if y > 0 else "k"
    return stone(x, y, r)


def water(x, y, r):
    if (x + 2 * (y // 4)) % 8 in (0, 1) and y % 4 == 1:
        return "C"
    return "c" if (x + y) % 9 else "b"


TREE = [
    "....kkkkkkkk....",
    "..kkGgggggGGkk..",
    ".kGggwgggggGGtk.",
    ".kGgwggggggGGtk.",
    "kGggggggggGGGttk",
    "kGgggggggGGGtttk",
    "kGGgggggGGGGtttk",
    "kGGGGGGGGGGttttk",
    ".kGGGGGGGGttttk.",
    ".ktGGGGGttttttk.",
    "..kkttttttttkk..",
    "....kkkDBkkk....",
    "......kDBk......",
    "......kDBk......",
    ".....kDDBBk.....",
    "......kkkk......",
]


def topdown():
    g = "topdown"
    save_sprite(g, "hero", [
        hero_frame(BODY_FRONT, FEET, 4), hero_frame(BODY_FRONT, FEET, 3),       # down
        hero_frame(BODY_SIDE, FEET, 4), hero_frame(BODY_SIDE, FEET_BACK, 3),    # side
        hero_frame(BODY_BACK, FEET, 4), hero_frame(BODY_BACK, FEET, 3),         # up
    ], {"fps": 6, "tags": [tag("down", 0, 1), tag("side", 2, 3), tag("up", 4, 5)], "durations": [160] * 6})
    save_sprite(g, "bat", [grid(f, 16, 16) for f in BAT], {"fps": 6, "tags": [tag("fly", 0, 1)]})
    save_sprite(g, "gem", [grid(f, 8, 8) for f in GEM], {"fps": 2, "tags": [tag("shine", 0, 1)], "durations": [900, 150]})
    save_sprite(g, "heart", [grid(f, 8, 8) for f in HEART])
    # 0 grass, 1 flowers, 2 path, 3 wall, 4 water, 5 tree
    tiles = [
        grid(GRASS, 16, 16), grid(GRASS_FLOWERS, 16, 16), grid(PATH, 16, 16),
        grid(WALL_TOP, 16, 16), grid(WATER, 16, 16), grid(TREE, 16, 16),
    ]
    # tree pixels on grass
    base = tiles[0].copy()
    base.alpha_composite(tiles[5])
    tiles[5] = base
    save_sprite(g, "tiles", tiles, {"flags": [0, 0, 0, 1, 1, 1]})

    room = [
        "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
        "W....,......T.......,......*.W",
        "W.T......,.........b.........W",
        "W....====.......T.......,....W",
        "W....=*.=............~~~~....W",
        "W.,..=..=......,....~~~~~~...W",
        "W....=..=...........~~~~~~.T.W",
        "W..........::::::....~~~~..*.W",
        "W.T...b...::....::...........W",
        "W.........:..P...:.....b.....W",
        "W.,.......::....::.........,.W",
        "W..*.......::::::......T.....W",
        "W....T.................*.....W",
        "W..........,.....WWWWW.......W",
        "W...~~~..........W.*.W...,...W",
        "W..~~~~~...T.....W...W.......W",
        "W...~~~......b...WW.WW...b...W",
        "W.....,..........,.......*...W",
        "W.*.........T................W",
        "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
    ]
    legend = {".": 0, ",": 1, ":": 2, "=": 3, "W": 3, "~": 4, "T": 5}
    h, w = len(room), len(room[0])
    data, objects = [], []
    for y, r in enumerate(room):
        assert len(r) == w, r
        for x, ch in enumerate(r):
            data.append(legend.get(ch, 0 if ch not in ":" else 2))
            if ch in "*bP":
                typ, spr = {"*": ("gem", "gem"), "b": ("bat", "bat"), "P": ("start", "hero")}[ch]
                objects.append({"id": len(objects) + 1, "type": typ, "sprite": spr, "x": x * 16 + 8, "y": y * 16 + 16})
    d = os.path.join(ROOT, g, "maps")
    os.makedirs(d, exist_ok=True)
    json.dump({"name": "room", "tileset": "tiles", "w": w, "h": h, "layers": [{"name": "main", "visible": True, "data": data}], "objects": objects},
              open(os.path.join(d, "room.json"), "w"), separators=(",", ":"))


# ------------------------------------------------------------------ shmup

SHIP = [
    [
        ".......kk.......",
        "......kwlk......",
        "......kwlk......",
        ".....kwccmk.....",
        ".....kwCcmk.....",
        "....kwwccmmk....",
        "...k.kwllmk.k...",
        "..kck.kwmk.kck..",
        ".kwcbkkwmkkbcbk.",
        "kwcbbmwllmmmbbck",
        "kwbbmwlllmmmmbbk",
        "kbbmkklmmmdkkmbk",
        ".kkk.krrrrk.kkk.",
        ".....koyyok.....",
        "......koyk......",
        ".......kk.......",
    ],
]
# banking: squeeze the ship by a column on each side
def bank(rows, side):
    out = []
    for r in rows:
        if side < 0:
            r = r[1:8] + r[9:] + ".."   # drop a column from each half, shift left
        else:
            r = ".." + r[:7] + r[8:15]
        out.append(r[:16].ljust(16, "."))
    return out


SAUCER = [
    pad([
        ".....kkkkkk.....",
        "....kCwCCcck....",
        "...kCwCCCccbk...",
        ".kkkkkkkkkkkkkk.",
        "kmllwllllllllmdk",
        "kdmmymmmymmmymdk",
        ".kkdddddddddddk.",
        "...kkkkkkkkkk...",
    ], 4),
    pad([
        ".....kkkkkk.....",
        "....kCwCCcck....",
        "...kCwCCCccbk...",
        ".kkkkkkkkkkkkkk.",
        "kmllwllllllllmdk",
        "kdmmmmymmmymmmdk",
        ".kkdddddddddddk.",
        "...kkkkkkkkkk...",
    ], 4),
]

DART = [
    "....kkkk....",
    "...krrrrk...",
    "..krwrrrRk..",
    ".krrrrrrRRk.",
    "krRkrrrrkRRk",
    "kRk.krrk.kRk",
    "kk..kRRk..kk",
    ".....kk.....",
    "............",
    "............",
    "............",
    "............",
]

SHOT = ["kk", "wk", "Ck", "Ck", "ck", "ck", "bk", "kk"]
SHOT = [r[0] + r[0] if r != "kk" else "kk" for r in SHOT]
ORB = [".kkkk.", "krrrRk", "krwrRk", "krrrRk", "kRRRRk", ".kkkk."]


def shmup():
    g = "shmup"
    center = SHIP[0]
    save_sprite(g, "ship", [grid(bank(center, -1), 16, 16), grid(center, 16, 16), grid(bank(center, 1), 16, 16)])
    save_sprite(g, "saucer", [grid(f, 16, 16) for f in SAUCER], {"fps": 4, "tags": [tag("blink", 0, 1)]})
    save_sprite(g, "dart", [grid(DART, 12, 12)])
    save_sprite(g, "shot", [grid(SHOT, 2, 8)])
    save_sprite(g, "orb", [grid(ORB, 6, 6)])
    save_sprite(g, "heart", [grid(f, 8, 8) for f in HEART])


def slate_json(game, title, res, bg):
    d = os.path.join(ROOT, game)
    os.makedirs(os.path.join(d, "scripts"), exist_ok=True)
    json.dump({"name": game, "title": title, "resolution": list(res), "background": bg, "main": "scripts/main.luau"},
              open(os.path.join(d, "slate.json"), "w"), indent=2)


def preview():
    out = Image.new("RGBA", (420, 140), (40, 40, 56, 255))
    x = 4
    for game in ("platformer", "topdown", "shmup"):
        d = os.path.join(ROOT, game, "sprites")
        for f in sorted(os.listdir(d)):
            if f.endswith(".png"):
                im = Image.open(os.path.join(d, f))
                if x + im.width > 420:
                    break
                out.alpha_composite(im, (x, 4 + ("platformer", "topdown", "shmup").index(game) * 40))
                x += im.width + 4
        x = 4
    out.resize((out.width * 3, out.height * 3), Image.NEAREST).save(os.path.join(ROOT, "preview.png"))


if __name__ == "__main__":
    slate_json("platformer", "Platformer", (320, 180), "#29366f")
    slate_json("topdown", "Top-down", (320, 180), "#1a1c2c")
    slate_json("shmup", "Shooter", (180, 320), "#0b0d1a")
    platformer()
    topdown()
    shmup()
    preview()
    print("ok")
