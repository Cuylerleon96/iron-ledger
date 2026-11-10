/* Fixture — SYNTHETIC subject, replayed. Run: node tools/test_fixture.js

   This suite used to replay a real export (his name, body composition and
   logged sessions). That made the repo a carrier of his personal data, so the
   real export was removed from version control entirely. The subject here is now
   fully fabricated: tools/fixture-state.json holds an invented profile (Test
   User, 175 cm, 70.5 kg, 15% body fat) and invented sessions.

   The numbers pinned below were read off the ENGINE running against that fixture,
   so this is a regression guard: if a future change moves one of them, that
   change altered what the app shows for this fixed input — which may be right,
   but must be a decision, not an accident. The semantic Vitality pins (healthy
   in-band -> high, out-of-band -> low, a goal can only add) live in
   test_mathfixes.js, not here. */
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
const st = JSON.parse(fs.readFileSync(path.join(B, "tools/fixture-state.json"), "utf8"));

console.log("\n=== session totals (from the synthetic fixture) ===");
{
  const want = { "2026-11-06": { sets: 7, lb: 6504 }, "2026-11-08": { sets: 6, lb: 2403 }, "2026-11-10": { sets: 8, lb: 2857 } };
  for (const w of st.workouts) {
    let t = 0, sets = 0;
    for (const en of w.entries) { const x = E.entryStats(en); t += x.tonnage; sets += x.sets; }
    eq(`${w.date} sets`, sets, want[w.date].sets);
    eq(`${w.date} tonnage (lb)`, Math.round(t * LB), want[w.date].lb);
  }
}

console.log("\n=== attributes (the synthetic subject's Dashboard) ===");
{
  const a = E.attributes(st, 28, 0);
  /* VIT is body-composition HEALTH first: the fixture's body composition is
     healthy on its own terms (15% body fat inside the male 8-18 band, BMI 23.0
     inside 18.5-25), so the base is 100. With a single check-in there is no gap
     CLOSED yet, so goal progress adds nothing and the basis names only the body
     parts used — the deliberate design, a healthy body is never dragged down by
     an unmet goal. */
  const want = { STR: 45, END: 25, POW: 8, MOB: 0, CON: 75, VIT: 100 };
  for (const k of Object.keys(want)) eq(k, a[k].score, want[k]);
  console.log(`        STR basis: "${a.STR.detail.basis}"`);
}

console.log("\n=== muscle groups, raw sets/week (the Muscle balance screen) ===");
{
  const mg = E.muscleGroups(st, 28);
  const want = { Chest: 0, Back: 0, Shoulders: 2, Arms: 1, Legs: 3, Calves: 0, Core: 9.5 };
  for (const g of E.GROUP_ORDER) eq(`${g} sets/wk`, mg[g].setsPerWk, want[g]);
}

console.log("\n=== summary + weak points ===");
{
  const sm = E.summary(st);
  eq("level", sm.level.level, 2);
  /* 357 -> 361: the fixture's one failure set now earns its extra-effort XP
     (+4 = round(HARD_SET_XP 20 * (1.2 - 1))), the deliberately-added term.
     361 -> 811: the fixture holds SEVEN unlocked badges, and a badge now pays XP
     into the TOTAL by tier — 2 major x XP.PR (100) + 5 minor x XP.SESSION (50)
     = 450 (see the badge-XP assertions below). */
  eq("total XP", sm.xp, 811);
  /* The badge term, paid by tier into the TOTAL. The fixture holds 7 unlocked
     badges: 2 major + 5 minor. */
  eq("badge XP (2 major x 100 + 5 minor x 50)", E.badgeXp(st), 450);
  eq("...that is the whole difference on the total", sm.xp - 361, E.badgeXp(st));
  eq("title", sm.title, "Rookie");
  eq("density %", sm.density, 36);
  eq("streak days", sm.streak.days, 1);
  eq("PRs in the last 28 days", sm.prs, 0);
  const wp = E.weakPoints(st, 28);
  eq("weak point count", wp.length, 7);
  /* THE CALVES RECONCILIATION. The Muscle-balance card renders a status for
     EVERY group; the weak-point "not trained yet" card names the untrained
     ones. They must agree: a group the balance card reads "not trained yet"
     has to appear in that card, and nothing else may. This is the exact
     disagreement the sweep found — Calves used to be filtered out of the list
     while the balance card still flagged it "not trained yet". The fixture has
     Chest, Back and Calves untrained, so the card must name all three. */
  {
    const mg = E.muscleGroups(st, 28);
    const untrained = E.GROUP_ORDER.filter((g) => mg[g].status === "not trained yet");
    const gap = wp.filter((w) => w.kind === "gap")[0];
    eq("the two surfaces agree on the untrained groups (balance card <-> weak-point card)",
      gap ? gap.title.replace(/ not trained yet$/, "").split(", ") : [], untrained);
  }
  eq("no tilde in any advice", wp.some((w) => /~/.test(w.fix || "")), false);
  eq("advice wording", wp.filter((w) => w.kind === "volume").map((w) => w.fix),
    ["Add about 5 sets/week of arms work.", "Add about 6 sets/week of shoulders work.", "Add about 5 sets/week of legs work."]);
}

console.log("\n=== per-exercise effort weights (derived, nothing entered) ===");
{
  // ids stay NUMBERS for library exercises — Object.keys() would stringify them
  // and exInfo looks library ids up as numbers, silently missing every one.
  // The custom "s" ids are the fixture's own invented exercises.
  const want = [["s1", 1.2], ["s2", 0.85], ["s4", 1.14], ["s7", 0.85], ["s8", 0.85]];
  for (const [id, w] of want) eq(`weight of exercise ${id}`, E.exerciseWeight(st, id), w);
  truthyV("a loaded barbell squat outweighs a plain time hold", E.exerciseWeight(st, "s1") > E.exerciseWeight(st, "s6"));
}
function truthyV(label, v) { eq(label, !!v, true); }

console.log("\n=== distances and pace are untouched by all of this ===");
{
  eq("bodyweight from the log (kg, 2dp)", Math.round(E.bodyweight(st) * 100) / 100, 70.5);
  const bf = E.bodyFatProgress(st);
  eq("body-fat goal", bf.goal, 14);
  eq("body-fat current", bf.current, 15);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
