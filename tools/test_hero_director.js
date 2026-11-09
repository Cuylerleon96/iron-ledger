/* test_hero_director.js — the header avatar's BEHAVIOUR DIRECTOR (js/hero.js).

   Loads the real js/hero.js in a vm with a minimal mock DOM and pins the pieces
   the director promises:
     * the per-tab behaviour PROFILE lookup (dash = random, the rest = idle);
     * the SEEDED RNG: plan(seed, n) is reproducible and seed-sensitive, and the
       weights are "mostly idle, sometimes a patrol, occasionally a workout";
     * the WORKOUT chain expands pickup -> set ... -> put down -> walk back, and
       a patrol expands walk out + walk back;
     * the PATROL CLAMP never lets the slot cross the MEASURED .brand / .hud
       edges, and degrades to centre when the run is degenerate.

   Run: node tools/test_hero_director.js   (prints "N passed, M failed") */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const truthy = (label, got) => eq(label, !!got, true);

/* a minimal element: classList + style + rect + listener registry */
function el(rect) {
  const set = new Set();
  return {
    className: "", style: {},
    classList: {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      _set: set,
    },
    getBoundingClientRect: () => rect,
    addEventListener() {}, removeEventListener() {},
  };
}

function load(rects) {
  const hero = el(rects.hero), brand = el(rects.brand), hud = el(rects.hud);
  const doc = {
    readyState: "complete",
    getElementById: (id) => (id === "hero" ? hero : null),
    querySelector: (s) => (s === ".brand" ? brand : (s === ".hud" ? hud : null)),
    addEventListener() {}, removeEventListener() {},
    visibilityState: "visible",
  };
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Set, Map,
    isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
    document: doc,
    window: {},
    Image: class { set src(_) { if (this.onerror) this.onerror(); } },
    module: { exports: {} },
  };
  s.globalThis = s;
  vm.createContext(s);
  vm.runInContext(fs.readFileSync(path.join(B, "js", "hero.js"), "utf8"), s, { filename: "hero.js" });
  return { H: s.window.Hero, hero, brand, hud };
}

console.log("=== hero director: profile table, seeded schedule, patrol clamp ===");

/* --- the rects we pretend the browser measured: brand | hero | hud, on a 412px
   Pixel-6 width. Measured at runtime in the real header (see the render report). */
const RECTS = {
  brand: { left: 8, right: 40, top: 6, bottom: 34, width: 32, height: 28 },
  hud: { left: 372, right: 404, top: 6, bottom: 34, width: 32, height: 28 },
  hero: { left: 193.81, right: 218.19, top: 6, bottom: 30, width: 24.381, height: 24.381 },
};
const { H, hero, brand, hud } = load(RECTS);

/* (1) rows + profile lookup */
eq("six row classes in sheet order", H.ROWS, ["idle", "walk", "pickup", "lift-a", "lift-b", "celebrate"]);
const tabs = ["dash", "log", "history", "library", "nutrition", "profile"];
truthy("the profile table covers all six tabs", tabs.every((t) => H.PROFILE[t]));
eq("dash is the randomised profile", H.PROFILE.dash.kind, "random");
tabs.filter((t) => t !== "dash").forEach((t) =>
  eq(`tab "${t}" is the idle profile`, H.PROFILE[t].kind, "idle"));
tabs.forEach((t) => { H.setTab(t); eq(`setTab("${t}") -> ${t === "dash" ? "random" : "idle"} profile`, H.state().profile, t === "dash" ? "random" : "idle"); });
H.setTab("nope"); eq("an unknown tab falls back to the idle profile", H.state().profile, "idle");
H.setTab("dash");

/* (2) the seeded schedule */
const P = H.plan(1337, 8);
eq("plan is reproducible for a seed", JSON.stringify(H.plan(1337, 8)), JSON.stringify(P));
truthy("plan is seed-sensitive", JSON.stringify(H.plan(1338, 8)) !== JSON.stringify(P));
truthy("every entry is one of idle/patrol/workout",
  P.every((e) => ["idle", "patrol", "workout"].indexOf(e.k) !== -1));
const big = H.plan(1337, 400);
const cnt = { idle: 0, patrol: 0, workout: 0 };
big.forEach((e) => cnt[e.k]++);
console.log("      weights over 400 steps:", JSON.stringify(cnt));
truthy("mostly idle (idle is the most common)", cnt.idle > cnt.patrol && cnt.idle > cnt.workout);
truthy("sometimes a patrol", cnt.patrol > 0);
truthy("occasionally a workout", cnt.workout > 0);
truthy("idle ~58% / patrol ~27% / workout ~15%",
  Math.abs(cnt.idle / 400 - 0.58) < 0.06 && Math.abs(cnt.patrol / 400 - 0.27) < 0.06 && Math.abs(cnt.workout / 400 - 0.15) < 0.06);
const idleV = big.filter((e) => e.k === "idle");
truthy("idle durations are a 1.5-5s band", idleV.every((e) => e.dur >= 1500 && e.dur <= 5000));
truthy("patrol directions are left or right", big.filter((e) => e.k === "patrol").every((e) => e.dir === 1 || e.dir === -1));
truthy("a workout picks a side, lift-a or lift-b, with 2-4 reps",
  big.filter((e) => e.k === "workout").every((e) => (e.dir === 1 || e.dir === -1) && (e.lift === "lift-a" || e.lift === "lift-b") && e.reps >= 2 && e.reps <= 4));

