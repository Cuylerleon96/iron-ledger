/* Math audit, round 2 — probe before fixing. Nothing is reported as a bug unless
   this file demonstrates it with real values. Run: node tools/audit_math2.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const SRC = ["js/data.js", "js/engine.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
function env() {
  const store = {};
  const s = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
    Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
    setTimeout, clearTimeout, module: { exports: {} },
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  s.globalThis = s; vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "b.js" });
  return { E: s.__X.Engine, S: s.__X.Store };
}
const iso = (o) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - o); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const base = (o = {}) => Object.assign({ version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "C", sex: "M", heightCm: 178, weightKg: 80, bodyFatPct: 15, weeklyTarget: 3, units: "kg" },
  workouts: [], bodylog: [], overrides: {}, custom: [], achievements: {}, targets: {}, settings: { seeded: true } }, o);
const wk = (date, sets, id = 73, name = "Barbell Bench Press", mode = "weight_reps") =>
  ({ id: "w" + date + id, date, note: "", entries: [{ id, name, mode, sets }] });
const LB = 2.2046226;

let bad = 0;
function eqcheck(label, ok) { console.log(`     ${ok ? "OK  " : ">>> "}${label}${ok ? "" : "  <-- BUG"}`); if (!ok) bad++; }
console.log("\n########## ROUND 2 PROBES ##########\n");

/* ---------------------------------------------------------------- 1 */
console.log("[1] The 'estimated' Strength score uses ONE arbitrary lift against the BENCH standard");
{
  const e = env();
  // a pure leg-press and calf-raise athlete: no pressing anywhere
  const legOnly = base({ workouts: [wk(iso(1), [{ w: 200, r: 10 }], 375, "Leg Press on Hackenschmidt Machine"),
                                    wk(iso(3), [{ w: 200, r: 10 }], 375, "Leg Press on Hackenschmidt Machine"),
                                    wk(iso(5), [{ w: 200, r: 10 }], 375, "Leg Press on Hackenschmidt Machine")] });
  const s1 = e.E.attributes(legOnly, 28, 0).STR;
  console.log(`     only leg press 200kg x 10  -> Strength ${s1.score} (${s1.tier}), basis=${s1.detail.basis}, from="${s1.detail.from}"`);

  // same man, but with a big BARBELL bench too
  const withBench = base({ workouts: [wk(iso(1), [{ w: 200, r: 10 }], 375, "Leg Press on Hackenschmidt Machine"),
                                      wk(iso(2), [{ w: 100, r: 5 }], 73, "Barbell Bench Press"),
                                      wk(iso(4), [{ w: 100, r: 5 }], 73, "Barbell Bench Press")] });
  const s2 = e.E.attributes(withBench, 28, 0).STR;
  console.log(`     + a 100kg barbell bench     -> Strength ${s2.score} (${s2.tier}), basis=${s2.detail.basis}, lifts=${JSON.stringify(Object.keys(s2.detail.lifts || {}))}`);
  if (s1.detail.basis === "estimated") {
    const med = s1.detail.from;
    console.log(`     ^ a leg press is being scored against the BENCH PRESS ratio table, so "${med}" decides the headline Strength number`);
  }
}

/* ---------------------------------------------------------------- 2 */
console.log("\n[2] deloadCheck filters out weeks with no sessions, so 'last 3 weeks' can span months");
{
  const e = env();
  // 3 heavy weeks last year, one session this week: the 'recent' 3 weeks are ancient
  const w = [];
  for (let i = 0; i < 3; i++) w.push(wk(iso(300 + i * 7), [{ w: 100, r: 5, rpe: 7 }]));
  w.push(wk(iso(2), [{ w: 100, r: 5, rpe: 9.5 }]));
  const st = base({ workouts: w });
  const v = e.E.volumeWeeks(st, 9);
  console.log(`     9 calendar weeks back: sessions per week = ${v.map((x) => x.sessions).join(" ")}`);
  const d = e.E.deloadCheck(st);
  console.log(`     deloadCheck -> suggest=${d.suggest} weeksUsed=${d.weeks} why="${d.why}"`);
  const kept = v.filter((x) => x.sessions > 0);
  console.log(`     it keeps ${kept.length} non-empty weeks of the 9 and calls the last 3 "recent"`);
}

