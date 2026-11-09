#!/usr/bin/env python3
"""test_hero_sheet.py — the placeholder hero sprite sheet is real and complete.

Guards the ONE asset the header harness (js/hero.js) renders:
img/hero-sheet.png must exist, be EXACTLY 128x192 (4 columns x 6 rows of 32x32
GBA cells), have a transparent background, and carry ink in all 24 cells. It
also checks the rows are real CYCLES (the moving frames differ from neutral),
that the FLOOR IS LEVEL (every frame's lowest inked pixel row is the cell's
LAST row), and — the whole point of the 6-row sheet — that EVERY ROW'S FIRST AND
LAST FRAME ARE PIXEL-IDENTICAL TO THE ONE SHARED NEUTRAL STANDING POSE, so any
behaviour can follow any other with no pop. See tools/make_hero_slime.py.

    python3 tools/test_hero_sheet.py     # exits non-zero on any failure
"""

import os
import sys

from PIL import Image

CELL, COLS, ROWS = 32, 4, 6
W, H = COLS * CELL, ROWS * CELL            # 128 x 192

# the row names, in sheet order — kept in step with js/hero.js and style.css
ROW_NAMES = ["idle", "walk", "pickup", "lift-a", "lift-b", "celebrate"]

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
    print("=== hero sprite sheet: a 128x192 placeholder with a shared neutral seam ===")
    check(os.path.exists(SHEET), "img/hero-sheet.png exists")
    if not os.path.exists(SHEET):
        print("\n%d passed, %d failed" % (pass_n, fail_n))
        return 1

    img = Image.open(SHEET).convert("RGBA")
    img.load()
    raw = list(img.tobytes())                  # flat RGBA bytes, W*H*4 long

    def P(x, y):
        i = (y * W + x) * 4
        return (raw[i], raw[i + 1], raw[i + 2], raw[i + 3])

    def cell(r, c):
        return tuple(P(c * CELL + x, r * CELL + y)
                     for y in range(CELL) for x in range(CELL))

    check(img.size == (W, H), "the sheet is EXACTLY 128x192 (6 rows of 32: got %s)" % str(img.size))
    check(img.mode == "RGBA", "the sheet is RGBA (has an alpha channel)")

    # transparency: the four sheet corners must be fully transparent.
    corners = [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]
    check(all(P(*c)[3] == 0 for c in corners),
          "the sheet background is transparent (all four corners alpha=0)")

    # all 24 cells must carry ink
    empty = [(r, c) for r in range(ROWS) for c in range(COLS)
             if sum(1 for (rr, gg, bb, aa) in cell(r, c) if aa > 0) == 0]
    check(not empty, "all 24 cells are non-empty (blank offenders %s)" % empty)

    # every frame kept INSIDE its own cell SIDEWAYS and at the TOP: no frame
    # touches its cell's first/last column or its first row (no bleed/clipping).
    edge_clear = all(
        P(c * CELL + x, r * CELL + y)[3] == 0
        for r in range(ROWS) for c in range(COLS)
        for x in (0, CELL - 1) for y in range(CELL))
    edge_clear = edge_clear and all(
        P(c * CELL + x, r * CELL + y)[3] == 0
        for r in range(ROWS) for c in range(COLS)
        for y in (0,) for x in range(CELL))
    check(edge_clear, "no frame bleeds sideways or upward: the outer columns and "
                      "the top row of every cell are blank")

    # --- THE FLOOR IS LEVEL -----------------------------------------------------
    def lowest_inked_row(c, r):
        rows = [y for y in range(CELL) for x in range(CELL)
                if P(c * CELL + x, r * CELL + y)[3] > 0]
        return max(rows) if rows else -1    # -1 = empty cell (fails the checks)

    off_floor = [(r, c) for r in range(ROWS) for c in range(COLS)
                 if lowest_inked_row(c, r) != CELL - 1]
    check(not off_floor,
          "all 24 frames touch the last cell row (the cell's LAST row is the floor; "
          "offenders %s)" % off_floor)

    # --- THE NEUTRAL SEAM (the whole point of the 6-row sheet) ------------------
    neutral = cell(0, 0)                       # the ONE shared neutral standing pose
    bad_first = [(ROW_NAMES[r], c) for r in range(ROWS) for c in (0,)
                 if cell(r, c) != neutral]
    bad_last = [(ROW_NAMES[r], c) for r in range(ROWS) for c in (COLS - 1,)
                if cell(r, c) != neutral]
    check(not bad_first,
          "every row's FIRST frame is pixel-identical to the shared neutral (%s)" % bad_first)
    check(not bad_last,
          "every row's LAST frame is pixel-identical to the shared neutral (%s)" % bad_last)

    # each row is a real cycle: the two moving frames differ from neutral AND
    # from each other (cols 0 and 3 are the neutral seam by design).
    for r in range(ROWS):
        movers = [cell(r, 1), cell(r, 2)]
        check(all(m != neutral for m in movers) and movers[0] != movers[1],
              "row %s has two distinct moving frames (both differ from neutral)" % ROW_NAMES[r])

    # --- the TWO NEW placeholder heroes share the SAME row contract -------------
    # (pebble golem + ember wisp; see tools/make_hero_pebble.py / make_hero_ember.py)
    def contract(path, label):
        check(os.path.exists(path), "%s exists" % os.path.basename(path))
        if not os.path.exists(path):
            return
        im = Image.open(path).convert("RGBA")
        im.load()
        rb = list(im.tobytes())

        def Q(x, y):
            i = (y * im.width + x) * 4
            return (rb[i], rb[i + 1], rb[i + 2], rb[i + 3])

        def cl(r, c):
            return tuple(Q(c * CELL + x, r * CELL + y)
                         for y in range(CELL) for x in range(CELL))

        check(im.size == (W, H), "%s is EXACTLY 128x192" % label)
        check(im.mode == "RGBA", "%s is RGBA (has an alpha channel)" % label)
        corners = [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]
        check(all(Q(*c)[3] == 0 for c in corners), "%s background is transparent" % label)
        empty = [(r, c) for r in range(ROWS) for c in range(COLS)
                 if not any(aa > 0 for (_, _, _, aa) in cl(r, c))]
        check(not empty, "%s all 24 cells carry ink (blank %s)" % (label, empty))
        off = [(r, c) for r in range(ROWS) for c in range(COLS)
               if (max([y for y in range(CELL) for x in range(CELL)
                        if Q(c * CELL + x, r * CELL + y)[3] > 0] or [-1])) != CELL - 1]
        check(not off, "%s the floor is level (every frame touches the last row; %s)" % (label, off))
        n = cl(0, 0)
        bad_first = [(r, c) for r in range(ROWS) for c in (0,) if cl(r, c) != n]
        bad_last = [(r, c) for r in range(ROWS) for c in (COLS - 1,) if cl(r, c) != n]
        check(not bad_first and not bad_last,
              "%s every row's first AND last frame is the shared neutral" % label)
        badrows = [ROW_NAMES[r] for r in range(ROWS)
                   if cl(r, 1) == n or cl(r, 2) == n or cl(r, 1) == cl(r, 2)]
        check(not badrows, "%s each row has two distinct moving frames (%s)" % (label, badrows))
        ec = all(Q(c * CELL + x, r * CELL + y)[3] == 0
                 for r in range(ROWS) for c in range(COLS)
                 for x in (0, CELL - 1) for y in range(CELL))
        ec = ec and all(Q(c * CELL + x, r * CELL + y)[3] == 0
                        for r in range(ROWS) for c in range(COLS)
                        for y in (0,) for x in range(CELL))
        check(ec, "%s no frame bleeds sideways or upward" % label)

    base = os.path.dirname(HERE)
    contract(os.path.join(base, "img", "hero-pebble.png"), "the pebble golem sheet")
    contract(os.path.join(base, "img", "hero-ember.png"), "the ember wisp sheet")

    # --- the GEAR overlays: one 32x32 canvas each, the garment drawn at NATIVE
    #     size in the canvas's TOP-LEFT box (so the overlay renderer can scale it
    #     with the cell — see the `.gear-overlay` rule and tools/make_hero_gear.py).
    #     The set of declared sizes is cross-checked against js/engine.js in
    #     tools/test_hero_gear.py; here we pin the CANVAS + the origin anchoring.
    for name in ("gear-headband", "gear-belt"):
        gp = os.path.join(base, "img", name + ".png")
        check(os.path.exists(gp), "%s.png exists" % name)
        if not os.path.exists(gp):
            continue
        gi = Image.open(gp).convert("RGBA")
        gi.load()
        gb = list(gi.tobytes())

        def G(x, y):
            i = (y * CELL + x) * 4
            return (gb[i], gb[i + 1], gb[i + 2], gb[i + 3])

        check(gi.size == (CELL, CELL), "%s is one 32x32 cell (got %s)" % (name, str(gi.size)))
        ink = [(x, y) for y in range(CELL) for x in range(CELL) if G(x, y)[3] > 0]
        check(bool(ink), "%s carries ink" % name)
        # the giant filled the WHOLE cell; now the art is anchored at the origin so
        # `background-size: <cell>` shows exactly the garment, at its declared size.
        bx0 = min(p[0] for p in ink)
        by0 = min(p[1] for p in ink)
        bx1 = max(p[0] for p in ink)
        by1 = max(p[1] for p in ink)
        check(bx0 == 0 and by0 == 0,
              "%s art is anchored at the canvas ORIGIN (bbox starts %d,%d)" % (name, bx0, by0))
        # the garment is EXACTLY its declared size (kept in step with js/engine.js
        # HERO_ITEMS; tools/test_hero_gear.py checks the table against the art too)
        dw, dh = {"gear-headband": (14, 4), "gear-belt": (14, 3)}[name]
        check((bx1 - bx0 + 1, by1 - by0 + 1) == (dw, dh),
              "%s art bbox is exactly its declared %dx%d px (got %dx%d)"
              % (name, dw, dh, bx1 - bx0 + 1, by1 - by0 + 1))
        # everything outside the art's own box is transparent (a clean cut-out)
        clear = all(G(x, y)[3] == 0 for y in range(CELL) for x in range(CELL)
                    if x > bx1 or y > by1)
        check(clear, "%s keeps the canvas clear outside the garment box (no stray ink)" % name)

    print("\n%d passed, %d failed" % (pass_n, fail_n))
    return 1 if fail_n else 0


if __name__ == "__main__":
    sys.exit(main())
