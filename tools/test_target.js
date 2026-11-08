/* Next-session target: double progression derived from the user's own last
   session. Run: node tools/test_target.js */
const fs = require("fs"), vm = require("vm");
const store = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const ctx = { console, module: { exports: {} }, localStorage: store, Date, Math, JSON, Object, Array, Set, Map,
  isFinite, parseFloat, parseInt, Number, String, setTimeout, clearTimeout, Blob: class {}, URL: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(["js/data.js", "js/seed.js", "js/engine.js", "js/store.js"].map(f => fs.readFileSync(f, "utf8")).join("\n;\n")
  + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", ctx, { filename: "b.js" });
const { Engine, Store } = ctx.__X;
const LIB = ctx.__X.EXERCISE_LIB;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

function withSets(entries, ids) {
  Store.reset();
  Store.addBodyLog({ date: "2026-01-01", weightKg: 82 });
  entries.forEach((sets, i) => (ids || [76]).forEach((id) => {
    Store.upsertWorkout({ id: "w" + i, date: ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-07"][i],
      entries: [{ id, name: "Bench Press", mode: "weight_reps", sets }] });
  }));
}

console.log("--- his exact example: 100x10 last time ---");
withSets([[{ w: 100, r: 10 }]]);
let t = Engine.nextTarget(Store.state, 76);
eq("reference is the 100x10 set", t.last, { w: 100, r: 10 });
eq("offers +1 rep at the same load", t.options[0], { w: 100, r: 11 });
eq("...and a ~2.5% load step", t.options[1], { w: 102.5, r: 10 });

console.log("--- a warmup ramp must not win the reference ---");
withSets([[{ w: 100, r: 10 }, { w: 100, r: 10 }, { w: 110, r: 3 }, { w: 90, r: 8 }]]);
t = Engine.nextTarget(Store.state, 76);
eq("heaviest triple is not the reference (lower e1RM)", t.last, { w: 100, r: 10 });

console.log("--- rep range changes the load option ---");
withSets([[{ w: 110, r: 3 }]]);
t = Engine.nextTarget(Store.state, 76);
eq("strength range keeps reps when adding load", t.options[1], { w: 112.5, r: 3 });
withSets([[{ w: 60, r: 15 }]]);
t = Engine.nextTarget(Store.state, 76);
eq("top of the range resets reps when adding load", t.options[1], { w: 61.25, r: 11 });

console.log("--- the step scales with the load (plates are discrete) ---");
eq("step at 30 kg", Engine.kgStep(30), 1.25);
eq("step at 100 kg", Engine.kgStep(100), 2.5);
eq("step at 110 kg", Engine.kgStep(110), 2.5);
eq("step at 200 kg", Engine.kgStep(200), 5);
eq("every step is loadable (a multiple of 1.25)", [7, 23, 61, 137, 233].every((w) => (Engine.kgStep(w) / 1.25) % 1 === 0), true);

console.log("--- bodyweight rep exercises ---");
const repsEx = LIB.find((x) => x.m === "reps");
console.log(`        (using library exercise ${repsEx.id} "${repsEx.n}", mode=${repsEx.m})`);
Store.reset();
Store.upsertWorkout({ id: "p0", date: "2026-11-01", entries: [{ id: repsEx.id, name: repsEx.n, mode: "reps", sets: [{ r: 8 }, { r: 6 }] }] });
t = Engine.nextTarget(Store.state, repsEx.id);
eq("reps mode targets the best set", t.last, { w: 0, r: 8 });
eq("reps mode offers one more rep", t.options, [{ w: 0, r: 9 }]);

console.log("--- no history, no clutter ---");
Store.reset();
eq("first time on an exercise yields no target", Engine.nextTarget(Store.state, 76), null);

console.log("--- trend is reported, not asserted ---");
withSets([[{ w: 100, r: 10 }], [{ w: 100, r: 10 }]]);
t = Engine.nextTarget(Store.state, 76);
eq("sessions counted", t.sessions, 2);
eq("flat sessions report ~zero trend", Math.round(t.trend), 0);

console.log("--- an exercise on two cards in one session counts ONCE (merge) ---");
/* The bug: nextTarget iterated the raw per-workout entries, while mergedEntry /
   seriesFor / compareLast merge an exercise's cards within one workout. So an
   exercise logged on two cards in one session counted as TWO sessions and its
   trend measured a session against its OWN second card, inflating progress. */
Store.reset();
Store.addBodyLog({ date: "2026-01-01", weightKg: 82 });
Store.upsertWorkout({ id: "t0", date: "2026-11-01",
  entries: [{ id: 76, name: "Bench Press", mode: "weight_reps", sets: [{ w: 90, r: 5 }] }] });
Store.upsertWorkout({ id: "t1", date: "2026-11-07", entries: [
  { id: 76, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] },   // heavy card
  { id: 76, name: "Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 10 }] },   // back-off card
] });
t = Engine.nextTarget(Store.state, 76);
eq("two workouts are two sessions, not three", t.sessions, 2);
eq("the reference is the session's best set, not its own second card", t.last, { w: 100, r: 5 });
eq("progress is measured against the PREVIOUS session (trend > 0)", t.trend > 0, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
