/* Math audit — hunts for wrong NUMBERS, not crashes. Each finding has to be
   demonstrated with real values before it counts; a suspicion printed without
   evidence is just noise. Run: node tools/audit_math.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const SRC = ["js/data.js", "js/engine.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");

function env() {
  const store = {};
  const s = {
    console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
    Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
    setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} }, window: {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    module: { exports: {} },
  };
  s.globalThis = s; vm.createContext(s);
  vm.runInContext(SRC + "\n;globalThis.__X={Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { E: s.__X.Engine, S: s.__X.Store, LIB: s.__X.EXERCISE_LIB };
}

const iso = (off) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mkState = (over = {}) => Object.assign({
  version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "C", sex: "M", heightCm: 180, weightKg: 82, bodyFatPct: 18, weeklyTarget: 3, units: "kg" },
  workouts: [], bodylog: [], overrides: {}, custom: [], achievements: {}, targets: {}, settings: { seeded: true },
}, over);
const wk = (date, sets, id = 73, name = "Bench Press", mode = "weight_reps") =>
  ({ id: "w" + date + id, date, note: "", entries: [{ id, name, mode, sets }] });

let findings = [];
const finding = (n, title, evidence) => { findings.push({ n, title, evidence }); };
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`     ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  return ok;
};

console.log("\n############ MATH AUDIT ############\n");

/* ---------------------------------------------------------------- 1 */
console.log("[1] Do adjacent time windows overlap? (volumeWeeks, attributes cur/prev)");
{
  const e = env();
  // one session exactly 7 days ago, one today
  const st = mkState({ workouts: [wk(iso(0), [{ w: 100, r: 10 }]), wk(iso(7), [{ w: 100, r: 10 }])] });
  const v = e.E.volumeWeeks(st, 3);
  const w0 = v[v.length - 1], w1 = v[v.length - 2];
  console.log(`     session dates: today(${iso(0)}) and exactly 7 days ago(${iso(7)})`);
  console.log(`     week ending today      : sessions=${w0.sessions} sets=${w0.sets}`);
  console.log(`     week before that       : sessions=${w1.sessions} sets=${w1.sets}`);
  const total = v.reduce((a, x) => a + x.sessions, 0);
  console.log(`     sessions counted across 3 weeks: ${total}  (only 2 were logged)`);
  if (total > 2) finding(1, "A session exactly N days ago is counted in TWO adjacent windows",
    `2 sessions logged, ${total} counted across the weeks — every window boundary double-counts`);
  else check("no overlap", total, 2);

  // cur/prev overlap in `attributes`
  const two = mkState({ workouts: [wk(iso(0), [{ w: 100, r: 10 }]), wk(iso(28), [{ w: 100, r: 10 }])] });
  const a = e.E.attributes(two, 28, 0);
  console.log(`     attributes(): CON sessions in window = ${a.CON.detail.sessions} (a session sits exactly on the 28-day boundary)`);
}

/* ---------------------------------------------------------------- 2 */
console.log("\n[2] Does attributeHistory produce evenly spaced months?");
{
  const e = env();
  const hist = e.E.attributeHistory(mkState(), 12);
  const gaps = [];
  for (let i = 1; i < hist.length; i++) {
    gaps.push(Math.round((new Date(hist[i].date + "T12:00:00") - new Date(hist[i - 1].date + "T12:00:00")) / 86400000));
  }
  console.log(`     months: ${hist.map((h) => h.date).join(" ")}`);
  console.log(`     day-gaps: ${gaps.join(" ")}`);
  const odd = gaps.filter((g) => g < 27 || g > 32).length;
  const dup = new Set(hist.map((h) => h.date)).size !== hist.length;
  if (odd || dup) finding(2, "History months drift / repeat (setMonth overflows)",
    `${odd} gap(s) outside 27-32 days${dup ? " and duplicate month labels" : ""} — caused by setMonth on the 29th-31st`);
  else check("gaps are month-like", odd, 0);
}

