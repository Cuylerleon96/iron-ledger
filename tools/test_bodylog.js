/* Headless check that body composition has ONE source of truth.
   The bodyweight log must drive profile.weightKg AND profile.bodyFatPct, and
   the Vitality score must read body fat from the log rather than a stale copy.
   Run: node tools/test_bodylog.js */
const fs = require("fs"), vm = require("vm");
const store = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const ctx = { console, module: { exports: {} }, localStorage: store, Date, Math, JSON, Object, Array, Set, Map,
  isFinite, parseFloat, parseInt, Number, String, setTimeout, clearTimeout,
  Blob: class {}, URL: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = ["js/data.js", "js/seed.js", "js/engine.js", "js/store.js"].map(f => fs.readFileSync(f, "utf8")).join("\n;\n");
vm.runInContext(src + "\n;globalThis.__X={Engine,Store};", ctx, { filename: "bundle.js" });
const { Engine, Store } = ctx.__X;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const P = () => Store.state.profile;
console.log("--- body composition sync ---");
eq("empty log leaves profile null", [P().weightKg, P().bodyFatPct], [null, null]);

Store.addBodyLog({ date: "2026-01-01", weightKg: 80, bodyFatPct: 22 });
eq("check-in sets BOTH weight and body fat", [P().weightKg, P().bodyFatPct], [80, 22]);

Store.addBodyLog({ date: "2026-02-01", weightKg: 78, bodyFatPct: null });
eq("weight-only check-in advances weight", P().weightKg, 78);
eq("...and does NOT wipe the last known body fat", P().bodyFatPct, 22);

Store.addBodyLog({ date: "2026-02-15", weightKg: 77, bodyFatPct: 20 });
eq("later check-in advances both", [P().weightKg, P().bodyFatPct], [77, 20]);

Store.addBodyLog({ date: "2026-01-15", weightKg: 90, bodyFatPct: 30 });
eq("an OLDER date does not become current", [P().weightKg, P().bodyFatPct], [77, 20]);

Store.addBodyLog({ date: "2026-02-15", weightKg: 76, bodyFatPct: 19 });
eq("re-logging the same date updates in place", [P().weightKg, P().bodyFatPct], [76, 19]);

Store.deleteBodyLog("2026-02-15");
// Remaining log: {01-01: 80,22} {01-15: 90,30} {02-01: 78,null}
// Each field carries forward independently from the newest entry that HAS it —
// you might weigh daily but measure body fat monthly, so a null must not erase
// the last known value. Weight comes from 02-01; body fat from 01-15.
eq("deleting the newest falls back per-field", [P().weightKg, P().bodyFatPct], [78, 30]);

console.log("--- vitality reads the log, not a stale profile copy ---");
P().bodyFatPct = 99;                       // deliberately poison the profile copy
const vit = Engine.attributes(Store.state, 28).VIT;
console.log(`        VIT detail: ${JSON.stringify(vit.detail.used)} score=${vit.score}`);
eq("body fat came from the log (22%), not the poisoned 99", vit.detail.used.includes("body fat"), true);
eq("poisoned value did not drive the score", vit.score < 90, true);

console.log("--- body measurements ride on the same check-in ---");
// Tape measures are stored on the same bodylog entry (one entry per date, one
// field per measurement) and must not be wiped by a later weight-only check-in.
Store.addBodyLog({ date: "2026-03-01", weightKg: 76, waistCm: 84, chestCm: 102, armCm: 36.5 });
const m = Store.state.bodylog.find((b) => b.date === "2026-03-01");
eq("waist is on the check-in", m.waistCm, 84);
eq("chest is on the check-in", m.chestCm, 102);
eq("arm is on the check-in", m.armCm, 36.5);

Store.addBodyLog({ date: "2026-03-08", weightKg: 75.5 });
const m2 = Store.state.bodylog.find((b) => b.date === "2026-03-08");
eq("a weight-only check-in carries no measurement it did not take", m2.waistCm, undefined);
eq("...while the earlier one keeps its measurements", Store.state.bodylog.find((b) => b.date === "2026-03-01").waistCm, 84);

eq("the engine series reads the measurements oldest-first", Engine.bodyMeasureSeries(Store.state, "waistCm").map((p) => p.value), [84]);
eq("the latest reading is reported", Engine.bodyMeasureLatest(Store.state, "armCm").value, 36.5);

const truthy = (label, v) => eq(label, !!v, true);
const iso = (off) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - off);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

