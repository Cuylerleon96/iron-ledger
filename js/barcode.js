/* barcode.js — barcode scanning: the capability gate, GTIN resolution against
   Open Food Facts, and the scanner's screen content.

   PURE by design: no DOM, no camera, no network of its own. The environment
   (typeof BarcodeDetector / isSecureContext), the fetch, and the cache store are
   all INJECTED, so every branch is exercised without a phone. The camera + DOM
   wiring lives in app.js.

   Ground facts this module is built around (measured on the target device, not
   assumed):
     - The Web BarcodeDetector API on Android is implemented by Google Play
       Services. A de-Googled phone has no detector at all, so "unsupported" is a
       real, expected product state — it must be explained, not hidden.
     - The API also needs a SECURE CONTEXT (https://localhost qualifies).
     - Supported FORMATS vary by platform, so we check for the formats packaged
       food actually uses (EAN-13 / UPC-A) instead of assuming any code decodes. */
const Barcode = (() => {
  "use strict";

  /* Packaged food is EAN-13 (13 digits) or UPC-A (12 digits, North America).
     The detector reports exactly which symbologies it can read. */
  const NEEDED_FORMATS = ["ean_13", "upc_a"];
  const OFF_BASE = "https://world.openfoodfacts.org/api/v2/product/";
  const MISS_SOURCE = "off-missing";   // a cached "not in the database" tombstone

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const round2 = (x) => Math.round(x * 100) / 100;
  const hasFood = () => (typeof Food !== "undefined" && !!Food.saveBarcode);

  /* ---------- (1) the capability gate ----------
     decide() is PURE and synchronous so it is directly testable. env carries the
     two raw readings; formats is the array from getSupportedFormats() (or null). */
  function decide(env, formats) {
    env = env || {};
    if (!env.hasDetector) {
      return { available: false, reason: "no-detector",
        message: "This device's browser has no barcode detector. On Android that " +
          "part comes from Google Play Services, so a phone without them — or a " +
          "browser without the API — can't scan. You can still log food by name." };
    }
    if (!env.isSecureContext) {
      return { available: false, reason: "insecure-context",
        message: "Scanning needs a secure (https) page. This page isn't a secure " +
          "context, so the browser won't hand over the camera." };
    }
    if (env.formatsError) {
      return { available: false, reason: "formats-error",
        message: "The detector is present but this device wouldn't report which " +
          "barcodes it can read, so scanning can't be trusted here." };
    }
    const have = Array.isArray(formats) ? formats.map(String) : [];
    const supported = NEEDED_FORMATS.filter((f) => have.indexOf(f) >= 0);
    if (!supported.length) {
      return { available: false, reason: "missing-format", supported, missing: NEEDED_FORMATS.slice(),
        supportedAll: have,
        message: "This device can read some barcodes but not the ones on food: it " +
          "offers " + (have.length ? have.join(", ") : "no formats") +
          ", and packaged food uses EAN-13 or UPC-A." };
    }
    return { available: true, reason: "ok", supported,
      missing: NEEDED_FORMATS.filter((f) => supported.indexOf(f) < 0), supportedAll: have };
  }

  /* Read the two raw facts from a global-ish object. Separate from decide() so
     the wiring (typeof, isSecureContext) is testable without a real browser. */
  function readEnv(env) {
    env = env || (typeof globalThis !== "undefined" ? globalThis : {});
    return {
      hasDetector: typeof env.BarcodeDetector === "function",
      isSecureContext: env.isSecureContext === true,
    };
  }

  /* The real browser check: read the env, then ask the detector for its formats
     (async), then hand both to decide(). The result ALSO carries the raw readings
     (hasDetector / isSecureContext / formats) so the UI can show its work. */
  async function capability(env) {
    env = env || (typeof globalThis !== "undefined" ? globalThis : {});
    const e = readEnv(env);
    let formats = null, formatsError = null;
    if (e.hasDetector) {
      try { formats = await env.BarcodeDetector.getSupportedFormats(); }
      catch (err) { formatsError = String((err && err.message) || err); }
    }
    const d = decide({ hasDetector: e.hasDetector, isSecureContext: e.isSecureContext, formatsError }, formats);
    d.hasDetector = e.hasDetector;
    d.isSecureContext = e.isSecureContext;
    d.formats = formats;
    d.formatsError = formatsError;
    return d;
  }

  /* ---------- (2) the GTIN ----------
     Canonical key for the cache and the lookup. UPC-A is the same article as
     EAN-13 with a leading zero, so a 12-digit code is left-padded to 13 — one key
     for one product. Anything not a known GTIN length is rejected, not guessed. */
  function normalizeGtin(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/\D+/g, "");
    if (digits.length === 12) return "0" + digits;
    if (digits.length === 8 || digits.length === 13 || digits.length === 14) return digits;
    return null;
  }

  const offUrl = (gtin) => OFF_BASE + encodeURIComponent(String(gtin)) + ".json";

  /* ---------- (3) Open Food Facts -> the app's barcode record ----------
     PURE parse of the v2 product response into the exact shape js/food.js's
     saveBarcode() accepts: {barcode, name, per100, measures, source}. Absent
     nutrients stay ABSENT (never a 0). status 0 / no product / no name = not
     found. Energy is kcal when given, else the kJ figure converted. */
  function parseProduct(gtin, body) {
    if (!body || typeof body !== "object") return { state: "notfound", gtin };
    if (Number(body.status) === 0) return { state: "notfound", gtin };
    const p = body.product;
    if (!p || typeof p !== "object") return { state: "notfound", gtin };
    const name = [p.product_name, p.product_name_en, p.generic_name]
      .map((x) => (x == null ? "" : String(x).trim()))
      .find((x) => x.length) || "";
    if (!name) return { state: "notfound", gtin };

    const n = p.nutriments || {};
    const num = (x) => {
      if (typeof x === "number") return isFinite(x) ? x : null;
      if (typeof x === "string" && x.trim() !== "") { const v = Number(x); return isFinite(v) ? v : null; }
      return null;
    };
    const per100 = {};
    const put = (k, v) => { if (v != null) per100[k] = round2(v); };
    let kcal = num(n["energy-kcal_100g"]);
    if (kcal == null) { const kj = num(n.energy_100g); if (kj != null) kcal = kj / 4.184; }
    put("kcal", kcal);
    put("protein", num(n.proteins_100g));
    put("fat", num(n.fat_100g));
    put("carb", num(n.carbohydrates_100g));
    put("fibre", num(n.fiber_100g));

    const measures = [];
    const sq = num(p.serving_quantity);
    if (sq != null && sq > 0) {
      const size = (p.serving_size == null ? "" : String(p.serving_size).trim());
      measures.push({ label: size ? ("1 serving (" + size + ")") : "1 serving", grams: round2(sq) });
    }
    return { state: "found", gtin: String(gtin),
      record: { barcode: String(gtin), name, per100, measures, source: "off" } };
  }

  /* ---------- (4) resolve a GTIN ----------
     Order is deliberate: the LOCAL cache first (instant, offline), then Open Food
     Facts. A "not in the database" answer is CACHED too (a tombstone), so the
     user is never sent back to the network for the same dead end twice. fetchFn is
     injected and mirrors window.fetch: it returns {status, json()}. */
  async function resolve(store, gtin, fetchFn) {
    const key = normalizeGtin(gtin);
    if (!key) return { state: "not-gtin", gtin: String(gtin) };

    const cached = (store && store.barcodes) ? store.barcodes[key] : null;
    if (cached) {
      if (isMiss(cached)) return { state: "notfound", gtin: key, cached: true };
      return { state: "found", gtin: key, record: cached, cached: true };
    }
    if (typeof fetchFn !== "function") return { state: "error", gtin: key, error: "no network available" };

    let res;
    try { res = await fetchFn(offUrl(key)); }
    catch (err) { return { state: "error", gtin: key, error: String((err && err.message) || err) }; }

    let body = null;
    if (res && typeof res.json === "function") {
      try { body = await res.json(); } catch (e) { body = null; }
    }
    const status = (res && typeof res.status === "number") ? res.status : 0;

    if (status === 404) { cacheMiss(store, key); return { state: "notfound", gtin: key, cached: false }; }
    if (status >= 400) return { state: "error", gtin: key, error: "HTTP " + status };

    const parsed = parseProduct(key, body);
    if (parsed.state === "found") {
      if (hasFood()) Food.saveBarcode(store, parsed.record);
      return { state: "found", gtin: key, record: parsed.record, cached: false };
    }
    cacheMiss(store, key);
    return { state: "notfound", gtin: key, cached: false };
  }

  function cacheMiss(store, key) {
    if (hasFood() && store) {
      Food.saveBarcode(store, { barcode: key, name: "", per100: {}, measures: [], source: MISS_SOURCE });
    }
  }
  const isMiss = (rec) => !!(rec && rec.source === MISS_SOURCE);

  /* ---------- (5) the scanner's screen content ----------
     panelHtml(state) turns a plain state object into the html the modal shows.
     PURE, so every state is rendered and pinned in tests without a camera.

       state = { screen, cap?, gtin?, record?, cached?, permanent?, message? }

     The hard project rule lives here: an UNAVAILABLE capability renders an
     explanation and a working manual-search route — never a dead control. */
  const PRIVACY = "The camera runs on your phone — the picture never leaves it. " +
    "Only the barcode number is sent, to Open Food Facts (open data, no account).";

  function deviceCheck(cap) {
    if (!cap) return "";
    const det = cap.hasDetector ? "present" : "absent";
    const sec = cap.isSecureContext ? "yes" : "no";
    const fmts = Array.isArray(cap.formats)
      ? (cap.formats.length ? cap.formats.join(", ") : "none")
      : (cap.formatsError ? "error" : "—");
    return '<p class="muted small scan-check">Device check: BarcodeDetector ' + esc(det) +
      " · secure context " + esc(sec) + " · formats " + esc(fmts) + "</p>";
  }

  function closeRow(extra) {
    return '<div class="row scan-row">' + (extra || "") +
      '<button class="btn ghost tiny" id="scan-close" title="Close">✕</button></div>';
  }

  function per100Line(rec) {
    if (!rec || !rec.per100) return "";
    const parts = [];
    const keys = ["kcal", "protein", "fat", "carb", "fibre"];
    keys.forEach((k) => {
      if (typeof rec.per100[k] !== "number") return;
      parts.push(k === "kcal" ? (round2(rec.per100[k]) + " kcal") : (round2(rec.per100[k]) + " g " + k));
    });
    return parts.length ? parts.join(" · ") + " / 100 g" : "No nutrient data in the database.";
  }

  function panelHtml(state) {
    state = state || { screen: "checking" };
    const s = state.screen;
    const foot = '<p class="muted small scan-privacy">' + PRIVACY + "</p>";

    if (s === "checking") {
      return '<div class="scanner"><h3>Barcode</h3>' +
        '<p class="scan-lead">Checking this device\'s barcode support…</p>' + foot + "</div>";
    }

    if (s === "ready") {
      return '<div class="scanner"><h3>Scan a barcode</h3>' +
        '<p class="scan-lead">Point the camera at the barcode on a packaged food.</p>' +
        closeRow('<button class="btn primary" id="scan-start">Start camera</button>') +
        deviceCheck(state.cap) + foot +
        '<p class="scan-alt"><button class="btn ghost tiny" id="scan-manual">Search by name instead</button></p>' +
        "</div>";
    }

    if (s === "requesting") {
      return '<div class="scanner"><h3>Scan a barcode</h3>' +
        '<p class="scan-lead">Waiting for the camera permission…</p>' +
        closeRow() + foot + "</div>";
    }

    if (s === "scanning") {
      return '<div class="scanner"><h3>Scan a barcode</h3>' +
        '<video id="scan-video" class="scan-video" autoplay muted playsinline></video>' +
        '<p class="scan-lead">Hold the barcode inside the frame.</p>' +
        closeRow('<button class="btn ghost tiny" id="scan-stop">Stop</button>') +
        foot + "</div>";
    }

    if (s === "unsupported") {
      const cap = state.cap || {};
      const why = cap.message || "Barcode scanning isn\'t available on this device.";
      return '<div class="scanner scan-unsupported"><h3>Scanning isn\'t available here</h3>' +
        '<p class="scan-why">' + esc(why) + "</p>" +
        deviceCheck(cap) +
        '<p class="scan-lead">You can still find the food by name:</p>' +
        '<div class="row scan-row"><button class="btn primary" id="scan-manual">Search foods by name</button></div>' +
        foot + "</div>";
    }

    if (s === "denied") {
      const perm = state.permanent;
      const lead = perm
        ? "Camera access is turned off for Iron Ledger, so Android won't ask again " +
          "while it stays off. Turn Camera on for this app in Settings, then come back."
        : "The camera permission was dismissed. Nothing was recorded. Tap Try again " +
          "to ask once more.";
      const retry = perm ? "" : '<button class="btn primary" id="scan-retry">Try again</button>';
      return '<div class="scanner scan-denied"><h3>Camera is blocked</h3>' +
        '<p class="scan-why">' + esc(lead) + "</p>" +
        '<div class="row scan-row">' + retry +
        '<button class="btn' + (perm ? " primary" : " ghost") + '" id="scan-settings">Open settings</button>' +
        '<button class="btn ghost tiny" id="scan-close" title="Close">✕</button></div>' +
        '<p class="muted small">In Android Settings: Apps → Iron Ledger → Permissions → Camera.</p>' +
        '<p class="scan-alt"><button class="btn ghost tiny" id="scan-manual">Search by name instead</button></p>' +
        foot + "</div>";
    }

    if (s === "notfound") {
      const again = state.cached ? " We checked this one before, so it isn't looked up again." : "";
      return '<div class="scanner scan-notfound"><h3>Not in the database</h3>' +
        '<p class="scan-why">Barcode <b>' + esc(state.gtin) + "</b> isn't in Open Food Facts." + again +
        " You can log it by hand instead.</p>" +
        '<div class="row scan-row">' +
        '<button class="btn primary" id="scan-manual">Search foods by name</button>' +
        '<button class="btn ghost tiny" id="scan-again">Scan another</button>' +
        '<button class="btn ghost tiny" id="scan-close" title="Close">✕</button></div>' +
        foot + "</div>";
    }

    if (s === "found") {
      const rec = state.record || {};
      return '<div class="scanner scan-found"><h3>' + esc(rec.name || "Product") + "</h3>" +
        '<p class="scan-lead">' + esc(per100Line(rec)) + "</p>" +
        '<p class="muted small scan-src">Barcode ' + esc(state.gtin) + " · from Open Food Facts" +
        (state.cached ? " · saved on this device" : "") + "</p>" +
        '<div class="row scan-row">' +
        '<button class="btn primary" id="scan-add">Add to today</button>' +
        '<button class="btn ghost tiny" id="scan-again">Scan another</button>' +
        '<button class="btn ghost tiny" id="scan-close" title="Close">✕</button></div>' +
        foot + "</div>";
    }

    // error: a lookup that failed (network / server) — distinct from "not found"
    return '<div class="scanner scan-error"><h3>Couldn\'t look that up</h3>' +
      '<p class="scan-why">' + esc(state.message || "The lookup didn't complete.") +
      " The barcode wasn't saved — try again when you have a connection, or log the food by name.</p>" +
      '<div class="row scan-row">' +
      '<button class="btn primary" id="scan-retry">Try again</button>' +
      '<button class="btn ghost tiny" id="scan-manual">Search by name</button>' +
      '<button class="btn ghost tiny" id="scan-close" title="Close">✕</button></div>' +
      foot + "</div>";
  }

  return {
    NEEDED_FORMATS, OFF_BASE, MISS_SOURCE, PRIVACY,
    decide, readEnv, capability,
    normalizeGtin, offUrl, parseProduct, resolve, isMiss,
    panelHtml, deviceCheck,
  };
})();
if (typeof module !== "undefined") module.exports = Barcode;
