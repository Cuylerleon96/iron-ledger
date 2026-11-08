/* Math fixes — every defect found in the audit, asserted as fixed.
   Run: node tools/test_mathfixes.js

   Each case exists because the wrong answer was actually observed first. The
   comment on each says what it used to do, so a future reader can tell an
   intentional change from a regression. */
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
const truthy = (label, v) => eq(label, !!v, true);
const near = (label, got, want, tol = 0.02) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${Math.round(got * 1000) / 1000}${ok ? "" : ` want≈${want}`}`);
  ok ? pass++ : fail++;
};

function env() {
  const store = {};
  const s = {
    console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
    Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
    setTimeout, clearTimeout, module: { exports: {} },
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
  s.globalThis = s; vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { E: s.__X.Engine, S: s.__X.Store, LIB: s.__X.EXERCISE_LIB };
}

/* Loads the REAL app.js behind a stub DOM with a capturing Chart, so the tests
   can exercise the actual render path (what the card passes to the chart) and
   the actual persistence path rather than a copy of the logic. */
function appEnv(seed) {
  const store = {};
  const calls = { radar: [], bars: [], line: [], multi: [], heatmap: [] };
  const stubEl = () => ({
    addEventListener() {}, removeEventListener() {}, append() {}, prepend() {},
    setAttribute() {}, removeAttribute() {}, remove() {}, click() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, children: [], innerHTML: "", textContent: "", value: "",
    querySelector: () => stubEl(), querySelectorAll: () => [], closest: () => stubEl(),
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
  });
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: {
      addEventListener() {}, removeEventListener() {},
      querySelector: () => stubEl(), querySelectorAll: () => [], getElementById: () => stubEl(),
      createElement: () => stubEl(), createElementNS: () => stubEl(), body: stubEl(), visibilityState: "visible",
    },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    Blob: function () {}, URL: { createObjectURL: () => "blob:x" },
    module: { exports: {} },
  };
  s.Chart = {
    radar: (h, o) => calls.radar.push(o), bars: (h, o) => calls.bars.push(o),
    line: (h, o) => calls.line.push(o), multi: (h, o) => calls.multi.push(o),
    heatmap: (h, o) => calls.heatmap.push(o),
  };
  s.window = s; s.globalThis = s;
  vm.createContext(s);
  const state = base(seed || {});
  vm.runInContext(`localStorage.setItem("fitness-app-v1", ${JSON.stringify(JSON.stringify(state))});`, s);
  const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/app.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
  vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, LIB: s.__X.EXERCISE_LIB, calls };
}
const iso = (off) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const base = (over = {}) => Object.assign({
  version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "C", sex: "M", heightCm: 178, weightKg: 80, bodyFatPct: 15, weeklyTarget: 3, units: "kg" },
  workouts: [], bodylog: [], overrides: {}, custom: [], achievements: {}, targets: {}, settings: { seeded: true },
}, over);
const wk = (date, sets, id = 73, name = "Bench Press", mode = "weight_reps") =>
  ({ id: "w" + date + id, date, note: "", entries: [{ id, name, mode, sets }] });

console.log("\n=== 1. windows must not overlap ===");
{
  const e = env();
  const st = base({ workouts: [wk(iso(0), [{ w: 100, r: 10 }]), wk(iso(7), [{ w: 100, r: 10 }]), wk(iso(14), [{ w: 100, r: 10 }])] });
  const v = e.E.volumeWeeks(st, 4);
  const total = v.reduce((a, x) => a + x.sessions, 0);
  console.log(`     3 sessions, one exactly every 7 days -> counted across 4 weeks: ${total}`);
  eq("every session counted exactly once", total, 3);
  // and the cur-vs-prev pair must not share a day
  const a = e.E.attributes(base({ workouts: [wk(iso(0), [{ w: 100, r: 10 }]), wk(iso(28), [{ w: 100, r: 10 }])] }), 28, 0);
  eq("the 28-day boundary session is in ONE window, not both", a.CON.detail.sessions, 1);
}

console.log("\n=== 2. history months are evenly spaced, never repeated ===");
{
  const e = env();
  const h = e.E.attributeHistory(base(), 12);
  const gaps = [];
  for (let i = 1; i < h.length; i++) gaps.push(Math.round((new Date(h[i].date + "T12:00:00") - new Date(h[i - 1].date + "T12:00:00")) / 86400000));
  console.log(`     gaps: ${gaps.join(" ")}`);
  eq("no gap shorter than 27 days", gaps.every((g) => g >= 27), true);
  eq("no duplicate months", new Set(h.map((x) => x.date)).size, h.length);
  // the bug only bit on month ends; prove the arithmetic itself is now safe
  const d = new Date(2026, 2, 31);                       // 31 March
  const clamped = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), 28), 12);
  eq("stepping back a month from the 31st lands in February", clamped.getMonth(), 1);
}

console.log("\n=== 3. every mode has a real best value (reps / time / distance) ===");
{
  const e = env();
  const c = [{ id: "c1", n: "Push Up", c: "Chest", g: ["Chest"], p: ["Chest"], s: [], e: ["Bodyweight"], m: "reps" }];
  const st = base({ custom: c, targets: { c1: { value: 25 } },
    workouts: [26, 22, 18, 14, 10].map((d, i) => wk(iso(d), [{ r: 10 + i * 2 }], "c1", "Push Up", "reps")) });
  const ser = e.E.seriesFor(st, "c1");
  console.log(`     reps series: ${ser.map((p) => p.top).join(" ")}`);
  eq("reps mode reports real values", ser.some((p) => p.top > 0), true);
  const tp = e.E.targetProgress(st, "c1");
  console.log(`     target 25 reps -> current ${tp.current}, ${Math.round(tp.pct)}%, eta=${tp.eta}, basis="${tp.basis}"`);
  truthy("a clear reps trend now produces an ETA", tp.eta != null);
  eq("...and it is not 'not enough sessions'", tp.basis, "your logged rate");

  // a flat reps exercise must be catchable as a plateau
  const flat = base({ custom: c, workouts: [26, 22, 18, 14, 10].map((d) => wk(iso(d), [{ r: 12 }], "c1", "Push Up", "reps")) });
  const stg = e.E.weakPoints(flat, 28).filter((w) => w.kind === "stagnant");
  truthy("a stalled reps exercise is flagged", stg.length > 0);

  const t = e.E.entryStats({ mode: "time", sets: [{ t: 60 }, { t: 90 }] });
  eq("time mode best is seconds", t.best, 90);
  const dd = e.E.entryStats({ mode: "distance_time", sets: [{ d: 5000, t: 1500 }, { d: 8000, t: 2400 }] });
  eq("distance mode best is metres", dd.best, 8000);
}

console.log("\n=== 4. XP only ever goes up ===");
{
  const e = env();
  const four = [1, 2, 3, 4].map((i) => wk(iso(i), [{ w: 100, r: 10 }]));
  const a = e.E.xp(base({ workouts: four }));
  const b = e.E.xp(base({ workouts: [10, 11, 12, 13].map((i) => wk(iso(i), [{ w: 100, r: 10 }])) }));
  console.log(`     same 4 sessions, recent -> ${a} XP; the same sessions 10 days old -> ${b} XP`);
  eq("identical training scores identical XP", a, b);
  const st = e.E.streaks(base({ workouts: four }));
  console.log(`     current streak ${st.days}d, best ever ${st.bestDays}d`);
  eq("best-ever streak is tracked", st.bestDays, 4);
}

console.log("\n=== 5. one improvement is one PR ===");
{
  const e = env();
  const st = base({ workouts: [wk(iso(7), [{ w: 100, r: 10 }]), wk(iso(0), [{ w: 100, r: 10 }, { w: 100, r: 10 }])] });
  const row = e.E.prTable(st)[0];
  console.log(`     adding one set -> hits: ${JSON.stringify(row.prs[0].hit)}`);
  truthy("the individual hits are still recorded for display", row.prs[0].hit.length > 1);
  eq("but only ONE PR is counted", e.E.prCount(st, 28), 1);
}

console.log("\n=== 6. over MRV must score below optimal ===");
{
  const e = env();
  // a barbell movement, so its stimulus weight is ~1.0 and raw sets are directly
  // comparable to the published landmarks (a pec deck at 0.71 legitimately shifts
  // what 18 sets means, which would make this test meaningless)
  const mk = (total, n = 6) => base({ workouts: Array.from({ length: n }, (_, i) => wk(iso(i * 4), Array.from({ length: Math.round(total / n) }, () => ({ w: 40, r: 10 })), 73, "Barbell Bench Press")) });
  const opt = e.E.muscleGroups(mk(72), 28).Chest;
  const over = e.E.muscleGroups(mk(96), 28).Chest;
  console.log(`     ${opt.setsPerWk} sets/wk (${opt.status}) score ${opt.score}`);
  console.log(`     ${over.setsPerWk} sets/wk (${over.status}) score ${over.score}`);
  eq("over its limit is flagged", over.status, "over its limit");
  truthy("...and scores lower than optimal", over.score < opt.score);
}

console.log("\n=== 7. tonnage is load x reps, nothing invented ===");
{
  const e = env();
  const t = e.E.entryStats({ mode: "weight_time", sets: [{ w: 20, t: 45 }, { w: 20, t: 45 }] });
  eq("a weight x time hold has no tonnage", t.tonnage, 0);
  eq("...but still counts its volume and time", [t.volume, t.time], [1800, 90]);
  const d = e.E.entryStats({ mode: "weight_distance", sets: [{ w: 24, d: 40 }] });
  eq("a weight x distance carry has no tonnage", d.tonnage, 0);
  const wr = e.E.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 10 }] });
  eq("weight x reps still does", wr.tonnage, 1000);
}

console.log("\n=== 8. the quad/hamstring check uses the same window as everything else ===");
{
  const e = env();
  // old leg work well outside 28 days must not appear
  const old = wk(iso(200), Array.from({ length: 40 }, () => ({ w: 100, r: 5 })), 375, "Leg Press");
  const st = base({ workouts: [wk(iso(1), [{ w: 100, r: 10 }], 369, "Leg Extension"), wk(iso(2), [{ w: 100, r: 10 }], 366, "Leg Curls (sitting)"), old] });
  const wp = e.E.weakPoints(st, 28).filter((w) => w.kind === "balance" && /Quad/.test(w.title));
  console.log(`     40 old sets outside the window; in-window detail: ${wp.length ? wp[0].detail : "(none)"}`);
  truthy("the all-time leg work is not counted", !wp.length || /Quads 1 sets/.test(wp[0].detail));
}

console.log("\n=== 9. per-exercise weighting: a set is not a set ===");
{
  const e = env();
  const custom = [
    { id: "x1", n: "Incline Crunches", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: ["Incline bench"], m: "weight_reps" },
    { id: "x2", n: "Crunches", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: [], m: "weight_reps" },
    { id: "x3", n: "Barbell Bench Press", c: "Chest", g: ["Chest", "Arms", "Shoulders"], p: ["Chest"], s: ["Triceps", "Shoulders"], e: ["Barbell", "Bench"], m: "weight_reps" },
    { id: "x4", n: "Pec Deck", c: "Chest", g: ["Chest"], p: ["Chest"], s: [], e: [], m: "weight_reps" },
    { id: "x5", n: "Leg Press on Hackenschmidt Machine", c: "Legs", g: ["Legs"], p: ["Quads"], s: [], e: [], m: "weight_reps" },
    { id: "x6", n: "Leg Extension", c: "Legs", g: ["Legs"], p: ["Quads"], s: [], e: [], m: "weight_reps" },
    { id: "x7", n: "Machine Chest Press", c: "Chest", g: ["Chest", "Arms", "Shoulders"], p: ["Chest"], s: ["Triceps", "Shoulders"], e: ["Machine"], m: "weight_reps" },
  ];
  const st = base({ custom });
  const w = (id) => e.E.exerciseWeight(st, id);
  for (const c of custom) console.log(`     ${String(w(c.id)).padStart(5)}  ${c.n}`);
  console.log(`        (isolation: crunch ${e.E.isIsolation(st, "x2")}, leg ext ${e.E.isIsolation(st, "x6")}, leg press ${e.E.isIsolation(st, "x5")}, bench ${e.E.isIsolation(st, "x3")})`);
  truthy("incline crunches count for MORE than flat crunches", w("x1") > w("x2"));
  truthy("a compound outranks an isolation", w("x3") > w("x4"));
  truthy("a leg press is not mistaken for an isolation", !e.E.isIsolation(st, "x5"));
  truthy("a pec deck IS an isolation", e.E.isIsolation(st, "x4"));
  truthy("free weight outranks the same lift on a machine", w("x3") > w("x7"));
  // and the override wins
  const ov = base({ custom, overrides: { x2: { weight: 1.3 } } });
  eq("an explicit override wins", e.E.exerciseWeight(ov, "x2"), 1.3);
  // and the score actually uses it
  // 4 sets, not 20: at 20 both are far past MRV where the score is meant to DECLINE
  // (peak at the optimum), so the comparison has to be made inside the useful range
  const sets = Array.from({ length: 4 }, () => ({ w: 20, r: 15 }));
  const flat = e.E.muscleGroups(base({ custom, workouts: [wk(iso(1), sets, "x2")] }), 28).Core;
  const inc = e.E.muscleGroups(base({ custom, workouts: [wk(iso(1), sets, "x1")] }), 28).Core;
  console.log(`     4 identical sets -> flat crunch score ${flat.score}, incline crunch score ${inc.score}`);
  truthy("the same work scores higher when it is harder work", inc.score > flat.score);
  // one session in the log means a one-week history, so 20 sets reads as 20/wk —
  // previously it was divided by four weeks the user had not existed for
  eq("raw sets/wk is scaled to the available weeks", [flat.setsPerWk, inc.setsPerWk], [4, 4]);
}

console.log("\n=== 10. cardio is gauged by time AND distance ===");
{
  const e = env();
  const custom = [{ id: "r1", n: "Running", c: "Cardio", g: ["Cardio"], p: [], s: [], e: [], m: "distance_time" },
                  { id: "b1", n: "Cycling", c: "Cardio", g: ["Cardio"], p: [], s: [], e: [], m: "distance_time" }];
  // SAME duration in both, so the only difference is whether distance was
  // recorded — that isolates what the distance term actually contributes
  const timed = base({ custom, workouts: [wk(iso(1), [{ t: 1800 }], "r1", "Running", "distance_time")] });
  const dist = base({ custom, workouts: [wk(iso(1), [{ d: 20000, t: 1800 }], "r1", "Running", "distance_time")] });
  const ride = base({ custom, workouts: [wk(iso(1), [{ d: 20000, t: 1800 }], "b1", "Cycling", "distance_time")] });
  const sw = e.E.staminaScore(timed, e.E.windowWorkouts(timed, 28, 0));
  const sr = e.E.staminaScore(dist, e.E.windowWorkouts(dist, 28, 0));
  const sb = e.E.staminaScore(ride, e.E.windowWorkouts(ride, 28, 0));
  console.log(`     30 min, no distance recorded    : ${Math.round(sw.score)}  (distance unknown -> minutes only)`);
  console.log(`     30 min covering 20 km on foot   : ${Math.round(sr.score)}  mod=${sr.distMod}  pace=${sr.paceKmh.toFixed(1)} km/h`);
  console.log(`     the SAME 20 km in 30 min cycling: ${Math.round(sb.score)}  mod=${sb.distMod}`);
  truthy("recording the distance scores higher than the same session without it", sr.score > sw.score);
  truthy("the same distance on a bike is not ranked like a run", Math.abs(sr.score - sb.score) > 0.5);
  eq("modality is identified from the name", [sr.distMod, sb.distMod], ["on foot", "cycling"]);
  near("pace is reported (20 km in 30 min = 40 km/h)", sr.paceKmh, 40, 0.1);
  eq("distance per week is reported (20 km, one week of history)", sr.distKmPerWk, 20);
  truthy("without distance the minutes still stand (no invented penalty)", sw.distKmPerWk === 0 && sw.score > 0);
}

console.log("\n=== 11. round 2: the estimated Strength score ===");
{
  const e = env();
  // a leg-press-only lifter must not be scored on pressing he never did
  const leg = base({ workouts: [1, 3, 5].map((i) => wk(iso(i), [{ w: 200, r: 10 }], 375, "Leg Press on Hackenschmidt Machine")) });
  const s = e.E.attributes(leg, 28, 0).STR;
  console.log(`     leg press only -> Strength ${s.score} (${s.tier}) from "${s.detail.from}"`);
  truthy("a leg press is judged on the leg press table", /Leg Press/.test(s.detail.from || ""));
  truthy("...and does not read as an outstanding press", s.score < 70);
  // a lift with no table at all is capped low rather than read as a bench press
  const odd = base({ custom: [{ id: "z1", n: "Reverse Hyper Extension", c: "Legs", g: ["Legs"], p: [], s: [], e: [], m: "weight_reps" }],
    workouts: [wk(iso(1), [{ w: 150, r: 10 }], "z1", "Reverse Hyper Extension"), wk(iso(3), [{ w: 150, r: 10 }], "z1", "Reverse Hyper Extension")] });
  const z = e.E.attributes(odd, 28, 0).STR;
  console.log(`     unmatched movement -> Strength ${z.score}`);
  truthy("an unmatched movement does not inherit the bench press standard", z.score <= 55);
}

console.log("\n=== 12. round 2: two entry cards for one exercise ===");
{
  const e = env();
  const st = base({ workouts: [{ id: "d", date: iso(1), note: "", entries: [
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] },
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 10 }] },
  ] }] });
  const ser = e.E.seriesFor(st, 73);
  eq("one session is one point, not two", ser.length, 1);
  eq("...and it is the session's best, not an arbitrary card", Math.round(ser[0].est1RM), 117);
  eq("compareLast does not compare a session with itself", e.E.compareLast(st, 73), null);
  eq("bestFor still sees both cards", Math.round(e.E.bestFor(st, 73).est1RM), 117);
}

console.log("\n=== 13. round 2: a body-fat-only check-in ===");
{
  const e = env();
  const st = base({ bodylog: [{ date: iso(30), weightKg: 70, bodyFatPct: 16 }, { date: iso(1), bodyFatPct: 14 }] });
  eq("bodyweight falls back to the last entry that HAS a weight", e.E.bodyweight(st), 70);
  eq("...not zero", e.E.bodyweight(st) !== 0, true);
  const lean = base({ bodylog: [{ date: iso(30), weightKg: 70 }, { date: iso(1), bodyFatPct: 14 }] });
  const vit = e.E.attributes(lean, 28, 0).VIT;
  truthy("BMI is still scored from the last real weigh-in", /BMI/.test(vit.detail.basis || ""));
}

console.log("\n=== 14. round 2: cardio intervals are not strength sets ===");
{
  const e = env();
  const custom = [{ id: "r1", n: "Running", c: "Cardio", g: ["Cardio"], p: [], s: [], e: [], m: "distance_time" }];
  const st = base({ custom, workouts: [wk(iso(1), [{ d: 5000, t: 1500 }, { d: 5000, t: 1500 }, { d: 5000, t: 1500 }], "r1", "Running", "distance_time")] });
  const s = e.E.staminaScore(st, e.E.windowWorkouts(st, 28, 0));
  eq("cardio intervals add no strength volume", s.setsPerWk, 0);
  truthy("but the cardio minutes still count", s.cardioMinPerWk > 0);
}

console.log("\n=== 15. what counts as Mobility ===");
{
  const e = env();
  // control-at-range and flexibility work was invisible unless the name happened
  // to contain one of six words; 96 of 166 real movements scored zero
  const counts = ["Plank", "Side Plank", "Bird Dog", "Deadbug", "Pallof Press", "Turkish Get-Up",
    "Thoracic Rotation", "Landmine Rotation", "Cat-Cow", "90/90 Hip", "Deep Squat Hold",
    "Hip Flexor Stretch", "Foam Roll Quads", "Shoulder Dislocates"];
  for (const n of counts) truthy(`${n} counts as mobility`, e.E.isMobility(n));
  // loaded flexion under a short range is strength, not range — however much core work it is
  const excluded = ["Incline Crunches", "Crunches", "Sit-Up", "Hanging Leg Raise",
    "Barbell Ab Rollout", "Decline Bench Leg Raise", "Bicycle Crunch"];
  for (const n of excluded) eq(`${n} does NOT count as mobility`, e.E.isMobility(n), false);

  // and it must actually move the score
  // the engine reads the name through exInfo (library/custom by id), so the
  // exercise has to actually exist — else it is "Unknown" and matches nothing
  const customs = [{ id: "p1", n: "Plank", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: [], m: "time" },
                   { id: "c1x", n: "Incline Crunches", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: ["Incline bench"], m: "weight_reps" }];
  const mob = base({ custom: customs, workouts: [wk(iso(1), [{ t: 600 }], "p1", "Plank", "time")] });
  eq("a plank session scores mobility", e.E.attributes(mob, 28, 0).MOB.score > 0, true);
  const core = base({ custom: customs, workouts: [wk(iso(1), [{ w: 20, r: 15 }], "c1x", "Incline Crunches")] });
  eq("a crunch session does not", e.E.attributes(core, 28, 0).MOB.score, 0);
  const why = e.E.attributes(core, 28, 0).MOB;
  console.log(`        MOB detail: ${Math.round(why.detail.minPerWk)} min/wk, ${why.detail.sessions} sessions`);
  // the explanation must tell him why it is zero rather than leaving it a mystery
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the UI explains the rule for a zero", /Crunches and sit-ups do not/.test(src));
  truthy("the axis is labelled range & control, not range of motion", /sub: "range & control"/.test(fs.readFileSync(path.join(B, "js", "engine.js"), "utf8")));
}

console.log("\n=== 16. Discipline: frequency AND continuity ===");
{
  const e = env();
  const mk = (offsets, target = 4) => base({
    profile: Object.assign({}, base().profile, { weeklyTarget: target }),
    workouts: offsets.map((o, i) => ({ id: "w" + i, date: iso(o), note: "",
      entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] })),
  });
  const con = (offsets, target) => e.E.attributes(mk(offsets, target), 28, 0).CON;

  eq("no sessions scores zero", con([]).score, 0);

  const every2 = []; for (let d = 27; d >= 0; d -= 2) every2.push(d);
  const regular = con(every2);
  // 6w = the streak printed but never scored; both components exist now
  truthy("frequency is reported", regular.detail.frequency > 0);
  truthy("continuity is reported", regular.detail.continuity > 0);
  eq("the score is frequency-led, continuity-weighted",
    Math.round(0.70 * regular.detail.frequency + 0.30 * regular.detail.continuity), regular.score);

  /* Regularity must change the score at the SAME session count — but only once the
     user has a full window to be measured over. Both cases here span 28 days, so
     neither is being flattered by a short history. (A genuine new user who crams
     their first fortnight IS scored well, correctly: they trained hard in the only
     time they have had.) */
  const frontloaded = []; for (let d = 27; d >= 14; d -= 1) frontloaded.push(d);   // 14 in the first fortnight of a 28-day history
  const cram = con(frontloaded);
  console.log(`     14 sessions every 2nd day over 4 weeks -> ${regular.score}; the same 14 crammed into the first fortnight -> ${cram.score}`);
  truthy("regular beats crammed at the same session count, same span", regular.score > cram.score);

  // THE CONSTRAINT: one hard week is a dent, not a collapse
  const missed = []; for (let d = 8; d <= 27; d += 2) missed.push(d);
  const gap = regular.score - con(missed).score;
  console.log(`     steady 4 weeks -> ${regular.score}; one full week missed -> ${con(missed).score}  (costs ${gap} points)`);
  truthy("one missed week costs less than a third of the score", gap < 34);
  truthy("...and the continuity term itself barely moves for it",
    regular.detail.continuity - con(missed).detail.continuity < 35);
  truthy("a broken streak does NOT read zero", con(missed).detail.continuity > 40);

  // three quarters of plan is good training, not a fail
  const threePerWk = [27, 25, 23, 20, 18, 16, 13, 11, 9, 6, 4, 2];
  const t = con(threePerWk);
  console.log(`     3 sessions/week against a 4/week target -> ${t.score} (${t.tier}), frequency ${Math.round(t.detail.frequency)}`);
  truthy("a 25% shortfall is still a respectable score", t.score >= 75);

  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the explanation names both components", /frequency \$\{Math\.round\(x\.frequency\)\}/.test(src) && /continuity/.test(src));
}

console.log("\n=== 17. bodyweight movements: the load is the body ===");
{
  const e = env();
  const BW = 70;
  const custom = [{ id: "b1", n: "Pull Up", c: "Back", g: ["Back"], p: ["Lats"], s: ["Arms"], e: ["Pull-up bar"], m: "weight_reps" },
                  { id: "b2", n: "Push Up", c: "Chest", g: ["Chest"], p: ["Chest"], s: [], e: ["Bodyweight"], m: "weight_reps" },
                  { id: "b3", n: "Plank", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: ["Bodyweight"], m: "time" }];
  const bst = (sets) => base({ custom, profile: Object.assign({}, base().profile, { weightKg: BW }),
    workouts: [{ id: "p", date: iso(1), note: "", entries: [{ id: "b1", name: "Pull Up", mode: "weight_reps", sets }] }] });
  const st = (sets) => bst(sets);

  // factors: published fraction of bodyweight moved
  eq("pull-up moves the whole body", e.E.bwFactor("Pull Up"), 1.00);
  eq("dip ~0.95", e.E.bwFactor("Dip"), 0.95);
  eq("push-up ~0.64", e.E.bwFactor("Push Up"), 0.64);
  eq("plank is isometric, 0", e.E.bwFactor("Plank"), 0.00);
  eq("an unknown movement takes the mid-range assumption", e.E.bwFactor("Zercher Carry"), 0.65);
  truthy("a pull-up is recognised as bodyweight", e.E.isBodyweight("Pull Up"));

  // THE BUG: an unweighted bodyweight set was rejected outright
  const plain = e.E.entryStats(st([{ r: 8, bwKg: BW }]).workouts[0].entries[0]);
  eq("an unweighted pull-up counts as a set", plain.sets, 1);
  truthy("...and has a real tonnage", plain.tonnage > 0);
  near("...tonnage is bodyweight x reps", plain.tonnage, BW * 8, 1);
  truthy("...and a real estimated 1RM (was 0)", plain.est1RM > 0);
  near("...about bodyweight x 1.4 at 8 reps", plain.est1RM, BW * (1 + 8 / 30), 1);

  // the weight box is only what is STRAPPED ON
  const w20 = 20 / 2.2046226;
  const wtd = e.E.entryStats(st([{ w: w20, r: 8, bwKg: BW }]).workouts[0].entries[0]);
  near("a belt adds on TOP of the body", wtd.est1RM, (BW + w20) * (1 + 8 / 30), 1);
  truthy("...so 20 lb of belt is not read as a 26 lb total", wtd.est1RM > BW);

  // and it is gradable end to end
  const two = base({ custom, profile: Object.assign({}, base().profile, { weightKg: BW }), targets: { b1: { value: 100 } },
    workouts: [{ id: "a", date: iso(7), note: "", entries: [{ id: "b1", name: "Pull Up", mode: "weight_reps", sets: [{ r: 6, bwKg: BW }] }] },
               { id: "b", date: iso(0), note: "", entries: [{ id: "b1", name: "Pull Up", mode: "weight_reps", sets: [{ r: 10, bwKg: BW }] }] }] });
  const cmp = e.E.compareLast(two, "b1");
  truthy("6 -> 10 reps reads as progress", cmp && cmp.est1RM.pct > 0);
  truthy("it has a target percentage", e.E.targetProgress(two, "b1").pct > 0);
  truthy("it sets PRs", e.E.prTable(two).some((x) => x.prs.length > 0));
  truthy("it volume-loads the back", e.E.muscleGroups(two, 28).Back.setsPerWk > 0);

  // a core lift with no published table must not enter the strength average as a 0
  const mixed = base({ custom, profile: Object.assign({}, base().profile, { weightKg: BW }),
    workouts: [{ id: "a", date: iso(1), note: "", entries: [{ id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] },
               { id: "b", date: iso(2), note: "", entries: [{ id: "b1", name: "Pull Up", mode: "weight_reps", sets: [{ r: 8, bwKg: BW }] }] }] });
  const ss = e.E.attributes(mixed, 28, 0).STR;
  eq("only tabled lifts enter the ratio average", Object.keys(ss.detail.lifts), ["bench"]);
  truthy("a pull-up does not drag Strength down", ss.score > 60);
}

console.log("\n=== 18. a new user must not be judged against weeks that predate them ===");
{
  const e = env();
  const mk = (offs, target = 4) => base({ profile: Object.assign({}, base().profile, { weeklyTarget: target }),
    workouts: offs.map((o, i) => ({ id: "w" + i, date: iso(o), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] })) });

  eq("activeWeeks is 1 for a 2-day history", Math.round(e.E.activeWeeks(mk([1, 0]), 28)), 1);
  eq("...and the full 4 once the history is 28 days", e.E.activeWeeks(mk([27, 20, 13, 6]), 28), 4);

  // the headline: three sessions in three days is doing everything right
  const fresh = e.E.attributes(mk([2, 1, 0]), 28, 0).CON;
  console.log(`     3 sessions on days 1-3 (new user) -> Discipline ${fresh.score} (${fresh.tier}), expected ${fresh.detail.expected}`);
  truthy("a perfect start scores well, not badly", fresh.score >= 75);
  eq("...judged against one week of target, not four", fresh.detail.expected, 4);
  eq("...and their single week counts as full coverage", Math.round(fresh.detail.continuity), 99);

  // established users must be untouched
  const steady = []; for (let d = 27; d >= 0; d -= 2) steady.push(d);
  eq("4 weeks in, every 2 days -> 86", e.E.attributes(mk(steady), 28, 0).CON.score, 86);
  eq("4 weeks in, 3/wk against a 4/wk target -> 80", e.E.attributes(mk([27, 25, 23, 20, 18, 16, 13, 11, 9, 6, 4, 2]), 28, 0).CON.score, 80);
  // and genuinely low training is still flagged
  truthy("2 sessions over a whole month is still poor",
    e.E.attributes(mk([27, 25]), 28, 0).CON.score < 30);
  eq("an empty log scores 0", e.E.attributes(mk([]), 28, 0).CON.score, 0);

  // weekly rates everywhere, not just Discipline
  const withCardio = base({ custom: [{ id: "r1", n: "Running", c: "Cardio", g: ["Cardio"], p: [], s: [], e: [], m: "distance_time" }],
    workouts: [{ id: "c", date: iso(1), note: "", entries: [{ id: "r1", name: "Running", mode: "distance_time", sets: [{ d: 5000, t: 1800 }] }] }] });
  truthy("stamina's weekly minutes are not divided by 4 for a new user",
    e.E.staminaScore(withCardio, e.E.windowWorkouts(withCardio, 28, 0)).cardioMinPerWk > 20);
  const oneSet = base({ workouts: [{ id: "m", date: iso(1), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] }] });
  eq("a single session reads as its own week, not a quarter of one",
    e.E.muscleGroups(oneSet, 28).Chest.setsPerWk, 1);
}

console.log("\n=== 19. first run: nothing may be invented or imposed ===");
{
  const e = env();
  const blank = () => base({ profile: { name: "", sex: "M", heightCm: null, weightKg: null, bodyFatPct: null,
    goalWeightKg: null, goalBodyFatPct: null, weeklyTarget: 4, units: "kg" } });
  const noWeight = blank();
  Object.assign(noWeight, { workouts: [{ id: "a", date: iso(1), note: "",
    entries: [{ id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 80, r: 5 }] }] }] });

  // a fabricated measurement presented as a real one is worse than no score
  const s = e.E.attributes(noWeight, 28, 0).STR;
  eq("no bodyweight means no Strength score", s.score, 0);
  eq("...and it says why", s.detail.basis, "no weight");
  eq("...and reports no weight rather than an invented one", s.detail.bw, 0);
  eq("achievement ratios do not fire against a made-up weight",
    e.E.achievementContext(noWeight).ratio.bench, 0);
  // with a real weight it is unchanged
  const w = blank();
  Object.assign(w, { profile: Object.assign({}, blank().profile, { weightKg: 80 }),
    workouts: noWeight.workouts });
  truthy("a real bodyweight still scores", e.E.attributes(w, 28, 0).STR.score > 0);
  eq("...using the weight given", e.E.attributes(w, 28, 0).STR.detail.bw, 80);

  // the year chart must not plot months that predate the account
  const young = blank();
  Object.assign(young, { profile: Object.assign({}, blank().profile, { weightKg: 80 }),
    workouts: [{ id: "a", date: iso(2), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 80, r: 5 }] }] }] });
  eq("a 3-day-old account plots one month, not twelve", e.E.attributeHistory(young, 12).length, 1);
  const old = blank();
  Object.assign(old, { workouts: Array.from({ length: 12 }, (_, i) => ({ id: "w" + i, date: iso(i * 7), note: "",
    entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] })) });
  eq("a 3-month-old account plots three", e.E.attributeHistory(old, 12).length, 3);

  // and a fresh install must not seed a workout into the user's log
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  eq("boot() no longer auto-seeds a session", /!S\.settings\.seeded && !S\.workouts\.length/.test(appSrc), false);
  truthy("the Profile button still offers it deliberately", /d-seed/.test(appSrc));
  // The "Strength is a ratio… add your bodyweight" explanation MOVED to the one
  // shared source (js/glossary.js) as part of the glossary unification, so this
  // now proves the explanation still exists AND that the UI renders it from there.
  const glossSrc = fs.readFileSync(path.join(B, "js", "glossary.js"), "utf8");
  truthy("the shared source explains Strength as a ratio against bodyweight",
    /How much you can lift for your bodyweight/.test(glossSrc) && /bodyweight strength standards/.test(glossSrc));
  truthy("the UI explains the missing bodyweight",
    /Add your bodyweight in Profile/.test(appSrc) && /GLOSS\.attrPlain/.test(appSrc));
}

console.log("\n=== 20. the consistency grid starts at the first logged workout ===");
{
  const e = env();
  const mk = (offs) => base({ profile: Object.assign({}, base().profile, { weeklyTarget: 4, weightKg: 80 }),
    workouts: offs.map((o, i) => ({ id: "w" + i, date: iso(o), note: "",
      entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] })) });

  // trained every day since installing: the grid must show exactly that
  const daily = e.E.dayMap(mk([2, 1, 0]), 371);
  eq("3 days of history draws 3 cells, not 371", Object.keys(daily).length, 3);
  eq("...all three trained", Object.values(daily).filter((d) => d.sessions > 0).length, 3);
  eq("2 weeks daily draws 14", Object.keys(e.E.dayMap(mk([...Array.from({ length: 14 }, (_, i) => 13 - i)]), 371)).length, 14);
  // an established user is still capped at the full year
  eq("a 4-month history is capped at 371 cells", Object.keys(e.E.dayMap(mk([...Array.from({ length: 60 }, (_, i) => i * 2)]), 371)).length, 119);
  // an empty account shows an EMPTY state, not a year of blank cells (item 5a
  // deliberately changed this: the old fallback drew 371 empty days)
  eq("an empty account draws no grid, not 371 blanks", Object.keys(e.E.dayMap(mk([]), 371)).length, 0);
  eq("...with nothing trained", Object.values(e.E.dayMap(mk([]), 371)).filter((d) => d.sessions > 0).length, 0);

  // the card must report the real span, not a fixed year
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the label uses the actual span", /of the last \$\{span\} \$\{pl\(span, "day"\)\}/.test(appSrc));
  truthy("...and says so when it is short", /since you started/.test(appSrc));
  eq("the hardcoded 371-day label is gone", /of the last 371 days/.test(appSrc), false);
  // and an empty account renders an empty state, not a blank grid
  truthy("the dashboard shows an empty state for a brand-new account", /No sessions yet/.test(appSrc));
  truthy("...and no heatmap is drawn for it", /\$\{trained\} of the last/.test(appSrc));
}

console.log("\n=== 21. a bodyweight movement must count the body, not just the plate ===");
{
  const e = env();
  // classify by the names the LIBRARY actually uses, not convenient singulars
  eq("'Dips' (the real library entry) is bodyweight", e.E.isBodyweight("Dips"), true);
  eq("...at the published fraction", e.E.bwFactor("Dips"), 0.95);
  eq("'Pull-ups' is bodyweight", e.E.isBodyweight("Pull-ups"), true);
  eq("'Incline Crunches' is bodyweight", e.E.isBodyweight("Incline Crunches"), true);
  // the owner's standard incline crunch is a 40 deg bench with the HEAD BELOW THE
  // HIPS — the decline geometry — sweeping -40 -> +35 deg. Mean moment arm 0.93
  // (peak load the same as flat) but 75 deg of travel against 35: 2.12x the work.
  // 0.40 x 2.12 = 0.85. Derived from the geometry, not picked.
  eq("...at the 40-deg head-below standard", e.E.bwFactor("Incline Crunches"), 0.85);
  eq("a flat crunch keeps the flat-bench value", e.E.bwFactor("Abdominal Crunch"), 0.40);
  eq("...as does a sit-up", e.E.bwFactor("Sit-ups"), 0.40);
  eq("...and a hanging leg raise takes its own hip-flexion value, not the crunch's", e.E.bwFactor("Hanging Leg Raise"), 0.21);
  eq("'Plank' is an isometric hold (no load moved)", e.E.bwFactor("Plank"), 0);

  // equipment that supplies its own load must never be counted as bodyweight
  for (const n of ["Seated Dip Machine", "Assisted Dip Machine", "Cable Crunch", "Machine Chest Press", "Lat Pulldown", "Leg Press"])
    eq(`'${n}' supplies its own load`, e.E.isBodyweight(n), false);

  // a set logged before bodyweight stamping existed still counts the body
  const st = base({ profile: Object.assign({}, base().profile, { weightKg: 80 }),
    workouts: [{ id: "c", date: iso(1), note: "",
      entries: [{ id: 171, name: "Incline Crunches", mode: "weight_reps", sets: [{ w: 6.8039, r: 20 }] }] }] });
  const before = e.E.seriesFor(st, 171).slice(-1)[0].top;
  eq("an unstamped set scores on the plate alone", Math.round(before * 2.2046), 21);
  eq("backfill stamps it", e.E.backfillBodyweight(st), 1);
  const after = e.E.seriesFor(st, 171).slice(-1)[0].top;
  // 6.8039 + 80 x 0.85 = 74.8 kg (head-below 40 deg standard), x (1 + 12/30) = 104.7 kg
  eq("...using the bodyweight on that set's own date", Math.round(after * 2.2046), Math.round((6.8039 + 80 * 0.85) * (1 + 12 / 30) * 2.2046));
  truthy("...which is a far larger, honest load", after > before * 2);
  eq("it is idempotent", e.E.backfillBodyweight(st), 0);
  // and it must not invent a weight that was never recorded
  const none = base({ profile: Object.assign({}, base().profile, { weightKg: null }),
    workouts: [{ id: "c", date: iso(1), note: "",
      entries: [{ id: 171, name: "Incline Crunches", mode: "weight_reps", sets: [{ w: 6.8039, r: 20 }] }] }] });
  eq("with no bodyweight known it leaves the set alone", e.E.backfillBodyweight(none), 0);
}

console.log("\n=== 22. crunch/sit-up on an angled bench, both directions, from the trunk sweep ===");
{
  const e = env();
  // One rep's work ∝ (sin(phi_top) - sin(phi_rest)), phi = trunk angle from
  // horizontal. Reference flat crunch: 0 -> +35 deg, work ∝ sin35 = 0.574.
  // Head-below 40 deg: -40 -> +35, ∝ sin35 - sin(-40) = 1.216 = 2.12x flat
  //   -> bwFactor 0.40 x 2.12 = 0.85 (shipped), workFactor 2.12.
  // Head-above 40 deg: +40 -> +75 (same 35 deg sweep as flat, shifted up),
  //   ∝ sin75 - sin40 = 0.323 = 0.56x flat -> bwFactor 0.40 x 0.56 = 0.23.
  eq("flat crunch is the 0.40 reference", e.E.bwFactor("Abdominal Crunch"), 0.40);
  eq("a sit-up shares the flat reference", e.E.bwFactor("Sit-ups"), 0.40);
  eq("head-below (40 deg, head down) is 2.12x the sweep", e.E.bwFactor("Incline Crunches"), 0.85);
  eq("...and the decline spelling too", e.E.bwFactor("Decline Crunch"), 0.85);
  eq("head-above (40 deg, head up) is 0.56x the sweep", e.E.bwFactor("Incline Sit-up"), 0.23);
  eq("...and the head-above spelling too", e.E.bwFactor("Head-above Crunch"), 0.23);
  eq("both directions are recognised as bodyweight",
    [e.E.isBodyweight("Incline Sit-up"), e.E.isBodyweight("Head-above Crunch")], [true, true]);

  // the work factor carries the same integral into the per-rep effort weighting
  eq("flat crunch work factor is the unit reference", e.E.workFactor("Abdominal Crunch"), 1);
  eq("head-below work factor is 2.12", e.E.workFactor("Incline Crunches"), 2.12);
  eq("head-above work factor is 0.56", e.E.workFactor("Incline Sit-up"), 0.56);
  eq("...and a head-above spelling too", e.E.workFactor("Head-above Crunch"), 0.56);

  // direction of the change, asserted INSIDE the useful Core volume range.
  // Core MEV/MAV/MRV = 4/12/20, so 4 sets in a one-week history sits below MAV;
  // past MRV the score is DESIGNED to fall, so a saturated comparison would be
  // meaningless. Same sets, same everything but the name.
  const custom = [
    { id: "hb", n: "Incline Crunches", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: [], m: "weight_reps" },
    { id: "fl", n: "Abdominal Crunch", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: [], m: "weight_reps" },
    { id: "ha", n: "Head-above Crunch", c: "Abs", g: ["Core"], p: ["Abs"], s: [], e: [], m: "weight_reps" },
  ];
  const sets = Array.from({ length: 4 }, () => ({ w: 20, r: 15 }));
  const core = (id, name) => e.E.muscleGroups(base({ custom, workouts: [wk(iso(1), sets, id, name)] }), 28).Core;
  const hb = core("hb", "Incline Crunches"), fl = core("fl", "Abdominal Crunch"), ha = core("ha", "Head-above Crunch");
  console.log(`     4 identical sets -> head-below ${hb.score} (${hb.setsPerWk}/wk), flat ${fl.score}, head-above ${ha.score}`);
  truthy("the harder (head-below) case out-scores flat for the same work", hb.score > fl.score);
  truthy("flat out-scores the easier (head-above) case for the same work", fl.score > ha.score);
  truthy("the harder case is not saturated, so the comparison is inside the range", hb.score < 95);
  eq("raw sets/wk stays raw for every variant", [hb.setsPerWk, fl.setsPerWk, ha.setsPerWk], [4, 4, 4]);
}

console.log("\n=== 23. push-up variants, from published force-plate measurement ===");
{
  const e = env();
  eq("flat push-up keeps the measured mid value", e.E.bwFactor("Push-ups"), 0.64);
  eq("...as does the singular library form", e.E.bwFactor("Push-Up"), 0.64);
  // naming trap: for push-ups 'incline' = HANDS elevated = EASIER
  eq("incline push-up (hands up) is easier, near the 41% end", e.E.bwFactor("Incline Push-ups"), 0.55);
  eq("decline push-up (feet up) is harder, near the 74% end", e.E.bwFactor("Decline Push-ups"), 0.74);
  truthy("...and it is the harder of the two", e.E.bwFactor("Decline Push-ups") > e.E.bwFactor("Incline Push-ups"));
  // and the convention must NOT leak backwards onto the bench crunch
  eq("an incline crunch is still the hard head-below case", e.E.bwFactor("Incline Crunches"), 0.85);
  eq("an incline bench press is not bodyweight at all", e.E.isBodyweight("Incline Bench Press"), false);
  // knee push-up sits between
  eq("knee push-up takes the two-study consensus, not a midpoint", e.E.bwFactor("Knee Push-ups"), 0.49);
  // rows are measured, for the suspension variant; endpoints key on the direction word
  /* bwFactor() pattern-matches on its own, so a factor can be set and still be
     UNREACHABLE if isBodyweight() does not let it through. Asserting only the
     factor let exactly that bug through once: the row rules were dead for a
     publish. Every new factor now has to prove its gate is open too. */
  eq("an upright/incline row is the easier end", e.E.bwFactor("Incline Row"), 0.38);
  eq("...and its bodyweight gate is actually open", e.E.isBodyweight("Incline Row"), true);
  eq("a feet-elevated row is the harder end", e.E.bwFactor("Feet-Elevated Row"), 0.81);
  eq("...and its bodyweight gate is actually open", e.E.isBodyweight("Feet-Elevated Row"), true);
  eq("a plain inverted row keeps its reference", e.E.bwFactor("Inverted Row"), 0.57);
  eq("...and it is gated on", e.E.isBodyweight("Inverted Row"), true);
  // and every push-up variant must be reachable
  for (const n of ["Push-ups", "Incline Push-ups", "Decline Push-ups", "Knee Push-ups"])
    eq(`'${n}' is a live bodyweight movement`, e.E.isBodyweight(n), true);
  truthy("...and the harder end is the larger fraction", e.E.bwFactor("Feet-Elevated Row") > e.E.bwFactor("Incline Row"));
}

console.log("\n=== 24. derived load factors: rows, leg raises, nordics, plank ===");
{
  /* These are BW_FACTOR (load-fraction) changes. BW_FACTOR feeds entryStats' load,
     hence the movement's estimated 1RM and tonnage — NOT the set-volume score
     (muscleGroups reads sets * exerciseWeight, which never sees bwFactor). So the
     direction of every change is asserted on the load/e1RM, and there is no MRV
     saturation to trip over: a harder variant simply produces a larger load. Every
     rule also proves its gate is open (the shipped-twice unreachable-factor bug). */
  const e = env();
  const BW = 70;

  // --- rows: fitted to the four MEASURED suspension-row anchors ---
  // f(theta) = 0.1009 + 0.009401*theta (deg); reference 50 deg -> 0.571
  eq("upright/high-anchor row (30 deg) is 0.38", e.E.bwFactor("Incline Row"), 0.38);
  eq("...gated", e.E.isBodyweight("Incline Row"), true);
  eq("reference plain inverted row (50 deg) is 0.57", e.E.bwFactor("Inverted Row"), 0.57);
  eq("...gated", e.E.isBodyweight("Inverted Row"), true);
  eq("horizontal/low-anchor row (75 deg) is 0.81", e.E.bwFactor("Feet-Elevated Row"), 0.81);
  eq("...gated", e.E.isBodyweight("Feet-Elevated Row"), true);
  eq("an Australian pull-up is the row, not a full pull-up", e.E.bwFactor("Australian Pull-up"), 0.57);
  eq("...and it is gated", e.E.isBodyweight("Australian Pull-up"), true);
  truthy("the row factor rises with body angle", e.E.bwFactor("Incline Row") < e.E.bwFactor("Inverted Row") && e.E.bwFactor("Inverted Row") < e.E.bwFactor("Feet-Elevated Row"));

  const rowE1 = (id, name) => {
    const st = base({ profile: Object.assign({}, base().profile, { weightKg: BW }),
      workouts: [{ id: "r", date: iso(1), note: "", entries: [{ id, name, mode: "weight_reps", sets: [{ r: 10, bwKg: BW }] }] }] });
    return e.E.entryStats(st.workouts[0].entries[0]).est1RM;
  };
  const eU = rowE1("r1", "Incline Row"), eR = rowE1("r2", "Inverted Row"), eH = rowE1("r3", "Feet-Elevated Row");
  console.log(`     row e1RM by angle: upright ${eU.toFixed(1)} < inverted ${eR.toFixed(1)} < horizontal ${eH.toFixed(1)}`);
  truthy("a harder row yields a strictly larger load end to end", eU < eR && eR < eH);

  // --- leg raise / knee raise: HIP flexion, from the lower-limb mass fraction ---
  eq("straight-leg raise is 0.21", e.E.bwFactor("Hanging Leg Raise"), 0.21);
  eq("...gated", e.E.isBodyweight("Hanging Leg Raise"), true);
  eq("bent-knee raise is 0.15", e.E.bwFactor("Hanging Knee Raise"), 0.15);
  eq("...gated", e.E.isBodyweight("Hanging Knee Raise"), true);
  eq("a plain lying leg raise shares the straight-leg value", e.E.bwFactor("Leg Raise"), 0.21);
  eq("a knee raise shares the bent value", e.E.bwFactor("Knee Raise"), 0.15);
  truthy("straight-leg out-loads bent-knee (longer lever)",
    e.E.bwFactor("Hanging Leg Raise") > e.E.bwFactor("Hanging Knee Raise"));

  // --- nordic / glute-ham ---
  eq("nordic hamstring curl is 0.68", e.E.bwFactor("Nordic Curl"), 0.68);
  eq("...gated", e.E.isBodyweight("Nordic Curl"), true);
  eq("glute-ham raise (shorter lever) is 0.59", e.E.bwFactor("Glute-Ham Raise"), 0.59);
  eq("...gated", e.E.isBodyweight("Glute-Ham Raise"), true);
  eq("razor curl is now gated (its rule was previously unreachable)", e.E.isBodyweight("Razor Curl"), true);
  eq("...at the nordic value", e.E.bwFactor("Razor Curl"), 0.68);
  truthy("the full-lever nordic out-loads the glute-ham",
    e.E.bwFactor("Nordic Curl") > e.E.bwFactor("Glute-Ham Raise"));

  // --- plank / isometric holds stay 0.00, deliberately ---
  eq("a plank still moves no load", e.E.bwFactor("Plank"), 0);
  eq("...but it is still recognised as a bodyweight movement", e.E.isBodyweight("Plank"), true);
  const plankE1 = e.E.entryStats({ mode: "weight_reps", name: "Plank", sets: [{ r: 10, bwKg: BW }] }).est1RM;
  eq("so a rep-logged plank invents no tonnage and no 1RM", plankE1, 0);
}

console.log("\n=== 25. muscle-balance card: bars, radar and status share ONE scale ===");
{
  /* The card drew its BARS and its radar axis label from mg[g].setsPerWk (the raw
     set count) while the status word and the score beside them came from the
     effort-weighted effPerWk. So it contradicted itself: for Core it drew a bar
     at 2 and printed a status derived from 3.8. Bars, radar label and the
     MEV/MAV/MRV markers must all ride the effort-weighted scale the status uses;
     the raw count stays visible but labelled raw. */
  const h = appEnv({ workouts: [{ id: "w1", date: iso(2), note: "", entries: [
    { id: 171, name: "Incline Crunches", mode: "weight_reps", sets: [{ w: 10, r: 10 }, { w: 10, r: 10 }, { w: 10, r: 10 }] },
    { id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 80, r: 5 }, { w: 80, r: 5 }] },
  ] }] });
  const mg = h.E.muscleGroups(h.S.state, 28);
  h.A.render();
  const bars = h.calls.bars[h.calls.bars.length - 1];           // the muscle bars
  const radar = h.calls.radar.filter((o) => o.title === "muscles")[0];
  truthy("the muscle-balance card rendered a bar chart", !!bars);
  truthy("...and its radar", !!radar);
  eq("the bars are drawn on the effort-weighted scale the status uses",
    bars.items.map((i) => i.value), h.E.GROUP_ORDER.map((g) => mg[g].effPerWk));
  truthy("...and at least one group's effort value differs from its raw count, so the two scales are genuinely not the same",
    h.E.GROUP_ORDER.some((g) => mg[g].effPerWk !== mg[g].setsPerWk));
  eq("the radar axis label is the same effort-weighted value",
    radar.axes.map((a) => a.tier), h.E.GROUP_ORDER.map((g) => mg[g].effPerWk + "/wk"));
  eq("the MEV markers sit on that same numeric scale",
    bars.items.map((i) => i.marker), h.E.GROUP_ORDER.map((g) => mg[g].landmarks.mev));
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the raw count is still shown, and labelled raw",
    /m\.setsPerWk\} raw sets<\/span>/.test(src) && /effort sets \/ raw sets/.test(src));
}

console.log("\n=== 26. every load factor in BW_FACTOR is reachable through the gate ===");
{
  /* The bug that shipped TWICE: a factor assigned in BW_FACTOR and refused by
     the separate BW_NAME gate. The factor was dead code, and entryStats then
     dropped the movement's unweighted sets from the totals. The gate is now
     derived from the factor table, and this test proves it for EVERY entry by
     deriving a witness name from each pattern's own source, so a new or renamed
     rule is checked automatically rather than by hand. */
  const e = env();
  const F = e.E.BW_FACTOR;
  truthy("the factor table is exposed for this check", Array.isArray(F) && F.length > 10);
  const witness = (re) => re.source.split("|").map((a) => a
    .replace(/\\b/g, "").replace(/\.\?/g, "z").replace(/\.\*/g, "z").replace(/\\s\*/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, "")).find((a) => a.trim());
  let dead = 0;
  F.forEach(([re, f], i) => {
    const w = witness(re);
    const ok = !!w && re.test(w) && !e.E.SUPPLIES_LOAD.test(w) && e.E.isBodyweight(w) === true;
    if (!ok) { dead++; console.log(`      FAIL factor [${i}] ${re} f=${f} witness=${JSON.stringify(w)} admitted=${w ? e.E.isBodyweight(w) : "-"}`); }
  });
  eq("every factor pattern admits the name it matches", dead, 0);

  // and the REAL library: no movement carrying a factor may be refused by the gate
  const refused = [];
  for (const x of e.LIB) if (e.E.hasBwFactor(x.n) && !e.E.SUPPLIES_LOAD.test(x.n) && !e.E.isBodyweight(x.n)) refused.push(x.n);
  eq("no library movement with a factor is refused by the gate", refused, []);

  // the families the audit named are now actually admitted
  for (const n of ["Barbell Lunges Standing", "Bulgarian Squat with Dumbbells", "Step-ups", "Standing Calf Raises", "Inverted Rows", "V-Up"])
    eq(`'${n}' is admitted`, e.E.isBodyweight(n), true);
  // equipment that supplies its own load is still refused, factor or not
  for (const n of ["Calf Raise using Hack Squat Machine", "Smith Machine Split Squat", "Seated Dip Machine"])
    eq(`'${n}' still supplies its own load`, e.E.isBodyweight(n), false);
}

console.log("\n=== 27. a short-id exercise's tracking-mode override survives ===");
{
  /* The Log screen's mode control persisted only when String(id).length > 2, so
     every library id from 9 to 99 was silently skipped — including Bench Press,
     id 73 — while the detail modal persisted unconditionally. Both now route
     through one helper, so the two paths cannot disagree. */
  const h = appEnv({});
  truthy("both call sites share one persistence helper", typeof h.A.setTrackMode === "function");
  h.A.setTrackMode(73, "time");           // Bench Press — a 2-digit library id
  eq("id 73 (Bench Press) persists its override", (h.S.state.overrides["73"] || {}).mode, "time");
  h.A.setTrackMode(9, "reps");            // the shortest 1-digit id
  eq("a 1-digit id persists too", (h.S.state.overrides["9"] || {}).mode, "reps");
  h.A.setTrackMode(171, "weight_time");
  eq("a 3-digit id still persists", (h.S.state.overrides["171"] || {}).mode, "weight_time");
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  eq("the length>2 gate is gone", /String\(en\.id\)\.length > 2/.test(src), false);
  truthy("the Log control routes through the shared helper", /setTrackMode\(en\.id, en\.mode\)/.test(src));
  truthy("the detail-modal control routes through the same helper", /setTrackMode\(id, e\.target\.value\)/.test(src));
}

console.log("\n=== 28. the dead 'Hide from lists' control is gone ===");
{
  /* The exercise detail modal rendered a dt-hide button with no listener and no
     engine support, and its label keyed off S.overrides[id] — which is set by
     the mode/weight overrides too, so it read "Unhide" whenever ANY override
     existed. Removing it is the smaller correct change. */
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  eq("no dt-hide control remains", /dt-hide/.test(src), false);
  eq("and no listener for it either", /#dt-hide/.test(src), false);
}

console.log("\n=== 29. custom exercises can be renamed and deleted (item 3) ===");
{
  /* Store.updateCustom / deleteCustom existed but were never called from the UI,
     so a typo (or a notes-importer fuzzy match) was permanent and kept feeding
     the muscle-group analysis. The detail modal now offers both, and deleting
     removes every key the exercise owned (target + override) while KEEPING the
     logged sets — history is never rewritten. With the override gone, exInfo()
     falls back to ["Core"], so those sets keep counting (as Core) instead of
     being detached. */
  const h = appEnv({});
  h.A.buildIndex();
  h.S.addCustom({ id: "uz", n: "Typo Press", c: "Chest", p: ["Chest"], s: [], e: ["Machine"], m: "weight_reps", g: ["Chest"], d: "" });
  h.A.buildIndex();
  eq("a custom exercise is detected", h.A.isCustomEx("uz"), true);
  eq("a library exercise is not custom", h.A.isCustomEx(73), false);
  truthy("the modal renders rename + delete for a custom exercise",
    /dt-rename/.test(h.A.customControlsHTML("uz")) && /dt-del/.test(h.A.customControlsHTML("uz")));
  eq("...and nothing for a library exercise", h.A.customControlsHTML(73), "");
  eq("rename applies", h.A.renameCustomEx("uz", "Fixed Press"), true);
  eq("the stored name changed", h.S.state.custom.find((x) => x.id === "uz").n, "Fixed Press");
  eq("a blank rename is refused", h.A.renameCustomEx("uz", "   "), false);
  eq("...and changed nothing", h.S.state.custom.find((x) => x.id === "uz").n, "Fixed Press");
  h.S.upsertWorkout({ id: "wz", date: iso(3), entries: [{ id: "uz", name: "Fixed Press", mode: "weight_reps", sets: [{ w: 40, r: 10 }] }] });
  h.A.deleteCustomEx("uz");
  eq("delete removes it from the custom list", h.S.state.custom.length, 0);
  eq("but keeps the logged set (detach, not silent data loss)", h.S.state.workouts[0].entries.length, 1);
  eq("and keeps counting as its fallback group", h.E.exGroups(h.S.state, "uz"), ["Core"]);
  // the modal actually wires the controls (not a dead control)
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the detail modal embeds the custom controls", /\$\{customControlsHTML\(id\)\}/.test(src));
  truthy("...and binds rename + delete listeners", /#dt-rename/.test(src) && /#dt-del/.test(src));
}

console.log("\n=== 30. import: merge vs confirm-guarded replace (item 4) ===");
{
  /* importJSON supported a replace mode, but the only UI path hard-coded merge,
     so a user whose state had gone inconsistent had no way to restore a clean
     export over it. A clearly-labelled, confirm-guarded replace path now exists
     and its warning names exactly what is lost. */
  const h = appEnv({});
  h.A.buildIndex();
  h.S.upsertWorkout({ id: "w1", date: iso(10), entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 80, r: 5 }] }] });
  h.S.addBodyLog({ date: iso(10), weightKg: 82 });
  h.S.addCustom({ id: "uz", n: "Typo", c: "Chest", g: ["Chest"], p: ["Chest"], s: [], e: [], m: "weight_reps", d: "" });
  const warn = h.A.replaceImportWarning();
  truthy("the warning counts the workouts at risk", /1 workout\b/.test(warn));
  truthy("...and the bodyweight logs", /1 bodyweight log\b/.test(warn));
  truthy("...and the custom exercises", /1 custom exercise\b/.test(warn));
  truthy("...and says it cannot be undone", /cannot be undone/i.test(warn));
  const srcEnv = appEnv({});
  srcEnv.S.upsertWorkout({ id: "w9", date: iso(40), entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 5 }] }] });
  const file = srcEnv.S.exportJSON();
  h.A.importData(file, "merge");
  eq("merge is additive: the local workout survives", h.S.state.workouts.some((w) => w.id === "w1"), true);
  eq("...and the imported one is added", h.S.state.workouts.some((w) => w.id === "w9"), true);
  h.A.importData(file, "replace");
  eq("replace discards the local workout", h.S.state.workouts.some((w) => w.id === "w1"), false);
  eq("...leaving only the file's", h.S.state.workouts.map((w) => w.id), ["w9"]);
  const src2 = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("a clearly-labelled replace control exists", /Restore from file \(replace all\)/.test(src2));
  truthy("...and it routes through the replace mode, not merge", /pickImport\("replace"\)/.test(src2));
}

console.log("\n=== 31. the seed affordance is reachable (item 5b) ===");
{
  /* boot() set settings.seeded true before the first render, so the condition
     that rendered the "Load my 7 Nov session" button never fired and it was
     unreachable. It now shows whenever that session is not already logged. */
  const h = appEnv({});
  h.A.buildIndex();
  eq("a fresh account offers the seed session", h.A.shouldShowSeed(), true);
  h.S.upsertWorkout({ id: "seed-2026-11-07", date: "2026-11-07", entries: [] });
  eq("once loaded it is no longer offered", h.A.shouldShowSeed(), false);
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  eq("the dead seeded===false condition is gone", /settings\.seeded === false \?/.test(src), false);
}

console.log("\n=== 32. set types change what a set counts for ===");
{
  /* The type is a fact with consequences, not a decorative tag: a drop / failure
     set feeds the effort path harder than a straight set. A warm-up is NOT a
     selectable type — the user rejected it, so it must not appear in the table,
     the parser or the UI (test_quickadd proves the parser/UI side). */
  const e = env();
  const straight = e.E.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 10 }, { w: 100, r: 10 }] });
  eq("two straight sets are two working sets", straight.sets, 2);
  eq("...two effort sets", straight.effSets, 2);
  eq("...and 2,000 kg of tonnage", straight.tonnage, 2000);

  const drop = e.E.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 10 }, { w: 100, r: 10, ty: "drop" }] });
  eq("a drop set is still a working set", drop.sets, 2);
  truthy("...but counts for more effort than a straight set", drop.effSets > straight.effSets);
  const fail = e.E.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 10 }, { w: 100, r: 10, ty: "failure" }] });
  truthy("a failure set counts for more too", fail.effSets > straight.effSets);

  // it must reach the scoring path the muscle-balance card and score use
  const plain = e.E.muscleGroups(base({ workouts: [wk(iso(1), [{ w: 40, r: 10 }, { w: 40, r: 10 }])] }), 28).Chest;
  const harder = e.E.muscleGroups(base({ workouts: [wk(iso(1), [{ w: 40, r: 10 }, { w: 40, r: 10, ty: "drop" }])] }), 28).Chest;
  eq("the raw working-set count is unchanged", harder.setsPerWk, plain.setsPerWk);
  truthy("the effort the score reads goes up", harder.effPerWk > plain.effPerWk);

  // warm-up is gone: not a selectable type, and a stray "warmup" value is just a
  // straight working set rather than a special case the engine still honours
  const e2 = env();
  eq("the type table is exposed in one place", Object.keys(e2.E.SET_TYPES), ["normal", "drop", "failure"]);
  eq("warm-up is not a selectable type", Object.keys(e2.E.SET_TYPES).includes("warmup"), false);
  eq("a stray 'warmup' ty reads as a straight set", e2.E.setType({ ty: "warmup" }), "normal");
  eq("...and is counted, not excluded", e2.E.entryStats({ mode: "weight_reps", sets: [{ w: 60, r: 10, ty: "warmup" }] }).sets, 1);
}

console.log("\n=== 33. body measurements: same log, trended back ===");
{
  const e = env();
  e.S.addBodyLog({ date: "2026-01-01", weightKg: 80, waistCm: 90, chestCm: 100, armCm: 36 });
  e.S.addBodyLog({ date: "2026-02-01", weightKg: 79, waistCm: 87 });
  const log = e.S.state.bodylog;
  eq("a measurement rides on the same check-in as weight", log[0].waistCm, 90);
  eq("a later check-in updates its own field", log[1].waistCm, 87);
  eq("...and does not repeat one it did not measure", log[1].chestCm, undefined);
  eq("the trend series is oldest-first", e.E.bodyMeasureSeries(e.S.state, "waistCm").map((p) => p.value), [90, 87]);
  eq("the latest reading is reported", e.E.bodyMeasureLatest(e.S.state, "armCm").value, 36);
  eq("the three measures live in one table", e.E.MEASURES.map((m) => m.key), ["waistCm", "chestCm", "armCm"]);

  const f = env({});
  f.S.importJSON(e.S.exportJSON(), "replace");
  eq("measurements survive an export/import", f.S.state.bodylog.map((b) => b.waistCm), [90, 87]);

  // the Profile card must actually surface them (no collected-but-unread field)
  const srcEnv = appEnv({ bodylog: [
    { date: iso(30), weightKg: 80, waistCm: 90, chestCm: 100, armCm: 36 },
    { date: iso(2), weightKg: 79, waistCm: 87, chestCm: 99, armCm: 36 },
  ] });
  srcEnv.A.setView("profile");
  const meas = srcEnv.calls.multi.find((c) => (c.series || []).some((s) => s.label === "Waist"));
  truthy("the Profile screen charts the measurements", !!meas);
  eq("all three measures are plotted", meas && meas.series.map((s) => s.label), ["Waist", "Chest", "Arm"]);
  eq("each series carries its readings", meas && meas.series[0].points.length, 2);
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the entry fields are generated from Engine.MEASURES", /Engine\.MEASURES\.map\(\(m\) => `<input class="inp meas"/.test(src));
  truthy("the Log handler stores every entered measurement", /entry\[i\.dataset\.mkey\] = U\.li\(v\)/.test(src));
  truthy("each check-in shows its measurements back", /Engine\.MEASURES\.filter\(\(m\) => Engine\.num\(b\[m\.key\]\) > 0\)/.test(src));
}

