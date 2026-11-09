#!/usr/bin/env python3
"""Build the offline food dataset from the USDA FoodData Central bulk downloads.

Downloads the FNDDS (survey 2021-2023) and SR Legacy CSV bundles — both are
U.S. Government works in the public domain (CC0 1.0), and the bulk zips need NO
API key. Extracts per-100 g nutrients and portion measures, then writes two
committed artifacts, mirroring the repo's existing data pattern
(tools/build_data.py turns data/library.json into the committed js/data.js):

  data/food.json    committed source of truth:
                    {"license": <CC0 line + citation>,
                     "foods": [{"code", "name", "per100", "measures", "src"}]}
  js/fooddata.js    generated browser bundle: `const FOOD_DB = {...};`
                    (js/ is copied wholesale into www/ by tools/build_www.py, so
                    the generated file is committed exactly like js/data.js.)

NAME CURATION: the USDA descriptions carry some dated or loaded terms. RENAMES
(below) maps each exact source description to a corrected displayed name; it is
applied in build() and enforced by name_gate(), which FAILS the build if any
shipped name still carries a seed term that is not on the KNOWN_OK allowlist in
tools/corpus-name-sweep.py. The correction lives here — never in the generated
data — so it survives every regeneration. See the RENAMES comments for the source
checked per entry and why two sweep hits are deliberately left alone.

THE ONE TRAP: FNDDS(survey) food_nutrient.nutrient_id is the nutrient NUMBER
(208=Energy kcal, 203=Protein, 204=Fat, 205=Carb, 291=Fibre); SR Legacy uses the
FDC nutrient ID (1008, 1003, 1004, 1005, 1079). nutrient.csv maps id ->
nutrient_nbr, which reconciles the two. Getting this wrong silently mis-assigns
macros, so tools/test_food.js pins both directions against raw-CSV values.

A per100 key is OMITTED when the source has no row for it (never written as 0);
an amount the source states as 0 is kept as 0. Same rule for measures: only rows
with gram_weight > 0 and a non-empty label are kept.

SIZE NOTE: the "1.6 GB FNDDS" figure from the original research was wrong. The
real FNDDS CSV zip is ~3.3 MB (measured below); SR Legacy CSV is ~6 MB.
"""
import argparse
import csv
import json
import os
import pathlib
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

FNDDS_CSV_URL = ("https://fdc.nal.usda.gov/fdc-datasets/"
                 "FoodData_Central_survey_food_csv_2024-10-31.zip")
SRLEG_CSV_URL = ("https://fdc.nal.usda.gov/fdc-datasets/"
                 "FoodData_Central_sr_legacy_food_csv_2018-04.zip")

LICENSE = ("USDA FoodData Central — FNDDS 2021-2023 (survey food, published "
           "2024-10-31) and SR Legacy (published 2018-04). Both are U.S. "
           "Government works in the public domain, released under CC0 1.0 "
           "(https://creativecommons.org/publicdomain/zero/1.0/). No attribution "
           "required. Source: https://fdc.nal.usda.gov/")

# canonical per100 key order -> the nutrient NUMBER it maps to (the number is the
# common currency; nutrient.csv reconciles the FDC ids used by SR Legacy onto it).
KEYS = ("kcal", "protein", "fat", "carb", "fibre")
NBR_TO_KEY = {"208": "kcal", "203": "protein", "204": "fat", "205": "carb", "291": "fibre"}

# ---------------------------------------------------------------------------
# NAME CURATION MAP  (USDA source description -> displayed name)
# ---------------------------------------------------------------------------
# The USDA bulk tables still carry some dated or loaded terms in their
# descriptions. This map corrects the ones we ship, keyed on the EXACT source
# description so a rename only fires on the intended row. It lives HERE, not in
# the generated data, so the correction survives every regeneration of
# data/food.json / js/fooddata.js (both are generated; never hand-edit them).
#
# Two classes, stated plainly so nothing reads as a catalogue fact it is not:
#
#  (a) A CATALOGUE NAME WITH A KNOWN MODERN GLOBAL EQUIVALENT — replace it with
#      that global name. Source checked per entry (see the inline note).
#  (b) A DATED ADJECTIVE WITH NO CATALOGUE REPLACEMENT — there is no authoritative
#      global name for the food, so we swap in the neutral modern descriptor.
#      THIS IS THE APP'S CHOICE, not a catalogue truth, and is marked as such.
#
# DELIBERATELY NOT TOUCHED — two sweep hits that are NOT defects:
#   * "Restaurant, Latino, Arroz con frijoles negros (rice and black beans)"
#     "negros" is Spanish for "black" (frijoles negros = black beans). It is
#     ordinary vocabulary in the dish's own language, not a slur in English.
#   * "Beverages, yellow green colored citrus soft drink with caffeine"
#     "colored" here means food colouring (the drink is artificially coloured).
#     It is a plain sensory descriptor, not a term about people.
# Renaming either would be wrong, so they are absent from this map by design and
# tools/test_food.js asserts they still ship unchanged.
RENAMES = {
    # (a) daikon is the globally used culinary name for this radish. Source:
    #     Wikipedia "Daikon" — "daikon ... or daikon radish is most common";
    #     "Oriental radish" is listed only as one of several other terms.
    "Radishes, oriental, raw": "Radishes, daikon, raw",
    "Radishes, oriental, cooked, boiled, drained, without salt":
        "Radishes, daikon, cooked, boiled, drained, without salt",
    "Radishes, oriental, cooked, boiled, drained, with salt":
        "Radishes, daikon, cooked, boiled, drained, with salt",
    "Radishes, oriental, dried": "Radishes, daikon, dried",
    # (a) the fungus's standard modern English name is "wood ear". Source:
    #     Wikipedia "Auricularia auricula-judae" — "commonly known as wood ear,
    #     jelly ear or historically as Jew's ear". ("pepeao", its other common
    #     name, is kept in the parenthetical.)
    "Jew's ear, (pepeao), raw": "Wood ear, (pepeao), raw",
    # (b) no global catalogue name exists for these two; "oriental" is a dated
    #     adjective. We use the neutral modern descriptor "Asian" — the APP'S
    #     CHOICE, not a catalogue truth.
    "Snacks, oriental mix, rice-based": "Snacks, Asian mix, rice-based",
    "Pork, oriental style, dehydrated": "Pork, Asian style, dehydrated",
}


