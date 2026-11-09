/* herotab.js — the Hero tab's view-model. PURE: no DOM, no storage, no implicit
   state — the state object is an ARGUMENT, exactly like js/nutrition.js. It
   turns the engine's ONE unlock table (Engine.heroItems) into the model AND the
   html the user reads, so the tab can be tested in a bare sandbox.

   Rules this file enforces, so the UI cannot quietly break them:
     - ONE source of truth: every hero and cosmetic comes from Engine.heroItems.
       No id, name, sheet path or filter is ever written here a second time.
     - A LOCKED tile is ASPIRATIONAL, never punitive: it shows the hero's
       SILHOUETTE plus the engine's PLAIN unlock line with the REAL remaining
       distance. No padlock, no countdown, no FOMO — and it is NOT dead UI: it is
       a live button that explains itself (the app toasts the line).
     - WYSIWYG: the stage and the header read the SAME equipped hero, the SAME
       colourway filter and the SAME gear list from this one model.
   Loaded AFTER js/engine.js (it reads the passed-in Engine) and BEFORE app.js. */
const HeroTab = (() => {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* The stage cell is the native 32x32 drawn at 4x = 128 px. The two numbers
     below are the ONLY scale constants: change STAGE_SCALE and both the CSS box
     and the sheet background-size follow. */
  const STAGE_SCALE = 4;
  const TILE_SCALE = 2;

  const sheetStyle = (item, scale, row) =>
    `background-image:url('${esc(item.sheet)}');` +
    `background-size:${128 * scale}px ${192 * scale}px;` +
    `background-position:0 ${-32 * scale * (row || 0)}px;`;

  const filterOf = (cw) => (cw && cw.filter && cw.filter !== "none") ? cw.filter : null;

  /* POSITION BY COMPUTED SIZE. An overlay's box is declared in CELL UNITS
     (0..32) and the CSS turns it into px from the box's OWN rendered cell size
     (`--cell`): left = --cell · x/32, width = --cell · w/32 — one mechanism that
     is exact at 24 px (header), 64 px (roster) and 128 px (stage). NO hard-coded
     128/64/100% anywhere; the only number per surface is its `--cell`. */
  const boxVars = (b) =>
    `--gx:${b.x};--gy:${b.y};--gw:${b.w};--gh:${b.h};--artw:${b.artw || b.w};--arth:${b.arth || b.h};`;

  const overlayHTML = (src, b, cls) =>
    `<span class="${cls} ${b.z}" style="${boxVars(b)}background-image:url('${esc(src)}');"></span>`;

  /* ---------- the model: engine table + the state's chosen ids ---------- */
  function model(state, E) {
    const items = E.heroItems(state);
    const h = (state && state.hero) || {};
    const equipped = h.equipped || "slime";
    const colourway = h.colourway || "natural";
    const gear = Array.isArray(h.gear) ? h.gear.slice() : [];
    const by = (k) => items.filter((i) => i.kind === k);
    const heroes = by("hero");
    const colourways = by("colourway");
    const gears = by("gear");
    const eqHero = heroes.filter((i) => i.id === equipped)[0] || heroes[0];
    const cw = colourways.filter((i) => i.id === colourway)[0] || colourways[0];
    /* Only an UNLOCKED id may actually be equipped: if the stored choice is a
       locked id (a hand-edited or rolled-back state) fall back to the default
       rather than putting a locked hero on the stage. */
    const eqUnlocked = eqHero && eqHero.unlocked ? eqHero : (heroes.filter((i) => i.id === "slime")[0] || heroes[0]);
    /* Only an UNLOCKED id may be equipped, so the stage/header never show a
       locked hero. In the model below, `worn` is the worn gear ids, in the
       items' own order. */
    const worn = gear.filter((g) => gears.some((it) => it.id === g && it.unlocked));
    /* The overlay geometry is computed ONCE here, from the engine's ONE table
       (Engine.gearBox), and read by the stage markup AND the header (via the
       app). Never re-derived per surface. */
    const gearOverlays = worn.map((gid) => {
      const gi = gears.filter((x) => x.id === gid)[0];
      const box = E.gearBox(eqUnlocked, gi);
      return box ? { id: gid, name: gi.name, src: gi.img, box } : null;
    }).filter(Boolean);
    return {
      heroes, colourways, gears, items,
      equipped: eqHero && eqHero.unlocked ? eqHero.id : eqUnlocked.id,
      colourway: cw && cw.unlocked ? cw.id : "natural",
      gear: worn,
      hero: eqUnlocked,
      cw: cw && cw.unlocked ? cw : (colourways.filter((i) => i.id === "natural")[0] || colourways[0]),
      gearOverlays,
    };
  }

  /* ---------- the STAGE: the equipped hero at 4x on a floor line ---------- */
  function stageHTML(m) {
    const f = filterOf(m.cw);
    const style = sheetStyle(m.hero, STAGE_SCALE, 0) + (f ? `filter:${esc(f)};` : "");
    /* every worn item, positioned by its COMPUTED box (cell units -> px via the
       stage's --cell). A "behind" item (the cape) is z-ordered under the sprite. */
    const gear = m.gearOverlays.map((o) => overlayHTML(o.src, o.box, "stage-gear gear-overlay")).join("");
    const caption = [m.hero.name, m.cw.name].concat(m.gearOverlays.map((o) => o.name)).filter(Boolean).join(" · ");
    return `<section class="hero-stage card">
      <div class="stage-floor"><span id="stage-sprite" class="stage-sprite idle" style="${style}"></span>${gear}</div>
      <p class="stage-cap"><b>${esc(m.hero.name)}</b><span class="muted">${esc(caption.replace(m.hero.name + " · ", ""))}</span></p>
    </section>`;
  }

  /* ---------- one tile, shared by all three grids ---------- */
  /* kind: "hero" | "colourway" | "gear"; ctx: { m, scale, row, filter } */
  function tileHTML(item, kind, ctx) {
    const m = ctx.m;
    const on = kind === "hero" ? (m.equipped === item.id)
      : kind === "colourway" ? (m.colourway === item.id)
      : (m.gear.indexOf(item.id) !== -1);
    const cls = "roster-tile " + (item.unlocked ? "unlocked" : "locked") + (on ? " on" : "");
    const attr = kind === "hero" ? `data-equip="${esc(item.id)}"`
      : kind === "colourway" ? `data-cw="${esc(item.id)}"`
      : `data-gear="${esc(item.id)}"`;
    const lockAttr = item.unlocked ? "" : ` data-locked="1"`;
    const aria = item.unlocked
      ? ` aria-pressed="${on ? "true" : "false"}"`
      : ` aria-label="${esc(item.name)} — ${esc(item.copy)}"`;
    /* The sprite: a hero/cosmetic uses its sheet (locked -> silhouette); a gear
       tile shows the garment art on its own. */
    let art;
    if (kind === "gear") {
      const sil = item.unlocked ? "" : " sil";
      /* the garment on its own: the item's OWN footprint (declared in cell units)
         shown at the roster preview scale — the box is computed, never 64x64. */
      const w = (item.size && item.size.w) || 32, h = (item.size && item.size.h) || 32;
      art = `<span class="tile-art"><span class="gear-prev${sil}" style="--gw:${w};--gh:${h};background-image:url('${esc(item.img)}');"></span></span>`;
    } else {
      const sheet = kind === "hero" ? item : m.hero;   // a colourway previews the EQUIPPED hero
      const filter = kind === "colourway" ? filterOf(item) : filterOf(m.cw);
      const sil = item.unlocked ? "" : " sil";
      const st = sheetStyle(sheet, ctx.scale || TILE_SCALE, ctx.row || 0) + (filter ? `filter:${esc(filter)};` : "");
      art = `<span class="tile-sprite${sil}" style="${st}"></span>`;
    }
    /* A locked tile carries its PLAIN unlock line (the engine's exact copy). An
       unlocked tile carries a short state tag. */
    const tag = item.unlocked
      ? (on ? `<span class="tile-tag">${kind === "gear" ? "Worn" : "Equipped"}</span>` : `<span class="tile-tag muted">${kind === "gear" ? "Tap to wear" : "Tap to equip"}</span>`)
      : `<span class="tile-line">${esc(item.copy)}</span>`;
    return `<button class="${cls}" ${attr}${lockAttr}${aria}>
        ${art}
        <span class="tile-name">${esc(item.name)}</span>
        ${tag}
      </button>`;
  }

  /* ---------- the whole tab ---------- */
  function tabHTML(m) {
    const heroes = m.heroes.map((i) => tileHTML(i, "hero", { m })).join("");
    const cws = m.colourways.map((i) => tileHTML(i, "colourway", { m })).join("");
    const gears = m.gears.map((i) => tileHTML(i, "gear", { m })).join("");
    const lockedCount = m.items.filter((i) => !i.unlocked).length;
    return stageHTML(m) +
      `<section class="card"><h3>Roster</h3>
        <p class="muted small">Tap a hero to equip it${lockedCount ? " — locked ones show how far off they are." : "."}</p>
        <div class="roster">${heroes}</div></section>` +
      `<section class="card"><h3>Colourway</h3>
        <p class="muted small">A tint of the same sprite — no new art, unlocked by time at your target.</p>
        <div class="roster">${cws}</div></section>` +
      `<section class="card"><h3>Gear</h3>
        <p class="muted small">Worn over whatever hero you have equipped. Tap to put on or take off.</p>
        <div class="roster">${gears}</div></section>`;
  }

  /* ---------- the unlock moment (pure) ----------
     Which ids are unlocked NOW that were not in the recorded floor? The app
     celebrates the FIRST of these and records them all. */
  function newlyUnlocked(items, prevUnlocked) {
    const prev = prevUnlocked || [];
    return items.filter((i) => i.unlocked && prev.indexOf(i.id) === -1).map((i) => i.id);
  }

  return { model, stageHTML, tileHTML, tabHTML, newlyUnlocked, STAGE_SCALE, TILE_SCALE, filterOf };
})();
if (typeof module !== "undefined") module.exports = HeroTab;
