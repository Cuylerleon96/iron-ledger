/* Headless check for js/food.js — runs the REAL module in a vm context, exactly
   like tools/test_engine.js. The module is pure and injectable, so the unit
   cases use a small fixture and the dataset cases load the committed generated
   bundle js/fooddata.js (const FOOD_DB). */
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');

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

console.log('\nfood: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
