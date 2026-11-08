/* Headless check for js/food.js — runs the REAL module in a vm context, exactly
   like tools/test_engine.js. The module is pure and injectable, so the unit
   cases use a small fixture and the dataset cases load the committed generated
   bundle js/fooddata.js (const FOOD_DB). */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
// Pin the zone BEFORE the first Date use so the local-date assertions are
// deterministic: 23:30 EST is already the next day in UTC, which is exactly the
// bug the app's local-date helper avoids.
process.env.TZ = process.env.TZ || 'America/New_York';

const ctx = { console, module: { exports: {} }, JSON, Math, Object, Array, Number,
  String, Boolean, isFinite, parseFloat, parseInt, Date, RegExp, Map, Set };
ctx.globalThis = ctx; vm.createContext(ctx);

const src = [
  fs.readFileSync(path.join(root, 'js/food.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'js/fooddata.js'), 'utf8'),
].join('\n;\n');
vm.runInContext(src + '\n;globalThis.__FOOD = Food; globalThis.__DB = FOOD_DB;', ctx,
  { filename: 'food-bundle.js' });

const Food = ctx.__FOOD, DB = ctx.__DB;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
};
const eq = (name, a, b) => ok(name, a === b, { got: a, want: b });
const near = (name, a, b) => ok(name, typeof a === 'number' && Math.abs(a - b) < 1e-9, { got: a, want: b });

console.log('module surface:', Object.keys(Food).join(', '));
console.log('dataset:', DB.foods.length, 'foods,',
  DB.foods.reduce((n, f) => n + f.measures.length, 0), 'measures');

/* ---------- (a) search: finds a food; prefix outranks substring ---------- */
const fixture = { foods: [
  { code: 1, name: 'Apple, raw', per100: { kcal: 52 }, measures: [{ label: '1 cup', grams: 125 }] },
  { code: 2, name: 'Pineapple, raw', per100: { kcal: 50 }, measures: [{ label: '1 cup', grams: 165 }] },
  { code: 3, name: 'Apple pie', per100: { kcal: 265 }, measures: [] },
] };
const r = Food.search(fixture, 'apple');
eq('search returns all 3 matches', r.length, 3);
ok('prefix match ranks first', r[0].name.toLowerCase().indexOf('apple') === 0, r.map(x => x.name));
eq('substring match ranks last', r[r.length - 1].code, 2);
eq('search respects limit', Food.search(fixture, 'apple', 1).length, 1);
eq('empty query -> []', Food.search(fixture, '').length, 0);
eq('no match -> []', Food.search(fixture, 'zzz').length, 0);
ok('search accepts a bare array db', Food.search(fixture.foods, 'apple').length === 3);
const rb = Food.search(DB, 'banana', 5);
ok('search finds a known real food', rb.length > 0 && rb.some(f => /banana/i.test(f.name)), rb.map(f => f.name));
ok('real search: prefix first', /^banana/i.test(rb[0].name), rb[0] && rb[0].name);

/* ---------- (b) measureToGrams / portionToGrams (never invent grams) ---------- */
const srBanana = DB.foods.find(f => f.code === 173944);   // SR Legacy "Bananas, raw"
const fnddsBanana = DB.foods.find(f => f.code === 2709224); // FNDDS "Banana, raw"
eq('SR banana cup, mashed = 225 g', Food.measureToGrams(srBanana, 'cup, mashed'), 225);
eq('FNDDS banana 1 cup, mashed = 225 g', Food.measureToGrams(fnddsBanana, '1 cup, mashed'), 225);
eq('label match is case-insensitive', Food.measureToGrams(srBanana, 'CUP, MASHED'), 225);
eq('unknown measure -> null (no invented grams)', Food.measureToGrams(srBanana, 'furlong'), null);
eq('blank measure -> null', Food.measureToGrams(srBanana, ''), null);
eq('portionToGrams 2 x cup,mashed', Food.portionToGrams(srBanana, 'cup, mashed', 2), 450);
eq('portionToGrams default qty = 1', Food.portionToGrams(srBanana, 'cup, mashed'), 225);
eq('portionToGrams unknown measure -> null', Food.portionToGrams(srBanana, 'furlong', 2), null);

/* ---------- (c) gramsToMacros: linear and correct ---------- */
const m100 = Food.gramsToMacros(srBanana, 100);
eq('100 g raw banana = 89 kcal', m100.kcal, 89);
const m200 = Food.gramsToMacros(srBanana, 200);
eq('200 g raw banana = 178 kcal', m200.kcal, 178);
ok('200 g = 2 x 100 g on every nutrient',
  Object.keys(m100).every(k => m200[k] === Food.round2(m100[k] * 2)), { m100, m200 });
eq('0 g -> all zeros (keys preserved)', Food.gramsToMacros(srBanana, 0).kcal, 0);

/* ---------- (d) absent nutrient is absent, not 0 ---------- */
const meat = DB.foods.find(f => f.code === 168029);   // SR Legacy "Walrus, meat, raw"
ok('source food has no fibre key', !('fibre' in meat.per100), meat.per100);
ok('source food DOES have carb (a real 0)', 'carb' in meat.per100 && meat.per100.carb === 0, meat.per100);
const meat150 = Food.gramsToMacros(meat, 150);
ok('gramsToMacros omits the absent fibre key', !('fibre' in meat150), meat150);
ok('gramsToMacros keeps carb = 0', 'carb' in meat150 && meat150.carb === 0, meat150);
eq('meat 150 g kcal', meat150.kcal, 298.5);

/* ---------- (e) user-food store: add / update / delete round-trip ---------- */
const store = Food.createStore();
const rec = Food.addUserFood(store, { name: 'My shake', per100: { kcal: 120, protein: 20 },
  measures: [{ label: '1 scoop', grams: 30 }] });
ok('addUserFood returns a record with an id', !!rec && !!rec.id, rec);
eq('listUserFoods length 1', Food.listUserFoods(store).length, 1);
eq('getUserFood round-trips the name', Food.getUserFood(store, rec.id).name, 'My shake');
eq('user food works with measureToGrams', Food.measureToGrams(Food.getUserFood(store, rec.id), '1 scoop'), 30);
ok('user food is searchable', Food.search(Food.listUserFoods(store), 'shake').length === 1);
Food.updateUserFood(store, rec.id, { name: 'Shake v2', per100: { kcal: 130 } });
eq('updateUserFood changes the name', Food.getUserFood(store, rec.id).name, 'Shake v2');
eq('updateUserFood replaces per100', Food.getUserFood(store, rec.id).per100.kcal, 130);
ok('deleteUserFood returns true', Food.deleteUserFood(store, rec.id) === true);
eq('store is empty after delete', Food.listUserFoods(store).length, 0);
ok('deleteUserFood again returns false', Food.deleteUserFood(store, rec.id) === false);

/* ---------- (f) barcode cache round-trip (+ next-batch stub) ---------- */
Food.saveBarcode(store, { barcode: '0123456789012', name: 'Oat bar',
  per100: { kcal: 400, fibre: 6 }, measures: [{ label: '1 bar', grams: 40 }], source: 'off' });
const bc = Food.getBarcode(store, '0123456789012');
eq('barcode record round-trips the name', bc.name, 'Oat bar');
eq('barcode record feeds measureToGrams', Food.measureToGrams(bc, '1 bar'), 40);
eq('barcode record feeds gramsToMacros', Food.gramsToMacros(bc, 80).kcal, 320);
eq('unknown barcode -> null', Food.getBarcode(store, 'nope'), null);
ok('deleteBarcode returns true', Food.deleteBarcode(store, '0123456789012') === true);
eq('barcode gone after delete', Food.getBarcode(store, '0123456789012'), null);
ok('lookupBarcode is a not-implemented stub', Food.lookupBarcode().ok === false &&
  Food.lookupBarcode().implemented === false && Food.BARCODE_LOOKUP_IMPLEMENTED === false,
  Food.lookupBarcode());

/* ---------- (g) FNDDS-vs-SR-Legacy nutrient-id mapping (pinned to raw CSVs) ----------
   Values read from the raw bundles:
   FNDDS  survey   food_nutrient.csv  fdc_id 2709224  nutrient_id 208=97, 203=0.74,
          204=0.28, 205=22.71, 291=1.7   (nutrient NUMBER)
   SR Leg food_nutrient.csv  fdc_id 173944   nutrient_id 1008=89, 1003=1.09,
          1004=0.33, 1005=22.84, 1079=2.6  (FDC nutrient ID) */
eq('FNDDS src tag', fnddsBanana.src, 'fndds');
eq('FNDDS kcal (nbr 208)', fnddsBanana.per100.kcal, 97);
eq('FNDDS protein (nbr 203)', fnddsBanana.per100.protein, 0.74);
eq('FNDDS fat (nbr 204)', fnddsBanana.per100.fat, 0.28);
eq('FNDDS carb (nbr 205)', fnddsBanana.per100.carb, 22.71);
eq('FNDDS fibre (nbr 291)', fnddsBanana.per100.fibre, 1.7);
eq('SR src tag', srBanana.src, 'sr');
eq('SR kcal (FDC id 1008)', srBanana.per100.kcal, 89);
eq('SR protein (FDC id 1003)', srBanana.per100.protein, 1.09);
eq('SR fat (FDC id 1004)', srBanana.per100.fat, 0.33);
eq('SR carb (FDC id 1005)', srBanana.per100.carb, 22.84);
eq('SR fibre (FDC id 1079)', srBanana.per100.fibre, 2.6);

/* ---------- dataset integrity ---------- */
eq('dataset food count', DB.foods.length, 13225);
eq('dataset measure count', DB.foods.reduce((n, f) => n + f.measures.length, 0), 36494);
ok('every food has code/name/per100/measures/src',
  DB.foods.every(f => Number.isInteger(f.code) && typeof f.name === 'string' &&
    f.per100 && Array.isArray(f.measures) && (f.src === 'fndds' || f.src === 'sr')));
ok('license carries the CC0 line', /CC0/.test(DB.license) && /public domain/i.test(DB.license));

/* ---------- (h) THE INTAKE LOG (js/store.js) ----------
   Loads the REAL store.js + food.js + nutrition.js in one vm scope against a
   small localStorage, so the intake helpers run exactly as the app runs them.
   A FakeDate pins "now" to 23:30 LOCAL (04:30Z the NEXT day) so the local-date
   rule is genuinely exercised — an evening entry must land on today, not
   tomorrow. */
{
  const FIXED = Date.parse('2026-11-09T04:30:00Z');       // 2026-11-08 23:30 EST
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
    static now() { return FIXED; }
  }
  const ls = {};
  const c3 = { console, module: { exports: {} }, JSON, Math, Object, Array, Number, String,
    Boolean, RegExp, Error, Promise, isFinite, parseFloat, parseInt, Map, Set,
    setTimeout, clearTimeout, Date: FakeDate,
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } } };
  c3.globalThis = c3; vm.createContext(c3);
  const src3 = ['js/food.js', 'js/nutrition.js', 'js/store.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n');
  vm.runInContext(src3 + '\n;globalThis.__I={Food, Nutrition, Store};', c3, { filename: 'intake-bundle.js' });
  const INut = c3.__I.Nutrition, IS = c3.__I.Store;

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const localToday = (() => { const d = new FakeDate();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const EMPTY = JSON.stringify({ version: 1, createdAt: '2026-01-01T00:00:00.000Z',
    profile: {}, workouts: [], bodylog: [], custom: [], achievements: {}, overrides: {}, targets: {}, settings: {} });

  console.log('\n--- (h) intake log (snapshot, local date, totals) ---');
  eq('the app\'s local-date helper gives the LOCAL day', localToday, '2026-11-08');
  eq('...while UTC would have rolled to tomorrow (the bug avoided)',
    new RealDate(FIXED).toISOString().slice(0, 10), '2026-11-09');

  /* 1) local-date default + round-trip */
  IS.importJSON(EMPTY, 'replace');
  const recA = IS.logIntake(INut.intakeEntry(clone(srBanana), 100));
  eq('logIntake stamps the LOCAL day (never toISOString)', recA.date, localToday);
  eq('intakesOn(local today) finds it', IS.intakesOn(localToday).length, 1);
  eq('intakesOn(UTC tomorrow) does not', IS.intakesOn('2026-11-09').length, 0);
  eq('the snapshot carries the food name', recA.name, srBanana.name);
  eq('100 g banana snapshots 89 kcal', recA.macros.kcal, 89);
  IS.importJSON(IS.exportJSON(), 'replace');
  eq('the intake log round-trips through export/import', IS.intakesOn(localToday).length, 1);
  eq('...with the snapshot intact', IS.intakesOn(localToday)[0].macros.kcal, 89);

  /* 2) macros are SNAPSHOTTED: change the food afterwards, the entry must not move */
  const mutable = clone(srBanana);
  const recB = IS.logIntake(INut.intakeEntry(mutable, 100));
  mutable.per100.kcal = 999;
  mutable.name = 'Mutated, raw';
  eq('changing the food afterwards does NOT move the logged macros', recB.macros.kcal, 89);
  eq('...nor the logged name', recB.name, srBanana.name);

  /* 3) dayTotals sums and EXCLUDES absent nutrients (never counts them as 0) */
  IS.importJSON(EMPTY, 'replace');
  IS.logIntake(INut.intakeEntry(clone(srBanana), 100));   // has fibre 2.6, kcal 89
  IS.logIntake(INut.intakeEntry(clone(meat), 150));       // NO fibre key, kcal 298.5, carb 0
  const sum = IS.dayTotals(localToday);
  eq('dayTotals sums kcal across entries', sum.kcal, 387.5);
  eq('dayTotals sums fibre where present', sum.fibre, 2.6);
  eq('dayTotals carries a summed carb (banana 22.84 + meat 0)', sum.carb, 22.84);
  IS.importJSON(EMPTY, 'replace');
  IS.logIntake(INut.intakeEntry(clone(meat), 150));
  const meatOnly = IS.dayTotals(localToday);
  ok('a nutrient absent from EVERY entry stays ABSENT from the total', !('fibre' in meatOnly), meatOnly);
  ok('a nutrient the source states as a real 0 is kept as 0 (not dropped)', 'carb' in meatOnly && meatOnly.carb === 0, meatOnly);
  eq('...and the nutrients that ARE there still sum', meatOnly.kcal, 298.5);

  /* 4) household measure via the REAL table; an unknown measure is refused */
  const ban = clone(srBanana);
  eq('a household measure converts via the real table (cup, mashed = 225 g)',
    INut.portionGrams(ban, { measure: 'cup, mashed' }), 225);
  eq('an unknown measure returns null — grams are never invented',
    INut.portionGrams(ban, { measure: 'furlong' }), null);
  eq('intakeEntry refuses a null/unknown portion', INut.intakeEntry(ban, null), null);
  eq('direct grams are honoured', INut.portionGrams(ban, { grams: 150 }), 150);
  const viaMeasure = IS.logIntake(INut.intakeEntry(ban, INut.portionGrams(ban, { measure: 'cup, mashed' })));
  eq('logging via a measure snapshots the converted grams (225)', viaMeasure.grams, 225);
  eq('...and the macros for THOSE grams (89 * 225/100)', viaMeasure.macros.kcal, 200.25);

  /* 5) removing an entry updates the totals */
  IS.importJSON(EMPTY, 'replace');
  const r1 = IS.logIntake(INut.intakeEntry(clone(srBanana), 100));   // 89 kcal
  IS.logIntake(INut.intakeEntry(clone(meat), 150));                  // 298.5 kcal
  eq('two entries sum to 387.5 kcal', IS.dayTotals(localToday).kcal, 387.5);
  ok('removeIntake returns true', IS.removeIntake(r1.id) === true);
  eq('removing an entry drops it from the day', IS.intakesOn(localToday).length, 1);
  eq('...and the total falls to the remaining entry', IS.dayTotals(localToday).kcal, 298.5);
  ok('removeIntake on a gone id returns false', IS.removeIntake(r1.id) === false);

  /* 6) TONE: no shaming on either side of the target, DRIVEN BY THE GOAL
        (the owner's hard rule) — a cut is never told to eat UP, and an at-or-above
        day is ordinary on every goal. */
  const T = [{ key: 'kcal', label: 'Calories', value: 2000, unit: 'kcal' }];
  const BANNED = /\b(over|exceeded?|exceed|cheat|cheated|too much|failed|failure|limit|bad|junk|off-track)\b/i;
  const gainUnder = INut.intakeSummary(T, { kcal: 900 }, 'gain')[0];
  const lossUnder = INut.intakeSummary(T, { kcal: 900 }, 'lose')[0];
  const gainOver = INut.intakeSummary(T, { kcal: 2600 }, 'gain')[0];
  const lossOver = INut.intakeSummary(T, { kcal: 2600 }, 'lose')[0];
  ok('GAIN, under target: the remaining figure IS offered', /to go/.test(gainUnder.text), gainUnder.text);
  ok('LOSS, under target: the remaining figure is NOT something to consume',
    !/to go/.test(lossUnder.text) && /still in today's budget/.test(lossUnder.text), lossUnder.text);
  ok('gain and loss word the SAME numbers differently', gainUnder.text !== lossUnder.text,
    [gainUnder.text, lossUnder.text]);
  [gainUnder, lossUnder, gainOver, lossOver].forEach((r) =>
    ok('no shaming word (' + r.goal + (r.logged >= r.target ? ', at/above target' : ', under target') + ')',
      !BANNED.test(r.text), r.text));
  eq('an at-or-above day is stated with the target, neutrally',
    gainOver.text, '2600 kcal — your target is 2000 kcal');
  eq('...and identically for a cut (over is ordinary on every goal)', lossOver.text, gainOver.text);
  ['gain', 'lose', 'maintain'].forEach((g) => {
    const hOver = INut.intakeHeadline([INut.intakeSummary(T, { kcal: 2600 }, g)[0]], 3, g);
    const hUnder = INut.intakeHeadline([INut.intakeSummary(T, { kcal: 900 }, g)[0]], 3, g);
    ok('no shaming word in the ' + g + ' at/above headline', !BANNED.test(hOver), hOver);
    ok('no shaming word in the ' + g + ' under headline', !BANNED.test(hUnder), hUnder);
  });
  ok('the LOSS headline never tells you to eat up to the target',
    !/to go/.test(INut.intakeHeadline([lossUnder], 3, 'lose')), INut.intakeHeadline([lossUnder], 3, 'lose'));
  ok('the GAIN headline still offers "to go"',
    /to go/.test(INut.intakeHeadline([gainUnder], 3, 'gain')), INut.intakeHeadline([gainUnder], 3, 'gain'));
  /* the tab's target key is `carbs`; the log stores `carb` — the two must join */
  const carbRow = INut.intakeSummary([{ key: 'carbs', label: 'Carbs', value: 265, unit: 'g' }], { carb: 51.1 })[0];
  eq('the tab\'s "carbs" target reads the log\'s "carb" total', carbRow.logged, 51.1);
  ok('...so the carbs row is not silently 0', carbRow.logged !== 0, carbRow);

  /* 7) the intake log counts as history for the mirror/backup gate */
  ok('richness counts intake entries (so a food-log-only state still backs up)',
    IS.richness({ intakelog: [{ id: 'x' }] }) >= 1);

  /* 8) THE FOOD DEDUPE CANNOT TOUCH LOGGED HISTORY — it only shapes a result LIST.
        Log the kept row AND its collapsed twin; re-running the collapse and
        searching again must leave the log byte-identical. */
  IS.importJSON(EMPTY, 'replace');
  const bananaRow = Food.search(DB, 'banana', 50).find((f) => Food.nameKey(f.name) === 'banana raw');
  const bananaTwin = (bananaRow.alternates || [])[0];
  ok('the raw-banana search row carries its collapsed twin', !!bananaTwin, bananaRow.alternates);
  IS.logIntake(INut.intakeEntry(bananaRow, 100));
  IS.logIntake(INut.intakeEntry(bananaTwin, 100));
  const logBefore = JSON.stringify(IS.intakesOn(localToday));
  Food.dedupe(DB.foods);              // collapse everything again
  Food.search(DB, 'banana', 50);      // and search again
  eq('the log is byte-identical after a dedupe + search', JSON.stringify(IS.intakesOn(localToday)), logBefore);
  eq('both twins keep their OWN snapshotted kcal (89 and 97)',
    IS.intakesOn(localToday).map((e) => e.macros.kcal).sort((a, b) => a - b).join(','), '89,97');
  eq('the day total is the sum of the snapshots (a collapsed row is not lost)',
    IS.dayTotals(localToday).kcal, 186);
  eq('the kept row logged its own name', IS.intakesOn(localToday)[0].name === bananaRow.name ||
    IS.intakesOn(localToday)[0].name === bananaTwin.name, true);
}

/* ---------- (i) DUPLICATE COLLAPSE: one row per food, nothing made unreachable ----
   The bundle carries FNDDS AND SR Legacy, which overlap. Food.dedupe collapses the
   RESULT LIST only (never the dataset). RULE: equal normalised name (case,
   punctuation and simple plurals folded) AND per-100 g energy within 5 kcal or
   15%, keeping the row with more usable portioning measures. See js/food.js. */
console.log('\n--- (i) duplicate collapse (FNDDS vs SR Legacy) ---');
{
  /* the normaliser folds exactly the plural that separates the real pair */
  eq('nameKey folds "Bananas, raw" onto "Banana, raw"',
    Food.nameKey('Bananas, raw'), Food.nameKey('Banana, raw'));
  eq('...and "Candies, hard" onto "Candy, hard"',
    Food.nameKey('Candies, hard'), Food.nameKey('Candy, hard'));
  ok('...but keeps "Banana, baked" distinct',
    Food.nameKey('Banana, baked') !== Food.nameKey('Banana, raw'), Food.nameKey('Banana, baked'));

  /* the REAL pair (FNDDS 97 vs SR 89 kcal/100 g) IS a twin set */
  ok('the real banana pair is a twin set', Food.isTwin(fnddsBanana, srBanana),
    [fnddsBanana.per100.kcal, srBanana.per100.kcal]);
  /* a genuinely different food sharing the stem is NOT */
  const baked = DB.foods.find((f) => f.name === 'Banana, baked');
  ok('"Banana, raw" vs "Banana, baked" is NOT a twin set', !Food.isTwin(fnddsBanana, baked),
    baked && baked.per100.kcal);
  /* the energy gate alone keeps a same-name pair apart when the numbers disagree */
  const kale = DB.foods.filter((f) => Food.nameKey(f.name) === 'kale raw');
  eq('the real "Kale, raw" pair is present', kale.length, 2);
  ok('same name but 23% apart in energy is NOT merged',
    !Food.isTwin(kale[0], kale[1]), kale.map((f) => f.per100.kcal));

  /* the SEARCH list shows the pair ONCE */
  const rb = Food.search(DB, 'banana', 50);
  const rawRows = rb.filter((f) => Food.nameKey(f.name) === 'banana raw');
  eq('searching "banana" returns the raw pair as ONE row', rawRows.length, 1);
  const keptRow = rawRows[0];
  const twin = (keptRow.alternates || [])[0];
  ok('the kept row carries the collapsed twin as .alternates', !!twin, keptRow.alternates && keptRow.alternates.map((a) => a.code));
  ok('the kept row is the one with the more useful measures',
    Food.measureScore(keptRow) >= Food.measureScore(twin), [Food.measureScore(keptRow), Food.measureScore(twin)]);
  ok('the kept row is still a real dataset record', DB.foods.some((f) => f.code === keptRow.code));
  /* HARD CONSTRAINT: the collapsed twin is STILL REACHABLE (exact name) */
  const exact = Food.search(DB, twin.name, 50);
  ok('the collapsed twin is still found by its exact name', exact.some((f) => f.code === twin.code),
    exact.map((f) => f.code));
  ok('...and it is still in the dataset, untouched', DB.foods.some((f) => f.code === twin.code));

  /* dataset-wide: exactly the real duplicate rows collapse, and nothing else */
  const dedup = Food.dedupe(DB.foods);
  eq('the rule merges exactly the 132 real duplicate rows', dedup.removed, 132);
  eq('...keeping every other row', dedup.list.length, DB.foods.length - dedup.removed);
  const groups = new Map();
  DB.foods.forEach((f) => { const k = Food.nameKey(f.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
  let twinPairs = 0, groupsConsidered = 0, groupsHeldApart = 0;
  groups.forEach((v) => {
    if (v.length < 2) return;
    groupsConsidered++;
    let any = false;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Food.isTwin(v[i], v[j])) { twinPairs++; any = true; }
    if (!any) groupsHeldApart++;
  });
  eq('exactly the 132 twin pairs are collapsible', twinPairs, 132);
  eq('same-name groups with NO energy agreement are held apart (deliberately not merged)', groupsHeldApart, 12);
  eq('the collapsed + kept rows account for every food', dedup.list.length + dedup.removed, DB.foods.length);

  /* the DATASET is never modified — a returned row is a copy, the record is not */
  ok('the dataset record itself never gains .alternates',
    !('alternates' in DB.foods.find((f) => f.code === keptRow.code)), Object.keys(DB.foods.find((f) => f.code === keptRow.code)));
  ok('but the returned row does carry them', Array.isArray(Food.search(DB, 'banana', 50).find((f) => f.code === keptRow.code).alternates));
  eq('dataset food count is unchanged', DB.foods.length, 13225);
  eq('dataset measure count is unchanged', DB.foods.reduce((n, f) => n + f.measures.length, 0), 36494);
}

console.log('\nfood: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
