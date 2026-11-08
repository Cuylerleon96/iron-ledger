/* Quick-add and set-row — the two bugs from the phone screenshots.
   Run: node tools/test_quickadd.js

   Two real defects, both reproduced from the owner's screenshots before the fix:

   1. Adding a set through the shorthand box stored the weight in DISPLAY units
      while the manual row inputs stored kg. On lb, every tonnage and e1RM that
      came from the box was inflated by 2.2046x. His own screen proved it: a
      180x12 set read "555.56 e1RM" and "4,762lb tonnage", which is exactly
      180 x 1.4 x 2.2046 and 180 x 12 x 2.2046 — the raw pound number run through
      the kg maths and converted back. A hand-typed 90x20 read 126 / 1,800,
      which is correct. Same app, two paths, two answers.

   2. The set delete handler was bound with $(".x", row), and the "x" between
      weight and reps shared that class. querySelector returns the FIRST match
      in document order, so the handler landed on the multiplication sign: tapping
      X deleted the set, and the visible delete button did nothing.

   The parser lives in app.js behind a DOM, so this file gives it a stub DOM and
   loads the REAL app.js. A copy of the logic could drift; this cannot.
*/
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const near = (label, got, want, tol = 0.02) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${got}${ok ? "" : ` want≈${want}`}`);
  ok ? pass++ : fail++;
};
const truthy = (label, v) => eq(label, !!v, true);

const LB = 2.2046226;

/* A DOM just real enough for app.js to reach its own bottom: it only needs
   #modal to exist and the document/window listeners to be accepted. */
function stubEl() {
  const e = {
    addEventListener() {}, removeEventListener() {}, append() {}, prepend() {},
    setAttribute() {}, removeAttribute() {}, remove() {}, click() {}, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {}, dataset: {}, children: [], innerHTML: "", textContent: "", value: "",
    querySelector: () => stubEl(), querySelectorAll: () => [],
    closest: () => stubEl(), getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
  };
  return e;
}

function load(units) {
  const store = {};
  const el = stubEl();
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: (fn) => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    document: {
      addEventListener() {}, removeEventListener() {},
      querySelector: () => el, querySelectorAll: () => [], getElementById: () => el,
      createElement: () => stubEl(), body: el, visibilityState: "visible",
    },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    Blob: function () {}, URL: { createObjectURL: () => "blob:x" },
    module: { exports: {} },
  };
  s.window = s;
  s.globalThis = s;
  vm.createContext(s);

  const src = ["js/data.js", "js/engine.js", "js/store.js", "js/chart.js", "js/app.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");

  // app.js reads Store.state at load, so the unit has to be in place first
  vm.runInContext(`localStorage.setItem("fitness-app-v1", JSON.stringify({
    version:1, createdAt:"2026-01-01T00:00:00.000Z",
    profile:{name:"the owner",sex:"M",heightCm:180,weightKg:82,units:${JSON.stringify(units)}},
    workouts:[], bodylog:[], overrides:{}, custom:[], achievements:{}, settings:{seeded:true}
  }));`, s);
  vm.runInContext(src + "\n;globalThis.__X={App,Engine,Store,EXERCISE_LIB};", s, { filename: "bundle.js" });
  return { A: s.__X.App, E: s.__X.Engine, S: s.__X.Store, LIB: s.__X.EXERCISE_LIB, win: s };
}

console.log("=== the shorthand box stores kg, whatever the display unit (lb) ===");
{
  const e = load("lb");
  const p = e.A.parseSet("180x12", "weight_reps");
  near("180 lb x 12 parses to kg", p.w, 180 / LB);
  eq("reps are untouched by units", p.r, 12);
  truthy("the parsed weight is NOT the raw 180", p.w !== 180);

  // the assertion that actually matters: the two entry paths must agree
  const typed = e.A.U.wi(180);                       // exactly what the row input stores
  near("shorthand and typing agree to the gram", p.w, typed, 0.0001);

  const fromBox = e.E.entryStats({ mode: "weight_reps", sets: [p] });
  const fromRow = e.E.entryStats({ mode: "weight_reps", sets: [{ w: typed, r: 12 }] });
  eq("tonnage is identical via both paths", fromBox.tonnage, fromRow.tonnage);
  eq("e1RM is identical via both paths", fromBox.est1RM, fromRow.est1RM);
  near("tonnage reads back as the 2160 lb he lifted", e.A.U.w(fromBox.tonnage), 2160, 1);
  near("e1RM reads back as 252 lb", e.A.U.w(fromBox.est1RM), 252, 1);
  console.log(`        (before the fix this was 4,762 lb / 555.56 lb — the bug on his screen)`);
}

console.log("=== kg mode is a no-op, as it must be for existing data ===");
{
  const e = load("kg");
  const p = e.A.parseSet("180x12", "weight_reps");
  eq("180 in kg mode stays 180", p.w, 180);
  eq("weight x time converts too", e.A.parseSet("20x45s", "weight_time").w, 20);
  eq("weight x distance converts too", e.A.parseSet("24x40m", "weight_distance").w, 24);
}

console.log("=== the other modes and the notes importer ===");
{
  const e = load("lb");
  e.A.buildIndex();          // the app builds this in boot(); the stub never boots
  eq("weight x time: 20 lb -> kg", Math.round(e.A.parseSet("20x45s", "weight_time").w * 100) / 100, Math.round((20 / LB) * 100) / 100);
  eq("weight x distance: 24 lb -> kg", Math.round(e.A.parseSet("24x40m", "weight_distance").w * 100) / 100, Math.round((24 / LB) * 100) / 100);
  eq("reps-only mode carries no weight", e.A.parseSet("12", "reps"), { r: 12, rpe: undefined, rest: undefined });
  eq("time-only mode carries no weight", e.A.parseSet("60s", "time"), { t: 60, rpe: undefined, rest: undefined });
  eq("an empty box parses to nothing", e.A.parseSet("   ", "weight_reps"), null);

  // the importer shares parseSet, so it was wrong in exactly the same way
  const notes = e.A.parseNotes("Leg press on hackenschmidt machine:\n1:180x12\n2:190x10");
  eq("the importer found the exercise", notes.length, 1);
  eq("both note lines became sets", notes[0].sets.length, 2);
  near("imported weights are kg, not raw pounds", notes[0].sets[0].w, 180 / LB);
}

console.log("=== a weight field shows display units, storage stays kg ===");
{
  const e = load("lb");
  // what setRow writes into the input, reproduced exactly from the source
  const shown = (s) => {
    let v = s.w;
    if (v !== undefined && v !== null && v !== "") {
      const n = Math.round(Number(e.A.U.w(Number(v))) * 100) / 100;
      v = String(n);
    }
    return v;
  };
  const typed = e.A.U.wi(180);              // user typed 180 lb
  eq("the field reads back as 180, not kg", shown({ w: typed }), "180");
  eq("...and not 81.64662740915384", shown({ w: typed }) !== "81.64662740915384", true);
  // a half-plate load must survive the round trip
  const half = e.A.U.wi(182.5);
  eq("182.5 lb survives the round trip", shown({ w: half }), "182.5");
  eq("an empty field stays empty", shown({}), undefined);
  const kg = load("kg");
  eq("kg mode is a straight pass-through", kg.A.U.w(kg.A.U.wi(102.5)), 102.5);
}

console.log("=== the empty-box path adds a blank set instead of refusing ===");
{
  const src = fs.readFileSync(path.join(B, "js/app.js"), "utf8");
  truthy("doAdd adds an empty set when the box is blank",
    /if \(!qi\.value\.trim\(\)\) \{ en\.sets\.push\(\{\}\); render\(\); return; \}/.test(src));
  truthy("the button is labelled + Add set", /\+ Add set<\/button>/.test(src));
}

console.log("=== the delete button is not the multiplication sign ===");
{
  const src = fs.readFileSync(path.join(B, "js/app.js"), "utf8");
  truthy("the delete handler binds to button.x", /\$\("button\.x", row\)\.addEventListener\("click"/.test(src));
  truthy("the old ambiguous $.x, row) binding is gone", !/\$\("\.x", row\)\.addEventListener/.test(src));
  // the multiplier must no longer be reachable by the .x selector at all
  const multiplierSpans = (src.match(/<span class="times">/g) || []).length;
  eq("every times sign uses its own class", multiplierSpans, 3);
  truthy("no span still claims class x", !/<span class="x">/.test(src));
}

console.log("=== clearing a weight clears it, it does not store NaN ===");
{
  const src = fs.readFileSync(path.join(B, "js/app.js"), "utf8");
  truthy("one rule, guarded against undefined", /if \(k === "w"\) s\.w = v === undefined \? undefined : U\.wi\(v\);/.test(src));
  const e = load("lb");
  const cleared = e.A.U.wi(undefined);
  truthy("the old expression really did produce NaN", Number.isNaN(cleared));
  console.log(`        (undefined / ${LB} = ${cleared})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