/* ---------------------------------------------------------------- 3 */
console.log("\n[3] Do non-weight modes have a usable trend value? (reps / time)");
{
  const e = env();
  const repsState = mkState({ workouts: [wk(iso(21), [{ r: 10 }], 9001, "Push Up", "reps"), wk(iso(14), [{ r: 12 }], 9001, "Push Up", "reps"), wk(iso(7), [{ r: 14 }], 9001, "Push Up", "reps"), wk(iso(0), [{ r: 16 }], 9001, "Push Up", "reps")] });
  const ser = e.E.seriesFor(repsState, 9001);
  console.log(`     Push Up (reps mode) series: ${ser.map((p) => `top=${p.top} reps=${p.reps}`).join(" | ")}`);
  const b = e.E.bestFor(repsState, 9001);
  console.log(`     bestFor -> best=${b.best} est1RM=${b.est1RM} reps=${b.reps}`);
  const tp = e.E.targetProgress(Object.assign({}, repsState, { targets: { 9001: { value: 25 } } }), 9001);
  console.log(`     target reps=25 -> current=${tp.current} pct=${Math.round(tp.pct)}% eta=${tp.eta} basis="${tp.basis}"`);
  if (b.best === 0) finding(3, "For reps/time/distance modes the 'top' metric is always 0",
    `entryStats computes best as (w || t) for non-weight modes, so a bodyweight push-up has no best value: no trend, no ETA, and plateaus are never detected for those exercises (target still shows ${Math.round(tp.pct)}% but basis="${tp.basis}" forever)`);
  else check("top is populated", b.best > 0, true);

  const timeState = mkState({ workouts: [wk(iso(14), [{ t: 60 }], 9002, "Plank", "time"), wk(iso(0), [{ t: 90 }], 9002, "Plank", "time")] });
  const tb = e.E.bestFor(timeState, 9002);
  console.log(`     Plank (time mode) bestFor -> best=${tb.best} time=${tb.time}`);
}

/* ---------------------------------------------------------------- 4 */
console.log("\n[4] Can XP / level go DOWN?");
{
  const e = env();
  const base = [wk(iso(1), [{ w: 100, r: 10 }]), wk(iso(2), [{ w: 100, r: 10 }]), wk(iso(3), [{ w: 100, r: 10 }]), wk(iso(4), [{ w: 100, r: 10 }])];
  const withStreak = mkState({ workouts: base });
  const xpA = e.E.xp(withStreak);
  const lvlA = e.E.levelInfo(xpA);
  // same training, but the newest sessions are older than the streak window
  const broken = mkState({ workouts: [wk(iso(10), [{ w: 100, r: 10 }]), wk(iso(11), [{ w: 100, r: 10 }]), wk(iso(12), [{ w: 100, r: 10 }]), wk(iso(13), [{ w: 100, r: 10 }])] });
  const xpB = e.E.xp(broken);
  const lvlB = e.E.levelInfo(xpB);
  console.log(`     4 sessions in the last 4 days  -> XP ${xpA}  level ${lvlA.level}  (streak ${e.E.streaks(withStreak).days}d)`);
  console.log(`     the SAME 4 sessions, 10 days ago -> XP ${xpB}  level ${lvlB.level}  (streak ${e.E.streaks(broken).days}d)`);
  const delta = xpA - xpB;
  if (delta !== 0) finding(4, "XP is not monotonic — breaking a streak REMOVES XP, so a level can drop",
    `identical training, ${delta} XP apart purely by calendar position (the streak bonus is recomputed each time, not banked)`);
  else check("xp stable", delta, 0);
}

