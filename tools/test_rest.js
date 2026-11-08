/* Rest between sets: logging, and how (and how little) it moves the stats.
   The key claim to hold honest: rest moves STAMINA only. Strength and Power must
   be untouched, because penalising long rest would punish the heavy work they are
   built from. Run: node tools/test_rest.js */
const fs = require("fs"), vm = require("vm");
const store = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } };
const ctx = { console, module: { exports: {} }, localStorage: store, Date, Math, JSON, Object, Array, Set, Map,
  isFinite, parseFloat, parseInt, Number, String, setTimeout, clearTimeout, Blob: class {}, URL: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(["js/data.js", "js/seed.js", "js/engine.js", "js/store.js"].map(f => fs.readFileSync(f, "utf8")).join("\n;\n")
  + "\n;globalThis.__X={Engine,Store};", ctx, { filename: "b.js" });
const { Engine, Store } = ctx.__X;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const D = ["2026-10-20", "2026-10-27", "2026-11-03", "2026-11-07"];

function build({ rest, reps = 5, weight = 100, rpe } = {}) {
  Store.reset();
  Store.addBodyLog({ date: "2026-01-01", weightKg: 82 });
  D.forEach((d, i) => {
    const set = { w: weight, r: reps };
    if (rest !== undefined && rest !== null) set.rest = rest;
    if (rpe) set.rpe = rpe;
    Store.upsertWorkout({ id: "w" + i, date: d, entries: [{ id: 76, name: "Bench Press", mode: "weight_reps", sets: [set] }] });
  });
}

console.log("--- rest is measured ---");
build({ rest: 120 });
eq("explicit per-set rest is averaged", Engine.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 5, rest: 90 }, { w: 100, r: 5, rest: 150 }] }).avgRest, 120);
eq("exercise default fills a blank set", Engine.entryStats({ mode: "weight_reps", restDefault: 75, sets: [{ w: 100, r: 5 }, { w: 100, r: 5 }] }).avgRest, 75);
eq("a set override beats the default", Engine.entryStats({ mode: "weight_reps", restDefault: 75, sets: [{ w: 100, r: 5, rest: 200 }] }).avgRest, 200);
eq("no rest recorded reports null, not a guess", Engine.entryStats({ mode: "weight_reps", sets: [{ w: 100, r: 5 }] }).avgRest, null);

console.log("--- rest moves STAMINA ---");
const short = (() => { build({ rest: 45 }); return Engine.attributes(Store.state, 3650); })();
const long = (() => { build({ rest: 240 }); return Engine.attributes(Store.state, 3650); })();
const none = (() => { build({ rest: null }); return Engine.attributes(Store.state, 3650); })();
console.log(`        END: 45s rest=${short.END.score}  240s rest=${long.END.score}  unlogged=${none.END.score}`);
eq("short rest scores Stamina higher than long rest", short.END.score > long.END.score, true);
eq("unlogged rest still produces a score (older weighting)", none.END.score > 0, true);

console.log("--- and ONLY stamina ---");
eq("Strength identical across rest values", [short.STR.score, long.STR.score], [short.STR.score, short.STR.score]);
eq("Power identical across rest values", [short.POW.score, long.POW.score], [short.POW.score, short.POW.score]);

console.log("--- rest insight fires only when it is actually mismatched ---");
const insight = () => Engine.weakPoints(Store.state, 3650).filter(w => w.kind === "density");
build({ rest: 45, reps: 3 });
console.log("        short rest on 3-rep sets ->", (insight()[0] || {}).title || "(none)");
eq("short rest + heavy sets is flagged", insight().length > 0, true);
build({ rest: 240, reps: 15 });
console.log("        long rest on 15-rep sets ->", (insight()[0] || {}).title || "(none)");
eq("long rest + high-rep sets is flagged", insight().length > 0, true);
build({ rest: 150, reps: 8 });
eq("a sane middle is NOT nagged about", insight().length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
