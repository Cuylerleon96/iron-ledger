/* welcome.js — the first-run walkthrough.
   A short, multi-page tour shown ONCE, the first time a build is opened, so a
   brand-new user is not dropped into an empty dashboard with no idea what the
   six attributes or the muscle-balance figure are.

   ONCE-ONLY CONTRACT (the whole point of this file):
     * The flag lives in the persisted state: S.settings.welcomeSeenVersion.
     * It shows when the stored value does NOT equal the CURRENT TOUR CONTENT
       revision, WELCOME_VERSION — NOT the app version. The user asked for a
       walkthrough that runs EXACTLY ONCE; keying the flag on the app version made
       it re-arm on every release. That was a regression and this is the fix.
     * A MISSING flag means "show it" — so an existing install that predates this
       feature sees the tour exactly once, and a fresh install sees it once too.
     * There is deliberately NO migration that INVENTS the flag: a state with no
       welcomeSeenVersion is left exactly as it is, so the tour still shows for it.
       Do not add one. What reconcileSeen() does add is the OPPOSITE of a backfill:
       a state that ALREADY carries a value that is not a valid WELCOME_VERSION —
       which can only be an APP-version string ("1.0.37") written by the build
       before the arming moved onto WELCOME_VERSION — is treated as seen and
       rewritten to the current revision. Present means seen; the flag is written
       only when the tour was dismissed, never by merely opening it. Without this,
       such a state can never equal "1" and its owner would see the tour one more
       time on the very update that was supposed to stop that.
     * The only way to see it again is to bump WELCOME_VERSION, and only when the
       tour's own pages or copy actually change. A release version bump alone must
       NOT re-show it.
   APP_VERSION (below) is the build's own version, kept for display. It is NOT
   hand-kept: tools/build_www.py OVERWRITES it in the built bundle with
   android/version.properties' versionName (the build fails loudly if the anchor
   line is missing). It plays NO part in arming the tour. WELCOME_VERSION is a
   separate, hand-kept CONTENT revision — bump it only when the pages change.

   It never blocks the app: it is a modal overlay opened AFTER the first paint.
   Every control does something — Skip dismisses and persists, the dots jump to a
   page, Next advances and Done finishes. Closing it any other way (backdrop tap,
   hardware back) also records the version, so "exactly once" cannot leak. */
