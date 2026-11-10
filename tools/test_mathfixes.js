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
  // and the effort weight is a maths constant now: a stored override is IGNORED
  // and the value derived from the movement's own attributes is always used.
  const ov = base({ custom, overrides: { x2: { weight: 1.3 } } });
  eq("a stored weight override no longer wins", e.E.exerciseWeight(ov, "x2"), w("x2"));
  eq("...the derived value is used, not the stored one", e.E.exerciseWeight(ov, "x2"), 0.85);
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
  // The profile save must snapshot the dated profile fields (height/age/sex/
  // goals/weekly target) so a past month reads the values that were in effect
  // then. The recording logic itself is proven in tools/test_bodylog.js.
  truthy("the profile save snapshots the dated profile fields", /Store\.recordProfileLog\(\)/.test(appSrc));
  truthy("...and the save handler is the one that calls it", /p\.units = g\("#p-u"\);\s*(?:\/\/[^\n]*\n\s*)*Store\.recordProfileLog\(\);/.test(appSrc));
  // The Profile tab must EXPLAIN why sex is asked, and offer the body-fat %
  // alternative — without claiming two separately-fitted equations (Mifflin-St
  // Jeor is ONE regression carrying a sex term).
  truthy("the Profile tab explains the sex field",
    /An input to the calorie formula, not a question about who you are/.test(appSrc) && /166 kcal\/day/.test(appSrc));
  truthy("...it offers the body-fat % route instead", /with a body-fat % the lean-mass equation is used instead/.test(appSrc));
  eq("...and never claims two separately-fitted equations", /fitted separately/.test(appSrc), false);
  // The sex control is now built by sexFieldHTML (modelled on Activity level) and
  // offers a neutral "Not set"; the helper note still sits directly beneath it.
  truthy("...the helper sits directly under the sex control",
    /<label>Sex\$\{sexFieldHTML\(p\)\}<\/label>\s*<p class="muted small grid-note" id="p-sex-note">/.test(appSrc));
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
  // The tracking-mode control moved OFF the exercise detail sheet and INTO the
  // Log flow, so the sheet is no longer a call site for the helper. The Log
  // entry's "Track as" select is now the only place a mode is chosen.
  eq("the detail sheet no longer carries a tracking-mode control", /id="dt-mode"/.test(src), false);
  truthy("the Log entry's 'Track as' select is the mode control", /track-as-lab">Track as</.test(src));
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
  /* RE-EXPRESSED for the per-set volume taper: overreaching used to halve the
     WHOLE session through the multiplier (so ADDING work could lower XP); it is
     now a fixed per-set price, so a session wholly past MRV still pays half rate
     on every set, but the cut is an explicit, non-negative reduction. */
  eq("a session wholly past MRV pays HALF RATE on every set (the volume taper)", so.factors.volume, 0.5);
  truthy("the same session earns less once it is past MRV", so.xp < su.xp);
  eq("...every one of its sets is past the group's MRV", so.overSets, 5);
  eq("...the cut is exactly the half-rate on those sets, never a whole-session tax", so.overCut, 5);
  eq("...so the XP is the within-MRV session minus the cut", so.xp, su.xp - so.overCut);
  eq("...and its base (the FULL-rate work) is unchanged — the taper is a cut, not a base change", so.base, su.base);
  eq("...a session inside MRV is never cut at all", su.overSets, 0);
  eq("...and carries no volume term in its multiplier", so.mult, 1);

  // ---- The composed multiplier is capped.
  eq("the composed multiplier is capped", e.E.composeMult(3, 3), e.E.XP.CAP);
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
  // mode + a stale effort weight: the mode override is honoured, but the weight
  // is a maths constant now and must be ignored by the engine.
  e.S.setOverride("uz", { mode: "weight_reps", weight: 0.9 });
  e.S.upsertWorkout({ id: "wz", date: "2026-11-01", entries: [{ id: "uz", name: "Typo Press", mode: "weight_reps", sets: [{ w: 40, r: 10, rpe: 8 }] }] });
  const other = (s) => JSON.stringify({ bodylog: s.bodylog, achievements: s.achievements, profile: s.profile, settings: s.settings });
  const otherBefore = other(e.S.state);
  const workoutsBefore = JSON.parse(JSON.stringify(e.S.state.workouts));
  eq("setup: target was set", !!e.S.state.targets["uz"], true);
  eq("setup: override was set", JSON.stringify(e.S.state.overrides["uz"]), JSON.stringify({ mode: "weight_reps", weight: 0.9 }));
  // captured BEFORE the delete: the value the engine actually uses, derived from
  // the movement's attributes, immune to the stale 0.9 stored above.
  const derivedEw = e.E.exerciseWeight(e.S.state, "uz");
  truthy("setup: the engine ignores the stored 0.9 and derives the movement's weight", derivedEw !== 0.9);

  e.S.deleteCustom("uz");

  eq("the definition is gone", e.S.state.custom.length, 0);
  eq("(a) state.targets[id] is gone", "uz" in e.S.state.targets, false);
  eq("(a) state.overrides[id] is gone", "uz" in e.S.state.overrides, false);
  eq("(a) ...and no override key is left for the dead id", Object.keys(e.S.state.overrides), []);
  eq("(c) nothing outside the logged entries changed", other(e.S.state), otherBefore);

  // (c) the ONE intended change: group + the DERIVED effort weight pinned on the
  // entry — the stored 0.9 override no longer moves the weight, so the pinned
  // value is the movement's own derived coefficient.
  const expected = JSON.parse(JSON.stringify(workoutsBefore));
  expected[0].entries[0].g = ["Chest"];
  expected[0].entries[0].ew = derivedEw;
  eq("(c) the only change to any session is the pinned group + derived effort weight",
     JSON.parse(JSON.stringify(e.S.state.workouts)), expected);
  eq("(c) ...and the pinned weight is the derived one, not the stored override",
     e.S.state.workouts[0].entries[0].ew, derivedEw);

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

console.log("\n=== 39. the per-exercise effort weight is a maths constant, not a user field ===");
{
  /* the owner: the effort ratio "should be baked in with the math, not changeable
     by the user." The detail sheet no longer offers it, the engine no longer
     reads any stored override, and migrate strips the orphan field. */
  const e = env();
  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  eq("the detail sheet has no effort-weight input", /dt-wt/.test(src), false);
  eq("...and no reset button", /dt-wreset/.test(src), false);
  eq("...and no 'Effort weight' label", /Effort weight/.test(src), false);
  eq("...and no handler writing a weight override", /setOverride\(id, \{ weight/.test(src), false);

  // the engine ignores a stored weight — in the accessor AND the volume maths
  const custom = [{ id: "cw", n: "Leg Extension", c: "Legs", g: ["Legs"], p: ["Quads"], s: [], e: [], m: "weight_reps" }];
  const sets = [{ w: 30, r: 12 }, { w: 30, r: 12 }, { w: 30, r: 12 }];
  const ent = () => ({ id: "cw", name: "Leg Extension", mode: "weight_reps", sets: JSON.parse(JSON.stringify(sets)) });
  const clean = base({ custom, workouts: [{ id: "w1", date: iso(1), entries: [ent()] }] });
  const dirty = base({ custom, overrides: { cw: { weight: 1.34 } }, workouts: [{ id: "w1", date: iso(1), entries: [ent()] }] });
  eq("a stored weight does not change the computed exercise weight",
     e.E.exerciseWeight(dirty, "cw"), e.E.exerciseWeight(clean, "cw"));
  eq("...and does not move the muscle-group effort maths",
     e.E.muscleGroups(dirty, 28).Legs, e.E.muscleGroups(clean, 28).Legs);

  // mode and g overrides are untouched by this change
  eq("a mode override still works", e.E.exMode(base({ custom, overrides: { cw: { mode: "time" } } }), "cw"), "time");
  eq("a group override still works", e.E.exGroups(base({ custom, overrides: { cw: { g: ["Arms"] } } }), "cw"), ["Arms"]);

  // migrate strips weight, leaves mode/g alone
  const mig = e.S.migrate({ version: 1, createdAt: "2026-01-01T00:00:00.000Z", workouts: [], bodylog: [], custom: [],
    overrides: { a: { weight: 1.2 }, b: { mode: "time", g: ["Legs"] }, c: { weight: 0.8, mode: "reps" } } });
  eq("migrate drops a weight-only override entirely", "a" in mig.overrides, false);
  eq("migrate keeps mode and g untouched", JSON.stringify(mig.overrides.b), JSON.stringify({ mode: "time", g: ["Legs"] }));
  eq("migrate strips weight but keeps the sibling mode", JSON.stringify(mig.overrides.c), JSON.stringify({ mode: "reps" }));
}

console.log("\n=== 46. nutrition gamification + Vitality is body-only ===");
{
  const e = env();
  const acc = (id, st) => e.E.achievements(st).find((a) => a.id === id);
  const A = e.E.ACHIEVEMENTS;
  // A logged food. `protein` may be omitted to model a day whose foods carry NO
  // protein figure at all (an ABSENT value, never a 0).
  const ie = (date, name, protein) => {
    const macros = { kcal: 400, fat: 10, carb: 40 };
    if (protein != null) macros.protein = protein;
    return { id: "i" + date + name, date, name, grams: 100, macros };
  };
  const mon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
  const dstr = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const inWeek = (i) => { const x = mon(); x.setDate(x.getDate() + i); return dstr(x); };
  const dayPlus = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return dstr(x); };

  // ---- (a) each new badge fires on the healthy behaviour it names ----
  const oneDay = base({ intakelog: [ie(iso(1), "Oats", 40)] });
  truthy("First Entry fires on a first logged day", acc("firstlog", oneDay).met);
  eq("...and does NOT fire with nothing logged", acc("firstlog", base({})).met, false);

  // N Monday-start weeks, each with 5 distinct logged days (any amount).
  const coverWeeks = (n) => { const es = []; for (let i = 0; i < n; i++) { const m = dayPlus("2026-01-05", i * 7); for (let k = 0; k < 5; k++) es.push(ie(dayPlus(m, k), "Oats", 40)); } return base({ intakelog: es }); };
  eq("four covered weeks is what Well Tracked counts", e.E.achievementContext(coverWeeks(4)).intakeCoverWeeks, 4);
  truthy("Well Tracked fires at 4 covered weeks", acc("logcover4", coverWeeks(4)).met);
  eq("...and does not at 3", acc("logcover4", coverWeeks(3)).met, false);
  truthy("In the Habit (major) fires at 12 covered weeks", acc("logcover12", coverWeeks(12)).met);
  eq("...and does not at 11", acc("logcover12", coverWeeks(11)).met, false);
  truthy("In the Habit is a major badge (it earns the badge-get moment)", acc("logcover12", coverWeeks(12)).tier === "major");

  // 20 DIFFERENT foods (one entry each) — a repeated food must not count twice.
  const manyFoods = (n, repeat) => { const es = []; for (let i = 0; i < n; i++) es.push(ie(iso(1), "Food " + i, 10)); if (repeat) for (let i = 0; i < 5; i++) es.push(ie(iso(2), "Food 0", 10)); return base({ intakelog: es }); };
  eq("20 distinct foods counts 20", e.E.achievementContext(manyFoods(20)).intakeFoods, 20);
  truthy("Varied Plate fires at 20 distinct foods", acc("foodvariety", manyFoods(20)).met);
  eq("...and does not at 19", acc("foodvariety", manyFoods(19)).met, false);
  eq("repeating ONE food does not add variety", e.E.achievementContext(manyFoods(20, true)).intakeFoods, 20);

  // ---- (b) HARD EXCLUSIONS: nothing here can be earned by eating less ----
  const FORBIDDEN = /calorie|kcal|cheat|undereat|starv|fasted|skip(ped)? meal|guilt|shame|punish|injur|illness|\bsick\b|pain|burn|\bno days off\b|torch/i;
  eq("no badge name or blurb shames food, calories, rest, burning or pain",
     A.filter((a) => FORBIDDEN.test(a.name + " " + a.desc)).map((a) => a.id), []);

  // a LONE low-calorie day (one tiny entry) unlocks no coverage/variety badge...
  const tinyDay = base({ intakelog: [ie(iso(1), "Lettuce", 1)] });
  eq("a single low-calorie day unlocks no coverage or variety badge",
     ["logcover4", "logcover12", "foodvariety"].filter((id) => acc(id, tinyDay).met), []);
  eq("...and earns no food XP", e.E.intakeXp(tinyDay), 0);
  // ...and a week of low-calorie days is worth EXACTLY what a week of big days is:
  // the badge and the XP count DAYS, never amounts, so a low-calorie week is not
  // celebrated, and eating less buys nothing.
  const lowWeek = base({ intakelog: [0, 1, 2, 3, 4].map((k) => ({ id: "lo" + k, date: inWeek(k), name: "Lettuce", grams: 5, macros: { kcal: 8, protein: 0.5 } })) });
  const bigWeek = base({ intakelog: [0, 1, 2, 3, 4].map((k) => ({ id: "hi" + k, date: inWeek(k), name: "Steak", grams: 500, macros: { kcal: 1400, protein: 120 } })) });
  eq("a low-calorie week and a big week cover the same number of weeks",
     e.E.achievementContext(lowWeek).intakeCoverWeeks, e.E.achievementContext(bigWeek).intakeCoverWeeks);
  eq("...and earn the same food XP (amounts are never read)", e.E.intakeXp(lowWeek), e.E.intakeXp(bigWeek));
  // a "burned calories" figure (logged cardio) with NO food earns nothing
  const burnt = base({ intakelog: [], workouts: [wk(iso(1), [{ d: 12000, t: 3600 }], 1307, "Running", "distance_time")] });
  eq("logged cardio (calories 'burned') earns no food XP", e.E.intakeXp(burnt), 0);
  eq("...and unlocks no nutrition badge",
     A.filter((a) => /^(firstlog|logcover4|logcover12|foodvariety)$/.test(a.id) && a.test(e.E.achievementContext(burnt))).map((a) => a.id), []);

  // ---- (c) XP is not farmable by volume ----
  // A workout is carried so xp() is a real number here (xp() reads streaks()
  // .bestWeeks, which is undefined on a zero-workout state — a pre-existing quirk,
  // untouched by this batch).
  const W = wk(iso(30), [{ w: 100, r: 8 }]);
  const farm = base({ workouts: [W], intakelog: Array.from({ length: 50 }, (_, i) => ie(iso(1), "Food " + i, 5)) });
  const week = base({ workouts: [W], intakelog: [0, 1, 2, 3, 4].map((k) => ie(inWeek(k), "Oats", 40)) });
  const dXp = (st) => e.E.xp(st) - e.E.xp(base({ workouts: [W] }));
  eq("50 entries in ONE day is one day: no food XP at all", e.E.intakeXp(farm), 0);
  eq("five logged days in one week pay exactly once", e.E.intakeXp(week), e.E.XP.INTAKE_WEEK);
  truthy("50 entries in a day does NOT out-earn a week of coverage",
     e.E.intakeXp(farm) < e.E.intakeXp(week));
  eq("the single XP counter agrees: the farmed day adds nothing", dXp(farm), 0);
  eq("...and the covered week adds exactly one payment", dXp(week), e.E.XP.INTAKE_WEEK);
  truthy("the logging term stays small next to improvement (a PR)",
     e.E.XP.INTAKE_WEEK < e.E.XP.PR / 5);

  // ---- (d) VITALITY IS BODY-COMPOSITION ONLY ----
  // Reverses decision #3: nutrition was 30% of Vitality (NUTRI_VIT.W = 0.3) and
  // switched on after just 5 logged-protein days, so ONE logged low-protein day
  // dragged the score down — a perverse incentive to log less. Food logging is
  // now its own thing: it never feeds Vitality.
  const blog = [{ date: iso(40), weightKg: 84, bodyFatPct: 20 }, { date: iso(2), weightKg: 80, bodyFatPct: 15 }];
  const ifood = [1, 2, 3, 4, 5].map((i) => ie(iso(i), "Chicken breast", 130));
  const vit = (over) => e.E.attributes(base(over), 28).VIT;
  const body = vit({ bodylog: blog });                              // body measurements alone
  const withFood = vit({ bodylog: blog, intakelog: ifood });        // ...plus a thick food log
  const oneBlank = vit({ bodylog: blog, intakelog: [ie(iso(2), "Water", null)] }); // a logged low-protein day
  truthy("Vitality's basis names only the body parts, never nutrition",
     /weight|body fat|BMI/.test(body.detail.basis) && !/nutrition/i.test(body.detail.basis));
  eq("a thick food log does NOT change the Vitality score", withFood.detail.score, body.detail.score);
  eq("a single logged low-protein day no longer drags Vitality down", oneBlank.detail.score, body.detail.score);
  eq("the engine no longer exposes a nutrition part of Vitality",
     typeof e.E.nutritionVitality, "undefined");
  eq("...and the NUTRI_VIT weight table went with it", typeof e.E.NUTRI_VIT, "undefined");

  // ---- (e) the body path itself is intact ----
  // RE-EXPRESSED for the add-only redesign: goal progress is now a BONUS on top
  // of the healthy body-fat/BMI base, so the basis names it "goal progress" (not
  // the old "weight trend"), and it can only RAISE the score. A body already at
  // the healthy base (100) has no headroom, so the strict raise is proven on a
  // subject whose base sits below the ceiling (a heavy body).
  const withGoal = (p, bl) => vit({ profile: Object.assign({}, base().profile, p), bodylog: bl });
  truthy("with a weight goal, the goal-progress part is named in the basis",
     /goal progress/.test(withGoal({ goalWeightKg: 75 }, blog).detail.basis));
  const heavy = [{ date: iso(40), weightKg: 104 }, { date: iso(2), weightKg: 96 }];
  truthy("...and getting closer to the goal scores higher (the log is still read)",
     withGoal({ goalWeightKg: 75 }, heavy).score >
     withGoal({ goalWeightKg: 75 }, [{ date: iso(40), weightKg: 96 }, { date: iso(2), weightKg: 96 }]).score);
  const bare = vit({ profile: { name: "C", sex: "M", weightKg: 80, weeklyTarget: 3, units: "kg" },
    bodylog: [], intakelog: ifood });
  eq("no body measurements at all is still a zero score, not a nutrition number",
     bare.detail.score, 0);
  eq("...and its basis says 'no data'", bare.detail.basis, "no data");
}

console.log("\n=== 25. age-adjusted Strength (McCulloch coefficients) ===");
{
  const e = env();
  const Y = new Date().getFullYear();
  const BW = 80;
  const bench = (load) => base({ profile: Object.assign({}, base().profile, { weightKg: BW }),
    workouts: [{ id: "w1", date: iso(2), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: load, r: 5 }] }] }] });
  const strFor = (age, load) => {
    const st = bench(load); st.profile.birthYear = Y - age;
    return e.E.strengthScore(st, e.E.windowWorkouts(st, 28, 0), null);
  };

  // (a) the coefficient: published anchors, the below-40 floor, the edges
  eq("below 40 the coefficient is exactly 1.000", [e.E.ageCoefficient(0), e.E.ageCoefficient(20), e.E.ageCoefficient(30), e.E.ageCoefficient(39)], [1, 1, 1, 1]);
  eq("the published McCulloch anchors (40/45/50/60/70)", [e.E.ageCoefficient(40), e.E.ageCoefficient(45), e.E.ageCoefficient(50), e.E.ageCoefficient(60), e.E.ageCoefficient(70)], [1.000, 1.055, 1.130, 1.340, 1.645]);
  near("between published ages it interpolates (79 = midpoint of 78 and 80)", e.E.ageCoefficient(79), (1.961 + 2.050) / 2, 1e-9);
  eq("above the top published age it is HELD, not extrapolated", [e.E.ageCoefficient(80), e.E.ageCoefficient(95)], [2.050, 2.050]);

  // (b) CRITICAL: at age 30 nothing moves — equal to the exact pre-batch formula
  const s30 = strFor(30, 100);
  const lifts30 = e.E.bestLifts(bench(100), e.E.windowWorkouts(bench(100), 28, 0));
  const ks = Object.keys(lifts30);
  const before = e.E.clamp(ks.reduce((a, k) => a + e.E.liftScore(lifts30[k] / BW, k, "M"), 0) / ks.length);
  console.log(`     before (open standard, no coefficient): STR ${before}`);
  console.log(`     after  (age 30, coefficient 1.000)    : STR ${s30.score}   age=${s30.age} coef=${s30.coef}`);
  eq("the age used is 30", s30.age, 30);
  eq("the age-30 coefficient is 1.000", s30.coef, 1.000);
  truthy("age 30 is BYTE-IDENTICAL to the pre-batch value", s30.score === before);
  eq("...and the rounded score + tier are unchanged", [Math.round(s30.score), e.E.tierOf(Math.round(s30.score))],
     [Math.round(before), e.E.tierOf(Math.round(before))]);

  // (c) the same lift scores HIGHER at 45 (the coefficient lifts the effective ratio)
  const s45 = strFor(45, 100);
  console.log(`     same 100 kg bench: STR ${Math.round(s30.score)} @30 vs ${Math.round(s45.score)} @45`);
  truthy("the same lift scores higher at 45 than at 30", s45.score > s30.score);
  eq("...because the coefficient is 1.055", s45.coef, 1.055);

  // (d) ...and needs a LOWER actual load for the same rating (required-load direction)
  const req = (age, tier) => (e.E.STANDARDS.bench.m[tier] * BW) / e.E.ageCoefficient(age);
  const openNovice = e.E.STANDARDS.bench.m[1] * BW;     // 60 kg at the open standard
  console.log(`     load for a "Novice" bench at 80 kg BW: ${openNovice} open, ${req(45, 1).toFixed(2)} kg at 45`);
  truthy("a 45-year-old needs a LOWER actual load for the same tier", req(45, 1) < req(30, 1));
  truthy("...and the open-standard load IS the age-30 load", req(30, 1) === openNovice);
  truthy("the open load earns a higher rating at 45 than at 30", strFor(45, openNovice).score > strFor(30, openNovice).score);

  // (e) applied to Strength and NOT to Power
  const clean = base({ profile: Object.assign({}, base().profile, { weightKg: BW }),
    custom: [{ id: "pc1", n: "Power Clean", c: "Legs", g: ["Legs"], p: [], s: [], e: ["Barbell"], m: "weight_reps" }],
    workouts: [{ id: "c1", date: iso(2), note: "", entries: [{ id: "pc1", name: "Power Clean", mode: "weight_reps", sets: [{ w: 100, r: 3 }] }] }] });
  clean.profile.birthYear = Y - 30; const c30 = e.E.attributes(clean, 28, 0);
  clean.profile.birthYear = Y - 55; const c55 = e.E.attributes(clean, 28, 0);
  console.log(`     Power Clean 100x3: STR ${c30.STR.score}@30 -> ${c55.STR.score}@55 ; POW ${c30.POW.score}@30 -> ${c55.POW.score}@55`);
  truthy("age moves Strength", c55.STR.score !== c30.STR.score);
  eq("age does NOT move Power", c55.POW.score, c30.POW.score);

  // (f) the age comes from the DATED profile history (profileAsOf), not today's age
  const hist = base({ profile: Object.assign({}, base().profile, { weightKg: BW, birthYear: Y - 50 }),
    profilelog: [{ date: iso(800), heightCm: 178, birthYear: Y - 50, sex: "M", weeklyTarget: 3 }],
    workouts: [{ id: "h1", date: iso(730), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] }] });
  const live = e.E.attributes(hist, 28, 0).STR.detail;
  const past = e.E.attributes(hist, 28, 730).STR.detail;
  console.log(`     age now ${live.age} (coef ${live.coef}) / two years ago ${past.age} (coef ${past.coef})`);
  eq("the live read uses today's age", live.age, 50);
  eq("the live read uses today's coefficient", live.coef, 1.130);
  truthy("a past month is rated at the age in effect THEN, not today's", past.age < live.age);
  eq("...and that past age's coefficient is the one applied", past.coef, e.E.ageCoefficient(past.age));
  // a birth-year correction in the history must be honoured (profileAsOf feeds ageAt)
  const corr = base({ profile: Object.assign({}, base().profile, { weightKg: BW, birthYear: Y - 30 }),
    profilelog: [{ date: iso(800), heightCm: 178, birthYear: Y - 62, sex: "M", weeklyTarget: 3 }],
    workouts: [{ id: "h2", date: iso(730), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] }] });
  const corrLive = e.E.attributes(corr, 28, 0).STR.detail;
  const corrPast = e.E.attributes(corr, 28, 730).STR.detail;
  console.log(`     birth year corrected: live coef ${corrLive.coef} vs history coef ${corrPast.coef}`);
  eq("the live read uses the current birth year (coef 1.000 at 30)", corrLive.coef, 1.000);
  truthy("the historical month uses the birth year in effect THEN (coef > 1)", corrPast.coef > 1.000);
}