console.log("\n=== 34. XP rebalance: improvement leads, junk volume pays less, ONE scaler ===");
{
  const e = env();

  // ---- A PR must outweigh volume: the same session with a PR outscores itself.
  const noPr = base({ workouts: [wk(iso(2), [{ w: 100, r: 10 }, { w: 100, r: 10 }])] });
  const prDay = base({ workouts: [wk(iso(4), [{ w: 100, r: 10 }]), wk(iso(2), [{ w: 100, r: 10 }, { w: 100, r: 10 }])] });
  const a = e.E.sessionXp(noPr, noPr.workouts[0]);
  const b = e.E.sessionXp(prDay, prDay.workouts[1]);
  console.log(`     identical 2-set session: no PR ${a.xp} XP (base ${a.base}, ${a.mult}) | with a PR ${b.xp} XP (base ${b.base}, ${b.mult})`);
  eq("a PR now pays 100 (was 20)", e.E.XP.PR, 100);
  truthy("a PR session outscores the same session without one", b.xp > a.xp);
  truthy("...and lifts the session's multiplier", b.mult > a.mult);
  eq("the PR is counted once, not once per metric it moved", b.prs, 1);
  eq("...so the base rose by exactly the PR award", b.base - a.base, 100);

  // ---- Volume past MRV earns less than the SAME volume below it. One group,
  //      so the arithmetic is exact: 4 prior sessions of 6 + the tested 5.
  const cx = { id: "cq", n: "Chest Only Press", c: "Chest", g: ["Chest"], p: ["Chest"], s: [], e: [], m: "weight_reps" };
  const cprof = { name: "C", sex: "M", heightCm: 178, weightKg: 80, bodyFatPct: 15, weeklyTarget: 99, units: "kg" };
  const five = Array.from({ length: 5 }, () => ({ w: 40, r: 10 }));
  const six = Array.from({ length: 6 }, () => ({ w: 40, r: 10 }));
  const day = (d, sets) => wk(d, sets, "cq", "Chest Only Press");
  const under = base({ custom: [cx], profile: cprof, workouts: [day("2026-06-05", five)] });
  const over = base({ custom: [cx], profile: cprof, workouts: [
    day("2026-06-01", six), day("2026-06-02", six), day("2026-06-03", six), day("2026-06-04", six), day("2026-06-05", five),
  ] });
  const su = e.E.sessionXp(under, under.workouts[0]);
  const so = e.E.sessionXp(over, over.workouts[4]);
  const weekSets = 6 * 4 + 5;
  console.log(`     chest, same 5-set session: week ${5} sets -> ${su.xp} XP (vol ${su.factors.volume}, MRV ${e.E.LANDMARKS.Chest.mrv}) | week ${weekSets} sets -> ${so.xp} XP (vol ${so.factors.volume})`);
  truthy("the session's week is past the group's own MRV", weekSets > e.E.LANDMARKS.Chest.mrv);
  eq("the session below MRV pays full rate", su.factors.volume, 1);
  eq("a session wholly past MRV earns about half (the negative side of the scaler)", so.factors.volume, 0.5);
  truthy("the same session earns less once it is past MRV", so.xp < su.xp);
  eq("...and its base is unchanged (only the scaler moved)", so.base, su.base);

  // ---- The composed multiplier is capped.
  eq("the composed multiplier is capped", e.E.composeMult(3, 3, 3), e.E.XP.CAP);
  eq("...at x2.0", e.E.XP.CAP, 2);
  truthy("no real session can exceed the cap",
    [prDay, over].every((st) => st.workouts.every((w) => e.E.sessionXp(st, w).mult <= e.E.XP.CAP)));

  // ---- Consistency is sessions PER WEEK, and never consecutive days. Two weeks
  //      with the same number of sessions — one crammed, one spread — read the
  //      same multiplier, though only one of them is a streak. (1 June 2026 is a
  //      Monday, so every date below sits in one Monday-start week.)
  const one = (d) => wk(d, [{ w: 100, r: 10 }]);
  const consec = base({ workouts: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"].map(one) });
  const spread = base({ workouts: ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-07"].map(one) });
  const mc = e.E.sessionXp(consec, consec.workouts[0]).mult;
  const ms = e.E.sessionXp(spread, spread.workouts[0]).mult;
  console.log(`     4 sessions/profiled week, consecutive -> ${mc}; spread -> ${ms} (weekly target 3)`);
  eq("the multiplier does not grow from consecutive days", mc, ms);
  truthy("...but does reward meeting the weekly target (a session count)", mc > 1);
  const lone = base({ workouts: [one("2026-06-01")] });
  const sl = e.E.sessionXp(lone, lone.workouts[0]);
  eq("a session with no PR and an unmet target has a multiplier of exactly 1", sl.mult, 1);
  eq("...with none of its factors moved", sl.factors, { improvement: 1, consistency: 1, volume: 1 });

  // ---- Titles now step every 3 levels: Trainee lands at level 3, not level 6.
  eq("titles step every 3 levels", [e.E.title(1), e.E.title(3), e.E.title(6), e.E.title(9)], ["Rookie", "Trainee", "Grinder", "Lifter"]);
  const toLevel3 = 300 + 729;    // level 1 + level 2 requirements, 300*lvl^1.28
  const at3 = e.E.levelInfo(toLevel3);
  console.log(`     ${toLevel3} XP -> level ${at3.level} (${e.E.title(at3.level)}); level 6 would be ${e.E.levelInfo(6408).level}`);
  eq("Trainee arrives at level 3", at3.level, 3);
  eq("...and is titled Trainee", e.E.title(at3.level), "Trainee");
  eq("the curve shape is unchanged (level 3 still needs 1,029 XP)", toLevel3, 1029);
  eq("the level ring still reports into / need / pct",
    [typeof at3.into, typeof at3.need, at3.pct], ["number", "number", 0]);

  // ---- DISPLAY: the multiplier rides WITH the session XP, tappable to the
  //      breakdown, and the term has ONE glossary entry (nothing shown unexplained).
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const GL = require(path.join(B, "js", "glossary.js"));
  truthy("the session XP is shown with its multiplier", appSrc.includes("XP (${xpMultText(sx.mult)})"));
  truthy("tapping it opens the breakdown", /addEventListener\("click", \(\) => xpBreakdown\(w, sx\)\)/.test(appSrc));
  truthy("the breakdown names every factor", ["Base XP", "Improvement", "Consistency", "Volume"].every((k) => appSrc.includes(k)));
  truthy("the multiplier has ONE glossary entry", GL.has("xp-multiplier"));
  truthy("...and the breakdown links the term to it", /term\("xp-multiplier"/.test(appSrc));
  truthy("the save toast carries the same control", /line\.append\(xpChip\(w, sx\)/.test(appSrc));
}

console.log("\n=== 35. the title ladder reaches the top without stalling ===");
{
  /* Ten names on a fixed 3-level step meant Mythic covered levels 27-50 —
     twenty-three straight levels of the same word. The ladder now extends past
     Mythic and widens to a 5-level step by the top, so every tier is earned.
     Boundaries are read off the RENDERED title, so the ★ suffix past level 50
     counts as its own step (each post-50 level is its own title). */
  const e = env();
  const base = (t) => t.replace(/ ★\d+$/, "");
  const spans = [];
  let prev = null, start = 1;
  for (let L = 1; L <= 200; L++) {
    const t = e.E.title(L);
    if (t !== prev) {
      if (prev !== null) spans.push({ title: prev, from: start, to: L - 1, n: L - start });
      prev = t; start = L;
    }
  }
  const worst = spans.reduce((a, b) => (b.n > a.n ? b : a));
  console.log(`     longest span: ${worst.title} ${worst.from}-${worst.to} (${worst.n} levels); ${spans.length} steps over 200 levels`);

  truthy("the first promotion is still at level 3", e.E.title(2) === "Rookie" && e.E.title(3) === "Trainee");
  truthy("no title covers more than 5 levels",
    spans.every((s) => s.n <= 5));

  const WANT = ["Rookie", "Trainee", "Grinder", "Lifter", "Ironclad", "Forged",
                "Veteran", "Beast", "Titan", "Mythic", "Legend", "Ascendant",
                "Colossus", "Immortal"];
  const seen = new Set(spans.map((s) => base(s.title)));
  truthy("every title in the ladder is reachable", WANT.every((t) => seen.has(t)));
  truthy("...and the ladder adds nothing outside the declared list",
    [...seen].every((t) => WANT.includes(t)));
  const orig = ["Rookie", "Trainee", "Grinder", "Lifter", "Ironclad", "Forged", "Veteran", "Beast", "Titan", "Mythic"];
  eq("the original ten keep their names and order",
    WANT.slice(0, 10).join(" "), orig.join(" "));
  truthy("the ladder now reaches level 50 before the star suffix",
    base(e.E.title(50)) === "Immortal" && !/★/.test(e.E.title(50)));
  truthy("...and the star suffix still starts at level 51", e.E.title(51) === "Immortal ★1");

  // the curve is untouched: the XP each new boundary needs, from levelInfo
  const xpToReach = (L) => { let lo = 0, hi = 1e9; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (e.E.levelInfo(m).level >= L) hi = m; else lo = m + 1; } return lo; };
  eq("level 31 (Legend) needs 318,650 XP", xpToReach(31), 318650);
  eq("level 46 (Immortal) needs 793,266 XP", xpToReach(46), 793266);
}

console.log("\n=== 36. deleting a custom exercise leaves no stray keys, and pins the group its work trained ===");
{
  /* The delete path cleans up everything the exercise owned AND stamps the
     group(s) its already-logged sets actually trained onto those entries, so the
     muscle analysis keeps crediting the real muscle instead of re-attributing
     the work to the generic ["Core"] fallback. History is NOT rewritten: no
     weight, rep, distance, date or set is touched — only the entry's attribution
     is pinned. */
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "uz", n: "Typo Press", c: "Chest", p: ["Chest"], s: [], e: ["Machine"], m: "weight_reps", g: ["Chest"], d: "" });
  e.S.setTarget("uz", 60);                              // per-exercise goal
  e.S.setOverride("uz", { mode: "weight_reps", weight: 0.9 }); // mode + effort weight
  e.S.upsertWorkout({ id: "wz", date: "2026-11-01", entries: [{ id: "uz", name: "Typo Press", mode: "weight_reps", sets: [{ w: 40, r: 10, rpe: 8 }] }] });
  const other = (s) => JSON.stringify({ bodylog: s.bodylog, achievements: s.achievements, profile: s.profile, settings: s.settings });
  const otherBefore = other(e.S.state);
  const workoutsBefore = JSON.parse(JSON.stringify(e.S.state.workouts));
  eq("setup: target was set", !!e.S.state.targets["uz"], true);
  eq("setup: override was set", JSON.stringify(e.S.state.overrides["uz"]), JSON.stringify({ mode: "weight_reps", weight: 0.9 }));

  e.S.deleteCustom("uz");

  eq("the definition is gone", e.S.state.custom.length, 0);
  eq("(a) state.targets[id] is gone", "uz" in e.S.state.targets, false);
  eq("(a) state.overrides[id] is gone", "uz" in e.S.state.overrides, false);
  eq("(a) ...and no override key is left for the dead id", Object.keys(e.S.state.overrides), []);
  eq("(c) nothing outside the logged entries changed", other(e.S.state), otherBefore);

  // (c) the ONE intended change: group + effort weight pinned on the entry
  const expected = JSON.parse(JSON.stringify(workoutsBefore));
  expected[0].entries[0].g = ["Chest"];
  expected[0].entries[0].ew = 0.9;
  eq("(c) the only change to any session is the pinned group + effort weight",
     JSON.parse(JSON.stringify(e.S.state.workouts)), expected);

  // (b) the logged set still counts as Chest, and NOT as Core
  const mg = e.E.muscleGroups(e.S.state, 4000);
  eq("(b) the logged set counts toward Chest", mg.Chest.totalSets, 1);
  eq("(b) ...and NOT toward Core", mg.Core.totalSets, 0);
}

console.log("\n=== 37. deleting a custom exercise never CREATES an override ===");
{
  /* The old path wrote overrides[id] = {g:[]} unconditionally, so deleting an
     exercise that had NO override still created one — a write the user never
     asked for. */
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "nz", n: "No Override", c: "Legs", p: ["Quads"], s: [], e: [], m: "reps", g: ["Legs"], d: "" });
  eq("setup: it starts with no override", "nz" in e.S.state.overrides, false);
  e.S.deleteCustom("nz");
  eq("no overrides key is created for it", "nz" in e.S.state.overrides, false);
  eq("and the overrides map is still empty", Object.keys(e.S.state.overrides).length, 0);
}

console.log("\n=== 38. a deleted exercise's logged sets keep counting as the muscle they trained ===");
{
  /* Reported as before/after with numbers. Before the fix, removing the override
     made exInfo() fall back to ["Core"], so the deleted Chest exercise's three
     sets silently re-attributed to Core. Now the group is pinned on the entry at
     delete time, so Chest keeps the work and Core gets none of it. */
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "uz", n: "Typo Press", c: "Chest", p: ["Chest"], s: [], e: ["Machine"], m: "weight_reps", g: ["Chest"], d: "" });
  e.S.upsertWorkout({ id: "wz", date: "2026-11-01", entries: [{ id: "uz", name: "Typo Press", mode: "weight_reps", sets: [{ w: 40, r: 10, rpe: 8 }, { w: 40, r: 10, rpe: 8 }, { w: 40, r: 10, rpe: 8 }] }] });
  const m0 = e.E.muscleGroups(e.S.state, 4000);
  const chestBefore = m0.Chest.totalSets, coreBefore = m0.Core.totalSets, scoreBefore = m0.Chest.score;
  e.S.deleteCustom("uz");
  const mg = e.E.muscleGroups(e.S.state, 4000);
  console.log(`     Chest raw sets ${chestBefore} -> ${mg.Chest.totalSets} · Core raw sets ${coreBefore} -> ${mg.Core.totalSets} · Chest score ${scoreBefore} -> ${mg.Chest.score}`);
  eq("the deleted workout is still in the log", e.S.state.workouts.length, 1);
  eq("the three sets still count under Chest", mg.Chest.totalSets, 3);
  eq("...and NOT under Core (which the override's removal used to cause)", mg.Core.totalSets, 0);
  eq("the exercise's group is pinned on every one of its entries",
     e.S.state.workouts[0].entries.every((en) => JSON.stringify(en.g) === JSON.stringify(["Chest"])), true);
}

