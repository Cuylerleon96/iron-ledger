/* New-feature suite: attribute history, volume/deload, targets, notes export,
   calendar, freshness. Run: node tools/test_features.js */
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
const truthy = (label, got) => eq(label, !!got, true);

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
  return { E: s.__X.Engine, S: s.__X.Store };
}

/* Date offsets are stamped as LOCAL calendar days (yyyy-mm-dd), matching the
   engine's dstr()/dayMap() basis — toISOString() is UTC and drifts a day ahead
   of local time every evening, which dropped the newest session out of the grid. */
const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

function trained(weeks, opts = {}) {
  const { perWeek = 1, startKg = 80, step = 2, rpe = null, reps = 8 } = opts;
  const e = env({});
  for (let i = weeks - 1; i >= 0; i--) {
    for (let k = 0; k < perWeek; k++) {
      const sets = [{ w: startKg + (weeks - 1 - i) * step, r: reps }];
      if (rpe != null) sets[0].rpe = rpe(i);
      e.S.upsertWorkout({ id: "w" + i + "_" + k, date: iso(i * 7 + k * 2),
        entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets }] });
    }
  }
  e.S.addBodyLog({ date: iso(weeks * 7), weightKg: 86, bodyFatPct: 20 });
  e.S.addBodyLog({ date: iso(2), weightKg: 82, bodyFatPct: 18 });
  return e;
}

console.log("=== attribute history ===");
{
  const e = trained(24);
  const h = e.E.attributeHistory(e.S.state, 6);
  eq("one point per requested month", h.length, 6);
  truthy("points carry all six attributes", h.every((p) => ["STR","END","POW","MOB","CON","VIT"].every((k) => typeof p.scores[k] === "number")));
  eq("oldest point predates the newest", h[0].date < h[5].date, true);
  eq("the newest point equals the live reading", h[5].scores.STR, e.E.attributes(e.S.state, 28).STR.score);
  truthy("an empty install still returns points", e.E.attributeHistory(env({}).S.state, 4).length === 4);
  eq("...and they read 0, not invented values",
     e.E.attributeHistory(env({}).S.state, 3).every((p) => Object.values(p.scores).every((v) => v === 0)), true);
}

console.log("=== volume weeks + deload signal ===");
{
  const e = trained(12, { perWeek: 3 });
  const v = e.E.volumeWeeks(e.S.state, 6);
  eq("one row per week", v.length, 6);
  truthy("sets are counted per week", v.every((x) => x.sets > 0));
  eq("weeksAgo counts back from 0", v[5].weeksAgo, 0);

  // flat volume, rising effort -> should flag
  const rising = trained(10, { perWeek: 3, rpe: (i) => 6 + (9 - i) * 0.4 });
  const d1 = rising.E.deloadCheck(rising.S.state);
  console.log(`        rising RPE at flat volume -> suggest=${d1.suggest} :: ${d1.why}`);
  truthy("rising effort at flat load is flagged", d1.suggest);

  // steady everything -> should stay quiet
  const steady = trained(10, { perWeek: 3, rpe: () => 7.5 });
  const d2 = steady.E.deloadCheck(steady.S.state);
  console.log(`        steady effort -> suggest=${d2.suggest} :: ${d2.why}`);
  eq("a steady block is NOT nagged about", d2.suggest, false);

  const empty = env({});
  eq("too little history says so rather than guessing", empty.E.deloadCheck(empty.S.state).suggest, false);
}

console.log("=== lift targets ===");
{
  const e = trained(16, { step: 2.5 });
  e.S.state.targets = { 73: { value: 120, set: iso(30) } };
  const t = e.E.targetProgress(e.S.state, 73);
  truthy("progress is reported", t && t.target === 120);
  truthy("current best comes from real sets", t.current > 0);
  eq("percent is capped at 100", t.pct <= 100, true);
  console.log(`        target ${t.target} · current ${t.current.toFixed(1)} · ${t.pct.toFixed(0)}% · ETA ${t.eta} weeks (${t.basis})`);
  truthy("an ETA is offered only with a real trend", t.eta === null || t.eta > 0);

  // not enough sessions -> no invented date
  const few = env({});
  few.S.upsertWorkout({ id: "a", date: iso(3), entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] });
  few.S.state.targets = { 73: { value: 150, set: iso(3) } };
  const t2 = few.E.targetProgress(few.S.state, 73);
  eq("a target with too little history gets no ETA", t2.eta, null);
  console.log(`        insufficient data reads: "${t2.basis}"`);
  eq("no target set means no target object", e.E.targetProgress(env({}).S.state, 73), null);
}

console.log("=== notes-shorthand export ===");
{
  const e = env({});
  e.S.upsertWorkout({ id: "n1", date: "2026-11-07", note: "felt strong",
    entries: [{ id: 73, name: "Bench press machine", mode: "weight_reps", restDefault: 120,
      sets: [{ w: 100, r: 10 }, { w: 110, r: 3, rpe: 9 }] }] });
  const txt = e.E.exportNoteShorthand(e.S.state, "n1");
  console.log("        ----\n" + txt.split("\n").map((l) => "        " + l).join("\n") + "\n        ----");
  // rest is real logged data, so it rides along; the N:WxR core is unchanged
  truthy("keeps his original N:WxR shape", /^Bench press machine:\n1:100x10 r120\n2:110x3 @9 r120$/m.test(txt));
  // float noise from unit conversion must never reach the note
  const e3 = env({});
  e3.S.upsertWorkout({ id: "n3", date: "2026-11-07", entries: [{ id: 73, name: "Row", mode: "weight_reps",
    sets: [{ w: 120.80000000000001, r: 8 }, { w: 102.5, r: 5 }] }] });
  const t3 = e3.E.exportNoteShorthand(e3.S.state, "n3");
  console.log("        " + t3.split("\n").join(" | "));
  truthy("weights are printed clean, not 120.80000000000001", /1:120\.8x8/.test(t3));
  truthy("...and half-kilo loads keep their fraction", /2:102\.5x5/.test(t3));
  truthy("no long float tails anywhere", !/\d\.\d{4,}/.test(t3));
  eq("unknown session yields nothing", e.E.exportNoteShorthand(e.S.state, "nope"), "");
  // time / distance modes
  const e2 = env({});
  e2.S.upsertWorkout({ id: "n2", date: "2026-11-07", entries: [
    { id: 1307, name: "Front Plank", mode: "time", sets: [{ t: 60 }] },
    { id: 73, name: "Row", mode: "weight_time", sets: [{ w: 50, t: 45 }] }] });
  const t2 = e2.E.exportNoteShorthand(e2.S.state, "n2");
  console.log("        " + t2.split("\n").join(" | "));
  truthy("time mode exports seconds", /Front Plank:\n1:60s/.test(t2));
  truthy("weight_time exports weight x seconds", /Row:\n1:50x45s/.test(t2));
}

console.log("=== history filter (exercise name and date range) ===");
{
  const e = env({});
  e.S.upsertWorkout({ id: "h1", date: "2026-11-01", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] });
  e.S.upsertWorkout({ id: "h2", date: "2026-11-05", entries: [{ id: 5, name: "Back Squat", mode: "weight_reps", sets: [{ w: 120, r: 5 }] }] });
  e.S.upsertWorkout({ id: "h3", date: "2026-11-09", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 105, r: 3 }] }] });
  const ids = (o) => e.E.filterSessions(e.S.state, o).map((w) => w.id);
  eq("no filter returns every session", ids({}).length, 3);
  eq("...newest first, as the list reads", ids({}), ["h3", "h2", "h1"]);
  eq("filtering by exercise name keeps only its sessions", ids({ q: "bench" }), ["h3", "h1"]);
  eq("the name match ignores case and hits substrings", ids({ q: "SQUAT" }), ["h2"]);
  eq("a date range narrows to that window", ids({ from: "2026-11-05", to: "2026-11-09" }), ["h3", "h2"]);
  eq("name AND date combine", ids({ q: "bench", from: "2026-11-08" }), ["h3"]);
  eq("an unmatched filter yields nothing, not everything", ids({ q: "deadlift" }).length, 0);
  eq("clearing every field restores the full list", ids({ q: "", from: "", to: "" }).length, 3);
}

console.log("=== bulk notes-shorthand export (all sessions / a chosen range) ===");
{
  const e = env({});
  e.S.upsertWorkout({ id: "b1", date: "2026-11-01", note: "felt strong", entries: [{ id: 73, name: "Bench press machine", mode: "weight_reps", restDefault: 120, sets: [{ w: 100, r: 10 }] }] });
  e.S.upsertWorkout({ id: "b2", date: "2026-11-05", entries: [{ id: 5, name: "Back Squat", mode: "weight_reps", sets: [{ w: 120, r: 5 }, { w: 125, r: 3 }] }] });
  e.S.upsertWorkout({ id: "b3", date: "2026-11-09", entries: [{ id: 73, name: "Bench press machine", mode: "weight_reps", sets: [{ w: 105, r: 3 }] }] });

  const all = e.E.exportNotesShorthand(e.S.state);
  console.log("        ----\n" + all.split("\n").map((l) => "        " + l).join("\n") + "\n        ----");
  truthy("every session appears, oldest first",
    all.indexOf("2026-11-01") > -1 && all.indexOf("2026-11-01") < all.indexOf("2026-11-05")
    && all.indexOf("2026-11-05") < all.indexOf("2026-11-09"));

  // NO divergence from the per-session exporter: each session's block is present
  // byte-for-byte, because both go through the ONE encoder (noteShorthandBlock).
  ["b1", "b2", "b3"].forEach((id) => {
    const one = e.E.exportNoteShorthand(e.S.state, id);
    truthy(`the bulk output contains the single-session export of ${id} verbatim`, all.includes(one));
  });

  const win = e.E.exportNotesShorthand(e.S.state, { from: "2026-11-05", to: "2026-11-09" });
  truthy("a date range drops the earlier session",
    !win.includes("2026-11-01") && win.includes("2026-11-05") && win.includes("2026-11-09"));
  eq("a range matching nothing exports nothing", e.E.exportNotesShorthand(e.S.state, { from: "2030-01-01" }), "");
  eq("an empty log exports nothing", e.E.exportNotesShorthand(env({}).S.state), "");
}

