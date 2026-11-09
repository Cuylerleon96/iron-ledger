/* hero.js — the header's avatar sprite slot: RUNTIME ONLY, ships no asset.
   The slot (<div class="hero" id="hero">) sits between .brand and .hud. This
   file is the only thing that ever makes it visible, and only once a sheet is
   actually present — so the repo carries no sprite and the header is untouched
   until the owner drops his art in. All geometry and the frame keyframes live in
   css/style.css (see "hero sprite slot"); this file owns the ONE sheet path and
   the runtime rules:

     * engage  — probe the sheet; on load, set it as the slot's background and
                 add the "idle" row class. No sheet -> the slot stays display:none.
     * play    — swap the row class on an APP EVENT (a logged session -> lift;
                 a weekly target met / PR / badge -> celebrate), else idle. The
                 transient rows hand back to idle on animationend — event-driven,
                 never a per-tab timer.
     * pause   — document.visibilitychange PAUSES the slot while hidden
                 (animation-play-state: paused via the .paused class) and resumes
                 on return. prefers-reduced-motion is handled purely in CSS (it
                 already holds one static frame).

   ONE-FILE SWAP: drop the native-size sheet (4 cols x 3 rows of 32x32 = 128x96)
   at SHEET below. Nothing else changes. */
(() => {
  "use strict";

  /* The ONE thing the owner supplies. Native GBA size, NOT the 2x-drawn cells:
     4 columns x 3 rows of 32x32 = 128x96 px (rows: idle / lift / celebrate).
     Re-point HERE alone if the path changes. */
  const SHEET = "img/hero-sheet.png";

  /* The row classes, in sheet-row order. Kept in step with css/style.css. */
  const ROWS = ["idle", "lift", "celebrate"];

  const slot = () => document.getElementById("hero");
  let live = false;                 // the sheet loaded -> the slot may show

  function play(row) {
    const h = slot();
    if (!h || !live || ROWS.indexOf(row) === -1) return;
    h.classList.remove.apply(h.classList, ROWS);
    h.classList.add(row);
  }

  function engage() {
    const h = slot();
    if (!h || live) return;
    live = true;
    h.style.backgroundImage = 'url("' + SHEET + '")';
    h.classList.add("idle");
    /* a transient row (lift / celebrate) hands back to idle when it finishes */
    h.addEventListener("animationend", () => {
      if (!h.classList.contains("idle")) play("idle");
    });
  }

  /* Background the tab -> hold the current frame; returning resumes it. */
  document.addEventListener("visibilitychange", () => {
    const h = slot();
    if (!h || !live) return;
    if (document.visibilityState === "hidden") h.classList.add("paused");
    else h.classList.remove("paused");
  });

  /* Probe for the sheet. Absent (today) -> stay inert and invisible. */
  function init() {
    const h = slot();
    if (!h) return;                                  // no slot (e.g. an old build)
    try {
      const im = new Image();
      im.onload = engage;
      im.onerror = () => {};                         // no asset yet: remain inert
      im.src = SHEET;
    } catch (e) { /* no Image in this environment — the slot stays hidden */ }
  }

  window.Hero = { play: play, ROWS: ROWS };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