/* ---------------------------------------------------------------- 5 */
console.log("\n[5] Does one improvement count as several PRs?");
{
  const e = env();
  // session 2 is simply one extra set: more reps, more volume, more tonnage at once
  const st = mkState({ workouts: [wk(iso(7), [{ w: 100, r: 10 }]), wk(iso(0), [{ w: 100, r: 10 }, { w: 100, r: 10 }])] });
  const rows = e.E.prTable(st);
  const r = rows[0];
  console.log(`     session 1: 1 set of 100x10`);
  console.log(`     session 2: 2 sets of 100x10  (one extra set, same load and reps)`);
  console.log(`     PR events recorded: ${JSON.stringify(r.prs)}`);
  console.log(`     prCount(28) = ${e.E.prCount(st, 28)}`);
  if (r.prs.length && r.prs[0].hit.length > 1)
    finding(5, "One training improvement is counted as multiple PRs",
      `adding a single set fired ${r.prs[0].hit.length} 'PRs' at once (${r.prs[0].hit.join(", ")}) because reps/volume/tonnage all rise together — the HUD 'PRs this month' and the XP bonus inherit that inflation`);
  else check("one PR", r.prs[0].hit.length, 1);
}

/* ---------------------------------------------------------------- 6 */
console.log("\n[6] Does 'over MRV' score WORSE than 'optimal'? (it should)");
{
  const e = env();
  // 3 sessions/wk of 8 chest sets each = 24 sets/wk: above chest MRV (22)
  const sets = Array.from({ length: 8 }, () => ({ w: 100, r: 10 }));
  const st = mkState({ workouts: [wk(iso(1), sets), wk(iso(3), sets), wk(iso(5), sets)] });
  const mg = e.E.muscleGroups(st, 28);
  const c = mg.Chest;
  console.log(`     Chest: ${c.setsPerWk} sets/wk  status="${c.status}"  score=${c.score}  (landmarks mev ${c.landmarks.mev} mav ${c.landmarks.mav} mrv ${c.landmarks.mrv})`);
  // and a session at the sweet spot for comparison
  const optimal = mkState({ workouts: [wk(iso(1), Array.from({ length: 5 }, () => ({ w: 100, r: 10 }))), wk(iso(4), Array.from({ length: 5 }, () => ({ w: 100, r: 10 })))] });
  const oc = e.E.muscleGroups(optimal, 28).Chest;
  console.log(`     at MAV for comparison: ${oc.setsPerWk} sets/wk status="${oc.status}" score=${oc.score}`);
  if (c.status === "over MRV" && c.score >= oc.score)
    finding(6, "Muscle score keeps RISING past MRV, so 'over MRV' reads as better than 'optimal'",
      `Chest ${c.setsPerWk}/wk is flagged "over MRV" yet scores ${c.score}, vs ${oc.score} at the sweet spot — the flag and the number disagree`);
  else check("over MRV scores lower", c.score < oc.score, true);
}

/* ---------------------------------------------------------------- 7 */
console.log("\n[7] Is tonnage meaningful for weight x time / weight x distance sets?");
{
  const e = env();
  const st = e.E.entryStats({ mode: "weight_time", sets: [{ w: 20, t: 45 }, { w: 20, t: 45 }] });
  console.log(`     weight_time: 2 sets of 20kg x 45s -> tonnage=${st.tonnage} volume=${st.volume} reps=${st.reps}`);
  console.log(`     (2 x 20kg x 1 "rep" = ${st.tonnage}, i.e. the seconds are silently replaced by 1)`);
  const st2 = e.E.entryStats({ mode: "weight_distance", sets: [{ w: 24, d: 40 }] });
  console.log(`     weight_distance: 1 set of 24kg x 40m -> tonnage=${st2.tonnage}`);
  if (st.tonnage === 40) finding(7, "Tonnage invents a rep count for weight x time and weight x distance",
    `20kg x 45s scores 20 'kg of tonnage' via Math.max(1, reps) with reps undefined — a made-up number feeding totals, XP and badges`);
  else check("tonnage", st.tonnage, 0);
}

