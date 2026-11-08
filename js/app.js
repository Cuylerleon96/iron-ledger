/* app.js — UI layer. All maths lives in Engine; all persistence in Store. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const k in attrs) { if (k === "class") e.className = attrs[k]; else if (k === "data") Object.assign(e.dataset, attrs[k]); else e.setAttribute(k, attrs[k]); }
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const today = () => Engine.dstr(new Date());
  const pl = (n, s, p) => (n === 1 ? s : (p || s + "s"));
  /* Weights keep their decimals. A 102.5 kg set shown as "103" is not a rounding
     nicety, it is wrong — plates are loaded in 1.25 kg / 5 lb steps, so the
     fraction is meaningful. Aggregates (tonnage) still use fmt() at 0 dp. */
  const fmtW = (v) => { const n = Math.round(Number(v) * 100) / 100; return isFinite(n) ? String(n) : "0"; };
  const fmtRest = (sec) => { const s = Math.round(sec); return s < 60 ? s + "s" : Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const fmt = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");

  /* ---------- units ---------- */
  const LB = 2.2046226;
  const U = {
    get kg() { return (Store.state.profile.units || "kg") === "kg"; },
    label() { return this.kg ? "kg" : "lb"; },
    w(kgv) { return this.kg ? kgv : kgv * LB; },       // kg -> display
    wi(disp) { return this.kg ? disp : disp / LB; },   // display -> kg
    d(m) { return this.kg ? m : m * 3.28084; },
    dlab() { return this.kg ? "m" : "ft"; },
    /* Tape measurements follow the same rule as weight: one canonical stored
       value (centimetres), shown in whatever unit the user reads. */
    len(cm) { return this.kg ? cm : cm / 2.54; },      // cm -> display
    li(disp) { return this.kg ? disp : disp * 2.54; }, // display -> cm
    llab() { return this.kg ? "cm" : "in"; },
  };

  let S = Store.state;
  let view = "dash";
  let draft = null;          // workout being logged
  let libIndex = null;

  /* One place decides how a tracking-mode override is persisted, so the Log
     screen and the exercise detail modal cannot drift apart. The Log control
     used to persist only when String(id).length > 2, which silently skipped
     every library id from 9 to 99 — including Bench Press, id 73 — while the
     modal persisted unconditionally. */
  function setTrackMode(id, mode) {
    if (id === undefined || id === null) return;
    Store.setOverride(id, { mode });
  }

  /* ================= custom exercises + import ================= */
  /* Custom exercises are user-created, or auto-created by the notes importer's
     fuzzy-match fallback. Without an edit/delete path a typo was permanent and
     kept feeding the muscle-group analysis. These are the real actions behind
     the detail-modal controls, kept separate so they can be tested directly. */
  function isCustomEx(id) { return !!(S.custom || []).find((x) => x.id === id); }

  function renameCustomEx(id, name) {
    const n = (name == null ? "" : String(name)).trim();
    if (!n) return false;
    const prev = (findEx(id) || {}).n;
    if (prev === n) return true;
    Store.updateCustom(id, { n });
    buildIndex();
    return true;
  }

  /* Deleting a custom exercise DETACHES its logged sets rather than blocking:
     the sets stay in the history (Store.deleteCustom) so past training is not
     silently rewritten, but an empty group override stops the orphaned id
     contributing phantom groups to the muscle analysis. */
  function deleteCustomEx(id) {
    Store.deleteCustom(id);
    buildIndex();
    return true;
  }

  /* The detail-modal controls, only for a custom exercise. */
  function customControlsHTML(id) {
    if (!isCustomEx(id)) return "";
    return `<div class="row">
        <button class="btn ghost tiny" id="dt-rename" title="Rename this custom exercise">Rename</button>
        <button class="btn ghost tiny" id="dt-del" title="Delete this custom exercise">Delete</button>
      </div>`;
  }

  /* Import is used two ways: additive MERGE (safe) and REPLACE, which discards
     everything currently on the device. The warning names exactly what is lost. */
  function importData(text, mode) {
    Store.importJSON(text, mode);
    S = Store.state;
    draft = null;
    buildIndex();
    render();
    return S;
  }
  function replaceImportWarning() {
    const n = (S.workouts || []).length, b = (S.bodylog || []).length, c = (S.custom || []).length;
    const p = S.profile || {};
    return "Replace ALL data on this device with this file?\n\n" +
      "Everything here now will be discarded: " +
      `${n} workout${n === 1 ? "" : "s"}, ${b} bodyweight log${b === 1 ? "" : "s"}, ` +
      `${c} custom exercise${c === 1 ? "" : "s"}, your profile` +
      `${p.name ? ` (${p.name})` : ""}, targets, achievements and settings.\n\n` +
      "This cannot be undone. Export a backup first if you are unsure.";
  }

  /* The seed affordance is a manual load, not auto-seeding: show it whenever the
     7 Nov session is not already in the log, so it is reachable on demand. */
  function shouldShowSeed() {
    const seedId = (typeof SEED_WORKOUT !== "undefined" && SEED_WORKOUT) ? SEED_WORKOUT.id : null;
    if (!seedId) return false;
    return !(S.workouts || []).some((w) => w.id === seedId);
  }

  /* ================= toasts ================= */
  function toast(msg, kind = "", ms = 2600) {
    const t = el("div", { class: "toast " + kind });
    if (msg && msg.nodeType === 1) t.append(msg); else t.innerHTML = msg;
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
  }

  /* ================= modal ================= */
  /* A modal is a dialog, not just a floating panel: while it is open the Tab key
     must stay inside it (a focus TAB TRAP), Escape must close it, and closing
     must hand focus back to whatever opened it — otherwise a keyboard or screen
     reader user is dropped at the top of the page with no way back. */
  let modalOpener = null;
  const focusablesIn = (root) => $$(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    root
  ).filter((e) => e.offsetParent !== null || e === document.activeElement);
  function openModal(node, cls = "") {
    const box = $("#modal-box");
    box.className = "modal-box " + cls;
    box.innerHTML = "";
    box.append(node);
    const active = document.activeElement;
    modalOpener = (active && active.focus && active !== document.body && !box.contains(active)) ? active : null;
    $("#modal").classList.remove("hidden");
    // Lock the page behind the dialog: without this a touch-scroll on a phone
    // moved the dashboard underneath the open modal.
    document.body.classList.add("modal-open");
    // Move focus into the dialog so the trap has a starting point. Callers that
    // want a specific field (the exercise search box) still focus it themselves.
    const first = focusablesIn(box)[0];
    if (first) first.focus();
    else { box.setAttribute("tabindex", "-1"); if (box.focus) box.focus(); }
  }
  const closeModal = () => {
    $("#modal").classList.add("hidden");
    document.body.classList.remove("modal-open");
    // Return focus to the control that opened the dialog, when it is still here.
    if (modalOpener && modalOpener.focus) { try { modalOpener.focus(); } catch (e) { /* detached */ } }
    modalOpener = null;
  };
  document.addEventListener("keydown", (e) => {
    const modal = $("#modal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const f = focusablesIn($("#modal-box"));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !modal.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !modal.contains(active))) { e.preventDefault(); first.focus(); }
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

  /* ================= glossary wiring ================= */
  /* Every explanatory term in the UI is a tappable `data-term` control that opens
     the ONE explanation in js/glossary.js. This is the single click handler, so a
     term cannot be added as a dead button: glossary.link() only emits the hook
     when an entry exists, and Glossary.open() refuses an unknown id. */
  const GLOSS = (typeof Glossary !== "undefined") ? Glossary : { link: (id, t) => esc(t), has: () => false, open: () => false, openAll: () => false };
  const term = (id, text, cls) => GLOSS.link(id, text, cls);
  const attrTermId = (key) => (GLOSS.attrId ? GLOSS.attrId(key) : null);
  const glossCtx = () => ({ el, open: openModal, close: closeModal });
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-term]") : null;
    if (!t) return;
    e.preventDefault();
    // A term inside the open glossary list opens in place; anything else opens
    // over the current screen. Either way the entry is the same one object.
    GLOSS.open(glossCtx(), t.dataset.term);
  });

  /* ================= library index ================= */
  function allExercises() { return [...EXERCISE_LIB, ...(S.custom || [])]; }
  function buildIndex() {
    libIndex = allExercises().map((x) => ({
      x, key: (x.n + " " + (x.e || []).join(" ") + " " + (x.p || []).join(" ") + " " + x.c).toLowerCase(),
    }));
  }
  const findEx = (id) => allExercises().find((x) => x.id === id);

  function searchExercises(q, opts = {}) {
    const { cat, eq, mode, limit = 60 } = opts;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    let res = libIndex.filter(({ x }) => {
      if (cat && x.c !== cat) return false;
      if (mode && x.m !== mode) return false;
      if (eq && !(x.e || []).some((s) => s.toLowerCase().includes(eq.toLowerCase()))) return false;
      return true;
    });
    if (terms.length) {
      res = res.map((r) => {
        let sc = 0;
        for (const t of terms) {
          const n = r.x.n.toLowerCase();
          if (n === q.toLowerCase()) sc += 40;
          else if (n.startsWith(t)) sc += 8;
          else if (n.includes(t)) sc += 4;
          if (r.key.includes(t)) sc += 1;
        }
        return { ...r, sc };
      }).filter((r) => r.sc > 0).sort((a, b) => b.sc - a.sc);
    }
    return res.slice(0, limit).map((r) => r.x);
  }

  /* ================= quick-set parser ================= */
  /* Understands the notes-app shorthand: 100x10, 100 x 10 @8, 60s, 1:30, 5km 24:00
     and, in front of any of those, a set type: "drop 100x8",
     "failure 100x5" (short forms d/f need a separator: "d: 100x8").
     An unrecognised prefix is left untouched, so a plain set parses exactly as
     before. The canonical words are the same ones the notes exporter writes. */
  function takeSetType(t) {
    const words = [
      [/^(?:drop(?:set)?)\b[\s:.,\-–—]*/, "drop"],
      [/^(?:fail(?:ure)?)\b[\s:.,\-–—]*/, "failure"],
    ];
    for (const [re, v] of words) if (re.test(t)) return { value: v, rest: t.replace(re, "") };
    const short = t.match(/^([df])(?:\s*[:.]\s*|\s+)/);
    if (short) return { value: { d: "drop", f: "failure" }[short[1]], rest: t.slice(short[0].length) };
    return { value: undefined, rest: t };
  }

  function parseSet(text, mode) {
    let t = text.trim().toLowerCase().replace(/×/g, "x");
    if (!t) return null;
    const setTy = takeSetType(t);
    t = setTy.rest.trim();
    if (!t) return null;
    const ty = setTy.value;
    const rpeM = t.match(/@\s*(\d+(?:\.\d+)?)/);
    const rpe = rpeM ? parseFloat(rpeM[1]) : undefined;
    // rest token: "r90" (seconds). Letters are unambiguous — time uses "s"/"m",
    // and this is stripped before the rest of the string is parsed.
    const restM = t.match(/\br\s*(\d+)\b/);
    const rest = restM ? parseFloat(restM[1]) : undefined;
    const body = t.replace(/@\s*\d+(?:\.\d+)?/, "").replace(/\br\s*\d+\b/, "").trim();
    const clockM = body.match(/(\d+):(\d{2})/);
    const secs = (m) => m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : undefined;
    const num = (m) => (m ? parseFloat(m[1]) : undefined);
    /* Every weight entering the app must come out in kg, because that is what
       s.w means everywhere else (the manual row inputs convert through U.wi, the
       engine reads kg, the footer converts once for display). This parser used to
       return the raw typed number, so a set added here was stored in POUNDS while
       the model treated it as kg: every tonnage and e1RM from that path was
       inflated by 2.2046x for anyone on lb. The notes importer shares this
       function, so imported notes were wrong the same way. */
    const wIn = (v) => (v === undefined || v === null ? v : U.wi(v));

    if (mode === "time") {
      const s = clockM ? secs(clockM) : num(body.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs)?\s*$/));
      return s ? { t: s, rpe, rest, ty } : null;
    }
    if (mode === "reps") {
      const r = num(body.match(/^(\d+(?:\.\d+)?)/));
      return r ? { r, rpe, rest, ty } : null;
    }
    if (mode === "distance_time") {
      const kmM = body.match(/(\d+(?:\.\d+)?)\s*km/), mM = body.match(/(\d+(?:\.\d+)?)\s*m\b/);
      const d = kmM ? parseFloat(kmM[1]) * 1000 : mM ? parseFloat(mM[1]) : undefined;
      const time = clockM ? secs(clockM) : num(body.match(/(\d+(?:\.\d+)?)\s*(?:min|m(?:in)?s?)$/));
      const tt = clockM ? secs(clockM) : (time !== undefined && !kmM && !mM ? undefined : time);
      return { d, t: clockM ? secs(clockM) : tt, rpe, rest, ty };
    }
    if (mode === "weight_time") {
      const w = num(body.match(/^(\d+(?:\.\d+)?)/));
      const s = clockM ? secs(clockM) : num(body.match(/[x*]\s*(\d+(?:\.\d+)?)/)) ?? num(body.match(/(\d+(?:\.\d+)?)\s*(?:s|sec)/));
      return w ? { w: wIn(w), t: s, rpe, rest, ty } : null;
    }
    if (mode === "weight_distance") {
      const w = num(body.match(/^(\d+(?:\.\d+)?)/));
      const d = num(body.match(/[x*]\s*(\d+(?:\.\d+)?)/)) ?? num(body.match(/(\d+(?:\.\d+)?)\s*m/));
      return w ? { w: wIn(w), d, rpe, rest, ty } : null;
    }
    // weight_reps
    const m = body.match(/^(\d+(?:\.\d+)?)\s*(?:kg|lb|#)?\s*[x*\/\s]\s*(\d+(?:\.\d+)?)/);
    if (m) return { w: wIn(parseFloat(m[1])), r: parseFloat(m[2]), rpe, rest, ty };
    const one = body.match(/^(\d+(?:\.\d+)?)/);
    if (one) return { w: wIn(parseFloat(one[1])), r: undefined, rpe, rest, ty };
    return null;
  }

  /* ================= notes-app importer ================= */
  function parseNotes(text) {
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const setM = line.match(/^(\d+)\s*[:.)]\s*(.+)$/);
      if (setM && cur) {
        const parsed = parseSet(setM[2], cur.mode);
        if (parsed) cur.sets.push(parsed);
        continue;
      }
      const headM = line.match(/^([^:]+):\s*(.*)$/);
      if (headM) {
        const name = headM[1].trim();
        const matched = matchExercise(name);
        cur = { id: matched.id, name: matched.n, mode: matched.m, sets: [], _match: matched._score };
        if (headM[2]) { const p = parseSet(headM[2], cur.mode); if (p) cur.sets.push(p); }
        out.push(cur);
        continue;
      }
      // bare set line without index
      if (cur) { const p = parseSet(line, cur.mode); if (p) cur.sets.push(p); }
    }
    return out;
  }

  function matchExercise(name) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const q = norm(name);
    let best = null, bestSc = 0;
    for (const { x } of libIndex) {
      const n = norm(x.n);
      let sc = 0;
      if (n === q) sc = 100;
      else {
        const qt = new Set(q.split(" ").filter((w) => w.length > 2));
        const nt = new Set(n.split(" ").filter((w) => w.length > 2));
        if (!qt.size || !nt.size) continue;
        let inter = 0; qt.forEach((w) => { if (nt.has(w)) inter++; });
        sc = (inter / Math.max(qt.size, nt.size)) * 70 + (n.includes(q) || q.includes(n) ? 15 : 0);
      }
      if (sc > bestSc) { bestSc = sc; best = x; }
    }
    if (best && bestSc >= 45) return { ...best, _score: Math.round(bestSc) };
    // no good match -> create a custom exercise, guessing the muscle group
    const guess = guessMeta(name);
    const c = Store.addCustom({ n: name, c: guess.c, p: guess.p, s: [], e: guess.e, m: guess.m, g: guess.g, d: "Created from import." });
    buildIndex();
    return { ...c, _score: 0 };
  }

  function guessMeta(name) {
    const n = name.toLowerCase();
    const G = {
      chest: ["Chest", ["Chest"]], pec: ["Chest", ["Chest"]], bench: ["Chest", ["Chest"]], fly: ["Chest", ["Chest"]],
      lat: ["Back", ["Back"]], row: ["Back", ["Back"]], pull: ["Back", ["Back"]], pulldown: ["Back", ["Back"]],
      shoulder: ["Shoulders", ["Shoulders"]], delt: ["Shoulders", ["Shoulders"]], press: ["Shoulders", ["Shoulders"]],
      curl: ["Arms", ["Arms"]], tricep: ["Arms", ["Arms"]], bicep: ["Arms", ["Arms"]], dip: ["Arms", ["Arms"]],
      squat: ["Legs", ["Legs"]], leg: ["Legs", ["Legs"]], lunge: ["Legs", ["Legs"]], deadlift: ["Legs", ["Legs"]],
      calf: ["Calves", ["Calves"]], ab: ["Core", ["Core"]], core: ["Core", ["Core"]], plank: ["Core", ["Core"]],
      run: ["Cardio", ["Cardio"]], bike: ["Cardio", ["Cardio"]], rower: ["Cardio", ["Cardio"]], cardio: ["Cardio", ["Cardio"]],
      stretch: ["Core", ["Core"]], mobility: ["Core", ["Core"]],
    };
    for (const k in G) if (n.includes(k)) {
      const [c, g] = G[k];
      const m = c === "Cardio" ? "distance_time" : (n.includes("machine") || n.includes("cable") ? "weight_reps" : "weight_reps");
      return { c, p: g, g, e: n.includes("machine") ? ["Machine"] : [], m };
    }
    return { c: "Other", p: [], g: ["Core"], e: [], m: "weight_reps" };
  }

  /* ================= nav ================= */
  function setView(v) {
    view = v;
    $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === v));
    render();
  }

  function render() {
    const host = $("#view");
    host.innerHTML = "";
    if (view === "dash") renderDash(host);
    else if (view === "log") renderLog(host);
    else if (view === "history") renderHistory(host);
    else if (view === "library") renderLibrary(host);
    else renderProfile(host);
    renderHUD();
  }

  /* ---------- sessions this week (the ONLY progress figure displayed) ---------- */
  /* The HUD and the dashboard chip show how many sessions are logged in this
     Monday-start week against the profile's weekly session target. It is a
     weekly count, never consecutive days: a rest day is not a broken run, and
     neither wording ever scolds — progress is stated, never called late or
     missed. The engine's day-run numbers (Engine.streaks) are deliberately left
     alone: saved state and the engine's own badges still read them, they are
     simply no longer shown. */
  function weekProgress(state) {
    const target = Math.max(1, parseInt(state.profile.weeklyTarget, 10) || 4);
    const wk = Engine.weekKeyOf(Engine.dstr(new Date()));
    const done = (state.workouts || []).filter((w) => Engine.weekKeyOf(w.date) === wk).length;
    return { done, target, met: done >= target };
  }
  const weekHudText = (w) => `${w.done} / ${w.target} this week` + (w.met ? " · target met" : "");
  const weekChipText = (w) => (w.met ? `Target met · ${w.done} of ${w.target} this week`
                                     : `${w.done} of ${w.target} sessions this week`);

  function renderHUD() {
    const s = Engine.summary(S);
    $("#hud-level").innerHTML = `<b>Lv ${s.level.level}</b> <span class="muted">${esc(s.title)}</span>`;
    $("#hud-xpbar").style.width = s.level.pct + "%";
    $("#hud-week").innerHTML = weekHudText(weekProgress(S));
    $("#btn-units").textContent = U.label().toUpperCase();
  }

  /* ================= dashboard ================= */
  function renderDash(host) {
    const s = Engine.summary(S);
    const wk = weekProgress(S);
    const attrs = Engine.attributes(S, 28);
    const mg = Engine.muscleGroups(S, 28);
    const weak = Engine.weakPoints(S, 28);

    /* hero */
    const hero = el("section", { class: "hero card" });
    hero.innerHTML = `
      <div class="hero-left">
        <div class="lvl-ring">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/>
          <circle cx="60" cy="60" r="52" class="ring-fg" stroke-dasharray="${(s.level.pct / 100) * 327} 327"/></svg>
          <div class="lvl-in"><span class="lvl-num">${s.level.level}</span><span class="lvl-lab">LEVEL</span></div>
        </div>
        <div class="hero-meta">
          <h2>${esc(S.profile.name || s.title)}</h2>
          <p class="muted">${S.profile.name ? esc(s.title) + " · " : ""}${fmt(s.level.into)} / ${fmt(s.level.need)} XP → next LV · ${fmt(s.xp)} total</p>
          <div class="chips">
            <span class="chip">${s.sessions} ${pl(s.sessions, "session")}</span>
            <span class="chip">${term("tonnage", `${fmt(s.tonnage / 1000, 1)} t lifted`)}</span>
            ${s.distKm > 0 ? `<span class="chip" title="Total distance logged across every session, all-time">${fmt(s.distKm, 1)} km logged</span>` : ""}
            ${s.density ? `<span class="chip" title="Share of all logged session time spent working rather than resting — all-time">${term("density", `${s.density}% work time (all-time)`)}</span>` : ""}
            <span class="chip">${weekChipText(wk)}</span>
            <span class="chip">${term("pr", `${s.prs} ${pl(s.prs, "PR")} this month`)}</span>
          </div>
        </div>
      </div>`;
    host.append(hero);

    /* the stat hexagon */
    const chartCard = el("section", { class: "card chart-card" });
    chartCard.innerHTML = `<div class="card-head"><h3>Attributes</h3><span class="muted">last 28 days vs the 28 before</span></div>`;
    const radarHost = el("div", { class: "radar-host" });
    chartCard.append(radarHost);
    const legend = el("div", { class: "attr-legend" });
    Engine.ATTRIBUTES.forEach((a) => {
      const d = attrs[a.key];
      const arrow = d.delta > 0 ? `<span class="up">▲${d.delta}</span>` : d.delta < 0 ? `<span class="down">▼${Math.abs(d.delta)}</span>` : `<span class="flat">—</span>`;
      legend.append(el("div", { class: "attr-row" },
        `<span class="dot" style="background:${a.color}"></span>
         ${term(attrTermId(a.key), `<span class="attr-name">${a.label}</span>`, "bare")}
         ${term("tiers", `<span class="attr-tier">${d.tier}</span>`, "bare")}
         <span class="attr-score">${d.score}</span>${arrow}`));
    });
    chartCard.append(legend);
    host.append(chartCard);
    Chart.radar(radarHost, {
      title: "attributes", axes: Engine.ATTRIBUTES.map((a) => ({
        label: a.label, value: attrs[a.key].score, tier: attrs[a.key].tier,
        delta: attrs[a.key].delta, color: a.color,
      })),
    });

    dashHistory(host);
    dashConsistency(host);
    dashVolume(host);

    /* attribute detail — the definition itself lives in js/glossary.js (the one
       source), so this block and the glossary screen cannot drift apart. */
    const det = el("section", { class: "card" });
    det.innerHTML = `<div class="card-head"><h3>What the numbers mean</h3><span class="muted">tap a word to see what it means</span></div>`;
    const dl = el("div", { class: "detail-grid" });
    Engine.ATTRIBUTES.forEach((a) => {
      const d = attrs[a.key];
      dl.append(el("div", { class: "detail" },
        `<h4 style="color:${a.color}">${term(attrTermId(a.key), a.label, "bare")} <span class="muted">${d.score}</span></h4>
         <p>${attrExplain(a.key, d)}</p>`));
    });
    det.append(dl);
    host.append(det);

    /* muscle balance */
    const mb = el("section", { class: "card chart-card" });
    mb.innerHTML = `<div class="card-head"><h3>Muscle balance</h3><span class="muted">${term("effort-set", "effort sets / raw sets")}</span></div>`;
    const mbHost = el("div", { class: "radar-host" });
    mb.append(mbHost);
    const mlist = el("div", { class: "attr-legend" });
    Engine.GROUP_ORDER.forEach((g) => {
      const m = mg[g];
      const cls = m.status.replace(/[^a-z]/gi, "");
      const sid = GLOSS.statusId ? GLOSS.statusId(m.status) : null;
      mlist.append(el("div", { class: "attr-row mrow" },
        `<span class="attr-name">${g}</span>
         ${term(sid, `<span class="attr-tier status-${cls}">${m.status}</span>`, "bare")}
         <span class="attr-score">${m.effPerWk}/wk</span>
         <span class="muted mraw">${m.setsPerWk} raw sets</span>`));
    });
    mb.append(mlist);
    const barHost = el("div", { class: "bar-host" });
    mb.append(barHost);
    host.append(mb);
    Chart.radar(mbHost, {
      title: "muscles", fill: "#ffd166",
      axes: Engine.GROUP_ORDER.map((g) => ({ label: g, value: mg[g].score, tier: mg[g].effPerWk + "/wk", valText: "", color: "#f8d030" })),
    });
    Chart.bars(barHost, {
      unit: "",
      items: Engine.GROUP_ORDER.map((g) => ({ label: g, value: mg[g].effPerWk, status: mg[g].status, marker: mg[g].landmarks.mev })),
    });

    /* weak points */
    const wp = el("section", { class: "card" });
    wp.innerHTML = `<div class="card-head"><h3>Weak points &amp; next moves</h3></div>`;
    if (!weak.length) wp.append(el("p", { class: "muted" }, "Nothing flagged — balance looks good. Keep progressing the big lifts."));
    weak.forEach((w) => {
      wp.append(el("div", { class: "weak " + w.severity },
        `<div class="weak-h"><span class="sev ${w.severity}">${w.severity === "high" ? "!" : w.severity === "med" ? "•" : "·"}</span> ${esc(w.title)}${w.kind === "stagnant" ? ` ${term("plateau", "what does plateaued mean?")}` : ""}</div>
         <p class="muted">${esc(w.detail)}</p>
         <p class="fix">→ ${esc(w.fix)}</p>`));
    });
    host.append(wp);

    /* gamification */
    const gam = el("section", { class: "card", id: "badges" });
    gam.innerHTML = `<div class="card-head"><h3>Progress &amp; badges</h3><span class="muted">${s.prsAll} PRs all-time</span></div>`;
    const badges = el("div", { class: "badges" });
    Engine.achievements(S).forEach((a) => {
      badges.append(el("div", { class: "badge " + (a.unlocked ? "on" : "off"), title: a.desc },
        `<span class="badge-ico">${a.unlocked ? "★" : "☆"}</span>
         <span class="badge-txt"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span>`));
    });
    gam.append(badges);
    host.append(gam);

    /* recent PRs */
    const prs = el("section", { class: "card" });
    prs.innerHTML = `<div class="card-head"><h3>Recent records</h3></div>`;
    const rows = Engine.prTable(S).filter((r) => r.prs.length).slice(0, 8);
    if (!rows.length) prs.append(el("p", { class: "muted" }, "No PRs yet — log a session."));
    rows.forEach((r) => {
      const last = r.prs[r.prs.length - 1];
      prs.append(el("div", { class: "pr-row" },
        `<span class="pr-name">${esc(r.name)}</span>
         <span class="pr-best">${bestLabel(r)}</span>
         <span class="muted">${last.date} · ${last.hit.join(", ")}</span>`));
    });
    host.append(prs);
  }

  /* The year in stats: each point is an honest re-evaluation of the training
     that preceded that month, so the line is a record and not a projection. */
  function dashHistory(host) {
    const hist = Engine.attributeHistory(S, 12);
    const card = el("section", { class: "card" });
    const last = hist[hist.length - 1];
    const firstIdx = hist.findIndex((p) => p.any);
    const first = firstIdx >= 0 ? hist[firstIdx] : null;
    card.innerHTML = `<div class="card-head"><h3>Progress over the year</h3>
      <span class="muted">${first ? "since " + first.date : "last 12 months"}</span></div>`;
    const ch = el("div", { class: "chart-host" });
    card.append(ch);
    const legend = el("div", { class: "attr-legend" });
    Engine.ATTRIBUTES.forEach((a) => {
      // only claim a change once there is an earlier month that HAD data
      const delta = first ? last.scores[a.key] - first.scores[a.key] : null;
      const arrow = delta == null ? `<span class="flat">—</span>`
        : delta > 0 ? `<span class="up">▲${delta}</span>`
        : delta < 0 ? `<span class="down">▼${Math.abs(delta)}</span>` : `<span class="flat">—</span>`;
      legend.append(el("div", { class: "attr-row" },
        `<span class="dot" style="background:${a.color}"></span>
         <span class="attr-name">${a.label}</span>
         <span class="attr-score">${last.scores[a.key]}</span>${arrow}`));
    });
    card.append(legend);
    host.append(card);
    Chart.multi(ch, {
      series: Engine.ATTRIBUTES.map((a) => ({
        label: a.label, color: a.color,
        points: hist.map((p) => ({ x: p.date, y: p.scores[a.key] })),
      })),
    });
  }

  /* A year of showing up, one square per day. */
  function dashConsistency(host) {
    const dm = Engine.dayMap(S, 371);
    const keys = Object.keys(dm);
    const card = el("section", { class: "card" });
    /* No sessions at all: an empty account is an empty state, not a grid of
       blank cells claiming a year of rest days. */
    if (!keys.length) {
      card.innerHTML = `<div class="card-head"><h3>Consistency</h3><span class="muted">No sessions yet</span></div>
        <p class="muted small">Log your first workout and your year of showing up starts here.</p>`;
      host.append(card);
      return;
    }
    const trained = Object.values(dm).filter((d) => d.sessions > 0).length;
    const span = keys.length;
    card.innerHTML = `<div class="card-head"><h3>Consistency</h3>
      <span class="muted">${trained} of the last ${span} ${pl(span, "day")}${span < 371 ? " — since you started" : ""}</span></div>`;
    const h = el("div", { class: "hm-host" });
    card.append(h);
    host.append(card);
    Chart.heatmap(h, { days: dm });
  }

  /* Weekly volume, the fatigue read, and how long since each group was trained.
     The deload line only speaks when the logged effort actually says something —
     an app that shouts "deload" every other week teaches you to ignore it. */
  function dashVolume(host) {
    const weeks = Engine.volumeWeeks(S, 12);
    const del = Engine.deloadCheck(S);
    const fresh = Engine.freshness(S);
    const card = el("section", { class: "card" });
    card.innerHTML = `<div class="card-head"><h3>Volume &amp; recovery</h3>
      <span class="muted" id="vol-cap"></span></div>
      <div class="seg" id="vol-seg" role="group" aria-label="Volume metric">
        <button type="button" class="on" data-met="sets" aria-pressed="true">Sets</button>
        <button type="button" data-met="tonnage" aria-pressed="false">Tonnage</button>
        <button type="button" data-met="reps" aria-pressed="false">Reps</button>
      </div>`;
    const ch = el("div", { class: "chart-host" });
    card.append(ch);
    card.append(el("p", { class: "deload " + (del.suggest ? "warn" : "ok") },
      (del.suggest ? `<b>Consider a lighter week.</b> ${esc(del.why)} ${esc(del.fix || "")}` : esc(del.why))
      + ` ${term("deload", "what is a deload?")}`));

    const fr = el("div", { class: "fresh-row" });
    Engine.GROUP_ORDER.forEach((g) => {
      const f = fresh[g];
      const txt = f.fresh == null ? "no data" : f.days < 1 ? "today" : Math.round(f.days) + "d";
      const cls = f.fresh == null ? "none" : f.fresh >= 90 ? "ready" : f.fresh >= 55 ? "mid" : "worked";
      fr.append(el("span", { class: "fresh-chip " + cls,
        title: f.fresh == null ? "Not trained in the last 4 weeks" : `Last trained ${Math.round(f.days * 10) / 10} days ago · ${f.setsThisWeek} sets/wk in the last 4 weeks` },
        `${esc(g)} <b>${txt}</b>`));
    });
    card.append(fr);
    card.append(el("p", { class: "muted small" }, term("freshness", "Days since each group was last trained") + " — recency, not a measurement of recovery."));
    host.append(card);

    /* Volume, tonnage and reps are ALL already computed per week by
       Engine.volumeWeeks — this only chooses which of those columns to plot.
       There is no second tonnage calculation here; it is the same load × reps
       the engine (and the PR/strength paths) already use. Tonnage is stored in
       kg, so it is shown through U.w() like every other weight. */
    const METRICS = {
      sets:    { term: "volume",  color: "#f8d030", label: () => " sets",        cap: () => "sets per week, last 12 weeks" },
      tonnage: { term: "tonnage", color: "#58c8f8", label: () => " " + U.label(), cap: () => `tonnage per week (${U.label()}), last 12 weeks` },
      reps:    { term: "reps",    color: "#a8e878", label: () => " reps",        cap: () => "reps per week, last 12 weeks" },
    };
    const draw = (met) => {
      const m = METRICS[met];
      const cap = $("#vol-cap", card); if (cap) cap.innerHTML = term(m.term, m.cap());
      Chart.line(ch, {
        fillArea: true, color: m.color, unit: m.label(),
        points: weeks.map((w) => ({ x: Engine.dstr(Date.now() - w.weeksAgo * 7 * 86400000),
                                    y: met === "tonnage" ? U.w(w.tonnage) : w[met] })),
      });
    };
    const seg = $("#vol-seg", card);
    $$("button", seg).forEach((b) => b.addEventListener("click", () => {
      $$("button", seg).forEach((x) => {
        const on = x === b;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", on ? "true" : "false");
      });
      draw(b.dataset.met);
    }));
    draw("sets");
  }

  function bestLabel(r) {
    const b = r.best;
    if (!b || !b.date) return "—";
    if (b.mode === "weight_reps") return `${fmtW(U.w(b.est1RM))} ${U.label()} e1RM`;
    if (b.mode === "reps") return `${b.reps} reps`;
    if (b.mode === "time") return `${b.time}s hold`;
    if (b.mode === "distance_time") return `${fmt(b.dist / 1000, 2)} km`;
    return "—";
  }

  /* The live readout for one attribute. The DEFINITION ("what this measures") is
     not written here — it is read from js/glossary.js, the single source shared
     with the glossary screen, so the same term cannot be explained two ways. */
  function attrExplain(key, d) {
    const head = GLOSS.attrPlain ? GLOSS.attrPlain(key) : "";
    const lead = head ? esc(head) + " " : "";
    const x = d.detail;
    const live = (() => { switch (key) {
      case "STR": return x.basis === "standards"
        ? `Estimated 1RM on ${x.n} core lift${x.n > 1 ? "s" : ""} vs published bodyweight standards (bodyweight ${fmtW(U.w(x.bw))} ${U.label()}).`
        : x.basis === "estimated"
          ? `No free-weight core lift logged yet, so this is estimated from machine work (${esc(x.from || "—")}) and deliberately conservative. Log a barbell bench, squat or deadlift to make it real.`
          : "Add your bodyweight in Profile and this becomes a real score.";
      case "END": return `Cardio ${Math.round(x.cardioMinPerWk)} min/wk`
        + (x.distKmPerWk > 0 ? ` · ${Math.round(x.distKmPerWk * 10) / 10} km/wk (${x.distMod || "other"})` : "")
        + (x.paceKmh ? ` · average pace ${x.paceKmh.toFixed(1)} km/h` : "")
        + ` · best single set ${x.maxReps} reps · ${Math.round(x.setsPerWk)} sets/wk.`
        + (x.avgRest
            ? ` Average rest ${fmtRest(x.avgRest)} and ${x.density}% work time over the last 28 days — short rest raises the endurance demand, which is why it counts here and nowhere else.`
            : " Log rest between sets to factor training density in; nothing else reads it.");
      case "POW": return `${x.plyoReps} explosive reps logged · ${x.heavySets} heavy low-rep sets (≤3 reps).`;
      case "MOB": return x.minPerWk > 0
        ? `${Math.round(x.minPerWk)} min/wk across ${x.sessions} ${pl(x.sessions, "session")} of mobility and control work — stretching, joint work, and stability or rotation drills. Loaded flexion like crunches is strength, not range, so it counts toward Core instead.`
        : "No mobility or control work logged. Stretching, foam rolling, joint rotations, or stability and rotation drills (plank, bird dog, Pallof press, Turkish get-up) all count. Crunches and sit-ups do not — they train a short range under load, which is strength.";
      case "CON": return `${x.sessions} ${pl(x.sessions, "session")} in 28 days against a target of ${fmt(x.expected)} — frequency ${Math.round(x.frequency)}/100, continuity ${Math.round(x.continuity)}/100`
        + (x.longestGap != null ? ` (longest stretch without training ${x.longestGap} ${pl(x.longestGap, "day")}, ${x.weeksCovered} of the last 4 weeks trained)` : "")
        + `. Continuity rewards turning up regularly, and one missed week costs only a few points.`;
      case "VIT": return (x.basis && x.basis !== "no data")
        ? `Scored from ${x.basis}${x.log ? ` · ${x.log} bodyweight check-in${x.log > 1 ? "s" : ""}` : ""}.`
        : "Add bodyweight, body-fat and height in Profile to score vitality.";
      default: return "";
    } })();
    return lead + live;
  }

  /* ================= log ================= */
  /* A new session always sits on today's date. It only stops following the
     calendar once the user actually picks a date (dateTouched), so editing an
     old workout keeps its date but a fresh log never inherits a stale one. */
  function newDraft(date) {
    return { id: null, date: date || today(), note: "", entries: [], dateTouched: false };
  }

  function renderLog(host) {
    if (!draft) draft = newDraft();
    // an unsaved, untouched draft tracks the current date even if the app has
    // been sitting open across midnight
    if (!draft.id && !draft.dateTouched) draft.date = today();
    const wrap = el("section", { class: "card" });
    wrap.innerHTML = `
      <div class="card-head">
        <h3>${draft.id ? "Editing session" : "New session"}</h3>
        <div class="row">
          <input class="inp" type="date" id="w-date" value="${draft.date}" style="max-width:158px">
          ${lastSession() ? `<button class="btn ghost" id="btn-repeat" title="Start from your most recent session">Repeat ${lastSession().date}</button>` : ""}
          <button class="btn ghost" id="btn-import">Paste from notes</button>
        </div>
      </div>
      <input class="inp note-inp" id="w-note" placeholder="Session note (optional)" value="${esc(draft.note)}">`;
    host.append(wrap);

    draft.entries.forEach((en, i) => host.append(entryCard(en, i)));

    const add = el("section", { class: "card add-card" });
    add.innerHTML = `<button class="btn big" id="btn-add">+ Add exercise</button>`;
    add.append(el("p", { class: "muted small" }, "Search 930 movements, or create your own. Sets pre-fill from your last session."));
    host.append(add);

    const save = el("section", { class: "save-bar" });
    save.innerHTML = `<button class="btn primary big" id="btn-save">Save session</button>
      ${draft.id ? `<button class="btn danger" id="btn-del">Delete</button>` : ""}`;
    host.append(save);

    $("#w-date").addEventListener("change", (e) => { draft.date = e.target.value; draft.dateTouched = true; });
    $("#w-note").addEventListener("input", (e) => { draft.note = e.target.value; });
    $("#btn-add").addEventListener("click", () => exercisePicker((ex) => addEntry(ex)));
    $("#btn-import").addEventListener("click", importDialog);
    const rep = $("#btn-repeat");
    if (rep) rep.addEventListener("click", () => {
      const w = lastSession();
      draft = { id: null, date: today(), note: w.note || "", entries: JSON.parse(JSON.stringify(w.entries)), dateTouched: false };
      render(); toast("Started from " + w.date + " — edit and save", "good");
    });
    $("#btn-save").addEventListener("click", saveDraft);
    const del = $("#btn-del"); if (del) del.addEventListener("click", () => {
      // Irreversible and it can be a whole session of work, so confirm once.
      if (!confirm("Delete this session? This cannot be undone.")) return;
      Store.deleteWorkout(draft.id); draft = newDraft(); toast("Session deleted", "warn"); render();
    });
  }

  /* The most recent SAVED session, newest by date (the array is date-ordered but
     sorting here costs nothing and removes the assumption). */
  function lastSession() {
    const ws = (S.workouts || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return ws.length ? ws[ws.length - 1] : null;
  }

  function addEntry(ex) {
    const last = Engine.seriesFor(S, ex.id).slice(-1)[0];
    const prevEntry = (() => {
      for (let i = S.workouts.length - 1; i >= 0; i--) {
        const en = (S.workouts[i].entries || []).find((e) => e.id === ex.id);
        if (en) return en;
      }
      return null;
    })();
    const mode = Engine.exMode(S, ex.id);
    const sets = prevEntry ? prevEntry.sets.map((s) => ({ ...s })) : [{}];
    if (Engine.isBodyweight(ex.n)) {
      const bw = Engine.bodyweight(S);
      if (bw > 0) sets.forEach((s) => { s.bwKg = s.bwKg || bw; });
    }
    draft.entries.push({ id: ex.id, name: ex.n, mode, sets });
    toast(last ? `Pre-filled ${sets.length} sets from ${last.date}` : `Added ${ex.n}`);
    render();
  }

  function entryCard(en, idx) {
    const info = findEx(en.id) || { n: en.name, e: [], p: [], c: "" };
    const st = Engine.entryStats(en);
    const cmp = Engine.compareLast(S, en.id);
    const prev = Engine.bestFor(S, en.id);
    const card = el("section", { class: "card entry" });

    // Progressive-overload target from the user's own last session. Only shown
    // when this exercise has history — no history, no noise.
    const tgt = Engine.nextTarget(S, en.id);
    const targetLine = tgt ? (() => {
      // unit-aware: a 2.5 kg step is 5.5 lb, so show the converted value rather
      // than a nonsensical 2.5 lb jump
      const showOpt = (o) => {
        if (o.w <= 0) return `${o.r} reps`;
        let v = U.w(o.w);
        if (!U.kg) v = Math.round(v / 5) * 5;   // pound plates come in 5s
        return `${fmtW(v)}×${o.r}`;
      };
      const lastTxt = tgt.last.w > 0 ? `${fmtW(U.w(tgt.last.w))}×${tgt.last.r}` : `${tgt.last.r} reps`;
      const opts = tgt.options.map(showOpt).map((x) => `<b>${x}</b>`).join(`<span class="muted"> or </span>`);
      return `<div class="target"><span class="t-lab">${term("next-target", "NEXT")}</span> ${opts}`
        + `<span class="muted"> · from ${lastTxt}, ${tgt.date}</span></div>`;
    })() : "";

    const cmpBanner = cmp ? (() => {
      const p = cmp.est1RM.pct;
      const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
      const txt = en.mode === "weight_reps"
        ? `e1RM ${fmtW(U.w(cmp.est1RM.cur))} ${U.label()} vs ${fmtW(U.w(cmp.est1RM.prev))} (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`
        : `volume ${fmt(cmp.volume.cur)} vs ${fmt(cmp.volume.prev)}`;
      return `<div class="cmp ${cls}">${cls === "up" ? "▲" : cls === "down" ? "▼" : "–"} ${txt} <span class="muted">· last: ${cmp.prevDate}</span></div>`;
    })() : (() => {
      // one saved session is not "first time" — say what is actually true
      const n = Engine.seriesFor(S, en.id).length;
      return `<div class="cmp flat">${n === 1
        ? `One session logged — ${term("baseline", "this one becomes your baseline")} to compare against`
        : "First time logging this — no comparison yet"}</div>`;
    })();

    card.innerHTML = `
      <div class="entry-head">
        <div>
          <h3>${esc(en.name)}</h3>
          <div class="sub muted">${esc(info.c || "")}${(info.e || []).length ? " · " + esc(info.e.join(", ")) : ""} · <span class="mode-tag">${en.mode.replace("_", " × ")}</span></div>
        </div>
        <div class="row">
          <select class="mini mode-sel">${["weight_reps", "reps", "time", "weight_time", "distance_time", "weight_distance"]
            .map((m) => `<option value="${m}" ${m === en.mode ? "selected" : ""}>${m.replace("_", " × ")}</option>`).join("")}</select>
          <button class="btn ghost tiny rm">✕</button>
        </div>
      </div>
      ${cmpBanner}
      ${targetLine}
      <div class="sets" id="sets-${idx}"></div>
      <div class="muted small settype-hint">${term("set-type", "Set type")} — a drop or failure set counts for more effort than a straight set.</div>
      <div class="entry-rest">
        <label>Rest between sets <input class="inp num rest-default" type="number" inputmode="numeric" min="0" step="5" placeholder="secs" value="${en.restDefault ?? ""}" style="width:72px"> sec</label>
        <span class="muted small">Applies to every set — blank sets fall back to it.</span>
      </div>
      <div class="quick">
        <input class="inp" placeholder="${quickHint(en.mode)}" data-idx="${idx}">
        <button class="btn qadd" data-idx="${idx}" title="Add a set — with the box filled it reads your shorthand, empty it just adds a line">+ Add set</button>
      </div>
      <div class="entry-foot">
        <span>${st.sets} ${pl(st.sets, "set")}</span>
        ${st.tonnage ? `<span>${fmt(U.w(st.tonnage) / 1, 0)} ${U.label()} tonnage</span>` : ""}
        ${st.est1RM ? `<span>${term("e1rm", "best e1RM")} <b>${fmtW(U.w(st.est1RM))} ${U.label()}</b></span>` : ""}
        ${st.reps ? `<span>${st.reps} ${pl(st.reps, "rep")}</span>` : ""}
        ${st.avgRPE ? `<span>${term("rpe", "avg RPE")} ${st.avgRPE.toFixed(1)}</span>` : ""}
        ${st.avgRest ? `<span>rest ${fmtRest(st.avgRest)}</span>` : ""}
        <span class="muted">${prev.date ? "all-time best " + bestLabel({ best: prev, mode: en.mode }) : "first time logging this"}</span>
      </div>`;

    const setsHost = $("#sets-" + idx, card);
    en.sets.forEach((s, si) => setsHost.append(setRow(en, s, si, idx)));

    $(".mode-sel", card).addEventListener("change", (e) => {
      en.mode = e.target.value;
      setTrackMode(en.id, en.mode);
      render();
    });
    $(".rm", card).addEventListener("click", () => { draft.entries.splice(idx, 1); render(); });
    const qi = $(".quick .inp", card);
    /* One button, two obvious uses: text in the box -> parse the shorthand and
       add it; box empty -> add a blank line you fill in yourself. It used to
       refuse outright when the box was empty, which left no way to add a set by
       hand and no + to tap. A blank set is dropped on save, so an accidental tap
       costs nothing. */
    const doAdd = () => {
      if (!qi.value.trim()) { en.sets.push({}); render(); return; }
      const p = parseSet(qi.value, en.mode);
      if (!p) { toast("Couldn't read that — try 100x10", "warn"); return; }
      en.sets.push(p); render();
    };
    $(".qadd", card).addEventListener("click", doAdd);
    const rd = $(".rest-default", card);
    rd.addEventListener("input", (e) => {
      const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
      en.restDefault = v;
      // keep every set's placeholder in step so the effective value is always visible
      $$(".rest-wrap input", card).forEach((i) => { i.placeholder = v ? String(v) : "rest"; });
      updateEntryFoot(idx);
    });
    qi.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
    return card;
  }

  const quickHint = (m) => ({
    weight_reps: "e.g. 100x10  ·  80x8@9  ·  w 40x5", reps: "e.g. 12  ·  15@8",
    time: "e.g. 60s  ·  1:30", weight_time: "e.g. 20x45s",
    distance_time: "e.g. 5km 24:00", weight_distance: "e.g. 24x40m",
  }[m] || "100x10");

  function setRow(en, s, si, idx) {
    const row = el("div", { class: "set-row" });
    /* A bodyweight movement's load IS the body, so record which body at the time
       of logging. Without this the engine sees only the strapped-on weight, which
       is usually nothing, and an unweighted pull-up cannot be graded at all. */
    if (Engine.isBodyweight(en.name)) {
      const bw = Engine.bodyweight(S);
      if (bw > 0) s.bwKg = s.bwKg || bw;
    }
    /* A field shows DISPLAY units; storage stays canonical kg — the same rule the
       engine, the footer and the target line follow. This used to print s.w
       straight out, so the moment anything re-rendered, a set the user had typed
       as 180 lb came back as 81.64662740915384 in his own input box. Typing hid
       it (the DOM keeps what you type), which is why it survived this long. */
    /* Every field carries an accessible name, not just a placeholder: a
       placeholder is not a label, and a bare "reps"/"secs" box told a screen
       reader nothing about WHICH set it belonged to. */
    const sl = `Set ${si + 1}`;
    /* Set type. It is a real control, not a tag: choosing Drop or Failure feeds
       the effort path harder than a straight set. The words come from the
       engine's own table. */
    const tyOpts = [["", "Set"], ["drop", "Drop"], ["failure", "Failure"]];
    const tySel = `<select class="mini setty" aria-label="${sl} type" title="Set type — a drop or failure set counts for more effort than a straight set.">${tyOpts.map(([v, l]) => `<option value="${v}" ${(s.ty || "") === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    if (s.ty === "drop" || s.ty === "failure") row.classList.add("is-hard");
    const f = (k, ph, w = 56, aria = "") => {
      let v = s[k];
      if (k === "w" && v !== undefined && v !== null && v !== "") v = fmtW(U.w(Engine.num(v)));
      const lab = aria ? ` aria-label="${esc(aria)}"` : "";
      return `<input class="inp num" data-k="${k}" type="number" inputmode="decimal" step="any" placeholder="${ph}" value="${v ?? ""}" style="width:${w}px"${lab}>`;
    };
    let inner = `<span class="set-n" aria-hidden="true">${si + 1}</span>` + tySel;
    if (en.mode === "weight_reps") inner += f("w", U.label(), 56, `${sl} weight`) + `<span class="times">×</span>` + f("r", "reps", 48, `${sl} reps`);
    else if (en.mode === "reps") inner += f("r", "reps", 48, `${sl} reps`);
    else if (en.mode === "time") inner += f("t", "secs", 64, `${sl} seconds`) + `<span class="unit">s</span>`;
    else if (en.mode === "weight_time") inner += f("w", U.label(), 56, `${sl} weight`) + `<span class="times">×</span>` + f("t", "secs", 48, `${sl} seconds`) + `<span class="unit">s</span>`;
    else if (en.mode === "distance_time") inner += f("d", "metres", 62, `${sl} distance`) + `<span class="unit">m</span>` + f("t", "secs", 48, `${sl} seconds`) + `<span class="unit">s</span>`;
    else if (en.mode === "weight_distance") inner += f("w", U.label(), 56, `${sl} weight`) + `<span class="times">×</span>` + f("d", "metres", 56, `${sl} distance`) + `<span class="unit">m</span>`;
    inner += `<span class="rpe-wrap"><input class="inp num" data-k="rpe" type="number" min="1" max="10" step="0.5" placeholder="RPE" value="${s.rpe ?? ""}" style="width:44px" aria-label="${sl} effort (RPE)"></span>`;
    const restPh = en.restDefault ? String(en.restDefault) : "rest";
    inner += `<span class="rest-wrap"><input class="inp num" data-k="rest" type="number" inputmode="numeric" min="0" step="5" placeholder="${restPh}" value="${s.rest ?? ""}" style="width:48px" aria-label="${sl} rest after this set, seconds" title="Rest after this set, in seconds. Leave blank to use the exercise default."></span>`;
    if (en.mode === "weight_reps") {
      const e1 = Engine.est1RM(Engine.num(s.w), Engine.num(s.r));
      // say when the estimate is capped, so 12 and 20 reps at the same load
      // reading identically is explained rather than looking like a bug
      const capped = Engine.num(s.r) > 12 && e1;
      const bwMov = Engine.isBodyweight(en.name);
      const title = bwMov
        ? `Bodyweight movement: the load is your body (about ${fmtW(U.w(Engine.num(s.bwKg) * Engine.bwFactor(en.name)))} ${U.label()}) plus anything strapped on${capped ? ". Epley is only accurate to about 12 reps, so this estimate is capped" : ""}`
        : (capped ? "Epley is only accurate to about 12 reps, so this estimate is capped — it will not rise further at this weight" : "");
      inner += `<span class="e1${capped ? " capped" : ""}${bwMov ? " bw" : ""}" title="${esc(title)}">${e1 ? (capped ? "≥" : "") + fmtW(U.w(e1)) + " e1RM" : ""}</span>`;
    }
    inner += `<button class="btn ghost tiny x" title="remove" aria-label="Remove ${sl.toLowerCase()}">✕</button>`;
    row.innerHTML = inner;
    $$("input", row).forEach((inp) => inp.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
      s[k] = v;
      /* Exactly one rule for the weight: the field shows display units, the
         model stores kg. The three contradictory assignments that used to sit
         here all wrote s.w, and the last one ran even when the field was cleared
         — so emptying the box stored NaN (undefined / 2.2046) instead of
         clearing it. Clearing now clears. */
      if (k === "w") s.w = v === undefined ? undefined : U.wi(v);
      const e1 = $(".e1", row);
      if (e1) { const val = Engine.est1RM(Engine.num(s.w), Engine.num(s.r)); e1.textContent = val ? fmtW(U.w(val)) + " e1RM" : ""; }
      updateEntryFoot(idx);
    }));
    /* The set-type select changes what the set COUNTS for, so the footer is
       recomputed on change. An empty value means a straight working set, so the
       field is removed rather than stored as "" — one fact, present or absent. */
    $(".setty", row).addEventListener("change", (e) => {
      const v = e.target.value;
      if (v) s.ty = v; else delete s.ty;
      row.classList.toggle("is-hard", v === "drop" || v === "failure");
      updateEntryFoot(idx);
    });
    /* button.x, not .x: the multiplication sign used to share that class, and
       querySelector returns the FIRST match in document order — so this delete
       handler was bound to the "×" between weight and reps. Tapping the times
       sign silently deleted the set, while the visible ✕ delete button did
       nothing at all. The multiplier is .times now and this is unambiguous. */
    $("button.x", row).addEventListener("click", () => { en.sets.splice(si, 1); render(); });
    return row;
  }

  function updateEntryFoot(idx) {
    const en = draft.entries[idx];
    const st = Engine.entryStats(en);
    const foot = $$(".card.entry")[idx] && $(".entry-foot", $$(".card.entry")[idx]);
    if (!foot) return;
    foot.innerHTML = `<span>${st.sets} ${pl(st.sets, "set")}</span>
      ${st.tonnage ? `<span>${fmt(U.w(st.tonnage))} ${U.label()} tonnage</span>` : ""}
      ${st.est1RM ? `<span>best e1RM <b>${fmtW(U.w(st.est1RM))} ${U.label()}</b></span>` : ""}
      ${st.reps ? `<span>${st.reps} ${pl(st.reps, "rep")}</span>` : ""}
      ${st.avgRPE ? `<span>avg RPE ${st.avgRPE.toFixed(1)}</span>` : ""}
      ${st.avgRest ? `<span>rest ${fmtRest(st.avgRest)}</span>` : ""}`;
  }

  /* ================= XP display ================= */
  /* A session's XP is shown the way a game shows it: the number WITH the
     multiplier that produced it, e.g. "+180 XP (x1.5)". Tapping it opens the
     named factors that composed it — each one an idea the app already teaches
     (a PR, the weekly target, a group's own MRV). */
  const xpMultText = (m) => "x" + (Math.round(m * 1000) / 1000);
  function xpBreakdown(w, sx) {
    const f = sx.factors;
    const row = (label, val) => `<div class="xp-row"><span>${label}</span><b>${esc(val)}</b></div>`;
    const box = el("div", { class: "xp-break" });
    box.innerHTML =
      `<h3>+${fmt(sx.xp)} XP <span class="muted">(${esc(xpMultText(sx.mult))})</span></h3>
       <p class="muted small">${esc(w.date)} — base XP for the work logged, then one ${term("xp-multiplier", "XP multiplier")} on top.</p>
       <div class="xp-rows">
         ${row("Base XP (tonnage, sets, exercises, PRs)", fmt(sx.base))}
         ${row("Improvement — a PR this session", xpMultText(f.improvement))}
         ${row("Consistency — weekly target met", xpMultText(f.consistency))}
         ${row("Volume — over-MRV reduction", xpMultText(f.volume))}
       </div>
       <p class="muted small">${esc(xpMultText(f.improvement))} × ${esc(xpMultText(f.consistency))} × ${esc(xpMultText(f.volume))} = ${esc(xpMultText(sx.mult))}${sx.capped ? " (capped)" : ""} · capped at ×${Engine.XP.CAP}</p>
       <div class="row end"><button class="btn ghost" id="xb-ok">Got it</button></div>`;
    openModal(box, "narrow");
    $("#xb-ok", box).addEventListener("click", closeModal);
  }
  /* The tappable XP-with-multiplier control, shared by the save toast and every
     History card, so the same number is read the same way in both places. */
  function xpChip(w, sx) {
    const b = el("button", { class: "btn ghost tiny xp-chip", type: "button",
      title: "Tap to see where this XP came from" },
      `+${fmt(sx.xp)} XP (${xpMultText(sx.mult)})`);
    b.addEventListener("click", () => xpBreakdown(w, sx));
    return b;
  }

  /* The ONE save path. Everything that awards a badge, a PR or a level-up hangs
     off THIS function, and it commits the session (Store.upsertWorkout) BEFORE it
     evaluates or celebrates anything — so an unsaved or discarded session can
     never hand out a badge or a PR. `draftIn` lets the test suite drive this real
     path with a draft it built; the app itself calls it with no argument and the
     live draft is used. */
  function saveDraft(draftIn) {
    const d = draftIn || draft;
    const entries = d.entries
      .map((en) => ({ ...en, sets: en.sets.filter((s) => Object.values(s).some((v) => v !== undefined && v !== null && v !== "")) }))
      .filter((en) => en.sets.length);
    if (!entries.length) { toast("Add at least one set", "warn"); return; }
    const isNew = !d.id;                          // an edit is not a fresh milestone
    const before = Engine.summary(Store.state);       // level/title BEFORE this save
    const w = Store.upsertWorkout({ id: d.id || undefined, date: d.date, note: d.note, entries });
    const after = Engine.summary(Store.state);
    const sx = Engine.sessionXp(Store.state, w);
    const prs = isNew ? Engine.sessionPRs(Store.state, w.date) : [];
    const newB = Engine.newAchievements(Store.state);
    Store.unlock(newB);
    draft = newDraft();
    let suffix = ` · ${entries.length} ${pl(entries.length, "exercise")} saved`;
    if (newB.length) suffix += ` · ${newB.length} badge${newB.length > 1 ? "s" : ""} unlocked!`;
    const line = el("span");
    line.append(xpChip(w, sx), el("span", {}, suffix));
    toast(line, "good", 4200);
    const ev = isNew ? Engine.milestoneEvents(
      { level: before.level.level, title: before.title },
      { level: after.level.level, title: after.title },
      prs, newB) : [];
    if (ev.length) celebrate(ev);
    render();
  }

  /* ================= celebration ================= */
  /* A full-screen badge-get moment in the app's own Gen-3 language, for the
     events that are genuinely milestones: a LEVEL UP, a RANK promotion, a PR,
     and a MAJOR achievement unlock. Minor badges and ordinary saves stay as the
     existing toast — a party for every set would be noise, and the brief says so.
     It reuses the modal (so it inherits the focus trap, Escape and hardware-back
     handling), and it is only ever opened from a save/check-in handler AFTER the
     render — never on load — so it can never block the app from loading. */
  const CELEB_HEAD = { level: "LEVEL UP!", rank: "RANK UP!", pr: "NEW PERSONAL BEST!", badge: "BADGE GET!" };
  const CELEB_RANK = { level: 0, rank: 1, pr: 2, badge: 3 };   // the highest-priority event leads
  function celebrate(events) {
    try {
      if (!events || !events.length) return;
      const lead = events.slice().sort((a, b) => (CELEB_RANK[b.kind] || 0) - (CELEB_RANK[a.kind] || 0))[0];
      const blocks = [];
      for (const e of events) {
        if (e.kind === "rank") blocks.push(`<p class="celeb-line"><b>${esc(e.from || "—")} → ${esc(e.to)}</b> <span class="muted">at level ${e.level}</span></p>`);
        else if (e.kind === "level") blocks.push(`<p class="celeb-line"><b>Level ${e.level}</b> <span class="muted">${esc(e.title || "")}</span></p>`);
        else if (e.kind === "pr") blocks.push(`<p class="celeb-line"><b>${esc(e.items.map((p) => p.name).join(", "))}</b> <span class="muted">— a new best</span></p>`);
        else if (e.kind === "badge") blocks.push(e.badges.map((b) => `<p class="celeb-line"><b>${esc(b.name)}</b> <span class="muted">— ${esc(b.desc)}</span></p>`).join(""));
      }
      const box = el("div", { class: "celebrate" });
      box.innerHTML =
        `<div class="celeb-star" aria-hidden="true">★</div>
         <div class="celeb-head">${esc(CELEB_HEAD[lead.kind] || "NICE WORK!")}</div>
         <div class="celeb-body">${blocks.join("")}</div>
         <div class="celeb-foot">
           <button class="btn ghost" id="celeb-badges">See your badges</button>
           <button class="btn primary" id="celeb-ok">Nice!</button>
         </div>`;
      openModal(box, "celebrate");
      const ok = $("#celeb-ok", box); if (ok) ok.addEventListener("click", closeModal);
      const vb = $("#celeb-badges", box); if (vb) vb.addEventListener("click", () => {
        closeModal();
        setView("dash");
        const b = $("#badges");
        if (b && b.scrollIntoView) b.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (e) {
      // A celebration must never break a save. Fall back to the toast only.
      console.warn("celebration skipped:", e && e.message);
    }
  }

  /* Award any newly-earned badges after a data change and celebrate the genuine
     ones. Shared by the check-in log and the profile save so every path that can
     unlock a badge treats it the same way. */
  function awardBadges(before, prs) {
    const after = Engine.summary(Store.state);
    const newB = Engine.newAchievements(Store.state);
    Store.unlock(newB);
    if (newB.length) toast(`${newB.length} badge${newB.length > 1 ? "s" : ""} unlocked!`, "good", 4200);
    const ev = Engine.milestoneEvents(
      { level: before.level.level, title: before.title },
      { level: after.level.level, title: after.title }, prs || [], newB);
    if (ev.length) celebrate(ev);
  }

  /* ================= import dialog ================= */
  function importDialog() {
    const box = el("div", { class: "import-box" });
    box.innerHTML = `
      <h3>Paste from your notes app</h3>
      <p class="muted small">Same format you already use — an exercise name ending in a colon, then <code>set:weight x reps</code> lines.</p>
      <textarea id="imp-ta" rows="12" placeholder="Bench press machine:
1:100x10
2:100x10
3:110x3"></textarea>
      <div class="row end"><button class="btn ghost" id="imp-x">Cancel</button><button class="btn primary" id="imp-go">Import</button></div>`;
    openModal(box, "wide");
    $("#imp-x").addEventListener("click", closeModal);
    $("#imp-go").addEventListener("click", () => {
      const parsed = parseNotes($("#imp-ta").value);
      if (!parsed.length) { toast("Nothing recognised", "warn"); return; }
      parsed.forEach((p) => draft.entries.push({ id: p.id, name: p.name, mode: p.mode, sets: p.sets }));
      closeModal();
      toast(`Imported ${parsed.length} exercises — review before saving`, "good");
      render();
    });
  }

  /* ================= exercise picker ================= */
  function exercisePicker(onPick) {
    const box = el("div", { class: "picker" });
    box.innerHTML = `
      <div class="picker-head">
        <input class="inp" id="pk-q" placeholder="Search 930 exercises…" autofocus>
        <div class="row">
          <select class="mini" id="pk-cat"><option value="">All categories</option>
            ${["Chest", "Back", "Shoulders", "Arms", "Legs", "Calves", "Abs", "Cardio"].map((c) => `<option>${c}</option>`).join("")}</select>
          <select class="mini" id="pk-eq"><option value="">All equipment</option>
            ${["Barbell", "Dumbbell", "Cable", "Machine", "Bench", "Kettlebell", "Bodyweight", "Band"].map((c) => `<option>${c}</option>`).join("")}</select>
        </div>
      </div>
      <div class="picker-list" id="pk-list"></div>
      <div class="picker-foot"><button class="btn ghost" id="pk-custom">+ Create custom exercise</button><button class="btn ghost" id="pk-x">Close</button></div>`;
    openModal(box, "wide");

    const list = $("#pk-list");
    const paint = () => {
      const q = $("#pk-q").value, cat = $("#pk-cat").value, eq = $("#pk-eq").value;
      const res = searchExercises(q, { cat, eq, limit: 80 });
      list.innerHTML = "";
      if (!res.length) { list.innerHTML = `<p class="muted pad">No match. Use “Create custom exercise”.</p>`; return; }
      res.forEach((x) => {
        const row = el("button", { class: "pick-row" },
          `<span class="pick-name">${esc(x.n)}</span>
           <span class="pick-meta muted">${esc(x.c)}${(x.e || []).length ? " · " + esc(x.e[0]) : " · bodyweight"} · ${x.m.replace("_", "×")}</span>`);
        row.addEventListener("click", () => { closeModal(); onPick(x); });
        list.append(row);
      });
    };
    $("#pk-q").addEventListener("input", paint);
    $("#pk-cat").addEventListener("change", paint);
    $("#pk-eq").addEventListener("change", paint);
    $("#pk-x").addEventListener("click", closeModal);
    $("#pk-custom").addEventListener("click", () => customDialog(onPick));
    paint();
    setTimeout(() => $("#pk-q").focus(), 60);
  }

  function customDialog(onPick) {
    const box = el("div", { class: "import-box" });
    box.innerHTML = `
      <h3>New exercise</h3>
      <input class="inp" id="cx-n" placeholder="Exercise name">
      <div class="row">
        <select class="mini" id="cx-c">${["Chest", "Back", "Shoulders", "Arms", "Legs", "Calves", "Abs", "Cardio", "Other"].map((c) => `<option>${c}</option>`).join("")}</select>
        <select class="mini" id="cx-m">${["weight_reps", "reps", "time", "weight_time", "distance_time", "weight_distance"].map((m) => `<option value="${m}">${m.replace("_", " × ")}</option>`).join("")}</select>
      </div>
      <input class="inp" id="cx-e" placeholder="Equipment (e.g. Machine, Barbell)">
      <div class="row end"><button class="btn ghost" id="cx-x">Cancel</button><button class="btn primary" id="cx-go">Create</button></div>`;
    openModal(box, "narrow");
    $("#cx-x").addEventListener("click", closeModal);
    $("#cx-go").addEventListener("click", () => {
      const n = $("#cx-n").value.trim();
      if (!n) { toast("Name required", "warn"); return; }
      const c = $("#cx-c").value, m = $("#cx-m").value, eq = $("#cx-e").value.trim();
      const g = { Chest: ["Chest"], Back: ["Back"], Shoulders: ["Shoulders"], Arms: ["Arms"], Legs: ["Legs"], Calves: ["Calves"], Abs: ["Core"], Cardio: ["Cardio"], Other: ["Core"] }[c];
      const ex = Store.addCustom({ n, c, m, p: g, s: [], e: eq ? [eq] : [], g, d: "" });
      buildIndex(); closeModal(); onPick(ex);
    });
  }

  /* ================= history ================= */
  /* The history list was a plain wall of cards with no way to find anything. A
     filter bar (exercise name + an inclusive date window) narrows it live, and
     "Copy notes" lifts exactly what is shown back into a notes app in the user's
     own shorthand. Both go through Engine.filterSessions / Engine.exportNotes-
     Shorthand, so nothing is re-implemented here and no control is left unwired. */
  function copyNoteText(txt, okMsg) {
    // clipboard can be refused (or absent on a non-secure context); never leave
    // the control doing nothing — offer a select-all box instead.
    const fallback = () => {
      const box = el("div", { class: "import-box" });
      box.innerHTML = `<h3>Copy to your notes</h3>
        <p class="muted small">Select all and copy.</p>
        <textarea id="nt-ta" rows="14">${esc(txt)}</textarea>
        <div class="row end"><button class="btn primary" id="nt-x">Done</button></div>`;
      openModal(box, "wide");
      const ta = $("#nt-ta", box); ta.focus(); ta.select();
      $("#nt-x", box).addEventListener("click", closeModal);
    };
    if (!txt) { toast("Nothing to copy", ""); return; }
    if (!navigator.clipboard || !navigator.clipboard.writeText) { fallback(); return; }
    navigator.clipboard.writeText(txt).then(() => toast(okMsg, "good", 4200), fallback);
  }

  function sessionCard(w) {
    let tonnage = 0, sets = 0, rpeSum = 0, rpeN = 0;
    (w.entries || []).forEach((en) => {
      const s = Engine.entryStats(en);
      tonnage += s.tonnage; sets += s.sets;
      if (s.avgRPE) { rpeSum += s.avgRPE * s.sets; rpeN += s.sets; }
    });
    const sessionRpe = rpeN ? (rpeSum / rpeN) : null;
    let restSum2 = 0, restN2 = 0;
    (w.entries || []).forEach((en) => { const s = Engine.entryStats(en); restSum2 += s.totalRest; restN2 += s.restN; });
    const sessionRest = restN2 ? restSum2 / restN2 : null;
    const card = el("section", { class: "card hist" });
    card.innerHTML = `
      <div class="hist-head">
        <div><b>${w.date}</b> <span class="muted">· ${(w.entries || []).length} ${pl((w.entries || []).length, "exercise")} · ${sets} ${pl(sets, "set")} · ${fmt(U.w(tonnage))} ${U.label()}${sessionRpe ? ` · avg RPE ${sessionRpe.toFixed(1)}` : ""}${sessionRest ? ` · rest ${fmtRest(sessionRest)}` : ""}</span>
        ${w.note ? `<div class="muted small">${esc(w.note)}</div>` : ""}</div>
        <div class="row"><button class="btn ghost tiny nt">Note</button><button class="btn ghost tiny ed">Edit</button><button class="btn ghost tiny cp">Repeat</button></div>
      </div>
      <div class="hist-body">
        ${(w.entries || []).map((en) => {
          const s = Engine.entryStats(en);
          const setsTxt = (en.sets || []).map((x) => setText(x, en.mode)).join("  ·  ");
          const restTxt = s.avgRest ? `  ·  rest ${fmtRest(s.avgRest)}` : "";
          return `<div class="hist-ex"><span class="hist-n">${esc(en.name)}</span><span class="hist-s">${esc(setsTxt + restTxt)}</span></div>`;
        }).join("")}
      </div>`;
    $(".row", card).prepend(xpChip(w, Engine.sessionXp(S, w)));
    $(".ed", card).addEventListener("click", () => {
      draft = JSON.parse(JSON.stringify(w));
      draft.dateTouched = true;          // editing keeps the workout's own date
      setView("log");
    });
    $(".cp", card).addEventListener("click", () => {
      draft = { id: null, date: today(), note: w.note || "", entries: JSON.parse(JSON.stringify(w.entries)), dateTouched: false };
      setView("log"); toast("Loaded into a new session");
    });
    $(".nt", card).addEventListener("click", () =>
      copyNoteText(Engine.exportNoteShorthand(S, w.id), "Copied in your notes format — paste it anywhere"));
    return card;
  }

  function renderHistory(host) {
    const total = (S.workouts || []).length;
    const head = el("section", { class: "card" });
    head.innerHTML = `
      <div class="card-head"><h3>History</h3><span class="muted" id="hist-count">${total} ${pl(total, "session")}</span></div>
      <div class="row">
        <input class="inp" id="hist-q" placeholder="Filter by exercise…" aria-label="Filter history by exercise name">
        <input class="inp" type="date" id="hist-from" aria-label="Filter history from this date">
        <input class="inp" type="date" id="hist-to" aria-label="Filter history to this date">
        <button class="btn ghost tiny" id="hist-clear">Clear</button>
        <button class="btn ghost tiny" id="hist-notes" title="Copy every session shown, in your notes shorthand">Copy notes</button>
      </div>`;
    host.append(head);
    const list = el("div", {});
    host.append(list);

    const readFilter = () => ({ q: $("#hist-q", head).value, from: $("#hist-from", head).value, to: $("#hist-to", head).value });

    const paint = () => {
      const f = readFilter();
      const ws = Engine.filterSessions(S, f);
      const active = !!(String(f.q).trim() || f.from || f.to);
      $("#hist-count", head).textContent = active ? `${ws.length} of ${total} sessions` : `${total} ${pl(total, "session")}`;
      list.innerHTML = "";
      if (!ws.length) {
        list.append(el("p", { class: "muted pad" }, total ? "No sessions match the filter." : "No sessions logged yet."));
        return;
      }
      ws.forEach((w) => list.append(sessionCard(w)));
    };

    // every control does something; emptying them restores the full list
    $("#hist-q", head).addEventListener("input", paint);
    $("#hist-from", head).addEventListener("change", paint);
    $("#hist-to", head).addEventListener("change", paint);
    $("#hist-clear", head).addEventListener("click", () => {
      $("#hist-q", head).value = ""; $("#hist-from", head).value = ""; $("#hist-to", head).value = "";
      paint();
    });
    $("#hist-notes", head).addEventListener("click", () => {
      // exactly what is shown: the same filter drives the export
      copyNoteText(Engine.exportNotesShorthand(S, readFilter()), "Copied every session shown, in your notes format");
    });
    paint();
  }

  function setText(s, mode) {
    // the set type is shown, not hidden: a drop set or a failure set has to be
    // readable in history, or the fact was only ever collected to sit unread.
    const ty = s.ty === "drop" ? "DROP " : s.ty === "failure" ? "FAIL " : "";
    const rpe = s.rpe ? `@${s.rpe}` : "";
    if (mode === "weight_reps") return `${ty}${fmtW(U.w(Engine.num(s.w)))}×${s.r ?? "?"}${rpe}`;
    if (mode === "reps") return `${ty}${s.r ?? "?"} reps${rpe}`;
    if (mode === "time") return `${ty}${s.t ?? "?"}s${rpe}`;
    if (mode === "weight_time") return `${ty}${fmtW(U.w(Engine.num(s.w)))}×${s.t ?? "?"}s${rpe}`;
    if (mode === "distance_time") return `${ty}${fmt(Engine.num(s.d))}m ${s.t ? s.t + "s" : ""}${rpe}`;
    if (mode === "weight_distance") return `${ty}${fmtW(U.w(Engine.num(s.w)))}×${fmt(Engine.num(s.d))}m${rpe}`;
    return "";
  }

  /* ================= library ================= */
  function renderLibrary(host) {
    const head = el("section", { class: "card" });
    head.innerHTML = `
      <div class="card-head"><h3>Exercise library</h3><span class="muted">${allExercises().length} movements</span></div>
      <div class="row">
        <input class="inp" id="lb-q" placeholder="Search…">
        <select class="mini" id="lb-cat"><option value="">All categories</option>
          ${["Chest", "Back", "Shoulders", "Arms", "Legs", "Calves", "Abs", "Cardio", "Other"].map((c) => `<option>${c}</option>`).join("")}</select>
        <select class="mini" id="lb-eq"><option value="">All equipment</option>
          ${["Barbell", "Dumbbell", "Cable", "Machine", "Bench", "Kettlebell", "Bodyweight", "Band"].map((c) => `<option>${c}</option>`).join("")}</select>
      </div>
      <div class="row" id="lb-progress"></div>`;
    host.append(head);
    const prog = $("#lb-progress", head);
    Engine.trainedExerciseIds(S, 3650).slice(0, 40).forEach((id) => {
      const b = Engine.bestFor(S, id);
      if (!b.date) return;
      prog.append(el("button", { class: "chip btnlike", onclick: () => exDetail(id) }, `${esc(Engine.exName(S, id))} · ${bestLabel({ best: b, mode: b.mode })}`));
    });

    const list = el("div", { class: "lib-list" });
    host.append(list);
    const paint = () => {
      const res = searchExercises($("#lb-q").value, { cat: $("#lb-cat").value, eq: $("#lb-eq").value, limit: 120 });
      list.innerHTML = "";
      res.forEach((x) => {
        const row = el("div", { class: "lib-row" },
          `<span class="lib-name">${esc(x.n)}</span>
           <span class="lib-meta muted">${esc(x.c)} · ${(x.e || [])[0] ? esc(x.e[0]) : "bodyweight"} · ${x.m.replace("_", "×")}</span>`);
        row.addEventListener("click", () => exDetail(x.id));
        list.append(row);
      });
    };
    $("#lb-q", head).addEventListener("input", paint);
    $("#lb-cat", head).addEventListener("change", paint);
    $("#lb-eq", head).addEventListener("change", paint);
    paint();
  }

  /* A target is only given an ETA when a real trend exists to extrapolate from;
     otherwise it says which piece is missing rather than inventing a date. */
  function targetProgressLine(id) {
    const tp = Engine.targetProgress(S, id);
    if (!tp) return "";
    const unit = Engine.exMode(S, id) === "weight_reps" ? " " + U.label() + " e1RM" : "";
    const cur = fmtW(U.w(tp.current));
    const tgt = fmtW(U.w(tp.target));
    const eta = tp.eta != null ? ` · ~${tp.eta} week${tp.eta === 1 ? "" : "s"} at your logged rate` : ` · ${tp.basis}`;
    const cls = tp.pct >= 100 ? "up" : "";
    return `<p class="target-line ${cls}">Target <b>${tgt}${unit}</b> · now <b>${cur}</b> (${Math.round(tp.pct)}%)${esc(eta)}</p>`;
  }

  function exDetail(id) {
    const info = findEx(id) || { n: Engine.exName(S, id), c: "", e: [], p: [], s: [], m: "weight_reps", d: "" };
    const series = Engine.seriesFor(S, id);
    const best = Engine.bestFor(S, id);
    const cmp = Engine.compareLast(S, id);
    const box = el("div", { class: "detail-modal" });
    box.innerHTML = `
      <h3>${esc(info.n)}</h3>
      <p class="muted small">${esc(info.c)}${(info.e || []).length ? " · " + esc(info.e.join(", ")) : " · bodyweight"}
        ${(info.p || []).length ? " · " + esc(info.p.join(", ")) : ""}</p>
      ${info.d ? `<p class="muted small">${esc(info.d)}</p>` : ""}
      <div class="chips">
        <span class="chip">${series.length} sessions</span>
        <span class="chip">${bestLabel({ best, mode: best.mode })}</span>
        ${cmp ? `<span class="chip ${cmp.est1RM.pct > 0 ? "up" : cmp.est1RM.pct < 0 ? "down" : ""}">${cmp.est1RM.pct >= 0 ? "▲" : "▼"} ${cmp.est1RM.pct.toFixed(1)}% vs last</span>` : ""}
      </div>
      <div class="row">
        <label class="mini-lab">Effort weight
          <input class="inp num" id="dt-wt" type="number" step="0.05" min="0.6" max="1.35"
                 value="${Engine.exerciseWeight(S, id)}" style="width:78px"
                 title="How much a set of this is worth versus a baseline set. Derived from the movement itself — muscle recruitment, equipment and range. 1.00 is baseline."></label>
        <button class="btn ghost tiny" id="dt-wreset" title="Back to the derived value">Reset</button>
      </div>
      <div class="row">
        <label class="mini-lab">Track as
          <select class="mini" id="dt-mode">${["weight_reps", "reps", "time", "weight_time", "distance_time", "weight_distance"]
            .map((m) => `<option value="${m}" ${m === Engine.exMode(S, id) ? "selected" : ""}>${m.replace("_", " × ")}</option>`).join("")}</select>
        </label>
      </div>
      <div class="row">
        <label class="mini-lab">Target (${Engine.exMode(S, id) === "weight_reps" ? U.label() + " e1RM" : "best"})
          <input class="inp num" id="dt-tgt" type="number" step="any" placeholder="none"
                 value="${S.targets[id] ? fmtW(U.w(S.targets[id].value)) : ""}" style="width:96px"></label>
        <button class="btn ghost tiny" id="dt-tset">Set target</button>
        ${S.targets[id] ? `<button class="btn ghost tiny" id="dt-tclear">Clear</button>` : ""}
      </div>
      ${targetProgressLine(id)}
      ${customControlsHTML(id)}
      <div id="dt-chart" class="chart-host"></div>
      <div class="row end"><button class="btn ghost" id="dt-x">Close</button><button class="btn primary" id="dt-log">Log this now</button></div>`;
    openModal(box, "wide");
    $("#dt-x").addEventListener("click", closeModal);
    $("\#dt-mode").addEventListener("change", (e) => { setTrackMode(id, e.target.value); toast("Tracking mode updated"); render(); });
    const wt = $("#dt-wt", box);
    if (wt) wt.addEventListener("change", () => {
      const v = parseFloat(wt.value);
      if (!isFinite(v) || v <= 0) { Store.setOverride(id, { weight: null }); toast("Effort weight reset to the derived value"); }
      else { Store.setOverride(id, { weight: Math.max(0.6, Math.min(1.35, v)) }); toast("Effort weight set", "good"); }
      render();
    });
    const wr = $("#dt-wreset", box);
    if (wr) wr.addEventListener("click", () => { Store.setOverride(id, { weight: null }); toast("Effort weight reset"); render(); });
    const tset = $("#dt-tset", box);
    if (tset) tset.addEventListener("click", () => {
      const raw = $("#dt-tgt", box).value;
      const disp = parseFloat(raw);
      if (!disp) { Store.clearTarget(id); toast("Target cleared"); closeModal(); render(); return; }
      Store.setTarget(id, U.wi(disp));        // store kg, show display units
      toast("Target set", "good"); closeModal(); render();
    });
    const tclr = $("#dt-tclear", box);
    if (tclr) tclr.addEventListener("click", () => { Store.clearTarget(id); toast("Target cleared"); closeModal(); render(); });
    const rn = $("#dt-rename", box);
    if (rn) rn.addEventListener("click", () => {
      const cur = (findEx(id) || {}).n || "";
      const nn = window.prompt("Rename exercise", cur);
      if (nn == null) return;
      if (!renameCustomEx(id, nn)) { toast("Enter a name", "warn"); return; }
      toast("Renamed", "good"); closeModal(); render();
    });
    const dl = $("#dt-del", box);
    if (dl) dl.addEventListener("click", () => {
      const nm = (findEx(id) || {}).n || "this exercise";
      if (!confirm(`Delete "${nm}"? Its logged sets stay in your history, but it will no longer appear in the exercise list or count toward your muscle-group analysis.`)) return;
      deleteCustomEx(id); toast("Deleted", "warn"); closeModal(); render();
    });
    $("#dt-log").addEventListener("click", () => { closeModal(); draft = draft || newDraft(); addEntry({ id, n: info.n }); setView("log"); });
    const chartHost = $("#dt-chart", box);
    const pts = series.filter((p) => (Engine.exMode(S, id) === "weight_reps" ? p.est1RM : p.top) > 0)
      .map((p) => ({ x: p.date, y: Engine.exMode(S, id) === "weight_reps" ? U.w(p.est1RM) : p.top }));
    Chart.line(chartHost, { points: pts, color: "#58c8f8", unit: Engine.exMode(S, id) === "weight_reps" ? " " + U.label() + " e1RM" : "" });
  }

  /* ================= updates ================= */
  function showUpdatePrompt(r) {
    const box = el("div", { class: "update-box" });
    box.innerHTML = `
      <h3>Update available</h3>
      <p class="muted small">v${esc(r.installed.versionName)} → <b>v${esc(r.versionName)}</b>${r.sizeMB ? ` · ${r.sizeMB} MB` : ""}</p>
      ${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      <div class="up-progress" id="up-prog" hidden><i id="up-bar"></i><span id="up-pct">0%</span></div>
      <div class="row end"><button class="btn ghost" id="up-later">Later</button><button class="btn primary" id="up-go">Download &amp; install</button></div>`;
    openModal(box, "narrow");
    $("#up-later").addEventListener("click", closeModal);
    $("#up-go").addEventListener("click", async () => {
      const prog = $("#up-prog"), bar = $("#up-bar"), pct = $("#up-pct");
      prog.hidden = false; $("#up-go").disabled = true;
      try {
        // Snapshot the history BEFORE the installer runs. Installing must never
        // be able to cost the user their data, and this is the copy that survives
        // even if the update wipes the WebView store. Never let a snapshot
        // failure block the update - it is a safety net, not a prerequisite.
        try { await Store.snapshotPreUpdate(); }
        catch (e) { console.warn("pre-update snapshot failed:", e && e.message); }
        await Updater.install(r, (p) => { bar.style.width = p + "%"; pct.textContent = p + "%"; });
        closeModal();
        toast("Downloaded and verified — follow the installer prompt", "good", 5000);
      } catch (e) {
        const msg = String((e && e.message) || e);
        if (/NOT_ALLOWED_TO_INSTALL/.test(msg)) {
          const p2 = el("div", { class: "update-box" },
            `<h3>Allow installs</h3>
             <p class="muted small">Android needs permission for this app to install updates. Open the setting, allow it for Iron Ledger, then try again.</p>
             <div class="row end"><button class="btn ghost" id="up-x">Close</button><button class="btn primary" id="up-s">Open settings</button></div>`);
          openModal(p2, "narrow");
          $("#up-x").addEventListener("click", closeModal);
          $("#up-s").addEventListener("click", () => { Updater.openInstallSettings(); closeModal(); });
        } else {
          toast("Update failed: " + msg, "warn", 6000);
        }
        $("#up-go").disabled = false;
      }
    });
  }

  /* A version we could not read is written as "unknown" rather than blanked out,
     so the reason a check went wrong is visible on the screen. */
  const instCode = (r) => {
    const c = r && r.installed && r.installed.versionCode;
    return c != null ? c : "unknown";
  };

  /* States what was actually established. "up to date" is only ever returned
     when a real comparison produced that verdict — an unreachable feed or an
     unreadable installed version reads as "couldn't check", because a silent
     false "up to date" is how a user gets stranded on an old build. */
  function updateStatusText(r) {
    if (r.state === "available") return "v" + (r.versionName || r.latest) + " available";
    if (r.state === "current") return "up to date" + (r.latest != null ? " (newest build " + r.latest + ")" : "");
    if (r.state === "unsupported") return "browser build";
    return "couldn't check — " + (r.reason || "unknown error");
  }

  /* Remember the last result: an automatic check runs at launch, before the
     Profile panel exists, so without this the panel would come up blank and the
     work of the check would be thrown away. */
  let lastUpdateResult = null;
  let lastCheckAt = 0;

  /* A quiet dot on the Profile tab. An automatic check on every launch must be
     able to say something without throwing a modal at the user each time. */
  function setUpdateBadge(on) {
    const b = document.querySelector('#tabs button[data-tab="profile"]');
    if (b) b.classList.toggle("has-update", !!on);
  }

  async function updateCheck(manual) {
    if (typeof Updater === "undefined") return null;
    const status = $("#up-status");
    if (status) status.textContent = "checking…";
    lastCheckAt = Date.now();
    let r;
    try { r = await Updater.check(); }
    catch (e) { r = { state: "unknown", reason: String((e && e.message) || e) }; }
    lastUpdateResult = r;

    if (status) status.textContent = updateStatusText(r);
    setUpdateBadge(r.state === "available");
    // auto-checks stay quiet unless there is something new; only ever prompt
    // once per version so a dismissed update does not nag on every launch
    if (r.state === "available" && (manual || Updater.offered() !== r.latest)) {
      Updater.markOffered(r.latest);
      showUpdatePrompt(r);
    } else if (manual && r.state === "current") {
      toast(`Up to date — installed build ${instCode(r)}, newest build ${r.latest}`, "good");
    } else if (manual && r.state === "unknown") {
      // never a silent "up to date": say what went wrong
      toast("Couldn't check — " + (r.reason || "unknown reason"), "warn", 6000);
    } else if (manual && r.state === "unsupported") {
      toast("This is the browser build — nothing to install.", "warn", 4000);
    }
    return r;
  }

  /* Automatic check on launch AND whenever the app returns to the foreground: a
     tracker gets left open for days, so "when it's opened" has to include
     resuming, not only a cold start. Rate-limited so flipping between apps does
     not hammer the network. */
  const AUTO_RECHECK_MS = 5 * 60 * 1000;
  function autoUpdateCheck() {
    if (typeof Updater === "undefined" || !Updater.isAndroid()) return;
    if (Date.now() - lastCheckAt < AUTO_RECHECK_MS) return;
    updateCheck(false);
  }

  /* ================= profile ================= */
  function renderProfile(host) {
    const p = S.profile;
    const c = el("section", { class: "card" });
    c.innerHTML = `
      <div class="card-head"><h3>Profile</h3></div>
      <div class="form-grid">
        <label>Name<input class="inp" id="p-name" value="${esc(p.name)}"></label>
        <label>Sex<select class="inp" id="p-sex"><option value="M" ${p.sex === "M" ? "selected" : ""}>Male</option><option value="F" ${p.sex === "F" ? "selected" : ""}>Female</option></select></label>
        <label>Height (cm)<input class="inp" id="p-h" type="number" value="${p.heightCm ?? ""}"></label>
        <label>Bodyweight (${U.label()})<input class="inp" id="p-w" type="number" step="0.1" value="${p.weightKg ? U.w(p.weightKg).toFixed(1) : ""}"></label>
        <label>Body fat %<input class="inp" id="p-bf" type="number" step="0.1" value="${p.bodyFatPct ?? ""}"></label>
        <p class="muted small grid-note">These two are read from your <b>bodyweight log</b> — editing them here records a check-in for today.</p>
        <label>Goal weight (${U.label()})<input class="inp" id="p-gw" type="number" step="0.1" value="${p.goalWeightKg ? U.w(p.goalWeightKg).toFixed(1) : ""}"></label>
        <label>Goal body fat %<input class="inp" id="p-gbf" type="number" step="0.1" min="3" max="60" value="${p.goalBodyFatPct ?? ""}"></label>
        <label>Weekly session target<input class="inp" id="p-wt" type="number" value="${p.weeklyTarget ?? 4}"></label>
        <label>Units<select class="inp" id="p-u"><option value="kg" ${U.kg ? "selected" : ""}>Kilograms</option><option value="lb" ${!U.kg ? "selected" : ""}>Pounds</option></select></label>
      </div>
      <button class="btn primary" id="p-save">Save profile</button>`;
    host.append(c);

    /* The glossary, reachable from Profile — not a sixth tab. It is the same
       js/glossary.js the terms on the dashboard open, so the wording matches. */
    const glossCard = el("section", { class: "card" });
    glossCard.innerHTML = `
      <div class="card-head"><h3>What the words mean</h3><span class="muted">plain English</span></div>
      <p class="muted small">Every term the app uses — MEV, e1RM, RPE, tonnage, deload and the rest — in plain words, with the real definition underneath for when you want it. The same explanation opens if you tap the word itself on any card.</p>
      <button class="btn" id="p-gloss">Open the glossary</button>`;
    host.append(glossCard);
    $("#p-gloss", glossCard).addEventListener("click", () => GLOSS.openAll(glossCtx()));

    const bw = el("section", { class: "card" });
    const log = [...(S.bodylog || [])].reverse().slice(0, 30);
    const bfp = Engine.bodyFatProgress(S);
    const bfReadings = (S.bodylog || []).filter((b) => Engine.num(b.bodyFatPct) > 0)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const floor = Engine.ESSENTIAL_BF[p.sex === "F" ? "F" : "M"];
    const bfBlock = (bfp || bfReadings.length >= 2) ? `
      ${bfp ? `<p class="target-line ${bfp.met ? "up" : ""}">Body-fat goal <b>${fmtW(bfp.goal)}%</b>${
        bfp.current != null
          ? ` · now <b>${fmtW(bfp.current)}%</b> (${Math.round(bfp.pct)}%)` +
            (bfp.change != null ? ` · ${bfp.change > 0 ? "+" : ""}${fmtW(bfp.change)} pts since ${bfp.from}` : "") +
            (bfp.met ? " · met" : ` · ${fmtW(Math.abs(bfp.remaining))} pts to go`)
          : " · no body-fat check-in yet"}</p>
        ${bfp.belowEssential ? `<p class="muted small">Under about ${floor}% is below the essential-fat floor — not a level anyone holds.</p>` : ""}` : ""}
      ${bfReadings.length >= 2 ? `<p class="muted small chart-cap">Body fat % over time</p><div class="chart-host" id="bf-chart"></div>` : ""}` : "";
    /* Tape measurements: same log, same place to enter them, shown as a trend
       and as the latest figure. Each series is one measurement, in the user's
       unit; the engine holds the canonical cm. */
    const measSeries = Engine.MEASURES.map((m) => ({
      label: m.label, color: m.color,
      points: Engine.bodyMeasureSeries(S, m.key).map((pt) => ({ x: pt.date, y: U.len(pt.value) })),
    }));
    const measShown = measSeries.some((s) => s.points.length >= 2);
    const latestMeas = Engine.MEASURES.map((m) => ({ m, last: Engine.bodyMeasureLatest(S, m.key) })).filter((x) => x.last);
    const measBlock = (measShown || latestMeas.length) ? `
      ${measShown ? `<p class="muted small chart-cap">Measurements over time (${U.llab()})</p><div class="chart-host" id="meas-chart"></div>` : ""}
      ${latestMeas.length ? `<p class="muted small">Latest: ${latestMeas.map((x) => `${x.m.label} ${fmtW(U.len(x.last.value))} ${U.llab()}`).join(" · ")}</p>` : ""}` : "";
    bw.innerHTML = `
      <div class="card-head"><h3>Bodyweight log</h3><span class="muted">${(S.bodylog || []).length} check-ins</span></div>
      <div class="row"><input class="inp" type="date" id="b-date" value="${today()}" style="max-width:160px">
        <input class="inp" id="b-w" type="number" step="0.1" placeholder="Weight (${U.label()})" style="max-width:140px">
        <input class="inp" id="b-bf" type="number" step="0.1" placeholder="Body fat %" style="max-width:130px">
        ${Engine.MEASURES.map((m) => `<input class="inp meas" data-mkey="${m.key}" type="number" step="0.1" placeholder="${m.label} (${U.llab()})" style="max-width:130px">`).join("")}
        <button class="btn" id="b-add">Log</button></div>
      ${bfBlock}
      ${measBlock}
      <div class="chart-host" id="bw-chart"></div>
      <div class="bw-list">${log.map((b) => `<div class="pr-row"><span>${b.date}</span><span>${fmtW(U.w(b.weightKg))} ${U.label()}</span><span class="muted">${[b.bodyFatPct ? b.bodyFatPct + "%" : "", ...Engine.MEASURES.filter((m) => Engine.num(b[m.key]) > 0).map((m) => `${m.label} ${fmtW(U.len(Engine.num(b[m.key])))}${U.llab()}`)].filter(Boolean).join(" · ")}</span><button class="btn ghost tiny bdel" data-d="${b.date}">✕</button></div>`).join("")}</div>`;
    host.append(bw);
    Chart.line($("#bw-chart", bw), { points: (S.bodylog || []).map((b) => ({ x: b.date, y: U.w(b.weightKg) })), color: "#a878f8", unit: " " + U.label() });
    const bfHost = $("#bf-chart", bw);
    if (bfHost) Chart.line(bfHost, { points: bfReadings.map((b) => ({ x: b.date, y: Engine.num(b.bodyFatPct) })), color: "#e878a8", unit: "%", fillArea: false });
    const measHost = $("#meas-chart", bw);
    if (measHost) Chart.multi(measHost, { series: measSeries, fixedMax: 0, unit: " " + U.llab() });

    const upd = el("section", { class: "card" });
    upd.innerHTML = `
      <div class="card-head"><h3>App updates</h3><span class="muted" id="up-status"></span></div>
      <p class="muted small">Checked automatically whenever the app opens. Nothing about your training is ever uploaded.</p>
      <div class="row"><button class="btn" id="up-check">Check for updates</button><span class="muted small" id="up-version"></span></div>`;
    host.append(upd);
    // show the result of the automatic check that already ran at launch
    if (lastUpdateResult) {
      const st = $("#up-status", upd);
      if (st) st.textContent = updateStatusText(lastUpdateResult);
    }
    $("#up-check", upd).addEventListener("click", () => updateCheck(true));
    if (typeof Updater !== "undefined") Updater.installed().then((i) => {
      const v = $("#up-version", upd);
      if (v) v.textContent = i
        ? `installed v${i.versionName || "?"} (build ${i.versionCode != null ? i.versionCode : "unknown"})`
        : "browser build — nothing to install";
    });

    const data = el("section", { class: "card" });
    data.innerHTML = `
      <div class="card-head"><h3>Your data</h3><span class="muted">local-first — nothing leaves this device</span></div>
      <p class="muted small">Kept on this device only — a working copy, a rolling backup, and a mirror in app storage. An export is the one copy that survives a lost or wiped phone, so take one now and then.</p>
      <div class="row">
        <button class="btn" id="d-exp">Export JSON</button>
        <button class="btn" id="d-csv">Export CSV</button>
        <button class="btn" id="d-imp">Import JSON (merge)</button>
        <button class="btn danger" id="d-replace" title="Discard everything here and load a clean export over it">Restore from file (replace all)</button>
        ${Store.hasBackup() ? `<button class="btn ghost" id="d-bak">Restore last backup</button>` : ""}
        <button class="btn danger" id="d-reset">Reset everything</button>
      </div>
      ${shouldShowSeed() ? `<div class="row"><button class="btn ghost" id="d-seed">Load my 7 Nov session</button></div>` : ""}`;
    host.append(data);

    $("#p-save", c).addEventListener("click", () => {
      const g = (id) => $(id).value;
      const before = Engine.summary(S);      // level/title before this save, for the celebration
      p.name = g("#p-name"); p.sex = g("#p-sex");
      p.heightCm = parseFloat(g("#p-h")) || null;
      // Weight and body fat are not stored on the profile directly — they are
      // logged. Saving here records today's check-in, so there is exactly one
      // place a measurement lives and the two screens cannot disagree.
      const wKg = g("#p-w") ? U.wi(parseFloat(g("#p-w"))) : null;
      const bfPct = g("#p-bf") ? parseFloat(g("#p-bf")) : null;
      if (wKg) {
        // Merge over today's existing check-in rather than replacing it, so
        // re-saving the profile never wipes a measurement logged earlier today.
        const prev = (S.bodylog || []).find((b) => b.date === today()) || {};
        Store.addBodyLog(Object.assign({}, prev, { date: today(), weightKg: wKg, bodyFatPct: bfPct || prev.bodyFatPct || null }));
      } else {
        p.weightKg = null;
        if (bfPct) p.bodyFatPct = bfPct;
      }
      p.goalWeightKg = g("#p-gw") ? U.wi(parseFloat(g("#p-gw"))) : null;
      const gbf = parseFloat(g("#p-gbf"));
      p.goalBodyFatPct = isFinite(gbf) && gbf > 0 ? Math.max(1, Math.min(70, gbf)) : null;
      p.weeklyTarget = parseInt(g("#p-wt"), 10) || 4;
      p.units = g("#p-u");
      Store.save(true);
      // Factual, and only when it applies: a body-fat target under the essential
      // floor is not a target anyone can hold, so say so rather than accept it.
      if (Engine.belowEssentialBF(p.goalBodyFatPct, p.sex)) {
        toast(`Goal saved — but under about ${Engine.ESSENTIAL_BF[p.sex === "F" ? "F" : "M"]}% is below the essential-fat floor and can't be held long.`, "warn", 9000);
      } else {
        toast(wKg ? "Saved — recorded a check-in for today" : "Profile saved", "good");
      }
      render();
      if (wKg) awardBadges(before);       // a logged check-in can earn a badge
    });
    $("#b-add", bw).addEventListener("click", () => {
      const date = $("#b-date", bw).value;
      // Merge over any check-in already on that date, so logging a tape
      // measurement does not erase a weight (or vice versa) taken the same day.
      const prev = (S.bodylog || []).find((b) => b.date === date) || {};
      const entry = Object.assign({}, prev, { date });
      const w = parseFloat($("#b-w", bw).value);
      if (w) entry.weightKg = U.wi(w);
      const bf = parseFloat($("#b-bf", bw).value);
      if (bf) entry.bodyFatPct = bf;
      $$(".meas", bw).forEach((i) => { const v = parseFloat(i.value); if (isFinite(v) && v > 0) entry[i.dataset.mkey] = U.li(v); });
      const any = Engine.num(entry.weightKg) > 0 || Engine.num(entry.bodyFatPct) > 0
        || Engine.MEASURES.some((m) => Engine.num(entry[m.key]) > 0);
      if (!any) { toast("Enter a weight or a measurement", "warn"); return; }
      const before = Engine.summary(S);
      Store.addBodyLog(entry);
      toast("Check-in logged", "good"); render();
      awardBadges(before);
    });
    $$(".bdel", bw).forEach((b) => b.addEventListener("click", () => { Store.deleteBodyLog(b.dataset.d); render(); }));
    $("#d-exp", data).addEventListener("click", () => download("iron-ledger-" + today() + ".json", Store.exportJSON(), "application/json"));
    $("#d-csv", data).addEventListener("click", () => download("iron-ledger-" + today() + ".csv", Store.exportCSV(), "text/csv"));
    $("#d-imp", data).addEventListener("click", () => pickImport("merge"));
    $("#d-replace", data).addEventListener("click", () => pickImport("replace"));
    const bak = $("#d-bak", data); if (bak) bak.addEventListener("click", () => {
      // This replaces everything currently in the app with an older snapshot.
      if (!confirm("Replace everything with the previous backup? Current data will be discarded.")) return;
      if (Store.loadBackup()) { toast("Backup restored", "good"); render(); }
    });
    $("#d-reset", data).addEventListener("click", () => {
      if (confirm("Delete all workouts, logs and profile on this device? Export first if unsure.")) { Store.reset(); S = Store.state; draft = null; toast("Reset", "warn"); render(); }
    });
    const seed = $("#d-seed", data); if (seed) seed.addEventListener("click", () => { seedData(); render(); });
  }

  function seedData() {
    (SEED_CUSTOM || []).forEach((c) => { if (!findEx(c.id)) Store.addCustom(c); });
    if (!S.workouts.find((w) => w.id === SEED_WORKOUT.id)) Store.upsertWorkout(JSON.parse(JSON.stringify(SEED_WORKOUT)));
    S.settings.seeded = true; Store.save(true); buildIndex();
    toast("Loaded your 7 Nov session", "good");
  }

  /* Pick a JSON file and import it, either merged (additive) or replacing
     everything. Replace is confirm-guarded with the exact losses spelled out. */
  function pickImport(mode) {
    const inp = el("input", { type: "file", accept: ".json,application/json" });
    inp.addEventListener("change", () => {
      const f = inp.files[0]; if (!f) return;
      if (mode === "replace" && !confirm(replaceImportWarning())) return;
      const r = new FileReader();
      r.onload = () => {
        try { importData(r.result, mode); toast(mode === "replace" ? "Restored — replaced with the file" : "Imported (merged)", "good"); }
        catch (e) { toast("Bad file", "warn"); }
      };
      r.readAsText(f);
    });
    inp.click();
  }

  /* An <a download> of a blob URL is a NO-OP inside a WebView: no download is
     started, and nothing is registered to catch one. On Android the export
     therefore goes through the native bridge, which writes a real file into
     app storage and offers to send it off-device — that second half is the part
     that makes a backup survive a lost phone. The blob path stays for the browser
     build, where it genuinely works. */
  async function download(name, text, type) {
    const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.AppUpdater;
    if (P && P.exportFile) {
      try {
        const r = await P.exportFile({ name, data: text, mime: type });
        toast("Saved to app storage — pick where to send it", "good", 6000);
        return r;
      } catch (e) {
        toast("Export failed: " + ((e && e.message) || e), "warn", 7000);
        return null;
      }
    }
    const b = new Blob([text], { type });
    const a = el("a", { href: URL.createObjectURL(b), download: name });
    document.body.append(a); a.click(); a.remove();
    toast("Downloaded " + name);
    return null;
  }

  /* ================= boot ================= */
  function boot() {
    // A save that fails (storage full) leaves the screen showing data that is not
    // on disk. Say so immediately instead of finding out after a crash.
    if (typeof Store !== "undefined" && Store.setSaveErrorHandler) {
      Store.setSaveErrorHandler(() => toast("Storage is full — that change may not have been saved. Export a backup.", "warn", 9000));
    }
    buildIndex();
    // sets logged before bodyweight scoring existed carry no stamp; fix them once
    // on load so a weighted crunch is not scored as though the body weighed nothing
    try { if (Engine.backfillBodyweight(S) > 0) Store.save(true); } catch (e) { console.warn("bodyweight backfill", e); }
    /* No auto-seeding. This used to insert a real session on first run, so a
       brand-new account's charts, XP, badges, muscle bars and Discipline all
       counted a workout the user never did — data they did not enter, presented
       as their own. The Profile button "Load my 7 Nov session" is shown whenever
       that session is not already logged (shouldShowSeed), so it is reachable on
       purpose and never imposed. The seeded flag is still set so nothing here
       ever auto-inserts. */
    if (!S.settings.seeded) { S.settings.seeded = true; Store.save(true); }
    // award anything already earned (matters after a restore or import)
    const earned = Engine.newAchievements(S);
    if (earned.length) Store.unlock(earned);
    $$("#tabs button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.tab)));
    $("#btn-units").addEventListener("click", () => {
      S.profile.units = U.kg ? "lb" : "kg"; Store.save(true); toast("Units: " + U.label()); render();
    });
    if (!S.profile.weightKg) {
      setTimeout(() => toast("Add your bodyweight in Profile — it makes Strength scores real", "warn", 6000), 900);
    }
    render();                       // paint FIRST — nothing below is allowed to gate it
    /* First-run walkthrough. AFTER the first paint, so a modal overlay lands on an
       already-drawn dashboard and can never delay or blank the UI. It is opened
       only when this build's version has not been recorded in
       S.settings.welcomeSeenVersion — a missing flag means "show it", which is
       exactly why an existing install sees it once on this update and a fresh
       install sees it once too. No migration backfills that flag, on purpose. */
    if (typeof Welcome !== "undefined") {
      try {
        Welcome.maybeOpen({ state: S, store: Store, doc: document, el, open: openModal, close: closeModal, toast });
      } catch (e) { console.warn("welcome skipped:", e && e.message); }
    }
    recoverFromDeviceStorage();     // fire and forget
    // update check last, delayed, and Android-only: it must never delay the UI
    setTimeout(autoUpdateCheck, 1500);
  }

  /* Android: localStorage is the working copy, the on-device mirror is the
     safety net. This must run AFTER the first paint and must never block it.
     The Capacitor bridge is not ready at DOMContentLoaded, so awaiting a plugin
     call there never settles and the app renders a blank screen with no error —
     which is exactly what shipped in the first build. */
  function recoverFromDeviceStorage() {
    if (typeof Native === "undefined" || !Native.available) return;
    let done = false;
    const attempt = async () => {
      if (done) return;
      done = true;
      try {
        const src = await Store.recover();
        if (src) {
          toast("Recovered your data from the " + src, "good", 4500);
          render();
        }
      } catch (e) { console.warn("device restore skipped:", e && e.message); }
      // A dated backup, at most once a day, ONLY after recovery has run — so it
      // can never capture an unrecovered (empty) state.
      try { await Store.autoBackup(); }
      catch (e) { console.warn("auto backup skipped:", e && e.message); }
    };
    document.addEventListener("deviceready", attempt, { once: true });
    setTimeout(attempt, 1200);      // deviceready may already have fired
  }
  document.addEventListener("DOMContentLoaded", boot);

  /* Coming back to the app is "opening" it too — a phone keeps it resident for
     days, so a cold-start-only check could miss several releases. */
  document.addEventListener("visibilitychange", () => {
    if (!document.visibilityState || document.visibilityState === "visible") autoUpdateCheck();
  });

  /* Android hardware back / edge-swipe: close the top surface, else let the
     OS exit. Must return a real boolean — the native callback compares it. */
  window.__back = function () {
    const modal = document.getElementById("modal");
    if (modal && !modal.classList.contains("hidden")) {
      // The walkthrough closing any way must record the version, and the hardware
      // back button is a route out of it — so route it through the tour's own
      // dismiss rather than closing the modal underneath it.
      if (typeof Welcome !== "undefined" && Welcome.isActive()) Welcome.dismiss();
      else closeModal();
      return true;
    }
    if (view !== "dash") { setView("dash"); return true; }
    return false;
  };
  // parseSet/parseNotes are exposed so the test suite can exercise the real
  // parsing path rather than a copy of it — the lb/kg bug lived exactly here.
  window.App = { render, setView, Store, Engine, seedData, parseSet, parseNotes, U, buildIndex, openModal, closeModal, toast, setTrackMode,
    celebrate, awardBadges, saveDraft, weekProgress, weekHudText, weekChipText,
    isCustomEx, renameCustomEx, deleteCustomEx, customControlsHTML, importData, replaceImportWarning, shouldShowSeed,
    Welcome: (typeof Welcome !== "undefined" ? Welcome : undefined) };
})();
