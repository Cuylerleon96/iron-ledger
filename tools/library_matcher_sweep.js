/* Matcher sweep (audit 2026-11-10) — every classifier in js/engine.js is a
   NAME REGEX, so a word merely APPEARING in a name drags a movement into an axis.
   This dumps, for all 954 rows, the exported matchers' verdicts so the OVER-catch
   (a word-bound token firing wrongly) and UNDER-catch (genuine work with no
   keyword) classes are visible as data, not asserted from memory.

   Run: node tools/library_matcher_sweep.js > tools/library-matcher-sweep.tsv  */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const SRC = ["js/data.js", "js/engine.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
const s = {
  console: { log() {}, warn() {}, error() {}, info() {} },
  Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
  isFinite, parseInt, parseFloat, Set, Map, setTimeout, clearTimeout,
  document: { addEventListener() {}, removeEventListener() {} }, window: {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  module: { exports: {} },
};
s.globalThis = s; vm.createContext(s);
vm.runInContext(SRC + "\n;globalThis.__X={Engine,EXERCISE_LIB};", s, { filename: "bundle.js" });
const { Engine: E, EXERCISE_LIB: LIB } = s.__X;
const NIL = { overrides: {}, custom: [] };
const NILBW = { overrides: {}, custom: [] };

const cols = ["id", "name", "mode", "isMobility", "isEndRangeHinge", "isIsolation",
              "isBodyweight", "workFactor", "plyoMatch"];
const out = [cols.join("\t")];
for (const e of LIB) {
  const n = e.n;
  const plyo = /jump|plyo|\bhops?\b|bound|throw|slam|explosive|kettlebell swing|push press|snap ?down/i.test(n);
  out.push([e.id, n.replace(/\t/g, " "), e.m,
            E.isMobility(n), E.isEndRangeHinge(n), E.isIsolation(NIL, e.id),
            E.isBodyweight(n), E.workFactor(n), plyo].join("\t"));
}
process.stdout.write(out.join("\n") + "\n");
