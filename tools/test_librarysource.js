/* Library-source audit guard (2026-11-10) — data/library.json was re-derived
   from its two open sources (wger + free-exercise-db) and reconciled. These
   assertions pin the fixes, both directions:

     (a) corrected rows carry the source's equipment and primary groups;
     (b) a dual-flagged row accepts BOTH a loaded and a loadless set;
     (c) a single-mode row STILL REJECTS the wrong shape — validSet was NOT
         loosened for the weight_reps class.

   Run: node tools/test_librarysource.js */
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
const ok = (label, cond) => eq(label, !!cond, true);

function env() {
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    module: { exports: {} },
  };
  s.globalThis = s;
  vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { E: s.__X.Engine, LIB: s.__X.EXERCISE_LIB };
}

const { E, LIB } = env();
const byId = new Map(LIB.map((e) => [e.id, e]));
const NIL = { overrides: {}, custom: [], workouts: [], bodylog: [], profile: { units: "kg", weightKg: 80 } };
const entryOf = (id, sets, mode) => {
  const e = byId.get(id);
  return { id, name: e.n, mode: mode || e.m || "weight_reps", sets };
};
const stats = (id, sets, mode) => E.entryStats(entryOf(id, sets, mode));

console.log("=== (a) corrected rows carry the source's equipment and primary groups ===");
{
  const e = byId.get(1654);
  eq("1654 Machine Lateral Raise equipment", e.e, ["Machine"]);
  eq("1654 primary is Shoulders", e.p, ["Shoulders"]);
  eq("1654 radar group is Shoulders", e.g, ["Shoulders"]);

  const p = byId.get(478);
  eq("478 Push Press primary", p.p, ["Shoulders"]);
  eq("478 Push Press leads its radar array with Shoulders", p.g[0], "Shoulders");
  ok("478 Push Press credits Arms (triceps synergist)", p.g.includes("Arms"));
  ok("478 Push Press credits Legs (leg drive)", p.g.includes("Legs"));

  eq("566 Shoulder Press, Barbell credits Arms", byId.get(566).g.includes("Arms"), true);

  eq("124 Braced Squat is LOADED (Plate)", byId.get(124).e, ["Plate"]);
  eq("1672 Seated Hip Abduction is a loaded machine", byId.get(1672).e, ["Machine"]);
  eq("12 Seated Hip Adduction is a loaded machine", byId.get(12).e, ["Machine"]);
  eq("2718 Seated Hip Abduction (Custom)", byId.get(2718).e, ["Machine"]);
  eq("2699 Seated Hip Adduction (Custom)", byId.get(2699).e, ["Machine"]);

  eq("1949 Limber 11 mode (mobility routine)", byId.get(1949).m, "time");
  eq("2664 Seated Knee Extension with Overpressure mode (stretch)", byId.get(2664).m, "time");
  eq("1576 Snap Down mode (plyometric bodyweight)", byId.get(1576).m, "reps");

  ok("165 Ball crunches equipment names a ball", byId.get(165).e.includes("Swiss Ball"));
  eq("172 Crunches on Machine equipment", byId.get(172).e, ["Machine"]);
  eq("Pec deck rear delt fly (1775) equipment", byId.get(1775).e, ["Machine"]);
}

console.log("=== the compound/isolation MECHANISM is intact: primary full, secondaries half ===");
{
  // muscleGroups credits g[0] full and the rest half — a compound's secondary
  // group must be credited, an isolation only its own group.
  ok("478 Push Press is read as compound (not isolation)", E.isIsolation(NIL, 478) === false);
  ok("1654 Machine Lateral Raise is read as isolation", E.isIsolation(NIL, 1654) === true);
  const wc = E.exerciseWeight(NIL, 478), wi = E.exerciseWeight(NIL, 1654);
  ok(`compound weight (${wc}) exceeds isolation weight (${wi})`, wc > wi);

  // end-to-end: a compound set credits Shoulders (g[0]) AND Arms/Legs (half)
  const st = { ...NIL, workouts: [{ date: new Date().toISOString().slice(0, 10),
    entries: [{ id: 478, name: byId.get(478).n, mode: "weight_reps", sets: [{ w: 60, r: 5 }] }] }] };
  const mg = E.muscleGroups(st, 28);
  ok("478 credits Shoulders", mg.Shoulders.setsPerWk > 0);
  ok("478 credits Arms (secondary, half)", mg.Arms.setsPerWk > 0);
  ok("478 secondary Arms credit is half the primary", Math.abs(mg.Arms.setsPerWk * 2 - mg.Shoulders.setsPerWk) < 1e-6);
}

console.log("=== (b) a dual-flagged row accepts BOTH a loaded and a loadless set ===");
{
  const DUALS = [977, 1388, 1392, 632, 1294];
  for (const id of DUALS) {
    const e = byId.get(id);
    eq(`${id} ${e.n} carries dual:1`, e.dual, 1);
    eq(`${id} loadless reps set is VALID`, stats(id, [{ r: 10 }]).sets, 1);
    eq(`${id} loaded set is VALID`, stats(id, [{ w: 60, r: 10 }]).sets, 1);
    eq(`${id} a set with no reps is still refused`, stats(id, [{ w: 60 }]).sets, 0);
  }
}

console.log("=== (c) the guard is INTACT: a non-dual loaded movement still refuses a loadless log ===");
{
  for (const [id, label] of [[371, "Leg Press"], [355, "Lat Pull Down (Straight Back)"]]) {
    eq(`${id} ${label} is NOT dual`, byId.get(id).dual, undefined);
    eq(`${id} loadless log is DROPPED`, stats(id, [{ r: 10 }]).sets, 0);
    eq(`${id} a loaded set still counts`, stats(id, [{ w: 100, r: 10 }]).sets, 1);
  }
}