console.log("=== the History screen wires the filter and the bulk export (no dead control) ===");
{
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("renderHistory filters through Engine.filterSessions", /Engine\.filterSessions\(S, f\)/.test(app));
  truthy("the name filter input is bound", /\$\("#hist-q", head\)\.addEventListener\("input", paint\)/.test(app));
  truthy("both date inputs are bound",
    /\$\("#hist-from", head\)\.addEventListener\("change", paint\)/.test(app)
    && /\$\("#hist-to", head\)\.addEventListener\("change", paint\)/.test(app));
  truthy("Clear is bound and empties every control",
    /\$\("#hist-clear", head\)\.addEventListener\("click"/.test(app)
    && /\.value = ""; \$\("#hist-from", head\)\.value = ""; \$\("#hist-to", head\)\.value = "";/.test(app));
  truthy("Copy notes exports exactly what is shown, through the same filter",
    /Engine\.exportNotesShorthand\(S, readFilter\(\)\)/.test(app));
}

console.log("=== consistency calendar ===");
{
  const e = trained(10, { perWeek: 2 });
  const dm = e.E.dayMap(e.S.state, 371);
  // the grid spans from the first logged workout to today, capped at 371 — a
  // fixed 371-cell grid made a new account look like a year of rest days
  const firstW = e.S.state.workouts.map((w) => w.date).sort()[0];
  const spanDays = Math.round((new Date(new Date().setHours(12, 0, 0, 0)) - new Date(firstW + "T12:00:00")) / 86400000) + 1;
  eq("covers from the first logged workout to today", Object.keys(dm).length, spanDays);
  const trainedDays = Object.values(dm).filter((d) => d.sessions > 0).length;
  console.log(`        ${trainedDays} trained days inside the grid`);
  truthy("logged days are marked", trainedDays === 20);
  truthy("a trained day carries sets", Object.values(dm).filter((d) => d.sessions > 0).every((d) => d.sets > 0));
  truthy("a day with no training is zeroed", Object.values(dm).some((d) => d.sessions === 0 && d.sets === 0));
}

console.log("=== an empty account has an empty calendar ===");
{
  // dayMap fell back to the full 371-day span when there was no first workout,
  // so a brand-new account saw a year of empty cells. No sessions = no grid.
  const empty = env({});
  eq("no sessions means no calendar, not 371 blanks", Object.keys(empty.E.dayMap(empty.S.state, 371)).length, 0);
}

console.log("=== deleting a custom exercise pins its group on the logged sets ===");
{
  const e = env({});
  e.S.addCustom({ id: "uz", n: "Typo Machien Press", c: "Chest", p: ["Chest"], s: [], e: ["Machine"], m: "weight_reps", g: ["Chest"], d: "" });
  e.S.upsertWorkout({ id: "wz", date: "2026-10-01", entries: [{ id: "uz", name: "Typo Machien Press", mode: "weight_reps", sets: [{ w: 40, r: 10 }] }] });
  eq("the custom exercise feeds its group into the analysis", e.E.exGroups(e.S.state, "uz"), ["Chest"]);
  e.S.deleteCustom("uz");
  eq("it is gone from the custom list", e.S.state.custom.length, 0);
  eq("its logged sets stay on the workout (no silent data loss)", e.S.state.workouts.length, 1);
  eq("...and the entries are untouched", e.S.state.workouts[0].entries.length, 1);
  eq("...with the set itself unrewritten",
     [e.S.state.workouts[0].entries[0].sets[0].w, e.S.state.workouts[0].entries[0].sets[0].r], [40, 10]);
  // The group is pinned ON THE ENTRY at delete time (no per-exercise key has to
  // survive), so the history keeps crediting the muscle it actually trained
  // instead of re-attributing to the generic ["Core"] fallback. (Was: the
  // exercise's group was lost with its definition. See test_mathfixes §38.)
  eq("the entry carries the group it trained", e.E.entryGroups(e.S.state, e.S.state.workouts[0].entries[0]), ["Chest"]);
  eq("...and the bare dead id still resolves to the fallback (the entry is what is pinned)",
     e.E.exGroups(e.S.state, "uz"), ["Core"]);
  eq("so the logged work counts toward Chest", e.E.muscleGroups(e.S.state, 4000).Chest.totalSets, 1);
  eq("...and NOT toward Core", e.E.muscleGroups(e.S.state, 4000).Core.totalSets, 0);
}

console.log("=== body-fat goal ===");
{
  const e = env({});
  eq("no goal means no progress object", e.E.bodyFatProgress(e.S.state), null);

  const g = env({});
  g.S.state.profile.goalBodyFatPct = 15;
  g.S.state.profile.heightCm = 180;
  g.S.addBodyLog({ date: iso(120), weightKg: 88, bodyFatPct: 24 });
  g.S.addBodyLog({ date: iso(60), weightKg: 85, bodyFatPct: 20 });
  g.S.addBodyLog({ date: iso(5), weightKg: 83, bodyFatPct: 17 });
  const p = g.E.bodyFatProgress(g.S.state);
  console.log(`        goal ${p.goal}% · now ${p.current}% · from ${p.start}% · ${Math.round(p.pct)}% there · ${p.remaining} pts to go`);
  eq("goal is reported", p.goal, 15);
  eq("current reading is the newest check-in", p.current, 17);
  eq("it knows where it started", p.start, 24);
  eq("progress is a real percentage", p.pct > 50 && p.pct < 100, true);
  eq("remaining is positive while above goal", p.remaining > 0, true);
  eq("the change is the honest delta", p.change, -7);

  // the score must actually USE the goal
  const toward = g.E.attributes(g.S.state, 28).VIT;
  const away = env({});
  away.S.state.profile.goalBodyFatPct = 15;
  away.S.state.profile.heightCm = 180;
  away.S.addBodyLog({ date: iso(120), weightKg: 78, bodyFatPct: 14 });
  away.S.addBodyLog({ date: iso(5), weightKg: 88, bodyFatPct: 24 });
  const awayV = away.E.attributes(away.S.state, 28).VIT;
  console.log(`        VIT moving toward the goal = ${toward.score}, moving away = ${awayV.score}`);
  truthy("moving toward the goal scores higher than moving away", toward.score > awayV.score);
  truthy("the basis names the goal", /goal/.test(toward.detail.basis));

  // a met goal reads as met
  const done = env({});
  done.S.state.profile.goalBodyFatPct = 15;
  done.S.addBodyLog({ date: iso(60), weightKg: 84, bodyFatPct: 18 });
  done.S.addBodyLog({ date: iso(3), weightKg: 80, bodyFatPct: 15 });
  eq("a met goal is marked met", done.E.bodyFatProgress(done.S.state).met, true);

  // no goal -> the healthy band still applies (previous behaviour intact)
  const band = env({});
  band.S.state.profile.bodyFatPct = 15;
  band.S.state.profile.heightCm = 180;
  band.S.state.profile.weightKg = 82;
  // with no goal the healthy-band scoring is untouched (basis mentions body fat
  // and NOT a goal)
  const bandBasis = band.E.attributes(band.S.state, 28).VIT.detail.basis;
  console.log(`        no-goal basis: "${bandBasis}"`);
  truthy("without a goal the healthy-band wording is unchanged", /body fat/.test(bandBasis) && !/goal/.test(bandBasis));
}

console.log("=== the essential-fat floor ===");
{
  const e = env({});
  eq("4% for a man is flagged", e.E.belowEssentialBF(4, "M"), true);
  eq("15% for a man is not", e.E.belowEssentialBF(15, "M"), false);
  eq("12% for a woman is flagged", e.E.belowEssentialBF(12, "F"), true);
  eq("16% for a woman is not", e.E.belowEssentialBF(16, "F"), false);
  eq("no value is not flagged", e.E.belowEssentialBF(null, "M"), false);
  // Sex unset -> the PROTECTIVE value (the women's 13%), exactly as the intake
  // floor takes the higher (male) 1500 kcal. The permissive male 5% would leave
  // the warning silent on a reading it should flag.
  eq("with sex unset the floor is the protective 13% — 12% is flagged", e.E.belowEssentialBF(12, null), true);
  eq("...4% is flagged too", e.E.belowEssentialBF(4, null), true);
  eq("...but 14% is not", e.E.belowEssentialBF(14, null), false);
  eq("unset reads the SAME floor as an explicit woman", e.E.belowEssentialBF(12, null), e.E.belowEssentialBF(12, "F"));
  eq("...and NOT the permissive male 5%", e.E.belowEssentialBF(9, null), true);   // 9 < 13
  eq("...where a man's 9% is fine", e.E.belowEssentialBF(9, "M"), false);        // 9 > 5
}

console.log("=== the healthy body-fat band when sex is unset ===");
{
  const vitAt = (sex) => { const e = env({});
    e.S.state.profile.sex = sex; e.S.state.profile.bodyFatPct = 15;
    return e.E.attributes(e.S.state, 28).VIT.score; };
  const unset = vitAt(null), m = vitAt("M"), f = vitAt("F");
  console.log(`        15% body fat -> unset VIT ${unset}, M ${m}, F ${f}`);
  eq("unset uses the protective (women's) band, not the male one", unset, f);
  eq("...so a lean 15% is scored, not waved through as the male 100", unset < 100, true);
  eq("an explicit male still reads the male band (15% is inside 8-18)", m, 100);
  eq("an explicit female reads the women's band (15% is below 18)", f, 82);
}

console.log("=== the body-fat goal survives an export ===");
{
  const a = env({});
  a.S.state.profile.goalBodyFatPct = 14;
  const f = env({});
  f.S.importJSON(a.S.exportJSON(), "replace");
  eq("goal survives a round trip", f.S.state.profile.goalBodyFatPct, 14);
}

console.log("=== muscle freshness ===");
{
  const e = trained(2, { perWeek: 1 });
  const f = e.E.freshness(e.S.state);
  eq("every group is reported", Object.keys(f).length, e.E.GROUP_ORDER.length);
  truthy("a trained group has a freshness percent", f.Chest.fresh === null || (f.Chest.fresh >= 0 && f.Chest.fresh <= 100));
  eq("an untrained group has no freshness number", f.Calves.fresh, null);
  const empty = env({});
  eq("a fresh install invents nothing", empty.E.freshness(empty.S.state).Chest.fresh, null);
}

console.log("=== the 'Load my 7 Nov session' seed button is reachable ===");
{
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  // The old bug: the button rendered only when settings.seeded was false, but
  // boot() sets it true before the first render, so the condition never fired.
  // The guard must now key on whether the seed workout is already in the log.
  const guard = app.match(/function shouldShowSeed\(\)[\s\S]*?\n  \}/);
  truthy("shouldShowSeed exists", !!guard);
  if (guard) {
    truthy("the guard keys on the seed workout being in the log",
      /SEED_WORKOUT/.test(guard[0]) && /workouts/.test(guard[0]));
    truthy("the guard does NOT read settings.seeded", !/settings\.seeded/.test(guard[0]));
  }
  truthy("the button is rendered under shouldShowSeed()",
    /shouldShowSeed\(\) \? `<div class="row"><button[^`]*id="d-seed"/.test(app));
  truthy("boot() still sets settings.seeded (but nothing gates the button on it)",
    /if \(!S\.settings\.seeded\) \{ S\.settings\.seeded = true/.test(app));
}