console.log("\n=== 26. the age-adjusted basis line names the coefficient, its source and its limits ===");
{
  const mk = (age) => appEnv({ profile: Object.assign({}, base().profile, { weightKg: 80, birthYear: new Date().getFullYear() - age }),
    workouts: [{ id: "w1", date: iso(2), note: "", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] }] });
  const h50 = mk(50);
  const line = h50.A.attrExplain("STR", h50.E.attributes(h50.S.state, 28).STR);
  console.log("     basis line @50:", line);
  truthy("the basis line names the coefficient value used", /coefficient of 1\.130/.test(line));
  truthy("...and its source (McCulloch / USA Powerlifting)", /McCulloch/.test(line) && /USA Powerlifting/.test(line));
  truthy("...and says the choice is an arrangement, not a consensus", /arrangement/.test(line) && /disagree/.test(line));
  truthy("...and states the powerlifting-lift extrapolation and the age-only scope", /extrapolation/.test(line) && /age only/.test(line));

  const h30 = mk(30);
  const line30 = h30.A.attrExplain("STR", h30.E.attributes(h30.S.state, 28).STR);
  console.log("     basis line @30:", line30);
  eq("at 30 the basis line carries NO age clause (byte-identical to before)", /Age-adjusted/.test(line30), false);
  truthy("...and still reads as the open-standard line", /published bodyweight standards/.test(line30));
}

