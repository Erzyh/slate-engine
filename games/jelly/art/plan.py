"""Turns the hand-made sprites into a drawing order an artist would use, for the editor timelapse:
outline (pen) -> base color (bucket fill) -> shading -> highlights -> details.
The plan is simulated with the editor's own rules (4-way flood fill, pen draws between
8-adjacent pixels) and checked against the target image. Writes art/plan.json.
Run: python games/jelly/art/plan.py
"""
import json, os
from collections import Counter

from art import PAL, SPRITES, TILES, grid

HERE = os.path.dirname(os.path.abspath(__file__))


def target_of(src):
    rows = grid(src)
    return [[PAL[c] for c in r] for r in rows]


def lum(hexc):
    r, g, b = (int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    return 0.3 * r + 0.59 * g + 0.11 * b


def strokes(pixels):
    """greedy walk through pixels; a stroke continues only through 8-adjacent neighbours."""
    left = set(pixels)
    out = []
    while left:
        cur = min(left, key=lambda p: (p[1], p[0]))
        path = [cur]
        left.discard(cur)
        while True:
            x, y = cur
            nb = [(x + dx, y + dy) for dx, dy in ((1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)) if (x + dx, y + dy) in left]
            if not nb:
                break
            cur = nb[0]
            path.append(cur)
            left.discard(cur)
        out.append(path)
    return out


def flood(canvas, x, y, color):
    h, w = len(canvas), len(canvas[0])
    target = canvas[y][x]
    if target == color:
        return []
    stack, seen, filled = [(x, y)], set(), []
    while stack:
        cx, cy = stack.pop()
        if (cx, cy) in seen or not (0 <= cx < w and 0 <= cy < h) or canvas[cy][cx] != target:
            continue
        seen.add((cx, cy))
        filled.append((cx, cy))
        stack += [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)]
    return filled


def plan(src, outline="#1b1a2a"):
    tgt = target_of(src)
    h, w = len(tgt), len(tgt[0])
    canvas = [[None] * w for _ in range(h)]
    steps = []
    counts = Counter(c for row in tgt for c in row if c)

    def pen(color, pixels):
        for path in strokes(pixels):
            steps.append({"tool": "pen", "color": color, "path": path})
            for x, y in path:
                canvas[y][x] = color

    has_outline = counts.get(outline, 0) > 0 and any(tgt[y][x] is None for y in range(h) for x in range(w))
    # 1. outline
    if has_outline:
        pen(outline, [(x, y) for y in range(h) for x in range(w) if tgt[y][x] == outline])
    # 2. base color with the bucket (only if the region stays inside the outline)
    base = max((c for c in counts if c != outline), key=lambda c: counts[c])
    seeds = [(x, y) for y in range(h) for x in range(w) if tgt[y][x] == base and canvas[y][x] is None]
    for sx, sy in seeds:
        if canvas[sy][sx] is not None:
            continue
        region = flood(canvas, sx, sy, base)
        if all(tgt[y][x] is not None for x, y in region):     # no leak outside the sprite
            steps.append({"tool": "fill", "color": base, "path": [(sx, sy)]})
            for x, y in region:
                canvas[y][x] = base
    # 3. the other colors: darks first, then lights, highlights and details last
    rest = sorted((c for c in counts if c not in (base, outline)), key=lambda c: (lum(c) > lum(base), abs(lum(c) - lum(base))))
    for c in rest + [base, outline]:
        todo = [(x, y) for y in range(h) for x in range(w) if tgt[y][x] == c and canvas[y][x] != c]
        if todo:
            pen(c, todo)
    assert canvas == tgt, "plan does not reproduce the sprite"
    return {"w": w, "h": h, "steps": steps}


def recolor_plan():
    """the live recolor demo: shift+fill each jelly shade with pink (base, light, dark, darkest)."""
    tgt = target_of(SPRITES["jelly"])
    pink = [("#4fd3a5", "#ff7aa8"), ("#a2f5c8", "#ffc6dc"), ("#2c9e8f", "#c94f86"), ("#1d6470", "#7a2a5c")]
    out = []
    for old, new in pink:
        # click a pixel of that shade near the middle
        cands = [(x, y) for y in range(len(tgt)) for x in range(len(tgt[0])) if tgt[y][x] == old]
        cx = sum(p[0] for p in cands) / len(cands)
        cy = sum(p[1] for p in cands) / len(cands)
        out.append({"from": old, "color": new, "at": min(cands, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)})
    return out


if __name__ == "__main__":
    plans = {"jelly": plan(SPRITES["jelly"]), "coin": plan(SPRITES["coin"]), "spiky": plan(SPRITES["spiky"]), "tiles0": plan(TILES[0])}
    plans["recolor"] = recolor_plan()
    json.dump(plans, open(os.path.join(HERE, "plan.json"), "w"))
    for k, v in plans.items():
        if k != "recolor":
            print(k, len(v["steps"]), "strokes", sum(len(s["path"]) for s in v["steps"]), "pixels")
