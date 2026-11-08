/* First-run walkthrough — the once-only contract and its persistence.
   Run: node tools/test_welcome.js

   The subtle, load-bearing rule this pins down (welcome.js):

     A MISSING settings.welcomeSeenVersion flag means "SHOW IT", not "already
     seen". That is the whole mechanism by which an EXISTING user (saved state,
     no flag) sees the tour exactly once on this update, while a brand-new
     install also sees it once. The corollary is a prohibition: there must be NO
     migration that backfills the flag for existing users, because backfilling
     would mark it seen and the tour would never appear for them.

   Asserted here:
     * a state with no flag shows the tour;
     * after it is dismissed/skipped the state carries the tour's CONTENT
       revision (WELCOME_VERSION) and it does NOT show again;
     * a new RELEASE (a different injected APP_VERSION) does NOT re-arm it, while
       a WELCOME_VERSION bump does — this is the user's "exactly once" requirement;
     * the flag persists to storage and survives a reload;
     * migrate() does NOT invent the flag (no backfill);
     * every control is wired — Skip dismisses+persists, Next advances, the dots
       jump, and a backdrop tap also records the revision.
*/
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const truthy = (label, v) => eq(label, !!v, true);

/* ---- a minimal fake DOM good enough for Welcome.open() ---- */
function mk(tag) {
  const e = {
    tag, _html: "", _children: {}, _lis: {},
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener(t, fn) { (this._lis[t] = this._lis[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this._lis[t]) this._lis[t] = this._lis[t].filter((f) => f !== fn); },
    querySelector(sel) { return this._children[sel] || (this._children[sel] = mk(sel)); },
    querySelectorAll(sel) {
      // the page dots are the only repeated nodes the tour builds. Memoise them
      // so a handler bound in one paint() is the same node a test clicks later.
      if (sel === ".welcome-dot") {
        if (!this._dots || this._dots.length !== (this._html.match(/class="welcome-dot/g) || []).length) {
          const n = (this._html.match(/class="welcome-dot/g) || []).length;
          this._dots = Array.from({ length: n }, (_, i) => { const d = mk("dot"); d.dataset = { i: String(i) }; return d; });
        }
        return this._dots;
      }
      return [];
    },
    append() {}, remove() {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, style: {},
  };
  return e;
}
const fakeCtx = (state, store, cap = {}) => ({
  state, store, doc: { getElementById: () => mk("modal") },
  el: (tag) => mk(tag),
  open: (node, cls) => { cap.node = node; cap.cls = cls; },
  close: () => { cap.closed = true; },
  toast: () => { cap.toasted = true; },
  cap,
});

/* ---- load store.js + welcome.js against a given persisted state ---- */
/* `opts.appVersion` simulates the build-time injection: build_www.py overwrites
   welcome.js's APP_VERSION with the release versionName. A test can pin a
   DIFFERENT one to model a new release, without touching the tour's own content
   revision — which is exactly the distinction this suite now pins down. */
function load(initial, opts = {}) {
  const storage = new Map();
  if (initial !== undefined) storage.set("fitness-app-v1", JSON.stringify(initial));
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, WeakMap, Symbol,
    setTimeout: (fn) => 0, clearTimeout() {},
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => { storage.set(k, String(v)); },
      removeItem: (k) => { storage.delete(k); },
    },
    module: { exports: {} },
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let src = ["js/store.js", "js/welcome.js"]
    .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
  if (opts.appVersion) {
    src = src.replace(/const APP_VERSION = "[^"]*"/, `const APP_VERSION = "${opts.appVersion}"`);
  }
  vm.runInContext(src + "\n;globalThis.__X={Store,Welcome};", sandbox, { filename: "bundle.js" });
  const X = sandbox.__X;
  return { Store: X.Store, Welcome: X.Welcome, storage, sandbox };
}

/* an existing user: real history, a seeded flag, and NO welcomeSeenVersion */
const EXISTING = {
  version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "the owner", sex: "M", heightCm: 180, weightKg: 82, units: "kg" },
  workouts: [{ id: "seed-2026-11-07", date: "2026-11-07", entries: [{ id: "u1", name: "Bench Press Machine", mode: "weight_reps", sets: [{ w: 100, r: 10 }] }] }],
  bodylog: [], overrides: {}, custom: [], achievements: {}, targets: {},
  settings: { seeded: true },
};

console.log("=== an existing user with NO flag must SEE the tour (missing = show) ===");
{
  const e = load(EXISTING);
  eq("the stored state really has no flag", e.Store.state.settings.welcomeSeenVersion, undefined);
  eq("shouldShow() on a no-flag state is true", e.Welcome.shouldShow(e.Store.state.settings), true);
  const ctx = fakeCtx(e.Store.state, e.Store, {});
  eq("maybeOpen() opens it", e.Welcome.maybeOpen(ctx), true);
  truthy("a modal node was handed to open()", ctx.cap.node);
  eq("opened as a wide modal panel", ctx.cap.cls, "wide");
}

console.log("=== the flag is NOT backfilled by migrate() (no backfill, on purpose) ===");
{
  const e = load(EXISTING);
  const migrated = e.Store.migrate(EXISTING);
  eq("migrate() leaves welcomeSeenVersion undefined", migrated.settings.welcomeSeenVersion, undefined);
  eq("...so a loaded/migrated existing state still shows it", e.Welcome.shouldShow(migrated.settings), true);
  // and a real Store load of that state agrees
  eq("the live Store agrees", e.Welcome.shouldShow(e.Store.state.settings), true);
}

console.log("=== after dismissal it records the version, and does NOT show again ===");
{
  const e = load(EXISTING);
  const ctx = fakeCtx(e.Store.state, e.Store, {});
  e.Welcome.open(ctx);
  truthy("the tour is active after open()", e.Welcome.isActive());
  e.Welcome.dismiss();                       // exactly what Skip / Done / back do
  eq("the version was recorded on the live state", e.Store.state.settings.welcomeSeenVersion, e.Welcome.WELCOME_VERSION);
  eq("shouldShow() is now false", e.Welcome.shouldShow(e.Store.state.settings), false);
  truthy("the modal was closed", ctx.cap.closed);
  eq("maybeOpen() is now a no-op", e.Welcome.maybeOpen(fakeCtx(e.Store.state, e.Store, {})), false);
}

console.log("=== the flag persists to storage and survives a reload ===");
{
  const e = load(EXISTING);
  e.Welcome.markSeen(e.Store.state, e.Store);
  const raw = JSON.parse(e.storage.get("fitness-app-v1"));
  eq("the persisted JSON carries the flag", raw.settings.welcomeSeenVersion, e.Welcome.WELCOME_VERSION);
  const again = load(raw);                    // fresh boot from the same bytes
  eq("a reloaded store still has the flag", again.Store.state.settings.welcomeSeenVersion, e.Welcome.WELCOME_VERSION);
  eq("...and does not re-show", again.Welcome.shouldShow(again.Store.state.settings), false);
}

console.log("=== arming is keyed on the TOUR content revision, not the app version ===");
{
  const e = load(EXISTING);
  eq("seen for this tour revision, still this revision -> hidden",
     e.Welcome.shouldShow({ welcomeSeenVersion: "1" }, "1"), false);
  eq("seen for an older tour revision -> shows",
     e.Welcome.shouldShow({ welcomeSeenVersion: "0" }, "1"), true);
  eq("no flag at all -> shows", e.Welcome.shouldShow({}, "1"), true);
}

console.log("=== THE REQUIREMENT: a new RELEASE must NOT re-arm the tour ===");
{
  // A state that has already seen WELCOME_VERSION "1".
  const seen = {
    version: 1, createdAt: "2026-01-01T00:00:00.000Z",
    profile: { name: "the owner", units: "kg" }, workouts: [], bodylog: [], overrides: {},
    custom: [], achievements: {}, targets: {}, settings: { seeded: true, welcomeSeenVersion: "1" },
  };

  // A NEW RELEASE is built: build_www.py injects a different app version. Prove
  // the injection really landed, so this is a genuine app-version change and not
  // a test that silently checked nothing.
  const e = load(seen, { appVersion: "9.9.9" });
  eq("the injected APP_VERSION really changed (a new release)", e.Welcome.APP_VERSION, "9.9.9");
  eq("WELCOME_VERSION is unchanged by the release", e.Welcome.WELCOME_VERSION, "1");
  eq("...yet shouldShow() stays FALSE — the release does NOT re-arm the tour",
     e.Welcome.shouldShow(e.Store.state.settings), false);
  eq("...and maybeOpen() is a no-op after the release",
     e.Welcome.maybeOpen(fakeCtx(e.Store.state, e.Store, {})), false);

  // Bumping the TOUR's own content revision DOES re-arm it — the only way.
  eq("bumping WELCOME_VERSION re-arms the tour",
     e.Welcome.shouldShow(e.Store.state.settings, "2"), true);

  // sanity: the same release with NO seen flag still shows (missing = show)
  const fresh = load({ version: 1, settings: { seeded: true } }, { appVersion: "9.9.9" });
  eq("a no-flag state still shows after any release",
     fresh.Welcome.shouldShow(fresh.Store.state.settings), true);
}

console.log("=== a brand-new install (default state) also sees it once ===");
{
  const e = load();                           // no persisted state at all
  eq("fresh install has no flag", e.Store.state.settings.welcomeSeenVersion, undefined);
  eq("fresh install shows it", e.Welcome.shouldShow(e.Store.state.settings), true);
}

console.log("=== every control is wired (Skip, Next, dots) ===");
{
  const e = load(EXISTING);
  const ctx = fakeCtx(e.Store.state, e.Store, {});
  e.Welcome.open(ctx);
  const html = ctx.cap.node.innerHTML;
  truthy("the panel offers Skip", /class="btn ghost welcome-skip"/.test(html));
  truthy("the first page offers Next", /welcome-next"[^>]*>Next</.test(html));
  const dots = (html.match(/class="welcome-dot/g) || []).length;
  eq("there is one dot per page", dots, e.Welcome.pageCount);
  eq("the tour has six pages", e.Welcome.pageCount, 6);
  truthy("page 1 of 6 is labelled", /STEP 1 \/ 6/.test(html));

  // Next advances to page 2
  ctx.cap.node.querySelector(".welcome-next")._lis.click[0]();
  truthy("Next advances to STEP 2", /STEP 2 \/ 6/.test(ctx.cap.node.innerHTML));
  truthy("...and still offers Skip", /welcome-skip/.test(ctx.cap.node.innerHTML));

  // a dot jumps straight to a later page
  const dotNodes = ctx.cap.node.querySelectorAll(".welcome-dot");
  dotNodes[4]._lis.click[0]();
  truthy("a page dot jumps to STEP 5", /STEP 5 \/ 6/.test(ctx.cap.node.innerHTML));
  // the last dot reaches the final page, where Next becomes Done
  dotNodes[5]._lis.click[0]();
  truthy("the last dot reaches STEP 6", /STEP 6 \/ 6/.test(ctx.cap.node.innerHTML));
  truthy("the last page relabels Next as Done", /welcome-next"[^>]*>Done</.test(ctx.cap.node.innerHTML));

  // the Skip button dismisses and persists
  ctx.cap.node.querySelector(".welcome-skip")._lis.click[0]();
  eq("Skip recorded the version", e.Store.state.settings.welcomeSeenVersion, e.Welcome.WELCOME_VERSION);
  truthy("Skip closed the modal", ctx.cap.closed);
  truthy("Skip toasted the user", ctx.cap.toasted);
}

console.log("=== a backdrop tap also records the version (no leak of 'exactly once') ===");
{
  const e = load(EXISTING);
  const modal = mk("modal");
  const ctx = fakeCtx(e.Store.state, e.Store, {});
  ctx.doc = { getElementById: () => modal };
  e.Welcome.open(ctx);
  truthy("a backdrop click listener was bound", (modal._lis.click || []).length > 0);
  modal._lis.click[0]({ target: modal });      // tap the dim area
  eq("backdrop tap recorded the version", e.Store.state.settings.welcomeSeenVersion, e.Welcome.WELCOME_VERSION);
  eq("...and it will not show again", e.Welcome.shouldShow(e.Store.state.settings), false);
}

console.log("=== the pages cover the required topics, in order, and obey the font rules ===");
{
  const e = load(EXISTING);
  const titles = e.Welcome.PAGES.map((p) => p.title).join(" | ").toLowerCase();
  truthy("page 1: what it is / local-only, no account", /local-only|no account/.test(titles));
  truthy("page 2: shorthand logging", /shorthand/.test(titles));
  truthy("page 3: the six attributes", /six attributes/.test(titles));
  truthy("page 4: muscle balance & weak points", /muscle balance/.test(titles) && /weak point/.test(titles));
  truthy("page 5: data / backups / export", /export/.test(titles));
  truthy("page 6: self-update", /update/.test(titles));

  const all = e.Welcome.PAGES.map((p) => p.body).join("\n");
  truthy("the six attribute names are all present", ["STRENGTH", "STAMINA", "POWER", "MOBILITY", "DISCIPLINE", "VITALITY"].every((n) => all.includes(n)));
  truthy("the notes-app shorthand example is shown", /Bench press machine:/.test(all) && /1:100x10/.test(all));
  // pixel-font pitfall: a tilde reads as a dash, so "~4" would read as "minus four"
  truthy("no tilde-number anywhere (it renders as a dash)", !/~\s*\d/.test(all));
}

console.log("=== wiring: boot, index.html and the escape routes ===");
{
  const app = fs.readFileSync(path.join(B, "js", "app.js"), "utf8");
  const html = fs.readFileSync(path.join(B, "index.html"), "utf8");
  const w = fs.readFileSync(path.join(B, "js", "welcome.js"), "utf8");
  truthy("index.html loads welcome.js before app.js",
    html.indexOf("js/welcome.js") > -1 && html.indexOf("js/welcome.js") < html.indexOf("js/app.js"));
  truthy("boot() opens the tour after the first paint", /render\(\);\s*\/\/ paint FIRST[\s\S]{0,1200}Welcome\.maybeOpen\(/.test(app));
  truthy("the hardware back button routes through the tour", /Welcome\.isActive\(\)\) Welcome\.dismiss\(\)/.test(app));
  truthy("Skip is bound to finish(skip)", /welcome-skip"\)\.addEventListener\("click", \(\) => finish\("skip"\)\)/.test(w));
  truthy("Next/Done is bound", /welcome-next"\)\.addEventListener\("click"/.test(w));
  truthy("dots are bound", /forEach\.call\(root\.querySelectorAll\("\.welcome-dot"\)/.test(w));
  truthy("the version-flag key is welcomeSeenVersion", /welcomeSeenVersion/.test(w) && /welcomeSeenVersion/.test(app + w));
  // the copy must be honest now that a release no longer re-shows the tour
  truthy("the skip toast no longer promises a re-show after the next update",
    !/shows again after the next update/.test(w));
  truthy("the skip toast says the tour returns only if the tour itself changes",
    /only comes back if the tour itself is ever updated/.test(w));
  // the build-injection anchor survives, and the content revision is separate
  truthy("APP_VERSION is still the injectable build-time anchor",
    /const APP_VERSION = "[^"]*"/.test(w));
  truthy("WELCOME_VERSION is a separate content revision, not injected",
    /const WELCOME_VERSION = "1"/.test(w));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