const Welcome = (() => {
  "use strict";

  /* The app version this build is. INJECTED at build time from
     android/version.properties (versionName) by tools/build_www.py. "0.0.0" is
     only the un-built placeholder. DISPLAY ONLY — the tour's arming does NOT
     depend on it, so shipping a new release does not re-show the walkthrough. */
  const APP_VERSION = "0.0.0";

  /* The CONTENT revision of the tour itself. The seen-flag is armed by THIS, not
     by APP_VERSION: bump it ONLY when these pages or their copy change, so the
     walkthrough runs exactly once across any number of releases. */
  const WELCOME_VERSION = "2";

  /* In order: what the app is; shorthand logging; the six attributes; muscle
     balance & weak points; nutrition & scanning; the Hero tab; badges; where data
     lives / backups; the self-update path. */
  const PAGES = [
    {
      title: "LOCAL-ONLY. NO ACCOUNT.",
      body:
        `<p>Iron Ledger is a workout tracker that keeps everything on this device.</p>
         <p>There is <b>no account, no sign-in, and no telemetry</b> \u2014 nothing about your training is ever sent anywhere. It works with no signal at all.</p>
         <p class="muted small">What you enter stays here. Taking a copy off the phone is your call, and that is covered a few screens on.</p>`,
    },
    {
      title: "LOG A SET IN SHORTHAND",
      body:
        `<p>Type the same format you already use in your notes app: an exercise name ending in a colon, then numbered set lines.</p>
         <code class="ex">Bench press machine:
1:100x10
2:100x10
3:110x3</code>
         <p><b>100x10</b> is weight \u00d7 reps. Add effort with <b>@</b>, e.g. <code>100x10@8</code>, and rest with <b>r</b>, e.g. <code>r90</code>.</p>
         <p>Use <b>Paste from notes</b> on the Log screen to bring in a whole session, or type one line into an exercise's box to add a single set.</p>`,
    },
    {
      title: "SIX ATTRIBUTES",
      body:
        `<p>Your training is read back as six scores, each 0\u2013100, rebuilt from the last 28 days:</p>
         <div class="welcome-attrs">
           <div class="welcome-attr"><b>STRENGTH</b><span>how much you lift for your bodyweight.</span></div>
           <div class="welcome-attr"><b>STAMINA</b><span>cardio, and how hard you can keep working.</span></div>
           <div class="welcome-attr"><b>POWER</b><span>explosive work \u2014 heavy low-rep sets and plyos.</span></div>
           <div class="welcome-attr"><b>MOBILITY</b><span>range and control work \u2014 stretching and drills.</span></div>
           <div class="welcome-attr"><b>DISCIPLINE</b><span>how often you turn up.</span></div>
           <div class="welcome-attr"><b>VITALITY</b><span>body composition from your weigh-ins.</span></div>
         </div>`,
    },
    {
      title: "MUSCLE BALANCE & WEAK POINTS",
      body:
        `<p><b>Muscle balance</b> shows, for each muscle group, the <b>effort sets per week</b> \u2014 sets weighted by how hard the movement is \u2014 next to the raw set count. The bars mark where a group starts to grow and where it risks being overworked.</p>
         <p><b>Weak points</b> names what is under-trained right now and suggests the next move, ordered by how much it matters.</p>
         <p class="muted small">Both come straight from the sessions you log \u2014 there is nothing extra to enter.</p>`,
    },
    {
      title: "NUTRITION & SCANNING",
      body:
        `<p>The <b>Nutrition</b> tab logs food against targets for <b>kcal, protein, fat and carbs</b>, and shows how the day is going.</p>
         <p>Search the <b>food database bundled in the app</b> \u2014 it works with no signal at all \u2014 or, on a phone that supports it, scan a packaged item's barcode to look it up and log it.</p>
         <p class="muted small">A weekly view shows the days you logged food this week against your weekly target.</p>`,
    },
    {
      title: "THE HERO TAB",
      body:
        `<p>The <b>Hero</b> tab is your crew: choose the character that comes along and pick its colourway.</p>
         <p>Each one unlocks from work you have already logged \u2014 steady weeks at your target, consistency, and the sets you put in \u2014 so nothing extra needs entering.</p>
         <p class="muted small">The one you bring along shows beside the header, so it is always in view.</p>`,
    },
    {
      title: "BADGES",
      body:
        `<p>There are <b>62 badges</b>, each one counting work you have already done \u2014 sessions, sets, weigh-ins, consistency and more.</p>
         <p>A badge also pays XP into your total, so each one moves your level along with it.</p>
         <p class="muted small">A badge is yours for good once it is earned.</p>`,
    },
    {
      title: "YOUR DATA, BACKUPS, EXPORT",
      body:
        `<p>Everything is kept on this device: a working copy, a rolling backup, and a mirror in the app's own storage.</p>
         <p>On <b>Profile \u2192 Your data</b> you can <b>Export JSON</b> (a full copy you can re-import) or <b>Export CSV</b> (a spreadsheet of every set).</p>
         <p>An export is the one copy that survives a lost or wiped phone \u2014 take one now and then.</p>`,
    },
    {
      title: "IT UPDATES ITSELF",
      body:
        `<p>The app checks for a newer version when it opens and whenever you return to it, then offers to download and install it \u2014 no app store needed.</p>
         <p>You can check any time on <b>Profile \u2192 App updates \u2192 Check for updates</b>.</p>
         <p>Your history is snapshotted before an update installs, so updating can never cost you data.</p>
         <p class="muted small">That is the tour. Log your next session and the charts fill in as you go.</p>`,
    },
  ];

  /* Should the tour show? A missing flag is NOT "already seen" — it is "show it".
     Armed by WELCOME_VERSION (the tour's content revision), NOT the app version:
     a state that has seen this revision stays hidden across any number of
     releases. `welcomeVersion` is overridable only so a test can model a tour
     content bump.

     This is a pure read: callers must run reconcileSeen() first (maybeOpen does),
     which converts a legacy app-version string into the current revision. */
  function shouldShow(settings, welcomeVersion) {
    const v = welcomeVersion || WELCOME_VERSION;
    const seen = settings && settings.welcomeSeenVersion;
    return seen !== v;
  }

  /* Persist that this tour revision has been shown. Called on finish OR skip. */
  function markSeen(state, Store, welcomeVersion) {
    if (!state.settings) state.settings = {};
    state.settings.welcomeSeenVersion = welcomeVersion || WELCOME_VERSION;
    if (Store && Store.save) Store.save(true);
    return state.settings.welcomeSeenVersion;
  }

  /* Read "absent" the same way everywhere: never written, or written empty.
     An empty string is not a value the flag is ever set to, so it cannot mean
     "seen" — it is treated as no flag at all. */
  const isAbsent = (v) => v === undefined || v === null || v === "";

  /* THE TRANSITION GUARD. A saved state from before the arming moved off the app
     version holds an APP-version string in this flag ("1.0.37", "1.0.38"), which
     can never equal WELCOME_VERSION ("2"). Left alone, shouldShow() returns true
     and its owner sees the tour one more time on the very update meant to stop
     that. The flag is only ever written when the tour was dismissed, so a PRESENT
     value means seen: rewrite it to the current revision and the tour stays away.
     A state with NO flag is untouched — that is the genuine new-user path and it
     must still see the tour once. Returns true when it rewrote the value. */
  function reconcileSeen(state, Store, welcomeVersion) {
    if (!state || !state.settings) return false;
    const v = welcomeVersion || WELCOME_VERSION;
    const seen = state.settings.welcomeSeenVersion;
    if (isAbsent(seen)) return false;   // no flag: leave it, so the tour shows
    if (seen === v) return false;       // already the current revision: nothing to do
    state.settings.welcomeSeenVersion = v;
    if (Store && Store.save) Store.save(true);
    return true;
  }

  /* The live tour, if one is open \u2014 so the hardware back button can dismiss it
     and record the version rather than silently closing it. */
  let active = null;
  const isActive = () => !!active;
  const dismiss = () => { if (active) active(); };

  /* ctx = { state, store, doc, el, open, close, toast } — the app supplies its
     own openModal/closeModal/el/toast so the tour matches every other surface. */
  function open(ctx) {
    const el = ctx.el;
    const doc = ctx.doc || (typeof document !== "undefined" ? document : null);
    const modalEl = doc ? doc.getElementById("modal") : null;
    let page = 0;
    let done = false;

    const root = el("div", { class: "welcome", role: "dialog", "aria-label": "Getting started" });

    /* Leaving the tour by ANY route records the version, so it cannot reappear
       next launch. `why` only changes whether we nudge the user. */
    function finish(why) {
      if (done) return;
      done = true;
      active = null;
      if (modalEl && modalEl.removeEventListener) modalEl.removeEventListener("click", onBackdrop);
      markSeen(ctx.state, ctx.store);
      ctx.close();
      if (why === "skip" && ctx.toast) ctx.toast("Tour skipped \u2014 it only comes back if the tour itself is ever updated", "");
    }

    /* A tap on the dim backdrop already closes the modal; treat it as a skip so
       the once-only flag is still written. */
    function onBackdrop(e) { if (e.target === modalEl) finish("skip"); }

    function paint() {
      const p = PAGES[page];
      const last = page === PAGES.length - 1;
      const dots = PAGES.map((_, i) =>
        `<button class="welcome-dot${i === page ? " on" : ""}" type="button" data-i="${i}" aria-label="Step ${i + 1}"></button>`
      ).join("");
      root.innerHTML = `
        <div class="welcome-head"><span class="welcome-step">STEP ${page + 1} / ${PAGES.length}</span></div>
        <h3 class="welcome-title">${p.title}</h3>
        <div class="welcome-body">${p.body}</div>
        <div class="welcome-pips">${dots}</div>
        <div class="welcome-foot">
          <button class="btn ghost welcome-skip" type="button">Skip</button>
          <button class="btn primary welcome-next" type="button">${last ? "Done" : "Next"}</button>
        </div>`;
      root.querySelector(".welcome-skip").addEventListener("click", () => finish("skip"));
      root.querySelector(".welcome-next").addEventListener("click", () => {
        if (last) finish("done");
        else { page++; paint(); }
      });
      Array.prototype.forEach.call(root.querySelectorAll(".welcome-dot"), (d) => {
        d.addEventListener("click", () => { page = Number(d.dataset.i) || 0; paint(); });
      });
    }

    paint();
    active = () => finish("skip");
    if (modalEl && modalEl.addEventListener) modalEl.addEventListener("click", onBackdrop);
    ctx.open(root, "wide");
  }

  /* The boot entry point. Returns true when the tour was opened.
     reconcileSeen() runs FIRST: it folds any legacy app-version string in the
     saved flag into the current WELCOME_VERSION, so only a genuine no-flag state
     reaches shouldShow() and opens the tour. */
  function maybeOpen(ctx) {
    reconcileSeen(ctx.state, ctx.store);
    if (!shouldShow(ctx.state && ctx.state.settings)) return false;
    open(ctx);
    return true;
  }

  return { APP_VERSION, WELCOME_VERSION, PAGES, shouldShow, reconcileSeen, markSeen, maybeOpen, open, isActive, dismiss, pageCount: PAGES.length };
})();
if (typeof module !== "undefined") module.exports = Welcome;
