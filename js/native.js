/* native.js — optional Android bridge (Capacitor). No-ops in a plain browser.
   Purpose: localStorage alone is a single point of failure for a year of data,
   so every save is mirrored to the app's private storage on device and read
   back if localStorage ever comes up empty.

   Hard rule learned the hard way: a Capacitor plugin call issued before the
   bridge is ready NEVER settles. Awaiting one at DOMContentLoaded hangs the
   caller forever with no error at all — the app just renders nothing. So every
   call here waits for `deviceready` (with a timed fallback, for when it has
   already fired), is raced against a timeout, and callers must never gate the
   first paint on it. */
const Native = (() => {
  "use strict";
  const C = (typeof window !== "undefined" && window.Capacitor) || null;
  const Plugins = (C && C.Plugins) || {};
  const FS = Plugins.Filesystem || null;
  const DIR = "DATA";                       // Capacitor's Directory enum values are UPPERCASE.
                                            // "Data" (mixed case) is rejected with INVALID_DIR —
                                            // the plugin switches on "DATA". Maps to getFilesDir().
  const FILE = "iron-ledger-state.json";
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

  async function write(text) {
    if (!has) return false;
    try {
      await waitReady();
      await withTimeout(FS.writeFile({ path: FILE, data: text, directory: DIR, encoding: "utf8" }), 8000, "writeFile");
      return true;
    } catch (e) { console.warn("native mirror failed:", e && e.message); return false; }
  }

  async function read() {
    if (!has) return null;
    try {
      await waitReady();
      const r = await withTimeout(FS.readFile({ path: FILE, directory: DIR, encoding: "utf8" }), 8000, "readFile");
      return r && r.data ? r.data : null;
    } catch (e) { console.warn("native read failed:", e && e.message); return null; }
  }

  const info = () => ({ available: has, dir: DIR, file: FILE });
  return { available: has, write, read, info, DIR, FILE };
})();
if (typeof module !== "undefined") module.exports = Native;