/* ---------------------------------------------------------------- 8 */
console.log("\n[8] Does the fatigue/deload signal view the right weeks?");
{
  const e = env();
  // same volume every week, but RPE climbing: the classic fatigue shape
  const st = mkState({ workouts: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => wk(iso(i * 7), [{ w: 100, r: 10, rpe: i >= 6 ? 9 : 7.5 }])) });
  const v = e.E.volumeWeeks(st, 9);
  console.log(`     sets per week (oldest->newest): ${v.map((x) => x.sets).join(" ")}`);
  const d = e.E.deloadCheck(st);
  console.log(`     deloadCheck -> suggest=${d.suggest}  why="${d.why}"`);
}

/* ---------------------------------------------------------------- 9 */
console.log("\n[9] est1RM cap: do 12 and 20 reps at the same load look identical?");
{
  const e = env();
  const a = e.E.est1RM(100, 12), b = e.E.est1RM(100, 20), c = e.E.est1RM(100, 5);
  console.log(`     est1RM(100kg, 12 reps) = ${a}`);
  console.log(`     est1RM(100kg, 20 reps) = ${b}   <- same as 12 reps`);
  console.log(`     est1RM(100kg,  5 reps) = ${c}`);
  const s1 = mkState({ workouts: [wk(iso(7), [{ w: 100, r: 12 }]), wk(iso(0), [{ w: 100, r: 20 }])] });
  const cmp = e.E.compareLast(s1, 73);
  console.log(`     100x12 -> 100x20 reads as: e1RM ${((cmp.est1RM.pct)).toFixed(1)}% (${cmp.est1RM.cur} vs ${cmp.est1RM.prev}), better=${cmp.est1RM.pct > 0}`);
  if (a === b) finding(9, "Past 12 reps the e1RM is flat, so real progress reads as none",
    `100kg x 12 and 100kg x 20 both estimate ${a} — going from 12 to 20 reps at the same load shows as 0% and 'not better'. The cap is defensible; showing it as unchanged progress is not`);
  else check("distinct", a !== b, true);
}

/* ---------------------------------------------------------------- 10 */
console.log("\n[10] dayMap: sessions vs sets on the same date");
{
  const e = env();
  const st = mkState({ workouts: [wk(iso(1), [{ w: 100, r: 10 }]), Object.assign(wk(iso(1), [{ w: 100, r: 10 }]), { id: "second" })] });
  const dm = e.E.dayMap(st, 10);
  const cell = dm[iso(1)];
  console.log(`     two workouts on ${iso(1)} -> cell.sessions=${cell.sessions} cell.sets=${cell.sets}`);
  if (cell.sessions === 1 && cell.sets === 2) finding(10, "dayMap counts two same-day workouts as one session but two sets' worth of sets",
    `sessions is assigned (=1) while sets accumulates — minor, and only reachable if two workouts share a date`);
  else check("consistent", [cell.sessions, cell.sets], [2, 2]);
}

/* ---------------------------------------------------------------- 11 */
console.log("\n[11] Consistency score vs the window boundary");
{
  const e = env();
  // a perfect 3/week trainer: sessions exactly every 7 days
  const st = mkState({ profile: Object.assign({}, mkState().profile, { weeklyTarget: 3 }),
    workouts: [0, 7, 14, 21].map((d) => wk(iso(d), [{ w: 100, r: 10 }])) });
  const c = e.E.attributes(st, 28, 0).CON.detail;
  console.log(`     4 sessions on days 0,7,14,21 with target 3/wk -> sessions=${c.sessions} expected=${c.expected} rate=${c.rate.toFixed(2)} score=${c.score}`);
  console.log(`     (a session 28 days ago also lands exactly on the boundary)`);
}

/* ---------------------------------------------------------------- summary */
console.log("\n############ FINDINGS ############");
if (!findings.length) console.log("none");
for (const f of findings.sort((a, b) => a.n - b.n)) {
  console.log(`\n[${f.n}] ${f.title}\n    ${f.evidence}`);
}
console.log(`\n${findings.length} finding(s).`);
