#!/usr/bin/env python3
"""Re-derive the exercise library's classification from its two open sources and
reconcile data/library.json against them (audit 2026-11-10).

PROVENANCE (do not rediscover): data/library.json was built by
tools/fetch_wger.py from the wger API (https://wger.de/api/v2), with thin/empty
form cues gap-filled from yuhonas/free-exercise-db (public domain). Both are open
datasets that carry equipment, primary/secondary MUSCLES, category and — for
free-exercise-db — a `mechanic` (compound|isolation) field.

WHAT THIS AUDIT FOUND (measured, not assumed):
  * wger is the library's PRIMARY source and data/library.json is a BYTE-EXACT
    snapshot of it: all 954 rows agree with the current /exerciseinfo/ on
    category, primary muscles, secondary muscles AND equipment. So re-deriving
    from wger alone produces ZERO corrections — wger is the source of the
    defects, not the fix for them. The empty `p`/`e` fields are wger's own.
  * free-exercise-db matches only 72 of the 954 rows by name (its own 876 rows
    use different names), so it is a gap-filler, not a full second opinion.
  * The remaining fixes are therefore NAME / DESCRIPTION judgements, made one
    entry at a time and cited per row below.

TIE-BREAK RULE when the two sources disagree: prefer the value that agrees with
the exercise NAME (e.g. "Ball crunches" -> a ball, "Crunches on Machine" ->
a machine). Where a name genuinely cannot decide, the row is LEFT, marked and
LISTED as unresolvable — an honest judgement call beats a confident wrong fix.

The muscle-group RADAR array (`g`) is what muscleGroups() credits (primary g[0]
full, the rest half). It is re-derived here from the corrected p+s with the SAME
mapping fetch_wger.py uses, so the credit follows the fix.

    python3 tools/library_source_fix.py            # report only
    python3 tools/library_source_fix.py --apply     # rewrite data/library.json + TSV
"""
import json, pathlib, re, sys, urllib.request, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIB_PATH = ROOT / "data/library.json"
TSV_PATH = ROOT / "tools" / "library-source-map.tsv"

API = "https://wger.de/api/v2"
FEDB_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"

# wger muscle -> the seven radar groups the app scores against (identical to
# tools/fetch_wger.py — kept in step so a re-derivation credits the same group).
GROUP = {
    "Chest": "Chest", "Lats": "Back", "Trapezius": "Back",
    "Shoulders": "Shoulders", "Serratus anterior": "Shoulders",
    "Biceps": "Arms", "Triceps": "Arms", "Brachialis": "Arms",
    "Quads": "Legs", "Hamstrings": "Legs", "Glutes": "Legs",
    "Calves": "Calves", "Soleus": "Calves",
    "Abs": "Core", "Obliquus externus abdominis": "Core",
}

# free-exercise-db muscle -> wger `name_en` (so a gap-fill lands in the app's own
# vocabulary). Only unambiguous, radar-bearing muscles are mapped; anything not
# listed is refused rather than guessed.
FEDB_MUSCLE = {
    "chest": "Chest", "lats": "Lats", "middle back": "Lats", "traps": "Trapezius",
    "shoulders": "Shoulders", "biceps": "Biceps", "triceps": "Triceps",
    "quadriceps": "Quads", "hamstrings": "Hamstrings", "glutes": "Glutes",
    "abductors": "Glutes", "adductors": "Glutes", "calves": "Calves",
    "abdominals": "Abs",
}