console.log("--- the dated profile log: snapshot only on a real change ---");
{
  // weight/body fat are NOT in the log — bodylog is their single dated home.
  const r0 = Store.state.profilelog.length;
  Store.state.profile.heightCm = 180; Store.state.profile.sex = "M";
  Store.state.profile.goalWeightKg = 70; Store.state.profile.weeklyTarget = 4;
  const w1 = Store.recordProfileLog();
  const after1 = Store.state.profilelog.length;
  const w2 = Store.recordProfileLog();              // identical — must write nothing
  const after2 = Store.state.profilelog.length;
  Store.state.profile.heightCm = 181;               // a real change
  const w3 = Store.recordProfileLog();
  const after3 = Store.state.profilelog.length;
  eq("a save that changes a tracked field writes ONE row", after1 - r0, 1);
  eq("...and reports that it wrote", w1, true);
  eq("an identical re-save writes NO row (no duplicates)", after2 - after1, 0);
  eq("...and reports no change", w2, false);
  eq("a later change writes the SECOND row", after3 - after2, 1);
  eq("...and reports that it wrote", w3, true);
  const newest = Store.state.profilelog[Store.state.profilelog.length - 1];
  eq("the newest row carries the changed value", newest.heightCm, 181);
  eq("...and never carries weightKg", "weightKg" in newest, false);
  eq("...nor bodyFatPct", "bodyFatPct" in newest, false);
  console.log(`        rows after change+no-op+change: ${JSON.stringify(Store.state.profilelog)}`);
}

console.log("--- profileAsOf(): the profile in effect at a date ---");
{
  const ps = {
    profile: { heightCm: 170, sex: "M", goalWeightKg: 80, goalBodyFatPct: 12, weeklyTarget: 5, birthYear: 1990, weightKg: 70, bodyFatPct: 18 },
    profilelog: [
      { date: "2026-01-01", heightCm: 180, birthYear: 1990, sex: "M", goalWeightKg: 75, goalBodyFatPct: 15, weeklyTarget: 4 },
      { date: "2026-06-01", heightCm: 170, birthYear: 1990, sex: "M", goalWeightKg: 80, goalBodyFatPct: 12, weeklyTarget: 5 },
    ],
    bodylog: [{ date: "2026-02-01", weightKg: 90, bodyFatPct: 25 }],
  };
  eq("OLD height for a past date", Engine.profileAsOf(ps, "2026-03-01").heightCm, 180);
  eq("OLD goal for a past date", Engine.profileAsOf(ps, "2026-03-01").goalWeightKg, 75);
  eq("NEW height after the change date", Engine.profileAsOf(ps, "2026-07-01").heightCm, 170);
  eq("NEW goal after the change date", Engine.profileAsOf(ps, "2026-07-01").goalWeightKg, 80);
  eq("weight comes from the dated BODY LOG, not a profile copy", Engine.profileAsOf(ps, "2026-03-01").weightKg, 90);
  eq("body fat likewise from the body log", Engine.profileAsOf(ps, "2026-03-01").bodyFatPct, 25);
  eq("current profile when no snapshot exists", Engine.profileAsOf({ profile: { heightCm: 172 } }, "2026-03-01").heightCm, 172);
  // the Store accessor reads the live state
  Store.state.profile.heightCm = 175;
  Store.state.profilelog = [{ date: "2026-01-01", heightCm: 190, sex: "M", goalWeightKg: null, goalBodyFatPct: null, weeklyTarget: 4, birthYear: null }];
  eq("Store.profileAsOf reads the snapshot too", Store.profileAsOf("2026-02-01").heightCm, 190);
}

