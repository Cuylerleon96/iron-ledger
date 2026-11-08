/* Data-loss guards. An update must never cost the user their training history.
   Each case below is a way the app could previously lose data, or a way it must
   behave under a plausible device failure. Run: node tools/test_dataloss.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const SRC = ["js/native.js", "js/store.js"]
  .map((f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8")).join("\n;\n");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const FILE = "iron-ledger-state.json", SNAP = "iron-ledger-preupdate.json";
/* Mirror writes are deliberately fire-and-forget (localStorage is the synchronous
   working copy), so give the promise queue a turn before asserting on the disk. */
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const dstr = (i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`;

const mkState = (nw, nb) => ({
  version: 1, createdAt: "2026-01-01T00:00:00.000Z",
  profile: { name: "the owner", sex: "M", heightCm: null, weightKg: 82, bodyFatPct: null, goalWeightKg: null, weeklyTarget: 4, units: "kg" },
  workouts: Array.from({ length: nw }, (_, i) => ({
    id: "w" + i, date: dstr(i), note: "",
    entries: [{ id: 73, name: "Bench Press", mode: "weight_reps", sets: [{ w: 100, r: 10, rest: 120 }] }],
  })),
  bodylog: Array.from({ length: nb }, (_, i) => ({ date: dstr(i), weightKg: 82 - i * 0.1, bodyFatPct: null })),
  overrides: {}, custom: [], achievements: {}, settings: { sound: false, seeded: true },
});

/* A fake device filesystem. `failRead` models the dangerous case: the file is
   perfectly good but the read fails (a timeout, a plugin hiccup). */
function env({ ls = {}, files = {}, failRead = false, corruptMirror = false } = {}) {
  const disk = Object.assign({}, files);
  if (corruptMirror) disk[FILE] = "{ this is not json";
  // `ls` is either a raw localStorage map, or a state object for convenience.
  const store = (ls && (Array.isArray(ls.workouts) || ls.version !== undefined))
    ? { "fitness-app-v1": JSON.stringify(ls) }
    : Object.assign({}, ls);
  const FS = {
    writeFile: async ({ path: p, data }) => {
      // Faithful to Capacitor: one options object, and `data` must be present.
      // A missing `data` writes nothing while still reporting success.
      if (typeof data !== "string") throw new Error("writeFile called without data");
      disk[p] = data;
    },
    readFile: async ({ path: p }) => {
      if (failRead) throw new Error("native timeout: readFile");
      if (!(p in disk)) throw new Error("File does not exist at " + p);
      return { data: disk[p] };
    },
    stat: async ({ path: p }) => ({ size: String(disk[p] || "").length }),
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error,
    isFinite, parseInt, parseFloat, Set, Map, setTimeout, clearTimeout,
    document: { addEventListener() {}, removeEventListener() {} },
    window: { Capacitor: { Plugins: { Filesystem: FS } } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC + "\n;globalThis.__S = Store; globalThis.__N = Native;", sandbox, { filename: "bundle.js" });
  return { Store: sandbox.__S, Native: sandbox.__N, disk, store };
}

(async () => {
  console.log("--- a FAILED read must never destroy the mirror ---");
  {
    const rich = JSON.stringify(mkState(50, 20));
    const e = env({ ls: {}, files: { [FILE]: rich }, failRead: true });
    const src = await e.Store.recover();
    eq("nothing recovered (read failed)", src, null);
    eq("mirror is byte-identical, not clobbered", e.disk[FILE] === rich, true);
    eq("mirror still holds all 50 workouts", JSON.parse(e.disk[FILE]).workouts.length, 50);
    eq("memory stays empty rather than pretending", e.Store.state.workouts.length, 0);
  }

  console.log("--- evicted localStorage is restored from the mirror ---");
  {
    const rich = JSON.stringify(mkState(50, 20));
    const e = env({ ls: {}, files: { [FILE]: rich } });
    const src = await e.Store.recover();
    eq("recovered from the mirror", src, "device mirror");
    eq("workouts restored", e.Store.state.workouts.length, 50);
    eq("bodyweight log restored too", e.Store.state.bodylog.length, 20);
  }

  console.log("--- a save during the boot window cannot empty the mirror ---");
  {
    const rich = JSON.stringify(mkState(50, 20));
    const e = env({ ls: {}, files: { [FILE]: rich } });
    e.Store.save(true);                       // fires BEFORE recovery has run
    await tick();
    eq("mirror untouched pre-hydration", e.disk[FILE] === rich, true);
    await e.Store.recover();
    eq("still intact after recovery", JSON.parse(e.disk[FILE]).workouts.length, 50);
  }

  console.log("--- a collapsed state is refused while the device holds real history ---");
  {
    const rich = JSON.stringify(mkState(50, 20));
    const e = env({ ls: {}, files: { [FILE]: rich }, failRead: true });
    await e.Store.recover();                  // hydration completes, read fails, memory empty
    e.Store.save(true);                       // now an empty state tries to mirror
    await tick();
    eq("mirror survived the collapse attempt", JSON.parse(e.disk[FILE]).workouts.length, 50);
  }

  console.log("--- ordinary editing still mirrors (the guard is not a freeze) ---");
  {
    const e = env({ ls: JSON.parse(JSON.stringify(mkState(6, 3))) });
    await e.Store.recover();
    await tick();
    e.Store.deleteWorkout("w5");              // a deliberate, ordinary deletion
    await tick();
    eq("mirror followed the edit down", JSON.parse(e.disk[FILE]).workouts.length, 5);
    e.Store.upsertWorkout({ id: "new1", date: "2026-06-01", entries: [] });
    await tick();
    eq("and back up", JSON.parse(e.disk[FILE]).workouts.length, 6);
  }

  console.log("--- a deliberate reset is allowed to shrink ---");
  {
    const rich = JSON.stringify(mkState(50, 20));
    const e = env({ ls: {}, files: { [FILE]: rich } });
    await e.Store.recover();
    e.Store.reset();
    await tick();
    eq("reset emptied the mirror as asked", JSON.parse(e.disk[FILE]).workouts.length, 0);
  }

  console.log("--- the pre-update snapshot is the last line of defence ---");
  {
    const rich = mkState(50, 20);
    const e = env({ ls: rich });
    const ok = await e.Store.snapshotPreUpdate();
    eq("snapshot written", ok, true);
    eq("snapshot holds the history", JSON.parse(e.disk[SNAP]).state.workouts.length, 50);
    eq("snapshot records why", JSON.parse(e.disk[SNAP]).why, "pre-update");
  }

  console.log("--- ...and it restores when localStorage AND the mirror are both gone ---");
  {
    const rich = mkState(50, 20);
    const e = env({ ls: rich });
    await e.Store.snapshotPreUpdate();
    // the update wiped the WebView store and the mirror never got written
    delete e.store["fitness-app-v1"];
    e.Store.reset();                                  // memory now empty
    await tick();
    const src = await e.Store.recover();
    eq("fell back to the snapshot", src, "pre-update snapshot");
    eq("history recovered", e.Store.state.workouts.length, 50);
  }

  console.log("--- a corrupt mirror does not crash or destroy the snapshot ---");
  {
    const rich = mkState(30, 10);
    const e = env({ ls: rich, corruptMirror: true });
    await e.Store.snapshotPreUpdate();
    const src = await e.Store.recover();
    eq("no crash, no false recovery from garbage", src, null);
    eq("snapshot still readable afterwards", JSON.parse(e.disk[SNAP]).state.workouts.length, 30);
  }

  console.log("--- HEADLINE: a full update cycle loses nothing ---");
  {
    // Day 0: a trained year on the device.
    const before = mkState(120, 60);
    const ids = before.workouts.map((w) => w.id);
    const e = env({ ls: before });
    await e.Store.recover();
    await tick();
    eq("baseline mirrored", JSON.parse(e.disk[FILE]).workouts.length, 120);

    // User taps update: snapshot first, then the installer runs.
    await e.Store.snapshotPreUpdate();

    // The update replaces the app. Android keeps app data, but suppose the worst:
    // the WebView store is wiped anyway.
    delete e.store["fitness-app-v1"];
    delete e.store["fitness-app-v1-backup"];

    // Fresh boot of the new version.
    const after = env({ ls: {}, files: e.disk });
    const src = await after.Store.recover();
    console.log(`        recovery source: ${src}`);
    eq("history came back", after.Store.state.workouts.length, 120);
    eq("every workout id survived", ids.every((id) => after.Store.state.workouts.some((w) => w.id === id)), true);
    eq("bodyweight log survived", after.Store.state.bodylog.length, 60);
    eq("sets survived intact", after.Store.state.workouts[0].entries[0].sets[0].rest, 120);
    eq("profile survived", after.Store.state.profile.name, "the owner");

    // and the app is fully usable afterwards
    after.Store.upsertWorkout({ id: "after1", date: "2026-12-31", entries: [] });
    await tick();
    eq("new sessions mirror normally after recovery", JSON.parse(after.disk[FILE]).workouts.length, 121);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