console.log("\n=== 47. the per-session XP entry term is LINEAR: what you log is what you earn ===");
{
  /* The per-ENTRY term (5 XP per logged exercise) used to be CAPPED at
     XP.ENTRY_CAP (8) by a v1.1.2 anti-farming measure. That cap is REMOVED: a
     genuinely big session must pay what it earned, so N counted entries pay 5N,
     LINEAR and uncapped. The anti-farm guard is NOT a row count — it is (a) the
     validity filter (an entry counts only once it carries a real set) and (b) the
     volume taper (a set past its group's weekly MRV pays half the per-set rate). Isolate the entry
     term by logging entries that carry NO sets: they contribute nothing to tonnage
     or the per-set term, so the ONLY thing that can move `base` is the entry count
     — and with the cap gone a session of empty rows earns NOTHING. */
  const e = env();
  const empty = (n) => ({ id: "w" + n, date: iso(1), note: "",
    entries: Array.from({ length: n }, () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: [] })) });
  const withSets = (n) => ({ id: "v" + n, date: iso(1), note: "",
    entries: Array.from({ length: n }, () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] })) });
  const baseOf = (n) => e.E.sessionXp(base({ workouts: [empty(n)] }), empty(n)).base;
  const baseValid = (n) => e.E.sessionXp(base({ workouts: [withSets(n)] }), withSets(n)).base;
  /* each valid entry = 1 set of 100x10: base = 50 + tonnage/1000 (n) + sets*2 (2n)
     + entries*5 (5n) = 50 + 8n, so the ENTRY term alone is baseValid(n) - 50 - 3n. */
  const entryTerm = (n) => baseValid(n) - 50 - 3 * n;

  eq("the arbitrary entry cap is GONE (no dead constant)", e.E.XP.ENTRY_CAP, undefined);
  eq("the XP.SESSION floor is untouched", baseOf(0), 50);            // 50 + no entries
  eq("empty rows earn NOTHING — the validity filter, not a cap", [baseOf(5), baseOf(40), baseOf(400)], [50, 50, 50]);
  eq("N counted entries pay 5N, LINEAR", [entryTerm(5), entryTerm(8), entryTerm(40)], [25, 40, 200]);
  eq("doubling the entries doubles that term (2x -> 2x)", entryTerm(10), 2 * entryTerm(5));
  eq("a 41st entry still pays (no 8-entry ceiling)", entryTerm(41) - entryTerm(40), 5);
  eq("a genuinely big session scales with ALL its work", baseValid(40) - baseValid(20), 20 * 8);

  /* A NORMAL session is unchanged: 5 exercises x 4 sets of 100x10 (entries 5,
     all valid) earns the same base and session XP it did before the cap. */
  const oneSet = (w) => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w, r: 10 }] });
  /* ONE entry carrying four sets of 100x10. */
  const entry4 = () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{w:100,r:10},{w:100,r:10},{w:100,r:10},{w:100,r:10}] });
  const normal = base({ workouts: [{ id: "n", date: iso(1), note: "", entries: [1,2,3,4,5].map(entry4) }] });
  const nr = e.E.sessionXp(normal, normal.workouts[0]);
  eq("a 5-entry, 20-set session's base is unchanged", nr.base, 135);
  eq("...and its session XP is unchanged", nr.xp, 135);
  const fiveSet = base({ workouts: [wk(iso(1), Array.from({ length: 5 }, () => ({ w: 100, r: 10 })))] });
  eq("a 5-set session's base is unchanged", e.E.sessionXp(fiveSet, fiveSet.workouts[0]).base, 70);

  /* A WEEK of sensible sessions must BEAT a farmer who stuffs one session with 40
     one-set entries. Nothing is turned down any more; the anti-farm guard that
     still bites is the VOLUME TAPER (40 one-set rows on one group is far past its
     MRV, so every set beyond the group's MRV pays half rate — a per-set price,
     never a whole-session tax or a row count). */
  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"];   // Mon-Thu, one week
  const week = base({ workouts: days.map((d, i) => ({ id: "k" + i, date: d, note: "",
    entries: [1,2,3,4,5].map(entry4) })) });
  const farm = base({ workouts: [{ id: "f", date: "2026-06-01", note: "",
    entries: Array.from({ length: 40 }, () => oneSet(100)) }] });
  const wkXp = e.E.xp(week), fXp = e.E.xp(farm);
  const farmSx = e.E.sessionXp(farm, farm.workouts[0]);
  console.log(`     consistent week (4 sessions, 80 sets) ${wkXp} XP vs 40-set farmer (one session) ${fXp} XP`);
  truthy("a consistent week OUT-EARNS the 40-set farmer", wkXp > fXp);
  /* RE-EXPRESSED for the per-set taper: the over-MRV price is no longer a
     whole-session multiplier (farmSx.mult stays 1), it is paid per set. */
  truthy("the farmer's VOLUME is priced, not his row count", farmSx.factors.volume < 1 && farmSx.xp < farmSx.base);
  eq("the farmer's over-MRV sets pay the half rate, never a cap",
    farmSx.factors.volume, 0.775);
  eq("...and exactly the sets past Chest's MRV pay it", farmSx.overSets, 40 - e.E.LANDMARKS.Chest.mrv);
}

console.log("\n=== 48. the Save button's CLICK path really saves (the event-argument shadow) ===");
{
  /* The regression (v1.0.47): `$("#btn-save").addEventListener("click", saveDraft)`
     handed the MouseEvent to saveDraft's `draftIn` parameter. The event is truthy,
     so `const d = draftIn || draft` shadowed the live draft with the event and the
     first `d.entries.map` threw INSIDE the listener — no toast, no on-screen error,
     nothing saved, the draft left on screen. Save was dead on every device and every
     input method. This section drives the listener the app ACTUALLY registers (the
     CLICK path), with the entry data built through the app's own "Repeat last
     session" button, so it fails against the old wiring and passes against the fix. */
  const uiEnv = (seed) => {
    const store = {}, nodes = {}, listeners = {};
    const mkNode = (id) => ({
      id, _html: "", className: "", dataset: {}, style: {}, children: [],
      set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      addEventListener(type, fn) { (listeners[id + "|" + type] = listeners[id + "|" + type] || []).push(fn); },
      removeEventListener() {}, setAttribute() {}, removeAttribute() {},
      append(c) { this.children.push(c); }, prepend() {}, remove() {}, click() {}, focus() {},
      contains: () => false,
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
    vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "clickpath.js" });
    // fire the LAST listener registered for a selector+type, exactly as the live DOM
    // would: the most recent render owns the node.
    const fire = (sel, type, evt) => {
      const ls = listeners[sel + "|" + type] || [];
      if (!ls.length) throw new Error("no " + type + " listener was registered on " + sel);
      return ls[ls.length - 1](evt);
    };
    const toasts = () => (nodes["#toasts"] ? nodes["#toasts"].children.length : 0);
    return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, fire, toasts };
  };

  // a prior session exists, so the Log tab offers "Repeat last session" — the real
  // way a user fills the live draft without touching closure-private state.
  const seed = { workouts: [wk(iso(7), [{ w: 100, r: 8 }])] };

  // ---- (a) the WIRING: a genuine click on #btn-save must save ----
  const h = uiEnv(seed);
  h.A.buildIndex();
  h.A.setView("log");                       // renders the log tab -> registers listeners
  h.fire("#btn-repeat", "click", { type: "click" });   // live draft = a copy of the last session
  const before = h.S.state.workouts.length;
  let wiringErr = null;
  try { h.fire("#btn-save", "click", { type: "click", target: {}, preventDefault() {} }); }
  catch (e) { wiringErr = e; }
  if (wiringErr) console.log(`        (the click threw: ${wiringErr.constructor.name}: ${wiringErr.message})`);
  eq("clicking Save does not throw inside the listener", wiringErr === null, true);
  eq("clicking Save SAVED the session (workouts grew)", h.S.state.workouts.length, before + 1);
  truthy("...and the save ran its toast path", h.toasts() >= 2);   // repeat-toast + save-toast

  // ---- (b) the HARDENING: a non-draft first argument can never shadow the live draft ----
  // This is the exact call the old wiring made (the event arrives as draftIn).
  const g = uiEnv(seed);
  g.A.buildIndex();
  g.A.setView("log");
  g.fire("#btn-repeat", "click", { type: "click" });
  const gbefore = g.S.state.workouts.length;
  let hardErr = null;
  try { g.A.saveDraft({ type: "click", target: {}, preventDefault() {} }); }   // a MouseEvent-shaped object
  catch (e) { hardErr = e; }
  eq("saveDraft(<a MouseEvent>) does not throw", hardErr === null, true);
  eq("...and it saves the LIVE draft instead of shadowing it", g.S.state.workouts.length, gbefore + 1);

  // ---- (c) a REAL draft passed as draftIn still drives the save (tests depend on it) ----
  const k = uiEnv({});
  k.A.buildIndex();
  const real = { id: null, date: iso(0), note: "", entries: [
    { id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 90, r: 5 }] }] };
  k.A.saveDraft(real);
  eq("a real draft argument is still honoured", k.S.state.workouts.length, 1);
}

console.log("\n=== 49. the draft autosave: pure decisions + a real reload ===");
{
  /* The Log tab's draft lived only in memory: a WebView suspended/killed while
     the screen was locked lost a whole session (it happened once, for a whole
     workout). It is now mirrored to Store on every change and rebuilt on open.
     The pure decisions (what to write, whether to restore) and the round trip
     are pinned here, and the reload is driven through the app's REAL handlers. */
  const e = env();
  const T = "2026-06-02";
  const oneEntry = () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] });

  // ---- the pure payload: only what is worth keeping ----
  eq("an untouched new draft writes NOTHING",
    e.E.draftToStore({ id: null, date: "2026-06-01", note: "", entries: [], dateTouched: false }), null);
  eq("a whitespace-only note is not worth keeping",
    e.E.draftToStore({ id: null, date: "2026-06-01", note: "   ", entries: [], dateTouched: false }), null);
  truthy("a logged set makes it worth keeping",
    e.E.draftToStore({ id: null, date: "2026-06-01", note: "", entries: [oneEntry()], dateTouched: false }) !== null);
  truthy("a real note alone is worth keeping",
    e.E.draftToStore({ id: null, date: "2026-06-01", note: "legs", entries: [], dateTouched: false }) !== null);
  truthy("a date the user picked alone is worth keeping",
    e.E.draftToStore({ id: null, date: "2026-06-01", note: "", entries: [], dateTouched: true }) !== null);

  const stored = e.E.draftToStore({ id: null, date: "2026-06-01", note: "legs", entries: [oneEntry()], dateTouched: false });
  eq("the payload is EXACTLY the draft's five fields",
    Object.keys(stored).sort(), ["date", "dateTouched", "entries", "id", "note"]);
  eq("...the draft only, never the whole state", "workouts" in stored, false);

  // ---- restore: the four edge cases ----
  eq("a null payload restores to nothing", e.E.draftFromStore(null, T), null);
  eq("a corrupt payload restores to nothing", e.E.draftFromStore("{not json", T), null);
  eq("a non-object payload restores to nothing", e.E.draftFromStore("42", T), null);
  const back = e.E.draftFromStore(JSON.stringify(stored), T);
  eq("a stored draft restores its entries identically", back.entries, stored.entries);
  eq("...and its note", back.note, "legs");
  eq("an untouched, unsaved draft still follows TODAY (not its stored date)", back.date, T);

  const editStored = e.E.draftToStore({ id: "w1", date: "2026-05-01", note: "", entries: [oneEntry()], dateTouched: true });
  const editBack = e.E.draftFromStore(editStored, T);
  eq("an edited session keeps ITS date", editBack.date, "2026-05-01");
  eq("...and its id", editBack.id, "w1");
  eq("...and dateTouched", editBack.dateTouched, true);
  const touched = e.E.draftToStore({ id: null, date: "2026-05-09", note: "", entries: [oneEntry()], dateTouched: true });
  eq("a date the user picked is kept, not re-dated", e.E.draftFromStore(touched, T).date, "2026-05-09");

  // ---- idempotent ----
  eq("restoring twice yields the same draft", e.E.draftFromStore(stored, T), e.E.draftFromStore(stored, T));
  const d1 = e.E.draftFromStore(stored, T);            // an untouched draft re-dates to today
  eq("restore -> store -> restore is a fixed point",
    e.E.draftFromStore(e.E.draftToStore(d1), T), d1);

  /* ---- the real thing: build a draft through the app's own controls, "reload"
     into a fresh app sharing the same localStorage, and read it back ---- */
  const uiEnv2 = (seed, store) => {
    store = store || {};
    const qmap = {}, listeners = {};
    const mkNode = (id) => ({
      id, _html: "", className: "", dataset: {}, style: {}, children: [],
      set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
      addEventListener(type, fn) { (listeners[id + "|" + type] = listeners[id + "|" + type] || []).push(fn); },
      removeEventListener() {}, setAttribute() {}, removeAttribute() {},
      append(c) { this.children.push(c); }, prepend() {}, remove() {}, click() {}, focus() {},
      contains: () => false,
      querySelector: (sel) => (qmap[sel] = qmap[sel] || mkNode(sel)), querySelectorAll: () => [],
      getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    });
    const qnode = (sel) => (qmap[sel] = qmap[sel] || mkNode(sel));
    const s = {
      console: { log() {}, warn() {}, error() {}, info() {} },
      Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
      isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      confirm: () => true,                       // the delete path asks once
      document: {
        addEventListener() {}, removeEventListener() {},
        querySelector: qnode, querySelectorAll: () => [], getElementById: qnode,
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
    const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/macros.js", "js/nutrition.js", "js/store.js", "js/app.js"]
      .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
    vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "draftui.js" });
    const fire = (sel, type, evt) => {
      const ls = listeners[sel + "|" + type] || [];
      if (!ls.length) throw new Error("no " + type + " listener on " + sel);
      return ls[ls.length - 1](evt);
    };
    return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, store, fire };
  };
  const seed = { workouts: [wk(iso(7), [{ w: 100, r: 8 }])] };

  // build through the app's real "Repeat last session" control, then reload
  const shared = {};
  const h = uiEnv2(seed, shared);
  h.A.buildIndex(); h.A.setView("log");
  h.fire("#btn-repeat", "click", { type: "click", target: {} });
  const drafted = h.A.getDraft();
  eq("a draft IS persisted by the app on a real change", h.S.readDraftRaw() !== null, true);
  truthy("...under the app's own dedicated key", "fitness-app-v1-draft" in h.store);
  eq("...and the saved state key is untouched", JSON.parse(h.store["fitness-app-v1"]).workouts.length, 1);

  const h2 = uiEnv2(seed, shared);              // a fresh app instance (a reload),
  h2.A.buildIndex();                            // same localStorage
  h2.A.setView("log");
  eq("the draft came back after the reload — identical entries", h2.A.getDraft().entries, drafted.entries);
  eq("...identical sets", h2.A.getDraft().entries[0].sets, drafted.entries[0].sets);
  eq("...same note", h2.A.getDraft().note, drafted.note);
  h2.A.setView("dash"); h2.A.setView("log");    // reopening the tab is IDEMPOTENT
  eq("reopening the tab does not duplicate or corrupt the entries", h2.A.getDraft().entries.length, drafted.entries.length);

  // SAVE clears the stored draft
  const sv = uiEnv2(seed, {});
  sv.A.buildIndex(); sv.A.setView("log");
  sv.fire("#btn-repeat", "click", { type: "click", target: {} });
  eq("a draft is stored before the save", sv.S.readDraftRaw() !== null, true);
  sv.fire("#btn-save", "click", { type: "click", target: {}, preventDefault() {} });
  eq("SAVING clears the stored draft", sv.S.readDraftRaw(), null);
  eq("...and leaves a fresh, empty draft", sv.A.getDraft().entries.length, 0);
  eq("...the session itself is saved", sv.S.state.workouts.length, 2);

  // DELETE clears the stored draft (after loading a real saved session to edit)
  const dl = uiEnv2(seed, {});
  dl.A.buildIndex(); dl.A.setView("history");
  dl.fire(".ed", "click", { type: "click", target: {} });   // "Edit" a saved session
  eq("editing a saved session persists it as the draft", dl.S.readDraftRaw() !== null, true);
  eq("...keeping its id", dl.A.getDraft().id, seed.workouts[0].id);
  eq("...and its own date", dl.A.getDraft().date, seed.workouts[0].date);
  dl.A.setView("log");
  dl.fire("#btn-del", "click", { type: "click", target: {} });
  eq("DELETING clears the stored draft", dl.S.readDraftRaw(), null);
  eq("...and the session is gone", dl.S.state.workouts.length, 0);

  // an empty draft restores to NOTHING (no noise)
  const em = uiEnv2(seed, {});
  em.A.buildIndex(); em.A.setView("log");
  eq("with nothing stored there is no draft", em.S.readDraftRaw(), null);
  eq("...the new draft is empty", em.A.getDraft().entries.length, 0);
  eq("...and follows today", em.A.getDraft().date, iso(0));
}

