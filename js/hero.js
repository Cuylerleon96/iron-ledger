/* hero.js — the header's THEATRE DIRECTOR: RUNTIME ONLY, ships no asset.
   The slot (<div class="hero" id="hero">) sits between .brand and .hud. This file
   is the only thing that ever makes it visible, and only once a sheet is present.
   All geometry and the row keyframes live in css/style.css (see "hero sprite
   slot"); this file owns the ONE sheet path and the BEHAVIOUR:

     PROFILE  — a per-tab behaviour table (PROFILE below). Today the Dashboard is
                RANDOMISED (weighted: mostly idle, sometimes a patrol, occasionally
                a full walk -> pickup -> a set -> put down -> walk back workout) and
                every other tab is the idle profile. One entry per tab, ready for
                real per-tab content later.
     PATROL   — horizontal only, confined to the run between .brand and .hud
                MEASURED at runtime with getBoundingClientRect (never a hard-coded
                distance), so it adapts to the real gap and never overlaps the logo
                or the HUD. Vertical movement exists ONLY in the celebrate hop.
     TRANSITIONS — the whole point. Every row of the sheet STARTS and ENDS on the
                same shared NEUTRAL pose (enforced in tools/make_hero_slime.py), so:
                  * a downside/transient row is never interrupted — it chains on
                    `animationend` and lands back on neutral;
                  * the walk is a LOOPING cycle that the director STOPS on a cycle
                    boundary (a neutral frame), so direction only ever flips at a
                    walk's start/end — and the flip lives in `transform: scaleX(-1)`,
                    a property the walk NEVER transitions (the horizontal motion
                    rides `translate`, the only transitioned property), so the
                    mirror SNAPS and is never interpolated through zero;
                  * every position change is a WALK: the start pose is committed
                    with the transition off, so a walk can never animate 0 -> 0 and
                    teleport to the middle;
                  * small SETTLE BEATS (the static neutral `stand`) sit between
                    behaviours so nothing cuts mid-cycle;
                  * the translate duration is DERIVED from the walk cycle
                    (distance / stride-per-cycle * cycle length), so the body does
                    not skate against the bob.
     PAUSE    — document.visibilitychange pauses (class `.paused` + timers cleared);
                returning restarts the current behaviour. prefers-reduced-motion
                holds ONE static neutral frame and never starts the director.

   NO RENDER LOOP: the director schedules only bounded setTimeout beats — no
   requestAnimationFrame and no setInterval.

   ONE-FILE SWAP: drop the native-size sheet (4 cols x 6 rows of 32x32 = 128x192)
   at SHEET below. Nothing else changes. */
