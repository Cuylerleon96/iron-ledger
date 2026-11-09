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
         (3) their per-100 g MACRO VECTOR agrees — protein, fat, carb and (when
             both sides state it) fibre — see the gate below. Without (3) two
             DIFFERENT products whose energy merely coincides are folded into one
             row and the loser's macros are silently hidden. THE TRADE-OFF:
             (3) is deliberately strict, so near-twins whose data GENUINELY
             differs stay as SEPARATE rows and a search can show two
             similar-looking entries again. That is the correct outcome — two
             honest rows, each with its own macros, beat one row hiding the
             other. Do NOT loosen (3) to make a list look tidier.

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
     hid the other value. So a twin must also agree on protein, fat and carb
     (fibre too when both sides state it). Tolerance per nutrient: <= 1 g OR
     <= 15% of the smaller value — the same relative width as the energy gate,
     and 1 g/100 g sits inside the spread between the two USDA databases for the
     SAME food (banana: protein 0.74 vs 1.09 = 0.35 g; fibre 1.7 vs 2.6 = 0.9 g
     — both still merge), while a different product is left apart (lamb: 8 g).
     ABSENT IS NOT ZERO: a nutrient present on ONE side only is a disagreement,
     not a zero, and blocks the merge; only a nutrient absent from BOTH is
     skipped. */
  const MACRO_TOL_REL = 0.15, MACRO_TOL_ABS = 1;
  const MACRO_KEYS = ["protein", "fat", "carb", "fibre"];

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

  /* the twin test: MATCH-KEY identity AND an agreeing energy figure AND an
     agreeing macro vector. Two rows with no usable energy are NEVER merged
     (nothing is guessed), and neither are rows that disagree on a macro. */
  const isTwin = (a, b) => {
    if (!a || !b || a === b) return false;
    if (twinKey(a.name) !== twinKey(b.name)) return false;
    const ka = kcalPer100(a), kb = kcalPer100(b);
    if (ka == null || kb == null) return false;
    if (Math.abs(ka - kb) > Math.max(KCAL_TOL_ABS, KCAL_TOL_REL * Math.min(ka, kb))) return false;
    return macrosAgree(a, b);
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
     twin, and it is never dropped. */
  const dedupe = (list, exactKey) => {
    const rows = Array.isArray(list) ? list : [];
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const k = twinKey(rows[i] && rows[i].name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const drop = new Set();          // indices hidden
    const alts = new Map();          // kept index -> absorbed rows
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
      clusters.forEach((c) => {
        if (c.members.length < 2) return;
        /* the named row wins the row; otherwise the most useful one does. */
        let rep = null;
        if (exactKey != null) {
          for (let j = 0; j < c.members.length; j++) {
            if (nameKey(rows[c.members[j]].name) === exactKey) { rep = c.members[j]; break; }
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
          if (exactKey != null && nameKey(rows[i].name) === exactKey) return;   // full-name query keeps it
          drop.add(i); absorbed.push(rows[i]);
        });
        if (absorbed.length) alts.set(rep, (alts.get(rep) || []).concat(absorbed));
      });
    });
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      if (drop.has(i)) continue;
      out.push(alts.has(i) ? Object.assign({}, rows[i], { alternates: alts.get(i) }) : rows[i]);
    }
    return { list: out, removed: drop.size };
  };

  /* ---------- search ----------
     Ranked matches. A prefix match outranks a substring match; ties break on
     match position, then shorter name, then code, then original order — fully
     deterministic and stable. The ranked list is then TWIN-COLLAPSED (see above)
     and the cap applied, so a duplicate pair costs the list one row, not two.
     Records that absorbed a twin come back as shallow copies carrying
     `.alternates`; every other row is the dataset record itself. */
  const search = (db, query, limit) => {
    const q = norm(query);
    if (!q) return [];
    const cap = (limit == null || limit < 0) ? 20 : limit;
    if (cap === 0) return [];
    const hits = [];
    const foods = foodsOf(db);
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
    const ranked = hits.map((h) => h.food);
    return dedupe(ranked, nameKey(query)).list.slice(0, cap);
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
    /* duplicate collapse (FNDDS vs SR Legacy) */
    dedupe, nameKey, twinKey, isTwin, measureScore, KCAL_TOL_REL, KCAL_TOL_ABS, OPTIONAL_TAIL,
    nutrientPer100, macrosAgree, MACRO_KEYS, MACRO_TOL_REL, MACRO_TOL_ABS,
  };
})();
if (typeof module !== "undefined") module.exports = Food;