console.log("\n=== 50. Vitality is body-composition HEALTH first (a goal can only add) ===");
{
  const e = env();
  const vitOf = (over) => e.E.attributes(base(over), 28).VIT;

  // (1) A SYNTHETIC healthy subject — lean, healthy, goals SET, not yet moved.
  // This reproduces the reported defect on fabricated data: it read 17 / "Early
  // days" before the fix because BOTH goal-gap parts scored 0 (current == start,
  // so no movement yet). The fixture is committed as tools/fixture-state.json.
  const subject = JSON.parse(fs.readFileSync(path.join(B, "tools/fixture-state.json"), "utf8"));
  const cv = e.E.attributes(subject, 28).VIT;
  console.log(`        fixture subject: VIT ${cv.score} (${cv.detail.basis})`);
  truthy("a lean, healthy male WITH goals reads HIGH (>= 80), not the old 17", cv.score >= 80);
  eq("...and is not the old goal-gap 17", cv.score === 17, false);
  truthy("...the basis names the body parts used (body fat / BMI)",
    /body fat/.test(cv.detail.basis) && /BMI/.test(cv.detail.basis));
  // He has not moved since his start, so goal progress measures 0 and adds
  // nothing — the point is that it also does not SUBTRACT.
  truthy("...an unmoved goal adds no bonus but does not lower the score", !/goal/.test(cv.detail.basis));

  // (2) a healthy subject with NO goal is just as high.
  const noGoal = vitOf({ profile: { name: "N", sex: "M", heightCm: 178, weightKg: 70, bodyFatPct: 12, weeklyTarget: 3, units: "kg" } });
  truthy("a healthy subject with NO goal reads high too", noGoal.score >= 80);

  // (3) an out-of-band body reads LOW, on either axis.
  const fat = vitOf({ profile: { name: "F", sex: "M", heightCm: 178, weightKg: 70, bodyFatPct: 40, weeklyTarget: 3, units: "kg" } });
  const bmi32 = vitOf({ profile: { name: "B", sex: "M", heightCm: 170, weightKg: 93, bodyFatPct: null, weeklyTarget: 3, units: "kg" } });
  console.log(`        40% body fat -> VIT ${fat.score}; BMI 32 -> VIT ${bmi32.score}`);
  truthy("40% body fat reads LOW", fat.score <= 40);
  truthy("a BMI of 32 reads LOW", bmi32.score <= 55);

  // (4) closing the gap can only RAISE: same CURRENT body, only the START differs.
  const prog = (start, cur) => vitOf({
    profile: { name: "P", sex: "M", heightCm: 178, weightKg: cur, bodyFatPct: 15, goalWeightKg: 75, weeklyTarget: 3, units: "kg" },
    bodylog: [{ date: iso(40), weightKg: start, bodyFatPct: 15 }, { date: iso(2), weightKg: cur, bodyFatPct: 15 }],
  });
  truthy("closing the gap RAISES the score (same current body)", prog(104, 96).score > prog(96, 96).score);
  // ...and it can never LOWER a healthy body: an unmet goal leaves it at the base.
  const healthy = (g) => vitOf({
    profile: { name: "H", sex: "M", heightCm: 178, weightKg: 70, bodyFatPct: 12, goalWeightKg: g, weeklyTarget: 3, units: "kg" },
    bodylog: [{ date: iso(40), weightKg: 70, bodyFatPct: 12 }, { date: iso(2), weightKg: 70, bodyFatPct: 12 }],
  });
  eq("a healthy body with an unmet goal is NOT dragged below its healthy base", healthy(90).score, 100);
  eq("...it reads the SAME as with no goal at all", healthy(90).score, noGoal.score);

  // (5) no measurements is still an honest 0 (never invented).
  const bare = vitOf({ profile: { name: "Z", sex: "M", weeklyTarget: 3, units: "kg" } });
  eq("no measurements at all is still 0", bare.score, 0);
  eq("...and its basis says 'no data'", bare.detail.basis, "no data");
}

console.log("\n=== 51. drop/failure sets earn EXTRA XP, capped, and the session shows it ===");
{
  /* The set-type multipliers fed the muscle-group effort path ONLY; a failure set
     paid nothing extra in `sessionXp`, which counted the raw set COUNT. A drop or
     failure set now earns extra XP for the extra effort — proportional to the
     set-type multiplier above a straight set — and is CAPPED per session (its
     own farm-proofing, HARD_SET_CAP), so marking every set "failure" cannot
     inflate it. The term only ADDS to the base, so XP never goes down. */
  const e = env();
  const sx = (sets) => { const s = base({ workouts: [wk(iso(1), sets)] }); return e.E.sessionXp(s, s.workouts[0]); };
  const straight = sx([{ w: 100, r: 10 }, { w: 100, r: 10 }]);
  const oneFail = sx([{ w: 100, r: 10 }, { w: 100, r: 10, ty: "failure" }]);
  const oneDrop = sx([{ w: 100, r: 10 }, { w: 100, r: 10, ty: "drop" }]);

  eq("the effort constants live in the XP block", [typeof e.E.XP.HARD_SET_XP, typeof e.E.XP.HARD_SET_CAP], ["number", "number"]);
  eq("the cap is a real, small number", e.E.XP.HARD_SET_CAP, 6);
  eq("a straight session carries no extra effort", [straight.effortXp, straight.hardSets], [0, 0]);
  truthy("a failure set pays extra XP for the extra effort", oneFail.effortXp > 0);
  truthy("...and its session earns MORE than the same sets all straight", oneFail.xp > straight.xp);
  eq("the extra is proportional to the multiplier above a straight set (failure 1.2)",
    oneFail.effortXp, Math.round(e.E.XP.HARD_SET_XP * (1.2 - 1)));
  eq("...a drop set (1.25) pays at least as much, and is never less", oneDrop.effortXp >= oneFail.effortXp, true);
  eq("the breakdown reports the hard sets that paid", oneFail.hardSets, 1);
  truthy("the base grew by the effort XP", oneFail.base - straight.base >= oneFail.effortXp);

  /* The cap: N failure sets pay for at most HARD_SET_CAP of them. */
  const failSession = (n) => sx(Array.from({ length: n }, () => ({ w: 100, r: 10, ty: "failure" })));
  const atCap = failSession(e.E.XP.HARD_SET_CAP);
  const overCap = failSession(e.E.XP.HARD_SET_CAP + 5);
  eq("the cap holds: only HARD_SET_CAP sets pay", overCap.hardSets, e.E.XP.HARD_SET_CAP);
  eq("...so the extra XP stops at the cap", overCap.effortXp, atCap.effortXp);
  truthy("a farmer marking EVERY set 'failure' is NOT paid linearly",
    failSession(40).effortXp === failSession(e.E.XP.HARD_SET_CAP).effortXp);

  /* Monotonicity: adding a set can only ever ADD XP. */
  truthy("XP only GROWS when a straight set is added", sx([{ w: 100, r: 10 }, { w: 100, r: 10 }, { w: 100, r: 10 }]).xp >= straight.xp);
  const grown = sx([{ w: 100, r: 10 }, { w: 100, r: 10 }, { w: 100, r: 10, ty: "failure" }]);
  truthy("...and a hard set added on top grows it further", grown.xp >= oneFail.xp);

  /* The UI: the History session detail shows the extra, in encouraging words, and
     the glossary explains the term (no dead control). */
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const GL = require(path.join(B, "js", "glossary.js"));
  truthy("history reads the hard-set breakdown from sessionXp", /const sx = Engine\.sessionXp\(S, w\)/.test(appSrc) && /sx\.hardSets \?/.test(appSrc));
  truthy("the history detail spells the extra out", appSrc.includes("XP for the extra effort"));
  truthy("the XP breakdown reports the effort row", /fmt\(sx\.base - sx\.effortXp\)/.test(appSrc) && /term\("hard-sets", "Hard sets"\)/.test(appSrc));
  truthy("'Hard sets' is the term used, not 'failed'", appSrc.includes("Hard sets") && !/Hard sets[^<]*failed/i.test(appSrc));
  truthy("the hard-set term has ONE glossary entry", GL.has("hard-sets"));
}