(() => {
  "use strict";

  /* The ONE thing the owner supplies. Native size, NOT the 2x-drawn cells:
     4 columns x 6 rows of 32x32 = 128x192 px. Rows, in order:
       0 idle | 1 walk | 2 pickup | 3 lift-a | 4 lift-b | 5 celebrate
     Re-point HERE alone if the path changes. */
  const SHEET = "img/hero-sheet.png";

  /* The row classes, in sheet-row order. Kept in step with css/style.css and
     tools/test_hero_sheet.py (ROW_NAMES). */
  const ROWS = ["idle", "walk", "pickup", "lift-a", "lift-b", "celebrate"];
  const STAND = "stand";                 // the static NEUTRAL frame (row 0 col 0)

  /* Per-row animation durations in ms — MUST match the css/style.css rules
     (the `.topbar .hero.<row>` animation shorthand). Used only as a safety net
     for animationend and to align walk stops to a cycle boundary. */
  const DUR = { idle: 800, walk: 500, pickup: 600, "lift-a": 600, "lift-b": 700, celebrate: 800 };

  /* --- geometry, in ONE place (mirrors css/style.css) ----------------------- */
  const DPR = 2.625;                     // Pixel 6
  const CELL_CSS = 64 / DPR;             // 24.381 CSS px = one 32px cell at 2x
  const STRIDE_CSS = CELL_CSS;           // distance advanced per walk cycle (one
                                         // body width — the slime has no feet, so
                                         // a body-width-per-cycle waddle is the
                                         // stride the art implies)
  const WALK_CYCLE_MS = DUR.walk;        // one full 4-frame walk cycle
  const SETTLE_MS = 140;                 // the neutral settle beat between behaviours

  /* --- the per-tab behaviour PROFILE table ---------------------------------- */
  const IDLE = { kind: "idle" };
  const PROFILE = {
    dash:      { kind: "random" },       // Dashboard: randomised (weighted, seeded)
    log:       IDLE,                     // every other tab is idle for now —
    history:   IDLE,                     // one entry each, ready for content later
    library:   IDLE,
    nutrition: IDLE,
    profile:   IDLE,
  };

  /* --- seeded RNG (mulberry32) + the weighted schedule ---------------------- */
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* The weighted next-behaviour generator. Weights: idle 0.58, patrol 0.27,
     workout 0.15 ("mostly idle; sometimes a patrol; occasionally a workout").
     Consumes r() in a FIXED order per branch, so a given seed is reproducible. */
  function nextEntry(r) {
    const x = r();
    if (x < 0.58) return { k: "idle", dur: Math.round((1.5 + r() * 3.5) * 1000) };
    if (x < 0.85) return { k: "patrol", dir: r() < 0.5 ? 1 : -1 };
    const dir = r() < 0.5 ? 1 : -1;                  // which side it trains on
    const lift = r() < 0.5 ? "lift-a" : "lift-b";
    const reps = 2 + Math.floor(r() * 3);
    return { k: "workout", dir, lift, reps };
  }

  /* A pure, pinnable reference sequence: plan(seed, n). Tests assert it. */
  function plan(seed, n) {
    const r = mulberry32(seed >>> 0), a = [];
    for (let i = 0; i < n; i++) a.push(nextEntry(r));
    return a;
  }

  /* Expand ONE plan entry into the micro-behaviour queue the director executes.
     Pure, so a test can pin the chain. `side` is 1 (right bound) / -1 (left
     bound) / 0 (centre), resolved against the MEASURED run at run time. */
  function expand(entry) {
    const ops = [{ a: "stand" }];
    if (entry.k === "idle") {
      ops.push({ a: "idle", dur: entry.dur });
    } else if (entry.k === "patrol") {
      ops.push({ a: "walkTo", side: entry.dir });
      ops.push({ a: "walkTo", side: 0 });
    } else if (entry.k === "workout") {
      ops.push({ a: "walkTo", side: entry.dir });   // walk out to a side to train
      ops.push({ a: "once", row: "pickup" });       // bend down, grab the dumbbell
      ops.push({ a: "stand" });
      for (let i = 0; i < entry.reps; i++) {        // the set
        ops.push({ a: "once", row: entry.lift });
        ops.push({ a: "stand" });
      }
      ops.push({ a: "once", row: "pickup" });       // set the dumbbell back down
      ops.push({ a: "walkTo", side: 0 });           // walk back to centre
    }
    return ops;
  }

  /* --- patrol clamp (pure) --------------------------------------------------- */
  /* Keep a translateX inside the MEASURED run. If the gap is degenerate (the
     measured right bound is left of the left bound) there is no free run, so
     hold centre (0). */
  function clampPatrol(minX, maxX, x) {
    if (maxX < minX) return 0;
    return x < minX ? minX : (x > maxX ? maxX : x);
  }

  /* --- runtime --------------------------------------------------------------- */
  const slot = () => document.getElementById("hero");
  let h = null;
  let live = false;                      // the sheet loaded -> the slot may show
  let reduced = false;
  let hidden = false;
  let running = false;
  let profile = PROFILE.dash;
  let curTab = "dash";

  let seed = 0;
  let rng = null;
  const sequence = [];                   // every plan entry the director played
  let q = [];                            // the micro-behaviour queue
  let qi = 0;
  let pos = 0;                           // current translateX (CSS px)
  let facing = false;                    // scaleX(-1) mirror state (facing left)
  let walking = false;                   // a walk transition is in flight
  let timers = [];

  function later(fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; }
  function clearTimers() { for (const id of timers) clearTimeout(id); timers = []; }

  function setClass(name) {
    if (!h) return;
    h.classList.remove.apply(h.classList, ROWS.concat([STAND]));
    if (name) h.classList.add(name);
  }

  /* MOTION and MIRROR live in SEPARATE CSS properties on purpose, so the walk can
     transition one of them alone:
       * `translate`  — the horizontal position; the ONLY property ever transitioned;
       * `transform`  — the facing flip (`scaleX(-1)`); NEVER transitioned.
     The old code put BOTH in one `transform` with `transition: transform`, so the
     browser interpolated scaleX from +1 to -1 THROUGH ZERO across the whole walk
     (the sprite mirrored mid-step), and a `measureRun` reflow that left the
     identity committed as the transition's start style made a walk back to centre
     animate 0 -> 0 — the teleport to the middle. Separate properties make the
     mirror un-interpolatable by construction, and the walk's start pose is
     committed (see startWalk) so it always animates from its real `from`. */
  function setMotion(tx) {
    if (!h) return;
    h.style.translate = tx + "px";
  }

  function setFacing(flip) {
    if (!h) return;
    h.style.transform = flip ? "scaleX(-1)" : "";
  }

  /* Both at once — used by the clamp/reset paths, which never run mid-walk. */
  function setTransform(tx, flip) { setMotion(tx); setFacing(flip); }

  /* The MEASURED run: the horizontal gap between .brand's right edge and .hud's
     left edge, in the slot's OWN (untransformed) frame. Never hard-coded.
     NON-DESTRUCTIVE: a transform does not affect LAYOUT, so the slot's neutral
     left edge is simply its rect minus the current `translate` — no property is
     ever suspended or restored. (The old suspend/restore left the identity as the
     committed style, which made a walk's transition animate 0 -> 0 — the teleport
     — and re-snapped the sprite to its target whenever it ran mid-walk, e.g. from
     document.fonts.ready.) */
  function measureRun() {
    if (!h) return { minX: 0, maxX: 0 };
    const e = h.getBoundingClientRect();
    let tx = 0;                                           // in a real browser the rect already
    if (typeof getComputedStyle === "function") {         // carries the transform, so subtract the
      try { tx = parseFloat(getComputedStyle(h).translate) || 0; } catch (err) { tx = 0; }
    }                                                     // animated `translate` to get the neutral edge
    const left = e.left - tx;                             // the slot's untransformed left edge
    const right = e.right - tx;                           // ... and right edge
    const b = document.querySelector(".brand");
    const d = document.querySelector(".hud");
    const br = b ? b.getBoundingClientRect() : e;
    const dr = d ? d.getBoundingClientRect() : e;
    return { minX: br.right - left, maxX: dr.left - right, w: e.width };
  }

  /* Never let the slot sit outside the run: re-measure and pull `pos` back in.
     Called before every behaviour, and again whenever the layout can change
     (a resize, or the web fonts landing and reflowing the header). Skipped while
     the slot has no box yet (display:none before its first row class), whose
     zero-size rect would be a bogus run. */
  function enforceBounds() {
    const B = measureRun();
    if (!(B.w >= 1)) return B;
    const p = clampPatrol(B.minX, B.maxX, pos);
    /* Never re-seat `pos` WHILE A WALK IS IN FLIGHT: writing `translate` then would
       RETARGET the running transition (a re-measure that drifts by a float epsilon
       — e.g. document.fonts.ready firing mid-walk — would churn it). The next op's
       enforceBounds re-clamps on solid ground. */
    if (p !== pos && !walking) { pos = p; setTransform(pos, facing); }
    return B;
  }

  function execOp(op, done) {
    if (!hidden) enforceBounds();                  // never start outside the run
    if (op.a === "stand") { setClass(STAND); later(done, SETTLE_MS); return; }
    if (op.a === "idle") { setClass("idle"); later(done, op.dur || DUR.idle); return; }
    if (op.a === "walkTo") { startWalk(op.side, done); return; }
    if (op.a === "once") { playOnce(op.row, done); return; }
    done();
  }

  /* A transient row: play it ONCE and chain on animationend (never interrupt a
     cycle). A safety timeout covers an animationend that never arrives (a
     backgrounded tab). */
  function playOnce(row, done) {
    setClass(row);
    let fired = false;
    let safety = null;
    const onEnd = (e) => {
      if (e && e.animationName && String(e.animationName).indexOf("hero-") !== 0) return;
      fin();
    };
    function fin() {
      if (fired) return;
      fired = true;
      if (h) h.removeEventListener("animationend", onEnd);
      if (safety) clearTimeout(safety);
      done();
    }
    if (h) h.addEventListener("animationend", onEnd);
    safety = later(fin, (DUR[row] || 600) + 300);
  }

  /* Walk horizontally to one bound, aligned to a whole number of walk cycles so
     the stop lands on the neutral frame and the body never skates. A direction
     flip happens ONLY here (at a walk's start), via the non-transitioned
     `transform: scaleX(-1)` — so the mirror SNAPS and is never interpolated. */
  function startWalk(side, done) {
    const B = measureRun();
    const target = side === 1 ? B.maxX : (side === -1 ? B.minX : 0);
    const to = clampPatrol(B.minX, B.maxX, target);
    const from = pos;
    const dist = Math.abs(to - from);
    if (dist < 0.5) { pos = to; setMotion(to); later(done, SETTLE_MS); return; }
    facing = to < from;                                       // moving left -> face left
    const cycles = Math.max(1, Math.round(dist / STRIDE_CSS));
    const dur = cycles * WALK_CYCLE_MS;
    setClass("walk");
    setFacing(facing);                                        // SNAP the mirror (transform is never transitioned)
    walking = true;
    if (h) {
      /* SEAT the walk's START pose with NO transition and COMMIT it (a forced
         reflow), so the run unambiguously animates from `from` -> `to` rather
         than from whatever style happened to be committed last. */
      h.style.transition = "none";
      setMotion(from);
      void h.offsetWidth;                                     // commit the start pose
      h.style.transition = "translate " + dur + "ms linear";  // speed derived from the cycle
      void h.offsetWidth;
      setMotion(to);                                          // animate from -> to
    }
    pos = to;
    /* End the walk on the transition's OWN end, not a bare timer: page-load jank
       delayed the first transition's first frame, so a fixed setTimeout(dur) then
       fired BEFORE the animation finished and `transition=""` snapped the sprite
       straight to its target. Chaining on `transitionend` (the same idiom the
       transient rows use with `animationend`) keeps the walk synchronised with the
       real motion; a safety timeout covers a missed event (a backgrounded tab). */
    let ended = false;
    const onEnd = (e) => {
      if (e && e.propertyName && e.propertyName !== "translate") return;
      finished();
    };
    function finished() {
      if (ended) return;
      ended = true;
      walking = false;
      if (h) {
        h.removeEventListener("transitionend", onEnd);
        h.style.transition = "";
      }
      done();
    }
    if (h) h.addEventListener("transitionend", onEnd);
    later(finished, dur + 1500);
  }

  function nextEntryRuntime() {
    if (!rng) rng = mulberry32(seed >>> 0);
    const e = nextEntry(rng);            // ONE continuous seeded stream: endless,
    sequence.push(e);                    // never a fixed loop
    if (sequence.length > 256) sequence.shift();
    return e;
  }

  function pump() {
    if (!running || hidden) return;
    if (qi >= q.length) { q = expand(nextEntryRuntime()); qi = 0; }
    execOp(q[qi++], pump);
  }

  function start() {
    if (!live || reduced || running) return;
    running = true;
    if (!rng) rng = mulberry32(seed >>> 0);
    pump();
  }

  function stop() {
    running = false;
    walking = false;
    clearTimers();
  }

  function resetTransform() {
    if (!h) return;
    h.style.transition = "";
    h.style.translate = "none";
    h.style.transform = "none";
    pos = 0; facing = false; walking = false;
  }

  function applyProfile() {
    stop();
    q = []; qi = 0;
    if (profile.kind === "random") start();
    else { resetTransform(); setClass("idle"); }   // idle profile: a plain loop
  }

  /* Switch the tab's behaviour profile. Called by app.js setView. */
  function setTab(tab) {
    if (tab === curTab && running) return;
    curTab = tab;
    profile = PROFILE[tab] || PROFILE.log;         // unknown tab -> the idle profile
    applyProfile();
  }

  /* Keep app.js's event callbacks working: a logged session -> "lift" (mapped to
     lift-a), a milestone -> "celebrate". The transient plays then hands back. */
  function play(row) {
    if (!h || !live) return;
    const r = row === "lift" ? "lift-a" : row;     // back-compat with app.js
    if (ROWS.indexOf(r) === -1) return;
    if (reduced) { setClass(STAND); return; }
    if (running) { q.splice(qi, 0, { a: "stand" }, { a: "once", row: r }); return; }
    playOnce(r, () => setClass("idle"));
  }

  function engage() {
    h = slot();
    if (!h || live) return;
    live = true;
    h.style.backgroundImage = 'url("' + SHEET + '")';
    /* the Dashboard is RANDOMISED per load — seed it now (window.HERO_SEED pins
       it, so the render harness can reproduce an exact sequence). */
    seed = (typeof window.HERO_SEED === "number") ? (window.HERO_SEED >>> 0)
         : ((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    rng = mulberry32(seed);
    try { reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { reduced = false; }
    if (reduced) { setClass(STAND); return; }
    applyProfile();
  }

  /* Background the tab -> pause the director and hold the frame; returning
     resumes by restarting the current behaviour. */
  document.addEventListener("visibilitychange", () => {
    if (!h || !live) return;
    hidden = document.visibilityState === "hidden";
    if (hidden) { h.classList.add("paused"); stop(); }
    else if (!reduced) { h.classList.remove("paused"); start(); }
  });

  /* The header can reflow (a resize, or the web fonts landing) — re-clamp so the
     slot can never be left overlapping the logo or the HUD. */
  function rebind() { if (live && !hidden && !reduced) enforceBounds(); }
  try { window.addEventListener("resize", rebind); } catch (e) { /* none */ }
  try {
    if (document.fonts && document.fonts.ready && document.fonts.ready.then)
      document.fonts.ready.then(rebind);
  } catch (e) { /* none */ }

  /* Probe for the sheet. Absent -> stay inert and invisible. */
  function init() {
    h = slot();
    if (!h) return;                                  // no slot (e.g. an old build)
    try {
      const im = new Image();
      im.onload = engage;
      im.onerror = () => {};                         // no asset yet: remain inert
      im.src = SHEET;
    } catch (e) { /* no Image in this environment — the slot stays hidden */ }
  }

  /* --- continuity predicate (pure) ------------------------------------------- */
  /* The stride speed the walk can never exceed, in CSS px per ms. A sampler that
     sees a bigger x change over a gap than this (times a tolerance that covers
     paint-frame cadence, where a late frame can make one step ~2-3x the nominal
     rate) has caught a TELEPORT — the exact defect this guards against. */
  function walkSpeedCss() { return STRIDE_CSS / WALK_CYCLE_MS; }
  function maxStepFor(dtMs, tol) { return walkSpeedCss() * Math.abs(dtMs) * (tol || 3) + 0.5; }
  /* PURE: true iff every consecutive x change in a sampled trace [{t,x}] is
     bounded by the walk's own speed. A teleport fails it. */
  function traceIsContinuous(samples, tol) {
    for (let i = 1; i < samples.length; i++) {
      const dt = Math.abs(samples[i].t - samples[i - 1].t) || 1;
      const dx = Math.abs(samples[i].x - samples[i - 1].x);
      const bound = maxStepFor(dt, tol);
      if (dx > bound) return { ok: false, i: i, dt: dt, dx: dx, bound: bound };
    }
    return { ok: true, i: -1, dt: 0, dx: 0, bound: 0 };
  }

  /* Exposed surface — runtime + the pinnable pieces tests use. */
  window.Hero = {
    play, setTab, ROWS, PROFILE,
    plan, expand, clampPatrol, mulberry32,
    walkSpeedCss, maxStepFor, traceIsContinuous,
    SEEDS: { STRIDE_CSS, CELL_CSS, WALK_CYCLE_MS, SETTLE_MS, DPR },
    /* live state, for the browser test + debugging */
    state: () => ({
      live, running, hidden, reduced, tab: curTab, profile: profile.kind,
      seed, pos, facing, cls: h ? (h.className || "") : "",
      transform: h ? h.style.transform : "",
      motion: h ? h.style.translate : "",
      bounds: (function () { try { return measureRun(); } catch (e) { return null; } })(),
    }),
    /* test seams */
    _setSeed: (s) => { seed = s >>> 0; rng = mulberry32(seed); },
    _measure: () => measureRun(),
    _start: () => { seed = seed || 1337; rng = mulberry32(seed >>> 0); start(); },
    _stop: stop,
    /* drive ONE micro-behaviour synchronously (the walk/facing pin), and reset
       the transform/facing back to neutral centre. */
    _exec: (op) => execOp(op, () => {}),
    _reset: () => resetTransform(),
    get seed() { return seed; },
    get sequence() { return sequence; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
