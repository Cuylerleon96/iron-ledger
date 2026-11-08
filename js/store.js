/* store.js — localStorage persistence, import/export, auto-backup.
   Local-first: the app works offline and never phones home. Export often. */
const Store = (() => {
  "use strict";
  const KEY = "fitness-app-v1";
  const BAK = "fitness-app-v1-backup";

  const DEFAULT = () => ({
    version: 1,
    createdAt: new Date().toISOString(),
    profile: {
      name: "", sex: "M", heightCm: null,
      weightKg: null, bodyFatPct: null, goalWeightKg: null,
      weeklyTarget: 4, units: "kg",
    },
    workouts: [],
    bodylog: [],
    overrides: {},     // exId -> {mode?, g?, n?}
    custom: [],        // user-created exercises
    achievements: {},  // id -> ISO date
    targets: {},       // exId -> { value, set } — a goal for one exercise
    settings: { seeded: false },
  });

  const migrate = (s) => {
    const d = DEFAULT();
    const out = Object.assign({}, d, s || {});
    out.profile = Object.assign({}, d.profile, (s && s.profile) || {});
    out.settings = Object.assign({}, d.settings, (s && s.settings) || {});
    delete out.settings.sound;   // declared long ago and never read: a setting the
                                 // user can neither see nor change is dead schema
    // Date-order both logs HERE, the single point every load passes through.
    // upsertWorkout/addBodyLog already sort on write, but an imported or
    // restored state (or one written by an older build) can arrive unsorted —
    // and compareLast, the prefill scan and syncProfileFromLog all read these
    // arrays positionally, so an out-of-order array silently reports the wrong
    // session as "last time".
    const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
    out.workouts = (Array.isArray(out.workouts) ? out.workouts : []).filter((w) => w && w.date).sort(byDate);
    out.bodylog = (Array.isArray(out.bodylog) ? out.bodylog : []).filter((b) => b && b.date).sort(byDate);
    out.custom = Array.isArray(out.custom) ? out.custom : [];
    out.overrides = out.overrides || {};
    out.achievements = out.achievements || {};
    out.targets = out.targets || {};
    return out;
  };

  let state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? migrate(JSON.parse(raw)) : DEFAULT();
  } catch (e) {
    console.warn("state load failed, starting fresh", e);
    state = DEFAULT();
  }

  /* How much user history a state carries. Used to decide whether a state is
     safe to mirror — see allowMirror(). Records, not bytes: a state can be
     large and still be empty of history. */
  const richness = (s) => s
    ? (s.workouts || []).length + (s.bodylog || []).length + (s.custom || []).length
      + Object.keys(s.achievements || {}).length + Object.keys(s.overrides || {}).length
    : 0;

  let mirrorRichness = 0;     // richness of what we last put on the device
  let hydrated = false;       // has the boot recovery finished?
  let allowShrink = false;    // set by deliberate actions (reset, replace-import)
  let mirrorProtected = false; // the mirror could not be read — do not write to it

  /* Refuse to mirror an EMPTIER state over a richer one. That exact shape is what
     a boot with evicted localStorage looks like before hydration finishes, and
     writing it would destroy the last copy of the user's history. Deliberate
     shrink operations clear the guard instead of fighting it. */
  function allowMirror(s) {
    if (!hydrated) return false;              // never mirror before recovery has run
    if (mirrorProtected) {
      // We could not read the mirror, so we do not know what it holds. Writing
      // could destroy history we simply failed to see. localStorage is still the
      // working copy and the next launch retries the read, so refuse.
      console.warn("mirror unreadable this session — leaving it untouched");
      return false;
    }
    const r = richness(s);
    // Only a severe COLLAPSE is refused while the device still holds real history
    // — the shape of a boot whose recovery failed, not of a user tidying up.
    // Every deliberate shrink (reset, replace-import, a delete) sets allowShrink,
    // and the watermark follows the truth, so ordinary editing mirrors normally.
    if (!allowShrink && mirrorRichness >= 4 && r < mirrorRichness / 2) {
      console.warn("not mirroring a collapsed state (" + r + " vs " + mirrorRichness
        + ") — keeping the device copy");
      return false;
    }
    mirrorRichness = r;
    return true;
  }

  let onSaveError = null;     // set by the UI so a failed save can be announced
  let saveTimer = null;
  function save(immediate) {
    const doIt = () => {
      try {
        const prev = localStorage.getItem(KEY);
        if (prev) localStorage.setItem(BAK, prev);
        localStorage.setItem(KEY, JSON.stringify(state));
        // mirror to device storage when packaged, so a cleared WebView
        // localStorage is recoverable rather than a lost year of training
        if (typeof Native !== "undefined" && Native.available && allowMirror(state)) {
          Native.write(JSON.stringify(state));
        }
      } catch (e) {
        console.error("save failed", e);
        // A QuotaExceededError means the save DID NOT happen while the screen
        // still shows the session as recorded. Staying silent here loses a
        // workout the user believes they logged.
        const quota = !!e && (e.name === "QuotaExceededError" || /quota|exceeded/i.test(String(e.message || e)));
        if (quota && onSaveError) { try { onSaveError(); } catch (err) { /* never throw from a save */ } }
      }
    };
    if (immediate) { clearTimeout(saveTimer); doIt(); return; }
    clearTimeout(saveTimer); saveTimer = setTimeout(doIt, 250);
  }

  /* Local calendar date. toISOString() is UTC and rolls over at 19:00 EST. */
  const dstrToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const uid = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function upsertWorkout(w) {
    if (!w.id) w.id = uid();
    const i = state.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) state.workouts[i] = w; else state.workouts.push(w);
    state.workouts.sort((a, b) => a.date.localeCompare(b.date));
    save(true);
    return w;
  }
  function deleteWorkout(id) { allowShrink = true; state.workouts = state.workouts.filter((w) => w.id !== id); save(true); allowShrink = false; }
  function workoutById(id) { return state.workouts.find((w) => w.id === id) || null; }

  /* The bodyweight log is the SINGLE SOURCE OF TRUTH for body composition.
     The profile's weight and body-fat are derived from the newest check-in that
     actually carries each value, so a measurement is entered once and both views
     stay in step. Only ever wrote weightKg before, which meant body fat had to be
     typed twice and could silently drift out of the score. */
  function syncProfileFromLog() {
    const log = state.bodylog;
    if (!log.length) return;
    const lastWith = (k) => {
      for (let i = log.length - 1; i >= 0; i--) {
        const v = Number(log[i][k]);
        if (isFinite(v) && v > 0) return v;
      }
      return null;
    };
    const w = lastWith("weightKg");
    if (w !== null) state.profile.weightKg = w;
    const bf = lastWith("bodyFatPct");
    if (bf !== null) state.profile.bodyFatPct = bf;
  }

  function addBodyLog(entry) {
    const i = state.bodylog.findIndex((b) => b.date === entry.date);
    if (i >= 0) state.bodylog[i] = entry; else state.bodylog.push(entry);
    state.bodylog.sort((a, b) => a.date.localeCompare(b.date));
    syncProfileFromLog();
    save(true);
  }
  function deleteBodyLog(date) {
    allowShrink = true;
    state.bodylog = state.bodylog.filter((b) => b.date !== date);
    syncProfileFromLog();
    save(true);
    allowShrink = false;
  }

  function addCustom(ex) {
    ex.id = ex.id || "u" + Date.now().toString(36);
    state.custom.push(ex);
    save(true);
    return ex;
  }
  function updateCustom(id, patch) {
    const c = state.custom.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
    save(true);
  }
  function deleteCustom(id) {
    allowShrink = true;
    state.custom = state.custom.filter((x) => x.id !== id);
    // Past sessions KEEP their sets. Each entry carries its own name and mode, so
    // the history still renders correctly — and silently rewriting training the
    // user already logged is data loss they never asked for.
    save(true);
    allowShrink = false;
  }
  const setOverride = (id, patch) => { state.overrides[id] = Object.assign({}, state.overrides[id], patch); save(true); };

  function unlock(ids) {
    const d = new Date().toISOString().slice(0, 10);
    ids.forEach((id) => { if (!state.achievements[id]) state.achievements[id] = d; });
    if (ids.length) save(true);
  }

  /* A goal for one exercise. Stored on the state, not the profile, because it
     belongs to the lift — and it is a target, not a measurement, so it is
     excluded from `richness` (which counts history). */
  function setTarget(exId, value) {
    const v = Number(value);
    if (!isFinite(v) || v <= 0) { delete state.targets[exId]; save(true); return null; }
    state.targets[exId] = { value: v, set: dstrToday() };
    save(true);
    return state.targets[exId];
  }
  const clearTarget = (exId) => { delete state.targets[exId]; save(true); };

  const exportJSON = () => JSON.stringify(state, null, 2);

  function importJSON(text, mode = "replace") {
    const incoming = migrate(JSON.parse(text));
    if (mode === "replace") { allowShrink = true; state = incoming; }
    else {
      // merge: keep unique workout ids
      const ids = new Set(state.workouts.map((w) => w.id));
      incoming.workouts.forEach((w) => { if (!ids.has(w.id)) state.workouts.push(w); });
      const cids = new Set(state.custom.map((c) => c.id));
      incoming.custom.forEach((c) => { if (!cids.has(c.id)) state.custom.push(c); });
      const bdates = new Set(state.bodylog.map((b) => b.date));
      incoming.bodylog.forEach((b) => { if (!bdates.has(b.date)) state.bodylog.push(b); });
      state.achievements = Object.assign({}, incoming.achievements, state.achievements);
      // The profile and per-exercise overrides were being dropped, so importing a
      // backup onto a fresh install left the user with sessions but no name,
      // height, goal or units — a "restore" that silently lost half the ledger.
      Object.keys(incoming.overrides || {}).forEach((k) => {
        if (!state.overrides[k]) state.overrides[k] = incoming.overrides[k];
      });
      Object.keys(incoming.targets || {}).forEach((k) => {
        if (!state.targets[k]) state.targets[k] = incoming.targets[k];
      });
      // Only fill what is unset, so importing an old file can never clobber a
      // newer local edit.
      ["name", "sex", "units"].forEach((k) => {
        if (!state.profile[k] && incoming.profile[k]) state.profile[k] = incoming.profile[k];
      });
      ["heightCm", "weightKg", "bodyFatPct", "goalWeightKg"].forEach((k) => {
        if (state.profile[k] == null && incoming.profile[k] != null) state.profile[k] = incoming.profile[k];
      });
      state.workouts.sort((a, b) => a.date.localeCompare(b.date));
      state.bodylog.sort((a, b) => a.date.localeCompare(b.date));
    }
    save(true);
    return state;
  }

  function exportCSV() {
    // `rest` was a declared-but-never-collected field; exporting an always-empty
    // column is noise, and RPE is real data so it stays.
    const rows = [["date", "exercise", "mode", "set", "weight_kg", "reps", "seconds", "distance_m", "rpe", "rest_s"]];
    state.workouts.forEach((w) => (w.entries || []).forEach((en) => {
      (en.sets || []).forEach((s, i) => rows.push([w.date, en.name || en.id, en.mode || "", i + 1, s.w ?? "", s.r ?? "", s.t ?? "", s.d ?? "", s.rpe ?? "", (s.rest ?? en.restDefault ?? "")]));
    }));
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  const reset = () => { allowShrink = true; state = DEFAULT(); save(true); allowShrink = false; };
  const loadBackup = () => { const b = localStorage.getItem(BAK); if (!b) return false; state = migrate(JSON.parse(b)); save(true); return true; };
  const hasBackup = () => !!localStorage.getItem(BAK);

  /* On device: if localStorage is empty but the mirrored file has data,
     restore from the file. Returns true when data was recovered. */
  async function bootstrapNative() {
    if (typeof Native === "undefined" || !Native.available) { hydrated = true; return false; }
    const res = await Native.read();
    let restored = false;

    try {
      if (res.ok) {
        let incoming = null;
        try { incoming = migrate(JSON.parse(res.text)); }
        catch (e) { console.warn("native restore parse failed", e); }
        if (incoming) {
          mirrorRichness = richness(incoming);    // what the device actually holds
          if (richness(incoming) > richness(state)) {
            state = incoming; save(true); restored = true;
          }
        }
      } else if (res.missing) {
        mirrorRichness = 0;                        // positively absent; nothing to protect
      } else {
        // The read FAILED for an unknown reason. The file may be perfectly good, so
        // do not touch it: a transient timeout must never cost the user their data.
        console.warn("mirror unreadable — leaving it untouched:", res.error);
        mirrorProtected = true;
      }
    } finally {
      // ALWAYS, and in a finally: hydration gating every mirror write means a
      // return that skips this freezes the device mirror for the whole session.
      hydrated = true;
    }

    if (restored) return true;                     // the mirror already holds this
    // memory is at least as rich as the mirror, so refreshing the mirror is safe
    if (allowMirror(state)) Native.write(JSON.stringify(state));
    return false;
  }

  /* ---------- rolling dated backups ---------- */
  /* The pre-update snapshot only exists at the moment of an update. These roll:
     at most one a day, into the same protected app storage, keeping the last few.
     So a bad state found a week later can still be stepped back from.
     The list of written names lives in localStorage rather than being read back
     from the directory, so pruning does not depend on a directory listing. */
  const BAK_LIST = "iron-ledger-backup-list";
  const KEEP_BACKUPS = 5;

  async function autoBackup() {
    if (typeof Native === "undefined" || !Native.available) return null;
    if (richness(state) === 0) return null;                 // nothing worth keeping
    const name = Native.BAK_PREFIX + dstrToday() + ".json";
    let names = [];
    try { names = JSON.parse(localStorage.getItem(BAK_LIST) || "[]"); } catch (e) { names = []; }
    if (!Array.isArray(names)) names = [];
    if (names.includes(name)) return name;                   // already taken today

    const blob = JSON.stringify({ savedAt: new Date().toISOString(), why: "daily", state });
    if (!(await Native.writeNamed(name, blob))) return null;

    names = names.concat([name]).filter((n, i, a) => a.indexOf(n) === i).sort();
    const keep = names.slice(-KEEP_BACKUPS);
    for (const old of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) await Native.deleteNamed(old);
    try { localStorage.setItem(BAK_LIST, JSON.stringify(keep)); } catch (e) { /* cosmetic */ }
    console.info("daily backup written:", name, "keeping", keep.length);
    return name;
  }

  /* Newest rolling backup first. Only ever read while memory is still empty, so
     it cannot overwrite newer data. */
  async function recoverFromBackup() {
    if (typeof Native === "undefined" || !Native.available) return false;
    let names = [];
    try { names = JSON.parse(localStorage.getItem(BAK_LIST) || "[]"); } catch (e) { return false; }
    if (!Array.isArray(names) || !names.length) return false;
    for (const name of names.slice().reverse()) {
      const res = await Native.readNamed(name);
      if (!res.ok) continue;
      try {
        const blob = JSON.parse(res.text);
        const snap = migrate(blob && blob.state ? blob.state : blob);
        if (richness(snap) > richness(state)) { state = snap; save(true); return true; }
      } catch (e) { /* try the older one */ }
    }
    return false;
  }

  /* The snapshot written immediately before an update is installed. It is the
     copy that survives even if the install wipes the WebView store, and it is
     only ever read when both localStorage AND the live mirror came up empty —
     so recovering from it can never overwrite newer data. */
  async function snapshotPreUpdate() {
    if (typeof Native === "undefined" || !Native.available) return false;
    const blob = JSON.stringify({ savedAt: new Date().toISOString(), why: "pre-update", state });
    const ok = await Native.writeSnapshot(blob);
    if (ok) console.info("pre-update snapshot saved (" + richness(state) + " records)");
    return ok;
  }

  async function recoverFromSnapshot() {
    if (typeof Native === "undefined" || !Native.available) return false;
    const res = await Native.readSnapshot();
    if (!res.ok) return false;
    try {
      const blob = JSON.parse(res.text);
      const snap = migrate(blob && blob.state ? blob.state : blob);
      if (richness(snap) > richness(state)) { state = snap; save(true); return true; }
    } catch (e) { console.warn("snapshot parse failed", e); }
    return false;
  }

  /* Full recovery chain, richest source wins: live mirror first, then the
     pre-update snapshot, and only while memory is still empty. */
  async function recover() {
    if (await bootstrapNative()) return "device mirror";
    if (richness(state) > 0) return null;
    if (await recoverFromSnapshot()) return "pre-update snapshot";
    if (await recoverFromBackup()) return "daily backup";
    return null;
  }

  return {
    get state() { return state; },
    save, upsertWorkout, deleteWorkout, workoutById, addBodyLog, deleteBodyLog,
    addCustom, updateCustom, deleteCustom, setOverride, unlock,
    exportJSON, importJSON, exportCSV, reset, loadBackup, hasBackup, uid, migrate,
    bootstrapNative, recover, snapshotPreUpdate, recoverFromSnapshot, richness,
    setSaveErrorHandler: (fn) => { onSaveError = fn; },
    setTarget, clearTarget, autoBackup, recoverFromBackup,
  };
})();
if (typeof module !== "undefined") module.exports = Store;
