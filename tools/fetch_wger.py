#!/usr/bin/env python3
"""Rebuild data/library.json from the wger open exercise database.

Run this to refresh the exercise library when wger adds movements, then run
`python3 tools/build_data.py` to regenerate js/data.js.

    python3 tools/fetch_wger.py && python3 tools/build_data.py

wger quirks this handles:
  * `/exercise/` returns NO names — they live in `/exerciseinfo/` under
    `translations` (filter `language == 2` for English).
  * On `/exerciseinfo/` the `category`, `muscles` and `equipment` fields come
    back as full objects; on `/exercise/` they are bare ids. Normalise both.
  * The library is CC-BY-SA; keep the attribution in the generated file.
"""
import html
import json
import pathlib
import re
import time
import urllib.request

API = "https://wger.de/api/v2"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data/library.json"

# wger muscle -> the seven radar groups the app scores against.
GROUP = {
    "Chest": "Chest", "Lats": "Back", "Trapezius": "Back",
    "Shoulders": "Shoulders", "Serratus anterior": "Shoulders",
    "Biceps": "Arms", "Triceps": "Arms", "Brachialis": "Arms",
    "Quads": "Legs", "Hamstrings": "Legs", "Glutes": "Legs",
    "Calves": "Calves", "Soleus": "Calves",
    "Abs": "Core", "Obliquus externus abdominis": "Core",
}

TIME_KW = ["plank", "hold", "hang", "wall sit", "l-sit", "isometric", "handstand",
           "superman hold", "bridge hold", "static", "stretch", "mobility", "yoga", "foam roll"]
CARRY_KW = ["farmer", "carry", "suitcase", "yoke", "waiters walk", "waiter's walk"]
REPS_KW = ["push-up", "push up", "pull-up", "pull up", "chin-up", "chin up", "dip", "crunch",
           "sit-up", "sit up", "leg raise", "knee raise", "burpee", "jump", "squat jump",
           "pistol", "muscle-up", "inverted row", "glute bridge", "hip thrust",
           "hyperextension", "back extension", "calf raise"]


def get(path, tries=5, timeout=60):
    for i in range(tries):
        try:
            with urllib.request.urlopen(API + path, timeout=timeout) as r:
                return json.load(r)
        except Exception as e:                                    # noqa: BLE001
            print(f"  retry {i+1}/{tries}: {e}")
            time.sleep(3)
    raise RuntimeError(f"failed to fetch {path}")


def ids(value):
    """Accept either [1,2] or [{'id':1},...]."""
    return [x["id"] if isinstance(x, dict) else x for x in (value or [])]


def mode_for(x):
    name, cat = x["name"].lower(), x["cat"]
    eq = [e.lower() for e in x["eq"]]
    bodyweight = (not eq) or any("bodyweight" in e for e in eq)
    if cat == "Cardio":
        return "distance_time"
    if any(k in name for k in CARRY_KW):
        return "weight_distance"
    if any(k in name for k in TIME_KW):
        return "time"
    if bodyweight and any(k in name for k in REPS_KW):
        return "reps"
    return "weight_reps"


def groups_for(x):
    if x["cat"] == "Cardio":
        return ["Cardio"]
    out = []
    for m in x["prim"] + x["sec"]:
        g = GROUP.get(m)
        if g and g not in out:
            out.append(g)
    return out or (["Core"] if x["cat"] == "Abs" else [x["cat"]])


def main():
    print("fetching reference tables…")
    cats = {c["id"]: c["name"] for c in get("/exercisecategory/?format=json&limit=100")["results"]}
    musc = {m["id"]: (m.get("name_en") or m.get("name"))
            for m in get("/muscle/?format=json&limit=100")["results"]}
    equip = {e["id"]: e["name"] for e in get("/equipment/?format=json&limit=100")["results"]}

    lib, offset, total = [], 0, None
    while True:
        page = get(f"/exerciseinfo/?language=2&limit=100&offset={offset}&format=json")
        total = total or page["count"]
        for ex in page["results"]:
            trans = [t for t in ex.get("translations", []) if t.get("language") == 2]
            t = trans[0] if trans else (ex.get("translations") or [{}])[0]
            name = (t.get("name") or "").strip()
            if not name:
                continue
            desc = re.sub(r"\s+", " ", re.sub("<[^>]+>", "", html.unescape(t.get("description") or ""))).strip()
            cat = ex.get("category")
            cat = cat.get("name") if isinstance(cat, dict) else cats.get(cat, "Other")
            entry = {
                "id": ex["id"], "name": name, "cat": cat or "Other",
                "prim": [musc[m] for m in ids(ex.get("muscles")) if m in musc],
                "sec": [musc[m] for m in ids(ex.get("muscles_secondary")) if m in musc],
                "eq": [equip[e] for e in ids(ex.get("equipment")) if e in equip],
                "desc": desc[:600],
            }
            lib.append(entry)
        offset += 100
        print(f"  {len(lib)}/{total}")
        if offset >= total:
            break

    # compact form consumed by the app
    compact = [{
        "id": x["id"], "n": x["name"], "c": x["cat"],
        "p": x["prim"], "s": x["sec"], "e": x["eq"],
        "m": mode_for(x), "g": groups_for(x), "d": x["desc"][:280],
    } for x in lib]
    compact.sort(key=lambda z: (z["c"], z["n"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(compact, separators=(",", ":")))
    print(f"\nwrote {OUT} — {len(compact)} exercises, {OUT.stat().st_size/1024:.0f} KB")
    print("now run: python3 tools/build_data.py")


if __name__ == "__main__":
    main()
