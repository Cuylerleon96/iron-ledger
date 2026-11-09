#!/usr/bin/env python3
"""make_hero_pebble.py — draw the PEBBLE GOLEM placeholder hero sheet.

the owner's hand-drawn sprites replace this. It gives the Hero tab a SECOND hero
(tools/make_hero_slime.py is the first) on the SAME row contract:

    img/hero-pebble.png  128x192 = 4 cols x 6 rows of 32x32
    row 0 idle | 1 walk | 2 pickup | 3 lift-a | 4 lift-b | 5 celebrate
    * every row STARTS and ENDS on the ONE shared NEUTRAL pose;
    * the stony base sits on the cell's LAST row (a level floor).

A GOLEM: blunt, blocky, unbreakable — built from BLOCKS (not a soft dome) with a
heavy head, glowing visor eye, stubby stone arms. Palette is cool grey-blue, so
it reads as a creature on the dark-blue header, not a UI chip.

    python3 tools/make_hero_pebble.py            # writes img/hero-pebble.png
    python3 tools/make_hero_pebble.py --ascii     # + a terminal preview
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_sheet_core import (  # noqa: E402
    CELL, COLS, ROWS, W, H, GROUND_ROW, rect, capsule, boundary, build_sheet,
    stamp_shadow, report,
)
from PIL import Image  # noqa: E402

# --- palette: cool stone, tuned to sit on the dark-blue header ----------------
OUTLINE   = (16, 18, 26, 255)        # dark stone rim
INK_SHADOW = (8, 18, 32, 255)        # ground-contact shadow (blue ink)
DARK      = (74, 80, 94, 255)
MID       = (116, 124, 140, 255)
LITE      = (162, 170, 186, 255)
GLINT     = (208, 214, 226, 255)
EYE       = (24, 26, 36, 255)        # dark visor socket
EYE_GLOW  = (150, 240, 255, 255)     # the bright stony eye-light
SPARK     = (255, 233, 138, 255)

# --- the shared NEUTRAL pose (row 0 col 0 / col 3 and every row's ends) -------
def _p(bw, bh, dy, hw, hh, arms, eyes, sparkle=False):
    return {"bw": bw, "bh": bh, "dy": dy, "hw": hw, "hh": hh,
            "arms": arms, "eyes": eyes, "sparkle": sparkle}

NEUTRAL = _p(16, 13, 0, 10, 7, "down", "open")
N = dict(NEUTRAL)

POSES = [
    # row 0 idle — a slow stone breath (the mass rises, then a blink)
    N,
    _p(15, 15, 0, 10, 7, "down", "open"),
    _p(16, 13, 0, 10, 7, "down", "blink"),
    N,
    # row 1 walk — a heavy stomp (lifts a touch, then drops and widens)
    N,
    _p(15, 15, -1, 10, 7, "down", "open"),
    _p(17, 12,  0, 10, 7, "down", "open"),
    N,
    # row 2 pickup — bend, then rise holding the stone
    N,
    _p(17, 10, 0, 12, 6, "reach", "open"),
    _p(15, 14, 0, 10, 7, "tuck", "open"),
    N,
    # row 3 lift-a — a CURL, arms in front, glowing with effort
    N,
    _p(15, 13, 0, 10, 7, "curl", "open"),
    _p(15, 14, 0, 10, 7, "curl", "happy"),
    N,
    # row 4 lift-b — an OVERHEAD PRESS
    N,
    _p(16, 12, 0, 10, 7, "press", "open"),
    _p(14, 17, -1, 10, 7, "press", "happy"),
    N,
    # row 5 celebrate — a heavy hop with sparkles
    N,
    _p(17, 11, 0, 10, 7, "down", "open"),
    _p(14, 15, -5, 10, 7, "up", "happy", True),
    N,
]
assert len(POSES) == COLS * ROWS, "the pose table must cover every cell"

SPARK_AT = [(4, 6), (27, 9), (8, 2), (24, 4)]


def arms_px(arms, cx, shoulder_y, bw, bh):
    """Stony arm stubs, as a pixel set. Anchored at the shoulder so they grow
    out of the body; kept inside the outer columns by the caller's cell clip."""
    px = set()
    for sgn in (-1, 1):
        if arms in (None, "down"):
            px |= capsule((cx + sgn * (bw / 2 + 1), shoulder_y + bh * 0.25),
                          (cx + sgn * (bw / 2 + 1), shoulder_y + bh * 0.62), 2.4)
        elif arms == "up":
            px |= capsule((cx + sgn * (bw / 2), shoulder_y + bh * 0.15),
                          (cx + sgn * (bw / 2 + 2), shoulder_y - bh * 0.55), 2.4)
        elif arms == "reach":
            px |= capsule((cx + sgn * (bw / 2 + 1), shoulder_y + bh * 0.3),
                          (cx + sgn * (bw / 2 - 1), GROUND_ROW - 1), 2.2)
        elif arms == "tuck":
            px |= capsule((cx + sgn * (bw / 2), shoulder_y + bh * 0.35),
                          (cx + sgn * (bw / 2 - 4), shoulder_y + bh * 0.55), 2.6)
        elif arms == "curl":
            px |= capsule((cx + sgn * (bw / 2), shoulder_y + bh * 0.3),
                          (cx + sgn * (bw / 2 - 3), shoulder_y + bh * 0.05), 2.6)
        elif arms == "press":
            px |= capsule((cx + sgn * (bw / 2), shoulder_y + bh * 0.1),
                          (cx + sgn * (bw / 2 - 1), shoulder_y - bh * 0.7), 2.4)
    return px


