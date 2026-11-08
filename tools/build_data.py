#!/usr/bin/env python3
"""Regenerate js/data.js from data/library.json.
library.json comes from the wger API, with thin/empty form cues gap-filled from
yuhonas/free-exercise-db (public domain) — see tools/fetch_wger.py."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
lib = json.load(open(root / "data/library.json"))
fedb = sum(1 for e in lib if e.get("f"))
out = root / "js/data.js"
with open(out, "w") as f:
    f.write(f"/* Exercise library — {len(lib)} movements from the wger open database (CC-BY-SA).\n")
    f.write(f"   {fedb} thin/empty form cues gap-filled from free-exercise-db "
            "(public domain, Unlicense).\n")
    f.write("   Generated from data/library.json by tools/build_data.py. Do not hand-edit.\n")
    f.write("   Fields: id, n=name, c=category, p=primary muscles, s=secondary muscles,\n")
    f.write("           e=equipment, m=tracking mode, g=radar muscle groups,\n")
    f.write("           d=form cue (steps separated by \\n), f=1 if the cue is from free-exercise-db. */\n")
    f.write("const EXERCISE_LIB = " + json.dumps(lib, separators=(",", ":")) + ";\n")
print("wrote", out, len(open(out).read()), "bytes")
