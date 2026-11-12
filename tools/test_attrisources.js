/* Attribute single-source-of-truth + state-injection guard.
   Run: node tools/test_attrisources.js

   PINS THE FINDING of the 2026-11-10 audit: the dashboard's Attributes radar and
   its "weak points" cards present the SAME 28-day read of the SAME attribute, so
   for every attribute the radar's value and the card's value must be the SAME
   number — because both come from one call, Engine.attributes(state, 28). The
   apparent POWER/MOBILITY six-point gap was a render-harness artefact (two
   frames built from different injected states), never a product disagreement.

   The suite is deliberately capable of failing: if a future change points one
   surface at a different window or function, the equality below breaks, and the
   non-vacuity check proves the equality is a real constraint (a 7-day read of a
   fixture really does differ from its 28-day read). */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const RS = require("./render_state.js");

const SRC = ["js/data.js", "js/engine.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
const store = {};
const s = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array,
  Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, Set, Map,
  setTimeout, clearTimeout, module: { exports: {} },
  document: { addEventListener() {}, removeEventListener() {} }, window: {},
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
s.globalThis = s; vm.createContext(s);
vm.runInContext(SRC + "\n;globalThis.__X={Engine};", s, { filename: "bundle.js" });
const E = s.__X.Engine;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond) => eq(label, !!cond, true);

/* The value the WEAK-POINT card prints, parsed back out of its own copy — the
   exact string a user reads ("Score NN/100 (tier) — a low read..."). */
function cardScores(state) {
  const out = {};
  for (const w of E.weakPoints(state, 28)) {
    if (w.kind !== "attribute") continue;
    const label = w.title.split(" has room")[0];
    const m = w.detail.match(/Score (\d+)\/100/);
    if (m) out[label] = Number(m[1]);
  }
  return out;
}

const fixtures = [
  ["repo fixture (tools/fixture-state.json)", JSON.parse(fs.readFileSync(path.join(B, "tools/fixture-state.json"), "utf8"))],
  ["multi-week render fixture", RS.buildMultiweekState(new Date())],
];

console.log("\n=== the radar value and the weak-point card value are ONE computation ===");
let cardsSeen = 0, nonVacuous = false;
for (const [name, st] of fixtures) {
  const attrs = E.attributes(st, 28);
  const cards = cardScores(st);
  const keys = Object.keys(cards);
  cardsSeen += keys.length;
  console.log(`  -- ${name}: ${keys.length} low-attribute card(s) [${keys.join(", ") || "none"}]`);
  for (const a of E.ATTRIBUTES) {
    if (!(a.label in cards)) continue;
    // the radar legend/axis shows attrs[a.key].score; the card must show the same
    eq(`  ${a.label}: radar == weak-point card`, cards[a.label], attrs[a.key].score);
  }
  // non-vacuity: a DIFFERENT window really does move these, so the equality bites
  const a7 = E.attributes(st, 7);
  for (const a of E.ATTRIBUTES) {
    if (a7[a.key].score !== attrs[a.key].score) { nonVacuous = true; }
  }
}
ok("at least one low-attribute card was produced (the check is not vacuous)", cardsSeen > 0);
ok("a 7-day read differs from the 28-day read for some attribute (equality bites)", nonVacuous);

/* Prove the guard actually catches a build from a DIFFERENT window: a card drawn
   off a 7-day read would NOT equal the radar's 28-day value for some attribute. */
{
  const diverges = fixtures.some(([, st]) => {
    const a28 = E.attributes(st, 28), a7 = E.attributes(st, 7);
    return E.ATTRIBUTES.some((a) => a7[a.key].score !== a28[a.key].score);
  });
  ok("a 'drifted card' (7-day read) would be caught by the equality above", diverges);
}

console.log("\n=== state-injection guard: no future-dated sessions ===");
{
  // Regression: the shipped multi-week builder lays the CURRENT week on Mon/Wed/Fri,
  // so it MUST not emit a future date whatever day it is run.
  const now = new Date();
  const st = RS.buildMultiweekState(now);
  eq("multi-week fixture has no future-dated session", RS.futureDated(st, now), []);

  // The guard fires on a genuinely future-dated state.
  const bad = JSON.parse(JSON.stringify(st));
  const tomorrow = RS.dstr(new Date(now.getTime() + 86400000));
  bad.workouts.push({ id: "future", date: tomorrow, note: "", entries: [] });
  eq("guard DETECTS the planted future date", RS.futureDated(bad, now), [tomorrow]);
  let threw = false, msg = "";
  try { RS.assertNoFutureDates(bad, now); } catch (e) { threw = true; msg = e.message; }
  ok("assertNoFutureDates THROWS on a future-dated state", threw);
  ok("the error names the offending date", msg.includes(tomorrow));

  // ...and passes a clean state.
  let cleanThrew = false;
  try { RS.assertNoFutureDates(st, now); } catch (e) { cleanThrew = true; }
  ok("assertNoFutureDates PASSES a clean state", !cleanThrew);

  // The real subject export must be clean too (it is only ever injected, never committed).
  const realPath = "/tmp/il-export.json";
  if (fs.existsSync(realPath)) {
    const real = JSON.parse(fs.readFileSync(realPath, "utf8"));
    eq("the real export carries no future-dated session", RS.futureDated(real, now), []);
  } else {
    console.log("  skip  the real export is not present at /tmp (not committed — expected off the render host)");
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
