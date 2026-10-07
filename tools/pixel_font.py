"""Turn a pixel-grid TTF (e.g. ERXPIXEL, 12 px / 100 units per pixel) into Slate's bitmap font file.

The outlines of such fonts are made of pixel squares, so they are rasterized exactly: a pixel is
on when its center is inside the outline (nonzero winding), no anti-aliasing, no rounding.

Output (.sfnt, little endian):
  b"SLFT", u16 version=1, u8 cell height, u8 ascent, u32 glyph count
  glyph count x [u32 codepoint, i8 x offset, i8 y offset (from top of the cell), u8 width, u8 height, u8 advance]
  then the bitmaps, 1 bit per pixel, rows padded to whole bytes, in the same order.
The file is then compressed with zlib (.sfnt.z) to embed in the player.

Run: python tools/pixel_font.py FONT.ttf out.sfnt.z [--preview preview.png]
"""
import struct, sys, zlib

import numpy as np
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont


def contours_of(glyphset, name):
    pen = DecomposingRecordingPen(glyphset)
    glyphset[name].draw(pen)
    out, cur = [], []
    for op, args in pen.value:
        if op == "moveTo":
            cur = [args[0]]
        elif op in ("lineTo", "qCurveTo", "curveTo"):
            cur.extend(args)  # pixel fonts are straight lines; take the points of any curve as corners
        elif op in ("closePath", "endPath"):
            if len(cur) > 2:
                out.append(np.array(cur, dtype=float))
            cur = []
    return out


def rasterize(contours, unit):
    if not contours:
        return None
    pts = np.concatenate(contours) / unit
    x0, y0 = np.floor(pts.min(0)).astype(int)
    x1, y1 = np.ceil(pts.max(0)).astype(int)
    w, h = x1 - x0, y1 - y0
    if w <= 0 or h <= 0:
        return None
    cx, cy = np.meshgrid(np.arange(w) + x0 + 0.5, np.arange(h) + y0 + 0.5)
    cx, cy = cx.ravel(), cy.ravel()
    wind = np.zeros(cx.shape, dtype=int)
    for c in contours:
        c = c / unit
        a, b = c, np.roll(c, -1, axis=0)
        for (ax, ay), (bx, by) in zip(a, b):
            if ay == by:
                continue
            up = (ay <= cy) & (by > cy)
            down = (ay > cy) & (by <= cy)
            t = (cy - ay) / (by - ay)
            xi = ax + t * (bx - ax)
            right = xi > cx
            wind += np.where(up & right, 1, 0) - np.where(down & right, 1, 0)
    mask = (wind != 0).reshape(h, w)[::-1]  # font y goes up, rows go down
    return mask, x0, y1  # y1 = top edge in font pixels (above the baseline)


def build(path, ranges=None):
    f = TTFont(path)
    unit = f["head"].unitsPerEm // 12 if f["head"].unitsPerEm % 12 == 0 else 100
    asc = round(f["hhea"].ascent / unit)
    desc = round(-f["hhea"].descent / unit)
    cell = asc + desc
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    hmtx = f["hmtx"]
    glyphs = []
    for cp in sorted(cmap):
        if ranges and not any(a <= cp <= b for a, b in ranges):
            continue
        name = cmap[cp]
        adv = round(hmtx[name][0] / unit)
        r = rasterize(contours_of(gs, name), unit)
        if r is None:
            glyphs.append((cp, 0, 0, 0, 0, adv, b""))
            continue
        mask, x0, top = r
        # trim empty rows / columns
        rows, cols = np.where(mask.any(1))[0], np.where(mask.any(0))[0]
        if not len(rows):
            glyphs.append((cp, 0, 0, 0, 0, adv, b""))
            continue
        mask = mask[rows[0]:rows[-1] + 1, cols[0]:cols[-1] + 1]
        gx, gy = x0 + cols[0], asc - top + rows[0]
        h, w = mask.shape
        bits = np.packbits(mask, axis=1).tobytes()
        glyphs.append((cp, gx, gy, w, h, adv, bits))
    return glyphs, cell, asc


def write(glyphs, cell, asc, out):
    head = b"SLFT" + struct.pack("<HBBI", 1, cell, asc, len(glyphs))
    table = b"".join(struct.pack("<IbbBBB", cp, x, y, w, h, a) for cp, x, y, w, h, a, _ in glyphs)
    data = b"".join(g[6] for g in glyphs)
    raw = head + table + data
    open(out, "wb").write(zlib.compress(raw, 9))
    return len(raw)


def preview(glyphs, cell, asc, text_lines, out):
    from PIL import Image
    g = {cp: (x, y, w, h, a, bits) for cp, x, y, w, h, a, bits in glyphs}
    W = max(sum(g.get(ord(c), (0, 0, 0, 0, 6, b""))[4] for c in line) for line in text_lines) + 8
    img = Image.new("RGB", (W, len(text_lines) * (cell + 3) + 6), (27, 26, 42))
    px = img.load()
    for li, line in enumerate(text_lines):
        pen = 4
        for ch in line:
            x, y, w, h, a, bits = g.get(ord(ch), (0, 0, 0, 0, 6, b""))
            stride = (w + 7) // 8
            for r in range(h):
                for c in range(w):
                    if bits[r * stride + c // 8] & (0x80 >> (c % 8)):
                        px[pen + x + c, 3 + li * (cell + 3) + y + r] = (244, 244, 244)
            pen += a
    img.resize((img.width * 4, img.height * 4), Image.NEAREST).save(out)


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    glyphs, cell, asc = build(src)
    n = write(glyphs, cell, asc, out)
    print(f"{src}: {len(glyphs)} glyphs, cell {cell}px (ascent {asc}), {n / 1024:.0f} KB raw")
    if "--preview" in sys.argv:
        preview(glyphs, cell, asc, ["게임 시작  SCORE 012345", "HP 100/100  레벨 업! 체력이 회복되었다.",
                                    "The quick brown fox 0123456789 !?()", "ひらがな カタカナ 漢字 €£¥ ©"], sys.argv[sys.argv.index("--preview") + 1])
