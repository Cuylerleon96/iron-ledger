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

  /* ---------- search ----------
     Ranked matches. A prefix match outranks a substring match; ties break on
     match position, then shorter name, then code, then original order — fully
     deterministic and stable. Returns the food records themselves, ranked. */
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
    return hits.slice(0, cap).map((h) => h.food);
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
  };
})();
if (typeof module !== "undefined") module.exports = Food;