console.log("\n=== 38b. an exercise re-created with the same id does not re-attribute old history ===");
{
  /* Custom ids are generated fresh ('u'+timestamp), but a restored backup can
     bring the same id back. The OLD logged entries keep the group they were
     stamped with; only NEW entries for that id follow the new definition. */
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "uz", n: "Press", c: "Chest", p: ["Chest"], s: [], e: [], m: "weight_reps", g: ["Chest"], d: "" });
  e.S.upsertWorkout({ id: "w1", date: "2026-11-01", entries: [{ id: "uz", name: "Press", mode: "weight_reps", sets: [{ w: 40, r: 10 }] }] });
  e.S.deleteCustom("uz");
  e.S.addCustom({ id: "uz", n: "New Press", c: "Legs", p: ["Quads"], s: [], e: [], m: "weight_reps", g: ["Legs"], d: "" });
  const mg = e.E.muscleGroups(e.S.state, 4000);
  eq("old history still credits Chest", mg.Chest.totalSets, 1);
  eq("the re-created definition does not re-attribute it to Legs", mg.Legs.totalSets, 0);
  e.S.upsertWorkout({ id: "w2", date: "2026-11-02", entries: [{ id: "uz", name: "New Press", mode: "weight_reps", sets: [{ w: 60, r: 5 }] }] });
  const mg2 = e.E.muscleGroups(e.S.state, 4000);
  eq("new work for the id follows the NEW definition", mg2.Legs.totalSets, 1);
  eq("...and does not retro-credit Chest", mg2.Chest.totalSets, 1);
}

