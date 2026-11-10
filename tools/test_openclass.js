/* Open-class guard — the audit found 218 library entries whose mode was
   weight_reps with no-load equipment yet which the bodyweight gate did not
   recognise, so a loadless log was silently DROPPED. The fix was a per-exercise
   review (tools/library-openclass-review.tsv) that corrected the plainly
   bodyweight / reps- or time-performed entries' MODE in data/library.json — NOT
   by loosening validSet, which would let a genuinely loaded movement be logged
   empty. These assertions pin that behaviour, the guard, and the sweep size.

   Run: node tools/test_openclass.js */
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

function env() {
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    module: { exports: {} },
  };
  s.globalThis = s; vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { E: s.__X.Engine, LIB: s.__X.EXERCISE_LIB };
}

const { E, LIB } = env();
const byId = new Map(LIB.map((e) => [e.id, e]));
const state = { overrides: {}, custom: [], workouts: [], bodylog: [], profile: { units: "kg", weightKg: 80 } };
const entryOf = (id, sets, mode) => {
  const e = byId.get(id);
  return { id, name: e.n, mode: mode || e.m || "weight_reps", sets };
};
const stats = (id, sets, mode) => E.entryStats(entryOf(id, sets, mode));

console.log("=== the fix: a corrected bodyweight movement accepts a loadless reps log ===");
{
  // 235 Flutter Kicks — reviewed bodyweight-only, maybe weight box untouched.
  eq("235 mode corrected to reps", byId.get(235).m, "reps");
  const s = stats(235, [{ r: 20 }]);                 // reps only, NO weight
  eq("235 reps-only set is VALID (not dropped)", s.sets, 1);
  eq("235 reps-only set reaches the volume path", s.volume, 20);
  // an empty set (no reps) is still refused
  eq("235 a set with no reps is still refused", stats(235, [{ w: 5 }]).sets, 0);
}
{
  // 718 Wall Squat — a hold, corrected to time.
  eq("718 mode corrected to time", byId.get(718).m, "time");
  const s = stats(718, [{ t: 60 }]);
  eq("718 hold is VALID on seconds alone", s.sets, 1);
  eq("718 hold reaches the time volume path", s.volume, 60);
}

console.log("=== the guard is INTACT: a genuinely loaded movement still refuses a loadless log ===");
{
  // 355 Lat Pull Down (Straight Back) and 371 Leg Press were reviewed load-performed.
  for (const [id, label] of [[355, "Lat Pull Down (Straight Back)"], [371, "Leg Press"], [1904, "Pec Deck"]]) {
    const e = byId.get(id);
    eq(`${id} ${label} stays on weight_reps`, e.m, "weight_reps");
    const s = stats(id, [{ r: 10 }]);                // reps only, NO load
    eq(`${id} loadless log is DROPPED (sets=0)`, s.sets, 0);
    eq(`${id} loadless volume is 0`, s.volume, 0);
    eq(`${id} a loaded set still counts`, stats(id, [{ w: 100, r: 10 }]).sets, 1);
  }
}

console.log("=== the sweep is PINNED — a future edit cannot silently shrink it ===");
{
  const lines = fs.readFileSync(path.join(B, "tools/library-openclass-review.tsv"), "utf8")
    .split("\n").filter((l) => l.trim() !== "");
  const head = lines[0].split("\t");
  const rows = lines.slice(1).map((l) => l.split("\t"));
  eq("reviewed entries pinned at 218", rows.length, 218);
  const col = (name) => head.indexOf(name);
  const verdicts = rows.reduce((m, r) => (m[r[col("verdict")]] = (m[r[col("verdict")]] || 0) + 1, m), {});
  eq("bodyweight-only count", verdicts["bodyweight-only"], 103);
  eq("load-performed count", verdicts["load-performed"], 101);
  eq("unresolvable count", verdicts["unresolvable"], 14);
  // every bodyweight-only row must actually carry its corrected mode in the library
  const bad = rows.filter((r) => r[col("verdict")] === "bodyweight-only")
    .filter((r) => ["reps", "time"].indexOf(byId.get(Number(r[col("id")])).m) === -1);
  eq("every bodyweight-only row is corrected in the library", bad.length, 0);
  // every load-performed row must still be weight_reps
  const badL = rows.filter((r) => r[col("verdict")] === "load-performed")
    .filter((r) => byId.get(Number(r[col("id")])).m !== "weight_reps");
  eq("every load-performed row still weight_reps", badL.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