def apply_renames(foods):
    """Rename curated descriptions in place. Returns (n_renamed, unmatched_keys).

    unmatched_keys lists RENAMES keys that matched no shipped food — a signal that
    the USDA description changed upstream and the entry needs revisiting.
    """
    n = 0
    seen = set()
    for f in foods:
        new = RENAMES.get(f["name"])
        if new is not None:
            seen.add(f["name"])
            f["name"] = new
            n += 1
    return n, [k for k in RENAMES if k not in seen]


def log(msg):
    print(msg, flush=True)


def download(url, dest):
    """Download url -> dest (bytes). Fails loudly; the builder is reproducible."""
    log(f"  downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "iron-ledger-build/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f)
    size = os.path.getsize(dest)
    log(f"    {size} bytes")
    return size


def extract_zip(zip_path, dest_dir):
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest_dir)


def find_data_dir(root):
    """The zip nests one directory that holds the CSVs; return it."""
    for dirpath, _dirs, files in os.walk(root):
        if "food_nutrient.csv" in files:
            return dirpath
    raise SystemExit(f"FATAL: no food_nutrient.csv found under {root}")


def load_nutrient_map(data_dir):
    """nutrient.csv: FDC nutrient id -> nutrient number. Returns id->nbr."""
    path = os.path.join(data_dir, "nutrient.csv")
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            nid, nbr = (r.get("id") or "").strip(), (r.get("nutrient_nbr") or "").strip()
            if nid and nbr:
                out[nid] = nbr
    return out


def resolve_key(nutrient_id, id_to_nbr):
    """Map a food_nutrient.nutrient_id to a per100 key.

    Handles BOTH conventions: FNDDS stores the nutrient NUMBER directly
    (208, 203, ...); SR Legacy stores the FDC id (1008, 1003, ...) which
    nutrient.csv translates to the number. Returns None for anything else.
    """
    if nutrient_id in NBR_TO_KEY:              # FNDDS: already a number
        return NBR_TO_KEY[nutrient_id]
    nbr = id_to_nbr.get(nutrient_id)           # SR Legacy: FDC id -> number
    if nbr in NBR_TO_KEY:
        return NBR_TO_KEY[nbr]
    return None


def load_foods(data_dir):
    path = os.path.join(data_dir, "food.csv")
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            out[r["fdc_id"]] = r["description"]
    return out


def load_nutrients(data_dir, id_to_nbr):
    """fdc_id -> {key: amount} for the five tracked nutrients."""
    path = os.path.join(data_dir, "food_nutrient.csv")
    per = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            key = resolve_key((r["nutrient_id"] or "").strip(), id_to_nbr)
            if key is None:
                continue
            amount = r["amount"]
            if amount in ("", None):
                continue                      # genuinely absent -> omit the key
            per.setdefault(r["fdc_id"], {})[key] = round(float(amount), 4)
    return per


def load_portions(data_dir):
    """fdc_id -> [{label, grams}] keeping only gram_weight > 0 and a label."""
    path = os.path.join(data_dir, "food_portion.csv")
    por = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            gw = r["gram_weight"]
            if not gw:
                continue
            try:
                g = float(gw)
            except ValueError:
                continue
            if g <= 0:
                continue
            label = (r["portion_description"] or "").strip() or (r["modifier"] or "").strip()
            if not label:
                continue
            por.setdefault(r["fdc_id"], []).append({"label": label, "grams": round(g, 1)})
    return por


def canonical_per100(raw):
    """Emit per100 in a fixed key order (deterministic diffs); omit absent keys."""
    return {k: raw[k] for k in KEYS if k in raw}


