#!/usr/bin/env python3
"""Rebuild data/library.json from the wger open exercise database, then gap-fill
thin/empty form cues from yuhonas/free-exercise-db (public domain).

Run this to refresh the exercise library, then run `python3 tools/build_data.py`
to regenerate js/data.js.

    python3 tools/fetch_wger.py && python3 tools/build_data.py

wger quirks this handles:
  * `/exercise/` returns NO names — they live in `/exerciseinfo/` under
    `translations` (filter `language == 2` for English).
  * On `/exerciseinfo/` the `category`, `muscles` and `equipment` fields come
    back as full objects; on `/exercise/` they are bare ids. Normalise both.
  * `description` is an HTML fragment. It is step-structured (`<ol><li>…`) or
    paragraph-structured (`<p>…`) with `<strong>`/`<b>` step labels. It is
    converted to plain text by `html_to_text` — one STEP PER LINE — instead of
    being flattened to a run-on paragraph and truncated mid-word.
  * The library is CC-BY-SA; keep the attribution in the generated file.

Form-cue shape: `d` is a plain STRING with steps separated by "\n" (a single
line when the source was a paragraph). A string — not an array — keeps the field
type identical to the app's own custom exercises (js/app.js writes `d: ""` and
`d: "Created from import."`), so every existing reader keeps working unchanged;
the only reader is the detail modal, which splits on "\n".

Gap-fill (yuhonas/free-exercise-db, Unlicense / public domain): entries whose
wger cue is EMPTY or under 60 characters are matched BY NORMALISED NAME ONLY —
an exact normalised name, a parenthetical-stripped alias, or a spacing-only
alias (e.g. "pushup" == "push up"). A match is accepted only when it is
UNAMBIGUOUS (exactly one candidate). Anything else is left with no cue: a
guessed instruction is worse than none. That dataset's IMAGES are NOT used —
its maintainer states the image provenance is unknown.
"""
import html
import json
import pathlib
import re
import time
import urllib.request
from html.parser import HTMLParser

API = "https://wger.de/api/v2"
FEDB_URL = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data/library.json"

# A cue shorter than this is treated as thin and eligible for gap-fill.
THIN = 60
# Generous ceiling; cut on a step/word boundary, never mid-word.
CAP = 2000

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


class _Steps(HTMLParser):
    """Turn a wger description fragment into plain text, one STEP PER LINE.

    * `<ol>` / `<ul>` items become separate lines.
    * `<p>` / `<div>` / `<br>` break a line (a paragraph break).
    * a `<strong>` / `<b>` that OPENS a line is kept as a "Label: text" prefix;
      a bold run inside a sentence is left inline.
    """

    BLOCK = ("p", "div", "section", "article", "tr", "blockquote", "h1", "h2", "h3", "h4")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines = []
        self.buf = ""
        self.list_depth = 0
        self.strong = []                       # stack of (start_len, opened_a_line)

    def _flush(self):
        # "<strong>Label</strong>: text" double-punctuates once the label prefix
        # is added; collapse the duplicate colon rather than print "Label: : text".
        text = re.sub(r":\s*:\s*", ": ", self.buf)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            self.lines.append(text)
        self.buf = ""

    def handle_starttag(self, tag, attrs):
        if tag in ("ol", "ul"):
            self._flush(); self.list_depth += 1
        elif tag == "li":
            self._flush()
        elif tag in self.BLOCK:
            if not self.list_depth:
                self._flush()
        elif tag == "br":
            self._flush()
        elif tag in ("strong", "b"):
            self.strong.append((len(self.buf), not self.buf.strip()))

    def handle_endtag(self, tag):
        if tag in ("ol", "ul"):
            self.list_depth = max(0, self.list_depth - 1); self._flush()
        elif tag == "li":
            self._flush()
        elif tag in self.BLOCK:
            if not self.list_depth:
                self._flush()
        elif tag in ("strong", "b") and self.strong:
            start, opened_a_line = self.strong.pop()
            if opened_a_line:
                body = self.buf[start:].strip()
                if body and not body.endswith((":", ".", "!", "?", ",")):
                    self.buf += ": "
                elif body and not self.buf.endswith(" "):
                    self.buf += " "

    def handle_data(self, data):
        t = re.sub(r"\s+", " ", data)
        if not t:
            return
        if self.buf and not self.buf.endswith(" ") and not t.startswith(" "):
            t = " " + t
        if not self.buf:
            t = t.lstrip()
        self.buf += t

    def text(self):
        self._flush()
        return "\n".join(self.lines)


def html_to_text(raw):
    if not raw:
        return ""
    p = _Steps()
    p.feed(raw)
    p.close()
    return p.text()


# wger carries a few vendor-advert lines ("This is especially for the gym80
# device 3008 Abdominal Crunch."). They name a specific device/model and give
# no instruction, so they are dropped sentence-by-sentence; an entry left with
# nothing becomes eligible for the public-domain gap-fill.
_ADVERT = re.compile(r"(?i)\bdevice\b[^.]*\b\d{3,}\b|\b\d{3,}\b[^.]*\bdevice\b")


