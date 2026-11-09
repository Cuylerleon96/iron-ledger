#!/usr/bin/env python3
"""make_hero_gear.py — draw the GEAR OVERLAY art for the Hero tab.

Two small static PNGs, each a 32x32 canvas (one GBA cell) with the GARMENT
drawn at NATIVE SIZE inside the canvas's TOP-LEFT box, transparent everywhere
else:

    img/gear-headband.png   14 x 4   a band across the brow
    img/gear-belt.png       14 x 3   a belt with a buckle

WHY the art sits at the canvas origin at its own size: the overlay is pinned to a
PER-HERO anchor (js/engine.js HERO_ITEMS -> anatomy + Engine.gearBox) and the
renderer computes its box as cellSize * (v / 32) in CELL UNITS, then scales the
whole canvas so the art lands EXACTLY on that box (css/style.css
`.gear-overlay`). The box WIDTH is fitted to the hero's own band (a 10-unit golem
head gets a 10-unit band), so ONE drawing fits every shape.

THE OUTLINE is a 1-2px rim in a DARKER SHADE OF THE ITEM'S OWN COLOUR — never
black. At 4x a black rim read as a black brick. And the edge where the garment
MEETS THE BODY carries NO rim at all (the band's bottom, the belt's bottom), so
the item blends into the body instead of being boxed off.

    python3 tools/make_hero_gear.py              # writes the two PNGs
    python3 tools/make_hero_gear.py --ascii       # + a terminal preview
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hero_sheet_core import CELL, rect  # noqa: E402
from PIL import Image  # noqa: E402

# Each garment's OWN colours; the rim is derived from the base (a darker shade).
BAND    = (252, 72, 72, 255)     # headband
KNOT    = (255, 160, 120, 255)
BELT    = (240, 196, 44, 255)    # belt
BUCKLE  = (255, 244, 180, 255)

# name -> (declared size w, h) — kept in step with js/engine.js HERO_ITEMS.
SIZES = {"gear-headband": (14, 4), "gear-belt": (14, 3)}


def shade(col, f):
    """A darker shade of the item's own colour (f < 1), keeping it opaque."""
    r, g, b, a = col
    return (int(round(r * f)), int(round(g * f)), int(round(b * f)), a)


def _paint(body, fills, base, touch="bottom"):
    """body: pixel set; fills: [(pixel set -> colour)] applied in order. The body
    is filled with its OWN base colour; the OUTLINE is a 1-2px rim in a DARKER
    SHADE of that same colour (never black — a black rim on a 4px band made the
    whole thing black and read as a brick), drawn on the TOP edge and the two
    SIDE columns only, with NO rim on the `touch` edge (the one that meets the
    body), so the garment blends into the body instead of being boxed off."""
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    for p in body:
        im.putpixel(p, shade(base, 0.58))
    edge = min(y for (_x, y) in body) if touch == "top" else max(y for (_x, y) in body)
    left = min(x for (x, _y) in body)
    right = max(x for (x, _y) in body)
    rim = {(x, y) for (x, y) in body
           if (y == min(yy for (_x, yy) in body)) or ((x == left or x == right) and y != edge)}
    for p in body:
        if p not in rim:
            im.putpixel(p, base)
    for pts, col in fills:
        for p in pts:
            if p in body:
                im.putpixel(p, col)
    return im


def headband():
    w, h = SIZES["gear-headband"]
    body = rect(0, w - 1, 0, h - 1)
    knot = rect(6, 7, 1, 2)
    return _paint(body, [(knot, KNOT)], BAND, touch="bottom")


def belt():
    w, h = SIZES["gear-belt"]
    body = rect(0, w - 1, 0, h - 1)
    buckle = rect(5, 8, 0, 2)
    return _paint(body, [(buckle, BUCKLE)], BELT, touch="bottom")


GEAR = [("gear-headband", headband), ("gear-belt", belt)]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(os.path.dirname(here), "img")
    os.makedirs(outdir, exist_ok=True)
    for name, fn in GEAR:
        im = fn()
        out = os.path.join(outdir, name + ".png")
        im.save(out)
        w, h = SIZES[name]
        raw = im.tobytes()                       # flat RGBA bytes, W*CELL*4 long
        ink = [(i % CELL, i // CELL) for i in range(CELL * CELL) if raw[i * 4 + 3] > 0]
        bbox = None
        if ink:
            bbox = (min(p[0] for p in ink), min(p[1] for p in ink),
                    max(p[0] for p in ink), max(p[1] for p in ink))
        print("wrote %s  %dx%d  declared %dx%d  ink=%d  bbox=%s" %
              (out, im.width, im.height, w, h, len(ink), bbox))
        assert bbox == (0, 0, w - 1, h - 1), "art must fill the top-left size box exactly"
        if "--ascii" in sys.argv:
            for y in range(h):
                print("    " + "".join("#" if raw[(y * CELL + x) * 4 + 3] > 0 else " " for x in range(w)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
