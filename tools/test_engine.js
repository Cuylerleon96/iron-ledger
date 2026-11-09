/* Headless maths check. Runs the real browser sources in a vm context.
   Prints the same "engine: N passed, M failed" summary the other suites print,
   so this suite's checks are counted in the run total instead of being silently
   uncounted. Everything it checked before is still checked — the diagnostics
   below are unchanged; the CHECK lines assert the same computed values. */
const fs=require('fs'), vm=require('vm');
const store={_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=v},removeItem(k){delete this._d[k]}};
const ctx={console,module:{exports:{}},localStorage:store,Date,Math,JSON,Object,Array,Set,Map,isFinite,parseFloat,parseInt,Number,String,Blob:class{},URL:{},setTimeout,clearTimeout,console,URL:{}};
ctx.globalThis=ctx; vm.createContext(ctx);
const src=['js/data.js','js/seed.js','js/engine.js','js/store.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n;\n');
vm.runInContext(src+'\n;globalThis.__X={Engine,Store,SEED_WORKOUT,SEED_CUSTOM,EXERCISE_LIB};',ctx,{filename:'bundle.js'});
const {Engine,Store,SEED_WORKOUT,SEED_CUSTOM}=ctx.__X;
SEED_CUSTOM.forEach(c=>Store.addCustom(c));
Store.upsertWorkout(JSON.parse(JSON.stringify(SEED_WORKOUT)));
const S=Store.state;
S.profile.weightKg=82; S.profile.heightCm=178; S.profile.sex='M'; S.profile.weeklyTarget=4;

let pass=0, fail=0;
const ok=(label,cond)=>{const c=!!cond; console.log(`  ${c?"OK  ":"FAIL"} CHECK ${label}${c?"":`  got=${JSON.stringify(cond)}`}`); c?pass++:fail++;};
const near=(label,got,want,tol=0.05)=>{const c=Math.abs(got-want)<=tol; console.log(`  ${c?"OK  ":"FAIL"} CHECK ${label}  got=${got}${c?"":` want≈${want}`}`); c?pass++:fail++;};

console.log('library:', ctx.__X.EXERCISE_LIB.length, 'exercises | workout entries:', S.workouts[0].entries.length);
console.log('Epley 100x10 =', Engine.est1RM(100,10).toFixed(1), '| 110x3 =', Engine.est1RM(110,3).toFixed(1));
console.log('\n-- per exercise --');
Engine.trainedExerciseIds(S,3650).forEach(id=>{const b=Engine.bestFor(S,id);
  console.log(`  ${Engine.exName(S,id).padEnd(32)} e1RM ${b.est1RM.toFixed(1).padStart(6)} vol ${String(b.volume).padStart(6)} ton ${String(b.tonnage).padStart(6)} n=${Engine.seriesFor(S,id).length}`);});
console.log('\n-- attributes (28d) --');
const A=Engine.attributes(S,28);
Engine.ATTRIBUTES.forEach(a=>{const d=A[a.key];console.log(`  ${a.key.padEnd(4)} ${String(d.score).padStart(3)}  ${d.tier.padEnd(11)} delta ${d.delta}  ${JSON.stringify(d.detail).slice(0,90)}`);});
console.log('\n-- muscle balance --');
const MG=Engine.muscleGroups(S,28);
Engine.GROUP_ORDER.forEach(g=>console.log(`  ${g.padEnd(10)} ${String(MG[g].score).padStart(3)}  ${MG[g].setsPerWk}/wk  ${MG[g].status}`));
console.log('\n-- weak points --');
Engine.weakPoints(S,28).forEach(w=>console.log(`  [${w.severity}] ${w.title} :: ${w.detail}`));
const sum=Engine.summary(S);
console.log('\n-- summary --', JSON.stringify({sessions:sum.sessions,tonnage:sum.tonnage,distKm:sum.distKm,xp:sum.xp,lvl:sum.level.level,title:sum.title,prs:sum.prsAll}));
console.log('-- badges met --', Engine.achievements(S).filter(a=>a.met).map(a=>a.name).join(', ')||'(none)');
// stress: second session beats the first
const w2=JSON.parse(JSON.stringify(SEED_WORKOUT)); w2.id='w2'; w2.date='2026-11-10';
w2.entries[0].sets=[{w:105,r:10},{w:105,r:10},{w:115,r:3},{w:95,r:8}];
Store.upsertWorkout(w2);
console.log('\n-- after progressive session 10 Nov --');
const A2=Engine.attributes(S,28);
Engine.ATTRIBUTES.forEach(a=>console.log(`  ${a.key.padEnd(4)} ${String(A2[a.key].score).padStart(3)} delta ${A2[a.key].delta}`));
const cmp=Engine.compareLast(S,'u1');
console.log('  compareLast(Bench Press Machine):', JSON.stringify(cmp));

