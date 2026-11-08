/* updater.js — self-update against GitHub releases.
   Optional Android bridge: no-ops in a plain browser, where there is nothing to
   install and the version check is meaningless.

   THE FAILURE THIS GUARDS AGAINST. The app once sat on 1.0.6 reporting "up to
   date" while 1.0.8 was published. Nothing was broken in the comparison — the
   feed the app read was *stale*. `raw.githubusercontent.com` serves info.json
   with `cache-control: max-age=300` behind a CDN, so any shared cache in the
   path (network, VPN, CDN edge) can hand back the copy from when the installed
   build was still newest. Then `latest > installed` is false and the verdict is
   a confident, permanent, wrong "up to date".

   So the contract is:

   1. An unreadable version is UNKNOWN, never CURRENT. If the installed build
      cannot be read, or nothing answers, the verdict is "couldn't check" with a
      reason — never "up to date".
   2. More than one INDEPENDENT channel decides:
        - the numeric build code, and
        - the semantic version name.
      If EITHER says the feed is newer, the update is offered. The two come from
      different stages of the pipeline (the Android manifest vs release
      metadata), so neither can mask a real update on its own.
   3. A channel reads from a source with DIFFERENT caching behaviour. The
      releases ATOM feed is served `max-age=0, private, must-revalidate` from
      github.com, so a shared cache cannot serve it stale — that is the channel
      that catches a cached JSON feed.
   4. Every request is cache-busted (`?t=`) and time-boxed. A hanging connection
      fails loudly instead of spinning at "checking…" forever.
   5. "available" requires an installable payload. A detected-but-unfetchable
      update reports why rather than showing a button that cannot work.
   6. Install re-reads the feed first: the sha256 must describe the APK actually
      being downloaded, never a cached hash.

   Other design notes:
   * The installed version comes from PackageManager via the native AppUpdater
     plugin — never a constant in this bundle. An app comparing against its own
     baked-in number believes it is always the old build and re-offers forever.
   * The release ASSET is the primary feed: "latest" always points at the newest
     release and it redirects with `no-cache`.
   * The feed address is baked in; the user never sees or edits it.
   * Everything here runs AFTER first paint and never blocks it. */