console.log("\n=== 38c. an entry for an id that no longer exists and was never stamped ===");
{
  /* Reachable only by importing a file with an entry but no definition. There is
     nothing to preserve, so it falls back to the default group for a bare id —
     the same behaviour exGroups has always had. */
  const e = env();
  e.S.reset();
  e.S.upsertWorkout({ id: "w", date: "2026-11-01", entries: [{ id: "ghost", name: "Ghost", mode: "weight_reps", sets: [{ w: 50, r: 5 }] }] });
  eq("no definition -> the bare id resolves to the default group", e.E.exGroups(e.S.state, "ghost"), ["Core"]);
  eq("and its un-stamped entry resolves the same way",
     e.E.entryGroups(e.S.state, e.S.state.workouts[0].entries[0]), ["Core"]);
}

console.log("\n=== 39. computed-but-unshown values: each is surfaced, or removed ===");
{
  /* The engine computed ten values that never reached the screen. Those with no
     home were DELETED from the computation; those a screen now reads were kept.
     This asserts the removal so they cannot quietly come back. */
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "run", n: "Running", c: "Cardio", p: ["Legs"], s: [], e: [], m: "distance_time", g: ["Legs"], d: "" });
  e.S.upsertWorkout({ id: "w1", date: "2026-11-01", entries: [{ id: "run", name: "Running", mode: "distance_time", sets: [{ d: 5000, t: 1800 }] }] });

  const sm = e.E.summary(e.S.state);
  const gone = ["reps", "timeMin", "restMin", "avgRest", "exercises", "sets"].filter((k) => k in sm);
  eq("summary no longer carries any unshown value", gone, []);
  eq("summary still carries the values a card reads",
     ["sessions", "tonnage", "distKm", "density", "xp", "level", "title", "streak", "prs", "prsAll"].every((k) => k in sm), true);
  eq("the newly surfaced distance is the real total (5 km)", sm.distKm, 5);

  const st = e.E.staminaScore(e.S.state, e.E.windowWorkouts(e.S.state, 28));
  eq("stamina no longer computes the unshown min/km pace", "paceMinPerKm" in st, false);
  truthy("...but still reports the pace the END readout shows", st.paceKmh > 0);

  e.S.upsertWorkout({ id: "w2", date: "2026-11-08", entries: [{ id: "run", name: "Running", mode: "distance_time", sets: [{ d: 6000, t: 1900 }] }] });
  const cmp = e.E.compareLast(e.S.state, "run");
  eq("compareLast carries no unread top/better", ["top", "better"].filter((k) => k in cmp), []);
  truthy("...and still compares e1RM and volume", !!cmp.est1RM && !!cmp.volume);

  const fr = e.E.freshness(e.S.state);
  eq("freshness still reports setsThisWeek (now shown on the recovery chip)",
     "setsThisWeek" in fr[Object.keys(fr)[0]], true);

  // the two SURFACED values are actually rendered, in the existing cards
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the dashboard renders the distance chip from summary.distKm",
    /s\.distKm > 0 \? `<span class="chip"[^`]*km logged/.test(appSrc));
  truthy("the recovery chip's tooltip renders freshness.setsThisWeek",
    /f\.setsThisWeek\} sets\/wk/.test(appSrc));
}

