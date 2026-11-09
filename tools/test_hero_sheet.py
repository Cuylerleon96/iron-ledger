#!/usr/bin/env python3
"""test_hero_sheet.py — the placeholder hero sprite sheet is real and complete.

Guards the ONE asset the header harness (js/hero.js, commit d2cc956) renders:
img/hero-sheet.png must exist, be EXACTLY 128x96 (4 columns x 3 rows of 32x32
GBA cells), have a transparent background, and carry ink in all 12 cells. It
also checks the rows are real CYCLES (the 4 frames of a row are not 4 copies).

    python3 tools/test_hero_sheet.py     # exits non-zero on any failure
"""

import os
import sys

from typing import Tuple

from PIL import Image

CELL, COLS, ROWS = 32, 4, 3
W, H = COLS * CELL, ROWS * CELL

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET = os.path.join(os.path.dirname(HERE), "img", "hero-sheet.png")

pass_n = 0
fail_n = 0


def check(ok, label):
    global pass_n, fail_n
    if ok:
        pass_n += 1
        print("  OK   %s" % label)
    else:
        fail_n += 1
        print("  FAIL %s" % label)


def main():
    print("=== hero sprite sheet: a 128x96 placeholder for the header harness ===")
    check(os.path.exists(SHEET), "img/hero-sheet.png exists")
    if not os.path.exists(SHEET):
        print("\n%d passed, %d failed" % (pass_n, fail_n))
        return 1

    img = Image.open(SHEET).convert("RGBA")
    img.load()
    raw = list(img.tobytes())                  # flat RGBA bytes, W*H*4 long

    def P(x, y) -> Tuple[int, int, int, int]:
        i = (y * W + x) * 4
        return (raw[i], raw[i + 1], raw[i + 2], raw[i + 3])

    check(img.size == (W, H), "the sheet is EXACTLY 128x96 (got %dx%d)" % img.size)
    check(img.mode == "RGBA", "the sheet is RGBA (has an alpha channel)")

    # transparency: the four sheet corners must be fully transparent, so the
    # sheet is not a filled rectangle (the harness relies on a transparent bg).
    corners = [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]
    check(all(P(*c)[3] == 0 for c in corners),
          "the sheet background is transparent (all four corners alpha=0)")

    # all 12 cells must carry ink
    for r in range(ROWS):
        for c in range(COLS):
            n = sum(1 for y in range(CELL) for x in range(CELL)
                    if P(c * CELL + x, r * CELL + y)[3] > 0)
            check(n > 0, "cell row %d col %d has non-transparent pixels (%d inked)" % (r, c, n))

    # every frame kept INSIDE its own cell: no frame touches its cell's first or
    # last column, or its first/last row, so nothing can look clipped or bleed
    # toward a neighbour (the ground line is BASE_Y=30, so row 31 stays clear).
    edge_clear = all(
        P(c * CELL + x, r * CELL + y)[3] == 0
        for r in range(ROWS) for c in range(COLS)
        for x in (0, CELL - 1) for y in range(CELL))
    edge_clear = edge_clear and all(
        P(c * CELL + x, r * CELL + y)[3] == 0
        for r in range(ROWS) for c in range(COLS)
        for y in (0, CELL - 1) for x in range(CELL))
    check(edge_clear, "no frame bleeds: the outer column/row of every cell is blank")

    # each row is a real 4-frame cycle, not four copies of one frame
    for r in range(ROWS):
        frames = [tuple(P(c * CELL + x, r * CELL + y)
                        for y in range(CELL) for x in range(CELL))
                  for c in range(COLS)]
        check(len(set(frames)) == COLS,
              "row %d is a real 4-frame cycle (4 distinct frames)" % r)

    print("\n%d passed, %d failed" % (pass_n, fail_n))
    return 1 if fail_n else 0


if __name__ == "__main__":
    sys.exit(main())
