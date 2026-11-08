/* Headless maths check. Runs the real browser sources in a vm context. */
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
console.log('\n-- summary --', JSON.stringify({sessions:sum.sessions,tonnage:sum.tonnage,sets:sum.sets,xp:sum.xp,lvl:sum.level.level,title:sum.title,prs:sum.prsAll}));
console.log('-- badges met --', Engine.achievements(S).filter(a=>a.met).map(a=>a.name).join(', ')||'(none)');
// stress: second session beats the first
const w2=JSON.parse(JSON.stringify(SEED_WORKOUT)); w2.id='w2'; w2.date='2026-11-10';
w2.entries[0].sets=[{w:105,r:10},{w:105,r:10},{w:115,r:3},{w:95,r:8}];
Store.upsertWorkout(w2);
console.log('\n-- after progressive session 10 Nov --');
const A2=Engine.attributes(S,28);
Engine.ATTRIBUTES.forEach(a=>console.log(`  ${a.key.padEnd(4)} ${String(A2[a.key].score).padStart(3)} delta ${A2[a.key].delta}`));
console.log('  compareLast(Bench Press Machine):', JSON.stringify(Engine.compareLast(S,'u1')));
