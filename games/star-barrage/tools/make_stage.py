"""Generates maps/stage1-5.json + the bullet sprite sheet + the tiny map tileset.

Every stage is a tall empty map whose *objects* are the enemy waves. Objects are placed at the
map row that scrolls into view at a given time, so the timeline reads in seconds:
   0-70 s waves, midboss, 78-150 s waves, stage boss.
Waves are generated from formation templates with a fixed seed per stage, so the result is
stable. After generating, edit any stage by hand in the editor's Map tab (Objects tool).
Run: python games/star-barrage/tools/make_stage.py
"""
import json, os, random
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
W_TILES, TILE = 17, 16
W = W_TILES * TILE
SCREEN_H, SCROLL = 480, 42
BOSS_T = 156
H_TILES = (SCREEN_H + SCROLL * BOSS_T + 160) // TILE + 1
STAGE_H = H_TILES * TILE

SPRITE = {"warden": "midboss", "hive": "boss"}   # boss id -> sprite (others use the id)

POOLS = {
    1: dict(light=["drone", "swirler"], mid=["gunship"], heavy=["carrier"], hazard=["asteroid"]),
    2: dict(light=["drone", "swirler"], mid=["gunship"], heavy=["carrier"], hazard=["asteroid", "asteroid", "orbmine"]),
    3: dict(light=["interceptor", "drone", "swirler"], mid=["gunship", "bomber"], heavy=["carrier"], hazard=["orbmine"]),
    4: dict(light=["interceptor", "swirler"], mid=["bomber", "sentinel"], heavy=["carrier", "sentinel"], hazard=["orbmine", "asteroid"]),
    5: dict(light=["interceptor", "drone", "swirler"], mid=["gunship", "bomber", "sentinel"], heavy=["carrier", "sentinel"], hazard=["orbmine"]),
}
BOSSES = {1: ("warden", "ironclad"), 2: ("golem", "hive"), 3: ("twinfang", "seraph"), 4: ("kraken", "leviathan"), 5: ("eye", "overmind")}


