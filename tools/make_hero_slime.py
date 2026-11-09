#!/usr/bin/env python3
"""make_hero_slime.py — draw the PLACEHOLDER hero sprite sheet.

the owner's hand-drawn sprites replace this. It exists so the header harness
(js/hero.js) has a real `img/hero-sheet.png` to render: 128x192 native px =
4 columns x 6 rows of 32x32 GBA cells.

    row 0  idle       breathe + blink
    row 1  walk       ONE cycle (a bob/waddle — the slime has no legs)
    row 2  pickup     bend down, grab the dumbbell
    row 3  lift-a     a CURL with the dumbbell
    row 4  lift-b     an OVERHEAD PRESS with the dumbbell
    row 5  celebrate  a hop with sparkles

The art lives HERE, in code, not in a binary blob: every frame is a SPEC in the
POSES table below (silhouette radii, a vertical offset, an eye pose, an arm pose
and an optional dumbbell prop), rasterised with hard-edged (un-antialiased)
coverage so it stays pixel art. Palette is a green slime plus a steel dumbbell —
deliberately NOT the app's gold/ink, so it reads as a creature on the dark-blue
header, not a UI chip.

TRANSITION CONSTRAINT (the whole point): every row STARTS and ENDS on the SAME
shared NEUTRAL standing pose (NEUTRAL below), grounded on the cell's LAST row.
Any behaviour can therefore follow any other with no pop. build_sheet() enforces
this by stamping the ONE neutral cell at column 0 and column 3 of EVERY row, and
tools/test_hero_sheet.py proves the first and last frame of every row are
pixel-identical to it.

    python3 tools/make_hero_slime.py            # writes img/hero-sheet.png
    python3 tools/make_hero_slime.py --ascii     # + a terminal preview

Pure, deterministic, stdlib + Pillow (already a repo tool dependency).
"""

import os
import sys

from PIL import Image

CELL = 32                      # one GBA sprite cell, native px
COLS, ROWS = 4, 6              # 4 animation frames x 6 animations
W, H = COLS * CELL, ROWS * CELL            # 128 x 192

# --- palette: a handful of colours, tuned to sit on the dark-blue header -----
# (the header is a #1a4a78 -> #10305a gradient; these greens read as a creature)
OUTLINE = (10, 30, 20, 255)          # dark green rim
INK_SHADOW = (8, 18, 32, 255)        # the GROUND-CONTACT shadow drawn on the base
                                     # row: a darker blue ink than the header's own
                                     # blue (#10305a) and than the green rim, so the
                                     # contact with the floor reads at 1x and in a
                                     # zoom. Still a blue/ink tone, not a new hue.
DARK     = (28, 122, 66, 255)        # shaded lower-right of the body
MID      = (52, 186, 100, 255)       # body
LITE     = (112, 226, 150, 255)      # lit upper-left of the body
GLINT    = (198, 250, 214, 255)      # small body highlight
EYE      = (9, 22, 30, 255)          # dark (blue-black) eyes
WHITE    = (240, 250, 255, 255)      # eye glint
SPARK    = (255, 233, 138, 255)      # celebration sparkles (app-gold accent)
# the dumbbell PROP: a cool steel, so it reads as a metal object on the blue
# header and is clearly not the green slime body. Two tones + the shared rim.
DB_LITE  = (206, 216, 228, 255)
DB_MID   = (150, 164, 182, 255)
DB_DARK  = (96, 112, 134, 255)

GROUND_ROW = CELL - 1          # the cell's LAST row = the floor contact row. The
                               # dome's flat base is drawn ON this row (y <= cy), so
                               # every frame touches the same pixel row and that row
                               # IS the cell's bottom edge. css/style.css bottom-
                               # aligns the cell on the topbar's cream border, so
                               # that border line is literally the floor it stands
                               # on: no gap, and no empty rows under the base.
BASE_Y = GROUND_ROW            # cy for a GROUNDED frame; a hop lifts cy by |dy| and
                               # comes back to it (the contact shadow stays behind
                               # on GROUND_ROW, so leaving the ground is visible).

# --- THE SHARED NEUTRAL STANDING POSE ----------------------------------------
# Row 0 col 0 and col 3, and every other row's col 0 and col 3, are THIS pose,
# stamped byte-for-byte by build_sheet(). Grounded (dy=0, base on GROUND_ROW),
# arms down, eyes open. It is the seam every behaviour chains through.
NEUTRAL = {"sx": 11.5, "sy": 15.0, "dy": 0, "eyes": "open", "arms": "down",
           "prop": None, "sparkle": False}

# --- pose table --------------------------------------------------------------
# One entry per cell, in sheet order (row-major, 4 per row). cols 0 and 3 of
# every row are replaced by NEUTRAL in build_sheet(); the two entries in the
# middle of each row are the moving beats. Kept here so the table stays
# readable: a row of Nones means "neutral / neutral" (see note at the end).
def _p(sx, sy, dy, eyes, arms, prop=None, sparkle=False):
    return {"sx": sx, "sy": sy, "dy": dy, "eyes": eyes, "arms": arms,
            "prop": prop, "sparkle": sparkle}