console.log("=== Snap Down is now caught by the power plyo matcher (was under-caught) ===");
{
  const st = { ...NIL, workouts: [{ date: new Date().toISOString().slice(0, 10),
    entries: [{ id: 1576, name: byId.get(1576).n, mode: "reps", sets: [{ r: 12 }] }] }] };
  eq("1576 reps count as plyometric (plyoReps 12)", E.powerScore(st, st.workouts).plyoReps, 12);
}

console.log("=== the source map is PINNED — a future edit cannot silently shrink the sweep ===");
{
  const lines = fs.readFileSync(path.join(B, "tools/library-source-map.tsv"), "utf8")
    .split("\n").filter((l) => l.trim() !== "");
  const head = lines[0].split("\t");
  const rows = lines.slice(1);
  eq("one TSV row per exercise", rows.length, 954);
  const ci = head.indexOf("action");
  const counts = {};
  for (const r of rows) counts[r.split("\t")[ci]] = (counts[r.split("\t")[ci]] || 0) + 1;
  eq("corrected count", counts["corrected"], 78);
  eq("dual-flagged count", counts["dual-flagged"], 5);
  eq("unresolvable count", counts["unresolvable"], 6);
  eq("kept count", counts["kept"], 865);
}

console.log("\n=== the EQUIPMENT residue is filled (v1.3.13) ===");
{
  /* data/library.json carried 162 rows with an EMPTY equipment array. A research
     pass resolved 161 of them (an independent second pass confirmed the residue);
     the one row that is not a movement (1381 "Upper Back") is deliberately left
     empty. These pin the applied values, the handful of rows this pass CHANGED
     that v1.3.11 had already filled, and the acceptance bar: no row whose name
     names equipment is left empty. */

  // (a) SPOT-ASSERT rows filled by this pass (values outside the old vocabulary
  //     are correct — `e` is a free-text list).
  const filled = {
    501: ["Gymnastic rings"], 1803: ["Trap bar (hex bar)"], 1523: ["Weighted sled"],
    595: ["Jump rope"], 2542: ["Heavy bag (boxing)"], 2740: ["Wrist roller (bar+rope+weight)"],
    820: ["Hangboard (climbing fingerboard)"], 1216: ["Hangboard (climbing fingerboard)"],
    2745: ["Rice bucket"], 1524: ["Battle ropes"], 2747: ["Climbing rope"],
    279: ["Hand gripper (spring-loaded)"], 1113: ["Parallettes"], 1914: ["Parallel bars (dip bars)"],
    1952: ["Massage ball (lacrosse ball)"], 1833: ["Floor gliders"], 2481: ["Kickboard (swim)"],
    1280: ["Cable machine"], 441: ["Barbell"], 630: ["Barbell"],
  };
  for (const [id, want] of Object.entries(filled))
    eq(`${id} ${byId.get(Number(id)).n} equipment`, byId.get(Number(id)).e, want);

  // (b) the 6 rows where the two independent passes DISAGREED — each decided by
  //     the library row's OWN description (v1.3.11's tie-break). Four were
  //     CORRECTED to the table's value; two KEPT the shipped value.
  eq("2623 Plate-Loaded Lat Pulldown -> Machine (desc: plate-loaded lever machine, not a cable)", byId.get(2623).e, ["Machine"]);
  eq("1525 Ball Slams -> Medicine ball (desc: slam the MEDICINE ball; a Swiss ball is not slammed)", byId.get(1525).e, ["Medicine ball"]);
  eq("539 Incline Bench Press - MP -> Machine (wger DE desc: Multipresse)", byId.get(539).e, ["Machine"]);
  eq("1773 Legend Incline Bench Press -> Machine (desc: LeverEdge MACHINE)", byId.get(1773).e, ["Machine"]);
  eq("478 Push Press KEEPS Dumbbell (desc names dumbbells; the table's Barbell is wrong)", byId.get(478).e, ["Dumbbell"]);
  eq("510 Rowing, Lying on Bench KEEPS Bench (empty desc; the table's citation is a standing row)", byId.get(510).e, ["Bench"]);

  // (c) the one LOW-confidence correction: 722's own description names a barbell.
  eq("722 Weighted Step-ups -> Barbell (desc: 'barbell and 45's on each side')", byId.get(722).e, ["Barbell"]);

  // (d) the UNRESOLVED row is left empty — no value invented, and never the
  //     literal "UNSETTLED".
  eq("1381 Upper Back stays EMPTY (it is not a movement)", byId.get(1381).e, []);
  eq("no row carries the literal string UNSETTLED", LIB.filter((x) => (x.e || []).some((v) => /UNSETTLED/i.test(v))).length, 0);

  // (e) ACCEPTANCE BAR: no row whose NAME names equipment is left empty. Exactly
  //     ONE library row still has an empty `e`, and it is 1381.
  const emptyRows = LIB.filter((x) => x.e.length === 0);
  eq("exactly one library row still has an empty equipment array", emptyRows.length, 1);
  eq("...and it is the non-movement 1381 Upper Back", emptyRows.map((x) => x.id), [1381]);
  const EQ_NAME = /barbell|dumbbell|kettlebell|cable|machine|smith|bench|ball|plate|band|ring|trap bar|sled|jump rope|rope|roller|gripper|parallettes|parallel bar|hangboard|fingerboard|kickboard|battle|heavy bag|glider|swiss|trx|foam|bar\b/i;
  const namedNoGear = LIB.filter((x) => x.e.length === 0 && EQ_NAME.test(x.n) && !/bodyweight/i.test(x.n));
  eq("no empty-equipment row NAMES equipment (the acceptance bar)", namedNoGear.map((x) => x.n), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
