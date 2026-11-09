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
        if (r && typeof r === "object" && r.__status) {
          const code = r.__status;
          return { ok: false, status: code, json: async () => { throw new Error("HTTP " + code); }, text: async () => "" };
        }
        const text = typeof r === "string" ? r : JSON.stringify(r);
        return { ok: true, status: 200, json: async () => (typeof r === "string" ? JSON.parse(r) : r), text: async () => text };
      }
    }
    return { ok: false, status: 404, json: async () => { throw new Error("HTTP 404"); }, text: async () => "" };
  };
}

function run({ installed, routes, onInstall }) {
  const store = new Map();
  const dl = async (a) => (onInstall ? onInstall(a) : { ok: true, args: a });
  const sandbox = {
    console, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat,
    setTimeout, clearTimeout,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    AbortController,
    Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: {
      getAppInfo: async () => installed,
      addListener: async () => ({ remove: async () => {} }),
      downloadAndInstall: dl,
    } } },
    window: { Capacitor: { isNativePlatform: () => true, Plugins: { AppUpdater: {
      getAppInfo: async () => installed,
      addListener: async () => ({ remove: async () => {} }),
      downloadAndInstall: dl,
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

/* The GitHub REST API release object, shaped as api.github.com returns it: the
   true tag, the release NAME carrying "(build N)", and per-asset sha256 digests. */
const hex = (c) => c.repeat(64);
const PINNED = (name) => "https://github.com/Cuylerleon96/iron-ledger/releases/download/v" + name + "/iron-ledger.apk";
const API_REL = (name, code, apkSha, apkUrl) => ({
  tag_name: "v" + name,
  name: "Iron Ledger v" + name + " (build " + code + ")",
  assets: [
    { name: "info.json", size: 406, digest: "sha256:" + hex("0"),
      browser_download_url: "https://github.com/Cuylerleon96/iron-ledger/releases/download/v" + name + "/info.json" },
    { name: "iron-ledger.apk", size: 3903849, digest: "sha256:" + apkSha,
      browser_download_url: apkUrl || PINNED(name) },
  ],
});

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

  console.log("--- the non-CDN API source is decisive when every CDN feed is stale ---");
  {
    const S = hex("a");
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.6")],
      ["releases/latest/download/info.json", STALE],
      ["raw.githubusercontent.com", STALE],
      ["api.github.com", API_REL("1.0.8", 9, S)],
    ] });
    const r = await U.check();
    console.log(`        all three feeds stale at 1.0.6; API says 1.0.8 (build 9) -> ${r.state}`);
    eq("state is available", r.state, "available");
    eq("the name channel caught it", r.byName, true);
    eq("the build channel caught it too (API build 9)", r.byCode, true);
    eq("the API is flagged authoritative", r.authoritative, true);
    eq("offers the API's version name", r.versionName, "1.0.8");
    eq("download names the exact tag, not the mutable 'latest' pointer",
       /releases\/download\/v1\.0\.8\/iron-ledger\.apk$/.test(r.apkUrl), true);
    eq("checksum is the API's non-CDN digest", r.sha256, S);
    eq("the payload is marked version-pinned", r.pinned, true);
  }

  console.log("--- a name-only API answer still overrides stale feeds ---");
  {
    const S = hex("b");
    const api = API_REL("1.0.8", 9, S);
    delete api.name;                                    // an older release: no build marker
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.6")],
      ["releases/latest/download/info.json", STALE],
      ["raw.githubusercontent.com", STALE],
      ["api.github.com", api],
    ] });
    const r = await U.check();
    eq("still offered via the name channel", r.state, "available");
    eq("name channel decided", r.byName, true);
    eq("the stale build number cannot outvote the name channel", r.byCode, false);
  }

  console.log("--- without the API, a lagging 'current' is not claimed confidently ---");
  {
    const U = run({ installed: { versionCode: 9, versionName: "1.0.8", canInstall: true }, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FRESH],
      ["raw.githubusercontent.com", FRESH],
    ] });                                              // api.github.com unmatched -> 404
    const r = await U.check();
    eq("state is still current", r.state, "current");
    eq("but marked NOT authoritative", r.authoritative, false);
    eq("a freshness timestamp is carried", typeof r.checkedAt === "number" && r.checkedAt > 0, true);
  }

  console.log("--- the API failing (rate limit / offline) never breaks the check ---");
  {
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", FRESH],
      ["raw.githubusercontent.com", FRESH],
      ["api.github.com", { __status: 403 }],            // e.g. rate limited
    ] });
    const r = await U.check();
    eq("the feeds still decide", r.state, "available");
    eq("and it is not marked authoritative", r.authoritative, false);
    eq("the API failure is recorded", r.results.some((x) => !x.ok && /api\.github\.com/.test(x.url) && /403/.test(x.error)), true);
  }

  console.log("--- a manual check re-reads a lagging cache and finds the new release ---");
  {
    let apiCalls = 0;
    const S = hex("c");
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.6")],
      ["releases/latest/download/info.json", STALE],
      ["raw.githubusercontent.com", STALE],
      ["api.github.com", () => { apiCalls++; return apiCalls === 1 ? { __status: 404 } : API_REL("1.0.8", 9, S); }],
    ] });
    const auto = await U.check();
    eq("the automatic check sees only the stale cache -> current", auto.state, "current");
    eq("the automatic check only asked the API once", apiCalls, 1);
    const r = await U.check({ manual: true });
    eq("the manual re-read finds the new release", r.state, "available");
    eq("via the API's name", r.versionName, "1.0.8");
    eq("the API was queried a second time", apiCalls, 2);
  }

  console.log("--- release notes survive when the API supplies the download target ---");
  {
    const S = hex("7");
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", { versionCode: 9, versionName: "1.0.8", sha256: S, sizeBytes: 3903849, notes: ["note one", "note two"], apkUrl: PINNED("1.0.8") }],
      ["raw.githubusercontent.com", { versionCode: 9, versionName: "1.0.8", sha256: S, sizeBytes: 3903849, notes: ["note one", "note two"], apkUrl: PINNED("1.0.8") }],
      ["api.github.com", API_REL("1.0.8", 9, S)],
    ] });
    const r = await U.check();
    eq("available", r.state, "available");
    eq("the release notes still reach the prompt", r.notes, ["note one", "note two"]);
    eq("but the download is the API-pinned one", r.sha256, S);
    eq("and marked pinned", r.pinned, true);
  }

  console.log("--- install downloads from the pinned URL and the API checksum ---");
  {
    const S = hex("1");
    let got = null;
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", STALE],
      ["raw.githubusercontent.com", STALE],
      ["api.github.com", API_REL("1.0.8", 9, S)],
    ], onInstall: async (a) => { got = a; return { ok: true, sha256: S, bytes: 3903849 }; } });
    const r = await U.check();
    const res = await U.install(r, null);
    eq("install succeeded", !!(res && res.ok), true);
    eq("downloaded the version-pinned URL (a stale 'latest' 302 cannot redirect it)",
       got.url, PINNED("1.0.8"));
    eq("verified against the API digest, not the stale feed's sha", got.sha256, S);
  }

  console.log("--- install aborts loudly on a mismatched sha ---");
  {
    const S = hex("d"), BAD = hex("e");
    let got = null;
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", { versionCode: 9, versionName: "1.0.8", sha256: S, sizeBytes: 3903849, apkUrl: PINNED("1.0.8") }],
      ["raw.githubusercontent.com", { versionCode: 9, versionName: "1.0.8", sha256: S, sizeBytes: 3903849, apkUrl: PINNED("1.0.8") }],
      ["api.github.com", API_REL("1.0.8", 9, S)],
    ], onInstall: async (a) => { got = a; return { ok: true, sha256: BAD, bytes: 1 }; } });
    const r = await U.check();
    let err = null;
    try { await U.install(r, null); } catch (e) { err = e; }
    eq("the mismatch aborts loudly", !!(err && /checksum/i.test(err.message)), true);
    eq("it did download from the pinned URL", got && /releases\/download\/v1\.0\.8\/iron-ledger\.apk$/.test(got.url), true);
    eq("it asked for the expected checksum", got && got.sha256, S);
  }

  console.log("--- install refuses when no checksum is available to verify against ---");
  {
    const noSha = { versionCode: 9, versionName: "1.0.8", apkUrl: PINNED("1.0.8") };
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", noSha],
      ["raw.githubusercontent.com", noSha],
    ], onInstall: async (a) => ({ ok: true, args: a }) });
    const r = await U.check();
    let err = null;
    try { await U.install(r, null); } catch (e) { err = e; }
    eq("refuses to install unverified", !!(err && /checksum/i.test(err.message)), true);
  }

  console.log("--- install aborts when two sources disagree on the checksum for one version ---");
  {
    const S = hex("2"), OTHER = hex("3");
    const U = run({ installed: INST_106, routes: [
      ["releases.atom", ATOM_XML("1.0.8")],
      ["releases/latest/download/info.json", { versionCode: 9, versionName: "1.0.8", sha256: OTHER, apkUrl: PINNED("1.0.8") }],
      ["raw.githubusercontent.com", FRESH],
      ["api.github.com", API_REL("1.0.8", 9, S)],
    ], onInstall: async () => { throw new Error("should not have downloaded"); } });
    const r = await U.check();
    let err = null;
    try { await U.install(r, null); } catch (e) { err = e; }
    eq("a same-version checksum disagreement aborts", !!(err && /disagree/i.test(err.message)), true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
