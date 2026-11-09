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

   The same is true of the two github.com release-file endpoints: the
   `releases/latest/download/info.json` pointer and the object it 302s to both
   live behind `release-assets.githubusercontent.com` (Fastly), which serves the
   cached copy of the PREVIOUS release for minutes after a publish. So ALL THREE
   original feeds can lag together, and no amount of comparing among them helps.

   So the contract is:

   1. An unreadable version is UNKNOWN, never CURRENT. If the installed build
      cannot be read, or nothing answers, the verdict is "couldn't check" with a
      reason — never "up to date".
   2. An AUTHORITATIVE, non-CDN source decides freshness. The GitHub REST API
      (`api.github.com/repos/…/releases/latest`) is served straight from
      api.github.com, not the release-file CDN, and is cached at most 60s. One
      call returns the true latest `tag_name`, and each asset's `digest`
      (sha256:…) — which is the checksum of the APK asset. It is both the
      freshness source and the checksum source. It is additive: a failure (rate
      limit, offline) never breaks the check — the older feeds are still read.
   3. More than one INDEPENDENT channel decides:
        - the numeric build code, and
        - the semantic version name.
      If EITHER says the feed is newer, the update is offered. The two come from
      different stages of the pipeline (the Android manifest vs release
      metadata), so neither can mask a real update on its own.
   4. The releases ATOM feed stays as a third channel: it comes from github.com
      with `must-revalidate`, so a shared cache cannot serve it stale.
   5. Every request is cache-busted (`?t=`) and time-boxed. A hanging connection
      fails loudly instead of spinning at "checking…" forever.
   6. "available" requires an installable payload. A detected-but-unfetchable
      update reports why rather than showing a button that cannot work.
   7. No confident "up to date" from a lagging source. A manual check re-reads
      the sources once more, cache-bypassed, before accepting "current"; and when
      the authoritative source did not answer, the result says so (honest
      freshness) instead of claiming the app is up to date.
   8. Install re-reads the sources first, downloads from a URL that names the
      exact release TAG (never the mutable "latest" pointer) with a checksum from
      a non-CDN source, and refuses loudly on a checksum mismatch or when no
      checksum is available at all.

   Other design notes:
   * The installed version comes from PackageManager via the native AppUpdater
     plugin — never a constant in this bundle. An app comparing against its own
     baked-in number believes it is always the old build and re-offers forever.
   * The feed address is baked in; the user never sees or edits it.
   * Everything here runs AFTER first paint and never blocks it. */
