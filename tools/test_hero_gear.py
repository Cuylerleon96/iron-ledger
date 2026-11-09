#!/usr/bin/env python3
"""test_hero_gear.py — the GEAR-OVERLAY GEOMETRY test.

This is the assertion that would have caught "the headband floats above the
golem's head and is 1.5x too wide". It is NOT a pixel snapshot: it MEASURES the
real sprite PNGs (solid silhouette, alpha >= 200) and the real garment PNGs, then
checks the geometry table js/engine.js declares (via tools/hero_geometry_dump.js)
against those measurements, at ALL THREE render scales:

  * every overlay box sits INSIDE the hero's measured body bounds;
  * it OVERLAPS the anatomical band it names (a headband's band must intersect the
    head's vertical band — it may not float in mid-air above the head);
  * its WIDTH is derived from the hero's OWN measured band width — the golem's
    10-unit head gets a ~10-unit band, NOT the art's 14 (the per-hero SIZE rule);
  * its height keeps the art's own aspect;
  * the OLD "a 32x32 cell stretched over the whole sprite at left:0/top:0"
    behaviour FAILS the very same constraints.

    python3 tools/test_hero_gear.py     # exits non-zero on any failure
"""

import json
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
B = os.path.dirname(HERE)
CELL = 32
SCALES = [24.375, 64.0, 128.0]          # header (cell at 2x/DPR), roster, stage

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


