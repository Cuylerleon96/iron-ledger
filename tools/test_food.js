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
   RESULT LIST only (never the dataset). RULE: equal MATCH key — normalised name
   with English plurals folded (radishes -> radish) and ONE optional trailing "raw"
   dropped (FNDDS omits the stated raw state) — AND per-100 g energy within 5 kcal
   or 15% AND an AGREEING MACRO VECTOR (protein/fat/carb, plus fibre when both
   sides carry it) within 1 g or 15%, keeping the row with more usable portioning
   measures (or the row the query names). Absent nutrients are never treated as 0.
   See js/food.js. */
console.log('\n--- (i) duplicate collapse (FNDDS vs SR Legacy) ---');
{
  /* the normaliser folds exactly the plural that separates the real pair */
  eq('nameKey folds "Bananas, raw" onto "Banana, raw"',
    Food.nameKey('Bananas, raw'), Food.nameKey('Banana, raw'));
  eq('...and "Candies, hard" onto "Candy, hard"',
    Food.nameKey('Candies, hard'), Food.nameKey('Candy, hard'));
  eq('...and "RADISHES" onto "RADISH" (the -es plural)',
    Food.nameKey('RADISHES, raw'), Food.nameKey('RADISH, raw'));
  eq('...and "tomatoes" onto "tomato" (the -oes plural)',
    Food.nameKey('Tomatoes'), Food.nameKey('Tomato'));
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
  eq('the rule merges exactly the 119 real duplicate rows (macro gate applied)', dedup.removed, 119);
  eq('...keeping every other row', dedup.list.length, DB.foods.length - dedup.removed);
  const groups = new Map();
  DB.foods.forEach((f) => { const k = Food.twinKey(f.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
  let twinPairs = 0, groupsConsidered = 0, groupsHeldApart = 0;
  groups.forEach((v) => {
    if (v.length < 2) return;
    groupsConsidered++;
    let any = false;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (Food.isTwin(v[i], v[j])) { twinPairs++; any = true; }
    if (!any) groupsHeldApart++;
  });
  eq('exactly the 119 twin pairs are collapsible (energy AND macro vector)', twinPairs, 119);
  eq('same-KEY groups with NO agreeing pair are held apart (energy or macro gates them)', groupsHeldApart, 38);
  eq('the collapsed + kept rows account for every food', dedup.list.length + dedup.removed, DB.foods.length);

  /* the DATASET is never modified — a returned row is a copy, the record is not */
  ok('the dataset record itself never gains .alternates',
    !('alternates' in DB.foods.find((f) => f.code === keptRow.code)), Object.keys(DB.foods.find((f) => f.code === keptRow.code)));
  ok('but the returned row does carry them', Array.isArray(Food.search(DB, 'banana', 50).find((f) => f.code === keptRow.code).alternates));
  eq('dataset food count is unchanged', DB.foods.length, 13225);
  eq('dataset measure count is unchanged', DB.foods.reduce((n, f) => n + f.measures.length, 0), 36494);
}

/* ---------- (j) NAME CURATION: legacy terms gone, renames keep their data -------
   The bundled set is curated by the RENAMES map in tools/build_food_db.py (the
   generated data is never hand-edited, so the correction survives a rebuild).
   These assertions pin that curation against the SHIPPED bundle:
     - no shipped name carries a seed term EXCEPT the two known false positives;
     - every renamed record resolves to its NEW name AND keeps its exact code,
       per100 (absent key vs a real 0 preserved) and measures — only the name moved;
     - the two false positives still ship, unchanged.
   The term list mirrors tools/corpus-name-sweep.py DEFAULT_TERMS; the allowlist
   mirrors its KNOWN_OK (kept in sync deliberately — both are the same decision). */
console.log('\n--- (j) name curation (legacy terms) ---');
{
  const TERMS = ['oriental', 'negro', 'colored', 'half-breed', 'gypsy', 'eskimo',
    'cripple', 'lame', 'midget', 'idiot', 'moron'];
  const KNOWN_OK = new Set([
    'Restaurant, Latino, Arroz con frijoles negros (rice and black beans)',
    'Beverages, yellow green colored citrus soft drink with caffeine',
  ]);
  const offending = DB.foods.filter((f) => {
    const n = f.name.toLowerCase();
    return TERMS.some((t) => n.indexOf(t) >= 0);
  });
  eq('exactly the 2 known false positives carry a seed term', offending.length, 2);
  ok('every term-bearing name is on the explicit allowlist',
    offending.every((f) => KNOWN_OK.has(f.name)), offending.map((f) => f.name));
  ok('no shipped name still says "oriental"',
    !DB.foods.some((f) => /oriental/i.test(f.name)));
  ok("no shipped name still says \"Jew's ear\"",
    !DB.foods.some((f) => /jew'?s ear/i.test(f.name)));
  eq('the daikon rename landed on all 4 radish rows',
    DB.foods.filter((f) => /daikon/i.test(f.name)).length, 4);
  ok('the wood-ear rename landed', DB.foods.some((f) => f.name === 'Wood ear, (pepeao), raw'));

  /* each rename pinned to code + exact values (measured BEFORE the rename, so
     this asserts the data did NOT move — only the name did). */
  const renames = [
    { code: 167958, name: 'Snacks, Asian mix, rice-based', src: 'sr',
      per100: { kcal: 506, protein: 17.31, fat: 25.58, carb: 51.62, fibre: 13.2 }, measures: 2 },
    { code: 168451, name: 'Radishes, daikon, raw', src: 'sr',
      per100: { kcal: 18, protein: 0.6, fat: 0.1, carb: 4.1, fibre: 1.6 }, measures: 2 },
    { code: 168452, name: 'Radishes, daikon, cooked, boiled, drained, without salt', src: 'sr',
      per100: { kcal: 17, protein: 0.67, fat: 0.24, carb: 3.43, fibre: 1.6 }, measures: 1 },
    { code: 168453, name: 'Radishes, daikon, dried', src: 'sr',
      per100: { kcal: 271, protein: 7.9, fat: 0.72, carb: 63.37, fibre: 23.9 }, measures: 1 },
    { code: 169082, name: 'Pork, Asian style, dehydrated', src: 'sr',
      per100: { kcal: 615, protein: 11.8, fat: 62.4, carb: 1.4, fibre: 0 }, measures: 1 },
    { code: 170122, name: 'Radishes, daikon, cooked, boiled, drained, with salt', src: 'sr',
      per100: { kcal: 17, protein: 0.67, fat: 0.24, carb: 3.43, fibre: 1.6 }, measures: 1 },
    { code: 169237, name: 'Wood ear, (pepeao), raw', src: 'sr',
      per100: { kcal: 25, protein: 0.48, fat: 0.04, carb: 6.75 }, measures: 2 },
  ];
  renames.forEach((r) => {
    const f = DB.foods.find((x) => x.code === r.code);
    ok('rename ' + r.code + ' resolves to its new name', !!f && f.name === r.name, f && f.name);
    ok('rename ' + r.code + ' kept code + src', !!f && f.code === r.code && f.src === r.src);
    ok('rename ' + r.code + ' kept per100 (absent key vs real 0 preserved)',
      !!f && JSON.stringify(f.per100) === JSON.stringify(r.per100), f && f.per100);
    eq('rename ' + r.code + ' kept its measure count', f ? f.measures.length : -1, r.measures);
  });
  const pork = DB.foods.find((x) => x.code === 169082);
  ok('pork keeps a REAL fibre 0 (present, not dropped)',
    'fibre' in pork.per100 && pork.per100.fibre === 0, pork.per100);
  const ear = DB.foods.find((x) => x.code === 169237);
  ok('wood ear has NO fibre key (absent, never a 0)', !('fibre' in ear.per100), ear.per100);

  /* the two false positives ship unchanged */
  KNOWN_OK.forEach((nm) => {
    ok('false positive still ships unchanged: ' + nm.slice(0, 26) + '…',
      DB.foods.some((f) => f.name === nm));
  });
}

/* ---------- (k) PLURAL TWINS: the -es plural and the ONE implied "raw" tail -----
   The original rule matched an EXACT normalised name, so it caught "Banana, raw"
   vs "Bananas, raw" but NOT the FNDDS/SR pair "Radish" vs "Radishes, raw" (the
   -es plural folds wrongly, and FNDDS omits the raw state the SR name states).
   These assertions pin the tightened rule AND its boundary: it traps the real
   duplicate, it refuses a plural twin whose VALUES disagree, it leaves a
   genuinely different food alone, it keeps a merged twin reachable by its exact
   name, and it never touches logged history. */
console.log('\n--- (k) plural twins (the -es plural + the implied raw state) ---');
{
  const radishF = DB.foods.find((f) => f.code === 2709803);   // FNDDS "Radish", 16 kcal/100 g
  const radishS = DB.foods.find((f) => f.code === 169276);    // SR "Radishes, raw", 16 kcal/100 g
  const seed = DB.foods.find((f) => f.name === 'Radish seeds, sprouted, raw');
  const pickled = DB.foods.find((f) => f.name === 'Radishes, pickled');
  const rhubarbF = DB.foods.find((f) => f.code === 2709268);  // FNDDS "Rhubarb", 73 kcal
  const rhubarbS = DB.foods.find((f) => f.code === 167758);   // SR "Rhubarb, raw", 21 kcal

  /* (1) the key itself: plural folded, ONE optional tail dropped, closed list */
  eq('twinKey folds the -es plural ("RADISHES, raw" -> "radish")', Food.twinKey('RADISHES, raw'), 'radish');
  eq('...and folds "tomatoes" onto "tomato"', Food.twinKey('Tomatoes, red, ripe, raw'), Food.twinKey('Tomato, red, ripe, raw'));
  eq('...and drops the implied raw state ("Radishes, raw" == "Radish")', Food.twinKey('Radishes, raw'), Food.twinKey('Radish'));
  eq('...but NOT any other qualifier ("Radish, cooked" keeps its word)', Food.twinKey('Radish, cooked'), 'radish cooked');
  eq('the optional-tail list is deliberately closed at one word', JSON.stringify(Food.OPTIONAL_TAIL), '["raw"]');

  /* (2) the real pair collapses to ONE search row — and it is the row the query names */
  ok('the real FNDDS/SR radish pair (16 / 16 kcal) is a twin set', Food.isTwin(radishF, radishS),
    [radishF.per100.kcal, radishS.per100.kcal]);
  const radRows = Food.search(DB, 'radish', 50).filter((f) => Food.twinKey(f.name) === 'radish');
  eq('searching "radish" shows the pair as ONE row', radRows.length, 1);
  eq('...and the row kept is the one the query names', radRows[0] && radRows[0].code, 2709803);
  ok('...with the collapsed twin attached as .alternates',
    !!radRows[0] && (radRows[0].alternates || []).some((a) => a.code === 169276),
    radRows[0] && (radRows[0].alternates || []).map((a) => a.code));
  ok('the other radish foods keep their OWN rows (not swept up)',
    Food.search(DB, 'radish', 50).filter((f) => /radish/i.test(f.name)).length >= 8,
    Food.search(DB, 'radish', 50).filter((f) => /radish/i.test(f.name)).map((f) => f.code));

  /* (3) the ORIGINAL exact-name pair still collapses (nothing loosened) */
  eq('the original "Banana, raw" / "Bananas, raw" pair still collapses to one row',
    Food.search(DB, 'banana', 50).filter((f) => Food.nameKey(f.name) === 'banana raw').length, 1);

  /* (4) a NAME-only twin is NOT a twin: the energy gate is mandatory */
  const fx = { foods: [
    { code: 90001, name: 'Carrot', per100: { kcal: 41 }, measures: [] },
    { code: 90002, name: 'Carrots', per100: { kcal: 90 }, measures: [] },        // plural only, values far apart
    { code: 90003, name: 'Carrot, raw', per100: { kcal: 41 }, measures: [] },    // raw tail only, values agree
    { code: 90004, name: 'Carrot, pickled', per100: { kcal: 41 }, measures: [] },// non-optional qualifier
  ] };
  const c = fx.foods;
  ok('a pair that differs ONLY by a plural but with DIFFERENT values does NOT merge',
    !Food.isTwin(c[0], c[1]), Food.twinKey(c[1].name) + ' vs kcal ' + c.map((x) => x.per100.kcal).join('/'));
  ok('...though their keys do agree (so the values are what stopped it)',
    Food.twinKey(c[0].name) === Food.twinKey(c[1].name));
  ok('a pair that differs only by the optional "raw" but with different values does NOT merge',
    !Food.isTwin(rhubarbF, rhubarbS), [rhubarbF.per100.kcal, rhubarbS.per100.kcal]);
  ok('the same pair WITH agreeing values DOES merge', Food.isTwin(c[0], c[2]));
  ok('a genuinely different food sharing the stem is untouched (radish seeds)',
    !Food.isTwin(radishF, seed), seed && seed.per100.kcal);
  ok('a non-optional trailing qualifier is untouched ("Radishes, pickled")',
    !Food.isTwin(radishF, pickled), pickled && pickled.per100.kcal);
  const bw = DB.foods.find((f) => f.name === 'Bread, white');
  const bww = DB.foods.find((f) => f.name === 'Bread, white wheat');
  ok('"Bread, white" is NOT "Bread, white wheat" (the tail is not optional)',
    !Food.isTwin(bw, bww), [bw.per100.kcal, bww.per100.kcal]);

  /* (5) HARD CONSTRAINT: the dropped twin is still findable by its EXACT name */
  const byExact = Food.search(DB, radishS.name, 50);
  ok('the collapsed twin is still found by its exact name',
    byExact.some((f) => f.code === radishS.code), byExact.map((f) => f.code));
  eq('...and that exact-name search shows the pair as one row too',
    byExact.filter((f) => Food.twinKey(f.name) === 'radish').length, 1);
  eq('...keeping the row the query named', byExact.filter((f) => Food.twinKey(f.name) === 'radish')[0].code, 169276);
  ok('...and the dataset record itself is untouched',
    DB.foods.some((f) => f.code === radishS.code) && DB.foods.some((f) => f.code === radishF.code));

  /* (6) the blast radius on the real dataset, under the TIGHTENED gate.
     countPairs(twinKey,true) applies the FULL twin test (energy AND macro
     vector); countPairs(nameKey,false) is the bare plural key with ENERGY-ONLY
     agreement. Tightening the guard merges FEWER rows, not more: the macro gate
     now holds the near-twins whose data genuinely differs apart. */
  const countPairs = (keyFn, viaKey) => {
    const g = new Map();
    DB.foods.forEach((f) => { const k = keyFn(f.name); if (!g.has(k)) g.set(k, []); g.get(k).push(f); });
    let n = 0;
    g.forEach((v) => {
      if (v.length < 2) return;
      for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) {
        const A = v[a], B = v[b];
        const ka = A.per100 && A.per100.kcal, kb = B.per100 && B.per100.kcal;
        if (ka == null || kb == null) continue;
        const agree = Math.abs(ka - kb) <= Math.max(Food.KCAL_TOL_ABS, Food.KCAL_TOL_REL * Math.min(ka, kb));
        if (agree && (viaKey ? Food.isTwin(A, B) : true)) n++;
      }
    });
    return n;
  };
  eq('the match key under the tightened gate collapsible-pair count is 119',
    countPairs(Food.twinKey, true), 119);
  eq('...the bare key with energy-only agreement would touch 132 (13 MORE)',
    countPairs(Food.nameKey, false), 132);
  eq('...so the tightened dataset-wide collapse is 119 rows, not 137',
    Food.dedupe(DB.foods).removed, 119);

  /* (7) LOGGED HISTORY IS UNTOUCHED — the log snapshots its own macros */
  const ls = {};
  const c4 = { console, module: { exports: {} }, JSON, Math, Object, Array, Number, String,
    Boolean, RegExp, Error, Promise, isFinite, parseFloat, parseInt, Map, Set, setTimeout, clearTimeout, Date,
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: (k) => { delete ls[k]; } } };
  c4.globalThis = c4; vm.createContext(c4);
  vm.runInContext(['js/food.js', 'js/nutrition.js', 'js/store.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')
    + '\n;globalThis.__J={Nutrition,Store};', c4, { filename: 'plural-intake-bundle.js' });
  const JN = c4.__J.Nutrition, JS = c4.__J.Store;
  const cloneJ = (o) => JSON.parse(JSON.stringify(o));
  const d0 = new Date();
  const today = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0');
  JS.importJSON(JSON.stringify({ version: 1, createdAt: '2026-01-01T00:00:00.000Z',
    profile: {}, workouts: [], bodylog: [], custom: [], achievements: {}, overrides: {}, targets: {}, settings: {} }), 'replace');
  const logRow = Food.search(DB, 'radish', 50).filter((f) => Food.twinKey(f.name) === 'radish')[0];
  JS.logIntake(JN.intakeEntry(cloneJ(logRow), 100));
  JS.logIntake(JN.intakeEntry(cloneJ(logRow.alternates[0]), 100));
  const logBefore = JSON.stringify(JS.intakesOn(today));
  Food.dedupe(DB.foods);
  Food.search(DB, 'radish', 50);
  eq('the log is byte-identical after a re-dedupe + search', JSON.stringify(JS.intakesOn(today)), logBefore);
  eq('both twins keep their OWN snapshotted kcal (16 each)', JS.intakesOn(today).map((e) => e.macros.kcal).join(','), '16,16');
  eq('the day total is the sum of the snapshots (a collapsed row is not lost)', JS.dayTotals(today).kcal, 32);
}

console.log('\n--- (l) macro-vector gate (identity is more than calories) ---');
{
  const lambSr = DB.foods.find((f) => f.code === 174370);   // SR   "Lamb, ground, raw" 282 kcal P16.56 F23.41 C0
  const lambFn = DB.foods.find((f) => f.code === 2705907);  // FNDDS "Lamb, ground"     281 kcal P24.55 F19.49 C0
  const vealSr = DB.foods.find((f) => f.code === 175290);   // SR   "Veal, ground, raw" 197 kcal P18.58 F13.06 C0
  const vealFn = DB.foods.find((f) => f.code === 2705910);  // FNDDS "Veal, ground"     213 kcal P25.62 F11.69 C1.5
  const radF = DB.foods.find((f) => f.code === 2709803);
  const radS = DB.foods.find((f) => f.code === 169276);
  const tamF = DB.foods.find((f) => f.code === 2709269);
  const tamS = DB.foods.find((f) => f.code === 167763);
  const kcalOk = (a, b) => Math.abs(a.per100.kcal - b.per100.kcal) <=
    Math.max(Food.KCAL_TOL_ABS, Food.KCAL_TOL_REL * Math.min(a.per100.kcal, b.per100.kcal));

  /* the DEFECT reproduced: the energy agrees, so the OLD kcal-only rule merged
     them — yet they are DIFFERENT products, ~8 g / ~7 g protein per 100 g apart */
  ok('lamb ground: energy DOES agree (why the old kcal-only guard merged them)',
    kcalOk(lambSr, lambFn), [lambSr.per100.kcal, lambFn.per100.kcal]);
  ok('veal ground: energy DOES agree (old guard merged them)',
    kcalOk(vealSr, vealFn), [vealSr.per100.kcal, vealFn.per100.kcal]);
  ok('lamb ground: protein is ~8 g apart (a different product, not the same data)',
    Math.abs(lambSr.per100.protein - lambFn.per100.protein) > 1, [lambSr.per100.protein, lambFn.per100.protein]);
  ok('veal ground: protein is ~7 g apart',
    Math.abs(vealSr.per100.protein - vealFn.per100.protein) > 1, [vealSr.per100.protein, vealFn.per100.protein]);
  ok('the lamb ground pair does NOT merge under the tightened guard',
    !Food.isTwin(lambSr, lambFn), 'P ' + lambSr.per100.protein + ' vs ' + lambFn.per100.protein);
  ok('the veal ground pair does NOT merge under the tightened guard',
    !Food.isTwin(vealSr, vealFn), 'P ' + vealSr.per100.protein + ' vs ' + vealFn.per100.protein);

  /* the per-100-IDENTICAL pairs still merge (nothing was over-tightened) */
  ok('Radish / Radishes, raw (per-100-identical) still merge', Food.isTwin(radF, radS));
  ok('Tamarind / Tamarinds, raw (per-100-identical) still merge', Food.isTwin(tamF, tamS));
  ok('...the two identical pairs agree on every macro too',
    Food.macrosAgree(radF, radS) && Food.macrosAgree(tamF, tamS));
  ok('the banana pair (the SAME food sampled apart) still merges',
    Food.isTwin(fnddsBanana, srBanana));

  /* ABSENT is NOT zero: a nutrient present on ONE side only blocks the merge */
  const ax = [
    { code: 90011, name: 'Groat', per100: { kcal: 100, protein: 10, fat: 5, carb: 20 }, measures: [] },
    { code: 90012, name: 'Groats', per100: { kcal: 101, fat: 5, carb: 20 }, measures: [] },  // protein ABSENT
  ];
  ok('a nutrient present on ONE side only is NOT zero -> no merge',
    !Food.isTwin(ax[0], ax[1]), 'protein ' + ax[0].per100.protein + ' vs ' + ax[1].per100.protein);
  ok('...their keys agree, so the ABSENCE is what stopped it (not the name)',
    Food.twinKey(ax[0].name) === Food.twinKey(ax[1].name) && kcalOk(ax[0], ax[1]));
  /* a nutrient absent from BOTH is skipped, not compared as 0 */
  const bx = [
    { code: 90013, name: 'Baz', per100: { kcal: 100, protein: 10, fat: 5 }, measures: [] },
    { code: 90014, name: 'Bazes', per100: { kcal: 100, protein: 10, fat: 5 }, measures: [] },
  ];
  ok('a nutrient absent from BOTH is skipped (still a twin)', Food.isTwin(bx[0], bx[1]),
    bx[0].per100);
  /* a both-present vector within 1 g / 15% merges */
  const cx = [
    { code: 90015, name: 'Quark', per100: { kcal: 100, protein: 10, fat: 5, carb: 20 }, measures: [] },
    { code: 90016, name: 'Quarks', per100: { kcal: 101, protein: 10.5, fat: 5.4, carb: 20.6 }, measures: [] },
  ];
  ok('a both-present vector within 1 g / 15% merges', Food.isTwin(cx[0], cx[1]),
    [cx[0].per100, cx[1].per100]);
  /* a genuinely different food sharing the stem is untouched */
  const seed2 = DB.foods.find((f) => f.name === 'Radish seeds, sprouted, raw');
  ok('a genuinely different food sharing the stem is untouched (radish seeds)',
    !Food.isTwin(radF, seed2), seed2 && seed2.per100.kcal);

  /* the SEARCH list now shows the lamb/veal pairs as TWO rows, both alive */
  const lambRows = Food.search(DB, 'lamb, ground', 50).filter((f) => Food.twinKey(f.name) === 'lamb ground');
  eq('searching "lamb, ground" shows the pair as TWO rows', lambRows.length, 2);
  ok('...both rows are alive in the returned list',
    lambRows.some((f) => f.code === 174370) && lambRows.some((f) => f.code === 2705907),
    lambRows.map((f) => f.code));
  ok('...neither is hidden as an .alternate of the other',
    lambRows.every((f) => !(f.alternates || []).some((a) => a.code === 174370 || a.code === 2705907)),
    lambRows.map((f) => (f.alternates || []).map((a) => a.code)));
  const vealRows = Food.search(DB, 'veal, ground', 50).filter((f) => Food.twinKey(f.name) === 'veal ground');
  eq('searching "veal, ground" shows the pair as TWO rows', vealRows.length, 2);
  /* a non-merged entry stays reachable by its EXACT name */
  ok('the non-merged twin is still found by its exact name',
    Food.search(DB, lambFn.name, 50).some((f) => f.code === lambFn.code));

  /* when a merge DOES happen the kept row is the one with the better measure set */
  const dm = Food.dedupe([
    { code: 90021, name: 'Zed', per100: { kcal: 100, protein: 5, fat: 2, carb: 3 }, measures: [] },
    { code: 90022, name: 'Zeds', per100: { kcal: 100, protein: 5, fat: 2, carb: 3 },
      measures: [{ label: 'a', grams: 10 }, { label: 'b', grams: 20 }] },
  ]);
  eq('a merge keeps the better-measured row', dm.list.length === 1 && dm.list[0].code, 90022);

  /* LOGGED HISTORY IS UNTOUCHED: log BOTH lamb rows, re-dedupe + search, the log
     is byte-identical and each entry keeps its OWN snapshotted kcal. */
  const ls2 = {};
  const c5 = { console, module: { exports: {} }, JSON, Math, Object, Array, Number, String,
    Boolean, RegExp, Error, Promise, isFinite, parseFloat, parseInt, Map, Set, setTimeout, clearTimeout, Date,
    localStorage: { getItem: (k) => (k in ls2 ? ls2[k] : null), setItem: (k, v) => { ls2[k] = String(v); }, removeItem: (k) => { delete ls2[k]; } } };
  c5.globalThis = c5; vm.createContext(c5);
  vm.runInContext(['js/food.js', 'js/nutrition.js', 'js/store.js']
    .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;')
    + ';globalThis.__K={Nutrition,Store};', c5, { filename: 'macro-intake-bundle.js' });
  const KN = c5.__K.Nutrition, KS = c5.__K.Store;
  const cl = (o) => JSON.parse(JSON.stringify(o));
  const dd = new Date();
  const day = dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
  KS.importJSON(JSON.stringify({ version: 1, createdAt: '2026-01-01T00:00:00.000Z',
    profile: {}, workouts: [], bodylog: [], custom: [], achievements: {}, overrides: {}, targets: {}, settings: {} }), 'replace');
  KS.logIntake(KN.intakeEntry(cl(lambSr), 100));
  KS.logIntake(KN.intakeEntry(cl(lambFn), 100));
  const logB = JSON.stringify(KS.intakesOn(day));
  Food.dedupe(DB.foods);
  Food.search(DB, 'lamb, ground', 50);
  eq('the log is byte-identical after a re-dedupe + search', JSON.stringify(KS.intakesOn(day)), logB);
  eq('both lamb rows keep their OWN snapshotted kcal (282 and 281)',
    KS.intakesOn(day).map((e) => e.macros.kcal).sort((a, b) => a - b).join(','), '281,282');
  eq('...and their own snapshotted protein (the wrong value is never shown)',
    KS.intakesOn(day).map((e) => e.macros.protein).sort((a, b) => a - b).join(','), '16.56,24.55');
  eq('the day total is the sum of the snapshots', KS.dayTotals(day).kcal, 563);
}

console.log('\nfood: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