console.log("--- attributeHistory re-evaluates a past month at the THEN profile ---");
{
  // A real height change mid-history: was 205 cm, changed to 170 cm 60 days ago.
  const mk = (profilelog) => ({
    profile: { sex: "M", heightCm: 170, weightKg: 70, goalWeightKg: null, goalBodyFatPct: null, birthYear: null, weeklyTarget: 4, units: "kg" },
    profilelog,
    bodylog: [{ date: iso(310), weightKg: 70 }],
    workouts: [0, 30, 60, 90, 120, 150, 180].map((o, i) => ({ id: "w" + i, date: iso(o), note: "",
      entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] })),
  });
  const log = [
    { date: iso(300), heightCm: 205, birthYear: null, sex: "M", goalWeightKg: null, goalBodyFatPct: null, weeklyTarget: 4 },
    { date: iso(60), heightCm: 170, birthYear: null, sex: "M", goalWeightKg: null, goalBodyFatPct: null, weeklyTarget: 4 },
  ];
  const h = Engine.attributeHistory(mk(log), 12);
  const early = h.find((p) => p.date < iso(60));     // a month before the height change
  const late = h[h.length - 1];                      // the current month
  // 70 kg at 205 cm = BMI 16.66 -> vitality floors BMI-only reads there (78);
  // at today's 170 cm it is BMI 24.2 -> 100, capped at 85.
  eq("a past month reads the OLD height (BMI 78)", early.scores.VIT, 78);
  eq("a month after the change reads the NEW height (BMI 85)", late.scores.VIT, 85);
  // and prove it WOULD differ under today's height: with no snapshot at all the
  // engine falls back to the current profile, and the same month reads 85.
  const hNow = Engine.attributeHistory(mk([]), 12);
  const earlyNow = hNow.find((p) => p.date < iso(60));
  eq("...where today's height would have read 85", earlyNow.scores.VIT, 85);
  truthy("so the past month actually moved (78 vs 85)", earlyNow.scores.VIT !== early.scores.VIT);
}

console.log("--- migration: a legacy state seeds exactly one snapshot, idempotently ---");
{
  const legacy = Store.migrate({ version: 1, createdAt: "2026-01-01T08:00:00.000Z",
    profile: { name: "L", sex: "M", heightCm: 180, weightKg: 80, bodyFatPct: 15, goalWeightKg: 75, goalBodyFatPct: 12, weeklyTarget: 4, units: "kg", birthYear: 1990 },
    workouts: [], bodylog: [], overrides: {}, custom: [], achievements: {}, targets: {}, settings: { seeded: true } });
  eq("seeds EXACTLY ONE row", legacy.profilelog.length, 1);
  eq("...reports the count a probe can assert", legacy.__profilelogSeeded, 1);
  eq("...dated at state.createdAt", legacy.profilelog[0].date, "2026-01-01");
  eq("...carrying the current tracked fields", [legacy.profilelog[0].heightCm, legacy.profilelog[0].goalWeightKg, legacy.profilelog[0].birthYear], [180, 75, 1990]);
  eq("...and NOT weightKg (single-sourced to the body log)", "weightKg" in legacy.profilelog[0], false);
  eq("...nor bodyFatPct", "bodyFatPct" in legacy.profilelog[0], false);
  const legacy2 = Store.migrate(legacy);
  eq("a SECOND load adds no second row", legacy2.profilelog.length, 1);
  eq("...and reports nothing seeded", legacy2.__profilelogSeeded, 0);
  const noCreated = Store.migrate({ profile: { heightCm: 170 }, workouts: [{ id: "x", date: "2026-03-05", entries: [] }] });
  eq("with no createdAt the seed is dated at the first workout", noCreated.profilelog[0].date, "2026-03-05");
}

console.log("--- export -> import round-trips the profile log ---");
{
  const before = JSON.stringify(Store.state.profilelog);
  const dump = Store.exportJSON();
  Store.reset();
  eq("reset clears the profile log", Store.state.profilelog.length, 0);
  Store.importJSON(dump, "replace");
  eq("export -> import round-trips the profile log", JSON.stringify(Store.state.profilelog), before);
}

