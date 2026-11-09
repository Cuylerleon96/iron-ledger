#!/usr/bin/env python3
"""hero_sheet_core.py — the SHARED machinery for every placeholder hero sheet.

make_hero_slime.py carries its own copy of this (it shipped first and its PNG is
pinned by tools/test_hero_sheet.py, so it is deliberately left untouched). Every
NEW hero generator imports from here so all sheets obey ONE contract:

    128x192 native px = 4 columns x 6 rows of 32x32 GBA cells
      row 0 idle | 1 walk | 2 pickup | 3 lift-a | 4 lift-b | 5 celebrate
      * every row STARTS and ENDS on the SAME shared NEUTRAL pose (column 0 and
        the LAST column are stamped byte-for-byte), so any behaviour can follow
        any other with no pop;
      * the creature's BASE sits on the cell's LAST row (GROUND_ROW), with a
        contact shadow stamped on that row in every frame.

Pure, deterministic, stdlib + Pillow. A `--ascii` flag previews the frames.
"""

import sys

from PIL import Image

CELL = 32                      # one GBA sprite cell, native px
COLS, ROWS = 4, 6              # 4 animation frames x 6 animations
W, H = COLS * CELL, ROWS * CELL            # 128 x 192
GROUND_ROW = CELL - 1          # the cell's LAST row = the floor contact row

ROW_NAMES = ["idle", "walk", "pickup", "lift-a", "lift-b", "celebrate"]


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


def rect(x0, x1, y0, y1):
    """Inclusive block coverage (a stony body is built from blocks, not domes)."""
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)
            if 0 <= x < CELL and 0 <= y < CELL}


def boundary(pixels):
    """Pixels with an orthogonal neighbour outside the set — the 1px outline."""
    out = set()
    for (x, y) in pixels:
        if (x - 1, y) not in pixels or (x + 1, y) not in pixels \
           or (x, y - 1) not in pixels or (x, y + 1) not in pixels:
            out.add((x, y))
    return out


def capsule(p0, p1, r):
    """A thick segment as a union of circles — arm/leg stubs that GROW OUT of
    the body instead of floating beside it."""
    (x0, y0), (x1, y1) = p0, p1
    steps = max(2, int(abs(x1 - x0) + abs(y1 - y0)) + 1)
    px = set()
    for i in range(steps + 1):
        t = i / float(steps)
        px |= ellipse(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r)
    return px


def stamp_shadow(cell, cx, half, ink):
    """The GROUND CONTACT on the cell's LAST row, at the SAME row in every frame
    (the floor is level), so a hop visibly leaves the ground and lands back on it."""
    for x in range(int(cx - half), int(cx + half) + 1):
        if 0 <= x < CELL:
            cell[(x, GROUND_ROW)] = ink


def build_sheet(draw_frame, neutral, poses, shadow_ink):
    """Assemble the sheet. ENFORCES the neutral seam: column 0 and the LAST
    column of EVERY row are the ONE shared NEUTRAL cell, byte-for-byte."""
    neutral_cell = draw_frame(neutral)
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, spec in enumerate(poses):
        row, col = divmod(i, COLS)
        cell = neutral_cell if col in (0, COLS - 1) else draw_frame(spec)
        for (x, y), rgba in cell.items():
            sheet.putpixel((col * CELL + x, row * CELL + y), rgba)
    return sheet


def row_first_last_identical(sheet):
    """Per row, is the first cell pixel-identical to the last? (the seam check)"""
    out = []
    for row in range(ROWS):
        a = {(x, y): sheet.getpixel((0 * CELL + x, row * CELL + y)) for y in range(CELL) for x in range(CELL)}
        b = {(x, y): sheet.getpixel(((COLS - 1) * CELL + x, row * CELL + y)) for y in range(CELL) for x in range(CELL)}
        out.append(a == b)
    return out


def lowest_inked_row(sheet):
    """Per cell, the lowest row carrying any ink — must be GROUND_ROW for a
    grounded contract (the floor is level across every frame)."""
    rows = []
    for i in range(COLS * ROWS):
        row, col = divmod(i, COLS)
        low = -1
        for y in range(CELL):
            for x in range(CELL):
                if sheet.getpixel((col * CELL + x, row * CELL + y))[3] > 0:
                    low = max(low, y)
        rows.append(low)
    return rows


def ascii_preview(sheet, glyph, poses):
    for i in range(len(poses)):
        row, col = divmod(i, COLS)
        print("  cell %d (row %d, col %d)" % (i, row, col))
        for y in range(CELL):
            line = "".join(glyph.get(sheet.getpixel((col * CELL + x, row * CELL + y)), " ")
                           for x in range(CELL))
            print("    " + line)


def report(sheet, path, poses, glyph):
    print("wrote %s  %dx%d" % (path, sheet.width, sheet.height))
    ink = sum(1 for y in range(H) for x in range(W) if sheet.getpixel((x, y))[3] > 0)
    print("non-transparent pixels: %d / %d" % (ink, W * H))
    seam = row_first_last_identical(sheet)
    print("rows whose first == last frame: %s" % seam)
    lows = lowest_inked_row(sheet)
    print("lowest inked row per cell: %s" % lows)
    if "--ascii" in sys.argv:
        ascii_preview(sheet, glyph, poses)