N = dict(NEUTRAL)
POSES = [
    # --- row 0: idle, a breathing cycle with a blink --------------------------
    N,
    _p(10.5, 16.5, 0, "open",  "down"),       # inhale: taller, narrower
    _p(11.5, 15.0, 0, "blink", "down"),       # rest + blink
    N,
    # --- row 1: walk, ONE cycle (bob step / squash step) ---------------------
    N,
    _p(10.8, 16.2, -2, "open", "down"),       # step: rises, narrows
    _p(13.0, 13.0,  0, "open", "down"),       # step: falls, squashes wide
    N,
    # --- row 2: pickup, bend down -> grab the dumbbell ------------------------
    N,
    _p(13.0, 10.5,  0, "open",  "reach", "ground"),   # bend over, reach the floor
    _p(10.5, 15.5, -1, "happy", "tuck",  "chest-low"),  # rose, dumbbell held in
    N,
    # --- row 3: lift-a, a CURL with the dumbbell -----------------------------
    N,
    _p(11.0, 14.5,  0, "open",  "curl", "chest-low"),   # curl down
    _p(10.5, 15.5,  0, "happy", "curl", "chest-high"),  # curl up, squeezed
    N,
    # --- row 4: lift-b, an OVERHEAD PRESS ------------------------------------
    N,
    _p(13.0, 11.0,  0, "open",  "press", "shoulders"),  # crouch, load to shoulders
    _p(10.0, 17.0, -2, "happy", "press", "overhead"),   # press up overhead
    N,
    # --- row 5: celebrate, a hop with sparkles -------------------------------
    N,
    _p(13.0, 11.2,  0, "open",  "down"),                # crouch before the hop
    _p(10.2, 15.6, -6, "happy", "up", None, True),      # leap + sparkles
    N,
]
assert len(POSES) == COLS * ROWS, "the pose table must cover every cell"


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


def arms_px(arms, cx, cy, sx, sy):
    """The arm stubs for a named pose, as a pixel set (unclipped). Arms may
    reach BELOW the dome's flat base (down to the floor) so a bend / grab reads,
    but never into the outer columns — the caller clips to the cell."""
    px = set()
    for sgn in (-1, 1):
        if arms in (None, "down"):
            px |= capsule((cx + sgn * sx * 0.80, cy - sy * 0.28),
                          (cx + sgn * sx * 0.95, cy + sy * 0.18), 2.2)
        elif arms == "up":                       # raised high, out to the side
            px |= capsule((cx + sgn * sx * 0.90, cy - sy * 0.15),
                          (cx + sgn * sx * 1.12, cy - sy * 0.62), 2.4)
        elif arms == "reach":                    # straight DOWN toward the floor
            px |= capsule((cx + sgn * sx * 0.82, cy - sy * 0.10),
                          (cx + sgn * sx * 0.55, GROUND_ROW - 1), 2.2)
        elif arms == "tuck":                     # in front, holding the weight in
            px |= capsule((cx + sgn * sx * 0.85, cy - sy * 0.22),
                          (cx + sgn * sx * 0.34, cy + sy * 0.02), 2.4)
        elif arms == "curl":                     # elbows out, forearms up
            px |= capsule((cx + sgn * sx * 0.92, cy - sy * 0.12),
                          (cx + sgn * sx * 0.42, cy - sy * 0.34), 2.4)
        elif arms == "press":                    # straight up overhead
            px |= capsule((cx + sgn * sx * 0.80, cy - sy * 0.22),
                          (cx + sgn * sx * 0.52, cy - sy * 1.18), 2.2)
    return px


def draw_dumbbell(cell, cxp, cyp, over=True):
    """Draw a small steel dumbbell centred at (cxp, cyp): a bar with a 4-tall
    weight block each end. `over=True` paints it ON TOP of the body (a HELD
    weight, in the hands / in front of the chest); `over=False` paints it only
    where the cell is still empty, so the body occludes it (a weight ON THE
    FLOOR, peeking out beside the slime). Stays inside the cell."""
    cxp, cyp = int(round(cxp)), int(round(cyp))

    def put(x, y, rgba):
        if 0 <= x < CELL and 0 <= y < CELL and (over or (x, y) not in cell):
            cell[(x, y)] = rgba

    # weight blocks (2 wide x 4 tall) at each end, bar (5 long x 2) between
    ends = [(cxp - 5, cxp - 4), (cxp + 4, cxp + 5)]
    for (xa, xb) in ends:
        for x in range(xa, xb + 1):
            for y in range(cyp - 2, cyp + 2):
                lit = (x <= xa or y <= cyp - 2)
                put(x, y, DB_LITE if lit else DB_MID)
        for x in range(xa, xb + 1):              # block rim (top/bottom rows)
            for y in (cyp - 2, cyp + 1):
                put(x, y, DB_DARK)
    for x in range(cxp - 3, cxp + 4):            # the bar
        put(x, cyp, DB_LITE if x <= cxp else DB_MID)
        put(x, cyp + 1, DB_DARK)