console.log("\n=== 52. the timed-set HOLD TIMER (planks, holds, dead hangs) ===");
{
  /* The timer is DOM wiring inside app.js, so this drives the REAL app.js
     behind a stub DOM that — unlike the §48 stub — can RENDER a set row and
     retrieve the very button the app registered its listener on. The clock is a
     fake Date.now the test advances, so Start -> advance -> Stop is deterministic
     and the elapsed seconds that land in `t` are exactly what a real hold would
     produce. */
  const mkDom = () => {
    let uid = 0, ivId = 0;
    const ivs = new Map();
    const mkNode = (tag) => {
      const cls = new Set();
      const q = new Map();
      const ls = new Map();
      /* Inputs rendered into innerHTML are parsed into live nodes so a selector
         like ".hold-len" returns the very input a real browser would, with its
         `value` taken from the markup — the prefill can then be asserted on the
         LIVE DOM (el.value), not on the template string. */
      const fields = new Map();
      const parseFields = (html) => {
        fields.clear();
        const re = /<input\b([^>]*)>/g;
        let m;
        while ((m = re.exec(html))) {
          const att = m[1];
          const clsV = (att.match(/\bclass="([^"]*)"/) || [null, ""])[1];
          const valV = (att.match(/\bvalue="([^"]*)"/) || [null, ""])[1];
          for (const tok of clsV.split(/\s+/).filter(Boolean)) {
            if (!fields.has(tok)) { const n = mkNode("input"); n.value = valV; fields.set(tok, n); }
          }
        }
      };
      const node = {
        _uid: ++uid, tagName: tag || "div", _html: "", className: "", dataset: {}, style: {},
        children: [], value: "", textContent: "", _attrs: {},
        set innerHTML(v) { this._html = String(v); if (String(v) === "") this.children = []; parseFields(this._html); },
        get innerHTML() { return this._html; },
        addEventListener(type, fn) { const a = ls.get(type) || []; a.push(fn); ls.set(type, a); },
        removeEventListener() {},
        setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k]; },
        removeAttribute(k) { delete this._attrs[k]; },
        append(c) { this.children.push(c); }, prepend() {}, remove() {}, click() {}, focus() {},
        contains: () => false, closest: () => mkNode("closest"),
        querySelector(sel) {
          const mm = /^\.([\w-]+)$/.exec(sel);
          if (mm && fields.has(mm[1])) return fields.get(mm[1]);
          if (!q.has(sel)) q.set(sel, mkNode("q:" + sel)); return q.get(sel);
        },
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
        classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: () => {}, contains: (c) => cls.has(c) },
        _fire(type, evt) { const a = ls.get(type) || []; if (!a.length) throw new Error("no " + type + " listener"); return a[a.length - 1](evt); },
        _has(type) { return (ls.get(type) || []).length > 0; },
      };
      return node;
    };
    const docs = new Map();
    const get = (sel) => { if (!docs.has(sel)) docs.set(sel, mkNode("doc:" + sel)); return docs.get(sel); };
    return { mkNode, get, ivs, nextIv: () => ++ivId };
  };

  const holdEnv = (seed, holdlen) => {
    const dom = mkDom();
    const store = {};
    /* A recording AudioContext so the chime can be asserted BEHAVIOURALLY: every
       oscillator it starts, with its gain envelope, is captured. */
    const CUE = { oscs: [], gains: [], opened: 0, closed: 0 };
    const mkParam = (rec, key) => ({
      set value(v) { rec[key] = v; }, get value() { return rec[key]; },
      setValueAtTime(v, t) { (rec.env = rec.env || []).push(["set", v, t]); },
      exponentialRampToValueAtTime(v, t) { (rec.env = rec.env || []).push(["exp", v, t]); },
      linearRampToValueAtTime(v, t) { (rec.env = rec.env || []).push(["lin", v, t]); },
    });
    function FakeAudioContext() {
      CUE.opened++; this.currentTime = 0; this.destination = {};
      this.createOscillator = () => {
        const rec = { type: "sine", freq: 0, start: null, stop: null };
        CUE.oscs.push(rec);
        return { set type(v) { rec.type = v; }, get type() { return rec.type; },
          frequency: mkParam(rec, "freq"), connect() {}, start(t) { rec.start = t; }, stop(t) { rec.stop = t; } };
      };
      this.createGain = () => { const rec = { gain: 0, env: [] }; CUE.gains.push(rec); return { gain: mkParam(rec, "gain"), connect() {} }; };
      this.close = () => { CUE.closed++; };
    }
    let NOW = Date.parse("2026-06-02T12:00:00");
    class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
    const s = {
      console: { log() {}, warn() {}, error() {}, info() {} },
      Date: FakeDate, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
      isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
      AudioContext: FakeAudioContext,
      setTimeout: () => 0, clearTimeout() {},
      setInterval: (fn) => { const id = dom.nextIv(); dom.ivs.set(id, fn); return id; },
      clearInterval: (id) => { dom.ivs.delete(id); },
      document: {
        addEventListener() {}, removeEventListener() {},
        querySelector: dom.get, querySelectorAll: () => [], getElementById: dom.get,
        createElement: (t) => dom.mkNode(t), createElementNS: () => dom.mkNode("ns"),
        body: dom.mkNode("body"), visibilityState: "visible", activeElement: null,
      },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      Blob: function () {}, URL: { createObjectURL: () => "blob:x" }, module: { exports: {} },
    };
    s.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
    s.window = s; s.globalThis = s;
    vm.createContext(s);
    vm.runInContext(`localStorage.setItem("fitness-app-v1", ${JSON.stringify(JSON.stringify(base(seed || {})))});`, s);
    if (holdlen) vm.runInContext(`localStorage.setItem("fitness-app-v1-holdlen", ${JSON.stringify(JSON.stringify(holdlen))});`, s);
    const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/app.js"]
      .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
    vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "hold.js" });
    const fire = (sel, type, evt) => dom.get(sel)._fire(type, evt);
    // one render of the Log tab, then the draft is filled via the app's OWN
    // "Repeat last session" control (draft is closure-private)
    const boot = () => { s.__X.App.buildIndex(); s.__X.App.setView("log"); fire("#btn-repeat", "click", { type: "click" }); };
    const view = () => dom.get("#view");
    const entryCard = () => view().children[1];
    const setRowNode = (idx, si) => entryCard().querySelector("#sets-" + (idx || 0)).children[si || 0];
    return {
      A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, fire, boot, view, entryCard, setRowNode,
      CUE, store,
      tick: () => { [...dom.ivs.values()].forEach((fn) => fn()); },
      setNow: (ms) => { NOW = ms; },
      now: () => NOW,
      toasts: () => (dom.get("#toasts").children.length),
    };
  };

  const plankId = 1307;   // "Front Plank", mode "time" in the library
  const plankSeed = (extra = {}) => Object.assign({
    workouts: [{ id: "w1", date: "2026-05-28", note: "", entries: [
      { id: plankId, name: "Front Plank", mode: "time", sets: [{ t: 45 }] }] }],
  }, extra);

  // ---- (a) Start -> advance -> Stop writes the elapsed seconds into `t` ----
  const h = holdEnv(plankSeed());
  h.boot();
  const draftSet = h.A.getDraft().entries[0].sets[0];          // the repeat copies, so the DRAFT set
  const row = h.setRowNode(0, 0);
  const btn = row.querySelector(".hold-btn");
  const clock = row.querySelector(".hold-clock");
  truthy("a timed set row carries the hold control", /hold-btn/.test(row.innerHTML));
  truthy("it also keeps the manual seconds input", /data-k="t"/.test(row.innerHTML));
  /* the idle state is in the markup the row is built from (the stub does not
     parse innerHTML, so the initial label is read from the template itself) */
  truthy("the clock starts at 0:00", /class="hold-clock"[^>]*>0:00</.test(row.innerHTML));
  truthy("the button starts as Start", /class="btn ghost tiny hold-btn"[^>]*>Start</.test(row.innerHTML));

  // scope: this is the ONLY mode that got it
  truthy("the row's other controls are unchanged (set-type control intact)", /class="mini setty"/.test(row.innerHTML));
  eq("the draft set's t is what was repeated", draftSet.t, 45);
  /* the timer writes NOTHING of its own: capture the key set before the run and
     require Stop to leave it identical apart from t */
  const keysBefore = Object.keys(draftSet).sort();

  btn._fire("click", { type: "click" });                        // Start
  eq("Start flips the control to Stop", btn.textContent, "Stop");
  h.setNow(h.now() + 42400);                                    // 42.4 s held
  h.tick();                                                     // the live repaint
  eq("a running count does NOT touch the set's t", draftSet.t, 45);
  eq("the live clock reads mm:ss", clock.textContent, "0:42");
  btn._fire("click", { type: "click" });                        // Stop
  eq("Stop writes the elapsed seconds into t", draftSet.t, 42);
  eq("the typed seconds field is kept in step", row.querySelector('[data-k="t"]').value, "42");
  eq("the control returns to Start", btn.textContent, "Start");
  eq("the timer added NO new set field — only t changed", Object.keys(draftSet).sort(), keysBefore);

  // ---- (b) tapping Start again begins a FRESH count from 0 ----
  h.setNow(h.now() + 3600000);
  btn._fire("click", { type: "click" });
  eq("a new start resets the clock to 0:00", clock.textContent, "0:00");
  h.setNow(h.now() + 5000); h.tick();
  eq("...and counts from zero, not from the last hold", clock.textContent, "0:05");
  btn._fire("click", { type: "click" });
  eq("Stop records the FRESH elapsed (5 s), not a cumulative one", draftSet.t, 5);

  // ---- (c) a sub-second tap must never leave a half-logged set ----
  const before = draftSet.t, toastsBefore = h.toasts();
  btn._fire("click", { type: "click" });                        // Start
  h.setNow(h.now() + 300);                                      // 0.3 s
  btn._fire("click", { type: "click" });                        // Stop
  eq("an under-one-second hold leaves t untouched", draftSet.t, before);
  truthy("...and says so, neutrally", h.toasts() > toastsBefore);

  // ---- (d) a straight MANUAL time entry still works (the parser path) ----
  eq("typing \"90\" in a time row still parses to 90 s", h.A.parseSet("90", "time").t, 90);
  eq("clock shorthand still parses (1:30)", h.A.parseSet("1:30", "time").t, 90);
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the manual seconds field markup is untouched",
    appSrc.includes('f("t", "secs", 64, `${sl} seconds`)'));

  // ---- (e) SCOPE: no other mode gets a hold control ----
  const otherEnv = (mode, name, sets) => {
    const h2 = holdEnv({ workouts: [{ id: "w1", date: "2026-05-28", note: "",
      entries: [{ id: 73, name, mode, sets }] }] });
    h2.boot();
    return { h2, row: h2.setRowNode(0, 0) };
  };
  const wr = otherEnv("weight_reps", "Bench Press", [{ w: 100, r: 10 }]);
  truthy("a weight × reps row has NO hold control", !/hold-btn/.test(wr.row.innerHTML));
  truthy("...and keeps its weight/reps inputs", /data-k="w"/.test(wr.row.innerHTML) && /data-k="r"/.test(wr.row.innerHTML));
  const rp = otherEnv("reps", "Push Up", [{ r: 12 }]);
  truthy("a reps row has NO hold control", !/hold-btn/.test(rp.row.innerHTML));
  const dt = otherEnv("distance_time", "Run", [{ d: 5000, t: 1500 }]);
  truthy("a distance × time row has NO hold control either", !/hold-btn/.test(dt.row.innerHTML));
  eq("...and its t is only ever what is typed (no timer wiring)", dt.h2.A.getDraft().entries[0].sets[0].t, 1500);

  // ---- (f) an EXISTING target drives the clock; none is ever invented ----
  const tg = holdEnv(plankSeed({ targets: { [plankId]: { value: 60, set: "2026-05-01" } } }));
  tg.boot();
  const tgRow = tg.setRowNode(0, 0);
  truthy("a per-exercise target is surfaced on the row", /hold-target/.test(tgRow.innerHTML) && tgRow.innerHTML.includes("/1:00"));
  const tgBtn = tgRow.querySelector(".hold-btn");
  tgBtn._fire("click", { type: "click" });
  tg.setNow(tg.now() + 60000); tg.tick();          // reach the 60 s target — the beep fires (guarded)
  tgBtn._fire("click", { type: "click" });
  eq("reaching the target still logs the true elapsed time", tg.A.getDraft().entries[0].sets[0].t, 60);
  const noTg = holdEnv(plankSeed());
  noTg.boot();
  truthy("with no target, no target is invented (clock only)", !/hold-target/.test(noTg.setRowNode(0, 0).innerHTML));

  // ---- (g) the chime needs no permission; vibration was correctly skipped ----
  truthy("the chime is guarded behind an AudioContext feature check", /window\.AudioContext \|\| window\.webkitAudioContext/.test(appSrc));
  truthy("no navigator.vibrate call was added", !/navigator\s*\.\s*vibrate/.test(appSrc));
  const manifest = fs.readFileSync(path.join(B, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
  truthy("the Android manifest still has no VIBRATE permission (no permission change)", !/VIBRATE/.test(manifest));

  // ---- (h) LENGTH set BEFORE Start drives the goal + the soft cues ----
  const L = holdEnv(plankSeed(), { [plankId]: 30 });     // remembered last-used = 30 s
  L.boot();
  const lRow = L.setRowNode(0, 0);
  const lenInp = lRow.querySelector(".hold-len");
  truthy("a timed row carries an editable LENGTH field", /class="inp num hold-len"/.test(lRow.innerHTML));
  /* the prefill is read from the LIVE DOM input's value, not the template string */
  eq("the LENGTH input pre-fills from the LAST length used when there is no target", lenInp.value, "30");
  truthy("...and shows that length as the goal", /hold-target/.test(lRow.innerHTML) && lRow.innerHTML.includes("/0:30"));
  eq("with no stored target, prefill invents none", JSON.stringify(L.S.state.targets), "{}");

  lenInp.value = "45"; lenInp._fire("input", { type: "input" });
  eq("typing a length moves the goal live", lRow.querySelector(".hold-target").textContent, "/0:45");
  eq("...and the LIVE LENGTH input holds the typed length", lenInp.value, "45");
  lenInp._fire("change", { type: "change" });
  eq("the length is remembered as last-used", JSON.parse(L.store["fitness-app-v1-holdlen"])[plankId], 45);
  eq("setting the length NEVER writes the stored per-exercise target", JSON.stringify(L.S.state.targets), "{}");

  lenInp.value = ""; lenInp._fire("input", { type: "input" });
  eq("clearing the length removes the goal", lRow.querySelector(".hold-target").textContent, "");
  lenInp.value = "20"; lenInp._fire("input", { type: "input" });

  const lBtn = lRow.querySelector(".hold-btn"), lClock = lRow.querySelector(".hold-clock");
  const lSet = L.A.getDraft().entries[0].sets[0];
  lBtn._fire("click", { type: "click" });                 // Start
  eq("Start flips to Stop", lBtn.textContent, "Stop");
  truthy("Start FREEZES the LENGTH box (goal cannot shift mid-count)", lenInp.disabled === true);
  eq("a running count still writes nothing to t", lSet.t, 45);
  L.setNow(L.now() + 12000); L.tick();
  eq("the clock counts UP toward the goal", lClock.textContent, "0:12");
  truthy("no visual cue before the goal", !lClock.classList.contains("hit"));
  eq("no chime before the goal", L.CUE.oscs.length, 0);
  L.setNow(L.now() + 8000); L.tick();                     // now exactly 20 s
  eq("at the goal the clock shows the length", lClock.textContent, "0:20");
  truthy("the VISUAL CUE fires ON the clock at the goal", lClock.classList.contains("hit"));
  eq("the SOFT chime plays ONCE — two notes", L.CUE.oscs.length, 2);
  truthy("every chime note is a gentle sine", L.CUE.oscs.every((o) => o.type === "sine"));
  const peaks = L.CUE.gains.map((g) => Math.max(0, ...g.env.filter((r) => r[0] === "exp").map((r) => r[1])));
  truthy("the chime is QUIET — peak gain <= 0.05 on every note", peaks.length === 2 && peaks.every((p) => p > 0 && p <= 0.05));
  truthy("each note is SHORT — <= 0.2 s", L.CUE.oscs.every((o) => o.stop - o.start > 0 && o.stop - o.start <= 0.2));
  truthy("two different pitches — a blip, not a buzz", L.CUE.oscs[0].freq !== L.CUE.oscs[1].freq);
  L.setNow(L.now() + 30000); L.tick(); L.tick();
  eq("the chime NEVER repeats however long the hold runs", L.CUE.oscs.length, 2);
  const lKeys = Object.keys(lSet).sort();
  lBtn._fire("click", { type: "click" });                 // Stop
  eq("Stop writes the elapsed seconds into t (50 s)", lSet.t, 50);
  eq("Stop re-enables the LENGTH box", lenInp.disabled, false);
  eq("the timer adds NO set field — only t changed", Object.keys(lSet).sort(), lKeys);

  // ---- (i) a blank length is exactly the old count-up: no goal, no chime ----
  const B2 = holdEnv(plankSeed());
  B2.boot();
  const bRow = B2.setRowNode(0, 0);
  truthy("a blank length leaves NO goal on the row", !/hold-target/.test(bRow.innerHTML));
  eq("the LIVE LENGTH input is empty (never mandatory)", bRow.querySelector(".hold-len").value, "");
  const bClock = bRow.querySelector(".hold-clock");
  bRow.querySelector(".hold-btn")._fire("click", { type: "click" });
  B2.setNow(B2.now() + 90000); B2.tick();
  eq("a blank length just counts UP", bClock.textContent, "1:30");
  truthy("...with no visual cue", !bClock.classList.contains("hit"));
  eq("...and no chime", B2.CUE.oscs.length, 0);
  bRow.querySelector(".hold-btn")._fire("click", { type: "click" });
  eq("Stop still logs the elapsed time", B2.A.getDraft().entries[0].sets[0].t, 90);

  // ---- (j) the LENGTH pre-fill read from the LIVE input, and OPEN holds ----
  /* (a) a straight/normal timed set pre-fills its LIVE LENGTH input from the
     saved per-exercise TARGET. */
  const tgtEnv = holdEnv(plankSeed({ targets: { [plankId]: { value: 75, set: "2026-05-01" } } }));
  tgtEnv.boot();
  const tgtRow = tgtEnv.setRowNode(0, 0);
  const tgtLen = tgtRow.querySelector(".hold-len");
  eq("(a) a straight timed set pre-fills the LIVE input from the saved target", tgtLen.value, "75");
  truthy("(a) ...and the goal reads that target", tgtRow.innerHTML.includes("/1:15"));
  /* (c) a length typed by the user overrides that prefill, live. */
  tgtLen.value = "45"; tgtLen._fire("input", { type: "input" });
  eq("(c) a typed length overrides the prefill in the LIVE input", tgtLen.value, "45");
  eq("(c) ...and replaces the goal", tgtRow.querySelector(".hold-target").textContent, "/0:45");

  /* (b) a FAILURE or DROP set pre-fills the LIVE input BLANK — an open count-up
     you stop yourself. A saved target (75) AND a remembered last length (40) are
     BOTH present, and neither is used: a hold to failure has no time target. */
  const hardSeed = (ty) => ({ workouts: [{ id: "w1", date: "2026-05-28", note: "", entries: [
    { id: plankId, name: "Front Plank", mode: "time", sets: [{ t: 45, ty }] }] }],
    targets: { [plankId]: { value: 75, set: "2026-05-01" } } });
  const flEnv = holdEnv(hardSeed("failure"), { [plankId]: 40 });
  flEnv.boot();
  const flRow = flEnv.setRowNode(0, 0);
  const flLen = flRow.querySelector(".hold-len");
  eq("(b) a FAILURE set pre-fills the LIVE LENGTH input BLANK", flLen.value, "");
  truthy("(b) ...so the failure hold carries NO goal", !/hold-target/.test(flRow.innerHTML));
  const drEnv = holdEnv(hardSeed("drop"), { [plankId]: 40 });
  drEnv.boot();
  eq("(b) a DROP set pre-fills BLANK too", drEnv.setRowNode(0, 0).querySelector(".hold-len").value, "");

  /* the user may still TYPE a length on a failure/drop set if they want one */
  flLen.value = "20"; flLen._fire("input", { type: "input" });
  eq("a length typed on a failure set is honoured (goal appears)", flRow.querySelector(".hold-target").textContent, "/0:20");
  flLen.value = ""; flLen._fire("input", { type: "input" });

  /* the OPEN path end to end: blank -> counts up, no goal, no chime; Stop writes
     the elapsed seconds into t; a running count never writes t. */
  const flBtn = flRow.querySelector(".hold-btn"), flClock = flRow.querySelector(".hold-clock");
  const flSet = flEnv.A.getDraft().entries[0].sets[0];
  const flT = flSet.t;
  flBtn._fire("click", { type: "click" });                 // Start
  eq("Start FREEZES the LENGTH box", flLen.disabled, true);
  flEnv.setNow(flEnv.now() + 37000); flEnv.tick();
  eq("an open failure hold counts UP freely (no goal to hit)", flClock.textContent, "0:37");
  truthy("...no visual cue — there is no goal", !flClock.classList.contains("hit"));
  eq("...and NO chime ever", flEnv.CUE.oscs.length, 0);
  eq("a running count never writes t", flSet.t, flT);
  flBtn._fire("click", { type: "click" });                 // Stop
  eq("Stop writes the open elapsed seconds into t", flSet.t, 37);

  /* marking a straight hold set as failure/drop blanks its LENGTH live */
  const swEnv = holdEnv(plankSeed({ targets: { [plankId]: { value: 75 } } }));
  swEnv.boot();
  const swRow = swEnv.setRowNode(0, 0);
  const swLen = swRow.querySelector(".hold-len");
  const swSet = swEnv.A.getDraft().entries[0].sets[0];
  eq("setup: the straight hold pre-fills from the target", swLen.value, "75");
  swSet.ty = "failure"; swRow.querySelector(".setty")._fire("change", { type: "change" });
  eq("marking the set FAILURE blanks the LENGTH live (open hold)", swLen.value, "");
  eq("...and drops the goal", swRow.querySelector(".hold-target").textContent, "");
  swSet.ty = "drop"; swRow.querySelector(".setty")._fire("change", { type: "change" });
  eq("a DROP set blanks too", swLen.value, "");
  delete swSet.ty; swRow.querySelector(".setty")._fire("change", { type: "change" });
  eq("switching back to a straight set restores the target prefill", swLen.value, "75");

  /* a failure-marked TIMED set still earns the capped effort XP (SET_TYPES /
     HARD_SET_*) — the hold's type changes nothing about scoring. */
  const E2 = flEnv.E;
  const xpOfSets = (sets) => { const st = base({ workouts: [{ id: "w9", date: "2026-07-01", note: "",
    entries: [{ id: plankId, name: "Front Plank", mode: "time", sets }] }] });
    return E2.sessionXp(st, st.workouts[0]); };
  const straightT = xpOfSets([{ t: 60 }]);
  const failT = xpOfSets([{ t: 60, ty: "failure" }]);
  eq("a straight timed set carries no extra effort", straightT.effortXp, 0);
  truthy("a failure-marked TIMED set earns the capped effort XP", failT.effortXp > 0);
  eq("...at the failure multiplier (1.2)", failT.effortXp, Math.round(E2.XP.HARD_SET_XP * 0.2));
  eq("...and the breakdown counts one hard set", failT.hardSets, 1);
  const nT = (n) => xpOfSets(Array.from({ length: n }, () => ({ t: 60, ty: "failure" })));
  eq("...capped at HARD_SET_CAP like any other set", nT(20).effortXp, nT(E2.XP.HARD_SET_CAP).effortXp);
}

console.log("\n=== 53. XP scales with the work logged — and only ever GROWS as data is added ===");
{
  /* Two standing rules, pinned here after the entry cap came off:
     (1) an INVALID row earns nothing — a row that carries no real reps/time/load
         is not logged work, so it adds nothing beyond the session's flat floor;
     (2) XP only ever GROWS as data is added — a level can never go down.
     Rule (2) is pinned on the two axes the app actually appends on: more SESSIONS,
     and more SETS on a session that already exists. (A known, PRE-EXISTING
     exception: the over-MRV measure is summed per ENTRY, so SPLITTING the same
     volume across more entries can raise the volume penalty; that behaviour is in
     the volume factor the task kept unchanged and is not asserted either way
     here. Level thresholds are coarse, so a small dip rarely moves a level.) */
  const e = env();

  // (1) invalid rows earn nothing ------------------------------------------
  const bad = (n, sets) => ({ id: "b" + n, date: iso(1), note: "",
    entries: Array.from({ length: n }, () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets })) });
  const sessBase = (n, sets) => { const w = bad(n, sets); return e.E.sessionXp(base({ workouts: [w] }), w).base; };
  eq("a row with NO sets adds nothing to the session", sessBase(1, []), sessBase(0, []));
  eq("...and 40 such rows still add nothing", sessBase(40, []), 50);
  eq("a row whose only set has no reps (invalid) earns nothing", sessBase(3, [{ w: 100, r: 0 }]), 50);
  eq("...an empty set object earns nothing", sessBase(3, [{}]), 50);
  eq("a bodyweight-style row with no reps earns nothing", sessBase(3, [{ w: 0, r: 0 }]), 50);
  // a REAL set on the same row starts paying, so the filter is on validity, not on the row
  truthy("the same row WITH a real set does earn", sessBase(1, [{ w: 100, r: 10 }]) > 50);

  // (2) the invariant, on the two append axes ------------------------------
  const oneEntry = (n) => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: Array.from({ length: n }, () => ({ w: 100, r: 10 })) });
  let setDrops = 0;
  for (let n = 1; n <= 60; n++) {
    const w = { id: "w", date: "2026-06-01", note: "", entries: [oneEntry(n)] };
    const st = base({ workouts: [w] });
    if (n > 1 && e.E.sessionXp(st, w).xp < e.E.sessionXp(base({ workouts: [{ id: "w", date: "2026-06-01", note: "", entries: [oneEntry(n - 1)] }] }), { id: "w", date: "2026-06-01", note: "", entries: [oneEntry(n - 1)] }).xp) setDrops++;
  }
  eq("adding a set never lowers a session's XP (1..60 sets)", setDrops, 0);

  const days = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];
  let sessionDrops = 0, prevTotal = 0;
  for (let i = 1; i <= days.length; i++) {
    const ws = days.slice(0, i).map((d, k) => ({ id: "s" + k, date: d, note: "",
      entries: Array.from({ length: 5 }, () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: Array.from({ length: 6 }, () => ({ w: 100, r: 10 })) })) }));
    const total = e.E.xp(base({ workouts: ws }));
    if (i > 1 && total < prevTotal) sessionDrops++;
    prevTotal = total;
  }
  eq("adding a session never lowers the total XP", sessionDrops, 0);
  const oneDay = base({ workouts: [{ id: "s0", date: "2026-06-01", note: "",
    entries: Array.from({ length: 5 }, () => ({ id: 73, name: "Bench Press", mode: "weight_reps", sets: Array.from({ length: 6 }, () => ({ w: 100, r: 10 })) })) }] });
  truthy("...and the total only ever climbs across a week", prevTotal > e.E.xp(oneDay));
}

