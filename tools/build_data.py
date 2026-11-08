#!/usr/bin/env python3
"""Regenerate js/data.js from data/library.json.
library.json comes from the wger API (see tools/fetch_wger.py)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
lib = json.load(open(root/"data/library.json"))
out = root/"js/data.js"
with open(out,"w") as f:
    f.write("/* Exercise library — 930 movements from the wger open database (CC-BY-SA).\n")
    f.write("   Generated from data/library.json by tools/build_data.py. Do not hand-edit.\n")
    f.write("   Fields: id, n=name, c=category, p=primary muscles, s=secondary muscles,\n")
    f.write("           e=equipment, m=tracking mode, g=radar muscle groups, d=form cue. */\n")
    f.write("const EXERCISE_LIB = " + json.dumps(lib, separators=(",",":")) + ";\n")
print("wrote", out, len(open(out).read()), "bytes")
