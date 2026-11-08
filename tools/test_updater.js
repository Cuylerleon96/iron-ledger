/* Updater fail-proof contract. The bug this pins down: the app sat on 1.0.6
   saying "up to date" while 1.0.8 was published, because the JSON feed it read
   was stale (raw.githubusercontent.com serves it max-age=300 behind a CDN).
   Run: node tools/test_updater.js */
const fs = require("fs"), vm = require("vm");
const SRC = fs.readFileSync(require("path").join(__dirname, "..", "js", "updater.js"), "utf8");

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const FEED_JSON = (code, name, withApk = true) => ({
  versionCode: code, versionName: name, sizeBytes: 3236137, sha256: "abc123",
  notes: ["note one"], apkUrl: withApk ? "https://github.com/Cuylerleon96/iron-ledger/releases/latest/download/iron-ledger.apk" : undefined,
});
const ATOM_XML = (ver) => `<feed><title>Release notes from iron-ledger</title>` +
  `<entry><title>Iron Ledger v${ver}</title></entry>` +
  `<entry><title>Iron Ledger v1.0.6</title></entry></feed>`;

function makeFetch(routes) {
  return async (url, opts) => {
    for (const [match, reply] of routes) {
      if (url.includes(match)) {
        const r = typeof reply === "function" ? reply(url) : reply;
        if (r === "hang") {
          return new Promise((_, rej) => {
            if (opts && opts.signal) opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
          });
        }
        const text = typeof r === "string" ? r : JSON.stringify(r);
        return { ok: true, status: 200, json: async () => (typeof r === "string" ? JSON.parse(r) : r), text: async () => text };
      }
    }
    return { ok: false, status: 404, json: async () => { throw new Error("HTTP 404"); }, text: async () => "" };
  };
}

function run({ installed, routes }) {
  const store = new Map();
  const sandbox = {
    console, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    AbortController,
    Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: {
      getAppInfo: async () => installed,
      addListener: async () => ({ remove: async () => {} }),
      downloadAndInstall: async (a) => ({ ok: true, args: a }),
    } } },
    window: { Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: {
      getAppInfo: async () => installed,
      addListener: async () => ({ remove: async () => {} }),
      downloadAndInstall: async (a) => ({ ok: true, args: a }),
    } } } },
    fetch: makeFetch(routes),
    module: { exports: {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC + "\n;globalThis.__U = Updater;", sandbox, { filename: "updater.js" });
  return sandbox.__U;
}

const FRESH = FEED_JSON(9, "1.0.8");
const STALE = FEED_JSON(7, "1.0.6");
const INST_106 = { versionCode: 7, versionName: "1.0.6", canInstall: true };

(async () => {
  console.log("--- the reported bug: a stale cached feed must not read as 'up to date' ---");
  {
    // both JSON sources hang on to the copy cached while 1.0.6 was newest; the
    // atom feed is must-revalidate so it still sees 1.0.8
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", STALE],
      ["raw.githubusercontent.com", STALE],
    ] });
    const r = await U.check();
    console.log(`        stale JSON says ${STALE.versionName}; atom says 1.0.8 -> ${r.state}`);
    eq("state is available", r.state, "available");
    eq("the name channel caught it", r.byName, true);
    eq("the code channel alone would have missed it", r.byCode, false);
    eq("the stale feed is flagged", r.staleFeed, true);
    eq("offers the newest name", r.versionName, "1.0.8");
    eq("still yields a working download target", /releases\/latest\/download\/iron-ledger\.apk$/.test(r.apkUrl), true);
  }

  console.log("--- an up-to-date app is still reported as up to date ---");
  {
    const U = run({ installed: { versionCode: 9, versionName: "1.0.8", canInstall: true }, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FRESH],
      ["raw.githubusercontent.com", FRESH],
    ] });
    const r = await U.check();
    eq("state is current", r.state, "current");
    eq("no stale flag", r.staleFeed, false);
  }

  console.log("--- nothing reachable is UNKNOWN, never 'up to date' ---");
  {
    const U = run({ installed: INST_106, routes: [["*", "hang"]].map(([m, v]) => [m === "*" ? "http" : m, v]) });
    const U2 = run({ installed: INST_106, routes: [["github", "hang"], ["raw", "hang"]] });
    const r = await U2.check();
    console.log(`        reason: ${r.reason}`);
    eq("state is unknown (NOT current)", r.state, "unknown");
    eq("a reason is given", typeof r.reason === "string" && r.reason.length > 0, true);
  }

  console.log("--- an unreadable installed build code still works via the name channel ---");
  {
    const U = run({ installed: { versionCode: null, versionName: "1.0.6", canInstall: true }, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FRESH],
      ["raw.githubusercontent.com", FRESH],
    ] });
    const r = await U.check();
    eq("available by name alone", r.state, "available");
    eq("code channel unusable, not silently false-voting", r.byCode, null);
    eq("name channel decided", r.byName, true);
  }

  console.log("--- a build code arriving as a string is still usable ---");
  {
    const U = run({ installed: { versionCode: "7", versionName: "1.0.6", canInstall: true }, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FEED_JSON("9", "1.0.8")],
      ["raw.githubusercontent.com", FRESH],
    ] });
    const r = await U.check();
    eq("string '7' normalises to 7", r.installed.versionCode, 7);
    eq("available", r.state, "available");
  }

  console.log("--- a detected update with no downloadable payload is not a dead button ---");
  {
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FEED_JSON(9, "1.0.8", false)],
      ["raw.githubusercontent.com", FEED_JSON(9, "1.0.8", false)],
    ] });
    const r = await U.check();
    console.log(`        reason: ${r.reason}`);
    eq("state is unknown, not a broken 'available'", r.state, "unknown");
    eq("says the version it saw", /1\.0\.8/.test(r.reason), true);
  }

  console.log("--- semantic compare beats a naive string compare ---");
  {
    const U = run({ installed: INST_106, routes: [["github", "hang"], ["raw", "hang"]] });
    eq("1.0.10 is newer than 1.0.9", U.versionNewer("1.0.10", "1.0.9"), true);
    eq("1.0.9 is not newer than 1.0.10", U.versionNewer("1.0.9", "1.0.10"), false);
    eq("equal versions are not newer", U.versionNewer("1.0.8", "1.0.8"), false);
    eq("uncomparable yields no verdict", U.versionNewer("", "1.0.8"), null);
  }

  console.log("--- every request is cache-busted ---");
  {
    const seen = [];
    const U = run({ installed: INST_106, routes: [["github", "hang"], ["raw", "hang"]] });
    const sandboxFetch = U;
    // re-run with a recording fetch
    const U2 = (() => {
      const store = new Map();
      const sb = {
        console, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat,
        setTimeout, clearTimeout, AbortController,
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: () => {}, removeItem: () => {} },
        Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: { getAppInfo: async () => INST_106, addListener: async () => ({ remove: async () => {} }) } } },
        window: { Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: { getAppInfo: async () => INST_106, addListener: async () => ({ remove: async () => {} }) } } } },
        fetch: async (url) => { seen.push(url); return { ok: true, status: 200, text: async () => ATOM_XML("1.0.8"), json: async () => FRESH }; },
        module: { exports: {} },
      };
      sb.globalThis = sb; vm.createContext(sb);
      vm.runInContext(SRC + "\n;globalThis.__U = Updater;", sb, { filename: "updater.js" });
      return sb.__U;
    })();
    await U2.check();
    eq("all requests carry a cache-buster", seen.length > 0 && seen.every((u) => u.includes("t=")), true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