console.log("\n=== 40. deleting an exercise with no logged sets writes nothing onto history ===");
{
  const e = env();
  e.S.reset();
  e.S.addCustom({ id: "qz", n: "Never Used", c: "Back", p: ["Back"], s: [], e: [], m: "weight_reps", g: ["Back"], d: "" });
  eq("setup: no workouts at all", e.S.state.workouts.length, 0);
  e.S.deleteCustom("qz");
  eq("no workout was invented", e.S.state.workouts.length, 0);
  eq("and the custom list is empty", e.S.state.custom.length, 0);
}

console.log("\n=== 41. the two achievements re-cut to stop contradicting the app's advice ===");
{
  /* "Volume King" (20+ RAW sets in a session) paid for exactly the junk volume
     the muscle-balance card flags and the XP rebalance stopped paying full rate
     for. It is now "Big Session": a high EFFORT-WEIGHTED session spread over 3+
     PRIMARY muscle groups that is NOT sitting in an over-MRV week.
     "Perfect Week"/"Unbreakable" were consecutive-DAY streaks, which push daily
     training; they now count WEEKS THAT MET THE WEEKLY TARGET — the same thing
     the XP consistency scaler measures. */
  const e = env();
  const acc = (id, st) => e.E.achievements(st).find((a) => a.id === id);
  const en = (id, g, name, ew, count) => ({ id, name, mode: "weight_reps", g, ew, sets: Array.from({ length: count }, () => ({ w: 80, r: 8 })) });
  const sess = (date, entries) => ({ id: "w" + date, date, entries });
  const bal = () => [en("c1", ["Chest"], "Chest Press", 1, 8), en("b1", ["Back"], "Row", 1, 8), en("l1", ["Legs"], "Squat", 1, 8)];

  // one movement, 20 sets -> NOT big (only one PRIMARY group)
  const solo = base({ workouts: [sess("2026-06-01", [en("c1", ["Chest"], "Chest Press", 1, 20)])] });
  eq("20 sets on ONE movement is not a balanced session", e.E.achievementContext(solo).bigSession, 0);
  eq("...so the old junk-volume badge does NOT fire", acc("bigset", solo).met, false);

  // a hard, well-spread session within limits -> Big Session
  const big = base({ workouts: [sess("2026-06-01", bal())] });
  const bctx = e.E.achievementContext(big);
  console.log(`     balanced 24-set session -> effort-weighted ${bctx.bigSession} (min ${e.E.BIG_SESSION_MIN}, ${e.E.BIG_SESSION_GROUPS}+ groups)`);
  truthy("a hard, well-spread session IS a Big Session", bctx.bigSession >= e.E.BIG_SESSION_MIN);
  eq("...and the badge fires", acc("bigset", big).met, true);

  // the SAME balanced session, but its week is already over MRV -> NOT
  const over = base({ workouts: [
    sess("2026-06-01", bal()),
    sess("2026-06-02", [en("c1", ["Chest"], "Chest Press", 1, 12)]),
    sess("2026-06-03", [en("c1", ["Chest"], "Chest Press", 1, 12)]),
  ] });
  const weekChest = 8 + 12 + 12;
  console.log(`     same session, ${weekChest} chest sets that week (MRV ${e.E.LANDMARKS.Chest.mrv}) -> bigSession ${e.E.achievementContext(over).bigSession}`);
  truthy("the week is past Chest's MRV", weekChest > e.E.LANDMARKS.Chest.mrv);
  eq("a hard session sitting in an over-MRV week does NOT earn it", e.E.achievementContext(over).bigSession, 0);
  eq("...and the badge stays locked", acc("bigset", over).met, false);

  // s7 / s30: sessions per week vs the target, never consecutive days
  const t3 = { ...base().profile, weeklyTarget: 3 };
  const metWeek = base({ profile: t3, workouts: ["2026-06-01", "2026-06-02", "2026-06-03"].map((d) => wk(d, [{ w: 100, r: 8 }])) });
  truthy("a week meeting the weekly target earns Perfect Week", acc("s7", metWeek).met);
  const oneSession = base({ profile: t3, workouts: [wk("2026-06-01", [{ w: 100, r: 8 }])] });
  eq("a single session does not", acc("s7", oneSession).met, false);
  const spread = base({ profile: t3, workouts: ["2026-06-01", "2026-06-03", "2026-06-05"].map((d) => wk(d, [{ w: 100, r: 8 }])) });
  eq("consecutive days count for no more than spread days",
     e.E.achievementContext(metWeek).weeksAtTarget, e.E.achievementContext(spread).weeksAtTarget);
  truthy("the streak conditions no longer read streakDays",
     !/streakDays/.test(e.E.ACHIEVEMENTS.find((a) => a.id === "s7").test.toString()));

  const dayPlus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const weeksAt = (n) => { const ws = []; for (let i = 0; i < n; i++) { const m = dayPlus("2026-01-05", i * 7); ws.push(wk(m, [{ w: 100, r: 8 }]), wk(dayPlus(m, 2), [{ w: 100, r: 8 }])); } return base({ profile: { ...base().profile, weeklyTarget: 2 }, workouts: ws }); };
  eq("12 weeks meeting the target earns Unbreakable", acc("s30", weeksAt(12)).met, true);
  eq("11 weeks does not", acc("s30", weeksAt(11)).met, false);
}