class StageBuilder:
    def __init__(self, n):
        self.n = n
        self.objs = []
        self.rng = random.Random(1000 + n)
        self.pool = POOLS[n]

    def at(self, sec, type_, x, sprite=None, **props):
        y = round(STAGE_H - SCREEN_H - SCROLL * sec)
        o = {"id": len(self.objs) + 1, "type": type_, "sprite": sprite or type_, "x": round(x), "y": y}
        if props:
            o["props"] = props
        self.objs.append(o)

    def pick(self, kind):
        return self.rng.choice(self.pool[kind])

    # ------------------------------------------------ formations: add enemies from time t, return duration
    def f_line(self, t):
        k, x = self.pick("light"), self.rng.uniform(40, W - 40)
        for i in range(5):
            self.at(t + i * 0.5, k, x)
        return 3

    def f_sweep(self, t):
        k = self.pick("light")
        left = self.rng.random() < 0.5
        for i in range(6):
            self.at(t + i * 0.4, k, 30 + i * 40 if left else W - 30 - i * 40)
        return 3

    def f_vee(self, t):
        k = self.pick("light")
        for j in range(-2, 3):
            self.at(t + abs(j) * 0.35, k, W / 2 + j * 32)
        return 2.5

    def f_pincer(self, t):
        k = self.pick("light")
        for i in range(4):
            self.at(t + i * 0.6, k, 30, dir=1)
            self.at(t + i * 0.6 + 0.3, k, W - 30, dir=-1)
        return 3.5

    def f_side(self, t):
        k = self.pick("light")
        d = self.rng.choice([1, -1])
        y = self.rng.randint(70, 170)
        for i in range(5):
            self.at(t + i * 0.45, k, 0 if d > 0 else W, move="side", dir=d, stopY=y)
        return 3

    def f_dive(self, t):
        k = "interceptor" if "interceptor" in self.pool["light"] else self.pick("light")
        for i in range(self.rng.randint(3, 5)):
            self.at(t + i * 0.5, k, self.rng.uniform(40, W - 40), stopY=self.rng.randint(60, 140))
        return 3

    def f_pair(self, t):
        k = self.pick("mid")
        self.at(t, k, 70, stopY=self.rng.randint(80, 120))
        self.at(t + 0.4, k, W - 70, stopY=self.rng.randint(110, 150))
        return 6

    def f_heavy(self, t):
        self.at(t, self.pick("heavy"), W / 2 + self.rng.uniform(-40, 40), stopY=self.rng.randint(90, 140))
        return 8

    def f_hazard(self, t):
        for i in range(self.rng.randint(4, 7)):
            self.at(t + i * 0.6, self.pick("hazard"), self.rng.uniform(30, W - 30), dir=self.rng.choice([1, -1]))
        return 4

    def f_mixed(self, t):
        self.at(t, self.pick("mid"), W / 2, stopY=100)
        k = self.pick("light")
        for i in range(4):
            self.at(t + 1 + i * 0.5, k, 40)
            self.at(t + 1.2 + i * 0.5, k, W - 40)
        return 5

    def waves(self, t0, t1, heavy_bias):
        light = [self.f_line, self.f_sweep, self.f_vee, self.f_pincer, self.f_side, self.f_dive]
        big = [self.f_pair, self.f_heavy, self.f_mixed, self.f_hazard]
        gap = max(0.4, 1.7 - 0.25 * self.n)
        t = t0
        while t < t1:
            f = self.rng.choice(big if self.rng.random() < heavy_bias else light)
            d = f(t)
            # later stages layer a light formation on top of the big ones
            if f in big and self.rng.random() < 0.15 * self.n:
                self.rng.choice(light)(t + d * 0.4)
            t += d + gap

    def build(self):
        mid, boss = BOSSES[self.n]
        self.waves(3, 66, 0.25 + 0.04 * self.n)
        self.at(72, "midboss", W / 2, sprite=SPRITE.get(mid, mid), boss=mid, stopY=110)
        self.waves(78, 148, 0.35 + 0.05 * self.n)
        self.at(BOSS_T, "boss", W / 2, sprite=SPRITE.get(boss, boss), boss=boss, stopY=120)
        layers = [{"name": "space", "visible": True, "data": [-1] * (W_TILES * H_TILES)}]
        return {"name": f"stage{self.n}", "tileset": "space", "w": W_TILES, "h": H_TILES, "layers": layers, "objects": self.objs}


maps = [StageBuilder(n).build() for n in range(1, 6)]
os.makedirs(os.path.join(GAME, "maps"), exist_ok=True)
for m in maps:
    with open(os.path.join(GAME, "maps", f"{m['name']}.json"), "w") as f:
        json.dump(m, f)
for m in maps:
    print(f"{m['name']}: {len(m['objects'])} objects")

sprites = os.path.join(GAME, "sprites")
os.makedirs(sprites, exist_ok=True)

# tiny tileset (one faint star) so the maps have a grid in the editor
ts = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
ts.putpixel((7, 7), (154, 168, 224, 255))
ts.save(os.path.join(sprites, "space.png"))

# bullet sheet: white shapes, tinted in code. frames:
# 0 halo, 1/2 small rim/core, 3/4 medium, 5/6 large, 7/8 huge, 9/10 rice rim/core, 11 solid (beams)
SHAPES = [(7, 7), (3.0, 3.0), (1.4, 1.4), (3.6, 3.6), (1.8, 1.8), (5.2, 5.2), (2.8, 2.8), (7.4, 7.4), (4.2, 4.2), (7.0, 3.4), (5.0, 1.6)]
sheet = Image.new("RGBA", (16 * 12, 16), (0, 0, 0, 0))
for i, (rx, ry) in enumerate(SHAPES):
    for y in range(16):
        for x in range(16):
            dx, dy = x + 0.5 - 8, y + 0.5 - 8
            if (dx / rx) ** 2 + (dy / ry) ** 2 <= 1:
                sheet.putpixel((i * 16 + x, y), (255, 255, 255, 255))
for y in range(16):
    for x in range(16):
        sheet.putpixel((11 * 16 + x, y), (255, 255, 255, 255))
sheet.save(os.path.join(sprites, "bullets.png"))
json.dump({"w": 16, "h": 16, "count": 12, "fps": 1}, open(os.path.join(sprites, "bullets.json"), "w"), indent=1)
print("sprites: space.png, bullets.png")
