/* test_css_compat.js — the MINIMUM-WEBVIEW CSS LINT.
 *
 * The individual transform properties `translate`, `rotate` and `scale` landed in
 * Chrome 104 (2022). This app declares `minSdkVersion 22` — Android 5.1 — and
 * ships to whatever System WebView the device has, so on an older WebView those
 * properties are IGNORED. That is exactly how the header creature "animated its
 * frames but never moved" and read as "no animation" / "stuck in a weird place":
 * the walk rode `h.style.translate`, the property was dropped, and the sprite
 * stayed put. The operator's headless Chrome supports the property, so no harness
 * check ever caught it.
 *
 * This suite FAILS the build if any JS, CSS or inline HTML — anywhere in the
 * app's SOURCE (js/, css/, index.html; never the generated www/ or android/
 * copies) — sets or transitions an individual `translate` / `rotate` / `scale`
 * property. `transform: translateX(…)` and `transition: transform` are the
 * supported forms and are NOT flagged.
 *
 * Run: node tools/test_css_compat.js   (prints "N passed, M failed") */

const fs = require("fs"), path = require("path");
const B = path.join(__dirname, "..");
const INDIV = "translate|rotate|scale";

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  OK   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  -> " + detail : ""}`); }
};

const read = (p) => fs.readFileSync(p, "utf8");

/* ---------- the JS rules (individual-property set / transition) ----------------- */
const JS_RULES = [
  { re: () => new RegExp("\\.style\\s*\\.\\s*(" + INDIV + ")\\s*=", "g"),
    why: "a `.style.<translate|rotate|scale> = …` assignment" },
  { re: () => new RegExp("setProperty\\s*\\(\\s*[\"'](" + INDIV + ")[\"']", "g"),
    why: "a `style.setProperty(\"<translate|rotate|scale>\", …)` call" },
  { re: () => new RegExp("style\\.transition(?:Property)?\\s*=\\s*[^;\\n]*?(?:^|[\\s,'\"`])(?:" + INDIV + ")(?![a-zA-Z0-9_(])", "g"),
    why: "a transition string naming an individual property" },
  { re: () => /style\.cssText\s*=\s*[^;]*?(?:^|[\s;])(?:translate|rotate|scale)\s*:/g,
    why: "a cssText assignment declaring an individual property" },
];

const STRIP_JS_COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const jsViolations = (src) => {
  const out = [];
  const clean = src.replace(STRIP_JS_COMMENTS, " ");
  clean.split("\n").forEach((line, i) => {
    JS_RULES.forEach((r) => {
      const re = r.re();
      if (re.test(line)) out.push(`line ${i + 1}: ${r.why} -> ${line.trim().slice(0, 120)}`);
    });
  });
  return out;
};

/* ---------- the CSS rule (individual-property declaration / transition) --------- */
const TRANSITION_TOKENS = new RegExp("(^|[\\s,])(?:" + INDIV + ")(?=[\\s,]|$)", "i");
const cssViolations = (src) => {
  const out = [];
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, " ");     // comments are prose
  const block = /\{([^{}]*)\}/g;
  let m;
  while ((m = block.exec(clean))) {
    const ln = clean.slice(0, m.index).split("\n").length;
    m[1].split(";").forEach((decl) => {
      const i = decl.indexOf(":");
      if (i === -1) return;
      const prop = decl.slice(0, i).trim().toLowerCase();
      const value = decl.slice(i + 1).trim();
      if (/^(translate|rotate|scale)$/.test(prop)) out.push(`~line ${ln}: \`${prop}: ${value}\``);
      else if (/^transition(-property)?$/.test(prop) && TRANSITION_TOKENS.test(value))
        out.push(`~line ${ln}: transition names an individual property \`${prop}: ${value}\``);
    });
  }
  return out;
};

