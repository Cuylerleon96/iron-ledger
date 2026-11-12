#!/usr/bin/env python3
"""make_hero_ember.py — draw the EMBER WISP placeholder hero sheet.

Hand-drawn sprites replace this. It gives the Hero tab a THIRD hero on
the SAME row contract (slime + pebble are the others):

    img/hero-ember.png  128x192 = 4 cols x 6 rows of 32x32
    row 0 idle | 1 walk | 2 pickup | 3 lift-a | 4 lift-b | 5 celebrate
    * every row STARTS and ENDS on the ONE shared NEUTRAL pose;
    * the flame's base sits on the cell's LAST row (a level floor).

An EMBER WISP: a small living flame with a soft glow — a tapering teardrop body,
a bright core, two dark spark-eyes and (when it leaps) little side wisps. The
glow is a LOW-ALPHA halo drawn only on empty pixels, so the flame reads as light
on the dark-blue header without a second sprite.

    python3 tools/make_hero_ember.py            # writes img/hero-ember.png
    python3 tools/make_hero_ember.py --ascii     # + a terminal preview
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_sheet_core import (  # noqa: E402
    CELL, COLS, ROWS, W, H, GROUND_ROW, ellipse, boundary, build_sheet,
    stamp_shadow, report,
)
from PIL import Image  # noqa: E402

# --- palette: warm flame, tuned to sit on the dark-blue header ----------------
OUTLINE   = (48, 16, 8, 255)
INK_SHADOW = (8, 18, 32, 255)        # ground-contact shadow (blue ink)
DARK      = (176, 58, 20, 255)
MID       = (238, 116, 32, 255)
LITE      = (255, 186, 64, 255)
CORE      = (255, 246, 180, 255)
EYE       = (44, 16, 10, 255)
GLOW      = (255, 150, 70, 70)       # low-alpha halo, drawn on empty pixels only
SPARK     = (255, 233, 138, 255)


def _p(w, h, dy, eyes, wisps=False, sparkle=False):
    return {"w": w, "h": h, "dy": dy, "eyes": eyes, "wisps": wisps, "sparkle": sparkle}

NEUTRAL = _p(9, 18, 0, "open")
N = dict(NEUTRAL)

POSES = [
    # row 0 idle — a flicker (the flame breathes), then a blink
    N,
    _p(9, 20, 0, "open"),
    _p(10, 17, 0, "blink"),
    N,
    # row 1 walk — a bob up, then a squat flicker
    N,
    _p(9, 19, -2, "open"),
    _p(11, 17, 0, "open"),
    N,
    # row 2 pickup — dips low, then rises holding the heat
    N,
    _p(8, 12, 0, "open"),
    _p(10, 20, -1, "open"),
    N,
    # row 3 lift-a — a CURL, the flame tightens then flares
    N,
    _p(8, 16, 0, "open"),
    _p(11, 21, 0, "happy"),
    N,
    # row 4 lift-b — an OVERHEAD PRESS, the flame stretches tall
    N,
    _p(8, 17, 0, "open"),
    _p(10, 23, -1, "happy"),
    N,
    # row 5 celebrate — a big leap with wisps and sparkles
    N,
    _p(10, 15, 0, "open"),
    _p(12, 23, -4, "happy", True, True),
    N,
]
assert len(POSES) == COLS * ROWS, "the pose table must cover every cell"

SPARK_AT = [(5, 5), (26, 8), (7, 2), (24, 3)]


def flame(cx, top, base, w):
    """A tapering teardrop: a point at the top, widening to `w` at the base."""
    px = set()
    h = max(1, base - top)
    for y in range(top, base + 1):
        t = (y - top) / float(h)
        hw = w * (t ** 0.55)
        x0 = int(round(cx - hw))
        x1 = int(round(cx + hw)) - 1
        for x in range(x0, x1 + 1):
            if 0 <= x < CELL and 0 <= y < CELL:
                px.add((x, y))
    # round the base corners a little so it sits, doesn't spike
    px |= {(x, base) for x in range(int(cx - w), int(cx + w)) if 0 <= x < CELL}
    return px


def draw_frame(spec):
    """Return the 32x32 cell as a dict (x, y) -> RGBA."""
    w, h, dy = spec["w"], spec["h"], spec["dy"]
    eyes = spec["eyes"]
    cx = CELL / 2.0
    base = GROUND_ROW + dy
    top = base - h
    body = flame(cx, top, base, w)
    rim = boundary(body)

    cell = {}
    for (x, y) in body:
        if (x, y) in rim:
            cell[(x, y)] = OUTLINE
            continue
        # the core is hottest at the bottom centre, cooler up the sides
        t = (y - top) / float(max(1, h))
        dxn = abs(x + 0.5 - cx) / max(1.0, w)
        heat = t - dxn * 0.9
        cell[(x, y)] = CORE if heat > 0.72 else (LITE if heat > 0.42 else (MID if heat > 0.12 else DARK))

    # two spark-eyes on the mid flame
    ex = int(round(cx - w * 0.45))
    ey = top + max(3, int(h * 0.55))
    for sgn in (0, 1):
        p = (ex + sgn * max(3, int(w * 0.6)), ey)
        if p in cell and cell[p] != OUTLINE:
            cell[p] = EYE
    if eyes == "blink":
        for sgn in (0, 1):
            p = (ex + sgn * max(3, int(w * 0.6)), ey)
            if p in cell:
                cell[p] = DARK

    # side wisps (a leaping flame throws little tongues of fire off the sides),
    # at a given HEIGHT on the left or right of the flame.
    if spec["wisps"]:
        for (ox, oy) in [(-1, top + 2), (1, top + 5), (-1, base - 6)]:
            wx, wy = int(cx) + ox * (w + 1), oy
            for p in [(wx, wy), (wx - 1, wy + 1), (wx, wy + 1)]:
                if 0 <= p[0] < CELL and 0 <= p[1] < CELL and p not in cell:
                    cell[p] = LITE

    if spec["sparkle"]:
        for (sxp, syp) in SPARK_AT:
            for p in [(sxp, syp), (sxp - 1, syp), (sxp + 1, syp),
                      (sxp, syp - 1), (sxp, syp + 1)]:
                if 0 <= p[0] < CELL and 0 <= p[1] < CELL and p not in cell:
                    cell[p] = SPARK

    # a low-alpha GLOW halo, on empty pixels only (the flame is the light source).
    # Clamped to columns 1..CELL-2 so the halo never bleeds into the cell's outer
    # columns — the no-bleed guarantee every sheet in this repo keeps.
    glow = {(x, y) for (x, y) in ellipse(cx, (top + base) / 2.0, w + 3, h / 2.0 + 2)
            if 1 <= x <= CELL - 2 and 0 <= y < CELL}
    for (x, y) in glow:
        if (x, y) not in cell:
            cell[(x, y)] = GLOW

    # a level ground contact: the LOWEST row of ink is GROUND_ROW in every frame
    stamp_shadow(cell, cx, max(3, int(round(w * (0.5 if dy == 0 else 0.36)))), INK_SHADOW)
    return cell


GLYPH = {OUTLINE: "#", DARK: "+", MID: "o", LITE: "*", CORE: "@",
         EYE: "e", GLOW: ".", SPARK: "x", INK_SHADOW: "s"}


def build():
    return build_sheet(draw_frame, NEUTRAL, POSES, INK_SHADOW)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), "img", "hero-ember.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet = build()
    sheet.save(out)
    report(sheet, out, POSES, GLYPH)
    return 0


if __name__ == "__main__":
    sys.exit(main())