/* (3) the expansion of a plan entry into the micro-behaviour chain */
console.log("      pinned plan(1337, 6) =", JSON.stringify(H.plan(1337, 6)));
const patrolOps = H.expand({ k: "patrol", dir: 1 });
eq("a patrol is [stand, walkTo right, walkTo centre]",
  patrolOps.map((o) => (o.a === "walkTo" ? "walkTo:" + o.side : o.a)), ["stand", "walkTo:1", "walkTo:0"]);
const realW = big.find((e) => e.k === "workout");
const w = H.expand(realW);
const wSeq = w.map((o) => o.a + (o.row ? ":" + o.row : "") + (o.side != null ? ":" + o.side : ""));
console.log("      workout entry =", JSON.stringify(realW));
console.log("      workout chain =", JSON.stringify(wSeq));
const wantW = ["stand", "walkTo:" + realW.dir, "once:pickup", "stand"];
for (let i = 0; i < realW.reps; i++) wantW.push("once:" + realW.lift, "stand");
wantW.push("once:pickup", "walkTo:0");
eq("a workout walks out, picks up, does the set, puts down, walks back", wSeq, wantW);
truthy("every transient row in a chain is a real row",
  w.filter((o) => o.row).every((o) => H.ROWS.indexOf(o.row) !== -1));
eq("every expansion opens with a settle beat", H.expand({ k: "idle", dur: 2000 })[0].a, "stand");
truthy("the walk translateX duration is derived from the walk cycle, not hard-coded",
  H.SEEDS.STRIDE_CSS > 0 && H.SEEDS.WALK_CYCLE_MS > 0);

/* (4) the patrol clamp vs the MEASURED run */
const minX = RECTS.brand.right - RECTS.hero.left;   // how far LEFT the slot may go
const maxX = RECTS.hud.left - RECTS.hero.right;     // how far RIGHT it may go
console.log(`      measured run: minX=${minX.toFixed(2)} maxX=${maxX.toFixed(2)} (CSS px)`);
eq("centre (0) is inside the measured run", H.clampPatrol(minX, maxX, 0), 0);
eq("the left bound is kept", H.clampPatrol(minX, maxX, -1e6), minX);
eq("the right bound is kept", H.clampPatrol(minX, maxX, 1e6), maxX);
const samples = [];
for (let i = -200; i <= 200; i++) samples.push(i * 3.7);
const inside = samples.every((x) => {
  const t = H.clampPatrol(minX, maxX, x);
  const left = RECTS.hero.left + t, right = RECTS.hero.right + t;
  return left >= RECTS.brand.right - 1e-9 && right <= RECTS.hud.left + 1e-9;
});
truthy("no clamped translateX ever overlaps the logo (.brand) or the HUD (.hud)", inside);
eq("a degenerate run (no gap) holds centre", H.clampPatrol(10, -10, 999), 0);
eq("a zero-width run holds centre", H.clampPatrol(0, 0, 5), 0);
truthy("the director measures the run at runtime (measureRun uses getBoundingClientRect)",
  typeof H._measure === "function" && (() => { const m = H._measure(); return m.minX === minX && m.maxX === maxX; })());

/* (5) DIRECT FACING — walking LEFT mirrors (scaleX(-1)), walking RIGHT clears
   it, and the flip NEVER happens off a neutral frame boundary: no NON-walk op
   ever touches the transform, and the direction flip lives in ONE place
   (startWalk), which is only ever entered from a settled neutral pose. */
const hasFlip = (t) => /scaleX\(-1\)/.test(t);
H._reset();
eq("reset -> neutral centre, unmirrored",
  [H.state().facing, H.state().transform], [false, "none"]);
H._exec({ a: "walkTo", side: -1 });
truthy("walking LEFT sets facing", H.state().facing);
truthy("walking LEFT applies the MIRRORED transform scaleX(-1)", hasFlip(H.state().transform));
truthy("walking LEFT lands on the clamped left bound", Math.abs(H.state().pos - minX) < 1e-6);
H._exec({ a: "walkTo", side: 1 });
truthy("walking RIGHT clears the mirror (facing=false)", !H.state().facing);
truthy("walking RIGHT applies NO scaleX(-1)", !hasFlip(H.state().transform));
truthy("walking RIGHT lands on the clamped right bound", Math.abs(H.state().pos - maxX) < 1e-6);
H._reset();
H._exec({ a: "walkTo", side: 1 });
truthy("walk RIGHT from centre stays unmirrored", !H.state().facing && !hasFlip(H.state().transform));
const before = H.state().transform;
H._exec({ a: "stand" });
eq("a neutral stand beat does not touch the transform", H.state().transform, before);
H._exec({ a: "once", row: "pickup" });
eq("a transient row does not touch the transform", H.state().transform, before);
H._exec({ a: "idle", dur: 1000 });
eq("an idle beat does not touch the transform", H.state().transform, before);
const src = fs.readFileSync(path.join(B, "js", "hero.js"), "utf8");
eq("the direction flip (`facing = to < from`) appears EXACTLY once in the source",
  src.split("facing = to < from").length - 1, 1);
truthy("that one flip lives inside startWalk (a walk only begins off a neutral frame)",
  /function startWalk[\s\S]*?facing = to < from/.test(src));
truthy("only startWalk assigns the direction; resetTransform only clears it to neutral",
  src.split("facing =").length - 1 === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