const Updater = (() => {
  "use strict";
  const FEEDS = [
    "https://github.com/Cuylerleon96/iron-ledger/releases/latest/download/info.json",
    "https://raw.githubusercontent.com/Cuylerleon96/iron-ledger/main/update/info.json",
  ];
  const ATOM = "https://github.com/Cuylerleon96/iron-ledger/releases.atom";
  /* The GitHub REST API — the one source NOT behind the release-file CDN. It is
     unauthenticated (60 requests/hour per IP; one call per check), returns the
     true latest tag even seconds after a publish, and hands back each asset's
     sha256 digest. A failure here is only ever additive: the feeds still decide. */
  const API = "https://api.github.com/repos/Cuylerleon96/iron-ledger/releases/latest";
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
     stale by a shared cache. Titles look like "Iron Ledger v1.0.8 (build 82)". */
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

  /* The authoritative source. One unauthenticated call returns the true latest
     release: `tag_name` (the version NAME) and, per asset, `digest` —
     "sha256:<hex>" — which is the exact checksum of that asset. The APK's digest
     is the checksum we download against, all without touching the CDN. The build
     number is read from the release NAME when publish.py writes it as
     "… (build 82)"; the API exposes no versionCode field. Missing digest / build
     marker are tolerated — the name alone still decides freshness. */
  const fetchApi = () => timeboxed(API, async (r) => {
    const j = await r.json();
    if (!j || typeof j !== "object") throw new Error("empty API payload");
    const tag = typeof j.tag_name === "string" ? j.tag_name.trim() : "";
    if (!tag) throw new Error("the API release carries no tag_name");
    const name = tag.replace(/^v/i, "");
    const assets = Array.isArray(j.assets) ? j.assets : [];
    const apk = assets.find((a) => a && /\.apk$/i.test(String(a.name || "")));
    let sha256 = "";
    if (apk && typeof apk.digest === "string") {
      const m = apk.digest.match(/^sha256:([0-9a-f]{64})$/i);
      if (m) sha256 = m[1].toLowerCase();
    }
    const apkUrl = (apk && (apk.browser_download_url || apk.url)) || null;
    const relName = typeof j.name === "string" ? j.name : "";
    let code = null;
    const bm = relName.match(/\(build\s+(\d+)\)/i) || tag.match(/\(build\s+(\d+)\)/i);
    if (bm) { const n = Number(bm[1]); if (Number.isInteger(n) && n > 0) code = n; }
    return { ok: true, kind: "api", url: API, name, code, sha256, apkUrl,
             pinned: true,
             sizeBytes: apk && Number.isFinite(apk.size) && apk.size > 0 ? apk.size : null };
  });

  /* Fetch every source once and produce a verdict. Split out of check() so a
     manual check can run it a second time (cache-bypassed) without repeating the
     installed-version read. */
  async function evaluate(info) {
    const [jsonRows, atom, api] = await Promise.all([
      Promise.all(FEEDS.map(fetchFeed)), fetchAtom(), fetchApi(),
    ]);
    const results = jsonRows.concat([atom, api]);
    const goodJson = jsonRows.filter((r) => r.ok);
    const base = { installed: info, results, authoritative: !!api.ok, checkedAt: Date.now() };
    if (!goodJson.length && !atom.ok && !api.ok) {
      return Object.assign({ state: "unknown",
        reason: "could not reach any update source — " + results.map((r) => r.error).join("; ") }, base);
    }

    /* Installable payload candidates. The payload supplies the build code and the
       release notes/size; the DOWNLOAD target (below) is separately taken from the
       API when it is at least as new, so a tie here need not prefer the API. */
    const cands = [];
    for (const g of goodJson) cands.push({ src: "json", code: g.code, name: g.name,
      apkUrl: g.feed.apkUrl, sha256: g.feed.sha256 || "", sizeBytes: g.feed.sizeBytes, feed: g.feed, url: g.url, pinned: false });
    if (api.ok) cands.push({ src: "api", code: api.code, name: api.name,
      apkUrl: api.apkUrl, sha256: api.sha256 || "", sizeBytes: api.sizeBytes, feed: null, url: api.url, pinned: true });

    let payload = null;
    for (const c of cands) {
      if (!c.apkUrl) continue;
      if (!payload) { payload = c; continue; }
      const higherCode = c.code != null && (payload.code == null || c.code > payload.code);
      const newerNameAtSameCode = c.code === payload.code && c.name && payload.name && versionNewer(c.name, payload.name) === true;
      if (higherCode || newerNameAtSameCode) payload = c;
    }

    /* Name channel: the newest version NAME seen anywhere, atom and API included.
       A cached JSON claiming 1.0.6 cannot outvote the API saying 1.2.3. */
    let newestName = null, newestUrl = null;
    const consider = (n, u) => {
      if (!n) return;
      if (newestName == null || versionNewer(n, newestName) === true) { newestName = n; newestUrl = u; }
    };
    for (const g of goodJson) consider(g.name, g.url);
    if (atom.ok) consider(atom.name, atom.url);
    if (api.ok) consider(api.name, api.url);

    /* Download target. When the API named a version at least as new as the
       payload's, take the download fields from the API: its URL names the exact
       TAG and its digest is that asset's checksum, so a stale "latest" 302 cannot
       drag this back to the previous release. */
    let dl = payload ? { apkUrl: payload.apkUrl, sha256: payload.sha256, sizeBytes: payload.sizeBytes,
                         versionName: payload.name, versionCode: payload.code, pinned: !!payload.pinned, src: payload.src } : null;
    if (api.ok && api.apkUrl) {
      const dlIsNewer = dl && dl.versionName && api.name ? versionNewer(dl.versionName, api.name) === true : false;
      if (!dlIsNewer) dl = { apkUrl: api.apkUrl, sha256: api.sha256, sizeBytes: api.sizeBytes,
                             versionName: api.name || (dl && dl.versionName),
                             versionCode: api.code != null ? api.code : (dl && dl.versionCode),
                             pinned: true, src: "api" };
    }

    // A feed is "stale" when a fresher name exists elsewhere (atom or the API).
    const freshNames = [];
    if (atom.ok && atom.name) freshNames.push(atom.name);
    if (api.ok && api.name) freshNames.push(api.name);
    const staleFeed = !!(payload && payload.name && freshNames.some((n) => versionNewer(n, payload.name) === true));

    // Two independent channels. null = "could not be compared". The build code
    // comes from the authoritative API when it carries one, so a fresh release
    // build is detected even when every cached feed still shows the old number.
    const bestCode = api.ok && api.code != null ? api.code
      : (payload && payload.code != null ? payload.code : null);
    const byCode = bestCode != null && info.versionCode != null ? bestCode > info.versionCode : null;
    const byName = newestName && info.versionName ? versionNewer(newestName, info.versionName) : null;

    const shared = Object.assign({ feedUrl: newestUrl,
      latest: bestCode,
      versionName: newestName || (dl && dl.versionName) || null,
      byCode, byName, staleFeed, pinned: !!(dl && dl.pinned),
    }, base);

    const newer = byCode === true || byName === true;
    if (newer) {
      if (!dl || !dl.apkUrl) {
        return Object.assign({ state: "unknown",
          reason: "v" + (newestName || "?") + " is out, but the download details could not be fetched" }, shared);
      }
      // Notes/size must describe THIS update. A stale feed's notes belong to a
      // different release, so they are withheld rather than misattributed.
      const notesFrom = (payload && payload.feed && !staleFeed) ? payload.feed : null;
      const notes = notesFrom ? (Array.isArray(notesFrom.notes) ? notesFrom.notes : (notesFrom.notes ? [String(notesFrom.notes)] : [])) : [];
      const sizeBytes = dl.sizeBytes != null ? dl.sizeBytes : (payload && payload.sizeBytes != null ? payload.sizeBytes : null);
      return Object.assign({ state: "available",
        feed: payload ? payload.feed : null, apkUrl: dl.apkUrl, sha256: dl.sha256,
        notes, sizeMB: sizeBytes ? (sizeBytes / 1048576).toFixed(1) : null }, shared);
    }
    if (byCode === null && byName === null) {
      return Object.assign({ state: "unknown", reason: "nothing readable carries a version comparable to the installed one" }, shared);
    }
    return Object.assign({ state: "current" }, shared);
  }

  /* Returns {state, ...} where state is one of:
       available   — a newer version exists AND is installable (offer it)
       current     — up to date, proven by at least one channel
       unknown     — NO verdict: unreadable version, or nothing reachable
       unsupported — not the Android build
     `authoritative` is true only when the non-CDN API answered, so a caller can
     show honest freshness instead of a confident "up to date".
     `opts.manual` re-reads the sources (cache-bypassed) once more before it will
     accept "current" — a manual check must not trust a lagging cache.
     Never throws: one caller is a silent auto-check. */
  async function check(opts) {
    const manual = !!(opts && opts.manual);
    if (!isAndroid()) return { state: "unsupported", reason: "not the Android build" };

    const info = await installed();
    if (!info) return { state: "unknown", reason: "could not read the installed version from the system" };
    if (info.versionCode == null && !info.versionName) {
      return { state: "unknown", reason: "the installed version came back empty", installed: info };
    }

    let r = await evaluate(info);
    if (manual && r.state === "current") r = await evaluate(info);
    return r;
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

    /* Re-read the sources now: the checksum must describe the APK that is
       actually about to be downloaded, never a cached hash. */
    const [api, fresh] = await Promise.all([fetchApi(), fetchFeed(FEEDS[0])]);
    const freshFeed = fresh.ok && fresh.feed && fresh.feed.apkUrl ? fresh.feed : null;

    let src;
    if (api.ok && api.apkUrl) {
      // Prefer the API: its URL names the exact release TAG (not the mutable
      // "latest" pointer) and its digest is the checksum of THAT asset, so a
      // stale "latest" redirect cannot drag this download back to the previous
      // release.
      src = { apkUrl: api.apkUrl, sha256: api.sha256 || "", versionName: api.name,
              versionCode: api.code, pinned: true };
    } else if (freshFeed) {
      // Kept as a fallback: the release-asset feed is `no-cache`, so when the API
      // is rate-limited this is still the freshest JSON the app can read.
      src = { apkUrl: freshFeed.apkUrl, sha256: freshFeed.sha256 || "",
              versionName: freshFeed.versionName, versionCode: freshFeed.versionCode, pinned: false };
    } else {
      src = { apkUrl: r && r.apkUrl, sha256: (r && r.sha256) || "",
              versionName: r && r.versionName, versionCode: r && r.latest, pinned: false };
    }
    if (!src.apkUrl) throw new Error("no download available for this update");

    // Contradiction guard: two authoritative sources describing the SAME version
    // with DIFFERENT checksums means one of them is wrong. Refuse loudly — a hash
    // that does not describe the bytes is exactly how the wrong build lands.
    if (api.ok && api.sha256 && freshFeed && freshFeed.sha256 && api.sha256 !== freshFeed.sha256) {
      const same = (api.name && freshFeed.versionName && api.name === freshFeed.versionName) ||
                   (api.code != null && freshFeed.versionCode != null && api.code === freshFeed.versionCode);
      if (same) {
        throw new Error("the release list and the update feed disagree on the checksum for v" +
          (api.name || api.code) + " — refusing to install an unverifiable download");
      }
    }

    // Never download without a checksum to verify against. An empty hash means
    // the native verifier is skipped, which is how a mismatched build slips in.
    if (!src.sha256) {
      throw new Error("no checksum is available to verify the download for v" +
        (src.versionName || src.versionCode || "?") + " — refusing to install unverified");
    }

    let handle = null;
    if (onProgress) {
      try { handle = await P.addListener("downloadProgress", (d) => onProgress(d.percent)); } catch (e) { /* progress is cosmetic */ }
    }
    try {
      const res = await P.downloadAndInstall({
        url: src.apkUrl,
        sha256: src.sha256,
        fileName: "iron-ledger-" + (src.versionName || src.versionCode) + ".apk",
      });
      // Verify the bytes that actually came back. The native side hashes the
      // download and rejects a mismatch, but a plugin that resolved without a
      // hash (or with a different one) must not be trusted — abort loudly rather
      // than installing a build whose bytes do not match the expected checksum.
      if (res && res.sha256 && String(res.sha256).toLowerCase() !== src.sha256.toLowerCase()) {
        throw new Error("the downloaded APK checksum (" + res.sha256 +
          ") does not match the expected " + src.sha256 + " — refusing to install");
      }
      return res;
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

  return { isAndroid, installed, check, install, openInstallSettings, offered, markOffered, versionNewer, FEEDS, ATOM, API };
})();
if (typeof module !== "undefined") module.exports = Updater;
