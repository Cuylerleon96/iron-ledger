/* native.js — optional Android bridge (Capacitor). No-ops in a plain browser.
   Purpose: localStorage alone is a single point of failure for a year of data,
   so every save is mirrored to the app's private storage on device and read back
   when localStorage comes up empty.

   HARD RULES — each of these cost real data or real debugging time:

   1. A plugin call issued before the bridge is ready NEVER settles. Awaiting one
      at DOMContentLoaded hangs the caller forever with no error at all. So every
      call waits for `deviceready` (with a timed fallback), is raced against a
      timeout, and callers must never gate the first paint on it.

   2. A read returns a STATUS, never null-for-both. "The file is absent" and "the
      read failed" are entirely different facts: the caller may write over an
      absent file, but must never write over one it merely FAILED to read.
      Conflating the two means a single transient timeout during a cold start
      overwrites the only remaining copy of the user's history with whatever
      happens to be in memory. Absence therefore has to be positively identified
      (a "no such file" error); anything else leaves the file protected. */
const Native = (() => {
  "use strict";
  const C = (typeof window !== "undefined" && window.Capacitor) || null;
  const Plugins = (C && C.Plugins) || {};
  const FS = Plugins.Filesystem || null;
  const DIR = "DATA";                       // Capacitor's Directory enum values are UPPERCASE.
                                            // "Data" (mixed case) is rejected with INVALID_DIR —
                                            // the plugin switches on "DATA". Maps to getFilesDir().
  const FILE = "iron-ledger-state.json";
  const SNAP_FILE = "iron-ledger-preupdate.json";
  // The in-progress session draft is mirrored here under its OWN file, never the
  // state file: a draft write must not touch (or shrink) real history, and a
  // draft read must not be confused with the whole-state mirror.
  const DRAFT_FILE = "iron-ledger-draft.json";
  const has = !!FS;

  let bridgeReady = false;
  function waitReady() {
    if (bridgeReady) return Promise.resolve();
    return new Promise((resolve) => {
      const fin = () => { if (!bridgeReady) { bridgeReady = true; resolve(); } };
      if (typeof document === "undefined") return fin();
      document.addEventListener("deviceready", fin, { once: true });
      setTimeout(fin, 1500);                // deviceready may already have fired
    });
  }

  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("native timeout: " + label)), ms)),
  ]);

  /* NOTE: the write options must carry `data`. Capacitor's writeFile takes ONE
     object, so building the options without it silently writes nothing at all —
     the mirror would report success while storing no content. */
  const fileOpts = (name) => ({ path: name, directory: DIR, encoding: "utf8" });

  async function writeNamed(name, text) {
    if (!has) return false;
    try {
      await waitReady();
      const opts = fileOpts(name);
      opts.data = text;                        // without this, Capacitor writes nothing
      await withTimeout(FS.writeFile(opts), 8000, "writeFile");
      // Read back a byte count so a silently-failed write is detectable rather
      // than assumed successful.
      try {
        const st = await withTimeout(FS.stat(fileOpts(name)), 5000, "stat");
        if (st && typeof st.size === "number" && st.size === 0) {
          console.warn("native write produced an empty file:", name);
          return false;
        }
      } catch (e) { /* stat is a nicety; the write itself succeeded */ }
      return true;
    } catch (e) { console.warn("native write failed (" + name + "):", e && e.message); return false; }
  }

  /* ok:true                     -> text holds the file's contents
     ok:false, missing:true      -> positively absent; safe for the caller to write
     ok:false, missing:false     -> UNKNOWN; the caller must not overwrite anything */
  async function readNamed(name) {
    if (!has) return { ok: false, missing: false, error: "no filesystem plugin" };
    try {
      await waitReady();
      const r = await withTimeout(FS.readFile(fileOpts(name)), 8000, "readFile");
      const txt = r && r.data ? r.data : null;
      if (!txt) return { ok: false, missing: true, error: "file is empty" };
      return { ok: true, text: txt };
    } catch (e) {
      const msg = String((e && e.message) || e);
      const absent = /does not exist|doesn't exist|not exist|not found|no such file|ENOENT/i.test(msg);
      console.warn("native read failed (" + name + "):", msg);
      return { ok: false, missing: absent, error: msg };
    }
  }

  async function deleteNamed(name) {
    if (!has) return false;
    try {
      await waitReady();
      await withTimeout(FS.deleteFile(fileOpts(name)), 8000, "deleteFile");
      return true;
    } catch (e) { console.warn("native delete failed (" + name + "):", e && e.message); return false; }
  }

  const write = (text) => writeNamed(FILE, text);
  const read = () => readNamed(FILE);
  const writeSnapshot = (text) => writeNamed(SNAP_FILE, text);
  const readSnapshot = () => readNamed(SNAP_FILE);
  const BAK_PREFIX = "iron-ledger-backup-";
  const info = () => ({ available: has, dir: DIR, file: FILE, snapshot: SNAP_FILE, draft: DRAFT_FILE, backupPrefix: BAK_PREFIX });

  return { available: has, write, read, writeNamed, readNamed, deleteNamed,
           writeSnapshot, readSnapshot, info, DIR, FILE, SNAP_FILE, DRAFT_FILE, BAK_PREFIX };
})();
if (typeof module !== "undefined") module.exports = Native;
