/* updater.js — self-update against GitHub release assets.
   Optional Android bridge: no-ops in a plain browser, where there is nothing
   to install and the version check is meaningless.

   Design notes:
   * The installed version comes from the PackageManager via the native
     AppUpdater plugin — never from a constant in this bundle. An app that
     compares against its own baked-in number keeps believing it is the old
     build and re-offers the same update forever.
   * The feed is a plain JSON file on raw.githubusercontent.com, which needs no
     auth and no API rate limit. The APK comes from the release asset URL.
   * Everything here runs AFTER first paint and never blocks it. */
const Updater = (() => {
  "use strict";
  const DEFAULT_FEED = "https://raw.githubusercontent.com/Cuylerleon96/iron-ledger/main/update/info.json";
  const FEED_KEY = "iron-ledger-feed-url";
  const OFFERED_KEY = "iron-ledger-update-offered";

  const plugin = () => (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.AppUpdater) || null;
  const isAndroid = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && plugin());

  const feedUrl = () => localStorage.getItem(FEED_KEY) || DEFAULT_FEED;
  function setFeedUrl(u) {
    const v = (u || "").trim();
    if (v) localStorage.setItem(FEED_KEY, v); else localStorage.removeItem(FEED_KEY);
  }

  async function installed() {
    const P = plugin();
    if (!P) return null;
    try { return await P.getAppInfo(); } catch (e) { return null; }
  }

  const offered = () => Number(localStorage.getItem(OFFERED_KEY) || 0);
  const markOffered = (v) => localStorage.setItem(OFFERED_KEY, String(v));

  /* Returns {state, ...}. Never throws — the caller may be an auto-check that
     must stay silent on failure. */
  async function check() {
    if (!isAndroid()) return { state: "unsupported", reason: "not the Android build" };
    const info = await installed();
    if (!info) return { state: "error", reason: "cannot read installed version" };
    let feed, raw;
    try {
      const url = feedUrl() + (feedUrl().includes("?") ? "&" : "?") + "t=" + Date.now();
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      raw = await r.text();
      feed = JSON.parse(raw);
    } catch (e) {
      return { state: "error", reason: "could not reach the update feed (" + (e && e.message) + ")", installed: info };
    }
    const latest = Number(feed.versionCode || 0);
    const has = latest > Number(info.versionCode);
    return {
      state: has ? "available" : "current",
      installed: info, feed, latest,
      versionName: feed.versionName || String(latest),
      notes: Array.isArray(feed.notes) ? feed.notes : (feed.notes ? [String(feed.notes)] : []),
      apkUrl: feed.apkUrl, sha256: feed.sha256,
      sizeMB: feed.sizeBytes ? (feed.sizeBytes / 1048576).toFixed(1) : null,
    };
  }

  /* Download + verify + hand to the installer. onProgress gets 0-100. */
  async function install(feed, onProgress) {
    const P = plugin();
    if (!P) throw new Error("not the Android build");
    const info = await installed();
    if (info && !info.canInstall) {
      const err = new Error("NOT_ALLOWED_TO_INSTALL");
      err.needsPermission = true;
      throw err;
    }
    let handle = null;
    if (onProgress) {
      try { handle = await P.addListener("downloadProgress", (d) => onProgress(d.percent)); } catch (e) { /* progress is cosmetic */ }
    }
    try {
      return await P.downloadAndInstall({
        url: feed.apkUrl,
        sha256: feed.sha256 || "",
        fileName: "iron-ledger-" + (feed.versionName || feed.versionCode) + ".apk",
      });
    } finally {
      if (handle && handle.remove) { try { await handle.remove(); } catch (e) { /* ignore */ } }
    }
  }

  async function openInstallSettings() {
    const P = plugin();
    if (P) { try { await P.openInstallSettings(); } catch (e) { /* ignore */ } }
  }

  return { DEFAULT_FEED, isAndroid, feedUrl, setFeedUrl, installed, check, install, openInstallSettings, offered, markOffered };
})();
if (typeof module !== "undefined") module.exports = Updater;