/* ---------------------------------------------------------------- 3 */
console.log("\n[3] The same exercise twice in one session");
{
  const e = env();
  const two = base({ workouts: [{ id: "dup", date: iso(1), note: "", entries: [
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] },
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 10 }] },
  ] }] });
  const ser = e.E.seriesFor(two, 73);
  console.log(`     two entries, same exercise, same day -> series points: ${ser.length} (both dated ${ser.map((p) => p.date).join(", ")})`);
  const b = e.E.bestFor(two, 73);
  console.log(`     bestFor est1RM=${Math.round(b.est1RM * 10) / 10} date=${b.date}`);
  const after = base({ workouts: [{ id: "dup", date: iso(1), note: "", entries: [
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] },
    { id: 73, name: "Barbell Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 10 }] },
  ] }, wk(iso(0), [{ w: 100, r: 5 }])] });
  const cmp = e.E.compareLast(after, 73);
  if (cmp) console.log(`     compareLast compares ${cmp.prevDate} vs ${cmp.date} — it can compare a session to ITSELF`);
  eqcheck("no two series points share a date", new Set(ser.map((p) => p.date)).size === ser.length);
}

/* ---------------------------------------------------------------- 4 */
console.log("\n[4] A body-fat-only check-in");
{
  const e = env();
  const st = base({ profile: Object.assign({}, base().profile, { weightKg: 80 }),
    bodylog: [{ date: iso(30), weightKg: 80, bodyFatPct: 16 }, { date: iso(1), bodyFatPct: 14 }] });
  const bw = e.E.bodyweight(st);
  console.log(`     log: 30 days ago 80kg/16%, yesterday fat-only 14%`);
  console.log(`     bodyweight() returns ${bw} kg  (the profile says 80)`);
  eqcheck("a fat-only check-in does not zero the bodyweight", bw > 0);
  const s = e.E.attributes(st, 28, 0).STR;
  console.log(`     -> Strength basis=${s.detail.basis} bwUsed=${s.detail.bw}`);
}

/* ---------------------------------------------------------------- 5 */
console.log("\n[5] Do cardio sets count as strength volume tolerance?");
{
  const e = env();
  const custom = [{ id: "r1", n: "Running", c: "Cardio", g: ["Cardio"], p: [], s: [], e: [], m: "distance_time" }];
  const st = base({ custom, workouts: [wk(iso(1), [{ d: 5000, t: 1500 }, { d: 5000, t: 1500 }, { d: 5000, t: 1500 }], "r1", "Running", "distance_time")] });
  const s = e.E.staminaScore(st, e.E.windowWorkouts(st, 28, 0));
  console.log(`     1 run logged as 3 intervals -> setsPerWk counted as ${s.setsPerWk} (they are cardio intervals, not working sets)`);
}

/* ---------------------------------------------------------------- 6 */
console.log("\n[6] Is an olympic lift counted twice in Power?");
{
  const e = env();
  const st = base({ workouts: [wk(iso(1), [{ w: 100, r: 3 }], 7001, "Power Clean"), wk(iso(2), [{ w: 100, r: 3 }], 7001, "Power Clean")] });
  const p = e.E.attributes(st, 28, 0).POW;
  console.log(`     2 sessions of 3x power clean -> Power ${p.score}; plyoReps=${p.detail.plyoReps} (counted as plyometric work) heavySets=${p.detail.heavySets} olympic=${p.detail.olympic}`);
  console.log(`     ^ a clean is already scored via the olympic-standard path, so the plyo count is the same work a second time`);
}

/* ---------------------------------------------------------------- 7 */
console.log("\n[7] quietZero: is a zero-scoring attribute ever flagged?");
{
  const e = env();
  const st = base({ workouts: [wk(iso(1), [{ w: 100, r: 10 }])] });
  const a = e.E.attributes(st, 28, 0);
  const wp = e.E.weakPoints(st, 28).filter((x) => x.kind === "attribute");
  console.log(`     Mobility scores ${a.MOB.score} (no mobility work at all) and is flagged: ${wp.some((x) => /Mobility/.test(x.title))}`);
  console.log(`     flagged attributes: ${wp.map((x) => x.title.replace(/ has the most room in your log/, "")).join(", ") || "(none)"}`);
}

console.log(`\n${bad} demonstrated bug(s) in this batch.`);
