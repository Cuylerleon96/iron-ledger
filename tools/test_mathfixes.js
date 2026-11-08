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
  return { E: s.__X.Engine, S: s.__X.Store };
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
  eq("over MRV is flagged", over.status, "over MRV");
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
  const sets = Array.from({ length: 20 }, () => ({ w: 20, r: 15 }));
  const flat = e.E.muscleGroups(base({ custom, workouts: [wk(iso(1), sets, "x2")] }), 28).Core;
  const inc = e.E.muscleGroups(base({ custom, workouts: [wk(iso(1), sets, "x1")] }), 28).Core;
  console.log(`     20 identical sets -> flat crunch score ${flat.score}, incline crunch score ${inc.score}`);
  truthy("the same work scores higher when it is harder work", inc.score > flat.score);
  // one session in the log means a one-week history, so 20 sets reads as 20/wk —
  // previously it was divided by four weeks the user had not existed for
  eq("raw sets/wk is scaled to the available weeks", [flat.setsPerWk, inc.setsPerWk], [20, 20]);
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
  truthy("6 -> 10 reps reads as progress", cmp && cmp.better && cmp.est1RM.pct > 0);
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
  truthy("the UI explains the missing bodyweight", /Strength is a ratio[^"]*Add your bodyweight/.test(appSrc));
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
  // and an empty account must not crash or claim anything
  eq("an empty account still returns a full window", Object.keys(e.E.dayMap(mk([]), 371)).length, 371);
  eq("...with nothing trained", Object.values(e.E.dayMap(mk([]), 371)).filter((d) => d.sessions > 0).length, 0);

  // the card must report the real span, not a fixed year
  const appSrc = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("the label uses the actual span", /of the last \$\{span\} \$\{pl\(span, "day"\)\}/.test(appSrc));
  truthy("...and says so when it is short", /since you started/.test(appSrc));
  eq("the hardcoded 371-day label is gone", /of the last 371 days/.test(appSrc), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