def build(work):
    fndds_dir = find_data_dir(os.path.join(work, "fndds"))
    srleg_dir = find_data_dir(os.path.join(work, "srleg"))

    foods = []
    for data_dir, src in ((fndds_dir, "fndds"), (srleg_dir, "sr")):
        id_to_nbr = load_nutrient_map(data_dir)
        fmap = load_foods(data_dir)
        nut = load_nutrients(data_dir, id_to_nbr)
        por = load_portions(data_dir)
        log(f"  {src}: {len(fmap)} foods, "
            f"{sum(len(v) for v in nut.values())} nutrient rows kept, "
            f"{sum(len(v) for v in por.values())} measures kept")
        for code, name in fmap.items():
            foods.append({
                "code": int(code),
                "name": name,
                "per100": canonical_per100(nut.get(code, {})),
                "measures": por.get(code, []),
                "src": src,
            })
    foods.sort(key=lambda x: x["code"])
    # Curate the displayed names (USDA description -> global/neutral name). Applied
    # here so both generated artifacts carry the correction on every rebuild.
    n_renamed, unmatched = apply_renames(foods)
    log(f"  renames applied: {n_renamed} of {len(RENAMES)} curated")
    if unmatched:
        log(f"  WARNING: curated names matched no shipped food (source changed?): {unmatched}")
    return foods


def name_gate(foods):
    """Gate: fail the build if any shipped name carries a seed term that is not on
    the sweep's explicit false-positive allowlist. Reuses tools/corpus-name-sweep.py
    (imported by path — its filename has a hyphen) so there is ONE term list and ONE
    allowlist, not a second copy that can drift."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "corpus_name_sweep", ROOT / "tools" / "corpus-name-sweep.py")
    if spec is None or spec.loader is None:
        raise SystemExit("FATAL: cannot load tools/corpus-name-sweep.py for the name gate")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    hits = mod.find_hits(foods, "name")
    unknown = [(t, n) for (t, n) in hits if n not in mod.KNOWN_OK]
    known = [n for (_t, n) in hits if n in mod.KNOWN_OK]
    log(f"  name gate: {len(unknown)} unknown term(s), "
        f"{len(known)} known false positive(s)")
    if unknown:
        for term, name in unknown:
            log(f"    UNKNOWN: {term!r} in {name!r}")
        raise SystemExit(
            "FATAL: a shipped food name still contains a seed term that is not on "
            "the KNOWN_OK allowlist. Curate it in RENAMES (see tools/corpus-name-sweep.py).")
    return len(unknown), len(known)


def write_outputs(foods):
    doc = {"license": LICENSE, "foods": foods}
    food_json = ROOT / "data" / "food.json"
    food_json.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8")

    header = (
        "/* Offline food database — %d foods from USDA FoodData Central\n"
        "   (FNDDS 2021-2023 + SR Legacy; public domain, CC0 1.0).\n"
        "   Generated from data/food.json by tools/build_food_db.py. Do not hand-edit.\n"
        "   Fields: code, name, per100 {kcal,protein,fat,carb,fibre — absent key = not in\n"
        "           source}, measures [{label, grams}], src (fndds|sr). */\n"
        % len(foods))
    bundle = header + "const FOOD_DB = " + json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + ";\n"
    bundle_js = ROOT / "js" / "fooddata.js"
    bundle_js.write_text(bundle, encoding="utf-8")

    n_meas = sum(len(f["measures"]) for f in foods)
    n_per = sum(1 for f in foods if f["per100"])
    n_abs_fibre = sum(1 for f in foods if "fibre" not in f["per100"])
    log(f"  foods={len(foods)} measures={n_meas} with_per100={n_per} "
        f"without_fibre={n_abs_fibre}")
    log(f"  wrote {food_json.relative_to(ROOT)}  {food_json.stat().st_size} bytes")
    log(f"  wrote {bundle_js.relative_to(ROOT)}  {bundle_js.stat().st_size} bytes")
    return food_json, bundle_js


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Build data/food.json + js/fooddata.js from the USDA FDC bulk downloads.")
    ap.add_argument("--cache", metavar="DIR",
                    help="reuse/keep downloads+extracts in DIR instead of a temp dir")
    args = ap.parse_args(argv)

    tmp = None
    if args.cache:
        work = pathlib.Path(args.cache)
        work.mkdir(parents=True, exist_ok=True)
    else:
        tmp = tempfile.mkdtemp(prefix="fdc-build-")
        work = pathlib.Path(tmp)

    try:
        for name, url, sub in (("fndds", FNDDS_CSV_URL, "fndds"),
                               ("srleg", SRLEG_CSV_URL, "srleg")):
            zip_path = work / f"{name}.zip"
            data_root = work / sub
            if not (data_root.exists() and any(data_root.rglob("food_nutrient.csv"))):
                if not zip_path.exists():
                    download(url, zip_path)
                data_root.mkdir(parents=True, exist_ok=True)
                log(f"  extracting {zip_path.name}")
                extract_zip(zip_path, data_root)

        log("building…")
        foods = build(work)
        name_gate(foods)          # gate BEFORE writing so a bad name never ships
        write_outputs(foods)
        log("done.")
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