console.log("=== override schema: only the fields the engine actually reads ===");
{
  const e = env({});
  // 'n' is not part of the schema: exName ignores a rename override entirely.
  // (A rename lives on custom[].n, not in overrides.)
  e.S.state.overrides[73] = { n: "Renamed Bench" };
  eq("exName ignores a rename override (n is not read)", e.E.exName(e.S.state, 73), "Bench Press");
  // mode IS wired
  e.S.state.overrides[73] = { mode: "reps" };
  eq("exMode honours the mode override", e.E.exMode(e.S.state, 73), "reps");
  // g IS wired — this is the delete-detach path, NOT a dead branch
  e.S.state.overrides[73] = { g: [] };
  eq("exGroups honours an empty group override (delete-detach)", e.E.exGroups(e.S.state, 73), []);
  e.S.state.overrides[73] = { g: ["Legs"] };
  eq("exGroups honours a non-empty group override", e.E.exGroups(e.S.state, 73), ["Legs"]);
}

console.log("=== weekly volume carries tonnage and reps, not just sets ===");
{
  const e = env({});
  e.S.upsertWorkout({ id: "vt", date: iso(3), entries: [
    { id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }, { w: 50, r: 5 }] }] });
  const v = e.E.volumeWeeks(e.S.state, 4);
  const wk = v[v.length - 1];               // weeksAgo 0 — the current week
  eq("this week's sets are counted", wk.sets, 2);
  eq("this week's reps are counted", wk.reps, 15);
  eq("this week's tonnage is the computed load x reps", wk.tonnage, 100 * 10 + 50 * 5);
  // the chart plots whichever of these columns is picked; prove tonnage is the
  // SAME number the engine already uses for one entry (no second definition)
  const allTon = v.reduce((a, w) => a + w.tonnage, 0);
  eq("summed weekly tonnage equals the engine's own entry tonnage",
     allTon, e.E.entryStats(e.S.state.workouts[0].entries[0]).tonnage);
}

console.log("=== the two 'work time %' figures name their window ===");
{
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("dashboard work-time chip is labelled all-time",
    /\$\{s\.density\}% work time \(all-time\)/.test(app));
  truthy("stamina work-time figure is labelled 28-day",
    /\$\{x\.density\}% work time over the last 28 days/.test(app));
  truthy("no unqualified '% work time' label survives",
    !/% work time<\/span>/.test(app));
}

console.log("=== build injects the real app version (welcome constant cannot drift) ===");
{
  const { execFileSync } = require("child_process");
  const PY = `
import importlib.util, json, pathlib, re
spec = importlib.util.spec_from_file_location("bw", "tools/build_www.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ver = m.read_version_name()
src = pathlib.Path("js/welcome.js").read_text()
inj = re.search(r'const APP_VERSION = "([^"]*)"', m.inject_version(src, ver)).group(1)
loud = False
try:
    m.inject_version("// no anchor here", "9.9.9")
except SystemExit:
    loud = True
print(json.dumps({"version": ver, "injected": inj, "loud": loud}))
`;
  let r = null;
  try {
    r = JSON.parse(execFileSync("python3", ["-c", PY], { cwd: B }).toString().trim());
    truthy("build_www.py exposes an injectable version step", true);
  } catch (err) {
    truthy("build_www.py exposes an injectable version step", false);
    console.log("        " + String(err.message || err).slice(0, 300));
  }
  if (r) {
    const props = fs.readFileSync(path.join(B, "android", "version.properties"), "utf8");
    const vn = (props.match(/versionName\s*=\s*(\S+)/) || [])[1];
    eq("injection reads android/version.properties' versionName", r.version, vn);
    eq("the injected APP_VERSION equals the real versionName", r.injected, vn);
    truthy("injection fails loudly (SystemExit) when the anchor is missing", r.loud);
    truthy("source welcome.js still carries the injectable anchor",
      /const APP_VERSION = "[^"]*"/.test(fs.readFileSync(path.join(B, "js", "welcome.js"), "utf8")));
  }
}

