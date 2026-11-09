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
  // CON was 11 when Discipline was frequency-only. It now blends frequency with
  // continuity, and continuity is coverage-led: his 2-day run is a 1-day gap but
  // covers only 1 of the last 4 weeks, so it reads 24 rather than 28.
  /* END and CON moved when weekly rates stopped being divided by four weeks he
     was not there for: his first session is 2026-11-07, so he has exactly one
     week of history, and his actual week is what should be judged. */
  /* VIT moved 79 -> 100 when Vitality became body-composition HEALTH first: his
     body composition is healthy on its own terms (12% body fat inside the male
     8-18 band, BMI 19.8 inside 18.5-25), so the base is 100. This fixture has a
     single check-in, so the log cannot show a gap CLOSED and goal progress adds
     nothing — the old goal-gap maths is exactly what made a healthy body read
     low. A deliberate change, not a regression. */
  const want = { STR: 35, END: 44, POW: 11, MOB: 0, CON: 65, VIT: 100 };
  for (const k of Object.keys(want)) eq(k, a[k].score, want[k]);
  // STR was 41 before the estimated-Strength fix; the basis is what changed:
  // a leg press and two machine presses scored on their OWN tables now
  console.log(`        STR basis: "${a.STR.detail.basis}" from "${a.STR.detail.from}"`);
}

console.log("\n=== muscle groups, raw sets/week (his Muscle balance screen) ===");
{
  const mg = E.muscleGroups(st, 28);
  // his 17 weighted chest sets happened in his ONE week of history, so 17/wk is
  // the honest figure; 4.3/wk averaged them over three weeks that predate him
  const want = { Chest: 17, Back: 0, Shoulders: 5.5, Arms: 11.5, Legs: 12, Calves: 0, Core: 2 };
  for (const g of E.GROUP_ORDER) eq(`${g} sets/wk`, mg[g].setsPerWk, want[g]);
}

console.log("\n=== summary + weak points ===");
{
  const sm = E.summary(st);
  eq("level", sm.level.level, 2);
  /* XP was 330 while the lifetime bonus paid st.bestDays * 15 (his 2-day run:
     +30). That consecutive-day term was removed app-wide (a 3-day badge was the
     last of them), and the bonus is now weeks-at-target * 15 — he has 2 sessions
     against a target of 4, so 0 weeks, which took it to 300. The weigh-in term
     was then rebalanced: it was a flat 10 XP per ENTRY (his one check-in: +10),
     the last farmable per-entry term, and is now ONE weekly payment for a week
     the bodyweight log was used (+15), matching food logging — so his total is
     305, not 300. His LEVEL is unchanged (2; the level-2 floor is 300, so 305
     sits 5 into the level). This moved his number UP, not down. */
  eq("total XP", sm.xp, 305);
  eq("title", sm.title, "Rookie");
  eq("density %", sm.density, 56);
  eq("streak days", sm.streak.days, 2);
  eq("PRs this month", sm.prs, 0);
  const wp = E.weakPoints(st, 28);
  eq("weak point count", wp.length, 6);
  eq("no tilde in any advice", wp.some((w) => /~/.test(w.fix || "")), false);
  // legs now reads "building" and chest "sweet spot", so only core and shoulders remain
  eq("advice wording", wp.filter((w) => w.kind === "volume").map((w) => w.fix),
    ["Add about 3 sets/week of shoulders work.", "Add about 2 sets/week of core work."]);
}

console.log("\n=== per-exercise effort weights (derived, nothing entered) ===");
{
  // ids stay NUMBERS for library exercises — Object.keys() would stringify them
  // and exInfo looks library ids up as numbers, silently missing every one
  // 171 is Incline Crunches: 0.89 from its attributes x 2.12 the work (40 deg, head below hips)
  const want = [[171, 1.89], [1904, 0.71], [375, 0.84], ["u1", 1.04], [1185, 0.75], [369, 0.85], [366, 0.85]];
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