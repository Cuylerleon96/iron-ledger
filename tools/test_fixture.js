/* Fixture — the owner's real export, replayed. Run: node tools/test_fixture.js

   This is the guard against "fixing" the maths into disagreement with reality.
   Every number below was read off his own screenshots and reproduced exactly by
   the engine before any of the audit fixes. If a future change moves one of
   these, that change altered what he sees — which may be right (the estimated
   Strength fix did, deliberately) but must be a decision, not an accident.

   tools/user-export.json is the sample export's contents. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const SRC = ["js/data.js", "js/engine.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const store = {};
const s = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
  Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
  setTimeout, clearTimeout, module: { exports: {} },
  document: { addEventListener() {}, removeEventListener() {} }, window: {},
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
s.globalThis = s; vm.createContext(s);
vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "b.js" });
const E = s.__X.Engine;
const LB = 2.2046226;
const st = JSON.parse(fs.readFileSync(path.join(B, "tools/user-export.json"), "utf8"));

console.log("\n=== session totals (read off his History screen) ===");
{
  const want = { "2026-11-07": { sets: 23, lb: 18690 }, "2026-11-08": { sets: 14, lb: 17965 } };
  for (const w of st.workouts) {
    let t = 0, sets = 0;
    for (const en of w.entries) { const x = E.entryStats(en); t += x.tonnage; sets += x.sets; }
    eq(`${w.date} sets`, sets, want[w.date].sets);
    eq(`${w.date} tonnage (lb)`, Math.round(t * LB), want[w.date].lb);
  }
}

console.log("\n=== attributes (his Dashboard) ===");
{
  const a = E.attributes(st, 28, 0);
  // CON was 11 when Discipline was frequency-only; continuity now carries 30%
  // and his recent 2-day run lifts it to 28
  const want = { STR: 35, END: 36, POW: 11, MOB: 0, CON: 28, VIT: 79 };
  for (const k of Object.keys(want)) eq(k, a[k].score, want[k]);
  // STR was 41 before the estimated-Strength fix; the basis is what changed:
  // a leg press and two machine presses scored on their OWN tables now
  console.log(`        STR basis: "${a.STR.detail.basis}" from "${a.STR.detail.from}"`);
}

console.log("\n=== muscle groups, raw sets/week (his Muscle balance screen) ===");
{
  const mg = E.muscleGroups(st, 28);
  const want = { Chest: 4.3, Back: 0, Shoulders: 1.4, Arms: 2.9, Legs: 3, Calves: 0, Core: 0.5 };
  for (const g of E.GROUP_ORDER) eq(`${g} sets/wk`, mg[g].setsPerWk, want[g]);
}

console.log("\n=== summary + weak points ===");
{
  const sm = E.summary(st);
  eq("level", sm.level.level, 2);
  eq("total XP", sm.xp, 330);
  eq("title", sm.title, "Rookie");
  eq("density %", sm.density, 56);
  eq("streak days", sm.streak.days, 2);
  eq("PRs this month", sm.prs, 0);
  const wp = E.weakPoints(st, 28);
  eq("weak point count", wp.length, 8);
  eq("no tilde in any advice", wp.some((w) => /~/.test(w.fix || "")), false);
  eq("cardio/quad advice wording", wp.filter((w) => w.kind === "volume").map((w) => w.fix),
    ["Add about 4 sets/week of core work.", "Add about 7 sets/week of shoulders work.", "Add about 5 sets/week of legs work."]);
}

console.log("\n=== per-exercise effort weights (derived, nothing entered) ===");
{
  // ids stay NUMBERS for library exercises — Object.keys() would stringify them
  // and exInfo looks library ids up as numbers, silently missing every one
  const want = [[171, 0.89], [1904, 0.71], [375, 0.84], ["u1", 1.04], [1185, 0.75], [369, 0.85], [366, 0.85]];
  for (const [id, w] of want) eq(`weight of exercise ${id}`, E.exerciseWeight(st, id), w);
  truthyV("incline crunches outweigh a flat crunch", E.exerciseWeight(st, 171) > 0.85);
}
function truthyV(label, v) { eq(label, !!v, true); }

console.log("\n=== distances and pace are untouched by all of this ===");
{
  eq("bodyweight from his log (kg, 2dp)", Math.round(E.bodyweight(st) * 100) / 100, 62.69);
  const bf = E.bodyFatProgress(st);
  eq("body-fat goal", bf.goal, 10);
  eq("body-fat current", bf.current, 12);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