console.log("=== accessibility wiring (static: source + markup present) ===");
{
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(B, "css", "style.css"), "utf8");
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  truthy("modal has role=dialog", /id="modal"[^>]*role="dialog"/.test(html));
  truthy("modal is aria-modal", /id="modal"[^>]*aria-modal="true"/.test(html));
  truthy("toasts are an aria-live region", /id="toasts"[^>]*aria-live="polite"/.test(html));
  truthy("a :focus-visible ring exists in the stylesheet", /:focus-visible/.test(css));
  truthy("opening a modal locks background scroll", /body\.classList\.add\("modal-open"\)/.test(app));
  truthy("closing a modal releases the scroll lock", /body\.classList\.remove\("modal-open"\)/.test(app));
  truthy("set-row weight inputs carry an aria-label", /\$\{sl\} weight/.test(app));
  truthy("set-row reps inputs carry an aria-label", /\$\{sl\} reps/.test(app));
  truthy("the remove-set button has an aria-label", /aria-label="Remove \$\{sl\.toLowerCase\(\)\}"/.test(app));

  // --- the logged-food row: the ✕ stays inline and is named ---
  truthy("a logged-food row keeps its ✕ inline (has-del modifier, not the base 3-column grid)", /class="pr-row has-del food-log-row"/.test(app));
  truthy("the logged-food ✕ carries an aria-label, not a bare ✕ glyph", /aria-label="Remove ' \+ esc\(e\.name\) \+ '"/.test(app));
  truthy("the has-del row is a 4-column grid whose name cell can shrink", /\.pr-row\.has-del \{ grid-template-columns: minmax\(0, 1fr\) auto auto auto; \}/.test(css));
  truthy("the logged-food ✕ gets a 48 px tap target without inflating the row", /\.pr-row\.has-del \.food-del::before/.test(css) && /width: 48px; height: 48px/.test(css));
  /* The four-fact row does not fit one line at the Pixel 6 width (412 CSS px):
     the macro line's max-content width collapsed the name track and the name
     overflowed across the portion and macros. It is now TWO lines — name + ✕
     above portion + macros. Re-expressed against the two-line rule, and proven
     scoped so the three-fact bodyweight row keeps its single line. */
  truthy("the logged-food row is a two-line grid (name/first line, portion+macros/second)", /\.pr-row\.food-log-row \{[^}]*grid-template-rows: auto auto/.test(css));
  truthy("the two-line rule is scoped to the logged-food row, not the bodyweight row", /\.pr-row\.food-log-row > span:nth-child\(1\) \{ grid-column: 1 \/ 3; grid-row: 1; \}/.test(css) && !/\.pr-row\.has-del \{[^}]*grid-template-rows/.test(css));

  // --- the bodyweight-log row: the same defect, the same inline fix ---
  truthy("the bodyweight-log row keeps its ✕ inline (has-del modifier)", /<div class="pr-row has-del"><span>\$\{b\.date\}/.test(app));
  truthy("the bodyweight-log ✕ carries an aria-label naming the weigh-in", /class="btn ghost tiny bdel" data-d="\$\{b\.date\}" title="Remove" aria-label="Remove weigh-in \$\{b\.date\}"/.test(app));
  truthy("the bodyweight ✕ shares the 48 px tap target (has-del .bdel)", /\.pr-row\.has-del \.bdel::before/.test(css));

  // --- .pr-row call-site census: three sites, each with its expected child count ---
  const prSites = [...app.matchAll(/(?:class="pr-row( has-del( food-log-row)?)?"|class: "pr-row( has-del)?")/g)].map((m) => m[0]);
  eq(".pr-row call-site census: three sites, in source order", prSites, ['class: "pr-row"', 'class="pr-row has-del food-log-row"', 'class="pr-row has-del"']);
  const kids = (tpl) => (tpl.match(/<span/g) || []).length + (tpl.match(/<button/g) || []).length;
  const recentTpl = (app.match(/class: "pr-row" \},\s*`([\s\S]*?)`\)\)/) || [])[1] || "";
  eq("Recent-records row has 3 children (name, best, date) — base grid, no ✕", kids(recentTpl), 3);
  truthy("Recent-records row carries no delete control", !/<button/.test(recentTpl));
  const foodTpl = (app.match(/class="pr-row has-del food-log-row">([\s\S]*?)<\/div>'\)\.join/) || [])[1] || "";
  eq("logged-food row has 4 children (3 cells + ✕)", kids(foodTpl), 4);
  truthy("logged-food ✕ is named", /aria-label="Remove '/.test(foodTpl));
  const bwTpl = (app.match(/class="pr-row has-del">(<span>\$\{b\.date\}[\s\S]*?)<\/div>`\)\.join/) || [])[1] || "";
  eq("bodyweight-log row has 4 children (3 cells + ✕)", kids(bwTpl), 4);
  truthy("bodyweight ✕ is named", /aria-label="Remove weigh-in \$\{b\.date\}"/.test(bwTpl));

  // --- the remaining pass: focus trap, Escape, heatmap text, small type ---
  const chart = fs.readFileSync(path.join(B, "js", "chart.js"), "utf8");
  const appSrc = app;
  truthy("Escape closes the modal", /e\.key === "Escape"/.test(appSrc) && /preventDefault\(\); closeModal\(\);/.test(appSrc));
  truthy("Tab is intercepted while the modal is open", /e\.key !== "Tab"/.test(appSrc));
  truthy("a focusable set is collected inside the dialog", /focusablesIn\(/.test(appSrc) && /button:not\(\[disabled\]\)/.test(appSrc));
  truthy("focus wraps at both ends of the dialog", /last\.focus\(\);/.test(appSrc) && /first\.focus\(\);/.test(appSrc));
  truthy("opening records the element that opened the modal", /modalOpener = /.test(appSrc));
  truthy("closing restores focus to it", /modalOpener\.focus\(\)/.test(appSrc));
  truthy("heatmap cells carry a text alternative of their own", /setAttribute\("role", "img"\)/.test(chart) && /setAttribute\("aria-label", cellText\(k, d\)\)/.test(chart));
  truthy("...so the grid does not rely on title or shading alone", /cellText\(k, d\)/.test(chart) && /const c = document\.createElement\("i"\);\s*\n\s*c\.className = "hm-cell l" \+ lvl;/.test(chart));
  truthy("padding cells are hidden from the accessibility tree", /hm-cell pad"; b\.setAttribute\("aria-hidden", "true"\)/.test(chart));
  truthy("the smallest label sizes were raised, not left at .42rem/9px",
    !/\.lvl-lab[^}]*font-size: \.42rem/.test(css) && !/\.mraw \{[^}]*font-size: 9px/.test(css));
}

console.log("=== brand glyph: a GBA pixel mark inside the untouched gold tile ===");
{
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(B, "css", "style.css"), "utf8");
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  /* The brand mark was the ink diamond character, which reads ambiguously and is
     not in the app's Gen-3 pixel idiom. It is now an inline SVG on a tiny integer
     grid, so it is chunky pixel art at any size, bundles no asset and adds no
     dependency. The mark itself is "A3" from the rendered candidate sheet: two
     tall 2x5 weight plates with a bolt-cap pixel above and below each inner
     column, joined by a 3x1 bar -- the sheet's A3_boltcaps. */
  truthy("the old ambiguous diamond glyph is gone from the markup", !html.includes("\u25c6"));
  truthy("the tile is still a plain decorative logo span", /<span class="logo">/.test(html));
  truthy("the brand text is untouched beside it", /<span class="brand-txt">Iron Ledger<\/span>/.test(html));
  const logo = (html.match(/<span class="logo">([\s\S]*?)<\/span>/) || [])[1] || "";
  truthy("the glyph is an inline svg", /^<svg[\s\S]*<\/svg>$/.test(logo));
  truthy("it loads no external asset (no href/src/url/img)", !/href=|src=|url\(|<img/.test(logo));
  truthy("it is drawn with shape-rendering=crispEdges (no blurry scaling)", /shape-rendering="crispEdges"/.test(logo));
  truthy("its colour is the tile's existing ink (currentColor)", /fill="currentColor"/.test(logo));
  truthy("it is decorative, not interactive (aria-hidden, no role)",
    /aria-hidden="true"/.test(logo) && !/role=|tabindex=|onclick=/.test(logo));
  /* The 20x20 gold chip is untouched: only the glyph inside it changed. */
  const logoCss = (css.match(/\.logo \{([\s\S]*?)\}/) || [])[1] || "";
  truthy("the 20x20 gold chip is unchanged", /width: 20px; height: 20px/.test(logoCss));
  truthy("the cream 2px border is unchanged", /border: 2px solid var\(--cream\)/.test(logoCss));
  truthy("the radius and gold shadow are unchanged",
    /border-radius: 4px/.test(logoCss) && /box-shadow: 0 0 0 1px var\(--gold-d\)/.test(logoCss));
  /* The integer grid IS the point: 16 CSS px on a 2.625 DPR phone is 42 device px
     = 7 cells of exactly 6 device px, so crispEdges lands every cell on a whole
     device pixel (no blurry fractional scaling). */
  eq("the mark is an integer 7x7 grid", (logo.match(/viewBox="0 0 (\d+) (\d+)"/) || []).slice(1).map(Number), [7, 7]);
  truthy("it is sized 16x16 CSS px (42 device px at 2.625 DPR = 7 cells x 6)", /width="16" height="16"/.test(logo));
  const rects = [...logo.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"\/>/g)]
    .map((m) => m.slice(1).map(Number));
  truthy("the mark has drawn pixels", rects.length >= 2);
  truthy("every rect sits on whole grid cells (chunky, no fractional geometry)",
    rects.every((r) => r.every(Number.isInteger)));
  truthy("every rect stays inside the 7x7 grid",
    rects.every(([x, y, w, h]) => x >= 0 && y >= 0 && x + w <= 7 && y + h <= 7));
  truthy("no stroke anywhere (a stroked edge would anti-alias)", !/stroke=/.test(logo));
  eq("the implemented mark is A3 (tall capped plates + a connecting bar)",
    rects, [[0, 1, 2, 5], [5, 1, 2, 5], [2, 3, 3, 1],
            [1, 0, 1, 1], [1, 6, 1, 1], [5, 0, 1, 1], [5, 6, 1, 1]]);
  const brand = (html.match(/<div class="brand">[\s\S]*?<\/div>/) || [])[0] || "";
  truthy("the brand markup carries no click handler", !/onclick=/.test(brand));
  truthy("the brand markup carries no interactive role/tabindex/button",
    !/role=|tabindex=|<button/.test(brand));
  truthy("no JS binds a handler to the brand or the tile", !/\.brand|\.logo\b/.test(app));
  truthy("the tile is never given a pointer/hand cursor", !/\.logo\b[^}]*cursor: pointer/.test(css));
}

console.log("=== glossary: every term the UI shows has ONE entry, and every entry is shown ===");
{
  const G = require(path.join(B, "js", "glossary.js"));
  const e = env({});
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const chart = fs.readFileSync(path.join(B, "js", "chart.js"), "utf8");
  const welcome = fs.readFileSync(path.join(B, "js", "welcome.js"), "utf8");
  const engine = fs.readFileSync(path.join(B, "js", "engine.js"), "utf8");
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");
  /* js/nutrition.js builds the html the user READS on the Nutrition tab, and
     js/macros.js carries the phase labels/blurbs and the caveats that tab shows
     verbatim — both are DISPLAY sources. The scope check below therefore spans
     them: a term the user cannot see must not have an entry, and a term these
     files put on screen must have one. */
  const nutrition = fs.readFileSync(path.join(B, "js", "nutrition.js"), "utf8");
  const macros = fs.readFileSync(path.join(B, "js", "macros.js"), "utf8");
  const ui = [app, chart, welcome, engine, html, nutrition, macros].join("\n");

  // 1. no duplicate ids, and every entry carries both halves
  const ids = G.TERMS.map((t) => t.id);
  eq("glossary ids are unique", ids.length, new Set(ids).size);
  truthy("every entry has a plain explanation", G.TERMS.every((t) => t.plain && t.plain.length > 20));
  truthy("every entry has the real definition underneath", G.TERMS.every((t) => t.real && t.real.length > 20));
  /* EVERY entry carries a source, and it is REAL text — an explanation without
     its source is not finished. A term the app cannot source says so in the
     entry rather than inventing a citation (see 'Body fat %'). */
  truthy("every entry carries a non-empty source", G.TERMS.every((t) => typeof t.source === "string" && t.source.trim().length > 15));
  eq("no entry has a blank source", G.TERMS.filter((t) => !t.source || !t.source.trim()).map((t) => t.id), []);
  truthy("the source line is RENDERED in the entry, not just stored",
    /class="gloss-src"/.test(G.entryHTML(G.get("rmr"))) && /PMID 2305711/.test(G.entryHTML(G.get("rmr"))));
  /* Where the repo already owns the citation, the entry reuses it verbatim
     rather than inventing a second one — so the two can be compared. */
  const M = require(path.join(B, "js", "macros.js"));
  truthy("the RMR entry reuses Macros.SOURCES.mifflin",
    G.get("rmr").source.includes(M.SOURCES.mifflin));
  truthy("the RMR entry reuses Macros.SOURCES.cunningham",
    G.get("rmr").source.includes(M.SOURCES.cunningham));
  truthy("the intake-floor entry reuses Macros.SOURCES.floor",
    G.get("intake-floor").source.includes(M.SOURCES.floor));
  truthy("the macro entry reuses Macros.SOURCES.protein / .fat / .carbs",
    G.get("macros").source.includes(M.SOURCES.protein) && G.get("macros").source.includes(M.SOURCES.fat)
      && G.get("macros").source.includes(M.SOURCES.carbs));
  truthy("the activity-factor entry reuses Macros.SOURCES.activityLevel",
    G.get("activity-factor").source.includes(M.SOURCES.activityLevel));

  // 2. the pinned list from the brief: at minimum these terms are covered
  const REQUIRED = [
    "volume", "tonnage", "reps", "effort-set", "rpe", "e1rm",
    "mev-mav-mrv", "below-mev", "mev-mav", "optimal", "over-mrv", "untrained",
    "deload", "plateau", "density", "freshness", "baseline", "pr", "next-target", "tiers",
    "xp-multiplier",
    "attr-STR", "attr-END", "attr-POW", "attr-MOB", "attr-CON", "attr-VIT",
  ];
  eq("every required term has an entry", REQUIRED.filter((id) => !G.has(id)), []);

  /* The NUTRITION stage: every term the Nutrition tab, the Profile nutrition
     fields and the food-logging UI DISPLAY resolves to an entry. This is the
     inventory the stage was built from. */
  const REQUIRED_NUTRITION = [
    "kcal", "grams", "weight-units", "maintenance", "rmr", "activity-factor", "intake-floor",
    "macros", "per-kg-bodyweight", "lean-mass", "body-fat-pct", "pace", "phase", "fibre",
    "per-100-g", "portion", "amdr", "rda", "essential-fat", "deficit-surplus", "usda", "controller",
  ];
  eq("every displayed nutrition term has an entry", REQUIRED_NUTRITION.filter((id) => !G.has(id)), []);
  /* Every NEW nutrition badge carries a glossary entry of its own, so a badge the
     user can see is never left unexplained. The badge names live in engine.js
     (the ACHIEVEMENTS list), which is part of the ui corpus, so each entry's own
     heading is a term the UI really displays. */
  const REQUIRED_BADGES = ["firstlog", "logcover4", "logcover12", "foodvariety"];
  eq("every new nutrition badge has a glossary entry", REQUIRED_BADGES.filter((id) => !G.has(id)), []);
  /* ...and the jargon the tab itself puts on screen is TAPPABLE there (not only
     reachable from the Profile list): nutrition.js links its own words through
     tlink(), app.js links the food-logging abbreviations through term(). */
  const TAB_HOOKS = ["kcal", "grams", "maintenance", "rmr", "activity-factor", "intake-floor",
    "lean-mass", "per-kg-bodyweight", "amdr", "rda", "pace", "phase", "fibre", "per-100-g", "controller"];
  const hookedInTab = (id) => new RegExp('tlink\\("' + id + '"').test(nutrition) || new RegExp('term\\("' + id + '"').test(app);
  eq("the Nutrition tab hooks its jargon terms (tap-to-explain from the tab)",
     TAB_HOOKS.filter((id) => !hookedInTab(id)), []);

  /* The clinical words the earlier tone pass kept as ALIASES must still resolve:
     they are how a renamed term's old wording lands on its entry. */
  const CLINICAL_ALIASES = ["working sets", "raw sets", "effort sets", "1RM", "e1RM", "MEV", "MAV", "MRV",
    "over MRV", "untrained", "MEV→MAV", "optimal", "below MEV", "landmarks"];
  const aliasResolves = (w) => G.TERMS.some((t) => t.term === w || (t.aliases || []).indexOf(w) > -1);
  eq("every clinical alias still resolves to an entry", CLINICAL_ALIASES.filter((w) => !aliasResolves(w)), []);

  /* Every entry must describe something the app STILL HAS. Two checkable cases:
     the per-exercise effort weight is a maths constant worked out from the
     movement (never a control), and the day-run/streak display is gone. */
  truthy("the effort-set entry says the effort weight is NOT something the user sets",
    /not something you set/.test(G.get("effort-set").real));
  eq("...and there is no user-set effort-weight control in the UI",
    /effort weight\s*<|id="[^"]*effort[^"]*"|Effort weight\s*<input/i.test(app), false);
  truthy("the constant really is derived in the engine (not read from state)",
    /a maths constant/.test(fs.readFileSync(path.join(B, "js", "engine.js"), "utf8")));
  eq("no entry describes the removed day-run/streak display",
    G.TERMS.filter((t) => /streak|day[- ]run|days in a row/i.test([t.term, t.plain, t.real, (t.aliases || []).join(" ")].join(" "))).map((t) => t.id), []);
  truthy("the set-type entry's control still exists (a real Drop/Failure select)",
    /setty/.test(app) && /Set type/.test(app));

  // 3. every muscle-balance status word the engine can emit maps to an entry
  const STATUSES = ["room to grow", "building", "sweet spot", "over its limit", "not trained yet"];
  truthy("the engine really emits these status words",
    STATUSES.every((s) => engine.includes(s)));
  eq("every status word maps to a glossary entry", STATUSES.map(G.statusId).filter(Boolean).length, STATUSES.length);
  eq("...and each is a distinct entry",
    new Set(STATUSES.map(G.statusId)).size, STATUSES.length);

  // 4. every attribute has an entry, reachable by the engine's own key
  const keys = e.E.ATTRIBUTES.map((a) => a.key);
  eq("all six attribute keys resolve to an entry", keys.map((k) => G.attrId(k)).filter(Boolean).length, 6);
  truthy("attrPlain/attrReal return text for each attribute",
    keys.every((k) => G.attrPlain(k).length > 10 && G.attrReal(k).length > 10));

  // 5. the scope test — both directions
  //    (a) no entry exists for a term the UI never shows
  const unshown = G.TERMS.filter((t) => {
    const words = [t.term].concat(t.aliases || []);
    return !words.some((w) => ui.includes(w));
  }).map((t) => t.id);
  eq("no entry exists for a term the UI never displays", unshown, []);

  //    (b) no hook points at a term that has no entry (no dead control).
  //    app.js wires terms through term("<id>", ...); chart.js uses a literal
  //    data-term attribute. Collect both.
  const hookSrc = app + "\n" + chart;
  const hooks = new Set(
    (hookSrc.match(/data-term="([^"]+)"/g) || []).map((m) => m.slice(11, -1))
      .concat((hookSrc.match(/(?:^|[^\w.])term\("([a-z0-9-]+)"/g) || []).map((m) => m.match(/"([a-z0-9-]+)"/)[1]))
  );
  eq("every static term hook resolves to an entry", [...hooks].filter((id) => !G.has(id)), []);
  truthy("...and there are real hooks on the cards (>10)", hooks.size > 10);
  // The status words and attribute names are wired through the glossary's own
  // mappers, so they are hooks too — proven by the code path, not a literal.
  truthy("the muscle-status words are wired through Glossary.statusId (as controls)",
    /GLOSS\.statusId \? GLOSS\.statusId\(m\.status\)/.test(app) && /term\(sid,/.test(app));
  truthy("each attribute name is wired through Glossary.attrId (as a control)",
    /term\(attrTermId\(a\.key\)/.test(app) && /const attrTermId = \(key\) => \(GLOSS\.attrId/.test(app));
  truthy("every status word maps to an id the mappers can serve",
    STATUSES.map(G.statusId).every((id) => G.has(id)));

  // 6. Glossary.link: a real id is a control, a bogus id is plain text (never dead)
  truthy("link() emits a button carrying data-term for a real entry",
    /<button[^>]*data-term="rpe"[^>]*>/.test(G.link("rpe", "RPE")));
  eq("link() with no entry renders plain text, not a dead button",
     G.link("no-such-term", "x"), "x");

  // 7. Glossary.open refuses an unknown id and serves a known one in the shared modal
  const caps = [];
  const ctx = { el: () => ({ innerHTML: "", querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => [] }),
                open: (n, c) => caps.push(c), close: () => {} };
  eq("open() refuses an unknown id", G.open(ctx, "no-such-term"), false);
  eq("...and opens nothing for it", caps.length, 0);
  eq("open() serves a known id", G.open(ctx, "tonnage"), true);
  eq("...in a wide modal", caps[0], "wide");

  // 8. the Profile entry point exists and lists every term
  truthy("Profile carries the glossary button", /id="p-gloss"/.test(app) && /Open the glossary/.test(app));
  truthy("the button opens the whole list", /GLOSS\.openAll\(glossCtx\(\)\)/.test(app));
  truthy("index.html loads glossary.js before app.js",
    html.indexOf("js/glossary.js") > -1 && html.indexOf("js/glossary.js") < html.indexOf("js/app.js"));

  // 9. UNIFICATION: the dashboard's per-attribute explanation reads the shared
  //    source, so the two places cannot explain the same attribute differently.
  truthy("the dashboard reads its attribute definitions from the glossary",
    /GLOSS\.attrPlain/.test(app));
  truthy("the 'What the numbers mean' block is still there (extended, not replaced)",
    /What the numbers mean/.test(app));
  truthy("a single delegated handler serves every term click",
    /closest\("\[data-term\]"\)/.test(app));
  truthy("the stylesheet gives the tappable term its GBA look",
    /\.term-link\s*\{/.test(fs.readFileSync(path.join(B, "css", "style.css"), "utf8")));
}

console.log("=== glossary follows the display: a renamed term's entry is renamed with it ===");
{
  /* The app's rule (glossary.js): every term the UI DISPLAYS has one entry, and
     no entry exists for a term the UI never shows. So when a displayed term is
     renamed, its entry must be renamed to match — otherwise the card shows one
     word and the glossary explains another. This pins that for the muscle-balance
     status words, the clearest offenders in the tone pass. */
  const G = require(path.join(B, "js", "glossary.js"));
  const engine = fs.readFileSync(path.join(B, "js", "engine.js"), "utf8");
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");

  // (a) every word the engine can emit resolves to an entry...
  const emitted = ["room to grow", "building", "sweet spot", "over its limit", "not trained yet"];
  eq("every emitted muscle-status word has a glossary entry", emitted.filter((w) => !G.statusId(w)), []);
  // (b) ...and that entry's OWN heading is exactly the word on screen
  eq("...and the entry's heading IS the word shown (entry follows display)",
     emitted.filter((w) => { const e = G.get(G.statusId(w)); return !e || e.term !== w; }), []);
  // (c) the card renders the entry through statusId, not a stale literal
  truthy("the muscle card links each status word through Glossary.statusId",
    /GLOSS\.statusId\(m\.status\)/.test(app) && /term\(sid,/.test(app));
  // (d) the old clinical words are gone from the engine's display surface
  const CLINICAL = ['"below MEV"', '"over MRV"', '"untrained"', '"MEV→MAV"', '"MEV->MAV"', '"optimal"'];
  eq("no clinical muscle-status word survives in the engine source", CLINICAL.filter((w) => engine.includes(w)), []);
}

console.log("=== the HUD and the dashboard chip show sessions THIS WEEK, not a consecutive-day streak ===");
{
  /* The HUD (#hud-week) and the hero chip used to show a consecutive-day run —
     "🔥 Nd" / "no streak" and "Nd streak". A day count implicitly pushes daily
     training and reads as failure after a rest day, so both now show sessions
     logged this week against the profile's weekly target. This loads the REAL
     app.js behind a DOM stub and renders it, so it pins what the user actually
     sees, not a copy of the wording. */
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");

  // (1) the old display is gone from the source AND the markup
  eq("no '#hud-streak' hook survives in the UI", /hud-streak/.test(app + html), false);
  truthy("the HUD slot is #hud-week", /id="hud-week"/.test(html));
  eq("app.js no longer displays a consecutive-day value",
     /streak\.days|d streak|no streak|🔥/.test(app), false);

  // (2) render the real app at 0 / 2 / 4 / 5 sessions this week
  const mkNode = (sel, created) => ({
    sel, _html: "", className: "", dataset: {}, style: {}, children: [],
    set innerHTML(v) { this._html = String(v); created.push(String(v)); }, get innerHTML() { return this._html; },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    append(c) { this.children.push(c); }, prepend() {}, remove() {}, click() {}, focus() {},
    contains: () => false, querySelector: () => mkNode("q", created), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  });
  const uiEnv = (workouts, target) => {
    const store = {}, nodes = {}, created = [];
    const get = (sel) => (nodes[sel] = nodes[sel] || mkNode(sel, created));
    const s = {
      console: { log() {}, warn() {}, error() {}, info() {} },
      Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
      isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
      setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      document: { addEventListener() {}, removeEventListener() {}, querySelector: get, querySelectorAll: () => [],
        getElementById: get, createElement: () => mkNode("e", created), createElementNS: () => mkNode("ns", created), body: mkNode("body", created),
        visibilityState: "visible", activeElement: null },
      navigator: { clipboard: { writeText: async () => {} } },
      localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
      Blob: function () {}, URL: { createObjectURL: () => "blob:x" }, module: { exports: {} },
    };
    s.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
    s.window = s; s.globalThis = s;
    vm.createContext(s);
    vm.runInContext(`localStorage.setItem("fitness-app-v1", JSON.stringify({
      version:1, createdAt:"2026-01-01T00:00:00.000Z",
      profile:{name:"C",sex:"M",heightCm:180,weightKg:82,weeklyTarget:${target},units:"kg"},
      workouts:${JSON.stringify(workouts)}, bodylog:[], overrides:{}, custom:[], achievements:{}, settings:{seeded:true}
    }));`, s);
    const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/chart.js", "js/app.js"]
      .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
    vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store};", s, { filename: "ui.js" });
    return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, nodes, created };
  };

  // dates inside the CURRENT Monday-start week, whatever today is
  const E0 = env({}).E;
  const inWeek = (i) => { const t = new Date(E0.weekKeyOf(E0.dstr(new Date())) + "T12:00:00"); t.setDate(t.getDate() + i); return E0.dstr(t); };
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: "w" + i, date: inWeek(i), entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 60, r: 8 }] }] }));

  const SHAME = ["behind", "late", "missed", "failed", "fail", "off-track", "off track"];
  const NO_DAYCOUNT = /\b\d+\s*d\b|streak|streak|🔥|days in a row/i;

  [0, 2, 4, 5].forEach((n) => {
    const u = uiEnv(many(n), 4);
    u.A.render();
    const w = u.A.weekProgress(u.S.state);
    const hud = u.nodes["#hud-week"].innerHTML;
    const chipTxt = u.A.weekChipText(w);
    console.log(`        ${n} sessions this week -> HUD "${hud}" · chip "${chipTxt}"`);

    eq(`HUD at ${n} sessions this week vs a target of 4`, hud, u.A.weekHudText(w));
    truthy(`HUD at ${n} shows sessions against the weekly target`, /^\d+ \/ 4 this week/.test(hud));
    eq(`HUD at ${n} carries no consecutive-day number or streak word`, NO_DAYCOUNT.test(hud), false);
    eq(`HUD at ${n} uses no shaming word`, SHAME.filter((x) => hud.toLowerCase().includes(x)), []);

    truthy(`the dashboard chip at ${n} renders sessions-vs-target`,
      u.created.some((h) => h.includes(`<span class="chip">${chipTxt}</span>`)));
    truthy(`the chip at ${n} reads "N of 4 ... this week"`, /^\d+ of 4 sessions this week$/.test(chipTxt) || /^Target met · \d+ of 4 this week$/.test(chipTxt));
    eq(`the chip at ${n} carries no consecutive-day number or streak word`, NO_DAYCOUNT.test(chipTxt), false);
    eq(`the chip at ${n} uses no shaming word`, SHAME.filter((x) => chipTxt.toLowerCase().includes(x)), []);

    // met/exceeded says so warmly, and never warns
    if (n >= 4) eq(`at ${n} sessions the target reads as met`, w.met && /target met/i.test(hud) && /Target met/.test(chipTxt), true);
    else eq(`at ${n} sessions an in-progress week is not called a failure`, w.met, false);
  });

  // (3) the target is the profile's, not a hard-coded 4
  const u5 = uiEnv(many(2), 5);
  eq("a custom weeklyTarget of 5 is what the HUD uses", u5.A.weekHudText(u5.A.weekProgress(u5.S.state)), "2 / 5 this week");

  // (4) the engine is untouched: the day-run numbers still exist for saved state
  const ee = env({});
  truthy("Engine.streaks is still exported and still computes day runs",
    typeof ee.E.streaks === "function" && typeof ee.E.summary(ee.S.state).streak.days === "number");

  // (5) the glossary is reconciled: no entry for a term the UI no longer shows
  const G = require(path.join(B, "js", "glossary.js"));
  eq("the glossary has no 'streak' entry (the UI no longer shows the word)",
     G.TERMS.filter((t) => /streak/i.test(t.term) || (t.aliases || []).some((a) => /streak/i.test(a))).map((t) => t.id), []);
}

console.log("=== exercise form cue: full text, real steps, honest provenance ===");
{
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  // the library, straight from the generated bundle
  const lc = { console: { log() {} }, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, module: { exports: {} } };
  lc.globalThis = lc; vm.createContext(lc);
  vm.runInContext(fs.readFileSync(path.join(B, "js", "data.js"), "utf8") + "\n;globalThis.__L=EXERCISE_LIB;", lc, { filename: "data.js" });
  const LIB = lc.__L;

  // (a) no truncation: the kettlebell swing keeps its WHOLE last step
  const kb = LIB.find((e) => e.id === 9);
  truthy("the 2 Handed Kettlebell Swing is in the library", !!kb);
  const kbSteps = kb.d.split("\n");
  eq("its cue is step-structured (4 steps, not one paragraph)", kbSteps.length, 4);
  eq("its LAST step is complete, not cut mid-word",
     kbSteps[3], "Let the kettlebell swing back down, hinge again as it passes between your legs and go straight into the next rep.");
  truthy("its cue is longer than the old 280-char truncation", kb.d.length > 280);
  eq("the old '…then driv' cut-off no longer ends the cue", /\bthen driv$/.test(kb.d), false);
  eq("no cue sits exactly on the 2000-char cap", LIB.filter((e) => e.d.length === 2000).length, 0);

  // (b) a multi-step cue renders as separate STEPS, not one paragraph
  //     (load the real app.js behind a DOM stub, as the HUD section does)
  const mkNode = () => ({ innerHTML: "", className: "", dataset: {}, style: {}, children: [],
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    append() {}, prepend() {}, remove() {}, click() {}, focus() {}, contains: () => false,
    querySelector: () => mkNode(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  const uiStore = {};
  const ui = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => mkNode(), querySelectorAll: () => [], getElementById: () => mkNode(), createElement: () => mkNode(), createElementNS: () => mkNode(), body: mkNode(), visibilityState: "visible", activeElement: null },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (k) => (k in uiStore ? uiStore[k] : null), setItem: (k, v) => { uiStore[k] = String(v); }, removeItem: (k) => { delete uiStore[k]; } },
    Blob: function () {}, URL: { createObjectURL: () => "blob:x" }, module: { exports: {} },
  };
  ui.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
  ui.window = ui; ui.globalThis = ui; vm.createContext(ui);
  vm.runInContext('localStorage.setItem("fitness-app-v1", JSON.stringify({version:1,createdAt:"2026-01-01T00:00:00.000Z",profile:{name:"C",sex:"M",heightCm:180,weightKg:82,weeklyTarget:4,units:"kg"},workouts:[],bodylog:[],overrides:{},custom:[],achievements:{},settings:{seeded:true}}));', ui);
  vm.runInContext(["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/chart.js", "js/app.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n") + "\n;globalThis.__X={App};", ui, { filename: "ui.js" });
  const u = { A: ui.__X.App };
  const multi = u.A.cueBlock({ n: "X", d: "First step.\nSecond step.\nThird step." });
  truthy("a multi-step cue renders an ordered list", /<ol class="cue-steps">/.test(multi));
  eq("…with one <li> per step", (multi.match(/<li>/g) || []).length, 3);
  truthy("…and NOT as one run-on paragraph", !/cue-line/.test(multi));
  truthy("…under a 'How to do it' heading", /How to do it/.test(multi));
  const one = u.A.cueBlock({ d: "Just one instruction." });
  truthy("a single-line cue renders as a readable line, not a 1-item list", /cue-line/.test(one) && !/<ol/.test(one));

  // (c) NO cue -> NOTHING rendered (no empty box, no placeholder)
  eq("an empty cue renders nothing at all", u.A.cueBlock({ d: "" }), "");
  eq("a missing cue renders nothing at all", u.A.cueBlock({}), "");
  eq("a whitespace-only cue renders nothing", u.A.cueBlock({ d: "   \n  " }), "");

  // (d) a gap-filled cue comes from the public-domain source, and says so
  const filled = LIB.filter((e) => e.f === 1);
  truthy("at least one cue was gap-filled from free-exercise-db", filled.length > 0);
  const rd = filled.find((e) => e.n === "Ring Dips");
  truthy("Ring Dips is one of the gap-filled entries", !!rd);
  eq("its first step is the free-exercise-db instruction verbatim",
     rd.d.split("\n")[0], "Grip a ring in each hand, and then take a small jump to help you get into the starting position with your arms locked out.");
  truthy("every gap-filled cue is non-empty", filled.every((e) => e.d.trim().length > 0));
  truthy("a gap-filled entry's block credits free-exercise-db", /free-exercise-db/.test(u.A.cueBlock(rd)));
  truthy("a wger entry's block credits the wger community database", /wger community database/.test(u.A.cueBlock(kb)));
  truthy("the detail modal renders the cue through cueBlock", /\$\{cueBlock\(info\)\}/.test(app));
}

console.log("=== the exercise sheet teaches; the logging controls live in the Log flow ===");
{
  // Load the real app.js behind a stub DOM (as the cue section does) so the
  // sheet's own markup builder can be called against a real state.
  const mkNode = () => ({ innerHTML: "", className: "", dataset: {}, style: {}, children: [],
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    append() {}, prepend() {}, remove() {}, click() {}, focus() {}, contains: () => false,
    querySelector: () => mkNode(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  const uiStore = {};
  const ui = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => mkNode(), querySelectorAll: () => [],
      getElementById: () => mkNode(), createElement: () => mkNode(), createElementNS: () => mkNode(), body: mkNode(),
      visibilityState: "visible", activeElement: null },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (k) => (k in uiStore ? uiStore[k] : null), setItem: (k, v) => { uiStore[k] = String(v); }, removeItem: (k) => { delete uiStore[k]; } },
    Blob: function () {}, URL: { createObjectURL: () => "blob:x" }, module: { exports: {} },
  };
  ui.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
  ui.window = ui; ui.globalThis = ui; vm.createContext(ui);
  vm.runInContext('localStorage.setItem("fitness-app-v1", JSON.stringify({version:1,createdAt:"2026-01-01T00:00:00.000Z",profile:{name:"C",sex:"M",heightCm:180,weightKg:82,weeklyTarget:4,units:"kg"},workouts:[],bodylog:[],overrides:{},custom:[],achievements:{},settings:{seeded:true}}));', ui);
  vm.runInContext(["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/chart.js", "js/app.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n") + "\n;globalThis.__X={App};", ui, { filename: "ui.js" });
  const A = ui.__X.App;

  const lc = { console: { log() {} }, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, module: { exports: {} } };
  lc.globalThis = lc; vm.createContext(lc);
  vm.runInContext(fs.readFileSync(path.join(B, "js", "data.js"), "utf8") + "\n;globalThis.__L=EXERCISE_LIB;", lc, { filename: "data.js" });
  const LIB = lc.__L;

  const src = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  // (a) the two logging controls are gone from the sheet
  eq("the exercise sheet carries no 'Track as' control", /id="dt-mode"/.test(src), false);
  eq("the exercise sheet carries no 'Log this now' button", /id="dt-log"/.test(src), false);
  eq("no listener for either remains", /#dt-mode|#dt-log/.test(src), false);

  // (b) the sheet still TEACHES and still shows the personal target
  const withCue = LIB.find((e) => e.f === 1 && (e.d || "").trim());
  const html = A.exDetailHTML(withCue.id);
  truthy("the sheet keeps the 'How to do it' cue block", /How to do it/.test(html));
  truthy("the sheet keeps the cue's source line", /free-exercise-db/.test(html));
  truthy("the sheet keeps the settable target control", /id="dt-tgt"/.test(html) && /id="dt-tset"/.test(html));
  truthy("the sheet still offers Close", /id="dt-x"/.test(html));
  eq("no 'Track as' text anywhere in the rendered sheet", /Track as/.test(html), false);
  eq("no 'Log this now' text anywhere in the rendered sheet", /Log this now/.test(html), false);

  // (c) the target's mode-dependent label still resolves with NO mode control here
  A.Store.setOverride(withCue.id, { mode: "reps" });
  truthy("in reps mode the label reads 'Target (best)'", /Target \(best\)/.test(A.exDetailHTML(withCue.id)));
  A.Store.setOverride(withCue.id, { mode: "weight_reps" });
  truthy("in weight_reps mode it reads the e1RM label", /Target \(kg e1RM\)/.test(A.exDetailHTML(withCue.id)));
  eq("every non-weight mode resolves to 'best'", ["reps", "time", "weight_time", "distance_time", "weight_distance"].map(A.targetLabelFor),
     ["Target (best)", "Target (best)", "Target (best)", "Target (best)", "Target (best)"]);
  eq("weight_reps is the only e1RM label", A.targetLabelFor("weight_reps"), "Target (kg e1RM)");

  // (d) the one-line scoring note is present and promises only what is true
  truthy("the sheet carries the one-line scoring note", /class="muted small target-note"/.test(html));
  truthy("the note says the target drives the progress line", /drives the progress line/.test(A.TARGET_NOTE));
  truthy("...and that it does not change the score or XP", /doesn't change your score or XP/.test(A.TARGET_NOTE));
  const e2 = env({});
  e2.S.upsertWorkout({ id: "w1", date: "2026-11-07", entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 5 }] }] });
  const xp0 = e2.E.sessionXp(e2.S.state, "w1");
  const att0 = JSON.stringify(e2.E.attributes(e2.S.state, 28));
  e2.S.setTarget(73, 200);
  eq("a personal target does not change session XP", e2.E.sessionXp(e2.S.state, "w1"), xp0);
  eq("a personal target does not change the attribute scores", JSON.stringify(e2.E.attributes(e2.S.state, 28)), att0);

  // (e) the Log flow can pick an arbitrary exercise and set its mode
  truthy("the Log flow offers a search picker", /function exercisePicker\(onPick\)/.test(src));
  truthy("...over the whole library, not a recent/frequent subset", /Search \$\{EXERCISE_LIB\.length\} exercises/.test(src));
  truthy("the Log entry carries the 'Track as' mode select", /track-as-lab">Track as</.test(src) && /class="mini mode-sel"/.test(src));
  truthy("...wired through the shared setTrackMode helper", /setTrackMode\(en\.id, en\.mode\)/.test(src));
  eq("the picker is reached from the Log tab's add button", /#btn-add"\)\.addEventListener\("click", \(\) => exercisePicker\(\(ex\) => addEntry\(ex\)\)\)/.test(src), true);
  // The Library's recent-progress chip opened the sheet via el()'s attrs path,
  // where setAttribute() stringified the arrow function into a dead inline
  // handler. It is wired with addEventListener now, like the list rows.
  truthy("the recent-progress chip is wired, not a dead onclick attribute",
    !/onclick:/.test(src) && /chip\.addEventListener\("click", \(\) => exDetail\(id\)\)/.test(src));
}

console.log("=== the Profile sex control offers a neutral 'Not set' choice ===");
{
  // Load the real app.js behind a stub DOM (as the cue section does) and call the
  // control's own builder, so this tests the markup the Profile screen renders.
  const mkNode = () => ({ innerHTML: "", className: "", dataset: {}, style: {}, children: [],
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
    append() {}, prepend() {}, remove() {}, click() {}, focus() {}, contains: () => false,
    querySelector: () => mkNode(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } });
  const uiStore = {};
  const ui = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => mkNode(), querySelectorAll: () => [],
      getElementById: () => mkNode(), createElement: () => mkNode(), createElementNS: () => mkNode(), body: mkNode(),
      visibilityState: "visible", activeElement: null },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: { getItem: (k) => (k in uiStore ? uiStore[k] : null), setItem: (k, v) => { uiStore[k] = String(v); }, removeItem: (k) => { delete uiStore[k]; } },
    Blob: function () {}, URL: { createObjectURL: () => "blob:x" }, module: { exports: {} },
  };
  ui.Chart = { radar() {}, bars() {}, line() {}, multi() {}, heatmap() {} };
  ui.window = ui; ui.globalThis = ui; vm.createContext(ui);
  vm.runInContext('localStorage.setItem("fitness-app-v1", JSON.stringify({version:1,createdAt:"2026-01-01T00:00:00.000Z",profile:{name:"C",sex:null,heightCm:180,weightKg:82,weeklyTarget:4,units:"kg"},workouts:[],bodylog:[],overrides:{},custom:[],achievements:{},settings:{seeded:true}}));', ui);
  vm.runInContext(["js/data.js", "js/seed.js", "js/engine.js", "js/store.js", "js/chart.js", "js/app.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n") + "\n;globalThis.__X={App};", ui, { filename: "ui.js" });
  const A = ui.__X.App;

  const unset = A.sexFieldHTML({ sex: null });
  const male = A.sexFieldHTML({ sex: "M" });
  const female = A.sexFieldHTML({ sex: "F" });

  eq("the control is a select with id p-sex", /<select class="inp" id="p-sex">/.test(unset), true);
  eq("it OFFERS a neutral 'Not set' option (empty value)", /<option value=""[^>]*>Not set<\/option>/.test(unset), true);
  eq("'Not set' is listed FIRST", unset.indexOf("Not set") < unset.indexOf("Male"), true);
  eq("Male and Female are still offered", /<option value="M"[^>]*>Male<\/option>/.test(unset) && /<option value="F"[^>]*>Female<\/option>/.test(unset), true);
  eq("an unset profile selects 'Not set' (never a silent Male)", /<option value="" selected>Not set<\/option>/.test(unset), true);
  eq("...and Male is NOT the selected option", /value="M" selected/.test(unset), false);
  eq("a legacy empty-string sex reads as 'Not set'", /<option value="" selected>Not set<\/option>/.test(A.sexFieldHTML({ sex: "" })), true);
  eq("a male profile selects Male, not 'Not set'", /<option value="M" selected>Male<\/option>/.test(male) && /value="" selected/.test(male), false);
  eq("a female profile selects Female", /<option value="F" selected>Female<\/option>/.test(female), true);
  // the save path stores the empty choice as null, never coercing it to "M"
  truthy("the save handler stores 'Not set' as null", /p\.sex = g\("#p-sex"\) \|\| null;/.test(fs.readFileSync(path.join(B, "js", "app.js"), "utf8")));

  // A SAFETY threshold chosen for an unset sex must SAY which value was used.
  const noteUnset = A.bfFloorNoteHTML({ sex: null });
  console.log(`        note: ${noteUnset.replace(/<[^>]+>/g, "")}`);
  truthy("the essential-fat note names the value used (13%)", /13%/.test(noteUnset));
  truthy("...and says it is the women's figure", /figure for women/.test(noteUnset));
  truthy("...and that setting the sex may change it", /may change this floor/.test(noteUnset));
  eq("no note is shown for an explicit male", A.bfFloorNoteHTML({ sex: "M" }), "");
  eq("no note is shown for an explicit female", A.bfFloorNoteHTML({ sex: "F" }), "");
  eq("the floor for an unset sex is the protective 13%", A.bfFloorPct(null), 13);
  eq("...the male figure for a man", A.bfFloorPct("M"), 5);
  eq("...the female figure for a woman", A.bfFloorPct("F"), 13);
}

console.log("=== hero sprite slot: an INERT 32x32 GBA harness in the header ===");
{
  /* the owner draws the avatar himself. This pins the SLOT + HARNESS that ship
     now, with NO asset: the slot must be invisible and reserve no space until a
     sheet exists, and the animation must be event-driven, pausable and
     reduced-motion-safe. It is scoped to .topbar because the app already uses
     .hero for the dashboard trainer card. */
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");
  const css  = fs.readFileSync(path.join(B, "css", "style.css"), "utf8");
  const hero = fs.readFileSync(path.join(B, "js", "hero.js"), "utf8");
  const app  = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const header = (html.match(/<header class="topbar">([\s\S]*?)<\/header>/) || [])[1] || "";

  /* (1) the slot is in the header, exactly between .brand and .hud */
  truthy("the sprite slot sits between .brand and .hud in the header",
    /<div class="brand">[\s\S]*?<\/div>\s*<div class="hero"[\s\S]*?<\/div>\s*<div class="hud">/.test(header));
  const slotTag = (header.match(/<div class="hero"[^>]*>/) || [])[0] || "";
  truthy("the slot is a plain div carrying the hero class", /^<div class="hero"/.test(slotTag));
  truthy("...with an id the runtime can find", /id="hero"/.test(slotTag));
  truthy("...decorative (aria-hidden), with no role/tabindex/button/handler",
    /aria-hidden="true"/.test(slotTag) && !/role=|tabindex=|<button|onclick=|onkey/.test(slotTag));
  eq("the slot element is empty (no placeholder child)",
    (header.match(/<div class="hero"[^>]*>([\s\S]*?)<\/div>/) || [])[1], "");

  /* (2) INERT by default: with no asset it draws nothing and reserves no space */
  const block = (css.match(/hero sprite slot \(header\)([\s\S]*?)\/\* -+ tabs/) || [])[1] || "";
  truthy("the default rule hides the slot (no box, no flex gap, no height)",
    /\.topbar \.hero \{[^}]*display:\s*none/.test(block));
  eq("the stylesheet ships NO background-image property (nothing can draw without an asset)",
    /background-image\s*:/.test(block), false);
  eq("the header markup ships no image or url()", /<img|url\(/.test(header), false);
  eq("no sprite asset exists in the repo", fs.existsSync(path.join(B, "img", "hero-sheet.png")), false);

  /* (3) three row classes, each on its own steps() keyframes */
  ["idle", "lift", "celebrate"].forEach((row) => {
    truthy(`a .hero.${row} row class exists`, new RegExp("\\.topbar \\.hero\\." + row + "\\b").test(css));
    truthy(`@keyframes hero-${row} exists`, new RegExp("@keyframes hero-" + row + "\\b").test(css));
    truthy(`.hero.${row} runs hero-${row} with steps(4)`,
      new RegExp("\\.topbar \\.hero\\." + row + "\\s*\\{[^}]*animation:\\s*hero-" + row + "\\s[^;]*steps\\(4\\)").test(css));
  });
  truthy("the rows are idle / lift / celebrate in that order",
    /\.hero\.idle\s*\{[^}]*hero-idle[\s\S]*?\.hero\.lift\s*\{[^}]*hero-lift[\s\S]*?\.hero\.celebrate\s*\{[^}]*hero-celebrate/.test(css));

  /* (4) the geometry is an exact integer DEVICE size */
  truthy("the cell is 64 device px square: calc(64px / 2.625)",
    /width:\s*calc\(64px \/ 2\.625\)/.test(css) && /height:\s*calc\(64px \/ 2\.625\)/.test(css));
  truthy("background-size is the whole 4x3 sheet at 2x (256x192 device px)",
    /background-size:\s*calc\(256px \/ 2\.625\) calc\(192px \/ 2\.625\)/.test(css));
  truthy("the sprite is drawn pixelated",
    /\.topbar \.hero\.idle, \.topbar \.hero\.lift, \.topbar \.hero\.celebrate \{[^}]*image-rendering:\s*pixelated/.test(css));
  truthy("the device arithmetic and the sheet geometry are in ONE comment",
    /DPR = 2\.625/.test(block) && /4 columns x 3 rows/.test(block) && /32 x 32 native px/.test(block));

  /* (5) pause + reduced motion */
  truthy("a .paused class holds the animation",
    /\.topbar \.hero\.paused\s*\{[^}]*animation-play-state:\s*paused/.test(css));
  truthy("visibilitychange toggles .paused (hidden pauses, visible resumes)",
    /visibilitychange/.test(hero) && /classList\.add\("paused"\)/.test(hero) && /classList\.remove\("paused"\)/.test(hero));
  eq("there is exactly ONE prefers-reduced-motion block",
    (css.match(/prefers-reduced-motion/g) || []).length, 1);
  const rm = (css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/) || [])[0] || "";
  truthy("the reduced-motion block holds the hero to ONE static frame (animation: none)",
    /\.topbar \.hero\.idle/.test(rm) && /\.topbar \.hero\.celebrate/.test(rm) && /animation:\s*none/.test(rm));

  /* (6) event-driven, never a timer */
  truthy("the slot is driven from the save path via Hero.play",
    /Hero\.play\(/.test(app) && /typeof Hero !== "undefined"/.test(app));
  truthy("...lift on a fresh session and celebrate on a milestone/target",
    /"celebrate"/.test(app) && /"lift"/.test(app) && /heroPlay\(/.test(app));
  eq("the slot is never driven by a timer", /setInterval|setTimeout/.test(hero), false);
  eq("the slot binds no click/tap handler", /addEventListener\("(click|pointer|touch)/.test(hero), false);
  truthy("the runtime keeps the sheet path in ONE place", /const SHEET = "img\/hero-sheet\.png"/.test(hero));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
