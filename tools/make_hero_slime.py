#!/usr/bin/env python3
"""make_hero_slime.py — draw the PLACEHOLDER hero sprite sheet.

the owner's hand-drawn sprites replace this. It exists so the header harness
(commit d2cc956, js/hero.js) has a real `img/hero-sheet.png` to render: 128x96
native px = 4 columns x 3 rows of 32x32 GBA cells.

    row 0  idle       gentle squash-and-stretch breathing (with a blink)
    row 1  lift       a working-out beat: crouch, press up, hold, settle
    row 2  celebrate  a hop with arms up and sparkles

The art lives HERE, in code, not in a binary blob: every frame is a row of the
FRAMES table below (silhouette radii, a vertical offset, an eye pose and arm
pose), rasterised with hard-edged (un-antialiased) coverage so it stays pixel
art. Palette is a green slime — deliberately NOT the app's gold/ink, so it reads
as a creature on the dark-blue header, not a UI chip.

    python3 tools/make_hero_slime.py            # writes img/hero-sheet.png
    python3 tools/make_hero_slime.py --ascii     # + a terminal preview

Pure, deterministic, stdlib + Pillow (already a repo tool dependency).
"""

import os
import sys

from PIL import Image

CELL = 32                      # one GBA sprite cell, native px
COLS, ROWS = 4, 3              # 4 animation frames x 3 animations
W, H = COLS * CELL, ROWS * CELL            # 128 x 96

# --- palette: a handful of colours, tuned to sit on the dark-blue header -----
# (the header is a #1a4a78 -> #10305a gradient; these greens read as a creature)
OUTLINE = (10, 30, 20, 255)          # dark green rim
DARK     = (28, 122, 66, 255)        # shaded lower-right of the body
MID      = (52, 186, 100, 255)       # body
LITE     = (112, 226, 150, 255)      # lit upper-left of the body
GLINT    = (198, 250, 214, 255)      # small body highlight
EYE      = (9, 22, 30, 255)          # dark (blue-black) eyes
WHITE    = (240, 250, 255, 255)      # eye glint
SPARK    = (255, 233, 138, 255)      # celebration sparkles (app-gold accent)

# --- frame table -------------------------------------------------------------
# Each entry: (label, sx, sy, dy, eyes, arms)
#   sx, sy   radii of the dome ellipse (px). Base sits at cy, so a big ry and a
#            small sx = a TALL stretched slime; small ry / big sx = a SQUASHED one.
#   dy       vertical offset of the whole body (negative = airborne).
#   eyes     "open" | "blink" | "happy"
#   arms     None | "down" | "up"
BASE_Y = 24                    # the slime's ground line; the body is the half of
                               # the dome ellipse ABOVE this line, so the base is
                               # flat at BASE_Y. It sits a few px above the cell
                               # bottom so the creature is CENTRED in its 32x32
                               # box (the header slot is 2x a cell, so a
                               # bottom-hugging sprite would ride low in the row).
FRAMES = [
    # --- row 0: idle, a breathing cycle (frames differ: in, out, blink) ------
    ("i0", 11.5, 15.0, 0, "open",  None),   # rest
    ("i1", 10.5, 16.5, 0, "open",  None),   # inhale: taller, narrower
    ("i2", 11.5, 15.0, 0, "blink", None),   # rest + blink
    ("i3", 12.5, 13.2, 0, "open",  None),   # exhale: wider, flatter
    # --- row 1: lift, a crouch -> press-up -> hold -> settle beat ------------
    ("l0", 13.0, 11.0, 0, "open",  "down"),  # crouch / squeeze down
    ("l1", 10.0, 17.5, 0, "open",  "up"),    # push up: tall, arms raised
    ("l2", 10.4, 16.8, 0, "happy", "up"),    # hold the rep
    ("l3", 12.2, 12.5, 0, "open",  "down"),  # settle back
    # --- row 2: celebrate, a hop with sparkles ------------------------------
    ("c0", 13.0, 11.2,  0, "open",  "down"),  # crouch before the hop
    ("c1", 10.2, 15.6, -5, "happy", "up"),    # leap: stretched, arms up
    ("c2", 11.0, 15.0, -6, "happy", "up"),    # apex
    ("c3", 13.2, 11.0,  0, "open",  "down"),  # land, squash
]
# sparkles are drawn only on the celebrate frames, at fixed cell coordinates
SPARK_FRAMES = {9, 10}                 # indices of c1, c2
SPARK_AT = [(4, 6), (27, 9), (8, 2), (24, 4)]


def ellipse(cx, cy, rx, ry):
    """Hard-edged (no AA) ellipse coverage over the 32x32 cell."""
    px = set()
    for y in range(CELL):
        for x in range(CELL):
            nx = (x + 0.5 - cx) / rx
            ny = (y + 0.5 - cy) / ry
            if nx * nx + ny * ny <= 1.0:
                px.add((x, y))
    return px


def boundary(pixels):
    """Pixels with an orthogonal neighbour outside the set — the 1px outline."""
    out = set()
    for (x, y) in pixels:
        if (x - 1, y) not in pixels or (x + 1, y) not in pixels \
           or (x, y - 1) not in pixels or (x, y + 1) not in pixels:
            out.add((x, y))
    return out


