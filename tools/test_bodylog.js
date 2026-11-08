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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