/* ---------- scan the SOURCE tree ------------------------------------------------ */
const jsFiles = fs.readdirSync(path.join(B, "js")).filter((f) => f.endsWith(".js")).map((f) => path.join(B, "js", f));
const cssFiles = fs.readdirSync(path.join(B, "css")).filter((f) => f.endsWith(".css")).map((f) => path.join(B, "css", f));
const htmlFile = path.join(B, "index.html");
check(jsFiles.length > 0 && cssFiles.length > 0 && fs.existsSync(htmlFile),
  "the source tree is present (js/*.js, css/*.css, index.html)");

let jsHits = [];
jsFiles.forEach((p) => jsViolations(read(p)).forEach((v) => jsHits.push(`${path.relative(B, p)} ${v}`)));
check(jsHits.length === 0,
  "no JS source sets or transitions an individual translate/rotate/scale property", jsHits.join("; "));

let cssHits = [];
cssFiles.forEach((p) => cssViolations(read(p)).forEach((v) => cssHits.push(`${path.relative(B, p)} ${v}`)));
if (fs.existsSync(htmlFile)) {
  (read(htmlFile).match(/style\s*=\s*"[^"]*"/g) || []).forEach((attr) => {
    cssViolations(attr.replace(/^style\s*=\s*"/, "").replace(/"$/, ""))
      .forEach((v) => cssHits.push(`index.html inline style ${v}`));
  });
}
check(cssHits.length === 0,
  "no CSS (or inline style) declares or transitions an individual translate/rotate/scale property", cssHits.join("; "));

/* ---------- POSITIVE CONTROL: the supported forms are present ------------------- */
const hero = read(path.join(B, "js", "hero.js"));
const css = read(path.join(B, "css", "style.css"));
const app = read(path.join(B, "js", "app.js"));
check(/h\.style\.transform\s*=\s*"translateX\(/.test(hero),
  "the motion uses the supported `transform: translateX(…)` form");
check(/style\.transition\s*=\s*"transform /.test(hero),
  "the walk transitions `transform` (the supported form) and nothing else");
check(!/\.style\.translate\s*=/.test(hero),
  "the removed `style.translate` assignment is gone from js/hero.js");
check(/\.topbar \.hero \.hero-body\s*\{[^}]*transform-origin/.test(css) &&
      /\.topbar \.hero \.hero-body\s*\{[^}]*transition:\s*none/.test(css),
  "the inner body carries the mirror with NO transition (it SNAPS)");
check(!jsViolations(hero).length && !cssViolations(css).length,
  "the two files that carry the motion and the mirror are clean under every rule");
check(!cssViolations(app).length && !jsViolations(app).length, "js/app.js is clean too");

/* ---------- the lint must DISCRIMINATE (synthetic violations are caught) -------- */
check(jsViolations("h.style.translate = tx + 'px';").length > 0,
  "flags a synthetic `style.translate = …` assignment");
check(jsViolations("h.style.transition = 'translate ' + dur + 'ms linear';").length > 0,
  "flags a synthetic `transition = 'translate …'` string");
check(jsViolations("h.style.setProperty('scale', s);").length > 0,
  "flags a synthetic `setProperty('scale', …)` call");
check(cssViolations(".x { translate: 4px; }").length > 0,
  "flags a synthetic `translate: 4px` declaration");
check(cssViolations(".x { transition: rotate 200ms linear; }").length > 0,
  "flags a synthetic `transition: rotate …` declaration");
check(cssViolations(".x { rotate: 45deg; }").length > 0,
  "flags a synthetic `rotate: 45deg` declaration");
check(cssViolations(".x { transform: translateX(4px) scale(2); transition: transform 200ms; }").length === 0,
  "...but does NOT flag `transform: translateX()/scale()` or `transition: transform`");
check(cssViolations(".x { transition: transform 200ms, opacity 100ms; }").length === 0,
  "...nor `transition: transform, opacity`");
check(jsViolations("h.style.transform = 'translateX(4px)';").length === 0,
  "...nor a `style.transform = 'translateX(…)'` assignment");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