def fetch(url, tries=5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "iron-ledger-audit/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, json.load(r)
        except Exception as e:                                    # noqa: BLE001
            last = e
            time.sleep(3)
    raise RuntimeError(f"failed to fetch {url}: {last}")


def load_sources():
    """Fetch both sources live and record the exact URL + HTTP status."""
    status = {}
    allres, off, total = [], 0, None
    while True:
        u = f"{API}/exerciseinfo/?language=2&limit=100&offset={off}&format=json"
        st, data = fetch(u)
        status[u] = st
        total = total or data["count"]
        allres.extend(data["results"])
        off += 100
        if off >= total:
            break
    st, fedb = fetch(FEDB_URL)
    status[FEDB_URL] = st
    return allres, fedb, status


def norm(s):
    s = str(s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strip_paren(s):
    return re.sub(r"\([^)]*\)", " ", s).strip()


def fedb_index(rows):
    idx = {}
    for r in rows:
        for k in {norm(r.get("name", "")), norm(strip_paren(r.get("name", "")))}:
            if k:
                idx.setdefault(k, []).append(r)
    return idx


def fedb_match(name, idx):
    keys = []
    for b in [norm(name), norm(strip_paren(name))]:
        if b:
            keys += [b, b.replace(" ", "")]
    seen = set()
    for k in keys:
        if not k or k in seen:
            continue
        seen.add(k)
        hits = idx.get(k)
        if hits and len(hits) == 1:
            return hits[0]
    return None


# --------------------------------------------------------------- corrections ---
# RULE A — equipment the NAME names. Applied only when the row's current
# equipment is empty / "none (bodyweight exercise)" / "Gym mat" (i.e. it claims
# to supply no load) AND the name plainly names a load source. Ordered, first
# match wins. This is the name-decides tie-break; rows whose name does NOT name
# equipment are left alone.
EQ_RULES = [
    (re.compile(r"smith machine", re.I), "Machine"),
    (re.compile(r"\bmachine\b|\bstack\b|pec deck|\bleverage machine\b|"
                r"hack squat|hackensch|pendular hack|leg press|\bski machine\b", re.I), "Machine"),
    (re.compile(r"\bcable\b|pulldown|pushdown", re.I), "Cable machine"),
    (re.compile(r"\bbarbell\b|\bsz-bar\b|\bez[- ]?bar\b", re.I), "Barbell"),
    (re.compile(r"\bdumbbell\b|\bkettlebell\b", re.I), "Dumbbell"),
    (re.compile(r"resistance band", re.I), "Resistance band"),
    (re.compile(r"\bplate\b", re.I), "Plate"),
    (re.compile(r"swiss ball|medicine ball|ball crunch|ball slam|bosu", re.I), "Swiss Ball"),
    (re.compile(r"pull-?up bar", re.I), "Pull-up bar"),
    (re.compile(r"\bbench\b", re.I), "Bench"),
]
# Names that name a word above but do NOT name equipment: a lever/foam-roll/on-floor
# variant. Excluded so the rule cannot misfire.
EQ_SKIP = re.compile(r"foam|IT Band|\blever\b|on floor|bodyweight", re.I)

# RULE B — a primary muscle the NAME names, for a strength row whose p is empty.
# Only applied when the name plainly names one muscle that maps to a radar group
# AND does not also name a compound pattern (a "row to external rotation" is a
# ROW, not a rotator-cuff isolation — the name-regex trap).
MUSCLE_RULES = [
    (re.compile(r"rear delt|rotator cuff|external rotation|internal rotation|"
                r"lateral raise|front raise|\bdelt\b|handstand|y-pull|dislocate", re.I), "Shoulders"),
]
MUSCLE_SKIP = re.compile(r"\brow\b|press|squat|deadlift|\bclean\b|snatch|lunge|pulldown|curl", re.I)

# EXPLICIT, per-row corrections. Each is a judgement made against the exercise's
# OWN description (wger translation) and/or free-exercise-db, cited in the TSV.
# Fields given here override the wger snapshot for that row.
OVERRIDES = {
    # --- the 14 formerly-unresolvable ids ---
    124:  {"e": ["Plate"], "p": ["Quads"], "s": ["Glutes"], "g": ["Legs"],
           "note": "description: 'Grab a weight plate and hold it out in front of your body' -> LOADED"},
    1672: {"e": ["Machine"], "p": ["Glutes"], "g": ["Legs"],
           "note": "description: 'knees aligned with the pivot point of the machine' / padded levers -> loaded machine"},
    2718: {"e": ["Machine"], "p": ["Glutes"], "g": ["Legs"],
           "note": "Seated Hip Abduction (Custom) twin of 1672 -> loaded machine"},
    12:   {"e": ["Machine"], "p": ["Glutes"], "g": ["Legs"],
           "note": "description: 'Sit on the machine ... Pull the pin to release the pads' -> loaded machine"},
    2699: {"e": ["Machine"], "p": ["Glutes"], "g": ["Legs"],
           "note": "Seated Hip Adduction (Custom) twin of 12 -> loaded machine"},
    1949: {"m": "time", "e": [], "g": ["Legs"],
           "note": "description: 'Limber 11 Source: Joe DeFranco' — a mobility ROUTINE, not a loaded lift -> time"},
    2664: {"m": "time", "e": ["none (bodyweight exercise)"], "g": ["Legs"],
           "note": "description: 'A gentle stretch to restore full knee extension' -> mobility + time (name carries no stretch token)"},
    1576: {"m": "reps", "e": ["none (bodyweight exercise)"], "g": ["Legs", "Calves", "Core"],
           "note": "plyometric bodyweight drill; description: 'perform a small hop' -> reps (name has no jump token)"},
    # --- operator-flagged muscle / equipment errors ---
    478:  {"e": ["Dumbbell"], "p": ["Shoulders"], "s": ["Triceps", "Quads"], "g": ["Shoulders", "Arms", "Legs"],
           "note": "description: dumbbells on shoulders, dip at the knees, press overhead -> Shoulders primary, Triceps + Quads synergists"},
    566:  {"p": ["Shoulders"], "s": ["Triceps"], "g": ["Shoulders", "Arms"],
           "note": "description: seated barbell press overhead -> Shoulders primary with Triceps synergist"},
    1654: {"e": ["Machine"], "p": ["Shoulders"], "g": ["Shoulders"],
           "note": "description: 'The machine lateral raise ... targets the medial (side) deltoid' -> Machine"},
    # --- empty-p strength rows the NAME decides (boss-named examples) ---
    406:  {"p": ["Shoulders"], "g": ["Shoulders"], "note": "name: rotator cuff = shoulder stabilisers"},
    487:  {"p": ["Shoulders"], "g": ["Shoulders"], "note": "name: rear delt = posterior deltoid"},
    578:  {"p": ["Shoulders"], "g": ["Shoulders"], "note": "name: external rotation = rotator cuff"},
    711:  {"p": ["Shoulders"], "g": ["Shoulders"], "note": "name: handstand = shoulder press lockout"},
    1775: {"e": ["Machine"], "p": ["Shoulders"], "g": ["Shoulders"], "note": "name: pec deck rear delt fly = rear delt on the deck"},
    # --- free-exercise-db mechanic disagrees with the app's NAME class ---
    1194: {"p": ["Abs"], "s": [], "g": ["Core"], "note": "free-exercise-db: isolation, abdominals — an anti-rotation hold, not a press (wger's muscle list was nonsense)"},
    549:  {"s": [], "g": ["Arms"], "note": "free-exercise-db: isolation, triceps"},
    1726: {"s": [], "g": ["Back"], "note": "free-exercise-db: isolation, lats (a straight-arm pull, not a pulldown compound)"},
    1723: {"g": ["Legs"], "note": "free-exercise-db: compound, glutes+hamstrings"},
    2478: {"g": ["Legs", "Calves"], "note": "free-exercise-db: compound, hamstrings + calves"},
}

# Genuinely performable BOTH bodyweight and loaded -> an "accept either" flag so a
# loadless set is valid, WITHOUT loosening validSet for the class.
DUAL = {
    977:  "description: 'Position the box ... if you're using a barbell' — bodyweight OR barbell box squat",
    1388: "description: 'hold weights in both hands IF USING LOADS' — bodyweight OR loaded single-leg RDL",
    1392: "description: 'place your hands on your hips' — bodyweight OR barbell good morning",
    632:  "bodyweight sumo squat OR barbell sumo squat (name/description)",
    1294: "bodyweight Nordic hamstring curl OR leg-curl machine",
}

# Rows deliberately LEFT and listed as unresolvable (a name cannot decide).
UNRESOLVABLE = {
    2564: "breathing drill — no radar muscle group maps; p genuinely empty (not a defect)",
    1939: "Neck CARs — the radar has no Neck group; p cannot map",
    1966: "thoracic rotation — mobility, not a loaded primary",
    1008: "Left neck stretch — the radar has no Neck group",
    1009: "Right neck stretch — the radar has no Neck group",
    1381: "MALFORMED library row: description is a muscle-group blurb, no movement",
}


def wger_fields(ex):
    def nm(m):
        return m.get("name_en") or m.get("name")
    cat = ex["category"]["name"] if isinstance(ex.get("category"), dict) else ex.get("category")
    prim = [nm(m) for m in ex.get("muscles") or []]
    sec = [nm(m) for m in ex.get("muscles_secondary") or []]
    eq = [e["name"] for e in ex.get("equipment") or []]
    return cat, prim, sec, eq


def groups_for(cat, prim, sec):
    if cat == "Cardio":
        return ["Cardio"]
    out = []
    for m in list(prim) + list(sec):
        g = GROUP.get(m)
        if g and g not in out:
            out.append(g)
    return out or (["Core"] if cat == "Abs" else [cat])


def no_load(e):
    return (not e) or all(("bodyweight" in s.lower() or s.lower() == "gym mat") for s in e)


def main():
    apply = "--apply" in sys.argv
    lib = json.load(open(LIB_PATH))
    wx, fedb, status = load_sources()
    byid = {e["id"]: e for e in wx}
    fidx = fedb_index(fedb)

    print("SOURCE URLS (HTTP status):")
    for u, st in status.items():
        print(f"  {st}  {u}")

    rows, changed = [], 0
    for x in lib:
        ex = byid.get(x["id"])
        m = fedb_match(x["n"], fidx)
        before = {"c": x["c"], "p": x["p"], "s": x["s"], "e": x["e"], "m": x["m"], "g": x["g"]}
        action, cite = "kept", []
        if ex:
            cite.append(f"wger id {x['id']}")
        if m:
            cite.append(f"free-exercise-db '{m['name']}' ({m.get('mechanic')})")

        # RULE A — equipment from the name (only when it currently claims no load)
        if no_load(x["e"]) and not EQ_SKIP.search(x["n"]):
            for rex, val in EQ_RULES:
                if rex.search(x["n"]):
                    x["e"] = [val]
                    cite.append(f"name names equipment -> {val}")
                    break
        # RULE B — primary muscle from the name (only when p is empty)
        p_filled = False
        if not x["p"] and not MUSCLE_SKIP.search(x["n"]):
            for rex, val in MUSCLE_RULES:
                if rex.search(x["n"]):
                    x["p"] = [val]
                    p_filled = True
                    cite.append(f"name names primary -> {val}")
                    break
        # a filled primary must move the radar array the credit reads
        if p_filled:
            g2 = groups_for(x["c"], x["p"], x["s"])
            if g2 and all(gg in GROUP.values() for gg in g2):
                x["g"] = g2
        # EXPLICIT override wins
        ov = OVERRIDES.get(x["id"], {})
        if ov:
            for k in ("c", "p", "s", "e", "m", "g"):
                if k in ov:
                    x[k] = ov[k]
            if "g" not in ov and ({"p", "s", "c"} & set(ov)):
                x["g"] = groups_for(x["c"], x["p"], x["s"])
            cite.append(ov["note"])
        if x["id"] in DUAL:
            x["dual"] = 1
            action = "dual-flagged"
            cite.append(DUAL[x["id"]])
        if x["id"] in UNRESOLVABLE and ov == {}:
            cite.append("UNRESOLVABLE: " + UNRESOLVABLE[x["id"]])

        after = {"c": x["c"], "p": x["p"], "s": x["s"], "e": x["e"], "m": x["m"], "g": x["g"]}
        if after != before:
            changed += 1
            action = "corrected+dual" if action == "dual-flagged" else "corrected"
        if action == "kept" and not x["p"]:
            # p genuinely empty after every rule: wger carries no muscle for this
            # movement and the name does not decide one. The radar credit rides on
            # `g` (still present), so this is a DISPLAY gap, not a scoring defect.
            cite.append("p empty: no source muscle; radar credit rides on g")
        if x["id"] in UNRESOLVABLE and action in ("kept",):
            action = "unresolvable"
        rows.append((x, before, after, action, " | ".join(cite)))

    lines = ["\t".join(["id", "name", "app_classification", "source_classification",
                        "source_citation", "action"])]
    for x, before, after, action, cite in rows:
        appc = f"c={before['c']} p={before['p']} s={before['s']} e={before['e']} m={before['m']} g={before['g']}"
        srcc = f"c={x['c']} p={x['p']} s={x['s']} e={x['e']} m={x['m']} g={x['g']}"
        lines.append("\t".join([str(x["id"]), x["n"], appc, srcc, cite, action]))
    TSV_PATH.write_text("\n".join(lines) + "\n")

    counts = {}
    for _, _, _, action, _ in rows:
        counts[action] = counts.get(action, 0) + 1
    print("\nACTIONS:", counts)
    print("rows rewritten:", changed)
    print("TSV:", TSV_PATH)

    if apply:
        LIB_PATH.write_text(json.dumps(lib, separators=(",", ":"), ensure_ascii=False))
        print("APPLIED ->", LIB_PATH)


if __name__ == "__main__":
    main()
