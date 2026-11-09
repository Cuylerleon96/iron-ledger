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

/* a minimal DOM node: classList + style + attrs + children */
function node() {
  const set = new Set();
  const n = {
    className: "", parentNode: null, _kids: [],
    style: { setProperty(k, v) { this[k] = v; } },
    _attrs: {},
    setAttribute(k, v) { n._attrs[k] = v; },
    appendChild(c) { c.parentNode = n; n._kids.push(c); return c; },
    removeChild(c) { const i = n._kids.indexOf(c); if (i >= 0) n._kids.splice(i, 1); if (c.parentNode === n) c.parentNode = null; return c; },
    classList: {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      contains: (c) => set.has(c),
      _set: set,
    },
    addEventListener() {}, removeEventListener() {},
  };
  return n;
}

/* a minimal element: the node above + a fixed rect */
function el(rect) {
  const n = node();
  n.getBoundingClientRect = () => rect;
  return n;
}

function load(rects) {
  const hero = el(rects.hero), brand = el(rects.brand), hud = el(rects.hud);
  const doc = {
    readyState: "complete",
    getElementById: (id) => (id === "hero" ? hero : null),
    querySelector: (s) => (s === ".brand" ? brand : (s === ".hud" ? hud : null)),
    createElement: () => node(),
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
const tabs = ["dash", "log", "nutrition", "hero", "history", "library", "profile"];
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
   ever touches the mirror, and the direction flip lives in ONE place
   (startWalk), which is only ever entered from a settled neutral pose.
   RE-EXPRESSED (FIX A, the motion-compatibility regression): the mirror now
   rides the INNER `.hero-body` element, NOT the slot — the slot's `transform`
   carries the MOTION (`translateX`) instead, because the individual `translate`
   CSS property needs Chrome 104+ and this app supports Android 5.1. Same intent,
   split carriers: motion on the slot, mirror on the body. */
const hasFlip = (t) => /scaleX\(-1\)/.test(t);
const flipOf = () => H.state().flip;
const motionOf = () => H.state().motion;
H._reset();
eq("reset -> neutral centre, unmirrored",
  [H.state().facing, motionOf(), flipOf()], [false, "none", ""]);
H._exec({ a: "walkTo", side: -1 });
truthy("walking LEFT sets facing", H.state().facing);
truthy("walking LEFT applies the MIRRORED transform scaleX(-1) on the INNER body", hasFlip(flipOf()));
truthy("...and NEVER on the slot (whose transform carries the motion)", !hasFlip(motionOf()));
truthy("walking LEFT lands on the clamped left bound", Math.abs(H.state().pos - minX) < 1e-6);
H._exec({ a: "walkTo", side: 1 });
truthy("walking RIGHT clears the mirror (facing=false)", !H.state().facing);
truthy("walking RIGHT applies NO scaleX(-1)", !hasFlip(flipOf()));
truthy("walking RIGHT lands on the clamped right bound", Math.abs(H.state().pos - maxX) < 1e-6);
H._reset();
H._exec({ a: "walkTo", side: 1 });
truthy("walk RIGHT from centre stays unmirrored", !H.state().facing && !hasFlip(flipOf()));
const before = flipOf();
H._exec({ a: "stand" });
eq("a neutral stand beat does not touch the mirror", flipOf(), before);
H._exec({ a: "once", row: "pickup" });
eq("a transient row does not touch the mirror", flipOf(), before);
H._exec({ a: "idle", dur: 1000 });
eq("an idle beat does not touch the mirror", flipOf(), before);
const src = fs.readFileSync(path.join(B, "js", "hero.js"), "utf8");
eq("the direction flip (`facing = to < from`) appears EXACTLY once in the source",
  src.split("facing = to < from").length - 1, 1);
truthy("that one flip lives inside startWalk (a walk only begins off a neutral frame)",
  /function startWalk[\s\S]*?facing = to < from/.test(src));
truthy("only startWalk assigns the direction; resetTransform only clears it to neutral",
  src.split("facing =").length - 1 === 3);

/* (6) CONTINUITY — the mirror can never be interpolated and the walk can never
   teleport. Two regression tests, one per defect:
     (a) the MOTION rides the slot's `transform: translateX(…)` and is the ONLY
         transitioned property; the MIRROR rides the INNER body's `transform`,
         which carries NO transition at all (css pins `transition: none`), so it
         can only SNAP — and it is applied at a walk's start, before the motion
         transition is armed. The individual `translate`/`rotate`/`scale`
         properties are banned outright (Chrome 104+; minSdkVersion 22);
     (b) a PURE predicate over a sampled trace: every consecutive x change is
         bounded by the walk's own speed — so a recorded teleport FAILS it. */
console.log("=== (6) motion separated from the mirror; no position discontinuity ===");
H._reset();
H._exec({ a: "walkTo", side: -1 });                       // arm a walk (left)
const trAfterWalk = hero.style.transition || "";
truthy("a walk transitions `transform` ONLY (the motion)", /^transform \d+ms linear$/.test(trAfterWalk));
truthy("the mirror does NOT ride the slot's transform, so it cannot be interpolated", !hasFlip(motionOf()));
eq("the mirror lives on the INNER body element", flipOf(), "scaleX(-1)");
truthy("that body element carries NO transition (the mirror SNAPS)", !H._body().style.transition);
eq("the motion is applied to the slot as transform: translateX(…)", motionOf(), `translateX(${minX}px)`);
H._exec({ a: "walkTo", side: 1 });                        // walk right -> mirror cleared
truthy("walking right snaps the mirror off on the body (not via a transition)", flipOf() === "");
truthy("its transition is still `transform` only", /^transform \d+ms linear$/.test(hero.style.transition || ""));
/* every transition literal the source ever writes must be "" or "none" or a
   `transform …ms linear` — and NEVER a mirror, so a flip can never interpolate. */
const trLits = (src.match(/style\.transition\s*=\s*"([^"]*)"/g) || [])
  .map((m) => m.replace(/.*=\s*"/, "").replace(/"$/, ""));
truthy("the source writes at least one transition literal", trLits.length > 0);
truthy("NO transition literal names `scale`; the motion literal names `transform`",
  trLits.every((t) => !/scale/.test(t)) && trLits.some((t) => /^transform/.test(t)));
truthy("the source NEVER sets an individual `translate`/`rotate`/`scale` property",
  !/\.style\.(translate|rotate|scale)\s*=/.test(src));
const seatIdx = src.indexOf('h.style.transition = "none"');
truthy("the start pose is seated with the transition OFF, then COMMITTED (a reflow) before the pump",
  seatIdx !== -1 && /h\.style\.transition = "none";[\s\S]*?setMotion\(from\);[\s\S]*?void h\.offsetWidth;[\s\S]*?h\.style\.transition = "transform/.test(src));
truthy("the transition is armed only AFTER the start pose is committed",
  src.indexOf('h.style.transition = "none"') < src.indexOf('"transform " + dur + "ms linear"'));
/* the CSS must pin the body to NO transition, or the snap could be lost */
const cssSrc = fs.readFileSync(path.join(B, "css", "style.css"), "utf8");
truthy("css/style.css pins .topbar .hero .hero-body to transition: none",
  /\.topbar \.hero \.hero-body\s*\{[^}]*transition:\s*none/.test(cssSrc));
/* (b) the pure continuity predicate */
eq("walkSpeedCss is the stride over one cycle", H.walkSpeedCss(), H.SEEDS.STRIDE_CSS / H.SEEDS.WALK_CYCLE_MS);
const BOUND50 = H.maxStepFor(50);
console.log(`      walk speed = ${(H.walkSpeedCss() * 1000).toFixed(3)} px/s ; bound over 50 ms = ${BOUND50.toFixed(3)} px`);
truthy("the 50 ms step bound is a small fraction of the run (a bound-to-bound jump cannot pass)",
  BOUND50 > 2 && BOUND50 < (maxX - minX) / 4);
const smooth = [];                                        // a synthetic smooth walk across the run
for (let i = 0; i <= 40; i++) smooth.push({ t: i * 50, x: 0 - H.walkSpeedCss() * i * 50 });
eq("a smooth walk trace is CONTINUOUS", H.traceIsContinuous(smooth).ok, true);
const jitter = smooth.map((s, i) => ({ t: s.t, x: s.x + (i % 2 ? 0.4 : -0.4) }));
eq("a smooth walk with sub-pixel sampling jitter is still CONTINUOUS", H.traceIsContinuous(jitter).ok, true);
/* the RECORDED BEFORE defect: the real 20 Hz samples across the teleport
   (walk left to x≈-59.6, then a jump straight to the middle at 0) */
const recordedTeleport = [
  { t: 2750, x: -55.46 }, { t: 2800, x: -57.54 }, { t: 2850, x: -59.61 },
  { t: 2900, x: 0 }, { t: 2950, x: 0 },
];
const verdict = H.traceIsContinuous(recordedTeleport);
eq("the RECORDED teleport (bound -> middle) FAILS the continuity predicate", verdict.ok, false);
truthy("and it fails at the jump, naming the offending step", verdict.i === 3 && verdict.dx > 50);
/* the recorded BEFORE flip: the scale interpolating through zero mid-walk would,
   under the old scheme, also show as a mid-walk sign change — the separation plus
   the non-transitioned flip is what removes it (pinned structurally above). */

console.log("\n=== hero director: the equipped hero + gear are hero-agnostic ===");
{
  /* setHero() takes ONE row from the engine's table — { sheet, filter } — and
     never branches on a hero id. The colourway is a pure CSS filter on the SAME
     sheet, applied to the SPRITE CHILD ONLY (so the gear is never tinted); the
     overlay creation lives on the inner `.hero-body` (so a mirror flips the whole
     creature with its kit). */
  const spriteImg = () => ((H._sprite() && H._sprite().style.backgroundImage) || "");
  truthy("the director exposes setHero and setGear", typeof H.setHero === "function" && typeof H.setGear === "function");
  H.setHero({ sheet: "img/hero-pebble.png", filter: "hue-rotate(-38deg) saturate(1.25)" });
  truthy("setHero points the SPRITE CHILD at the equipped hero's sheet", /hero-pebble\.png/.test(spriteImg()));
  truthy("...and applies the colourway filter to the SPRITE ONLY (never the slot/gear)", H._sprite().style.filter === "hue-rotate(-38deg) saturate(1.25)");
  H.setHero({ sheet: "img/hero-ember.png", filter: "none" });
  truthy("a 'none' colourway clears the filter (Natural)", H._sprite().style.filter === "" || H._sprite().style.filter === "none");
  truthy("...and switches the sheet to the ember wisp", /hero-ember\.png/.test(spriteImg()));
  H.setHero(null);
  truthy("setHero(null) is a no-op (never blanks the equipped hero)", /hero-ember\.png/.test(spriteImg()));
  H.setGear([{ src: "img/gear-headband.png", box: { x: 11, y: 13, w: 10, h: 3, artw: 14, arth: 4, z: "front" } }]);
  const gearKid = (H._body()._kids || []).filter((k) => /hero-gear/.test(k.className || ""))[0];
  truthy("setGear creates the overlay INSIDE the inner body (so the mirror flips it with the creature)", !!gearKid);
  truthy("...and the overlay carries the per-hero box + art size as CSS vars",
    gearKid && gearKid.style["--gx"] === "11" && gearKid.style["--gw"] === "10" && gearKid.style["--artw"] === "14");
  truthy("the director keeps the hero-agnostic surface (ROWS + setTab + setHero + setGear)",
    H.ROWS.length === 6 && typeof H.setTab === "function" && typeof H.setHero === "function" && typeof H.setGear === "function");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