const Updater = (() => {
  "use strict";
  const FEEDS = [
    "https://github.com/Cuylerleon96/iron-ledger/releases/latest/download/info.json",
    "https://raw.githubusercontent.com/Cuylerleon96/iron-ledger/main/update/info.json",
  ];
  const ATOM = "https://github.com/Cuylerleon96/iron-ledger/releases.atom";
  const OFFERED_KEY = "iron-ledger-update-offered";
  const TIMEOUT_MS = 12000;

  /* Capacitor exposes itself both as a bare global and as window.Capacitor. Read
     whichever exists and never throw: a capability probe that raises would be
     caught far away and surface as a generic failure instead of "no bridge". */
  const cap = () => {
    if (typeof Capacitor !== "undefined" && Capacitor) return Capacitor;
    if (typeof window !== "undefined" && window.Capacitor) return window.Capacitor;
    return null;
  };
  const plugin = () => { const c = cap(); return (c && c.Plugins && c.Plugins.AppUpdater) || null; };
  const isAndroid = () => {
    const c = cap();
    if (!c || typeof c.isNativePlatform !== "function" || !c.isNativePlatform()) return false;
    return !!plugin();
  };

  /* Semantic compare, so "1.0.10" beats "1.0.9" — a plain string compare gets
     that backwards. Returns null when either side is uncomparable, and callers
     must treat null as "no verdict", NOT as "not newer". */
  const vparts = (v) => String(v == null ? "" : v).split(/[^0-9]+/).filter((x) => x !== "").map(Number);
  function versionNewer(a, b) {
    const A = vparts(a), B = vparts(b);
    if (!A.length || !B.length) return null;
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i] || 0, y = B[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }

  /* Normalise the native payload. A field that arrives missing, or as a string,
     must not silently become NaN — `NaN > 7` is false, which would make every
     later comparison read as "nothing newer". */
  async function installed() {
    const P = plugin();
    if (!P) return null;
    let info = null;
    try { info = await P.getAppInfo(); } catch (e) { return null; }
    if (!info) return null;
    const raw = info.versionCode != null ? info.versionCode
              : info.version_code != null ? info.version_code : info.versioncode;
    const code = Number(raw);
    return {
      versionCode: Number.isInteger(code) && code > 0 ? code : null,
      versionName: typeof info.versionName === "string" && info.versionName.trim() ? info.versionName.trim() : null,
      packageName: info.packageName || null,
      canInstall: !!info.canInstall,
    };
  }

  const timeboxed = async (url, parse) => {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), TIMEOUT_MS) : null;
    try {
      const bust = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
      const opts = { cache: "no-store" };
      if (ctl) opts.signal = ctl.signal;
      const r = await fetch(bust, opts);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await parse(r);
    } catch (e) {
      const msg = e && e.name === "AbortError" ? "timed out" : String((e && e.message) || e);
      return { ok: false, url, error: msg };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  /* One JSON feed. Never throws — returns a result row so a failure is visible. */
  const fetchFeed = (url) => timeboxed(url, async (r) => {
    const j = await r.json();
    if (!j || typeof j !== "object") throw new Error("empty payload");
    const code = Number(j.versionCode);
    const name = typeof j.versionName === "string" && j.versionName.trim() ? j.versionName.trim() : null;
    const codeOK = Number.isInteger(code) && code > 0;
    if (!codeOK && !name) throw new Error("payload carries no usable version");
    return { ok: true, kind: "json", url, feed: j, code: codeOK ? code : null, name };
  });

  /* The releases atom feed. It carries no build number, only the release titles —
     but it comes from github.com with `must-revalidate`, so it cannot be served
     stale by a shared cache. That is precisely the channel that catches a cached
     info.json. Titles look like "Iron Ledger v1.0.8". */
  const fetchAtom = () => timeboxed(ATOM, async (r) => {
    const text = await r.text();
    const titles = (text.match(/<title>[^<]*<\/title>/g) || []).map((t) => t.replace(/<\/?title>/g, ""));
    let name = null;
    for (const t of titles) {
      const m = t.match(/\bv?(\d+(?:\.\d+)+)\b/);
      if (!m) continue;
      if (name == null || versionNewer(m[1], name) === true) name = m[1];
    }
    if (!name) throw new Error("no version in the release feed");
    return { ok: true, kind: "atom", url: ATOM, code: null, name };
  });

  /* Returns {state, ...} where state is one of:
       available   — a newer version exists AND is installable (offer it)
       current     — up to date, proven by at least one channel
       unknown     — NO verdict: unreadable version, or nothing reachable
       unsupported — not the Android build
     Never throws: one caller is a silent auto-check. */
  async function check() {
    if (!isAndroid()) return { state: "unsupported", reason: "not the Android build" };

    const info = await installed();
    if (!info) return { state: "unknown", reason: "could not read the installed version from the system" };
    if (info.versionCode == null && !info.versionName) {
      return { state: "unknown", reason: "the installed version came back empty", installed: info };
    }

    const [jsonRows, atom] = await Promise.all([Promise.all(FEEDS.map(fetchFeed)), fetchAtom()]);
    const results = jsonRows.concat([atom]);
    const goodJson = jsonRows.filter((r) => r.ok);
    if (!goodJson.length && !atom.ok) {
      return { state: "unknown", installed: info, results,
        reason: "could not reach any update source — " + results.map((r) => r.error).join("; ") };
    }

    // Installable payload: the JSON with the highest build number. Only a JSON
    // feed carries apkUrl/sha256, so this is what a download would use.
    let payload = null;
    for (const g of goodJson) {
      if (!payload || (g.code != null && (payload.code == null || g.code > payload.code))) payload = g;
    }

    // Name channel: the newest version NAME seen anywhere, atom included. A
    // cached JSON claiming 1.0.6 cannot outvote a fresh atom saying 1.0.8.
    let newestName = null, newestUrl = null;
    const consider = (n, u) => {
      if (!n) return;
      if (newestName == null || versionNewer(n, newestName) === true) { newestName = n; newestUrl = u; }
    };
    for (const g of goodJson) consider(g.name, g.url);
    if (atom.ok) consider(atom.name, atom.url);

    // Two independent channels. null = "could not be compared".
    const byCode = payload && payload.code != null && info.versionCode != null ? payload.code > info.versionCode : null;
    const byName = newestName && info.versionName ? versionNewer(newestName, info.versionName) : null;

    const shared = {
      installed: info, results, feedUrl: newestUrl,
      latest: payload ? payload.code : null,
      versionName: newestName || (payload && payload.code != null ? String(payload.code) : null),
      byCode, byName, staleFeed: !!(payload && atom.ok && payload.name && versionNewer(atom.name, payload.name) === true),
    };

    const newer = byCode === true || byName === true;
    if (newer) {
      // An update we cannot download is not an update the user can act on, so say
      // why rather than showing a button that cannot work.
      if (!payload || !payload.feed || !payload.feed.apkUrl) {
        return Object.assign({ state: "unknown",
          reason: "v" + (newestName || "?") + " is out, but the download details could not be fetched" }, shared);
      }
      const feed = payload.feed;
      // When the payload came from a stale cache its notes and size describe a
      // DIFFERENT release, so do not present them as this update's. The verdict
      // and the version name came from the fresh channel. The download URL is a
      // "latest" pointer so it is still correct, and install() re-reads the feed
      // for the real sha256 before downloading.
      const stale = shared.staleFeed;
      return Object.assign({ state: "available",
        feed, apkUrl: feed.apkUrl, sha256: feed.sha256,
        notes: stale ? [] : (Array.isArray(feed.notes) ? feed.notes : (feed.notes ? [String(feed.notes)] : [])),
        sizeMB: stale || !feed.sizeBytes ? null : (feed.sizeBytes / 1048576).toFixed(1) }, shared);
    }
    // Claim "current" only when a channel actually rendered a verdict.
    if (byCode === null && byName === null) {
      return Object.assign({ state: "unknown", reason: "nothing readable carries a version comparable to the installed one" }, shared);
    }
    return Object.assign({ state: "current" }, shared);
  }

  /* Download + verify + hand to the installer. onProgress gets 0-100. */
  async function install(r, onProgress) {
    const P = plugin();
    if (!P) throw new Error("not the Android build");
    const info = await installed();
    if (info && !info.canInstall) {
      const err = new Error("NOT_ALLOWED_TO_INSTALL");
      err.needsPermission = true;
      throw err;
    }

    // Re-read the authoritative feed now. The sha256 must describe the APK that
    // is actually about to be downloaded; installing on cached metadata could
    // hand the verifier a hash for a different build. The release asset redirect
    // is `no-cache`, so this is the fresh copy.
    let src = { apkUrl: r && r.apkUrl, sha256: (r && r.sha256) || "", versionName: r && r.versionName, versionCode: r && r.latest };
    const fresh = await fetchFeed(FEEDS[0]);
    if (fresh.ok && fresh.feed && fresh.feed.apkUrl) {
      src = { apkUrl: fresh.feed.apkUrl, sha256: fresh.feed.sha256 || "",
              versionName: fresh.feed.versionName, versionCode: fresh.feed.versionCode };
    }
    if (!src.apkUrl) throw new Error("no download available for this update");

    let handle = null;
    if (onProgress) {
      try { handle = await P.addListener("downloadProgress", (d) => onProgress(d.percent)); } catch (e) { /* progress is cosmetic */ }
    }
    try {
      return await P.downloadAndInstall({
        url: src.apkUrl,
        sha256: src.sha256,
        fileName: "iron-ledger-" + (src.versionName || src.versionCode) + ".apk",
      });
    } finally {
      if (handle && handle.remove) { try { await handle.remove(); } catch (e) { /* ignore */ } }
    }
  }

  async function openInstallSettings() {
    const P = plugin();
    if (P) { try { await P.openInstallSettings(); } catch (e) { /* ignore */ } }
  }

  const offered = () => Number(localStorage.getItem(OFFERED_KEY) || 0);
  const markOffered = (v) => localStorage.setItem(OFFERED_KEY, String(v));

  return { isAndroid, installed, check, install, openInstallSettings, offered, markOffered, versionNewer, FEEDS, ATOM };
})();
if (typeof module !== "undefined") module.exports = Updater;