console.log("\n=== 42. more healthy achievements, no shaming, ids preserved ===");
{
  const e = env();
  const A = e.E.ACHIEVEMENTS;
  const ids = A.map((a) => a.id);

  const OLD = ["first", "w10", "w50", "w100", "t10k", "t100k", "t1m", "pr1", "pr10", "pr50",
    "s3", "s7", "s30", "wk4", "wk12", "wk52", "bench1", "squat15", "dead2", "ohp1",
    "cardio10", "cardio50", "cardio100", "bigset", "balanced", "variety", "weighin", "goal", "mob60", "nightowl"];
  eq("every original id is still present (a saved state keeps working)", OLD.filter((id) => !ids.includes(id)), []);
  const NEW = ["squat1", "row1", "cardio25", "everygroup", "firstweigh", "measure1", "deload1", "mob180"];
  eq("the new healthy badges are all present", NEW.filter((id) => !ids.includes(id)), []);
  eq("every badge declares a tier", A.filter((a) => a.tier !== "major" && a.tier !== "minor").map((a) => a.id), []);
  truthy("the junk-volume name is gone", !A.some((a) => a.name === "Volume King"));
  truthy("the no-rest name is gone", !A.some((a) => a.name === "No Days Off"));

  /* HARD LIMIT: nothing may celebrate undereating, a skipped meal, a low-calorie
     day, calories burned, exercise as repayment for food, or training through
     pain, illness or a missed deload. */
  const FORBIDDEN = /calorie|kcal|cheat|undereat|starv|fasted|skip(ped)? meal|guilt|shame|punish|injur|illness|\bsick\b|no days off/i;
  eq("no badge shames food, calories, rest, or training through pain",
     A.filter((a) => FORBIDDEN.test(a.name + " " + a.desc)).map((a) => a.id), []);
  eq("nothing at all is earned by an empty log",
     A.filter((a) => { try { return a.test(e.E.achievementContext(base({}))); } catch (err) { return false; } }).map((a) => a.id), []);

  // each new condition actually fires
  const bl = base({ bodylog: [{ date: "2026-06-01", weightKg: 80, waistCm: 82 }] });
  const bctx = e.E.achievementContext(bl);
  eq("a first check-in counts as a weigh-in", bctx.weighins, 1);
  eq("a tape measurement is counted", bctx.measures, 1);
  truthy("Baseline (first check-in) is earned", e.E.achievements(bl).find((a) => a.id === "firstweigh").met);
  truthy("Tape Measure is earned", e.E.achievements(bl).find((a) => a.id === "measure1").met);
  eq("...but On the Record (10 check-ins) is not", e.E.achievements(bl).find((a) => a.id === "weighin").met, false);

  const heavy = Array.from({ length: 30 }, () => ({ w: 60, r: 10 }));
  const light = Array.from({ length: 12 }, () => ({ w: 60, r: 10 }));
  const deloaded = base({ workouts: [wk(iso(21), heavy), wk(iso(14), heavy), wk(iso(7), heavy), wk(iso(0), light)] });
  const steady = base({ workouts: [wk(iso(21), heavy), wk(iso(14), heavy), wk(iso(7), heavy), wk(iso(0), heavy)] });
  eq("a lighter week after a real block is counted as a deload", e.E.achievementContext(deloaded).deloads, 1);
  truthy("Recovery Week is earned for taking it", e.E.achievements(deloaded).find((a) => a.id === "deload1").met);
  eq("a steady block does NOT earn it", e.E.achievements(steady).find((a) => a.id === "deload1").met, false);

  // relative strength: row 1x and squat 1x bodyweight (bodyweight is 80 kg)
  const rel = base({ workouts: [
    wk("2026-06-01", [{ w: 70, r: 8 }], 1698, "Barbell Row (Overhand)"),
    wk("2026-06-02", [{ w: 80, r: 8 }], 1801, "Barbell Full Squat"),
  ] });
  const rctx = e.E.achievementContext(rel);
  console.log(`     row ${rctx.ratio.row.toFixed(2)}x, squat ${rctx.ratio.squat.toFixed(2)}x bodyweight`);
  truthy("Row Club fires at 1x bodyweight", e.E.achievements(rel).find((a) => a.id === "row1").met);
  truthy("Bodyweight Squat fires at 1x bodyweight", e.E.achievements(rel).find((a) => a.id === "squat1").met);
  eq("...but Squat Club (1.5x) does not", e.E.achievements(rel).find((a) => a.id === "squat15").met, false);

  // balance across groups: all 7 in the window
  const full = base({ workouts: [
    wk("2026-06-01", [{ w: 60, r: 8 }], 1698, "Barbell Row (Overhand)"),
    wk("2026-06-02", [{ w: 80, r: 8 }], 1801, "Barbell Full Squat"),
  ] });
  eq("a session log with only two groups does not earn Head to Toe",
     e.E.achievements(full).find((a) => a.id === "everygroup").met, false);
}