def capsule(p0, p1, r):
    """A thick segment as a union of circles — used for the arm stubs, so an
    arm actually GROWS OUT of the body instead of floating beside it."""
    (x0, y0), (x1, y1) = p0, p1
    steps = max(2, int(abs(x1 - x0) + abs(y1 - y0)) + 1)
    px = set()
    for i in range(steps + 1):
        t = i / float(steps)
        px |= ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r)
    return px


def draw_frame(sx, sy, dy, eyes, arms, sparkles):
    """Return the 32x32 cell as a dict (x, y) -> RGBA."""
    cx, cy = CELL / 2.0, BASE_Y + dy
    body = ellipse(cx, cy, sx, sy)                       # dome, flat base at cy

    # arms: thick stubs merged into the silhouette so the outline wraps them and
    # they grow out of the shoulder; "up" leans them out and above the head.
    if arms == "down":
        for sgn in (-1, 1):
            body |= capsule((cx + sgn * sx * 0.80, cy - sy * 0.28),
                            (cx + sgn * sx * 0.95, cy + sy * 0.18), 2.2)
    elif arms == "up":
        for sgn in (-1, 1):
            # from the shoulder OUT to the side and up, so it reads as a raised
            # arm rather than a thin ear on top of the head
            body |= capsule((cx + sgn * sx * 0.90, cy - sy * 0.15),
                            (cx + sgn * sx * 1.12, cy - sy * 0.62), 2.4)

    # keep the body inside the cell AND above the ground line: the silhouette is
    # the half of the dome ellipse above cy, so the base is FLAT at cy (an
    # airborne frame lifts cy, leaving empty rows beneath it).
    body = {(x, y) for (x, y) in body if 0 <= x < CELL and 0 <= y <= cy}
    rim = boundary(body)

    cell = {}
    for (x, y) in body:
        if (x, y) in rim:
            cell[(x, y)] = OUTLINE
            continue
        # light source top-left: a diagonal shade ramp
        shade = (x + 0.5 - cx) / sx + (y + 0.5 - cy) / sy
        cell[(x, y)] = LITE if shade < -0.30 else (DARK if shade > 0.45 else MID)

    # body highlight: a 2x2 glint up and to the left of centre
    hx, hy = int(cx - sx * 0.45), int(cy - sy * 0.70)
    for dx in (0, 1):
        for dyy in (0, 1):
            if (hx + dx, hy + dyy) in cell and cell[(hx + dx, hy + dyy)] != OUTLINE:
                cell[(hx + dx, hy + dyy)] = GLINT

    # eyes, set relative to the (possibly moving) head centre
    ex, ey = int(round(cx - sx * 0.34)), int(round(cy - sy * 0.42))
    for sgn in (-1, 1):
        exx = ex + (0 if sgn < 0 else int(round(sx * 0.68)))
        if eyes == "blink":
            for dx in (0, 1):
                p = (exx + dx, ey + 1)
                if p in cell:
                    cell[p] = EYE
        elif eyes == "happy":                # a small ^ arc
            for dx, dyy in [(0, 1), (1, 0), (2, 1)]:
                p = (exx + dx, ey + dyy)
                if p in cell:
                    cell[p] = EYE
        else:                                # open: a 2x2 dark eye with a glint
            for dx in (0, 1):
                for dyy in (0, 1):
                    p = (exx + dx, ey + dyy)
                    if p in cell:
                        cell[p] = EYE
            p = (exx, ey)
            if p in cell:
                cell[p] = WHITE

    if sparkles:
        for (sxp, syp) in SPARK_AT:
            for p in [(sxp, syp), (sxp - 1, syp), (sxp + 1, syp),
                      (sxp, syp - 1), (sxp, syp + 1)]:
                if 0 <= p[0] < CELL and 0 <= p[1] < CELL and p not in cell:
                    cell[p] = SPARK
    return cell


def build_sheet():
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, (label, sx, sy, dy, eyes, arms) in enumerate(FRAMES):
        row, col = divmod(i, COLS)
        cell = draw_frame(sx, sy, dy, eyes, arms, i in SPARK_FRAMES)
        for (x, y), rgba in cell.items():
            sheet.putpixel((col * CELL + x, row * CELL + y), rgba)
    return sheet


def ascii_preview(sheet):
    """One character per pixel so the frames can be judged in a terminal."""
    glyph = {OUTLINE: "#", DARK: "+", MID: "o", LITE: "*",
             GLINT: "@", EYE: "e", WHITE: ".", SPARK: "x"}
    for i, fr in enumerate(FRAMES):
        row, col = divmod(i, COLS)
        print("  %s (row %d, col %d)" % (fr[0], row, col))
        for y in range(CELL):
            line = "".join(glyph.get(sheet.getpixel((col * CELL + x, row * CELL + y)), " ")
                           for x in range(CELL))
            print("    " + line)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(os.path.dirname(here), "img", "hero-sheet.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet = build_sheet()
    sheet.save(out)
    print("wrote %s  %dx%d" % (out, sheet.width, sheet.height))
    px = sheet.load()
    assert px is not None
    ink = sum(1 for y in range(H) for x in range(W) if px[x, y][3] > 0)
    print("non-transparent pixels: %d / %d" % (ink, W * H))
    for i, fr in enumerate(FRAMES):
        row, col = divmod(i, COLS)
        n = sum(1 for y in range(CELL) for x in range(CELL)
                if sheet.getpixel((col * CELL + x, row * CELL + y))[3] > 0)
        print("  cell %-3s row %d col %d ink=%d" % (fr[0], row, col, n))
    if "--ascii" in sys.argv:
        ascii_preview(sheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