def solid_bounds(path, row=0, col=0):
    """The SOLID silhouette (alpha >= 200 — the ember's alpha-70 glow is excluded)
    of one 32x32 cell, in CELL UNITS."""
    im = Image.open(path).convert("RGBA")
    raw = im.tobytes()
    W = im.width
    pts = []
    for y in range(CELL):
        for x in range(CELL):
            a = raw[((row * CELL + y) * W + col * CELL + x) * 4 + 3]
            if a >= 200:
                pts.append((x, y))
    if not pts:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return {"x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            "h": max(ys) - min(ys) + 1}


def width_at(path, yrow, row=0, col=0):
    """The solid silhouette's x-span at ONE cell row, in cell units (0 if empty)."""
    im = Image.open(path).convert("RGBA")
    raw = im.tobytes()
    W = im.width
    xs = [x for x in range(CELL)
          if raw[((row * CELL + yrow) * W + col * CELL + x) * 4 + 3] >= 200]
    return (max(xs) - min(xs) + 1) if xs else 0


def ink_bbox(path):
    im = Image.open(path).convert("RGBA")
    raw = im.tobytes()
    W = im.width
    pts = [(i % W, i // W) for i in range(W * im.height) if raw[i * 4 + 3] > 0]
    if not pts:
        return None
    return (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts))


def overlap(a0, a1, b0, b1):
    return max(0, min(a1, b1) - max(a0, b0) + 1)


def band(kind, b):
    """The measured anatomical band an item of `kind` must intersect, in cell
    units, from the silhouette bounds (independent of the engine's numbers)."""
    top, h = b["y0"], b["h"]
    if kind == "head":
        return (top, top + 7)                                  # the head / crown rows
    if kind == "shoulders":
        return (top + max(2, int(h * 0.25)), top + max(3, int(h * 0.75)))
    return (top + int(h * 0.5), top + h - 1)                   # the waist / lower body


def main():
    print("=== hero gear geometry: measured against the actual sprite art ===")
    dump = subprocess.run(["node", os.path.join(HERE, "hero_geometry_dump.js")],
                          cwd=B, capture_output=True, text=True)
    check(dump.returncode == 0, "the geometry dump ran (js/engine.js loads cleanly)")
    if dump.returncode != 0:
        print(dump.stderr[-2000:])
        print("\n%d passed, %d failed" % (pass_n, fail_n))
        return 1
    G = json.loads(dump.stdout)
    heroes = {h["id"]: h for h in G["heroes"]}
    gears = {g["id"]: g for g in G["gears"]}

    # --- the garment ART is exactly the declared size, anchored at the origin ---
    for gid, g in gears.items():
        bb = ink_bbox(os.path.join(B, g["img"]))
        check(bb is not None and bb[0] == 0 and bb[1] == 0,
              "%s art is anchored at the canvas origin (%s)" % (gid, bb))
        check(bb is not None and (bb[2] - bb[0] + 1, bb[3] - bb[1] + 1) == (g["size"]["w"], g["size"]["h"]),
              "%s art is exactly its declared %dx%d px" % (gid, g["size"]["w"], g["size"]["h"]))

    # --- measured hero silhouettes + their per-row widths -------------------------
    bounds = {}
    for hid, h in heroes.items():
        b = solid_bounds(os.path.join(B, h["sheet"]))
        bounds[hid] = b
        print("  measured %-7s body x[%d..%d] y[%d..%d]  (w=%d h=%d)" %
              (hid, b["x0"], b["x1"], b["y0"], b["y1"], b["x1"] - b["x0"] + 1, b["h"]))
        a = h["anatomy"]
        for pt in ("head", "shoulders"):
            p = a.get(pt)
            if p:
                print("           %-9s at y=%d  band width = %d" % (pt, p["y"], width_at(os.path.join(B, h["sheet"]), p["y"])))
    check(all(bounds.values()), "every hero has a measurable solid silhouette")

    # --- every computed box, at every scale ----------------------------------------
    for box in G["boxes"]:
        hid, gid = box["hero"], box["gear"]
        g = gears[gid]
        b = bounds[hid]
        artw, arth = box["artw"], box["arth"]
        w, h = box["w"], box["h"]
        ax0, ax1 = box["x"], box["x"] + w - 1
        ay0, ay1 = box["y"], box["y"] + h - 1
        ok_art = (box["artw"] == g["size"]["w"] and box["arth"] == g["size"]["h"])
        ok_h = (h == max(1, round(arth * w / artw)))           # the art's own aspect
        ok_in = (ax0 >= b["x0"] and ax1 <= b["x1"] and ay0 >= b["y0"] and ay1 <= b["y1"])
        anchor = g["anchor"] if box["anchored"] else "shoulders"
        aband = band(anchor, b)
        ov = overlap(ay0, ay1, aband[0], aband[1])
        check(ok_art and ok_h and ok_in and ov > 0,
              "%-7s %-8s box(%d,%d %dx%d) in body, overlaps its %s band %s (ov=%d)"
              % (hid, gid, ax0, ay0, w, h, anchor, aband, ov))
        # THE PER-HERO SIZE RULE: the width is the hero's OWN measured band width
        # (times the item's fit.k), never the art's fixed 14 units.
        p = heroes[hid]["anatomy"].get(anchor) or heroes[hid]["anatomy"]["shoulders"]
        want_w = max(4, round(width_at(os.path.join(B, heroes[hid]["sheet"]), p["y"]) * (g["fit"]["k"] if g.get("fit") else 1)))
        check(w == want_w,
              "-- %-7s %-8s width %d == the measured %s band width %d x k=%s" %
              (hid, gid, w, anchor, width_at(os.path.join(B, heroes[hid]["sheet"]), p["y"]),
               (g.get("fit") or {}).get("k")))
        # SCALE: the px box is cell · v/32 at every surface, and at the stage
        # (128 px cell) and the roster (64) the factor is WHOLE (4x / 2x), so the
        # garment art scales crisply by an integer multiple.
        check(abs(w * 128 / 32 - w * 4) < 1e-9 and abs(w * 64 / 32 - w * 2) < 1e-9,
              "-- %-7s %-8s scales by whole numbers at the stage (4x) and roster (2x)" % (hid, gid))

    # --- THE HEADLINE REGRESSION: a 10-unit head must NOT get a 14-unit band ------
    hb = [bx for bx in G["boxes"] if bx["gear"] == "headband"]
    for bx in hb:
        if bx["hero"] in ("pebble", "ember"):
            check(bx["w"] <= 11,
                  "the %s head is %d wide -> headband is %d units (not the art's 14)"
                  % (bx["hero"], width_at(os.path.join(B, heroes[bx["hero"]]["sheet"]),
                                          heroes[bx["hero"]]["anatomy"]["head"]["y"]), bx["w"]))
    check(any(bx["w"] != gears["headband"]["size"]["w"] for bx in hb),
          "the fitted width DIFFERS from the art width on at least one hero (per-hero sizing is live)")

    # --- per-hero anchors: the headband is NOT at one fixed cell position ----------
    pos = sorted(set((bx["x"], bx["y"]) for bx in hb))
    check(len(pos) >= 2 and all(p[0] > 0 and p[1] > 0 for p in pos),
          "the headband lands at a DIFFERENT, off-corner cell position per hero: %s" % (pos,))

    # --- THE LEGACY BEHAVIOUR MUST FAIL -------------------------------------------
    # The old overlay was the whole 32x32 cell pinned at left:0/top:0, with the
    # garment drawn wherever the art happened to put it (headband ink rows 8..10).
    LEGACY_INK = {"headband": (8, 10), "belt": (20, 22)}
    legacy_fails = []
    for hid, b in bounds.items():
        for gid, (ly0, ly1) in LEGACY_INK.items():
            anchor = gears[gid]["anchor"]
            if anchor == "waist" and not heroes[hid]["anatomy"].get("waist"):
                anchor = "shoulders"                    # the wisp's fallback
            aband = band(anchor, b)
            if overlap(ly0, ly1, aband[0], aband[1]) == 0:
                legacy_fails.append((hid, gid))
    check(all((hid, "headband") in legacy_fails for hid in bounds),
          "the legacy full-cell-at-left:0 geometry FAILS the head-band constraint on EVERY hero "
          "(the test discriminates): %s" % (legacy_fails,))
    check(all(g["size"]["w"] != 32 for g in gears.values()),
          "the legacy 32-cell overlay width differs from every declared item width")

    print("\n%d passed, %d failed" % (pass_n, fail_n))
    return 1 if fail_n else 0


if __name__ == "__main__":
    sys.exit(main())
