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
  };

  let S = Store.state;
  let view = "dash";
  let draft = null;          // workout being logged
  let libIndex = null;

  /* ================= toasts ================= */
  function toast(msg, kind = "", ms = 2600) {
    const t = el("div", { class: "toast " + kind }, msg);
    $("#toasts").append(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
  }

  /* ================= modal ================= */
  function openModal(node, cls = "") {
    const box = $("#modal-box");
    box.className = "modal-box " + cls;
    box.innerHTML = "";
    box.append(node);
    $("#modal").classList.remove("hidden");
  }
  const closeModal = () => $("#modal").classList.add("hidden");
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

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
  /* Understands the notes-app shorthand: 100x10, 100 x 10 @8, 60s, 1:30, 5km 24:00 */
  function parseSet(text, mode) {
    const t = text.trim().toLowerCase().replace(/×/g, "x");
    if (!t) return null;
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

    if (mode === "time") {
      const s = clockM ? secs(clockM) : num(body.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs)?\s*$/));
      return s ? { t: s, rpe, rest } : null;
    }
    if (mode === "reps") {
      const r = num(body.match(/^(\d+(?:\.\d+)?)/));
      return r ? { r, rpe, rest } : null;
    }
    if (mode === "distance_time") {
      const kmM = body.match(/(\d+(?:\.\d+)?)\s*km/), mM = body.match(/(\d+(?:\.\d+)?)\s*m\b/);
      const d = kmM ? parseFloat(kmM[1]) * 1000 : mM ? parseFloat(mM[1]) : undefined;
      const time = clockM ? secs(clockM) : num(body.match(/(\d+(?:\.\d+)?)\s*(?:min|m(?:in)?s?)$/));
      const tt = clockM ? secs(clockM) : (time !== undefined && !kmM && !mM ? undefined : time);
      return { d, t: clockM ? secs(clockM) : tt, rpe, rest };
    }
    if (mode === "weight_time") {
      const w = num(body.match(/^(\d+(?:\.\d+)?)/));
      const s = clockM ? secs(clockM) : num(body.match(/[x*]\s*(\d+(?:\.\d+)?)/)) ?? num(body.match(/(\d+(?:\.\d+)?)\s*(?:s|sec)/));
      return w ? { w, t: s, rpe, rest } : null;
    }
    if (mode === "weight_distance") {
      const w = num(body.match(/^(\d+(?:\.\d+)?)/));
      const d = num(body.match(/[x*]\s*(\d+(?:\.\d+)?)/)) ?? num(body.match(/(\d+(?:\.\d+)?)\s*m/));
      return w ? { w, d, rpe, rest } : null;
    }
    // weight_reps
    const m = body.match(/^(\d+(?:\.\d+)?)\s*(?:kg|lb|#)?\s*[x*\/\s]\s*(\d+(?:\.\d+)?)/);
    if (m) return { w: parseFloat(m[1]), r: parseFloat(m[2]), rpe, rest };
    const one = body.match(/^(\d+(?:\.\d+)?)/);
    if (one) return { w: parseFloat(one[1]), r: undefined, rpe, rest };
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

  function renderHUD() {
    const s = Engine.summary(S);
    $("#hud-level").innerHTML = `<b>Lv ${s.level.level}</b> <span class="muted">${esc(s.title)}</span>`;
    $("#hud-xpbar").style.width = s.level.pct + "%";
    $("#hud-streak").innerHTML = s.streak.days > 0 ? `🔥 <b>${s.streak.days}d</b>` : `<span class="muted">no streak</span>`;
    $("#btn-units").textContent = U.label().toUpperCase();
  }

  /* ================= dashboard ================= */
  function renderDash(host) {
    const s = Engine.summary(S);
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
            <span class="chip">${fmt(s.tonnage / 1000, 1)} t lifted</span>
            ${s.density ? `<span class="chip">${s.density}% work time</span>` : ""}
            <span class="chip">${s.streak.days}d streak</span>
            <span class="chip">${s.prs} ${pl(s.prs, "PR")} this month</span>
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
         <span class="attr-name">${a.label}</span>
         <span class="attr-tier">${d.tier}</span>
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

    /* attribute detail */
    const det = el("section", { class: "card" });
    det.innerHTML = `<div class="card-head"><h3>What the numbers mean</h3></div>`;
    const dl = el("div", { class: "detail-grid" });
    Engine.ATTRIBUTES.forEach((a) => {
      const d = attrs[a.key];
      dl.append(el("div", { class: "detail" },
        `<h4 style="color:${a.color}">${a.label} <span class="muted">${d.score}</span></h4>
         <p>${attrExplain(a.key, d)}</p>`));
    });
    det.append(dl);
    host.append(det);

    /* muscle balance */
    const mb = el("section", { class: "card chart-card" });
    mb.innerHTML = `<div class="card-head"><h3>Muscle balance</h3><span class="muted">working sets per week</span></div>`;
    const mbHost = el("div", { class: "radar-host" });
    mb.append(mbHost);
    const mlist = el("div", { class: "attr-legend" });
    Engine.GROUP_ORDER.forEach((g) => {
      const m = mg[g];
      mlist.append(el("div", { class: "attr-row mrow" },
        `<span class="attr-name">${g}</span>
         <span class="attr-tier status-${m.status.replace(/[^a-z]/gi, "")}">${m.status}</span>
         <span class="attr-score">${m.setsPerWk}/wk</span>`));
    });
    mb.append(mlist);
    const barHost = el("div", { class: "bar-host" });
    mb.append(barHost);
    host.append(mb);
    Chart.radar(mbHost, {
      title: "muscles", fill: "#ffd166",
      axes: Engine.GROUP_ORDER.map((g) => ({ label: g, value: mg[g].score, tier: mg[g].setsPerWk + "/wk", valText: "", color: "#f8d030" })),
    });
    Chart.bars(barHost, {
      unit: "",
      items: Engine.GROUP_ORDER.map((g) => ({ label: g, value: mg[g].setsPerWk, status: mg[g].status, marker: mg[g].landmarks.mev })),
    });

    /* weak points */
    const wp = el("section", { class: "card" });
    wp.innerHTML = `<div class="card-head"><h3>Weak points &amp; next moves</h3></div>`;
    if (!weak.length) wp.append(el("p", { class: "muted" }, "Nothing flagged — balance looks good. Keep progressing the big lifts."));
    weak.forEach((w) => {
      wp.append(el("div", { class: "weak " + w.severity },
        `<div class="weak-h"><span class="sev ${w.severity}">${w.severity === "high" ? "!" : w.severity === "med" ? "•" : "·"}</span> ${esc(w.title)}</div>
         <p class="muted">${esc(w.detail)}</p>
         <p class="fix">→ ${esc(w.fix)}</p>`));
    });
    host.append(wp);

    /* gamification */
    const gam = el("section", { class: "card" });
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

  function bestLabel(r) {
    const b = r.best;
    if (!b || !b.date) return "—";
    if (b.mode === "weight_reps") return `${fmt(U.w(b.est1RM))} ${U.label()} e1RM`;
    if (b.mode === "reps") return `${b.reps} reps`;
    if (b.mode === "time") return `${b.time}s hold`;
    if (b.mode === "distance_time") return `${fmt(b.dist / 1000, 2)} km`;
    return "—";
  }

  function attrExplain(key, d) {
    const x = d.detail;
    switch (key) {
      case "STR": return x.basis === "standards"
        ? `Estimated 1RM on ${x.n} core lift${x.n > 1 ? "s" : ""} vs published bodyweight standards (bodyweight ${fmt(U.w(x.bw))} ${U.label()}).`
        : x.basis === "estimated"
          ? `No free-weight core lift logged yet, so this is estimated from machine work (${esc(x.from || "—")}) and deliberately conservative. Log a barbell bench, squat or deadlift to make it real.`
          : "Log a loaded lift to start measuring strength.";
      case "END": return `Cardio ${Math.round(x.cardioMinPerWk)} min/wk · best single set ${x.maxReps} reps · ${Math.round(x.setsPerWk)} working sets/wk.`
        + (x.avgRest
            ? ` Average rest ${fmtRest(x.avgRest)} and ${x.density}% of session time actually working — short rest raises the endurance demand, which is why it counts here and nowhere else.`
            : " Log rest between sets to factor training density in; nothing else reads it.");
      case "POW": return `${x.plyoReps} explosive reps logged · ${x.heavySets} heavy low-rep sets (≤3 reps).`;
      case "MOB": return `${Math.round(x.minPerWk)} min/wk of mobility or stretching work.`;
      case "CON": return `${x.sessions} ${pl(x.sessions, "session")} in 28 days against a target of ${fmt(x.expected)} · ${x.streakDays}-day streak.`;
      case "VIT": return (x.basis && x.basis !== "no data")
        ? `Scored from ${x.basis}${x.log ? ` · ${x.log} bodyweight check-in${x.log > 1 ? "s" : ""}` : ""}.`
        : "Add bodyweight, body-fat and height in Profile to score vitality.";
      default: return "";
    }
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
          <input type="date" id="w-date" value="${draft.date}">
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
    $("#btn-save").addEventListener("click", saveDraft);
    const del = $("#btn-del"); if (del) del.addEventListener("click", () => {
      Store.deleteWorkout(draft.id); draft = newDraft(); toast("Session deleted", "warn"); render();
    });
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

    const cmpBanner = cmp ? (() => {
      const p = cmp.est1RM.pct;
      const cls = p > 0.5 ? "up" : p < -0.5 ? "down" : "flat";
      const txt = en.mode === "weight_reps"
        ? `e1RM ${fmt(U.w(cmp.est1RM.cur))} ${U.label()} vs ${fmt(U.w(cmp.est1RM.prev))} (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`
        : `volume ${fmt(cmp.volume.cur)} vs ${fmt(cmp.volume.prev)}`;
      return `<div class="cmp ${cls}">${cls === "up" ? "▲" : cls === "down" ? "▼" : "–"} ${txt} <span class="muted">· last: ${cmp.prevDate}</span></div>`;
    })() : `<div class="cmp flat">First time logging this — no comparison yet</div>`;

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
      <div class="sets" id="sets-${idx}"></div>
      <div class="entry-rest">
        <label>Rest between sets <input class="inp num rest-default" type="number" inputmode="numeric" min="0" step="5" placeholder="secs" value="${en.restDefault ?? ""}" style="width:72px"> sec</label>
        <span class="muted small">Applies to every set — blank sets fall back to it.</span>
      </div>
      <div class="quick"><input class="inp" placeholder="${quickHint(en.mode)}" data-idx="${idx}"><button class="btn ghost tiny qadd" data-idx="${idx}">Add set</button></div>
      <div class="entry-foot">
        <span>${st.sets} ${pl(st.sets, "set")}</span>
        ${st.tonnage ? `<span>${fmt(U.w(st.tonnage) / 1, 0)} ${U.label()} tonnage</span>` : ""}
        ${st.est1RM ? `<span>best e1RM <b>${fmt(U.w(st.est1RM))} ${U.label()}</b></span>` : ""}
        ${st.reps ? `<span>${st.reps} ${pl(st.reps, "rep")}</span>` : ""}
        ${st.avgRPE ? `<span>avg RPE ${st.avgRPE.toFixed(1)}</span>` : ""}
        ${st.avgRest ? `<span>rest ${fmtRest(st.avgRest)}</span>` : ""}
        <span class="muted">${prev.date ? "all-time best " + bestLabel({ best: prev, mode: en.mode }) : "first time logging this"}</span>
      </div>`;

    const setsHost = $("#sets-" + idx, card);
    en.sets.forEach((s, si) => setsHost.append(setRow(en, s, si, idx)));

    $(".mode-sel", card).addEventListener("change", (e) => {
      en.mode = e.target.value;
      if (en.id && String(en.id).length > 2) Store.setOverride(en.id, { mode: en.mode });
      render();
    });
    $(".rm", card).addEventListener("click", () => { draft.entries.splice(idx, 1); render(); });
    const qi = $(".quick .inp", card);
    const doAdd = () => {
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
    weight_reps: "e.g. 100x10  ·  80x8@9", reps: "e.g. 12  ·  15@8",
    time: "e.g. 60s  ·  1:30", weight_time: "e.g. 20x45s",
    distance_time: "e.g. 5km 24:00", weight_distance: "e.g. 24x40m",
  }[m] || "100x10");

  function setRow(en, s, si, idx) {
    const row = el("div", { class: "set-row" });
    const f = (k, ph, w = 64) => `<input class="inp num" data-k="${k}" type="number" inputmode="decimal" step="any" placeholder="${ph}" value="${s[k] ?? ""}" style="width:${w}px">`;
    let inner = `<span class="set-n">${si + 1}</span>`;
    if (en.mode === "weight_reps") inner += f("w", U.label()) + `<span class="x">×</span>` + f("r", "reps");
    else if (en.mode === "reps") inner += f("r", "reps");
    else if (en.mode === "time") inner += f("t", "secs", 84) + `<span class="unit">s</span>`;
    else if (en.mode === "weight_time") inner += f("w", U.label()) + `<span class="x">×</span>` + f("t", "secs") + `<span class="unit">s</span>`;
    else if (en.mode === "distance_time") inner += f("d", "metres", 88) + `<span class="unit">${U.dlab()}</span>` + f("t", "secs", 88) + `<span class="unit">s</span>`;
    else if (en.mode === "weight_distance") inner += f("w", U.label()) + `<span class="x">×</span>` + f("d", "metres") + `<span class="unit">${U.dlab()}</span>`;
    inner += `<span class="rpe-wrap"><input class="inp num" data-k="rpe" type="number" min="1" max="10" step="0.5" placeholder="RPE" value="${s.rpe ?? ""}" style="width:52px"></span>`;
    const restPh = en.restDefault ? String(en.restDefault) : "rest";
    inner += `<span class="rest-wrap"><input class="inp num" data-k="rest" type="number" inputmode="numeric" min="0" step="5" placeholder="${restPh}" value="${s.rest ?? ""}" style="width:56px" title="Rest after this set, in seconds. Leave blank to use the exercise default."></span>`;
    if (en.mode === "weight_reps") {
      const e1 = Engine.est1RM(Engine.num(s.w), Engine.num(s.r));
      inner += `<span class="e1">${e1 ? fmt(U.w(e1)) + " e1RM" : ""}</span>`;
    }
    inner += `<button class="btn ghost tiny x" title="remove">✕</button>`;
    row.innerHTML = inner;
    $$("input", row).forEach((inp) => inp.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
      s[k] = v;
      if (k === "w" && !U.kg) s.w = v; // raw stored in display units below
      if (k === "w" && U.kg) s.w = v;
      if (k === "w") s.w = U.wi(v);
      const e1 = $(".e1", row);
      if (e1) { const val = Engine.est1RM(Engine.num(s.w), Engine.num(s.r)); e1.textContent = val ? fmt(U.w(val)) + " e1RM" : ""; }
      updateEntryFoot(idx);
    }));
    $(".x", row).addEventListener("click", () => { en.sets.splice(si, 1); render(); });
    return row;
  }

  function updateEntryFoot(idx) {
    const en = draft.entries[idx];
    const st = Engine.entryStats(en);
    const foot = $$(".card.entry")[idx] && $(".entry-foot", $$(".card.entry")[idx]);
    if (!foot) return;
    foot.innerHTML = `<span>${st.sets} ${pl(st.sets, "set")}</span>
      ${st.tonnage ? `<span>${fmt(U.w(st.tonnage))} ${U.label()} tonnage</span>` : ""}
      ${st.est1RM ? `<span>best e1RM <b>${fmt(U.w(st.est1RM))} ${U.label()}</b></span>` : ""}
      ${st.reps ? `<span>${st.reps} ${pl(st.reps, "rep")}</span>` : ""}
      ${st.avgRPE ? `<span>avg RPE ${st.avgRPE.toFixed(1)}</span>` : ""}
      ${st.avgRest ? `<span>rest ${fmtRest(st.avgRest)}</span>` : ""}`;
  }

  function saveDraft() {
    const entries = draft.entries
      .map((en) => ({ ...en, sets: en.sets.filter((s) => Object.values(s).some((v) => v !== undefined && v !== null && v !== "")) }))
      .filter((en) => en.sets.length);
    if (!entries.length) { toast("Add at least one set", "warn"); return; }
    const before = Engine.summary(S);
    const w = Store.upsertWorkout({ id: draft.id || undefined, date: draft.date, note: draft.note, entries });
    const after = Engine.summary(Store.state);
    const gained = after.xp - before.xp;
    const newB = Engine.newAchievements(Store.state);
    Store.unlock(newB);
    draft = newDraft();
    let msg = `+${fmt(gained)} XP · ${entries.length} exercises saved`;
    if (newB.length) msg += ` · ${newB.length} badge${newB.length > 1 ? "s" : ""} unlocked!`;
    toast(msg, "good", 4200);
    if (newB.length) showBadges(newB);
    render();
  }

  function showBadges(ids) {
    const names = ids.map((id) => Engine.ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
    const box = el("div", { class: "unlock-box" });
    box.innerHTML = `<h3>★ Achievement unlocked</h3>` + names.map((a) => `<p><b>${esc(a.name)}</b> — ${esc(a.desc)}</p>`).join("");
    box.append(el("button", { class: "btn primary", onclick: closeModal }, "Nice"));
    openModal(box, "narrow");
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
  function renderHistory(host) {
    const ws = [...S.workouts].reverse();
    const head = el("section", { class: "card" });
    head.innerHTML = `<div class="card-head"><h3>History</h3><span class="muted">${ws.length} sessions</span></div>`;
    host.append(head);
    if (!ws.length) { host.append(el("p", { class: "muted pad" }, "No sessions logged yet.")); return; }
    ws.forEach((w) => {
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
          <div class="row"><button class="btn ghost tiny ed">Edit</button><button class="btn ghost tiny cp">Repeat</button></div>
        </div>
        <div class="hist-body">
          ${(w.entries || []).map((en) => {
            const s = Engine.entryStats(en);
            const setsTxt = (en.sets || []).map((x) => setText(x, en.mode)).join("  ·  ");
            const restTxt = s.avgRest ? `  ·  rest ${fmtRest(s.avgRest)}` : "";
            return `<div class="hist-ex"><span class="hist-n">${esc(en.name)}</span><span class="hist-s">${esc(setsTxt + restTxt)}</span></div>`;
          }).join("")}
        </div>`;
      $(".ed", card).addEventListener("click", () => {
        draft = JSON.parse(JSON.stringify(w));
        draft.dateTouched = true;          // editing keeps the workout's own date
        setView("log");
      });
      $(".cp", card).addEventListener("click", () => {
        draft = { id: null, date: today(), note: w.note || "", entries: JSON.parse(JSON.stringify(w.entries)), dateTouched: false };
        setView("log"); toast("Loaded into a new session");
      });
      host.append(card);
    });
  }

  function setText(s, mode) {
    const rpe = s.rpe ? `@${s.rpe}` : "";
    if (mode === "weight_reps") return `${fmt(U.w(Engine.num(s.w)))}×${s.r ?? "?"}${rpe}`;
    if (mode === "reps") return `${s.r ?? "?"} reps${rpe}`;
    if (mode === "time") return `${s.t ?? "?"}s${rpe}`;
    if (mode === "weight_time") return `${fmt(U.w(Engine.num(s.w)))}×${s.t ?? "?"}s${rpe}`;
    if (mode === "distance_time") return `${fmt(Engine.num(s.d))}m ${s.t ? s.t + "s" : ""}${rpe}`;
    if (mode === "weight_distance") return `${fmt(U.w(Engine.num(s.w)))}×${fmt(Engine.num(s.d))}m${rpe}`;
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
      const res = searchExercises($("#lb-q").value, { cat: $("#lb-cat").value, limit: 120 });
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
    paint();
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
        <label class="mini-lab">Track as
          <select class="mini" id="dt-mode">${["weight_reps", "reps", "time", "weight_time", "distance_time", "weight_distance"]
            .map((m) => `<option value="${m}" ${m === Engine.exMode(S, id) ? "selected" : ""}>${m.replace("_", " × ")}</option>`).join("")}</select>
        </label>
        <button class="btn ghost tiny" id="dt-hide">${S.overrides[id] ? "Unhide" : "Hide from lists"}</button>
      </div>
      <div id="dt-chart" class="chart-host"></div>
      <div class="row end"><button class="btn ghost" id="dt-x">Close</button><button class="btn primary" id="dt-log">Log this now</button></div>`;
    openModal(box, "wide");
    $("#dt-x").addEventListener("click", closeModal);
    $("#dt-mode").addEventListener("change", (e) => { Store.setOverride(id, { mode: e.target.value }); toast("Tracking mode updated"); render(); });
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

  async function updateCheck(manual) {
    if (typeof Updater === "undefined") return;
    const status = $("#up-status");
    if (status) status.textContent = "checking…";
    let r;
    try { r = await Updater.check(); }
    catch (e) { r = { state: "error", reason: String((e && e.message) || e) }; }

    if (status) {
      status.textContent =
        r.state === "available" ? "v" + r.versionName + " available" :
        r.state === "current" ? "up to date" :
        r.state === "unsupported" ? "browser build" :
        (r.reason || "check failed");
    }
    // auto-checks stay quiet unless there is something new; only ever prompt
    // once per version so a dismissed update does not nag on every launch
    if (r.state === "available" && (manual || Updater.offered() !== r.latest)) {
      Updater.markOffered(r.latest);
      showUpdatePrompt(r);
    } else if (manual && r.state === "current") {
      toast(`Up to date — v${r.installed.versionName} (build ${r.installed.versionCode})`, "good");
    } else if (manual && r.state === "error") {
      toast(r.reason || "Update check failed", "warn", 5000);
    }
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
        <label>Weekly session target<input class="inp" id="p-wt" type="number" value="${p.weeklyTarget ?? 4}"></label>
        <label>Units<select class="inp" id="p-u"><option value="kg" ${U.kg ? "selected" : ""}>Kilograms</option><option value="lb" ${!U.kg ? "selected" : ""}>Pounds</option></select></label>
      </div>
      <button class="btn primary" id="p-save">Save profile</button>`;
    host.append(c);

    const bw = el("section", { class: "card" });
    const log = [...(S.bodylog || [])].reverse().slice(0, 30);
    bw.innerHTML = `
      <div class="card-head"><h3>Bodyweight log</h3><span class="muted">${(S.bodylog || []).length} check-ins</span></div>
      <div class="row"><input class="inp" type="date" id="b-date" value="${today()}" style="max-width:160px">
        <input class="inp" id="b-w" type="number" step="0.1" placeholder="Weight (${U.label()})" style="max-width:140px">
        <input class="inp" id="b-bf" type="number" step="0.1" placeholder="Body fat %" style="max-width:130px">
        <button class="btn" id="b-add">Log</button></div>
      <div class="chart-host" id="bw-chart"></div>
      <div class="bw-list">${log.map((b) => `<div class="pr-row"><span>${b.date}</span><span>${fmt(U.w(b.weightKg), 1)} ${U.label()}</span><span class="muted">${b.bodyFatPct ? b.bodyFatPct + "%" : ""}</span><button class="btn ghost tiny bdel" data-d="${b.date}">✕</button></div>`).join("")}</div>`;
    host.append(bw);
    Chart.line($("#bw-chart", bw), { points: (S.bodylog || []).map((b) => ({ x: b.date, y: U.w(b.weightKg) })), color: "#a878f8", unit: " " + U.label() });

    const upd = el("section", { class: "card" });
    upd.innerHTML = `
      <div class="card-head"><h3>App updates</h3><span class="muted" id="up-status"></span></div>
      <p class="muted small">Checks a public release feed over the network. Nothing about your training is ever uploaded.</p>
      <div class="row"><button class="btn" id="up-check">Check for updates</button><span class="muted small" id="up-version"></span></div>
      <label class="mini-lab">Update feed URL
        <input class="inp" id="up-feed" value="${esc(typeof Updater !== "undefined" ? Updater.feedUrl() : "")}">
      </label>`;
    host.append(upd);
    $("#up-check", upd).addEventListener("click", () => updateCheck(true));
    $("#up-feed", upd).addEventListener("change", (e) => { Updater.setFeedUrl(e.target.value); toast("Update feed saved"); });
    if (typeof Updater !== "undefined") Updater.installed().then((i) => {
      const v = $("#up-version", upd);
      if (v) v.textContent = i ? `installed v${i.versionName} (build ${i.versionCode})` : "browser build — nothing to install";
    });

    const data = el("section", { class: "card" });
    data.innerHTML = `
      <div class="card-head"><h3>Your data</h3><span class="muted">local-first — nothing leaves this device</span></div>
      <p class="muted small">Everything is stored in this browser. Export a backup regularly — it is the only copy.</p>
      <div class="row">
        <button class="btn" id="d-exp">Export JSON</button>
        <button class="btn" id="d-csv">Export CSV</button>
        <button class="btn" id="d-imp">Import JSON</button>
        ${Store.hasBackup() ? `<button class="btn ghost" id="d-bak">Restore last backup</button>` : ""}
        <button class="btn danger" id="d-reset">Reset everything</button>
      </div>
      ${S.settings.seeded === false ? `<div class="row"><button class="btn ghost" id="d-seed">Load my 7 Nov session</button></div>` : ""}`;
    host.append(data);

    $("#p-save", c).addEventListener("click", () => {
      const g = (id) => $(id).value;
      p.name = g("#p-name"); p.sex = g("#p-sex");
      p.heightCm = parseFloat(g("#p-h")) || null;
      // Weight and body fat are not stored on the profile directly — they are
      // logged. Saving here records today's check-in, so there is exactly one
      // place a measurement lives and the two screens cannot disagree.
      const wKg = g("#p-w") ? U.wi(parseFloat(g("#p-w"))) : null;
      const bfPct = g("#p-bf") ? parseFloat(g("#p-bf")) : null;
      if (wKg) {
        Store.addBodyLog({ date: today(), weightKg: wKg, bodyFatPct: bfPct || null });
      } else {
        p.weightKg = null;
        if (bfPct) p.bodyFatPct = bfPct;
      }
      p.goalWeightKg = g("#p-gw") ? U.wi(parseFloat(g("#p-gw"))) : null;
      p.weeklyTarget = parseInt(g("#p-wt"), 10) || 4;
      p.units = g("#p-u");
      Store.save(true);
      toast(wKg ? "Saved — recorded a check-in for today" : "Profile saved", "good");
      render();
    });
    $("#b-add", bw).addEventListener("click", () => {
      const w = parseFloat($("#b-w", bw).value);
      if (!w) { toast("Enter a weight", "warn"); return; }
      Store.addBodyLog({ date: $("#b-date", bw).value, weightKg: U.wi(w), bodyFatPct: parseFloat($("#b-bf", bw).value) || null });
      toast("Check-in logged", "good"); render();
    });
    $$(".bdel", bw).forEach((b) => b.addEventListener("click", () => { Store.deleteBodyLog(b.dataset.d); render(); }));
    $("#d-exp", data).addEventListener("click", () => download("iron-ledger-" + today() + ".json", Store.exportJSON(), "application/json"));
    $("#d-csv", data).addEventListener("click", () => download("iron-ledger-" + today() + ".csv", Store.exportCSV(), "text/csv"));
    $("#d-imp", data).addEventListener("click", () => {
      const inp = el("input", { type: "file", accept: ".json,application/json" });
      inp.addEventListener("change", () => {
        const f = inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { Store.importJSON(r.result, "merge"); toast("Imported (merged)", "good"); render(); } catch (e) { toast("Bad file", "warn"); } };
        r.readAsText(f);
      });
      inp.click();
    });
    const bak = $("#d-bak", data); if (bak) bak.addEventListener("click", () => { if (Store.loadBackup()) { toast("Backup restored", "good"); render(); } });
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

  function download(name, text, type) {
    const b = new Blob([text], { type });
    const a = el("a", { href: URL.createObjectURL(b), download: name });
    document.body.append(a); a.click(); a.remove();
    toast("Downloaded " + name);
  }

  /* ================= boot ================= */
  function boot() {
    buildIndex();
    // first run: seed the example session so the app is not empty
    if (!S.settings.seeded && !S.workouts.length && typeof SEED_WORKOUT !== "undefined") seedData();
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
    recoverFromDeviceStorage();     // fire and forget
    // update check last, delayed, and Android-only: it must never delay the UI
    setTimeout(() => { if (typeof Updater !== "undefined" && Updater.isAndroid()) updateCheck(false); }, 4000);
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
        if (await Store.bootstrapNative()) {
          toast("Recovered your data from device storage", "good", 4000);
          render();
        }
      } catch (e) { console.warn("device restore skipped:", e && e.message); }
    };
    document.addEventListener("deviceready", attempt, { once: true });
    setTimeout(attempt, 1200);      // deviceready may already have fired
  }
  document.addEventListener("DOMContentLoaded", boot);

  /* Android hardware back / edge-swipe: close the top surface, else let the
     OS exit. Must return a real boolean — the native callback compares it. */
  window.__back = function () {
    const modal = document.getElementById("modal");
    if (modal && !modal.classList.contains("hidden")) { closeModal(); return true; }
    if (view !== "dash") { setView("dash"); return true; }
    return false;
  };
  window.App = { render, setView, Store, Engine, seedData };
})();
