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

const iso = (off) => { const d = new Date(); d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); };

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

console.log("=== deleting a custom exercise detaches its logged sets ===");
{
  const e = env({});
  e.S.addCustom({ id: "uz", n: "Typo Machien Press", c: "Chest", p: ["Chest"], s: [], e: ["Machine"], m: "weight_reps", g: ["Chest"], d: "" });
  e.S.upsertWorkout({ id: "wz", date: "2026-10-01", entries: [{ id: "uz", name: "Typo Machien Press", mode: "weight_reps", sets: [{ w: 40, r: 10 }] }] });
  eq("the custom exercise feeds its group into the analysis", e.E.exGroups(e.S.state, "uz"), ["Chest"]);
  e.S.deleteCustom("uz");
  eq("it is gone from the custom list", e.S.state.custom.length, 0);
  eq("its logged sets stay on the workout (no silent data loss)", e.S.state.workouts.length, 1);
  eq("...and the entries are untouched", e.S.state.workouts[0].entries.length, 1);
  eq("it no longer contributes any muscle group", e.E.exGroups(e.S.state, "uz"), []);
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
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
