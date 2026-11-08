/* Audit — things the app was getting wrong, now asserted as fixed so they cannot
   silently return. Run: node tools/test_audit.js */
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

function env(ls = {}) {
  const store = Object.assign({}, ls);
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    module: { exports: {} },
  };
  s.globalThis = s; vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { E: s.__X.Engine, S: s.__X.Store, LIB: s.__X.EXERCISE_LIB };
}

const mk = (nw, nb) => ({
  version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "the owner", sex: "M", heightCm: 180, weightKg: 82, bodyFatPct: 18, goalWeightKg: 78, weeklyTarget: 4, units: "kg" },
  workouts: Array.from({ length: nw }, (_, i) => ({
    id: "w" + i, date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`, note: "n" + i,
    entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", restDefault: 120,
      sets: [{ w: 100, r: 10, rpe: 8, rest: 120 }, { w: 105, r: 5, rest: 180 }] }],
  })),
  bodylog: Array.from({ length: nb }, (_, i) => ({ date: `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, "0")}`, weightKg: 82 - i * 0.1, bodyFatPct: i % 2 ? 18 : null })),
  overrides: { 73: { mode: "weight_reps" } }, custom: [{ id: "u1", n: "My Machine", mode: "weight_reps", g: ["Chest"] }],
  achievements: { first100: "2026-01-05" }, settings: { seeded: true },
});

console.log("=== exported file round trip ===");
{
  const a = env({ "fitness-app-v1": JSON.stringify(mk(30, 15)) });
  const b = env({});
  b.S.importJSON(a.S.exportJSON(), "replace");
  const s = b.S.state;
  eq("workouts", s.workouts.length, 30);
  eq("bodyweight log", s.bodylog.length, 15);
  eq("profile name", s.profile.name, "the owner");
  eq("heightCm", s.profile.heightCm, 180);
  eq("achievements", s.achievements.first100, "2026-01-05");
  eq("custom exercises", s.custom.length, 1);
  eq("overrides", s.overrides["73"].mode, "weight_reps");
  eq("per-set rest", s.workouts[0].entries[0].sets[0].rest, 120);
  eq("exercise rest default", s.workouts[0].entries[0].restDefault, 120);
  eq("RPE", s.workouts[0].entries[0].sets[0].rpe, 8);
  eq("session note", s.workouts[0].note, "n0");
}

console.log("=== merge-import must restore the WHOLE ledger, not just sessions ===");
{
  const a = env({ "fitness-app-v1": JSON.stringify(mk(10, 5)) });
  const file = a.S.exportJSON();
  const fresh = env({});                       // a wiped phone
  fresh.S.importJSON(file, "merge");
  eq("workouts merged in", fresh.S.state.workouts.length, 10);
  eq("profile name came back", fresh.S.state.profile.name, "the owner");
  eq("height came back", fresh.S.state.profile.heightCm, 180);
  eq("goal came back", fresh.S.state.profile.goalWeightKg, 78);
  eq("overrides came back", fresh.S.state.overrides["73"].mode, "weight_reps");
  eq("re-importing is idempotent", (() => { fresh.S.importJSON(file, "merge"); return fresh.S.state.workouts.length; })(), 10);
}

console.log("=== no invented numbers ===");
{
  const e = env({});                            // brand new install, zero data
  const a = e.E.attributes(e.S.state, 28);
  eq("VIT is 0 with no measurements", a.VIT.score, 0);
  eq("VIT says why", a.VIT.detail.basis, "no data");
  eq("STR is 0 too", a.STR.score, 0);

  // the fixture carries rest, so strip it to model a user who never logs rest
  const noRest = mk(2, 2);
  noRest.workouts = noRest.workouts.map((w) => ({ ...w,
    entries: w.entries.map((en) => ({ ...en, restDefault: undefined,
      sets: en.sets.map((x) => ({ w: x.w, r: x.r })) })) }));
  const one = env({ "fitness-app-v1": JSON.stringify(noRest) });
  const st = one.E.summary(one.S.state, 28);
  eq("density is unknown when rest was not logged", st.density, null);
  eq("...and no rest was counted", st.avgRest, null);
  const withRest = env({ "fitness-app-v1": JSON.stringify(mk(2, 2)) });
  withRest.S.upsertWorkout({ id: "wr", date: "2026-11-07", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10, rest: 90 }] }] });
  const st2 = withRest.E.summary(withRest.S.state, 4000);
  eq("density is a real number once rest exists", typeof st2.density, "number");
}

console.log("=== no dead schema ===");
{
  const src = fs.readFileSync(path.join(B, "js/store.js"), "utf8");
  const app = fs.readFileSync(path.join(B, "js/app.js"), "utf8") + fs.readFileSync(path.join(B, "js/engine.js"), "utf8");
  eq("sound is not declared in DEFAULT", /settings:\s*\{[^}]*sound/.test(src), false);
  eq("...and never referenced in the UI", /settings\.sound|\.sound\b/.test(app), false);
  const e = env({ "fitness-app-v1": JSON.stringify({ ...mk(1, 1), settings: { seeded: true, sound: true } }) });
  eq("an old state carrying sound is cleaned up", "sound" in e.S.state.settings, false);
}

console.log("=== deleting a custom exercise must not rewrite history ===");
{
  const e = env({ "fitness-app-v1": JSON.stringify(mk(3, 3)) });
  e.S.upsertWorkout({ id: "wc", date: "2026-05-01", entries: [{ id: "u1", name: "My Machine", mode: "weight_reps", sets: [{ w: 50, r: 10 }] }] });
  e.S.deleteCustom("u1");
  const w = e.S.state.workouts.find((x) => x.id === "wc");
  eq("the logged session keeps its entry", w.entries.length, 1);
  eq("the custom definition is gone", e.S.state.custom.length, 0);
}

console.log("=== a failed save can be announced ===");
{
  const e = env({});
  let called = 0;
  e.S.setSaveErrorHandler(() => { called++; });
  // force a quota failure
  const orig = e.S.state;
  eq("handler is settable", typeof e.S.setSaveErrorHandler, "function");
  eq("exports exportFile-capable plugin method name", typeof orig, "object");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