console.log("\n=== 54. PROPERTY: NOTHING ever reduces XP — a set, an entry or a session can only ADD ===");
{
  /* the owner's standing rule (v1.2.10): "Nothing should ever reduce xp."
     The old defect: `overMrvSplit` summed min(mine, beyond) PER ENTRY and the
     volume factor multiplied the WHOLE session, so (a) splitting the same weekly
     volume across more entries raised the penalty (measured 22 one-set entries ->
     226 XP, 23 -> 176) and (b) any over-MRV work taxed everything. This drives
     the app's three append axes ONE STEP AT A TIME across a matrix of realistic
     sessions that cross every group's MRV, and asserts XP is non-decreasing at
     EVERY step — for the session being grown AND for the grand total. */
  const e = env();
  const PROF = { name: "C", sex: "M", heightCm: 178, weightKg: 80, bodyFatPct: 15, weeklyTarget: 5, units: "kg" };
  /* `g` is stamped on each entry, so attribution is deterministic and does not
     depend on the library's own group list. */
  const LIFTS = [
    { id: 73, name: "Bench Press", g: ["Chest"], mode: "weight_reps", set: { w: 100, r: 8 } },
    { id: 22, name: "Barbell Row", g: ["Back"], mode: "weight_reps", set: { w: 80, r: 10 } },
    { id: 11, name: "Squat", g: ["Legs"], mode: "weight_reps", set: { w: 120, r: 6 } },
    { id: 31, name: "Plank", g: ["Core"], mode: "time", set: { t: 60 } },
  ];
  const lift = (i, n) => ({ id: LIFTS[i].id, name: LIFTS[i].name, mode: LIFTS[i].mode, g: LIFTS[i].g,
    sets: Array.from({ length: n }, () => ({ ...LIFTS[i].set })) });
  const DAY = (i) => { const d = new Date(2026, 5, 1 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const sess = (id, dayI, entries) => ({ id, date: DAY(dayI), note: "", entries });
  /* Four realistic PRIOR-week volumes, from empty to past two groups' MRV. */
  const PRIORS = [
    { name: "empty week", sets: [] },
    { name: "20 chest sets (inside MRV 22)", sets: [[0, 20]] },
    { name: "30 chest sets (past MRV 22)", sets: [[0, 30]] },
    { name: "chest 30 + back 26 (both past MRV)", sets: [[0, 30], [1, 26]] },
  ];
  let steps = 0, fails = 0;
  const nonDec = (label, a, b) => { steps++; if (!(b >= a)) { fails++; console.log(`  FAIL ${label}: ${a} -> ${b}`); } };
  const xpOf = (st, w) => e.E.sessionXp(st, w).xp;

  let best = { within: null, split1: null, split2: null, over: null, week: null };
  for (const prior of PRIORS) {
    const priorW = prior.sets.map(([li, n], k) => sess("p" + k, k, [lift(li, n)]));

    // AXIS 1 — grow ONE entry one SET at a time
    let ps = null, pt = null;
    for (let n = 1; n <= 30; n++) {
      const w = sess("t", 5, [lift(0, n)]);
      const st = base({ profile: PROF, workouts: [...priorW, w] });
      const s = xpOf(st, w), t = e.E.xp(st);
      if (ps !== null) { nonDec(`${prior.name} / +1 set (n=${n}) session`, ps, s); nonDec(`${prior.name} / +1 set (n=${n}) total`, pt, t); }
      ps = s; pt = t;
      if (prior.name === "empty week" && n === 20) best.within = s;   // 20 chest sets, inside MRV
      if (prior.name === "30 chest sets (past MRV 22)" && n === 5) best.over = { xp: s, over: e.E.sessionXp(st, w).overSets };
    }

    // AXIS 2 — grow ONE session one ENTRY at a time (the SPLIT axis that broke)
    ps = pt = null;
    for (let n = 1; n <= 12; n++) {
      const w = sess("t", 5, Array.from({ length: n }, () => lift(0, 1)));
      const st = base({ profile: PROF, workouts: [...priorW, w] });
      const s = xpOf(st, w), t = e.E.xp(st);
      if (ps !== null) { nonDec(`${prior.name} / +1 entry (n=${n}) session`, ps, s); nonDec(`${prior.name} / +1 entry (n=${n}) total`, pt, t); }
      ps = s; pt = t;
      if (prior.name === "empty week" && n === 1) best.split1 = s;
      if (prior.name === "empty week" && n === 4) best.split2 = s;
    }

    // AXIS 3 — append whole SESSIONS; the total AND every existing session's XP grow
    pt = null;
    const acc = [...priorW];
    let lastXs = acc.map((x) => xpOf(base({ profile: PROF, workouts: acc }), x));
    for (let i = 0; i < 7; i++) {
      acc.push(sess("s" + i, 2 + i, [lift(0, 6), lift(1, 6), lift(2, 6)]));
      const st = base({ profile: PROF, workouts: acc });
      const t = e.E.xp(st);
      if (pt !== null) nonDec(`${prior.name} / +1 session (i=${i}) total`, pt, t);
      for (let j = 0; j < acc.length - 1; j++) nonDec(`${prior.name} / +1 session (i=${i}) session#${j}`, lastXs[j], xpOf(st, acc[j]));
      lastXs = acc.map((x) => xpOf(st, x));
      pt = t;
    }

    // a NORMAL WEEK benchmark (4 sessions x 3 entries x 6 sets, within MRV)
    const normalWeek = base({ profile: PROF, workouts: [0, 1, 3, 4].map((d, k) =>
      sess("n" + k, d, [lift(0, 6), lift(1, 6), lift(2, 6)])) });
    if (prior.name === "empty week") best.week = e.E.xp(normalWeek);
  }

  console.log(`     matrix: ${PRIORS.length} prior-week volumes x {30 sets, 12 entries, 7 sessions} = ${steps} non-decreasing steps checked`);
  console.log(`     within-MRV 20-set session ${best.within} XP · same work as 1 entry ${best.split1} XP -> 4 entries ${best.split2} XP`);
  console.log(`     a 5-set session in an over-MRV week: ${best.over.xp} XP with ${best.over.over} of its 5 sets tapered · a normal week ${best.week} XP`);
  eq("XP is NON-DECREASING at every step — a set, an entry or a session can only ADD", fails, 0);
  truthy("the property test really exercised the matrix", steps > 400);
}
console.log("\n=== 55. the HERO tab: roster, equip, colourway (pure view-model) ===");
{
  /* Load the REAL engine + the pure js/herotab.js together, so the tab's model
     and its html are exercised exactly as the app builds them. */
  const store = {};
  const s = {
    console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
    Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
    setTimeout, clearTimeout, module: { exports: {} },
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  };
  s.globalThis = s; vm.createContext(s);
  const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/herotab.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
  vm.runInContext(src + "\n;globalThis.__X={Engine,HeroTab};", s, { filename: "hero-bundle.js" });
  const E = s.__X.Engine, HT = s.__X.HeroTab;

  const st = (hero) => ({ profile: { weeklyTarget: 4 }, workouts: [], achievements: {}, intakelog: [], hero: hero || { equipped: "slime", colourway: "natural", unlocked: ["slime", "natural"] } });

  /* (a) the model + stage for a fresh state */
  const m0 = HT.model(st(), E);
  eq("the model equips the slime and the Natural colourway by default", [m0.hero.id, m0.colourway], ["slime", "natural"]);
  eq("...and carries NO gear surface at all (the whole system is gone)",
    ["gear", "gears", "gearOverlays"].filter((k) => k in m0), []);
  eq("the roster carries all three heroes, locked ones included", m0.heroes.map((h) => [h.id, h.unlocked]),
    [["slime", true], ["pebble", false], ["ember", false]]);
  const stage0 = HT.stageHTML(m0);
  truthy("the stage draws the equipped hero's sheet at 4x", /background-image:url\('img\/hero-sheet\.png'\)/.test(stage0) && /background-size:512px 768px/.test(stage0));
  truthy("the stage sits on a floor line", /class="stage-floor"/.test(stage0));

  /* (b) a LOCKED roster tile shows its plain unlock line and is NOT dead UI */
  const tabHTML0 = HT.tabHTML(m0);
  truthy("the roster renders a locked tile for the pebble golem", /data-equip="pebble"[^>]*data-locked="1"/.test(tabHTML0) || /data-locked="1"[^>]*data-equip="pebble"/.test(tabHTML0));
  truthy("the locked tile carries the engine's exact line", /2 weeks at your target — 2 to go/.test(tabHTML0));
  truthy("the locked tile is a REAL <button> (a live control, not dead UI)",
    /<button class="roster-tile locked"[^>]*data-equip="pebble"/.test(tabHTML0));
  truthy("the locked tile renders a SILHOUETTE (the sprite with the .sil ghost filter)",
    /class="tile-sprite sil"/.test(tabHTML0));
  const pebbleTile = tabHTML0.split('data-equip="pebble"')[1].split("</button>")[0] || "";
  truthy("the equipped hero shows an Equipped tag; the locked pebble tile shows its LINE instead",
    /class="roster-tile unlocked on"/.test(tabHTML0) && /Equipped/.test(tabHTML0) && /tile-line/.test(pebbleTile) && !/Equipped/.test(pebbleTile));

  /* (c) equipping switches the model's hero (and therefore the stage + header) */
  const m1 = HT.model(st({ equipped: "pebble", colourway: "natural", unlocked: ["slime", "natural", "pebble"] }), E);
  eq("equipping the pebble golem switches the model's hero", m1.hero.id, "pebble");
  truthy("...so the stage draws the pebble sheet", /hero-pebble\.png/.test(HT.stageHTML(m1)));
  /* a LOCKED id is refused: the model falls back rather than putting it on stage */
  const mLocked = HT.model(st({ equipped: "ember", colourway: "natural", unlocked: ["slime", "natural"] }), E);
  eq("a locked id in the state is refused (falls back to the slime)", mLocked.hero.id, "slime");

  /* (d) the colourway applies its CSS filter to the SAME sheet (zero new art) */
  const m2 = HT.model(st({ equipped: "slime", colourway: "blush", unlocked: ["slime", "natural", "blush"] }), E);
  eq("the colourway is selected", m2.colourway, "blush");
  truthy("...and its filter is applied to the stage sprite inline", /filter:hue-rotate\(-38deg\) saturate\(1\.25\)/.test(HT.stageHTML(m2)));
  const mLockedCw = HT.model(st({ equipped: "slime", colourway: "dusk", unlocked: ["slime", "natural"] }), E);
  eq("a locked colourway is refused too", mLockedCw.colourway, "natural");

  /* (e) NO gear anywhere: a legacy state that still carries the removed `gear`
     field renders a plain stage — no overlay, no gear in the caption. */
  const m3 = HT.model(st({ equipped: "slime", colourway: "natural", gear: ["headband", "belt"], unlocked: ["slime", "natural", "headband"] }), E);
  const stage3 = HT.stageHTML(m3);
  truthy("a legacy gear list leaves NO overlay on the stage and NO gear in the caption",
    !/gear/.test(stage3) && !/Headband|Belt/.test(stage3));
  eq("the stage caption names only the hero and the colourway",
    /Slime/.test(stage3) && /Natural/.test(stage3) && !/Headband/.test(stage3), true);

  /* (f) the unlock moment is detected from the floor */
  const items = E.heroItems(st({ equipped: "slime", colourway: "natural", unlocked: ["slime", "natural", "ember"] }));
  eq("newlyUnlocked reports only ids not already in the floor", HT.newlyUnlocked(items, ["slime", "natural"]), ["ember"]);
  eq("...and reports nothing once every unlocked id is recorded", HT.newlyUnlocked(items, ["slime", "natural", "ember"]), []);
}

console.log("\n=== 56. weak points lead with the FURTHEST-OFF card (bucket, then priority) ===");
{
  /* the owner's question — "can we be sure these are arranged by priority?" — the
     answer was NO. The list was bucketed high/med/low and, INSIDE a bucket, kept
     the fixed generation sequence (lagging muscles -> untrained -> push/pull ->
     quads/hams -> plateaus -> rest timing -> low attributes). The tie was
     invisible AND backwards: his screenshot showed Power 11/100 listed ABOVE
     Mobility 7/100 — both `low`, so the order came from the ATTRIBUTES array
     (STR, END, POW, MOB, CON, VIT), not from the size of the gap.
     Every card now carries a numeric `priority` — how far off it is, on one
     shared 0-100 "gap" scale — and the list is ordered bucket first, then
     priority DESCENDING, with the generation sequence kept only as the final
     tie-break so the order stays deterministic. */
  const e = env();
  const pick = (g) => e.LIB.find((y) => (y.g || []).includes(g));
  const A = pick("Chest"), B = pick("Back"), C = pick("Legs");
  truthy("the library still has Chest, Back and Legs exercises to build the fixture from", !!(A && B && C));
  const sets = () => [{ w: 100, r: 5 }, { w: 100, r: 5 }];
  const ws = [];
  for (let w = 0; w < 5; w++) ws.push({ id: "wp" + w, date: iso(w * 7 + 1), note: "",
    entries: [{ id: A.id, name: "x", mode: A.m, sets: sets() },
              { id: B.id, name: "x", mode: B.m, sets: sets() },
              { id: C.id, name: "x", mode: C.m, sets: sets() }] });
  const st = base({ workouts: ws });
  const wp = e.E.weakPoints(st, 28);

  const rank = { high: 0, med: 1, low: 2 };
  /* THE PROPERTY: reading down the list, (bucket, -priority) never decreases —
     no lower-priority card may sit above a higher-priority one in the same
     bucket. This is an assertion over the returned list, not a snapshot. */
  const monotone = (list) => list.every((w, i) => i === 0
    || rank[list[i - 1].severity] < rank[w.severity]
    || (rank[list[i - 1].severity] === rank[w.severity] && list[i - 1].priority >= w.priority));

  truthy("the fixture really produces a mixed list to order", wp.length >= 4);
  eq("every card carries a finite numeric priority",
    wp.every((w) => typeof w.priority === "number" && isFinite(w.priority)), true);
  eq("the returned list is non-decreasing in (bucket, -priority)", monotone(wp), true);

  /* the checker DISCRIMINATES: swap two same-bucket cards with different
     priorities and it must FAIL. */
  const lowIdx = wp.map((w, i) => [w, i]).filter(([w]) => w.severity === "low");
  const hi = lowIdx[0], lo = lowIdx.find(([w]) => w.priority < lowIdx[0][0].priority);
  truthy("the low bucket holds two cards with different priorities to swap", !!(hi && lo));
  const swapped = wp.slice();
  [swapped[hi[1]], swapped[lo[1]]] = [swapped[lo[1]], swapped[hi[1]]];
  eq("...and it FAILS a lower-priority card swapped above a higher-priority one in the same bucket",
    monotone(swapped), false);

  /* The OLD order (bucket only, generation inside) reconstructed, which must
     VIOLATE the property — that is the defect this task fixes. */
  const attrLabels = e.E.ATTRIBUTES.map((a) => a.label);
  const gen = { volume: 0, gap: 1, balance: 2, stagnant: 3, density: 4, attribute: 5 };
  const genIdx = (w) => w.kind === "attribute"
    ? attrLabels.findIndex((lab) => w.title === `${lab} has room in your log`) : gen[w.kind];
  const oldOrder = wp.slice().sort((a, b) => (rank[a.severity] - rank[b.severity]) || (genIdx(a) - genIdx(b)));
  const titles = (l) => l.map((w) => w.title).sort().join(" | ");
  eq("the OLD bucket-only order violates the property (the test really discriminates)", monotone(oldOrder), false);
  eq("the fix changed the ORDER only — the same cards, with the same copy", titles(oldOrder) === titles(wp), true);
  eq("...and the visible order really did change",
    oldOrder.map((w) => w.title).join(" | ") !== wp.map((w) => w.title).join(" | "), true);

  /* the specific reported flaw, on the attributes */
  const newAttrs = wp.filter((w) => w.kind === "attribute");
  const oldAttrs = oldOrder.filter((w) => w.kind === "attribute");
  truthy("the fixture has at least two low attributes", newAttrs.length >= 2);
  eq("the attributes now lead with the LOWEST score (the biggest gap)",
    newAttrs.map((w) => w.priority), newAttrs.map((w) => w.priority).slice().sort((a, b) => b - a));
  eq("the OLD order listed a bigger attribute gap BELOW a smaller one (his Power-above-Mobility list)",
    oldAttrs.some((w, i) => i > 0 && oldAttrs[i - 1].priority < w.priority), true);
}

console.log("\n=== 57. mobility: honest credit, honest bands, honest copy ===");
{
  const e = env();
  const custom = [
    { id: "mStretch", n: "Hip Flexor Stretch", c: "Legs", g: ["Legs"], p: ["Quads"], s: [], e: [], m: "time" },
    { id: "mToe",     n: "Toe Touch",          c: "Legs", g: ["Legs"], p: ["Hamstrings"], s: [], e: [], m: "time" },
    { id: "mRDL",     n: "Romanian Deadlift",  c: "Legs", g: ["Legs"], p: ["Hamstrings"], s: [], e: [], m: "weight_reps" },
    { id: "mDL",      n: "Deadlifts",          c: "Legs", g: ["Legs"], p: ["Back"], s: [], e: [], m: "weight_reps" },
    { id: "mCC",      n: "Cat-Cow",            c: "Back", g: ["Back"], p: ["Spine"], s: [], e: [], m: "time" },
    { id: "mCrunch",  n: "Incline Crunches",   c: "Abs",  g: ["Core"], p: ["Abs"], s: [], e: [], m: "weight_reps" },
  ];
  const C = (workouts) => base({ custom, workouts });
  const mob = (st) => e.E.attributes(st, 28, 0).MOB;

  /* (a) Toe Touch is a stretch, wrongly excluded before — it must count now */
  truthy("Toe Touch counts as mobility (it is a stretch)", e.E.isMobility("Toe Touch"));
  truthy("...and a Toe Touch set actually moves the score",
    mob(C([wk(iso(1), [{ t: 30 }], "mToe", "Toe Touch", "time")])).score > 0);

  /* (b) loaded end-range hinge credit is STRICTLY less than the stretch rate */
  const stretchMin = mob(C([wk(iso(1), [{ t: 300 }], "mStretch", "Hip Flexor Stretch", "time")])).detail.minPerWk;
  const hingeMin   = mob(C([wk(iso(1), [{ t: 300 }], "mRDL", "Romanian Deadlift", "time")])).detail.minPerWk;
  near("a 300 s stretch scores its real 5 minutes", stretchMin, 5, 0.01);
  truthy("an equal-duration loaded hinge scores LESS than the stretch", hingeMin < stretchMin);
  near("...at one third of the stretch rate", hingeMin, 5 / 3, 0.01);

  /* (c) a conventional deadlift is a mid-range strength pull — NO blanket credit */
  truthy("a conventional deadlift is not mobility", !e.E.isMobility("Deadlifts"));
  truthy("...and is not an end-range hinge either", !e.E.isEndRangeHinge("Deadlifts"));
  eq("...so a deadlift-only session scores zero mobility",
    mob(C([wk(iso(1), [{ w: 100, r: 5 }], "mDL", "Deadlifts")])).score, 0);

  /* (d) the reps x 0.5 inflation is gone: 20 reps is ~1.7 min, not 10 */
  const repMin = mob(C([wk(iso(1), [{ r: 20 }], "mCC", "Cat-Cow", "time")])).detail.minPerWk;
  near("a 20-rep mobility set scores ~1.7 min (5 s/rep), not 10", repMin, 20 * 5 / 60, 0.01);
  truthy("...well under the old ten minutes", repMin < 3);

  /* (e) the bands: a realistic weekly amount is mid-scale, zero stays at the floor */
  const rScore = mob(C([wk(iso(1), [{ t: 1200 }], "mStretch", "Hip Flexor Stretch", "time")])).score; // 20 min/wk
  truthy(`a realistic 20 min/wk reads mid-scale (${rScore})`, rScore >= 45 && rScore <= 60);
  truthy("a stretch that is never done still reads at the floor",
    mob(C([wk(iso(1), [{ w: 20, r: 15 }], "mCrunch", "Incline Crunches")])).score <= 4);
  truthy("a token 2 min/wk still reads low",
    mob(C([wk(iso(1), [{ t: 120 }], "mStretch", "Hip Flexor Stretch", "time")])).score <= 20);

  /* (f) the copy describes the LOG, never the body — and never claims a
         superlative it cannot hold on every card */
  const srcE = fs.readFileSync(path.join(B, "js", "engine.js"), "utf8");
  const srcA = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const srcG = fs.readFileSync(path.join(B, "js", "glossary.js"), "utf8");
  truthy("the old body-claim title is gone", !/is where you can gain the most/.test(srcE + srcA + srcG));
  truthy("the weak-point title now names the log", /has room in your log/.test(srcE));
  const attrCards = e.E.weakPoints(
    C([wk(iso(1), [{ t: 120 }], "mStretch", "Hip Flexor Stretch", "time")]), 28)
    .filter((w) => w.kind === "attribute");
  truthy("...and it renders on a real card",
    attrCards.length >= 1 && attrCards.every((w) => /has room in your log$/.test(w.title)));
  /* SEVERAL low attributes: the card is emitted for EACH, so a superlative in
     the title is false on all but one ("the most room" cannot be true of four
     attributes). Every title/detail must claim only what its OWN score supports. */
  const multi = e.E.weakPoints(
    C([wk(iso(1), [{ w: 40, r: 8 }], 9, "2 Handed Kettlebell Swing", "weight_reps")]), 28)
    .filter((w) => w.kind === "attribute");
  truthy(`several low attributes each get their own card (${multi.length})`, multi.length >= 2);
  eq("no attribute card claims a superlative ('the most' / 'the thinnest')",
    multi.filter((w) => /the most|the thinnest|the least/i.test(w.title + " " + w.detail)), []);
  eq("no attribute card claims a fact about the BODY",
    multi.filter((w) => /you can gain|your body|you are |you're /i.test(w.title + " " + w.detail)), []);
  truthy("the mobility detail line explains the loaded-end-range rule",
    /Romanian deadlift held at the bottom/.test(srcA));

  /* (g) every badge desc states the SAME window and scope its `test` reads —
         a desc that says "in a week" while the test reads a 28-day window is a
         claim the number beside it does not support. */
  const ACH = e.E.achievements(base({ workouts: [wk(iso(1), [{ w: 60, r: 8 }])] }));
  const descOf = (id) => ((ACH.find((a) => a.id === id) || {}).desc || "");
  truthy("Well-Rounded's window matches its 28-day test (4 weeks, not a week)",
    /4 weeks/.test(descOf("variety")) && !/in a week/.test(descOf("variety")));
  truthy("Balanced no longer claims EVERY group (its test needs 5+ groups)",
    !/every muscle group/i.test(descOf("balanced")) && /5\+/.test(descOf("balanced")));
  truthy("Head to Toe's window is the same 4 weeks", /in 4 weeks/.test(descOf("everygroup")));
}

console.log("\n=== 58. library audit: every exercise feeds the RIGHT data ===");
{
  const e = env();
  const L = e.LIB;
  const lib = (id) => L.find((x) => x.id === id);
  const mobOf = (st) => e.E.mobilityScore(st, e.E.windowWorkouts(st, 28, 0));

  /* (a) FALSE POSITIVES — a word in the name no longer drags a movement into the
         mobility axis: grip/wrist strength, isometric strength holds, a curl or a
         row whose name mentions its rotation, side-lying and scapular strength, and
         a swim drill that holds the pool WALL. */
  const noLongerMob = [
    "Barbell Wrist Curl", "Barbell Reverse Wrist Curl", "Cable Wrist Pronation",
    "DB Wrist Extension", "FlexBar Wrist Flexion", "Kettlebell Wrist Turnover",
    "Wrist Roller", "Wrist curl, dumbbells",
    "Isometric Wrist Curl Hold", "Isometric Wrist Rising Hold",
    "Fat Grip Dumbbell Hold", "Plate Pinch Hold", "Isometric Dumbbell Pronation Hold",
    "Axe Hold", "Chin-up Isometric Hold", "Pull-Up Top Position Hold",
    "Pull-up Isometric Hold", "Incline Static Hold", "Ring Support Hold",
    "Parallel Bar Hold", "Planche Lean Hold",
    "Preacher Curl - Externally Rotated", "Preacher Curl - Internally Rotated",
    "Cable Tri Extension - Internal Rotation",
    "Bent over row to external rotation", "Single-Arm Cable Row with Rotation (Floor)",
    "Band pull-apart with external rotation",
    "Side Lying Hip Abduction", "Banded Scapular Retraction",
    "Scapular Pushups", "Wall-Hold Rotation",
  ];
  for (const n of noLongerMob) eq(`"${n}" is not mobility`, e.E.isMobility(n), false);

  /* the genuine range work these names sit next to must STAY in */
  for (const n of ["Wrist Stretch", "Wrist circles", "Wrist rocks", "Plank", "Side Plank",
                   "Turkish Get-Up", "Cat-Cow", "Hollow Hold", "Supported Deep Squat Hold",
                   "Shoulder dislocates", "Clamshell", "Reverse Clamshell"])
    truthy(`"${n}" is still mobility`, e.E.isMobility(n));

  /* (b) FALSE NEGATIVES — genuine range drills a name-regex missed now fire */
  for (const n of ["Sit & Reach", "Child's pose", "Happy Baby", "seated figure four",
                   "Fire Hydrant Circles", "Clockwise neck circles", "Neck half circles",
                   "Adductor Rock Backs", "Scorpion Kick", "Roll Down", "Wall Slides", "Toe Touch"])
    truthy(`"${n}" now counts as mobility`, e.E.isMobility(n));

  /* (c) MODE decides ROUTING. Under the old weight_reps mode a reps-only log on a
         bodyweight movement was an INVALID set and vanished; the corrected mode
         makes the very same set count and reach the muscle-volume path. */
  eq("a reps-only set on a bodyweight movement is DROPPED under weight_reps mode",
     e.E.entryStats({ mode: "weight_reps", name: "Ankle Roll", sets: [{ r: 10 }] }).sets, 0);
  eq("...the library now stores Ankle Roll as reps", lib(1864).m, "reps");
  eq("...so the same set now counts", e.E.entryStats({ mode: "reps", name: "Ankle Roll", sets: [{ r: 10 }] }).sets, 1);
  const legState = base({ workouts: [wk(iso(1), [{ r: 10 }], 1864, "Ankle Roll", "reps")] });
  truthy("...and reaches the Legs volume path", e.E.muscleGroups(legState, 28).Legs.setsPerWk > 0);
  eq("Toe Touch is stored as a held stretch (time)", lib(1390).m, "time");
  const toe = base({ workouts: [wk(iso(1), [{ t: 60 }], 1390, "Toe Touch", "time")] });
  near("a 60 s Toe Touch log scores one real minute of mobility", mobOf(toe).minPerWk, 1, 0.01);

  /* (d) RATES pinned: a mobility rep is 5 s (the old 0.5 gave 30 s/rep), the loaded
         end-range hinge earns one third of the stretch rate. */
  const cc = base({ workouts: [wk(iso(1), [{ r: 20 }], 1938, "Cat-Cow", "reps")] });
  near("a 20-rep mobility set scores ~1.67 min (5 s/rep, not ten)", mobOf(cc).minPerWk, 20 * 5 / 60, 0.02);
  const stretch = base({ workouts: [wk(iso(1), [{ t: 300 }], 1867, "Hip Flexor Stretch", "time")] });
  const hinge = base({ workouts: [wk(iso(1), [{ t: 300 }], 507, "Romanian Deadlift", "time")] });
  near("a 300 s stretch scores its full 5 minutes", mobOf(stretch).minPerWk, 5, 0.02);
  near("...an equal-duration loaded hinge earns exactly one third", mobOf(hinge).minPerWk, 5 / 3, 0.02);

  /* (e) POWER — an olympic lift is scored once, through its own standard, and NOT
         again as plyometric reps; and a wood chop is not read as a jump. */
  const clean = base({ workouts: [wk(iso(1), [{ w: 100, r: 3 }], 683, "Power Clean", "weight_reps"),
                                 wk(iso(2), [{ w: 100, r: 3 }], 683, "Power Clean", "weight_reps")] });
  const cp = e.E.powerScore(clean, e.E.windowWorkouts(clean, 28, 0));
  eq("a power clean's reps are not double-counted as plyometric work", cp.plyoReps, 0);
  truthy("...but the clean still sets the olympic signal", cp.olympic > 0);
  const jumps = base({ workouts: [wk(iso(1), [{ r: 10 }], 614, "Squat Jumps", "reps"),
                                 wk(iso(2), [{ r: 10 }], 614, "Squat Jumps", "reps"),
                                 wk(iso(3), [{ r: 10 }], 614, "Squat Jumps", "reps")] });
  eq("a genuine plyometric movement still counts its reps", e.E.powerScore(jumps, e.E.windowWorkouts(jumps, 28, 0)).plyoReps, 30);
  const chop = base({ workouts: [wk(iso(1), [{ w: 20, r: 12 }], 145, "Cable Woodchoppers", "weight_reps")] });
  eq("a wood chop is not read as a jump (`hop` is word-bounded now)",
     e.E.powerScore(chop, e.E.windowWorkouts(chop, 28, 0)).plyoReps, 0);

  /* (e2) THE HEAVY-SET REP THRESHOLD (v1.3.10): "heavy low-rep" is now UNDER 5
         reps, so a 4-rep set counts and a 5-rep set does not. NEW assertion:
         the pre-change suite pinned NO rep threshold here — (e) above covers
         only the olympic double-count and the plyo matcher, and no other test
         reads `heavySets`, so there was no 3-rep assertion to reproduce. This
         pins the boundary itself, exclusive at 5. */
  const heavySetsFor = (r) => { const st = base({ workouts: [wk(iso(1), [{ w: 100, r }])] });
    return e.E.powerScore(st, e.E.windowWorkouts(st, 28, 0)).heavySets; };
  eq("a 4-rep set at a real load counts as heavy low-rep (under 5)", heavySetsFor(4), 1);
  eq("a 5-rep set does NOT count (the threshold is exclusive at 5)", heavySetsFor(5), 0);

  /* (f) MUSCLE MAPPING — a group a movement plainly trains, which was absent. */
  truthy("Thruster trains the Legs (the group was missing)", lib(650).g.includes("Legs"));
  eq("Quadruped Hip Abduction maps to the Legs, not the Calves", lib(1915).g.join("|"), "Legs");
  eq("Plantarflexion Stretch maps to the Calves, not the Legs", lib(1275).g.join("|"), "Calves");
}

console.log("\n=== 59. badges pay XP into the TOTAL — back-paid in full, and nothing can reduce it ===");
{
  /* the owner (2026-11-10): "a pr, or a badge should earn you extra XP" and "make
     sure that if you already have the badge unlocked when the update comes in,
     that you get all that xp that was missed out on". The term lives in the
     TOTAL (xp()), paid by tier, so a badge held BEFORE the term existed pays in
     full on the next xp() call — a per-session term could not do that. The
     amounts are the app's own constants: a major badge == a PR, a minor == a
     logged session. */
  const e = env();
  eq("BADGE_XP.major is a PR (100)", e.E.BADGE_XP.major, e.E.XP.PR);
  eq("BADGE_XP.minor is a session (50)", e.E.BADGE_XP.minor, e.E.XP.SESSION);
  eq("...so the amounts are 100 / 50", [e.E.BADGE_XP.major, e.E.BADGE_XP.minor], [100, 50]);

  /* THE BACK-PAYMENT, BY CONSTRUCTION: a badge already held pays with NO session
     behind it — nothing about the update date is consulted. */
  const bare = base({ achievements: { first: "2020-01-01" } });
  eq("a badge held with no session still pays in full", e.E.xp(bare), e.E.XP.PR);
  eq("badgeXp reads the stored achievements map", e.E.badgeXp(bare), 100);

  /* (a) UNLOCKING a badge can only ADD to the total. */
  const start = base({ workouts: [wk(iso(1), [{ w: 100, r: 8 }])] });
  const xp0 = e.E.xp(start);
  const one = base({ workouts: start.workouts, achievements: { first: "2020-01-01" } });
  const xp1 = e.E.xp(one);
  eq("a major badge adds exactly XP.PR to the TOTAL", xp1 - xp0, 100);
  const two = base({ workouts: start.workouts, achievements: { first: "2020-01-01", t10k: "2020-01-01" } });
  const xp2 = e.E.xp(two);
  eq("a second (minor) badge adds exactly XP.SESSION", xp2 - xp1, 50);

  /* (b) LOGGING a further session cannot LOWER a total that holds badges. */
  const more = base({ workouts: start.workouts.concat([wk(iso(2), [{ w: 90, r: 8 }])]),
                      achievements: two.achievements });
  truthy("logging another session never lowers a total holding badges", e.E.xp(more) >= xp2);

  /* (c) The property across EVERY badge, one at a time: the total is
     NON-DECREASING. A badge lives in a stored map, which only ever GAINS keys —
     it can never un-unlock — so the term is monotone by construction. */
  const acc = {};
  let prev = e.E.xp(base({ achievements: {} }));
  let steps = 0, drops = 0;
  for (const a of e.E.ACHIEVEMENTS) {
    acc[a.id] = "2020-01-01";
    const t = e.E.xp(base({ achievements: Object.assign({}, acc) }));
    steps++;
    if (!(t >= prev)) { drops++; console.log(`  FAIL total dropped unlocking ${a.id}: ${prev} -> ${t}`); }
    prev = t;
  }
  eq("the total NEVER falls as badges are unlocked", drops, 0);
  truthy("...checked every badge in the table", steps === e.E.ACHIEVEMENTS.length);
  eq("every badge unlocked pays its own tier in full",
     prev, e.E.ACHIEVEMENTS.reduce((n, a) => n + e.E.BADGE_XP[a.tier], 0));

  /* (d) It is shown as its OWN additive line in the XP breakdown, and the
     one-time note is armed on a CONTENT revision — never the app version, which
     would re-show it on every release. */
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the XP breakdown renders a badge line", appSrc.includes("badgeXpRows()"));
  truthy("...labelled as paid into the TOTAL, not the session", /Badge XP is paid into your TOTAL/.test(appSrc));
  truthy("the one-time note is armed on BADGE_NOTE_REV", /badgeXpNote !== BADGE_NOTE_REV/.test(appSrc));
  truthy("...and BADGE_NOTE_REV is a content revision, not the app version",
     /const BADGE_NOTE_REV = \d+;/.test(appSrc) && !/badgeXpNote !== APP_?VERSION/.test(appSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