console.log("\n=== 43. what earns a full celebration, and what does not ===");
{
  const e = env();
  const M = e.E.MILESTONE;
  const ev = e.E.milestoneEvents;
  eq("a routine save (same level, no PR, no badge) triggers nothing", ev({ level: 4, title: "Lifter" }, { level: 4, title: "Lifter" }, [], []), []);
  eq("a LEVEL UP triggers one event", ev({ level: 4, title: "Lifter" }, { level: 5, title: "Lifter" }, [], []).map((x) => x.kind), [M.LEVEL]);
  eq("a RANK promotion is its own event on top of the level", ev({ level: 2, title: "Rookie" }, { level: 3, title: "Trainee" }, [], []).map((x) => x.kind), [M.LEVEL, M.RANK]);
  eq("a PR triggers a celebration", ev({ level: 5, title: "Lifter" }, { level: 5, title: "Lifter" }, [{ id: 73, name: "Bench Press", hit: ["e1RM"] }], []).map((x) => x.kind), [M.PR]);
  eq("a MINOR badge stays a toast", ev({ level: 5, title: "Lifter" }, { level: 5, title: "Lifter" }, [], ["nightowl"]), []);
  eq("a MAJOR badge celebrates", ev({ level: 5, title: "Lifter" }, { level: 5, title: "Lifter" }, [], ["squat15"]).map((x) => x.kind), [M.BADGE]);
  const all = ev({ level: 2, title: "Rookie" }, { level: 3, title: "Trainee" }, [{ id: 73, name: "Bench Press", hit: ["e1RM"] }], ["squat15", "nightowl"]);
  eq("everything earned in one save is ONE celebration", all.map((x) => x.kind), [M.LEVEL, M.RANK, M.PR, M.BADGE]);
  truthy("...and the PR names the lift", all.find((x) => x.kind === M.PR).items[0].name === "Bench Press");
  truthy("...and the minor badge is left out of it", !all.some((x) => x.kind === M.BADGE && x.badges.some((b) => b.id === "nightowl")));

  // a first-ever session is a baseline, not a PR
  const e2 = env();
  const first = base({ workouts: [wk(iso(0), [{ w: 100, r: 8 }])] });
  eq("a first-ever session is a baseline, not a PR", e2.E.sessionPRs(first, iso(0)).length, 0);

  // ---- wiring: the celebration exists, is modal, and can never block loading
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const cssSrc = fs.readFileSync(path.join(B, "css", "style.css"), "utf8");
  truthy("the celebration reuses the modal shell", /openModal\(box, "celebrate"\)/.test(appSrc));
  truthy("both celebration controls do something", /#celeb-ok/.test(appSrc) && /#celeb-badges/.test(appSrc));
  truthy("'See your badges' goes to the badges card", /setView\("dash"\)/.test(appSrc) && /id: "badges"/.test(appSrc));
  const bootSrc = appSrc.slice(appSrc.indexOf("function boot()"), appSrc.indexOf("function recoverFromDeviceStorage"));
  truthy("the celebration never runs at boot (cannot delay the UI)", !/celebrate\(/.test(bootSrc));
  truthy("saveDraft celebrates only when there is a milestone", /if \(ev\.length\) celebrate\(ev\)/.test(appSrc));
  truthy("an edit is not treated as a fresh milestone", /const isNew = !d\.id/.test(appSrc));
  truthy("the old plain unlock modal is gone", !/function showBadges/.test(appSrc));
  truthy("the celebration has its own style in the app's language", /\.modal-box\.celebrate/.test(cssSrc));
  truthy("...and it respects reduced-motion", /prefers-reduced-motion/.test(cssSrc));
}

console.log("\n=== 44. no consecutive-day reward anywhere: badges AND xp ===");
{
  const e = env();
  const acc = (id, st) => e.E.achievements(st).find((a) => a.id === id);
  const A = e.E.ACHIEVEMENTS;

  // the id a saved state references is kept; the old name and condition are gone
  truthy("the old s3 id is preserved (saved states keep working)", A.some((a) => a.id === "s3"));
  truthy("its old consecutive-day name is gone", !A.some((a) => a.name === "Three in a Row"));
  eq("it no longer reads a consecutive-day value",
     /streakDays/.test(acc("s3", base()).test.toString()), false);

  // 3 CONSECUTIVE days does NOT earn it — that is the whole point of the fix
  const t3 = { ...base().profile, weeklyTarget: 3 };
  const threeDays = base({ profile: t3, workouts: ["2026-06-01", "2026-06-02", "2026-06-03"].map((d) => wk(d, [{ w: 100, r: 8 }])) });
  eq("3 consecutive training days alone does not earn it", acc("s3", threeDays).met, false);

  // meeting the target in 3 SEPARATE weeks DOES, however the days fall
  const dayPlus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  const weeksAt = (n, per = 3) => { const ws = []; for (let i = 0; i < n; i++) { const m = dayPlus("2026-01-05", i * 7); for (let k = 0; k < per; k++) ws.push(wk(dayPlus(m, k), [{ w: 100, r: 8 }])); } return base({ profile: { ...base().profile, weeklyTarget: 3 }, workouts: ws }); };
  eq("3 weeks meeting the weekly target earns it", acc("s3", weeksAt(3)).met, true);
  eq("2 weeks does not", acc("s3", weeksAt(2)).met, false);

  // XP: the lifetime bonus pays for weeks at target, never for consecutive days
  const consecWeek = base({ profile: t3, workouts: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06"].map((d) => wk(d, [{ w: 100, r: 8 }])) });
  const spreadWeek = base({ profile: t3, workouts: ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-05", "2026-06-06", "2026-06-07"].map((d) => wk(d, [{ w: 100, r: 8 }])) });
  eq("the two really differ in their longest consecutive-day run",
     e.E.streaks(consecWeek).bestDays === e.E.streaks(spreadWeek).bestDays, false);
  eq("XP ignores the consecutive-day run (same week, same sessions, same XP)",
     e.E.xp(consecWeek), e.E.xp(spreadWeek));
  truthy("the lifetime XP bonus is built from weeks-at-target, not bestDays",
     /weeksAtTarget\(state\)/.test(e.E.xp.toString().replace(/\/\*[\s\S]*?\*\//g, ""))
     && !/bestDays/.test(e.E.xp.toString().replace(/\/\*[\s\S]*?\*\//g, "")));
  eq("weeksAtTarget is the ONE shared measure (both states: 1 week at target)",
     [e.E.weeksAtTarget(consecWeek), e.E.weeksAtTarget(spreadWeek)], [1, 1]);
}

console.log("\n=== 45. celebrations fire only after a save, and collapse into ONE ===");
{
  /* Loads the REAL app.js behind a DOM stub that MEMOISES its nodes, so the test
     can see what the celebration actually opened: every node appended to
     #modal-box is recorded. This drives the app's real save path, not a copy. */
  const uiEnv = (seed) => {
    const store = {};
    const opened = [];
    const nodes = {};
    const mkNode = (id) => ({
      id, _html: "", className: "", dataset: {}, style: {}, children: [],
      set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
      append(c) { if (id === "#modal-box") opened.push(c); this.children.push(c); },
      prepend() {}, remove() {}, click() {}, focus() {}, contains: () => false,
      querySelector: () => mkNode("q"), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    });
    const get = (sel) => (nodes[sel] = nodes[sel] || mkNode(sel));
    const s = {
      console: { log() {}, warn() {}, error() {}, info() {} },
      Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
      isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      document: {
        addEventListener() {}, removeEventListener() {},
        querySelector: get, querySelectorAll: () => [], getElementById: get,
        createElement: () => mkNode("e"), createElementNS: () => mkNode("ns"),
        body: mkNode("body"), visibilityState: "visible", activeElement: null,
      },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      Blob: function () {}, URL: { createObjectURL: () => "blob:x" },
      module: { exports: {} },
    };
    s.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
    s.window = s; s.globalThis = s;
    vm.createContext(s);
    vm.runInContext(`localStorage.setItem("fitness-app-v1", ${JSON.stringify(JSON.stringify(base(seed || {})))});`, s);
    const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/app.js"]
      .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
    vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "ui.js" });
    return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, opened };
  };

  // (a) TIMING: a session that is entered but never saved earns NOTHING.
  const h = uiEnv({});
  h.A.buildIndex();
  const before = h.E.summary(h.S.state);
  const draft = { id: null, date: iso(0), note: "", entries: [
    { id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 8 }] }] };
  eq("an unsaved session is invisible to the engine (no badge)",
     h.E.newAchievements(h.S.state), []);
  eq("...no permanent unlock is written", Object.keys(h.S.state.achievements).length, 0);
  eq("...and no celebration can be built for it",
     h.E.milestoneEvents(before, before, h.E.sessionPRs(h.S.state, draft.date), []), []);
  eq("...nothing was opened", h.opened.length, 0);

  // (b) the SAVE path commits FIRST, then celebrates exactly once
  h.A.saveDraft(draft);
  eq("saving committed the session", h.S.state.workouts.length, 1);
  truthy("the first session unlocked First Blood (a real, permanent unlock)", !!h.S.state.achievements.first);
  eq("one save -> exactly ONE celebration", h.opened.length, 1);
  truthy("...and it names the badge it earned", /First Blood/.test(h.opened[0].innerHTML));

  // (c) COLLAPSE: several things earned in one save arrive as ONE celebration
  const g = uiEnv({ workouts: [wk(iso(7), [{ w: 100, r: 8 }])] });
  g.A.buildIndex();
  const d2 = { id: null, date: iso(0), note: "", entries: [
    { id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 120, r: 8 }] }] };
  g.A.saveDraft(d2);
  const prs = g.E.sessionPRs(g.S.state, d2.date);
  truthy("the save earned at least one PR", prs.length >= 1);
  eq("a save earning a PR and badges opens exactly ONE celebration", g.opened.length, 1);
  const body = g.opened[0].innerHTML;
  truthy("...listing the PR", /Bench Press/.test(body));
  truthy("...and the badge", /New Best/.test(body));
  eq("...with a single dismiss control", (body.match(/id="celeb-ok"/g) || []).length, 1);

  // and the collapse itself: three earned things -> one celebration, three lines
  const h3 = uiEnv({});
  const n0 = h3.opened.length;
  h3.A.celebrate([
    { kind: "level", level: 5, title: "Lifter" },
    { kind: "pr", items: [{ id: 73, name: "Bench Press", hit: ["e1RM"] }] },
    { kind: "badge", badges: [{ id: "squat15", name: "Squat Club", desc: "Squat 1.5x bodyweight" }] },
  ]);
  eq("three things earned at once yield exactly ONE celebration", h3.opened.length - n0, 1);
  eq("...listing all three", (h3.opened[h3.opened.length - 1].innerHTML.match(/class="celeb-line"/g) || []).length, 3);
  eq("...dismissed in a single tap", (h3.opened[h3.opened.length - 1].innerHTML.match(/id="celeb-ok"/g) || []).length, 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
