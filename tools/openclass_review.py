#!/usr/bin/env python3
"""Per-exercise review of the audit's OPEN CLASS.

The class (218 rows): library entries whose tracking mode is weight_reps AND whose
equipment implies no external load ("none (bodyweight exercise)" or empty) AND whose
NAME the engine's bodyweight gate (BW_NAME / BW_FACTOR) does not recognise. For those,
`validSet` demands a load, so a reps-only or time-only log is SILENTLY DROPPED —
no volume, no XP, no PR.

Each row below was reviewed by hand: does a user actually log a LOAD for it?
  bodyweight-only : plainly bodyweight, or plainly performed for reps/time with no
                    load -> the fix is applied (mode -> reps/time, see engine rule).
  load-performed  : the name names its own load source (machine, cable, bar, bell,
                    band, plate, grip tool, foam/rolling tool resistance...). A
                    loadless log SHOULD be refused for these; leaving the mode is
                    correct, the empty equipment field is the only thing wrong.
  unresolvable    : the name and equipment genuinely cannot decide it (e.g. a barbell
                    lift whose equipment says "none", a routine rather than a movement)
                    -> left untouched, listed as a judgement call.

The verdict map is EXPLICIT (one line per id), not inferred, so a future edit cannot
silently shrink the sweep: REVIEWED_COUNT below pins len(VERDICTS).

    python3 tools/openclass_review.py            # write the table
    python3 tools/openclass_review.py --apply     # also write mode fixes to library.json
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB = json.load(open(ROOT / "data/library.json"))
BY_ID = {e["id"]: e for e in LIB}

# verdict, action  ->  action in {reps, time, none}
# reps/time = apply a MODE correction (this is what the user actually logs)
V = {
  # ---- Abs ----
  1573: ("bodyweight-only", "reps"), 1828: ("bodyweight-only", "reps"),
  1475: ("bodyweight-only", "reps"), 1409: ("bodyweight-only", "reps"),
  1286: ("bodyweight-only", "reps"), 235:  ("bodyweight-only", "reps"),
  1238: ("bodyweight-only", "time"), 1245: ("bodyweight-only", "time"),
  260:  ("bodyweight-only", "reps"), 2655: ("bodyweight-only", "reps"),
  1411: ("bodyweight-only", "reps"), 1248: ("bodyweight-only", "reps"),
  2555: ("bodyweight-only", "reps"), 1909: ("bodyweight-only", "reps"),
  2488: ("bodyweight-only", "reps"), 1287: ("bodyweight-only", "reps"),
  1374: ("load-performed",  "none"), 545:  ("bodyweight-only", "reps"),
  1477: ("bodyweight-only", "reps"), 1105: ("bodyweight-only", "reps"),
  1810: ("bodyweight-only", "time"), 2673: ("bodyweight-only", "time"),
  1259: ("bodyweight-only", "reps"), 1246: ("bodyweight-only", "reps"),
  1425: ("bodyweight-only", "reps"), 1377: ("bodyweight-only", "reps"),
  1474: ("bodyweight-only", "reps"), 2531: ("bodyweight-only", "time"),
  1103: ("bodyweight-only", "reps"), 1606: ("bodyweight-only", "reps"),
  # ---- Arms ----
  1280: ("load-performed",  "none"), 1424: ("load-performed",  "none"),
  958:  ("bodyweight-only", "reps"), 112:  ("bodyweight-only", "reps"),
  2734: ("load-performed",  "none"), 2733: ("load-performed",  "none"),
  2735: ("load-performed",  "none"), 2736: ("load-performed",  "none"),
  2737: ("load-performed",  "none"), 1223: ("bodyweight-only", "reps"),
  820:  ("bodyweight-only", "time"), 2638: ("load-performed",  "none"),
  2636: ("load-performed",  "none"), 2637: ("load-performed",  "none"),
  2738: ("load-performed",  "none"), 279:  ("load-performed",  "none"),
  2741: ("load-performed",  "none"), 2743: ("load-performed",  "none"),
  911:  ("load-performed",  "none"), 2633: ("load-performed",  "none"),
  1216: ("bodyweight-only", "reps"), 1114: ("bodyweight-only", "time"),
  2745: ("load-performed",  "none"), 598:  ("load-performed",  "none"),
  623:  ("load-performed",  "none"), 1266: ("bodyweight-only", "reps"),
  1261: ("bodyweight-only", "reps"), 1260: ("bodyweight-only", "reps"),
  661:  ("load-performed",  "none"), 1262: ("bodyweight-only", "reps"),
  2740: ("load-performed",  "none"), 1462: ("bodyweight-only", "reps"),
  # ---- Back ----
  1263: ("bodyweight-only", "reps"), 1005: ("bodyweight-only", "reps"),
  1082: ("load-performed",  "none"), 1363: ("bodyweight-only", "time"),
  1908: ("bodyweight-only", "reps"), 1006: ("bodyweight-only", "reps"),
  158:  ("load-performed",  "none"), 1004: ("bodyweight-only", "reps"),
  516:  ("load-performed",  "none"), 1018: ("bodyweight-only", "reps"),
  292:  ("bodyweight-only", "reps"), 1487: ("bodyweight-only", "reps"),
  1910: ("bodyweight-only", "reps"), 1471: ("load-performed",  "none"),
  354:  ("load-performed",  "none"), 355:  ("load-performed",  "none"),
  1514: ("bodyweight-only", "reps"), 380:  ("load-performed",  "none"),
  1822: ("bodyweight-only", "reps"), 2623: ("load-performed",  "none"),
  468:  ("bodyweight-only", "reps"), 1384: ("load-performed",  "none"),
  484:  ("load-performed",  "none"), 1119: ("load-performed",  "none"),
  1120: ("load-performed",  "none"), 1215: ("bodyweight-only", "reps"),
  1433: ("bodyweight-only", "reps"), 2747: ("bodyweight-only", "reps"),
  512:  ("load-performed",  "none"), 674:  ("bodyweight-only", "reps"),
  510:  ("load-performed",  "none"), 513:  ("load-performed",  "none"),
  1725: ("load-performed",  "none"), 2720: ("load-performed",  "none"),
  1210: ("bodyweight-only", "reps"), 959:  ("bodyweight-only", "reps"),
  1455: ("bodyweight-only", "reps"), 1834: ("bodyweight-only", "reps"),
  684:  ("load-performed",  "none"), 1381: ("unresolvable",    "none"),
  1083: ("bodyweight-only", "reps"),
  # ---- Calves ----
  146:  ("load-performed",  "none"), 1200: ("bodyweight-only", "reps"),
  # ---- Chest ----
  57:   ("bodyweight-only", "reps"), 135:  ("load-performed",  "none"),
  2702: ("load-performed",  "none"), 137:  ("load-performed",  "none"),
  129:  ("load-performed",  "none"), 1591: ("bodyweight-only", "time"),
  1831: ("load-performed",  "none"), 1508: ("load-performed",  "none"),
  539:  ("load-performed",  "none"), 1918: ("load-performed",  "none"),
  1773: ("load-performed",  "none"), 379:  ("load-performed",  "none"),
  2723: ("load-performed",  "none"), 926:  ("load-performed",  "none"),
  1904: ("load-performed",  "none"), 925:  ("load-performed",  "none"),
  1778: ("load-performed",  "none"),
  # ---- Legs ----
  1948: ("bodyweight-only", "reps"), 1096: ("bodyweight-only", "reps"),
  1141: ("bodyweight-only", "reps"), 1935: ("load-performed",  "none"),
  977:  ("unresolvable",    "none"), 124:  ("unresolvable",    "none"),
  1407: ("bodyweight-only", "reps"), 1201: ("bodyweight-only", "reps"),
  1653: ("load-performed",  "none"), 1391: ("bodyweight-only", "reps"),
  1528: ("load-performed",  "none"), 1723: ("load-performed",  "none"),
  1392: ("unresolvable",    "none"), 1414: ("load-performed",  "none"),
  2717: ("load-performed",  "none"), 1398: ("bodyweight-only", "reps"),
  1387: ("bodyweight-only", "reps"), 291:  ("bodyweight-only", "reps"),
  1906: ("bodyweight-only", "reps"), 1863: ("bodyweight-only", "reps"),
  1846: ("bodyweight-only", "time"), 990:  ("bodyweight-only", "reps"),
  1325: ("bodyweight-only", "reps"), 364:  ("load-performed",  "none"),
  365:  ("load-performed",  "none"), 366:  ("load-performed",  "none"),
  2708: ("load-performed",  "none"), 367:  ("load-performed",  "none"),
  369:  ("load-performed",  "none"), 2709: ("load-performed",  "none"),
  371:  ("load-performed",  "none"), 1515: ("load-performed",  "none"),
  375:  ("load-performed",  "none"), 373:  ("load-performed",  "none"),
  374:  ("load-performed",  "none"), 1949: ("unresolvable",    "none"),
  1748: ("load-performed",  "none"), 1132: ("load-performed",  "none"),
  1965: ("bodyweight-only", "reps"), 441:  ("load-performed",  "none"),
  1464: ("load-performed",  "none"), 1521: ("load-performed",  "none"),
  1527: ("load-performed",  "none"), 1208: ("bodyweight-only", "reps"),
  2620: ("load-performed",  "none"), 1954: ("bodyweight-only", "reps"),
  1952: ("bodyweight-only", "time"), 1672: ("unresolvable",    "none"),
  2718: ("unresolvable",    "none"), 12:   ("unresolvable",    "none"),
  2699: ("unresolvable",    "none"), 2664: ("unresolvable",    "none"),
  1845: ("bodyweight-only", "reps"), 1739: ("bodyweight-only", "reps"),
  1195: ("bodyweight-only", "reps"), 71:   ("load-performed",  "none"),
  1388: ("unresolvable",    "none"), 2677: ("load-performed",  "none"),
  2667: ("bodyweight-only", "time"), 2616: ("bodyweight-only", "time"),
  1294: ("unresolvable",    "none"), 1963: ("bodyweight-only", "reps"),
  1747: ("load-performed",  "none"), 1576: ("unresolvable",    "none"),
  604:  ("load-performed",  "none"), 2645: ("bodyweight-only", "reps"),
  616:  ("bodyweight-only", "reps"), 341:  ("load-performed",  "none"),
  1396: ("bodyweight-only", "time"), 1397: ("bodyweight-only", "time"),
  630:  ("load-performed",  "none"), 632:  ("unresolvable",    "none"),
  1803: ("load-performed",  "none"), 1196: ("bodyweight-only", "reps"),
  718:  ("bodyweight-only", "time"),
  # ---- Shoulders ----
  915:  ("load-performed",  "none"), 139:  ("load-performed",  "none"),
  2703: ("load-performed",  "none"), 2694: ("bodyweight-only", "time"),
  1833: ("bodyweight-only", "reps"), 254:  ("load-performed",  "none"),
  1007: ("bodyweight-only", "reps"), 289:  ("load-performed",  "none"),
  1914: ("bodyweight-only", "time"), 1744: ("load-performed",  "none"),
  1775: ("load-performed",  "none"), 478:  ("load-performed",  "none"),
  543:  ("load-performed",  "none"), 2711: ("load-performed",  "none"),
  569:  ("load-performed",  "none"), 570:  ("bodyweight-only", "reps"),
  575:  ("load-performed",  "none"), 578:  ("load-performed",  "none"),
  1916: ("bodyweight-only", "time"), 1679: ("bodyweight-only", "reps"),
  2454: ("bodyweight-only", "reps"),
}

REVIEWED_COUNT = 218
WHAT = {
  "reps":  "reps (no external load)",
  "time":  "hold seconds (no external load)",
  "none":  "weight x reps (stack / plate / bell / band)",
}

def class_ids():
    LIB2 = json.load(open(ROOT / "data/library.json"))
    return LIB2

def compute_class(engine_bw_recognised):
    """Ids matching the OPEN CLASS, using the engine's own gate result."""
    out = []
    for e in LIB:
        mode = e.get("m") or "weight_reps"
        equip = "|".join(e.get("e") or [])
        noload = (not e.get("e")) or all(("none" in x or "bodyweight" in x) for x in e.get("e"))
        if mode == "weight_reps" and noload and e["id"] not in engine_bw_recognised:
            out.append(e["id"])
    return out

