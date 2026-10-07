"""Builds maps/level1.json for JELLY JUMP from the ASCII layout below (and a preview image).

  #  ground (auto: grass top / edges / dirt / buried stone)     =  wooden platform (jump through)
  B  stone block      ^  spikes        o  coin      e  beetle      s  spring (mushroom)
  F  goal flag        P  start         *  bush      f  flower
Objects become map objects (edit them later in the Map tab); tiles go to the "main" layer.
Run: python games/jelly/tools/make_level.py
"""
import json, os, random
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)

SEGMENTS = [
    # start meadow
    [
        "....................",
        "....................",
        "....................",
        "....................",
        "....................",
        "...........ooo......",
        "..........=====.....",
        "....................",
        ".P....*.......f..*..",
        "####################",
        "####################",
        "####################",
    ],
    # first pit with coins over it
    [
        "................",
        "................",
        "................",
        "................",
        "......ooo.......",
        ".....o...o......",
        "................",
        "................",
        "..f..........e..",
        "####....########",
        "####....########",
        "####^^^^########",
    ],
    # stone steps + spring
    [
        "......................",
        "......................",
        "..............ooo.....",
        "......................",
        "..........BB..........",
        "........BBBB..........",
        "......BBBBBB.....o....",
        "......BBBBBB.....o....",
        "..s...BBBBBB..e..o..*.",
        "######################",
        "######################",
        "######################",
    ],
    # platforms over spikes
    [
        "..........................",
        "..........................",
        "..........................",
        "...........ooo............",
        "..........=====...........",
        "..........................",
        "....ooo...........ooo.....",
        "...=====.........=====....",
        "..........................",
        "##......................##",
        "##......................##",
        "##^^^^^^^^^^^^^^^^^^^^^^##",
    ],
    # beetle valley
    [
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "..........o..o..o.......",
        "........................",
        "........................",
        "...*........f.....e*....",
        "######....##############",
        "######....##############",
        "######^^^^##############",
    ],
    # tower with spring to the top
    [
        "..................",
        "........ooo.......",
        ".......=====......",
        "..................",
        "..........BBBB....",
        "..........BBBB....",
        "..........BBBB..o.",
        "..........BBBB..o.",
        ".......s..BBBB..o.",
        "##################",
        "##################",
        "##################",
    ],
    # finale run to the flag
    [
        "..............................",
        "..............................",
        "..............................",
        "..............................",
        "..............................",
        "......ooo...........o.o.o.....",
        ".....=====....................",
        "..............................",
        ".f......e......*..s......F..*.",
        "##########....################",
        "##########....################",
        "##########^^^^################",
    ],
]

ROWS = ["".join(seg[r] for seg in SEGMENTS) for r in range(12)]
W, H = len(ROWS[0]), 12
OBJ = {"o": "coin", "e": "beetle", "s": "spring", "F": "flag", "P": "start", "*": "bush", "f": "flower"}
SPRITE = {"coin": "coin", "beetle": "spiky", "spring": "spring", "flag": "flag", "bush": "bush", "flower": "flower", "start": "jelly"}

# tile frames (see art/art.py)
GRASS, GRASS_L, GRASS_R, DIRT, DIRT_STONE, PLATFORM, STONE, SPIKES = range(8)


def cell(x, y):
    if x < 0 or x >= W or y >= H:
        return "#"
    if y < 0:
        return "."
    return ROWS[y][x]


def check_grounded():
    """bushes, flowers, enemies, springs, the flag and the start must stand on something."""
    for y in range(H):
        for x in range(W):
            c = ROWS[y][x]
            if c in "*fesFP" and cell(x, y + 1) not in "#=B":
                raise SystemExit(f"'{c}' at column {x}, row {y} is floating (nothing below it)")


def build():
    check_grounded()
    rng = random.Random(4)
    data = [-1] * (W * H)
    objects = []
    for y in range(H):
        for x in range(W):
            c = ROWS[y][x]
            t = -1
            if c == "#":
                if cell(x, y - 1) != "#":
                    t = GRASS_L if cell(x - 1, y) != "#" else GRASS_R if cell(x + 1, y) != "#" else GRASS
                else:
                    t = DIRT_STONE if rng.random() < 0.08 else DIRT
            elif c == "=":
                t = PLATFORM
            elif c == "B":
                t = STONE
            elif c == "^":
                t = SPIKES
            elif c in OBJ:
                typ = OBJ[c]
                # bottom-center in map pixels
                objects.append({"id": len(objects) + 1, "type": typ, "sprite": SPRITE[typ], "x": x * 16 + 8, "y": y * 16 + 16})
            data[y * W + x] = t
    level = {"name": "level1", "tileset": "tiles", "w": W, "h": H,
             "layers": [{"name": "main", "visible": True, "data": data}], "objects": objects}
    os.makedirs(os.path.join(GAME, "maps"), exist_ok=True)
    json.dump(level, open(os.path.join(GAME, "maps", "level1.json"), "w"))
    return level


def preview(level):
    sp = os.path.join(GAME, "sprites")
    sheet = Image.open(os.path.join(sp, "tiles.png"))
    tiles = [sheet.crop((i * 16, 0, i * 16 + 16, 16)) for i in range(8)]
    im = Image.new("RGBA", (W * 16, H * 16), (120, 180, 240, 255))
    for i, t in enumerate(level["layers"][0]["data"]):
        if t >= 0:
            im.alpha_composite(tiles[t], ((i % W) * 16, (i // W) * 16))
    for o in level["objects"]:
        s = Image.open(os.path.join(sp, f"{o['sprite']}.png"))
        im.alpha_composite(s, (o["x"] - s.width // 2, o["y"] - s.height))
    im.save(os.path.join(HERE, "level_preview.png"))


if __name__ == "__main__":
    lv = build()
    preview(lv)
    print(f"level1: {W}x{H} tiles, {len(lv['objects'])} objects, {sum(1 for o in lv['objects'] if o['type'] == 'coin')} coins")
