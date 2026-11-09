#!/usr/bin/env python3
"""Sweep a bundled JSON corpus's name fields for terms needing a curation decision.

WHY THIS EXISTS: `grep -c <term> corpus.json` counts LINES, not occurrences. On a
minified or single-line JSON every term therefore reports `1`, so the sweep looks
both clean and thorough while finding nothing. Parse the data and count inside the
name field instead.

Every hit needs a HUMAN decision - a match is not automatically a defect. A term
that reads badly in English can be ordinary vocabulary in another language (a food
name in Spanish), and a dated folk name can be the standard catalogue name for a
species. Confirm each hit before renaming it, and put accepted renames in the
build script rather than editing generated data.

KNOWN_OK (below) is the explicit FALSE-POSITIVE list: shipped names that DO contain
a seed term but are confirmed to be correct as-is. A hit on one of these is
reported but does NOT fail the sweep, so the sweep can gate a build or a review
without tripping over them. Any hit NOT in KNOWN_OK is a real finding.

USAGE
    corpus-name-sweep.py CORPUS.json [--array foods] [--field name] [--terms FILE]
    corpus-name-sweep.py data/food.json --array foods --field name

EXIT STATUS
    1 if any term matched that is NOT on the KNOWN_OK allowlist (so it can gate a
    build/review), 0 if the corpus is clean OR every match is a known false positive.
"""

import argparse
import json
import sys

# Seed list: dated or loaded terminology that tends to appear in legacy reference
# corpora (USDA-era food tables, old exercise catalogues). Extend per corpus.
DEFAULT_TERMS = [
    "oriental", "negro", "colored", "half-breed", "gypsy", "eskimo",
    "cripple", "lame", "midget", "idiot", "moron",
]

# Explicit FALSE-POSITIVE allowlist: exact shipped names confirmed NOT to be
# defects, so the sweep can gate without failing on them. Each carries its reason.
KNOWN_OK = {
    # "negros" = Spanish for "black" (frijoles negros = black beans). Ordinary
    # vocabulary in the dish's own language, not a slur in English.
    "Restaurant, Latino, Arroz con frijoles negros (rice and black beans)",
    # "colored" = food colouring (an artificially coloured drink). A plain sensory
    # descriptor, not a term about people.
    "Beverages, yellow green colored citrus soft drink with caffeine",
}


def load_records(doc, array_key):
    """Return the list of records, tolerating {key: [...]} or a bare list."""
    if isinstance(doc, list):
        return doc
    if array_key and isinstance(doc.get(array_key), list):
        return doc[array_key]
    # Fall back to the first list-of-dicts value in a wrapper object.
    for value in doc.values():
        if isinstance(value, list) and value and isinstance(value[0], dict):
            return value
    raise SystemExit("no record array found - pass --array <key>")


def find_hits(records, field="name", terms=None):
    """Return [(term, name), ...] for every record whose `field` contains a term.

    Reusable so a build can call this directly instead of shelling out.
    """
    terms = DEFAULT_TERMS if terms is None else terms
    hits = []
    for term in terms:
        for r in records:
            name = str(r.get(field, ""))
            if term in name.lower():
                hits.append((term, name))
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus")
    ap.add_argument("--array", default=None, help="key holding the record list")
    ap.add_argument("--field", default="name", help="field to scan (default: name)")
    ap.add_argument("--terms", default=None, help="file with one term per line")
    args = ap.parse_args()

    terms = DEFAULT_TERMS
    if args.terms:
        with open(args.terms, encoding="utf-8") as fh:
            terms = [t.strip().lower() for t in fh if t.strip()]

    with open(args.corpus, encoding="utf-8") as fh:
        doc = json.load(fh)
    records = load_records(doc, args.array)

    print(f"corpus: {args.corpus}")
    print(f"records: {len(records)}")
    print(f"scanning field: {args.field}\n")

    hits = find_hits(records, args.field, terms)
    by_term = {}
    for term, name in hits:
        by_term.setdefault(term, []).append(name)

    unknown = [(t, n) for (t, n) in hits if n not in KNOWN_OK]
    known = [(t, n) for (t, n) in hits if n in KNOWN_OK]

    for term in sorted(by_term):
        names = by_term[term]
        print(f"{term}: {len(names)}")
        for name in names[:8]:
            tag = "  [known OK]" if name in KNOWN_OK else ""
            print(f"    - {name}{tag}")
        if len(names) > 8:
            print(f"    ... and {len(names) - 8} more")

    print(f"\nknown false positives (allowed, not a defect): {len(known)}")
    for _t, n in known:
        print(f"    - {n}")

    if unknown:
        print(f"\n{len(unknown)} match(es) need a curation decision.")
        print("Confirm each is genuinely a problem AND that the correction is a real")
        print("improvement before renaming; put accepted renames in the build script.")
        return 1

    if known:
        print(f"\nclean apart from {len(known)} known false positive(s).")
    else:
        print("clean: no term from the list appears in the corpus names.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
