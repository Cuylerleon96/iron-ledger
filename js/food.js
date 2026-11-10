/* food.js — pure offline food model. No DOM, no storage, no network, and nothing
   read from global state: the database is always an ARGUMENT (injectable), so the
   same module serves a small test fixture AND the full bundled set in
   js/fooddata.js (const FOOD_DB). Same shape as engine.js / macros.js: an IIFE
   whose entire surface is one explicit return object.

   Rules: never invent grams (an unknown measure is null, not a guess); an absent
   nutrient stays absent (not 0). The user-food store and barcode cache are DATA
   ONLY — they mutate a plain object the caller owns; there are no storage side
   effects. The live barcode lookup is a named stub for the next batch. */
const Food = (() => {
  "use strict";

  const round2 = (x) => Math.round(x * 100) / 100;
  const norm = (s) => String(s == null ? "" : s).toLowerCase().trim();

  /* The database may be passed as {foods:[...]} or as a bare array. */
  const foodsOf = (db) =>
    (Array.isArray(db) ? db : (db && Array.isArray(db.foods) ? db.foods : []));

  /* ---------- duplicate collapse (the FNDDS vs SR Legacy overlap) ----------
     The bundle carries BOTH USDA databases, and they describe overlapping foods:
     searching "banana" returned "Banana, raw" (FNDDS, 97 kcal/100 g) and
     "Bananas, raw" (SR Legacy, 89 kcal/100 g) as two near-identical rows with
     different numbers — confusing, and it makes the day's totals look untrust-
     worthy. THE DATASET IS NOT TOUCHED: this collapses the SEARCH RESULT LIST
     only, so one food shows one row.

     RULE (stated here and tested in tools/test_food.js):
       two foods are TWINS when
         (1) their NORMALISED MATCH KEYS are equal — lower-cased, punctuation
             dropped and English plurals folded word by word (bananas -> banana,
             candies -> candy, RADISHES -> radish, tomatoes -> tomato), so
             "Radishes, raw" and "Radish" share the stem "radish"; AND
         (2) their per-100 g ENERGY agrees within tolerance: <= 5 kcal, or <= 15%
             of the smaller value. The two databases are sampled and analysed
             separately, so the SAME food lands a few percent apart (banana: 97
             vs 89 kcal = 8% — merged); a genuinely different food does not sit
             that close ("Kale, raw" 35 vs 43 kcal = 23% — deliberately NOT
             merged). Without (2) a pure name collision could hide a real food;
             AND
         (3) then the NAME decides how strict the macro test must be, because
             the two rules a user cares about are "rows I cannot tell apart must
             not both appear" and "a material difference must never be hidden":
             (a) IDENTICAL names ("Spinach, raw" vs "Spinach, raw" — differing
                 CASE or PUNCTUATION counts as identical, and a folded plural is
                 NOT identical: "Carrots" != "Carrot") are the same food the user
                 cannot tell apart, so they ALWAYS collapse, whatever their
                 values. If the absorbed row's numbers differ MATERIALLY, the
                 disagreement is DISCLOSED on the picked-food card (see
                 materialDiffs below) instead of hidden.
             (b) NEAR-TWINS whose names differ (a folded plural, or the implied
                 "raw" state) collapse ONLY when their per-100 g MACRO VECTOR
                 agrees within tolerance (protein, fat, carb, plus fibre when
                 both sides state it — see the gate below). When it does not they
                 stay as SEPARATE rows, and each such row then carries a
                 distinguishing figure (protein per 100 g) so the choice is
                 informed rather than a coin-flip on a 1 kcal difference.

     THE PLURAL CASE, and the one qualifier that comes with it. The trailing
     plural is normalised word by word (-s, -ies, -es after ch/sh/ss/x/z, -oes);
     that alone merges nothing new, because the real FNDDS/SR duplicate also
     differs by a word: the FNDDS survey description OMITS the implied state that
     SR Legacy spells out last ("Radish" vs "Radishes, raw"; "Veal, ground" vs
     "Veal, ground, raw"; "Tamarind" vs "Tamarinds, raw"). The key therefore also
     drops ONE trailing "raw" token, and that list is deliberately CLOSED at that
     single token. Any OTHER trailing qualifier is a different food and keeps its
     own row: "Radishes, pickled" is not "Radish" (34 vs 16 kcal), "Bread, white"
     is not "Bread, white wheat" (238 vs 267), "Waffle, plain" is not "Waffle,
     plain, frozen" (373 vs 309), "Bread, rye" is not "Bread, rye, toasted"
     (259 vs 284). A name that differs by more than a plural (or by that implied
     raw state) is NEVER merged on the name alone — and inside a matching key the
     energy gate (2) still decides: 20 same-key pairs are held apart by it (e.g.
     "Rhubarb, raw" 21 vs "Rhubarb" 73, "Kale, raw" 35 vs 43, "Millet, raw" 378
     vs "Millet" 118). The gate, not the name, is what keeps those apart.

     Of a twin set we KEEP the entry with the more useful portioning measures
     (how many measures carry a real gram weight), then the one stating more
     nutrients, then the lower code — fully deterministic, so the same search
     always keeps the same row. ONE exception, there to keep a full-name search
     honest: when the query IS the exact normalised name of one of the collapsed
     rows (the query "radish" names the row "Radish"), THAT row is the one kept
     and shown — still one row, and it is the row the user actually named.

     HARD CONSTRAINTS, both enforced and asserted:
       - NO FOOD BECOMES UNREACHABLE. A full-name query keeps the row it names
         (above), and every dropped twin is attached to the kept row as
         `.alternates` so the UI can offer it.
       - LOGGED HISTORY IS UNTOUCHED. This shapes a returned LIST only: nothing
         already logged is read, rewritten or recomputed, and an intake entry
         snapshots its own name and macros at log time (see js/store.js). */
  const KCAL_TOL_REL = 0.15, KCAL_TOL_ABS = 5;

  /* (3) the MACRO-VECTOR gate, in ADDITION to the energy gate. Energy alone is
     NOT identity: measured on the shipped kcal-only rule, "Lamb, ground, raw"
     (282 kcal, P 16.56, F 23.41) and "Lamb, ground" (281 kcal, P 24.55, F 19.49)
     merged — different products, ~8 g protein/100 g apart, and collapsing them
     hid the other value. So a NAME-DIFFERING near-twin must also agree on
     protein, fat and carb (fibre too when both sides state it).

     THE WIDTH, measured on the shipped bundle rather than guessed. The 18 pairs
     the old 1 g gate held apart split cleanly in two: ELEVEN have the SAME
     normalised name (spinach, garlic, monterey, parmesan, mexican blend, feta,
     cottage cheese, oat-bran bread, two pancake entries, strudel) — indisputably
     one food, so they collapse under rule (a), tolerance irrelevant; SEVEN have
     a name that differs by a plural or the implied raw state. Of those seven,
     five agree to within 2.4 g on every shared nutrient (caramels' fat 2.4 g,
     pumpernickel's protein 2.1 g, bagels' and muffins' fibre 2.1 g) — plainly the
     same food sampled by two databases — while lamb (8.0 g protein apart) and
     veal (7.0 g) are genuinely DIFFERENT products. A 3 g/100 g absolute term
     therefore sits above the whole same-food spread and below the
     different-product gap. RELATIVE width stays 15%, the same as the energy gate.
     ABSENT IS NOT ZERO: a nutrient present on ONE side only is a disagreement,
     not a zero, and blocks the merge; only a nutrient absent from BOTH is
     skipped. */
  const MACRO_TOL_REL = 0.15, MACRO_TOL_ABS = 3;
  const MACRO_KEYS = ["protein", "fat", "carb", "fibre"];

  /* MATERIAL DIFFERENCE, for the disclosure on the picked-food card. When rule
     (a) collapses two IDENTICAL names whatever their values, a large gap must
     not vanish silently — the card says so. A gap counts as material when a
     shared macro differs by MORE THAN 2 g/100 g AND by more than 10% of the
     larger value, or energy differs by MORE THAN 20 kcal AND more than 10%.
     Justification: on the indisputable identical-name twins the two databases
     agree to within ~1.2 g on the small nutrients (spinach's carb 3.63 vs 2.41),
     so 2 g is clear of sampling noise, while the real disagreements are far
     larger (parmesan protein 35.75 vs 29.87 = 5.9 g; reduced-fat pancakes fat
     1.9 vs 9.74 = 7.8 g). The 10% term stops a big absolute on a big base
     (mexican blend's fat 32.14 vs 29.34 = 8.7%) being announced. */
  const MATERIAL_TOL_ABS = 2, MATERIAL_TOL_REL = 0.10, MATERIAL_KCAL_ABS = 20;

  /* lower-case + strip punctuation + fold English plurals word by word.
     "Bananas, raw" and "Banana, raw" collapse to one key; "Radishes, raw" and
     "Radish" fold to "radish"/"radish raw"; "Banana, baked" stays apart. */
  const singular = (w) =>
    (w.length > 3 && /ies$/.test(w)) ? w.slice(0, -3) + "y"
      : (w.length > 4 && /(?:ch|sh|ss|x|z)es$/.test(w)) ? w.slice(0, -2)   // radishes -> radish
        : (w.length > 3 && /oes$/.test(w)) ? w.slice(0, -2)                // tomatoes -> tomato
          : (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) ? w.slice(0, -1)
            : w;
  const nameKey = (s) =>
    norm(s).replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(singular).join(" ");

  /* the IDENTICAL-name key: lower-cased and punctuation-stripped like nameKey
     but WITHOUT the plural fold, so "Spinach, raw" == "Spinach, raw" (and
     "Cheese, Parmesan, hard" == "Cheese, parmesan, hard": case is noise) while
     "Carrots" != "Carrot" — a plural is a visible difference, so a plural twin
     falls to the FOLDED key and its values must agree (rule (b)). */
  const exactKey = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

  /* the MATCH key: nameKey with ONE optional trailing state word removed. The
     list is closed at "raw" on purpose (see the rule above): FNDDS omits the
     implied raw state that SR Legacy states, and nothing else may be dropped. */
  const OPTIONAL_TAIL = ["raw"];
  const twinKey = (s) => {
    const w = nameKey(s).split(" ").filter(Boolean);
    while (w.length > 1 && OPTIONAL_TAIL.indexOf(w[w.length - 1]) >= 0) w.pop();
    return w.join(" ");
  };


  const nutrientPer100 = (f, k) =>
    (f && f.per100 && typeof f.per100[k] === "number" && isFinite(f.per100[k])) ? f.per100[k] : null;
  const kcalPer100 = (f) => nutrientPer100(f, "kcal");

  /* the macro vector must agree. A nutrient present on ONE side only is a
     disagreement (absent is not zero); a nutrient absent from BOTH is skipped. */
  const macrosAgree = (a, b) => {
    for (let i = 0; i < MACRO_KEYS.length; i++) {
      const va = nutrientPer100(a, MACRO_KEYS[i]), vb = nutrientPer100(b, MACRO_KEYS[i]);
      if (va == null && vb == null) continue;
      if (va == null || vb == null) return false;
      if (Math.abs(va - vb) > Math.max(MACRO_TOL_ABS, MACRO_TOL_REL * Math.min(va, vb))) return false;
    }
    return true;
  };
  const measureScore = (f) =>
    ((f && Array.isArray(f.measures)) ? f.measures : [])
      .filter((m) => m && m.label && isFinite(m.grams) && m.grams > 0).length;
  const nutrientCount = (f) => (f && f.per100) ? Object.keys(f.per100).length : 0;

  /* the twin test: MATCH-KEY identity AND an agreeing energy figure AND — for a
     name that DIFFERS at all — an agreeing macro vector. Two rows with no usable
     energy are NEVER merged (nothing is guessed). Two rows with the SAME
     normalised name (rule (a)) collapse whatever their values, because the user
     cannot tell them apart; a material gap between them is surfaced by
     materialDiffs() on the card rather than swallowed. */
  const isTwin = (a, b) => {
    if (!a || !b || a === b) return false;
    if (twinKey(a.name) !== twinKey(b.name)) return false;
    const ka = kcalPer100(a), kb = kcalPer100(b);
    if (ka == null || kb == null) return false;
    if (Math.abs(ka - kb) > Math.max(KCAL_TOL_ABS, KCAL_TOL_REL * Math.min(ka, kb))) return false;
    if (exactKey(a.name) === exactKey(b.name)) return true;      // (a) identical name: always one row
    return macrosAgree(a, b);                                    // (b) name differs: values must agree
  };

  /* Which shared nutrients differ MATERIALLY between a kept row and an absorbed
     alternate — the disagreement the card must state in plain words. Returns one
     entry per nutrient (and/or kcal) that crosses the materiality threshold
     above; [] when the two rows agree closely enough to say nothing. Absent on
     one side is not a difference to announce here (rule (b) already keeps such a
     pair apart); it is skipped. */
  const materialDiffs = (kept, alt) => {
    const out = [];
    const push = (key, a, b, absTol) => {
      if (a == null || b == null) return;
      if (Math.abs(a - b) > Math.max(absTol, MATERIAL_TOL_REL * Math.max(a, b))) out.push({ key, kept: a, alt: b });
    };
    MACRO_KEYS.forEach((k) => push(k, nutrientPer100(kept, k), nutrientPer100(alt, k), MATERIAL_TOL_ABS));
    push("kcal", kcalPer100(kept), kcalPer100(alt), MATERIAL_KCAL_ABS);
    return out;
  };

  /* which of two twins to KEEP (deterministic). */
  const keepBetter = (a, b) => {
    const sa = measureScore(a), sb = measureScore(b);
    if (sa !== sb) return sa > sb ? a : b;
    const na = nutrientCount(a), nb = nutrientCount(b);
    if (na !== nb) return na > nb ? a : b;
    const ca = (a.code == null ? Infinity : a.code), cb = (b.code == null ? Infinity : b.code);
    return ca <= cb ? a : b;
  };

  /* Collapse twins in a ranked LIST -> { list, removed }.
     `list` keeps the surviving rows in their original rank order, and every kept
     row that absorbed a twin carries `.alternates` (those rows). `removed` is the
     number of rows dropped. `exactKey`, when supplied, is the normalised FULL name
     of the QUERY (nameKey, not twinKey): the row whose own name equals it is the
     one KEPT — so a full-name search shows the row it named instead of hiding the
     twin, and it is never dropped.

     A row that belongs to a key group the collapse could NOT fully merge — i.e.
     a genuine near-twin that stayed split (lamb/veal) — comes back carrying
     `.split = true`, so the UI can add the distinguishing protein figure to that
     row. Rows in fully-collapsed groups do NOT carry it. */
  const dedupe = (list, exactKeyArg) => {
    const rows = Array.isArray(list) ? list : [];
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const k = twinKey(rows[i] && rows[i].name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const drop = new Set();          // indices hidden
    const alts = new Map();          // kept index -> absorbed rows
    const split = new Set();         // indices in a group that stayed split
    groups.forEach((idxs) => {
      if (idxs.length < 2) return;
      /* cluster inside the key group: only energy-agreeing rows are twins. */
      const clusters = [];
      idxs.forEach((i) => {
        let found = null;
        for (let j = 0; j < clusters.length; j++) {
          if (isTwin(rows[clusters[j].rep], rows[i])) { found = clusters[j]; break; }
        }
        if (found) found.members.push(i); else clusters.push({ rep: i, members: [i] });
      });
      /* more than one cluster = rows in this group did NOT all merge: the choice
         between them is real, so each surviving row must be tellable apart. */
      if (clusters.length > 1) clusters.forEach((c) => c.members.forEach((i) => split.add(i)));
      clusters.forEach((c) => {
        if (c.members.length < 2) return;
        /* the named row wins the row; otherwise the most useful one does. */
        let rep = null;
        if (exactKeyArg != null) {
          for (let j = 0; j < c.members.length; j++) {
            if (nameKey(rows[c.members[j]].name) === exactKeyArg) { rep = c.members[j]; break; }
          }
        }
        if (rep == null) {
          rep = c.members[0];
          for (let j = 1; j < c.members.length; j++) {
            if (keepBetter(rows[rep], rows[c.members[j]]) === rows[c.members[j]]) rep = c.members[j];
          }
        }
        const absorbed = [];
        c.members.forEach((i) => {
          if (i === rep) return;
          drop.add(i); absorbed.push(rows[i]);
        });
        if (absorbed.length) alts.set(rep, (alts.get(rep) || []).concat(absorbed));
      });
    });
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      if (drop.has(i)) continue;
      const extra = alts.get(i);
      if (extra || split.has(i)) {
        out.push(Object.assign({}, rows[i], split.has(i) ? { split: true } : {}, extra ? { alternates: extra } : {}));
      } else {
        out.push(rows[i]);
      }
    }
    return { list: out, removed: drop.size };
  };

  /* ---------- QUERY-SIDE ALIAS MAP — a search AID, NOT a change to the food data ----------
     the owner: "It seems sodas aren't in the nutrition list?" They ARE: data/food.json
     ships 85 soda-type rows. They were simply UNFINDABLE, because the search is a
     plain substring match with no synonym layer and USDA names a soda in its own
     vocabulary ("Beverages, carbonated, cola, regular"). Measured on the old search:
     "soda" led with LEAVENING AGENTS, BAKING SODA and saltines ("includes oyster,
     soda, soup"); "coke" matched nothing at all; "cola" led with chocolate, because
     the substring "cola" sits inside "choCOLAte".

     THIS MAP IS APPLIED TO THE QUERY ONLY. The USDA names are the data citation and
     are NEVER renamed — every value on the right is a literal string that already
     occurs in data/food.json (asserted in tools/test_food.js). A query expands to its
     targets, which are searched ALONGSIDE the literal query. The targets say nothing
     about a food's merit — a soda is loggable and neutral like any other food. */
  const SEARCH_ALIASES = {
    "soda":       ["carbonated"],
    "pop":        ["carbonated"],
    "fizzy":      ["carbonated"],
    "soft drink": ["carbonated"],
    "coke":       ["carbonated, cola", "cola"],
    "coca cola":  ["carbonated, cola", "cola"],
    "coca-cola":  ["carbonated, cola", "cola"],
    "cola":       ["carbonated, cola"],
    "pepsi":      ["cola"],                       // the data has NO Pepsi cola row; PEPSI appears only as AQUAFINA water / PEPSICO Gatorade, so "pepsi" maps onto the cola category the data does name
    "sprite":     ["carbonated, lemon-lime"],
    "7up":        ["carbonated, lemon-lime"],
    /* The whole pepper-type family, which the data names two ways: the SR row says
       "Beverages, carbonated, pepper-type, contains caffeine" and one low-calorie SR
       row says "pepper-types", while the FNDDS cluster says "Soft drink, pepper type"
       (a space). Each spelling has to be its OWN target: the matcher treats '-' as a
       word character, so "pepper-type" never matches inside "pepper type" and vice
       versa, and the plural "pepper-types" is a separate word again. All three are
       literal strings in data/food.json. */
    "dr pepper":  ["pepper-type", "pepper type", "pepper-types"],
    "diet":       ["low calorie", "reduced sugar", "aspartame"],

    /* ---------- EVERYDAY FOOD WORDS -> USDA's formal names (v1.3.20) ----------
       Same query-side rule as above: the data is NEVER renamed; each value is a
       literal string the shipped data already uses. These are the words a person
       types, where USDA names the food in its own catalogue vocabulary — mostly
       British words for foods the US database files under the US word. Measured
       zero-row or wrong-led before this map (see tools/test_food.js).

       A value is either an ARRAY — every target is a PRIMARY target, which is the
       behaviour the map has always had — or an OBJECT {primary, secondary} that
       declares an ORDERED-TIER split for a word with two live readings. The tiers
       exist so a value can say "the US meaning first, the other reading after":
       ranking places a PRIMARY-target match above a SECONDARY-target match, above
       the whole-word literal group, above substring, with the same tie-breaks
       inside every tier. A key that declares no split (still an array) ranks
       EXACTLY as before, byte-for-byte.

       THE AMBIGUOUS WORDS (the owner: "Prioritize us terms, and include the rest"):
         chips   — US "chips" is a packet of potato chips; the other reading (UK
                   chips = US fries) is still reachable, ranked after.
         biscuit — US "biscuit" is the dataset's own savoury quick bread (its rows
                   literally say "Biscuit(s)"); the other reading (a cookie) is
                   reachable, ranked after. Neither reading is renamed or hidden.
       A word that names a food is a food word — mapping it says nothing about
       the food's merit. */
    "aubergine":  ["eggplant"],
    "courgette":  ["zucchini"],
    "courgettes": ["zucchini"],
    "prawn":      ["shrimp"],
    "prawns":     ["shrimp"],
    "yoghurt":    ["yogurt"],
    "beetroot":   ["beets"],
    "swede":      ["rutabaga"],
    "rocket":     ["arugula"],
    "spring onion": ["scallions"],
    "capsicum":   ["peppers"],
    "mangetout":  ["edible-podded"],
    "marrow":     ["squash", "zucchini"],
    "sultanas":   ["raisins"],
    "mince":      ["beef, ground"],
    "minced beef": ["beef, ground"],
    "porridge":   ["oatmeal"],
    "omelette":   ["omelet"],
    "donut":      ["doughnut"],
    "milkshake":  ["shake"],
    "sparkling water": ["club soda"],
    "tinned tomatoes": ["tomatoes"],
    "sweets":     ["candy"],
    /* ---------- SWEEP (v1.3.21): further UK words the map did not cover ----------
       Measured BEFORE adding: each of these returned ZERO rows, and each target is the
       dataset's own row for that food (asserted literal below). Words that were
       CHECKED and deliberately NOT added (no literal row names the food): icing sugar
       (the only "powdered sugar" literal is a doughnut name), single cream, heavy
       cream, golden syrup, digestive, mushy peas, brown sauce — see the report. */
    "double cream":  ["cream, heavy"],    // UK double cream = US heavy cream ("Cream, heavy")
    "jacket potato": ["potato, baked"],   // UK jacket potato = US baked potato ("Potato, baked, ...")
    "candy floss":   ["candy, cotton"],   // UK candy floss = US cotton candy ("Candy, cotton")
    "banger":        ["sausage"],         // UK banger = US sausage
    "crisps":     ["potato chips"],   // UK crisps = US potato chips (no second reading; every target is primary)
    /* ORDERED-TIER keys — US meaning PRIMARY, the other reading SECONDARY (still reachable). */
    "chips":      { primary: ["potato chips"], secondary: ["french fries"] },
                  // US "chips" = potato chips; UK "chips" = US "french fries", kept reachable after.
    "biscuit":    { primary: ["biscuit", "biscuits"], secondary: ["cookies"] },
                  // US "biscuit" = the dataset's savoury quick bread (rows literally say Biscuit/Biscuits);
                  // the other reading (a cookie) is reachable, ranked after.
  };

  /* Case- and punctuation-insensitive form, used ONLY to look a query up in the map
     above — so "Coca-Cola" and "coca cola" reach the same key. */
  const aliasKey = (s) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

  /* Normalise a map value to the ordered-tier shape: an ARRAY means every target
     is PRIMARY (the original behaviour), an object declares the split. */
  const aliasValue = (v) =>
    (Array.isArray(v) ? { primary: v, secondary: [] }
      : { primary: (v && Array.isArray(v.primary)) ? v.primary : [],
          secondary: (v && Array.isArray(v.secondary)) ? v.secondary : [] });

  const ALIAS_KEYS = Object.keys(SEARCH_ALIASES).map((k) => [aliasKey(k), aliasValue(SEARCH_ALIASES[k])]);

  /* whole-word containment of `needle` in a space-normalised `hay`. */
  const wordContains = (hay, needle) => {
    let i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) {
      const before = i === 0 ? " " : hay[i - 1];
      const after = (i + needle.length >= hay.length) ? " " : hay[i + needle.length];
      if (before === " " && after === " ") return true;
      i += 1;
    }
    return false;
  };

  /* The alias targets a query expands to, as {primary, secondary}, or empty tiers
     when it names no alias. A multi-key query ("diet coke") collects the targets of
     every key it contains; a target listed as primary by any matching key is primary. */
  const aliasTiers = (query) => {
    const q = aliasKey(query);
    const primary = [], secondary = [];
    if (!q) return { primary: primary, secondary: secondary };
    for (let i = 0; i < ALIAS_KEYS.length; i++) {
      if (!wordContains(q, ALIAS_KEYS[i][0])) continue;
      const tv = ALIAS_KEYS[i][1];
      for (let j = 0; j < tv.primary.length; j++)
        if (primary.indexOf(tv.primary[j]) < 0) primary.push(tv.primary[j]);
      for (let j = 0; j < tv.secondary.length; j++)
        if (primary.indexOf(tv.secondary[j]) < 0 && secondary.indexOf(tv.secondary[j]) < 0)
          secondary.push(tv.secondary[j]);
    }
    return { primary: primary, secondary: secondary };
  };

  /* The flat list of every target a query expands to (primary + secondary), or []
     when it names no alias. Kept flat so callers can assert the whole map at once. */
  const expandAlias = (query) => {
    const t = aliasTiers(query);
    const out = [];
    for (let i = 0; i < t.primary.length; i++) out.push(t.primary[i]);
    for (let i = 0; i < t.secondary.length; i++) if (out.indexOf(t.secondary[i]) < 0) out.push(t.secondary[i]);
    return out;
  };

  /* A hyphen counts as a word character so a target never matches inside a NEGATED or
     hyphenated compound: "carbonated" must not match "non-carbonated" (bottled water),
     and "cola" must not match "chocolate". */
  const WORD_CH = /[a-z0-9-]/;
  const wordAt = (hay, needle) => {
    if (!needle) return -1;
    let i = 0;
    while ((i = hay.indexOf(needle, i)) >= 0) {
      const before = i === 0 ? "" : hay[i - 1];
      const after = (i + needle.length >= hay.length) ? "" : hay[i + needle.length];
      if (!WORD_CH.test(before) && !WORD_CH.test(after)) return i;
      i += 1;
    }
    return -1;
  };

  /* ---------- search ----------
     Ranked matches. A prefix match outranks a substring match; ties break on
     match position, then shorter name, then code, then original order — fully
     deterministic and stable. The ranked list is then TWIN-COLLAPSED (see above)
     and the cap applied, so a duplicate pair costs the list one row, not two.
     Records that absorbed a twin come back as shallow copies carrying
     `.alternates`; every other row is the dataset record itself.

     ALIAS-AWARE RANKING (only when the query names an alias — an ordinary query takes
     the original substring path, unchanged). For an alias query a row is placed in one
     of FOUR groups:
       0 — matched a PRIMARY alias TARGET (the US meaning the data names itself, so it
           ranks first, above the literal-word collisions);
       1 — matched a SECONDARY alias TARGET only (the other reading of an ambiguous
           word — reachable, ranked after the primary reading);
       2 — matched the literal query as a whole word (baking soda, saltines);
       3 — matched the literal query only as a substring (chocolate for "cola").
     A key with no primary/secondary split declares no secondary targets, so its rows
     only ever land in groups 0, 2 and 3 — i.e. the SAME order as the original three
     groups 0, 1, 2, byte-for-byte. Within a target group a row matching MORE of a
     multi-key query's targets ranks higher, so "diet coke" surfaces a diet cola before
     an arbitrary low-calorie food. The chosen order is the minimal expansion that puts
     the intended food on top while leaving every literal match reachable. */
  const search = (db, query, limit) => {
    const q = norm(query);
    if (!q) return [];
    const cap = (limit == null || limit < 0) ? 20 : limit;
    if (cap === 0) return [];
    const foods = foodsOf(db);
    const tiers = aliasTiers(query);
    const targets = tiers.primary.concat(tiers.secondary);

    /* No alias names this query: the original substring ranking, unchanged. */
    if (targets.length === 0) {
      const hits = [];
      for (let i = 0; i < foods.length; i++) {
        const name = norm(foods[i].name);
        const at = name.indexOf(q);
        if (at < 0) continue;
        hits.push({ food: foods[i], prefix: at === 0 ? 0 : 1, at: at, len: name.length, idx: i });
      }
      hits.sort((a, b) =>
        (a.prefix - b.prefix) ||          // prefix matches first
        (a.at - b.at) ||                  // earlier match position first
        (a.len - b.len) ||                // shorter name first
        (a.food.code - b.food.code) ||    // then by code
        (a.idx - b.idx));                 // then original order (stable)
      return dedupe(hits.map((h) => h.food), nameKey(query)).list.slice(0, cap);
    }

    /* Alias names this query: expand it and rank by the groups described above. */
    const hits = [];
    for (let i = 0; i < foods.length; i++) {
      const name = norm(foods[i].name);
      let pScore = 0, pAt = -1;
      for (let k = 0; k < tiers.primary.length; k++) {
        const pos = wordAt(name, tiers.primary[k]);
        if (pos >= 0) { pScore++; if (pAt < 0 || pos < pAt) pAt = pos; }
      }
      let sScore = 0, sAt = -1;
      for (let k = 0; k < tiers.secondary.length; k++) {
        const pos = wordAt(name, tiers.secondary[k]);
        if (pos >= 0) { sScore++; if (sAt < 0 || pos < sAt) sAt = pos; }
      }
      const rawWord = wordAt(name, q);
      const rawAt = name.indexOf(q);
      let group, score, at;
      if (pScore > 0) { group = 0; score = pScore; at = pAt; }
      else if (sScore > 0) { group = 1; score = sScore; at = sAt; }
      else if (rawWord >= 0) { group = 2; score = 0; at = rawWord; }
      else if (rawAt >= 0) { group = 3; score = 0; at = rawAt; }
      else continue;
      hits.push({ food: foods[i], group: group, score: score,
        prefix: at === 0 ? 0 : 1, at: at, len: name.length, idx: i });
    }
    hits.sort((a, b) =>
      (a.group - b.group) ||            // primary targets, then secondary, then literal word, then substring
      (b.score - a.score) ||            // ...and within a target tier, more matched targets first
      (a.prefix - b.prefix) ||
      (a.at - b.at) ||
      (a.len - b.len) ||
      (a.food.code - b.food.code) ||
      (a.idx - b.idx));
    return dedupe(hits.map((h) => h.food), nameKey(query)).list.slice(0, cap);
  };

  /* ---------- measures -> grams ----------
     Exact (case-insensitive, trimmed) label match. Returns the source gram
     weight, or null when the measure is unknown — grams are NEVER invented. */
  const measureToGrams = (food, measureLabel) => {
    if (!food || !Array.isArray(food.measures)) return null;
    const want = norm(measureLabel);
    if (!want) return null;
    for (let i = 0; i < food.measures.length; i++) {
      const m = food.measures[i];
      if (m && norm(m.label) === want && typeof m.grams === "number" && isFinite(m.grams)) {
        return m.grams;
      }
    }
    return null;
  };

  /* qty portions of a named measure -> grams, or null if the measure is unknown
     (or qty is not a finite number). qty defaults to 1. */
  const portionToGrams = (food, measureLabel, qty) => {
    const g = measureToGrams(food, measureLabel);
    if (g == null) return null;
    const n = (qty == null) ? 1 : Number(qty);
    if (!isFinite(n)) return null;
    return round2(g * n);
  };

  /* ---------- grams -> macros ----------
     Linear scale of the food's per-100 g values. A nutrient absent from
     food.per100 is ABSENT from the result (not 0); a nutrient the source states
     as 0 is returned as 0. */
  const gramsToMacros = (food, grams) => {
    const out = {};
    const g = Number(grams);
    if (!food || !food.per100 || !isFinite(g)) return out;
    const keys = Object.keys(food.per100);
    for (let i = 0; i < keys.length; i++) {
      const v = food.per100[keys[i]];
      if (typeof v === "number" && isFinite(v)) out[keys[i]] = round2(v * g / 100);
    }
    return out;
  };

  /* ---------- user-food store (DATA ONLY) ----------
     Operates on a plain store object the caller owns and persists however it
     likes. No localStorage, no network. */
  const createStore = () => ({ seq: 0, userFoods: [], barcodes: {} });

  const addUserFood = (store, food) => {
    if (!store || !food || !food.name) return null;
    const rec = {
      id: "u" + (++store.seq),
      name: String(food.name),
      per100: Object.assign({}, food.per100 || {}),
      measures: Array.isArray(food.measures)
        ? food.measures.map((m) => ({ label: String(m.label), grams: Number(m.grams) }))
        : [],
      src: "user",
    };
    store.userFoods.push(rec);
    return rec;
  };

  const getUserFood = (store, id) =>
    (store && store.userFoods.find((f) => f.id === id)) || null;

  const updateUserFood = (store, id, patch) => {
    const rec = getUserFood(store, id);
    if (!rec || !patch) return null;
    if (patch.name != null) rec.name = String(patch.name);
    if (patch.per100 != null) rec.per100 = Object.assign({}, patch.per100);
    if (patch.measures != null) {
      rec.measures = Array.isArray(patch.measures)
        ? patch.measures.map((m) => ({ label: String(m.label), grams: Number(m.grams) }))
        : [];
    }
    return rec;
  };

  const deleteUserFood = (store, id) => {
    if (!store) return false;
    const i = store.userFoods.findIndex((f) => f.id === id);
    if (i < 0) return false;
    store.userFoods.splice(i, 1);
    return true;
  };

  const listUserFoods = (store) => (store ? store.userFoods.slice() : []);

  /* ---------- barcode cache (DATA ONLY) ----------
     Records a packaged item that was looked up elsewhere; keyed by barcode. */
  const saveBarcode = (store, record) => {
    if (!store || !record || record.barcode == null) return null;
    const key = String(record.barcode);
    const rec = {
      barcode: key,
      name: record.name != null ? String(record.name) : "",
      per100: Object.assign({}, record.per100 || {}),
      measures: Array.isArray(record.measures)
        ? record.measures.map((m) => ({ label: String(m.label), grams: Number(m.grams) }))
        : [],
      source: record.source != null ? String(record.source) : "barcode",
    };
    store.barcodes[key] = rec;
    return rec;
  };

  const getBarcode = (store, barcode) =>
    (store && barcode != null && store.barcodes[String(barcode)]) || null;

  const deleteBarcode = (store, barcode) => {
    if (!store || barcode == null) return false;
    const key = String(barcode);
    if (!Object.prototype.hasOwnProperty.call(store.barcodes, key)) return false;
    delete store.barcodes[key];
    return true;
  };

  /* ---------- HOOK: live barcode lookup (NEXT BATCH) ----------
     Deliberately NOT implemented here: this module performs no network I/O. The
     next batch fills this in to return a record shaped exactly like the object
     saveBarcode() accepts ({barcode, name, per100, measures, source}). */
  const BARCODE_LOOKUP_IMPLEMENTED = false;
  const lookupBarcode = () => ({
    ok: false,
    implemented: BARCODE_LOOKUP_IMPLEMENTED,
    reason: "Live barcode lookup is not implemented in js/food.js; wire it in the next batch.",
  });

  return {
    /* search */
    search,
    /* measures */
    measureToGrams, portionToGrams,
    /* macros */
    gramsToMacros,
    /* user-food store */
    createStore, addUserFood, getUserFood, updateUserFood, deleteUserFood, listUserFoods,
    /* barcode cache */
    saveBarcode, getBarcode, deleteBarcode,
    /* next-batch hook */
    lookupBarcode, BARCODE_LOOKUP_IMPLEMENTED,
    /* internals exposed for callers/tests */
    foodsOf, norm, round2,
    /* query-side alias map (search aid, not data) */
    SEARCH_ALIASES, expandAlias, aliasTiers, aliasKey, wordAt,
    /* duplicate collapse (FNDDS vs SR Legacy) */
    dedupe, nameKey, exactKey, twinKey, isTwin, measureScore, KCAL_TOL_REL, KCAL_TOL_ABS, OPTIONAL_TAIL,
    nutrientPer100, macrosAgree, MACRO_KEYS, MACRO_TOL_REL, MACRO_TOL_ABS,
    materialDiffs, MATERIAL_TOL_ABS, MATERIAL_TOL_REL, MATERIAL_KCAL_ABS,
  };
})();
if (typeof module !== "undefined") module.exports = Food;
