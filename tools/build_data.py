#!/usr/bin/env python3
"""Regenerate js/data.js from data/library.json.
library.json comes from the wger API, with thin/empty form cues gap-filled from
yuhonas/free-exercise-db (public domain) — see tools/fetch_wger.py.

The movement COUNT is DERIVED from the data here, never typed by hand: the
js/data.js header and the README's library size are both written from len(lib),
so the two can never drift from library.json again (a hand-kept "930" sat in the
README while the library had grown to 954)."""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
lib = json.load(open(root / "data/library.json"))
count = len(lib)
fedb = sum(1 for e in lib if e.get("f"))
out = root / "js/data.js"
with open(out, "w") as f:
    f.write(f"/* Exercise library — {count} movements from the wger open database (CC-BY-SA).\n")
    f.write(f"   {fedb} thin/empty form cues gap-filled from free-exercise-db "
            "(public domain, Unlicense).\n")
    f.write("   Generated from data/library.json by tools/build_data.py. Do not hand-edit.\n")
    f.write("   Fields: id, n=name, c=category, p=primary muscles, s=secondary muscles,\n")
    f.write("           e=equipment, m=tracking mode, g=radar muscle groups,\n")
    f.write("           d=form cue (steps separated by \\n), f=1 if the cue is from free-exercise-db. */\n")
    f.write("const EXERCISE_LIB = " + json.dumps(lib, separators=(",", ":")) + ";\n")
print("wrote", out, len(open(out).read()), "bytes")

# Keep the README's stated library size in step with the data, derived not typed.
readme = root / "README.md"
text = readme.read_text()
synced = re.sub(r"\b\d+-exercise library", f"{count}-exercise library", text)
synced = re.sub(r"\b\d+ movements\b", f"{count} movements", synced)
synced = re.sub(r"\(\d+ exercises\)", f"({count} exercises)", synced)
if synced != text:
    readme.write_text(synced)
    print(f"README: library size synced to {count}")
else:
    print(f"README: already says {count}")