def main():
    apply = "--apply" in sys.argv
    ids = sorted(V)
    if len(ids) != REVIEWED_COUNT:
        sys.exit(f"REVIEWED_COUNT mismatch: {len(ids)} verdicts, expected {REVIEWED_COUNT}")
    missing = [i for i in ids if i not in BY_ID]
    if missing:
        sys.exit(f"verdict ids not in library: {missing}")

    rows = []
    for i in ids:
        e = BY_ID[i]
        verdict, action = V[i]
        change = "none" if action == "none" else f"mode -> {action}"
        rows.append({
            "id": i, "name": e["n"], "category": e["c"],
            "equipment": "|".join(e.get("e") or []) or "(empty)",
            "mode_before": e.get("m") or "weight_reps",
            "what_user_logs": WHAT[action] if action != "none" else WHAT["none"],
            "verdict": verdict, "change_made": change,
        })

    # TSV table (library data only — no personal data)
    tsv = ROOT / "tools/library-openclass-review.tsv"
    cols = ["id", "name", "category", "equipment", "mode_before", "what_user_logs", "verdict", "change_made"]
    with open(tsv, "w") as f:
        f.write("\t".join(cols) + "\n")
        for r in rows:
            f.write("\t".join(str(r[c]) for c in cols) + "\n")
    print(f"wrote {tsv}  ({len(rows)} rows)")

    from collections import Counter
    vc = Counter(r["verdict"] for r in rows)
    ac = Counter(V[i][1] for i in ids)
    print("verdicts :", dict(vc))
    print("actions  :", dict(ac))

    if apply:
        changed = 0
        for i in ids:
            verdict, action = V[i]
            if action in ("reps", "time"):
                e = BY_ID[i]
                if e.get("m") != action:      # already corrected in a prior sweep
                    e["m"] = action
                    changed += 1
        json.dump(LIB, open(ROOT / "data/library.json", "w"),
                  ensure_ascii=False, separators=(",", ":"))
        print(f"applied: {changed} mode corrections written to data/library.json")

if __name__ == "__main__":
    main()
