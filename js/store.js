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
      name: "", sex: "M", birthYear: null, heightCm: null,
      weightKg: null, bodyFatPct: null, goalWeightKg: null,
      weeklyTarget: 4, units: "kg",
    },
    workouts: [],
    bodylog: [],
    overrides: {},     // exId -> {mode?, g?, n?}
    custom: [],        // user-created exercises
    achievements: {},  // id -> ISO date
    settings: { sound: false, seeded: false },
  });

  const migrate = (s) => {
    const d = DEFAULT();
    const out = Object.assign({}, d, s || {});
    out.profile = Object.assign({}, d.profile, (s && s.profile) || {});
    out.settings = Object.assign({}, d.settings, (s && s.settings) || {});
    out.workouts = Array.isArray(out.workouts) ? out.workouts : [];
    out.bodylog = Array.isArray(out.bodylog) ? out.bodylog : [];
    out.custom = Array.isArray(out.custom) ? out.custom : [];
    out.overrides = out.overrides || {};
    out.achievements = out.achievements || {};
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

  let saveTimer = null;
  function save(immediate) {
    const doIt = () => {
      try {
        const prev = localStorage.getItem(KEY);
        if (prev) localStorage.setItem(BAK, prev);
        localStorage.setItem(KEY, JSON.stringify(state));
        // mirror to device storage when packaged, so a cleared WebView
        // localStorage is recoverable rather than a lost year of training
        if (typeof Native !== "undefined" && Native.available) Native.write(JSON.stringify(state));
      } catch (e) { console.error("save failed", e); }
    };
    if (immediate) { clearTimeout(saveTimer); doIt(); return; }
    clearTimeout(saveTimer); saveTimer = setTimeout(doIt, 250);
  }

  const uid = () => "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function upsertWorkout(w) {
    if (!w.id) w.id = uid();
    const i = state.workouts.findIndex((x) => x.id === w.id);
    if (i >= 0) state.workouts[i] = w; else state.workouts.push(w);
    state.workouts.sort((a, b) => a.date.localeCompare(b.date));
    save(true);
    return w;
  }
  function deleteWorkout(id) { state.workouts = state.workouts.filter((w) => w.id !== id); save(true); }
  function workoutById(id) { return state.workouts.find((w) => w.id === id) || null; }

  function addBodyLog(entry) {
    const i = state.bodylog.findIndex((b) => b.date === entry.date);
    if (i >= 0) state.bodylog[i] = entry; else state.bodylog.push(entry);
    state.bodylog.sort((a, b) => a.date.localeCompare(b.date));
    if (state.bodylog.length) state.profile.weightKg = state.bodylog[state.bodylog.length - 1].weightKg;
    save(true);
  }
  function deleteBodyLog(date) {
    state.bodylog = state.bodylog.filter((b) => b.date !== date);
    if (state.bodylog.length) state.profile.weightKg = state.bodylog[state.bodylog.length - 1].weightKg;
    save(true);
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
    state.custom = state.custom.filter((x) => x.id !== id);
    state.workouts.forEach((w) => (w.entries = (w.entries || []).filter((e) => e.id !== id)));
    save(true);
  }
  const setOverride = (id, patch) => { state.overrides[id] = Object.assign({}, state.overrides[id], patch); save(true); };

  function unlock(ids) {
    const d = new Date().toISOString().slice(0, 10);
    ids.forEach((id) => { if (!state.achievements[id]) state.achievements[id] = d; });
    if (ids.length) save(true);
  }

  const exportJSON = () => JSON.stringify(state, null, 2);

  function importJSON(text, mode = "replace") {
    const incoming = migrate(JSON.parse(text));
    if (mode === "replace") state = incoming;
    else {
      // merge: keep unique workout ids
      const ids = new Set(state.workouts.map((w) => w.id));
      incoming.workouts.forEach((w) => { if (!ids.has(w.id)) state.workouts.push(w); });
      const cids = new Set(state.custom.map((c) => c.id));
      incoming.custom.forEach((c) => { if (!cids.has(c.id)) state.custom.push(c); });
      const bdates = new Set(state.bodylog.map((b) => b.date));
      incoming.bodylog.forEach((b) => { if (!bdates.has(b.date)) state.bodylog.push(b); });
      state.achievements = Object.assign({}, incoming.achievements, state.achievements);
      state.workouts.sort((a, b) => a.date.localeCompare(b.date));
    }
    save(true);
    return state;
  }

  function exportCSV() {
    const rows = [["date", "exercise", "mode", "set", "weight_kg", "reps", "seconds", "distance_m", "rpe", "rest_s"]];
    state.workouts.forEach((w) => (w.entries || []).forEach((en) => {
      (en.sets || []).forEach((s, i) => rows.push([w.date, en.name || en.id, en.mode || "", i + 1, s.w ?? "", s.r ?? "", s.t ?? "", s.d ?? "", s.rpe ?? "", s.rest ?? ""]));
    }));
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  const reset = () => { state = DEFAULT(); save(true); };
  const loadBackup = () => { const b = localStorage.getItem(BAK); if (!b) return false; state = migrate(JSON.parse(b)); save(true); return true; };
  const hasBackup = () => !!localStorage.getItem(BAK);

  /* On device: if localStorage is empty but the mirrored file has data,
     restore from the file. Returns true when data was recovered. */
  async function bootstrapNative() {
    if (typeof Native === "undefined" || !Native.available) return false;
    const txt = await Native.read();
    if (!txt) { Native.write(JSON.stringify(state)); return false; }
    try {
      const incoming = migrate(JSON.parse(txt));
      if ((incoming.workouts || []).length > (state.workouts || []).length) {
        state = incoming; save(true); return true;
      }
    } catch (e) { console.warn("native restore parse failed", e); }
    Native.write(JSON.stringify(state));
    return false;
  }

  return {
    get state() { return state; },
    save, upsertWorkout, deleteWorkout, workoutById, addBodyLog, deleteBodyLog,
    addCustom, updateCustom, deleteCustom, setOverride, unlock,
    exportJSON, importJSON, exportCSV, reset, loadBackup, hasBackup, uid, migrate,
    bootstrapNative,
  };
})();
if (typeof module !== "undefined") module.exports = Store;