PROP_AT = {
    # prop name -> (x, y) in cell coords. `ground` is on the floor beside the
    # slime (drawn UNDER, so the body occludes the part it hides behind); the
    # rest are held (drawn OVER, so the bar reads across the chest/overhead).
    "ground":     lambda cx, cy, sx, sy: (cx + 9.0, GROUND_ROW - 2.5),
    "hand-low":   lambda cx, cy, sx, sy: (cx, cy + sy * 0.02),
    "chest-low":  lambda cx, cy, sx, sy: (cx, cy - sy * 0.20),
    "chest-high": lambda cx, cy, sx, sy: (cx, cy - sy * 0.46),
    "shoulders":  lambda cx, cy, sx, sy: (cx, cy - sy * 0.60),
    "overhead":   lambda cx, cy, sx, sy: (cx, cy - sy * 1.30),
}
PROP_OVER = {"ground": False}          # everything else is held, drawn on top


def draw_frame(spec):
    """Return the 32x32 cell as a dict (x, y) -> RGBA."""
    sx, sy, dy = spec["sx"], spec["sy"], spec["dy"]
    eyes, arms, prop = spec["eyes"], spec["arms"], spec["prop"]
    cx, cy = CELL / 2.0, BASE_Y + dy

    # dome, clipped to the upper half so its base is FLAT at cy (an airborne
    # frame lifts cy, leaving empty rows beneath it — the hop reads).
    dome = {(x, y) for (x, y) in ellipse(cx, cy, sx, sy) if 0 <= x < CELL and 0 <= y <= cy}
    # arms are clipped to the cell (they may reach down to the floor), which is
    # what lets a bend/grab read below the dome's base.
    arm = {(x, y) for (x, y) in arms_px(arms, cx, cy, sx, sy) if 0 <= x < CELL and 0 <= y <= GROUND_ROW}
    body = dome | arm
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

    # the dumbbell PROP (held props are drawn AFTER/OVER the body so the bar
    # reads across the chest or overhead; the floor prop is drawn UNDER so the
    # body occludes the part behind it).
    if prop:
        px_, py_ = PROP_AT[prop](cx, cy, sx, sy)
        draw_dumbbell(cell, px_, py_, over=PROP_OVER.get(prop, True))

    if spec["sparkle"]:
        for (sxp, syp) in SPARK_AT:
            for p in [(sxp, syp), (sxp - 1, syp), (sxp + 1, syp),
                      (sxp, syp - 1), (sxp, syp + 1)]:
                if 0 <= p[0] < CELL and 0 <= p[1] < CELL and p not in cell:
                    cell[p] = SPARK

    # --- the GROUND CONTACT: a small shadow ON the cell's last row ------------
    # Drawn at the SAME row in every frame (the floor is level) and it is the
    # ONLY ink left on that row while the body is airborne — so a hop visibly
    # LEAVES the ground and lands back on the same row.
    half = max(3, int(round(sx * (0.35 if dy == 0 else 0.28))))
    for x in range(int(cx - half), int(cx + half) + 1):
        if 0 <= x < CELL:
            cell[(x, GROUND_ROW)] = INK_SHADOW
    base_xs = [x for (x, y) in dome if y == GROUND_ROW]
    if base_xs:                      # grounded: a 1px shadow lip outside the base
        for x in (min(base_xs) - 1, max(base_xs) + 1):
            if 1 <= x <= CELL - 2:   # never in the outer column (no cell bleed)
                cell[(x, GROUND_ROW)] = INK_SHADOW
    return cell


# sparkles are drawn only on the celebrate leap frame, at fixed cell coordinates
SPARK_AT = [(4, 6), (27, 9), (8, 2), (24, 4)]


def build_sheet():
    """Assemble the sheet. ENFORCES the neutral seam: column 0 and the LAST
    column (3) of EVERY row are the ONE shared NEUTRAL cell, byte-for-byte, so
    any behaviour can follow any other with no pop."""
    neutral_cell = draw_frame(NEUTRAL)
    sheet = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i, spec in enumerate(POSES):
        row, col = divmod(i, COLS)
        cell = neutral_cell if col in (0, COLS - 1) else draw_frame(spec)
        for (x, y), rgba in cell.items():
            sheet.putpixel((col * CELL + x, row * CELL + y), rgba)
    return sheet


def ascii_preview(sheet):
    """One character per pixel so the frames can be judged in a terminal."""
    glyph = {OUTLINE: "#", DARK: "+", MID: "o", LITE: "*",
             GLINT: "@", EYE: "e", WHITE: ".", SPARK: "x", INK_SHADOW: "s",
             DB_LITE: "=", DB_MID: "-", DB_DARK: ":"}
    for i, spec in enumerate(POSES):
        row, col = divmod(i, COLS)
        print("  cell %d (row %d, col %d)" % (i, row, col))
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
    for i, spec in enumerate(POSES):
        row, col = divmod(i, COLS)
        n = sum(1 for y in range(CELL) for x in range(CELL)
                if sheet.getpixel((col * CELL + x, row * CELL + y))[3] > 0)
        print("  cell %2d row %d col %d ink=%d" % (i, row, col, n))
    if "--ascii" in sys.argv:
        ascii_preview(sheet)
    return 0


if __name__ == "__main__":
    sys.exit(main())