def strip_adverts(text):
    """Drop advert sentences WITHOUT destroying the step structure: the split
    runs per LINE, so a step boundary (a newline) is never merged into a space."""
    if not text:
        return ""
    lines = []
    for line in text.split("\n"):
        kept = [s for s in re.split(r"(?<=[.!?])\s+", line) if s and not _ADVERT.search(s)]
        joined = " ".join(kept).strip()
        if joined:
            lines.append(joined)
    return "\n".join(lines)


def cap(text, limit=CAP):
    """Cut to <=limit chars, preferring a whole-step boundary, else a word one."""
    if len(text) <= limit:
        return text
    head = text[:limit]
    nl = head.rfind("\n")
    if nl >= limit * 0.5:
        return head[:nl].rstrip()
    sp = head.rfind(" ")
    return (head[:sp] if sp > 0 else head).rstrip()


# ---------------------------------------------------------------- gap-fill ---

def norm(s):
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _strip_paren(s):
    return re.sub(r"\([^)]*\)", " ", s).strip()


def fedb_index(rows):
    """name-key -> [instructions]; a key mapping to more than one exercise is
    ambiguous and will be refused at match time."""
    idx = {}
    for r in rows:
        ins = [str(x).strip() for x in (r.get("instructions") or []) if str(x).strip()]
        if not ins:
            continue
        for key in {norm(r.get("name", "")), norm(_strip_paren(r.get("name", "")))}:
            if key:
                idx.setdefault(key, []).append(ins)
    return idx


def match_cue(name, idx):
    """Return the instructions list for a confident, unambiguous name match,
    else None. Aliases tried: exact normalised name, parenthetical-stripped
    name, and a spacing-only alias (compact form)."""
    bases = [norm(name), norm(_strip_paren(name))]
    keys = []
    for b in bases:
        if b:
            keys.append(b)
            keys.append(b.replace(" ", ""))
    seen = set()
    for k in keys:
        if not k or k in seen:
            continue
        seen.add(k)
        hits = idx.get(k)
        if hits and len(hits) == 1:
            return hits[0]
    return None


def fetch_fedb():
    try:
        req = urllib.request.Request(FEDB_URL, headers={"User-Agent": "iron-ledger-fetch/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except Exception as e:                                        # noqa: BLE001
        print(f"  WARNING: could not fetch free-exercise-db ({e}); "
              f"leaving thin cues as-is (no guessing).")
        return None


# -------------------------------------------------------------------- main ---

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
            desc = strip_adverts(html_to_text(t.get("description") or ""))
            cat = ex.get("category")
            cat = cat.get("name") if isinstance(cat, dict) else cats.get(cat, "Other")
            entry = {
                "id": ex["id"], "name": name, "cat": cat or "Other",
                "prim": [musc[m] for m in ids(ex.get("muscles")) if m in musc],
                "sec": [musc[m] for m in ids(ex.get("muscles_secondary")) if m in musc],
                "eq": [equip[e] for e in ids(ex.get("equipment")) if e in equip],
                "desc": cap(desc),
            }
            lib.append(entry)
        offset += 100
        print(f"  {len(lib)}/{total}")
        if offset >= total:
            break

    # ---- gap-fill thin/empty cues from the public-domain dataset ----
    rows = fetch_fedb()
    filled, unmatched, already = 0, [], 0
    if rows is not None:
        idx = fedb_index(rows)
        for x in lib:
            if len(x["desc"].strip()) >= THIN:
                already += 1
                continue
            ins = match_cue(x["name"], idx)
            if ins:
                x["desc"] = cap("\n".join(ins))
                x["fedb"] = 1
                filled += 1
            else:
                unmatched.append(x["name"])
        print(f"  gap-fill: {filled} matched, {len(unmatched)} left with no cue "
              f"({already} already had a cue)")

    # compact form consumed by the app
    compact = [{
        "id": x["id"], "n": x["name"], "c": x["cat"],
        "p": x["prim"], "s": x["sec"], "e": x["eq"],
        "m": mode_for(x), "g": groups_for(x), "d": x["desc"],
        **({"f": 1} if x.get("fedb") else {}),
    } for x in lib]
    compact.sort(key=lambda z: (z["c"], z["n"]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(compact, separators=(",", ":")))
    print(f"\nwrote {OUT} — {len(compact)} exercises, {OUT.stat().st_size/1024:.0f} KB")
    if rows is not None:
        print(f"gap-filled from free-exercise-db (public domain): {filled}")
        print(f"still no cue: {sum(1 for z in compact if not z['d'].strip())}")
        print("unmatched sample (no cue left in place):")
        for n in unmatched[:25]:
            print(f"  - {n}")
    print("now run: python3 tools/build_data.py")


if __name__ == "__main__":
    main()
