/* hero_geometry_dump.js — print the hero/gear GEOMETRY table from the ONE JS
   source (js/engine.js) as JSON, so tools/test_hero_gear.py can cross-check it
   against the ACTUAL PNG pixels with PIL. Nothing here is a second copy of the
   numbers: it loads the real engine and calls the real Engine.gearBox.
   Run: node tools/hero_geometry_dump.js > /tmp/x.json */
const fs = require("fs"), vm = require("vm"), path = require("path");
const B = path.join(__dirname, "..");
const ctx = { console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Object, Array, Number, String, Boolean, RegExp, Set, Map, isFinite, parseInt, parseFloat, module: { exports: {} }, window: {} };
ctx.globalThis = ctx;
vm.createContext(ctx);
const src = ["js/data.js", "js/seed.js", "js/engine.js"]
  .map((f) => fs.readFileSync(path.join(B, f), "utf8")).join("\n;\n");
vm.runInContext(src + "\n;globalThis.__E = Engine;", ctx, { filename: "engine-bundle.js" });
const Engine = ctx.__E;

const heroes = Engine.HERO_ITEMS.filter((i) => i.kind === "hero").map((h) => ({
  id: h.id, sheet: h.sheet, anatomy: h.anatomy,
}));
const gears = Engine.HERO_ITEMS.filter((g) => g.kind === "gear").map((g) => ({
  id: g.id, img: g.img, anchor: g.anchor, size: g.size, fit: g.fit, offset: g.offset, z: g.z,
}));
const boxes = [];
for (const h of Engine.HERO_ITEMS.filter((i) => i.kind === "hero"))
  for (const g of Engine.HERO_ITEMS.filter((i) => i.kind === "gear")) {
    const b = Engine.gearBox(h, g);
    boxes.push(Object.assign({ hero: h.id, gear: g.id }, b));
  }
process.stdout.write(JSON.stringify({ heroes, gears, boxes }, null, 1));