console.log("--- sex may be genuinely UNSET (the Profile 'Not set' choice) ---");
{
  // A fresh env built from a given persisted state, so we can prove a save ->
  // reload round-trip. `ls` is returned so the caller can read what was written.
  const freshEnv = (seed) => {
    const ls = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
    if (seed) ls.setItem("fitness-app-v1", JSON.stringify(seed));
    const c = { console, module: { exports: {} }, localStorage: ls, Date, Math, JSON, Object, Array, Set, Map,
      isFinite, parseFloat, parseInt, Number, String, setTimeout, clearTimeout, Blob: class {}, URL: {} };
    c.globalThis = c; vm.createContext(c);
    vm.runInContext(src + "\n;globalThis.__X={Engine,Store};", c, { filename: "bundle.js" });
    return { Engine: c.__X.Engine, Store: c.__X.Store, ls };
  };

  // (1) a fresh install's default sex is unset, NOT silently "M"
  eq("a brand-new profile's sex is unset (null), not silently 'M'", freshEnv().Store.state.profile.sex, null);

  // (2) choosing "Not set" persists through save -> reload -> snapshot
  const f1 = freshEnv();
  f1.Store.state.profile.heightCm = 178; f1.Store.state.profile.birthYear = 1990;
  f1.Store.state.profile.sex = null;              // exactly what the save handler writes for "Not set"
  f1.Store.recordProfileLog();
  f1.Store.save(true);
  eq("the persisted state carries sex:null, not 'M'", JSON.parse(f1.ls.getItem("fitness-app-v1")).profile.sex, null);
  const f2 = freshEnv(JSON.parse(f1.ls.getItem("fitness-app-v1")));
  eq("reload keeps sex unset", f2.Store.state.profile.sex, null);
  const snap = f2.Store.state.profilelog[f2.Store.state.profilelog.length - 1];
  eq("the profile-history snapshot records sex:null (no invented 'M')", snap.sex, null);
  eq("profileAsOf with no date returns null sex, not 'M'", f2.Engine.profileAsOf(f2.Store.state, null).sex, null);
  eq("profileAsOf at a date AFTER the snapshot still returns null sex", f2.Engine.profileAsOf(f2.Store.state, "2099-01-01").sex, null);

  // (3) migrate() neither injects nor drops the sex value
  eq("migrate() leaves a state without sex unset (does not inject 'M')",
    f2.Store.migrate({ version: 1, createdAt: "2026-01-01T00:00:00.000Z", profile: { name: "L", heightCm: 180, weightKg: 80, bodyFatPct: 15 }, workouts: [], bodylog: [] }).profile.sex, null);
  eq("migrate() keeps an explicitly stored sex",
    f2.Store.migrate({ profile: { sex: "M" }, workouts: [], bodylog: [] }).profile.sex, "M");

  // (4) import/merge fill-if-unset: it RESTORES an unset local sex from the file
  //     (copying the user's own backed-up value), and never invents one.
  const f3 = freshEnv();
  f3.Store.importJSON(JSON.stringify({ version: 1, createdAt: "2026-01-01T00:00:00.000Z",
    profile: { name: "C", sex: "F", heightCm: 170, weightKg: 70, units: "kg" }, workouts: [], bodylog: [],
    overrides: {}, custom: [], achievements: {}, settings: { seeded: true } }), "merge");
  eq("merge fills an unset local sex from the imported file (a restore, not a hard-coded 'M')", f3.Store.state.profile.sex, "F");
  const f4 = freshEnv();
  f4.Store.importJSON(JSON.stringify({ version: 1, createdAt: "2026-01-01T00:00:00.000Z",
    profile: { name: "C", heightCm: 170, weightKg: 70, units: "kg" }, workouts: [], bodylog: [],
    overrides: {}, custom: [], achievements: {}, settings: { seeded: true } }), "merge");
  eq("a file with no sex leaves the local sex unset", f4.Store.state.profile.sex, null);

  // (5) an unchanged re-save with sex still unset writes no spurious snapshot row
  const f5 = freshEnv();
  f5.Store.state.profile.sex = null;
  f5.Store.recordProfileLog();
  const rows1 = f5.Store.state.profilelog.length;
  const again = f5.Store.recordProfileLog();
  eq("re-saving with sex still unset writes no second snapshot row", f5.Store.state.profilelog.length, rows1);
  eq("...and reports no change", again, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
