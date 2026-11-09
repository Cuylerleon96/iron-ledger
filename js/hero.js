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
                    walk's start/end — and the flip lives in `transform: scaleX(-1)`
                    on an INNER element (`.hero-body`) that the walk NEVER touches,
                    while the horizontal motion rides the SLOT's own
                    `transform: translateX(...)`, the ONLY transitioned property, so
                    the mirror SNAPS and is never interpolated through zero;
                  * MOTION and MIRROR live on TWO SEPARATE ELEMENTS. The individual
                    transform properties (`translate`/`rotate`/`scale`) need Chrome
                    104+ and this app's minSdkVersion is 22, so they are BANNED here
                    (tools/test_css_compat.js fails the build if one comes back):
                    motion is `transform: translateX(…)` with `transition: transform`
                    on the slot, the mirror is `transform: scaleX(-1)` with NO
                    transition on the body;
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

  /* The DEFAULT hero (the from-the-start slime). The EQUIPPED hero's sheet is
     looked up from the engine's ONE table (Engine.heroItems) and applied with
     setHero(); this constant is only the fallback so the director still draws
     when the table is not present (an old build, a bare test sandbox).
     Re-point HERE alone if the default path changes. */
  const DEFAULT_SHEET = "img/hero-sheet.png";
  let SHEET = DEFAULT_SHEET;             // the equipped hero's sheet (see setHero)

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
    nutrition: IDLE,                     // one entry each, ready for content later
    hero:      IDLE,
    history:   IDLE,
    library:   IDLE,
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

  /* MOTION and MIRROR live in SEPARATE CSS PROPERTIES, on SEPARATE ELEMENTS, so
     the walk can transition one of them alone:
       * the SLOT's `transform: translateX(…)` — the horizontal position; the ONLY
         property ever transitioned (`transition: transform <dur>ms linear`);
       * the INNER `.hero-body`'s `transform: scaleX(-1)` — the facing flip; NEVER
         transitioned (its own CSS pins `transition: none`), so it can only SNAP.
     The old code put BOTH in one `transform` with `transition: transform`, so the
     browser interpolated scaleX from +1 to -1 THROUGH ZERO across the whole walk
     (the sprite mirrored mid-step), and a `measureRun` reflow that left the
     identity committed as the transition's start style made a walk back to centre
     animate 0 -> 0 — the teleport to the middle. Two elements make that impossible
     by construction, and the walk's start pose is still committed (see startWalk).
     HOWEVER: the individual `translate` / `rotate` / `scale` CSS properties need
     Chrome 104+; this app declares minSdkVersion 22, so on an older System WebView
     they are IGNORED (the creature animated its frames but never moved — it read
     as "no animation" in a weird place). Everything here therefore uses the
     universally-supported `transform: translateX(…)`, and tools/test_css_compat.js
     fails if an individual transform property ever comes back. */
  function setMotion(tx) {
    if (!h) return;
    h.style.transform = "translateX(" + tx + "px)";
  }

  /* The facing flip rides the INNER body element, so the slot's `transform` is
     free for the motion alone. The body has NO transition (css/style.css), so the
     mirror snaps. */
  function setFacing(flip) {
    const b = ensureBody();
    if (b) b.style.transform = flip ? "scaleX(-1)" : "";
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
  /* The translateX currently applied by the slot's `transform`, in CSS px, read
     from the COMPUTED matrix (a transform never affects layout, so the slot's
     neutral left edge is its rect minus this). Pure string -> number; "none" or
     an unexpected form -> 0. Named `motionX`, never a second source of truth: it
     only READS what setMotion wrote. */
  function motionX(computed) {
    if (!computed || computed === "none") return 0;
    const m = /matrix\(([^)]+)\)/.exec(computed);
    if (!m) return 0;
    const v = m[1].split(",");
    return parseFloat(v[4]) || 0;
  }

  function measureRun() {
    if (!h) return { minX: 0, maxX: 0 };
    const e = h.getBoundingClientRect();
    let tx = 0;                                           // in a real browser the rect already
    if (typeof getComputedStyle === "function") {         // carries the transform, so subtract the
      try { tx = motionX(getComputedStyle(h).transform); } catch (err) { tx = 0; }
    }                                                     // animated translateX to get the neutral edge
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
    /* START FROM WHERE THE SPRITE ACTUALLY IS, never from the remembered target:
       if anything ever left the rendered position behind `pos` (a stray end, a
       re-measure, a dropped frame) then seating `pos` SNAPS the creature across
       the run — the teleport. The computed matrix is the one truth for "where it
       is right now"; `pos` is only the fallback for a DOM-less stub. */
    let from = pos;
    try {
      if (h && typeof getComputedStyle === "function") {
        const x = motionX(getComputedStyle(h).transform);
        if (isFinite(x)) from = x;
      }
    } catch (err) { /* keep pos */ }
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
      h.style.transition = "transform " + dur + "ms linear"; // speed derived from the cycle
      void h.offsetWidth;
      setMotion(to);                                          // animate from -> to
    }
    pos = to;
    /* A walk ends when the creature has ARRIVED — never on a stray event. The
       slot's `transitionend` listener also catches events that BUBBLE from its
       children, and a superseded transition can deliver one too; either used to
       end the walk mid-flight, so the class advanced while the slot was still
       gliding and the NEXT walk seated its start from `pos` (already the target)
       — a snap of up to a full run-width. The end is therefore gated on the
       slot's OWN transition AND on the position actually having reached `to`; a
       premature end simply re-checks. The hard cap (dur + 3000) keeps an
       unreachable target from wedging the director. */
    const startedAt = Date.now();
    let ended = false;
    function arrived() {
      if (!h || typeof getComputedStyle !== "function") return true;   // no-computed env: trust the event
      try { return Math.abs(motionX(getComputedStyle(h).transform) - to) < 0.75; }
      catch (err) { return true; }
    }
    function finished() {
      if (ended) return;
      if (!arrived() && (Date.now() - startedAt) < dur + 3000) { later(finished, 120); return; }
      ended = true;
      walking = false;
      if (h) {
        h.removeEventListener("transitionend", onEnd);
        h.style.transition = "";
      }
      done();
    }
    const onEnd = (e) => {
      if (e && e.target && e.target !== h) return;            // a bubbled child event is not this walk's
      if (e && e.propertyName && e.propertyName !== "transform") return;
      finished();
    };
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
    h.style.transform = "none";
    const b = (bodyEl && bodyEl.parentNode === h) ? bodyEl : null;
    if (b) b.style.transform = "";
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

  /* --- the equipped hero + its cosmetics (WYSIWYG) -------------------------
     The director never branches on a hero id: setHero() takes ONE row from the
     engine's table (Engine.heroItems) — { sheet, filter } — and setGear() takes
     the equipped overlays with their COMPUTED geometry (Engine.gearBox). The
     colourway is a pure CSS `filter` on the SAME sheet (zero new art), applied to
     THE SPRITE ONLY so it never tints the gear (a garment is its own cloth).

     LAYERING. The sprite is drawn on an inner `.hero-sprite` element (created
     here, never in index.html, so the static header markup stays image-free).
     That is what lets a "behind" overlay (the cape) really sit BEHIND the body:
     a CSS background cannot be occluded by a child, but a sibling can. The gear
     overlays are positioned by the SAME cell-unit mechanism as the stage
     (css/style.css `.gear-overlay`: left/top/width/height = --cell · v/32), so
     the header (--cell 24.375), the roster (64) and the stage (128) share ONE
     formula and there are no 128/64/100% hard-codes left. */
  let filterCss = "";
  let gearSrcs = [];
  let gearImgs = [];
  let bodyEl = null;                     // the INNER flip element (motion vs mirror)
  let spriteEl = null;

  /* The INNER body element, created lazily. It wraps the sprite AND every gear
     overlay, so a facing flip turns the whole creature with its kit, while the
     SLOT's `transform` stays free for the motion. Returns null when this
     environment has no real DOM (the vm test stubs), in which case the sheet is
     painted on the slot itself and the mirror is simply not drawn — the director
     still runs. */
  function ensureBody() {
    if (bodyEl && bodyEl.parentNode === h) return bodyEl;
    if (typeof document === "undefined" || !document.createElement || !h) return null;
    try {
      const b = document.createElement("span");
      b.className = "hero-body";
      b.setAttribute("aria-hidden", "true");
      h.appendChild(b);
      bodyEl = b;
      return bodyEl;
    } catch (e) { bodyEl = null; return null; }
  }

  /* The sprite child, created lazily inside the body (so the cape can really sit
     BEHIND the body, and the mirror flips the sprite with the gear). Returns null
     when this environment has no real DOM; the slot then carries the background. */
  function ensureSprite() {
    const body = ensureBody();
    const parent = body || h;
    if (spriteEl && spriteEl.parentNode === parent) return spriteEl;
    if (typeof document === "undefined" || !document.createElement || !h) return null;
    try {
      const s = document.createElement("span");
      s.className = "hero-sprite";
      s.setAttribute("aria-hidden", "true");
      parent.appendChild(s);
      spriteEl = s;
      spriteEl.style.backgroundImage = 'url("' + SHEET + '")';
      return spriteEl;
    } catch (e) { spriteEl = null; return null; }
  }

  function setSheetImage() {
    if (!h) return;
    const css = 'url("' + SHEET + '")';
    const s = ensureSprite();
    try {
      if (s) { s.style.backgroundImage = css; h.style.backgroundImage = ""; }
      else { h.style.backgroundImage = css; }
    } catch (e) { /* decorative */ }
  }

  function applyFilter() {
    if (!h) return;
    const target = (spriteEl && spriteEl.parentNode) ? spriteEl : h;
    try { target.style.filter = filterCss || ""; } catch (e) { /* decorative */ }
  }

  function applyDecor() {
    if (!h) return;
    applyFilter();
    const parent = (bodyEl && bodyEl.parentNode === h) ? bodyEl : h;
    for (const im of gearImgs) { try { if (im.parentNode === parent) parent.removeChild(im); } catch (e) { /* none */ } }
    gearImgs = [];
    if (!gearSrcs.length) return;
    if (typeof document === "undefined" || !document.createElement) return;
    for (const g of gearSrcs) {
      try {
        const im = document.createElement("span");
        im.className = "hero-gear gear-overlay " + (g.box && g.box.z === "behind" ? "behind" : "front");
        im.setAttribute("aria-hidden", "true");
        const b = g.box || { x: 0, y: 0, w: 32, h: 32, artw: 32, arth: 32 };
        im.style.setProperty("--gx", String(b.x));
        im.style.setProperty("--gy", String(b.y));
        im.style.setProperty("--gw", String(b.w));
        im.style.setProperty("--gh", String(b.h));
        im.style.setProperty("--artw", String(b.artw || b.w));
        im.style.setProperty("--arth", String(b.arth || b.h));
        im.style.backgroundImage = 'url("' + g.src + '")';
        parent.appendChild(im);
        gearImgs.push(im);
      } catch (e) { /* a stub without appendChild simply shows no overlay */ }
    }
  }

  /* Apply the equipped hero: its sheet + its colourway filter. Called by app.js
     on boot and on every equip. Never called with a locked item. */
  function setHero(item) {
    if (!item) return;
    SHEET = item.sheet || DEFAULT_SHEET;
    filterCss = (item.filter && item.filter !== "none") ? item.filter : "";
    if (h) {
      setSheetImage();
      applyDecor();
    }
  }

  /* Apply the equipped gear overlays. Each entry is an overlay object
     { src, box } (box in CELL UNITS from Engine.gearBox); a bare string is
     accepted for a back-compat call and pinned over the whole cell. */
  function setGear(list) {
    gearSrcs = (Array.isArray(list) ? list : [])
      .map((x) => (typeof x === "string" ? { src: x, box: null } : (x && typeof x.src === "string" ? x : null)))
      .filter(Boolean);
    applyDecor();
  }

  function engage() {
    h = slot();
    if (!h || live) return;
    live = true;
    setSheetImage();
    applyDecor();
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
    play, setTab, setHero, setGear, ROWS, PROFILE,
    plan, expand, clampPatrol, mulberry32,
    walkSpeedCss, maxStepFor, traceIsContinuous,
    SEEDS: { STRIDE_CSS, CELL_CSS, WALK_CYCLE_MS, SETTLE_MS, DPR },
    /* live state, for the browser test + debugging */
    state: () => ({
      live, running, hidden, reduced, tab: curTab, profile: profile.kind,
      seed, pos, facing, cls: h ? (h.className || "") : "",
      motion: h ? h.style.transform : "",                 // the slot: transform: translateX(…)
      transform: h ? h.style.transform : "",              // alias (same value)
      flip: (bodyEl && bodyEl.parentNode === h) ? bodyEl.style.transform : "",
      bounds: (function () { try { return measureRun(); } catch (e) { return null; } })(),
    }),
    /* test seams */
    _setSeed: (s) => { seed = s >>> 0; rng = mulberry32(seed); },
    _measure: () => measureRun(),
    _body: () => ((bodyEl && bodyEl.parentNode === h) ? bodyEl : null),
    _sprite: () => spriteEl,
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