/* ---- the same values, asserted (this is the count the run total reads) ---- */
console.log('\n-- checks --');
ok('library is non-empty', ctx.__X.EXERCISE_LIB.length > 500);
ok('the seeded workout has entries', S.workouts[0].entries.length > 0);
near('Epley 100x10 = 133.3', Engine.est1RM(100,10), 133.3333);
near('Epley 110x3 = 121.0', Engine.est1RM(110,3), 121.0);
ok('Epley rises with reps', Engine.est1RM(100,5) < Engine.est1RM(100,10));
const ids=Engine.trainedExerciseIds(S,3650);
ok('trained exercises were found', ids.length > 0);
ok('every trained exercise has a positive best', ids.every(id=>{const b=Engine.bestFor(S,id); return b.est1RM>0 && b.volume>0 && b.tonnage>0;}));
ok('every trained exercise has at least one series', ids.every(id=>Engine.seriesFor(S,id).length>=1));
ok('there are six attributes', Engine.ATTRIBUTES.length === 6);
ok('every attribute score is 0-100', Engine.ATTRIBUTES.every(a=>{const s=A[a.key].score; return s>=0 && s<=100;}));
ok('every attribute carries a tier and a detail', Engine.ATTRIBUTES.every(a=>typeof A[a.key].tier==='string' && A[a.key].detail != null));
ok('muscle groups are ordered and scored', Engine.GROUP_ORDER.length > 0 && Engine.GROUP_ORDER.every(g=>MG[g].score>=0 && MG[g].score<=100 && isFinite(MG[g].setsPerWk)));
ok('weak points come back as a list', Array.isArray(Engine.weakPoints(S,28)));
ok('summary reports the seeded session', sum.sessions >= 1);
ok('summary carries positive tonnage and XP', sum.tonnage > 0 && sum.xp > 0);
ok('summary carries a level', sum.level && sum.level.level >= 1);
ok('achievements return a met flag each', Engine.achievements(S).every(a=>typeof a.met === 'boolean'));
ok('the progressive session keeps all six attributes', Engine.ATTRIBUTES.every(a=>isFinite(A2[a.key].score)));
ok('compareLast finds the earlier session', cmp && cmp.prevDate != null && cmp.est1RM && cmp.volume);
ok('the progressive session beats the earlier one', cmp.est1RM.cur > cmp.est1RM.prev);

/* ---- empty-state robustness --------------------------------------------------
   xp() used to return NaN on a state with zero workouts: it read
   streaks(state).bestWeeks, and an empty log returned an object that OMITTED
   that key, so `undefined * 50` poisoned the total. A brand-new install is an
   empty state, so this asserts the general rule — no exported getter may produce
   a broken number (NaN/Infinity) or throw on an empty state, and xp() must be a
   real 0, not NaN. These are the checks that would have caught the bug. ---- */
console.log('\n-- empty-state robustness (the XP NaN bug class) --');
const EMPTY = { profile:{}, workouts:[], bodylog:[], intakelog:[], profilelog:[], custom:[], overrides:{}, targets:{}, achievements:{} };
ok('xp() on an EMPTY state is 0', Engine.xp(EMPTY) === 0);
ok('xp() on an EMPTY state is NOT NaN', !Number.isNaN(Engine.xp(EMPTY)));
ok('streaks() on an EMPTY state defines bestWeeks = 0', Engine.streaks(EMPTY).bestWeeks === 0);
ok('streaks() on an EMPTY state defines bestDays = 0', Engine.streaks(EMPTY).bestDays === 0);
const es = Engine.summary(EMPTY);
ok('summary() on an EMPTY state carries a finite xp', Number.isFinite(es.xp) && es.xp === 0);
ok('summary() level total/into/pct are finite on an EMPTY state',
   Number.isFinite(es.level.total) && Number.isFinite(es.level.into) && Number.isFinite(es.level.pct));
// the sweep over EVERY exported function that reads a state.
const UTIL = new Set(['clamp','composeMult','kgStep','levelInfo','dstr','num','interp','weekKeyOf',
  'setVolume','entryStats','est1RM','tierOf','liftKey','exInfo','exName','exMode','exGroups',
  'setType','setTypeLabel','setEffort','isCoreLift','isIsolation','isMobility','isBodyweight',
  'bwFactor','workFactor','hasBwFactor']);
const WS_ARG = new Set(['bestLifts','bigSession','mobilityScore','powerScore','staminaScore','consistencyScore','strengthScore']);
const SESSION_ARG = new Set(['sessionXp','effortSetsSession']);
const nonFinite = [], threw = [];
const scanBad = (v, d, out) => {
  if (d > 3) return;
  if (typeof v === 'number' && !Number.isFinite(v)) out.push('NaN');
  else if (Array.isArray(v)) v.slice(0,5).forEach(x => scanBad(x, d+1, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) scanBad(v[k], d+1, out);
};
for (const name of Object.keys(Engine)) {
  const fn = Engine[name];
  if (typeof fn !== 'function' || UTIL.has(name)) continue;
  let out;
  try {
    if (WS_ARG.has(name)) out = fn(EMPTY, EMPTY.workouts);
    else if (SESSION_ARG.has(name)) out = fn(EMPTY, { date:'2026-01-01', entries:[] });
    else out = fn(EMPTY);
  } catch (e) { threw.push(name + ': ' + e.message); continue; }
  const bad = []; scanBad(out, 0, bad);
  if (bad.length) nonFinite.push(name);
}
ok('no exported state getter THROWS on an empty state', threw.length === 0);
ok('no exported state getter returns a non-finite number on an empty state',
   nonFinite.length === 0);
if (threw.length || nonFinite.length) console.log('        offenders: threw=[' + threw.join('; ') + '] nonFinite=[' + nonFinite.join(', ') + ']');

console.log(`\nengine: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
