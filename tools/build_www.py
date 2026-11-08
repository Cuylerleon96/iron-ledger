#!/usr/bin/env python3
"""Assemble the web assets that ship inside the APK.

Only runtime files are copied. Source tooling, the raw wger dump, tests and
node_modules deliberately stay out of the bundle.
"""
import shutil
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
www = root / "www"

if www.exists():
    shutil.rmtree(www)
www.mkdir()

for f in ("index.html", "manifest.webmanifest"):
    shutil.copy2(root / f, www / f)

for d in ("css", "js", "fonts", "icons"):
    shutil.copytree(root / d, www / d)

files = [p for p in www.rglob("*") if p.is_file()]
total = sum(p.stat().st_size for p in files)
print(f"www/ built: {len(files)} files, {total/1024:.0f} KB")
for p in sorted(files):
    print(f"  {p.relative_to(root)}  {p.stat().st_size/1024:.1f} KB")