def draw_frame(spec):
    """Return the 32x32 cell as a dict (x, y) -> RGBA."""
    bw, bh, dy = spec["bw"], spec["bh"], spec["dy"]
    hw, hh = spec["hw"], spec["hh"]
    arms, eyes = spec["arms"], spec["eyes"]
    cx = CELL / 2.0
    base = GROUND_ROW + dy                 # bottom row of the body block
    top = base - bh + 1
    body = rect(int(round(cx - bw / 2.0)), int(round(cx + bw / 2.0)) - 1, top, base)
    hbase = top - 1                        # the head sits straight on the shoulders
    htop = hbase - hh + 1
    head = rect(int(round(cx - hw / 2.0)), int(round(cx + hw / 2.0)) - 1, htop, hbase)
    shoulder_y = top
    arm = {(x, y) for (x, y) in arms_px(arms, cx, shoulder_y, bw, bh)
           if 0 <= x < CELL and 1 <= y <= GROUND_ROW}
    shape = body | head | arm
    rim = boundary(shape)

    cell = {}
    for (x, y) in shape:
        if (x, y) in rim:
            cell[(x, y)] = OUTLINE
            continue
        # light from the top-left: a diagonal ramp across the flat stone
        shade = (x + 0.5 - cx) / max(1.0, bw / 2.0) + (y + 0.5 - top) / max(1.0, bh)
        cell[(x, y)] = LITE if shade < 0.55 else (DARK if shade > 1.25 else MID)

    # a chipped corner on the head, so the stone is blunt, not a clean box
    for (cxx, cyy) in [(int(cx - hw / 2.0), htop), (int(cx + hw / 2.0) - 1, hbase)]:
        if (cxx, cyy) in cell and cell[(cxx, cyy)] != OUTLINE:
            cell[(cxx, cyy)] = DARK

    # a 2x2 highlight up-left on the shoulders
    gx, gy = int(cx - bw * 0.32), top + 1
    for dx in (0, 1):
        for dyy in (0, 1):
            if (gx + dx, gy + dyy) in cell and cell[(gx + dx, gy + dyy)] != OUTLINE:
                cell[(gx + dx, gy + dyy)] = GLINT

    # the visor eye, set relative to the head centre
    ex = int(round(cx - hw * 0.5)) + 2
    ey = htop + max(2, hh // 2)
    for dx in range(0, hw - 3):
        p = (ex + dx, ey)
        if p in cell:
            cell[p] = EYE
    gp = (ex + 1, ey)
    if gp in cell:
        cell[gp] = EYE_GLOW
    if eyes == "blink":
        for dx in range(0, hw - 3):
            p = (ex + dx, ey)
            if p in cell:
                cell[p] = DARK

    if spec["sparkle"]:
        for (sxp, syp) in SPARK_AT:
            for p in [(sxp, syp), (sxp - 1, syp), (sxp + 1, syp),
                      (sxp, syp - 1), (sxp, syp + 1)]:
                if 0 <= p[0] < CELL and 0 <= p[1] < CELL and p not in cell:
                    cell[p] = SPARK

    # a level ground contact: the LOWEST row of ink is GROUND_ROW in every frame
    stamp_shadow(cell, cx, max(3, int(round(bw * (0.34 if dy == 0 else 0.26)))), INK_SHADOW)
    return cell


GLYPH = {OUTLINE: "#", DARK: "+", MID: "o", LITE: "*", GLINT: "@",
         EYE: "e", EYE_GLOW: "E", SPARK: "x", INK_SHADOW: "s"}


def build():
    return build_sheet(draw_frame, NEUTRAL, POSES, INK_SHADOW)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), "img", "hero-pebble.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet = build()
    sheet.save(out)
    report(sheet, out, POSES, GLYPH)
    px = sheet.load()
    assert px is not None
    return 0


if __name__ == "__main__":
    sys.exit(main())
