/* engine.js — pure logic. No DOM, no storage. Everything derives from `state`.
   Design rule: every score is traceable to a number the user logged plus a
   published reference. Nothing is invented. Sources noted inline. */
const Engine = (() => {
  "use strict";

  const DAY = 86400000;

  /* ---------- radar axes ---------- */
  const ATTRIBUTES = [
    { key: "STR", label: "Strength",  sub: "max force",      color: "#ff6b6b" },
    { key: "END", label: "Stamina",   sub: "work capacity",  color: "#ffd166" },
    { key: "POW", label: "Power",     sub: "explosiveness",  color: "#ff9f43" },
    { key: "MOB", label: "Mobility",  sub: "range of motion",color: "#6ee7b7" },
    { key: "CON", label: "Discipline",sub: "consistency",    color: "#7cc6fe" },
    { key: "VIT", label: "Vitality",  sub: "body comp",      color: "#c792ea" },
  ];

  const GROUP_ORDER = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Calves", "Core"];

  /* Weekly set landmarks, sets/week (all completed sets — see entryStats).
     MEV = minimum effective volume, MAV = adaptive (sweet spot), MRV = max
     recoverable volume. Reference ranges from Renaissance Periodization's
     published volume landmark tables (Israetel et al.), mid-range values. */
  const LANDMARKS = {
    Chest:     { mev: 8,  mav: 14, mrv: 22 },
    Back:      { mev: 10, mav: 16, mrv: 25 },
    Shoulders: { mev: 8,  mav: 16, mrv: 26 },
    Arms:      { mev: 6,  mav: 12, mrv: 20 },
    Legs:      { mev: 8,  mav: 16, mrv: 24 },
    Calves:    { mev: 6,  mav: 12, mrv: 20 },
    Core:      { mev: 4,  mav: 12, mrv: 20 },
  };

  /* Strength standards: 1RM as a multiple of bodyweight at
     [Beginner, Novice, Intermediate, Advanced, Elite].
     Men's ratios: Strength Level / Brolic published tables (2026).
     Women's ratios: Brolic's stated ~80% lower-body / ~65% upper-body scaling. */
  const STANDARDS = {
    bench:   { m: [0.50, 0.75, 1.00, 1.50, 2.00], w: [0.30, 0.50, 0.75, 1.10, 1.45], up: 1 },
    squat:   { m: [0.75, 1.25, 1.50, 2.25, 2.75], w: [0.50, 0.75, 1.25, 1.75, 2.25], up: 0 },
    dead:    { m: [1.00, 1.50, 2.00, 2.75, 3.25], w: [0.75, 1.00, 1.50, 2.00, 2.50], up: 0 },
    ohp:     { m: [0.35, 0.55, 0.75, 1.05, 1.35], w: [0.20, 0.35, 0.50, 0.70, 0.95], up: 1 },
    row:     { m: [0.50, 0.75, 1.00, 1.50, 1.75], w: [0.30, 0.45, 0.70, 0.95, 1.25], up: 1 },
    clean:   { m: [0.50, 0.80, 1.10, 1.45, 1.75], w: [0.35, 0.55, 0.80, 1.05, 1.30], up: 0 },
    snatch:  { m: [0.40, 0.65, 0.90, 1.20, 1.45], w: [0.30, 0.45, 0.65, 0.85, 1.05], up: 0 },
    front:   { m: [0.60, 1.00, 1.25, 1.80, 2.20], w: [0.45, 0.70, 0.95, 1.30, 1.60], up: 0 },
    rdl:     { m: [0.75, 1.25, 1.75, 2.30, 2.75], w: [0.55, 0.90, 1.30, 1.70, 2.10], up: 0 },
    hipthr:  { m: [1.00, 1.50, 2.00, 2.75, 3.50], w: [0.75, 1.10, 1.50, 2.10, 2.60], up: 0 },
    curl:    { m: [0.20, 0.35, 0.50, 0.70, 0.90], w: [0.15, 0.25, 0.35, 0.50, 0.65], up: 1 },
    legpress:{ m: [1.00, 1.75, 2.50, 3.50, 4.25], w: [0.75, 1.25, 1.90, 2.60, 3.20], up: 0 },
  };
  /* ratio → score. Anchors map the five published tiers onto 0-100. */
  const TIER_SCORE = [30, 45, 62, 82, 96];

  const TIERS = [
    [95, "Best"], [85, "Fantastic"], [72, "Very good"], [58, "Pretty good"],
    [44, "Decent"], [28, "Not great"], [12, "Poor"], [0, "No good"],
  ];

  /* Name → standard key. Order matters: most specific first. */
  const LIFT_MATCH = [
    [/romanian deadlift|\brdl\b/i, "rdl"],
    [/hip thrust/i, "hipthr"],
    [/front squat/i, "front"],
    [/leg press/i, "legpress"],
    [/(barbell|ez[- ]?bar|dumbbell|bicep).*curl|curl.*(barbell|dumbbell)/i, "curl"],
    [/power clean|\bclean\b|hang clean/i, "clean"],
    [/snatch/i, "snatch"],
    [/deadlift/i, "dead"],
    [/bench press|chest press|incline.*press|decline.*press/i, "bench"],
    [/squat/i, "squat"],
    [/overhead press|shoulder press|military press|\bohp\b|push press/i, "ohp"],
    [/\brow\b|rowing/i, "row"],
  ];

  const CORE_EQ = ["barbell", "dumbbell", "sz-bar", "kettlebell", "pull-up bar"];

  /* ---------- tiny helpers ---------- */
  const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : parseFloat(v) || 0);
  /* Local calendar date. toISOString() is UTC, so after 19:00 EST it rolls the
     date forward and files an evening session on tomorrow's day. */
  const dstr = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const dayKey = (d) => dstr(d);
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

  function interp(x, xs, ys) {
    if (!isFinite(x) || x <= 0) return 0;
    if (x <= xs[0]) return ys[0] * (x / xs[0]);
    for (let i = 0; i < xs.length - 1; i++) {
      if (x <= xs[i + 1]) {
        const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      }
    }
    return Math.min(100, ys[ys.length - 1] + (x - xs[xs.length - 1]) * 10);
  }

  const tierOf = (s) => (TIERS.find((t) => s >= t[0]) || TIERS[TIERS.length - 1])[1];

  /* ---------- set / entry maths ---------- */
  /* Seconds of actual work per repetition. A moderate tempo is ~2s down / 1s up,
     so 3s is the standard assumption. It exists ONLY to turn reps into a
     work-time so training density can be computed; it is an estimate and is
     labelled as one wherever density is shown. */
  const REP_SECONDS = 3;

  /* Epley: 1RM ≈ w·(1 + r/30). Accurate to ~12 reps; flagged as an estimate. */
  const est1RM = (w, r) => (w > 0 && r > 0 ? w * (1 + Math.min(r, 12) / 30) : 0);

  function setVolume(s, mode) {
    switch (mode) {
      case "weight_reps":     return num(s.w) * num(s.r);
      case "reps":            return num(s.r);
      case "time":            return num(s.t);
      case "weight_time":     return num(s.w) * num(s.t);
      case "distance_time":   return num(s.d);
      case "weight_distance": return num(s.w) * num(s.d);
      default:                return num(s.w) * num(s.r);
    }
  }

  /* Every COMPLETED set counts, warm-up or not. Warm-ups are deliberately not
     marked or distinguished (the owner's call: they are just logged like anything
     else), so nothing here can tell a ramp from a top set. That is why the UI
     says "sets", never "working sets" — a working set properly excludes warm-ups,
     and claiming that precision would misstate what is actually counted. */
  
  function entryStats(entry) {
    const mode = entry.mode || "weight_reps";
    const sets = (entry.sets || []).filter((s) => {
      if (mode === "weight_reps") return num(s.w) > 0 && num(s.r) > 0;
      if (mode === "reps") return num(s.r) > 0;
      if (mode === "time") return num(s.t) > 0;
      if (mode === "distance_time") return num(s.d) > 0 || num(s.t) > 0;
      if (mode === "weight_time") return num(s.t) > 0;
      if (mode === "weight_distance") return num(s.d) > 0;
      return false;
    });
    let volume = 0, reps = 0, time = 0, dist = 0, best = 0, bestSet = null, tonnage = 0, rpeSum = 0, rpeN = 0;
    let restSum = 0, restN = 0, workSec = 0, hardReps = 0, highReps = 0;
    for (const s of sets) {
      volume += setVolume(s, mode);
      reps += num(s.r); time += num(s.t); dist += num(s.d);
      if (num(s.w) > 0) tonnage += num(s.w) * Math.max(1, num(s.r));
      const e = mode === "weight_reps" ? est1RM(num(s.w), num(s.r)) : num(s.w) || num(s.t);
      if (e > best) { best = e; bestSet = s; }
      if (num(s.rpe) > 0) { rpeSum += num(s.rpe); rpeN++; }
      const restVal = num(s.rest) > 0 ? num(s.rest) : num(entry.restDefault);
      if (restVal > 0) { restSum += restVal; restN++; }
      // sets are classified by reps so rest can be judged against the work it
      // is resting from: heavy/low-rep wants long rest, high-rep wants short
      if (num(s.r) > 0 && num(s.r) <= 5) hardReps++;
      if (num(s.r) >= 12) highReps++;
      workSec += num(s.r) * REP_SECONDS + num(s.t);
    }
    return {
      sets: sets.length, volume, reps, time, dist, tonnage,
      est1RM: mode === "weight_reps" ? best : 0,
      best, bestSet, avgRPE: rpeN ? rpeSum / rpeN : null,
      avgRest: restN ? restSum / restN : null,
      totalRest: restSum,
      restN, workSec, hardReps, highReps,
    };
  }

  const libById = (() => {
    const m = new Map();
    if (typeof EXERCISE_LIB !== "undefined") for (const e of EXERCISE_LIB) m.set(e.id, e);
    return m;
  })();

  const exInfo = (state, id) => {
    const c = (state.custom || []).find((x) => x.id === id);
    return c || libById.get(id) || { id, n: "Unknown", c: "Other", m: "weight_reps", g: ["Core"], p: [], s: [], e: [] };
  };
  const exName = (state, id) => exInfo(state, id).n;
  const exMode = (state, id) => (state.overrides && state.overrides[id] && state.overrides[id].mode) || exInfo(state, id).m || "weight_reps";
  const exGroups = (state, id) => {
    const o = state.overrides && state.overrides[id];
    if (o && o.g) return o.g;
    return exInfo(state, id).g || [];
  };

  function liftKey(name) {
    for (const [re, k] of LIFT_MATCH) if (re.test(name)) return k;
    return null;
  }
  function isCoreLift(state, id) {
    const info = exInfo(state, id);
    const k = liftKey(info.n);
    if (!k) return false;
    const eq = (info.e || []).map((s) => s.toLowerCase());
    if (eq.some((s) => CORE_EQ.some((c) => s.includes(c)))) return true;
    // bodyweight staples count as core (pull-up, dip, push-up)
    return /pull-?up|chin-?up|\bdip\b|push-?up/i.test(info.n);
  }

  /* Machine loads are not comparable to free-weight standards, so machine
     work is discounted rather than dropped when it is all we have. */
  const MACHINE_RE = /machine|deck|smith|cable|pulldown|pushdown|leg press|hack squat|assisted/i;
  const isMachine = (state, id) => {
    const info = exInfo(state, id);
    return (info.e || []).some((s) => /machine|cable|smith/i.test(s)) || MACHINE_RE.test(info.n);
  };

  function liftScore(ratio, key, sex) {
    const st = STANDARDS[key];
    if (!st) return 0;
    const xs = sex === "F" ? st.w : st.m;
    return interp(ratio, xs, TIER_SCORE);
  }

  /* ---------- date windowing ---------- */
  function inWindow(w, fromMs, toMs) {
    const t = new Date(w.date + "T12:00:00").getTime();
    return t >= fromMs && t <= toMs;
  }
  /* Windows are anchored to local noon so a DST shift never drops or
     double-counts a day. */
  function windowWorkouts(state, days, offsetDays = 0) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    const to = new Date(noon); to.setDate(to.getDate() - offsetDays);
    const from = new Date(noon); from.setDate(from.getDate() - offsetDays - days);
    return (state.workouts || []).filter((w) => inWindow(w, from.getTime(), to.getTime()));
  }

  /* ---------- bodyweight ---------- */
  function bodyweight(state, atDate) {
    const log = (state.bodylog || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!log.length) return num(state.profile.weightKg) || 0;
    if (!atDate) return num(log[log.length - 1].weightKg) || 0;
    let last = num(state.profile.weightKg) || 0;
    for (const b of log) { if (b.date <= atDate) last = num(b.weightKg) || last; else break; }
    return last;
  }

  /* ---------- PR / bests per exercise ---------- */
  function bestFor(state, exId) {
    const mode = exMode(state, exId);
    let out = { est1RM: 0, reps: 0, time: 0, dist: 0, volume: 0, tonnage: 0, date: null };
    for (const w of state.workouts || []) {
      for (const en of w.entries || []) {
        if (en.id !== exId) continue;
        const s = entryStats(en);
        const cand = {
          est1RM: s.est1RM, reps: Math.max(0, ...(en.sets || []).map((x) => num(x.r))),
          time: Math.max(0, ...(en.sets || []).map((x) => num(x.t))),
          dist: Math.max(0, ...(en.sets || []).map((x) => num(x.d))),
          volume: s.volume, tonnage: s.tonnage,
        };
        for (const k of Object.keys(out)) {
          if (k === "date") continue;
          if (cand[k] > out[k]) { out[k] = cand[k]; out.date = w.date; }
        }
      }
    }
    out.mode = mode;
    return out;
  }

  /* Per-exercise series (one point per workout that trained it). */
  function seriesFor(state, exId) {
    const pts = [];
    for (const w of (state.workouts || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
      for (const en of w.entries || []) {
        if (en.id !== exId) continue;
        const s = entryStats(en);
        pts.push({ date: w.date, est1RM: s.est1RM, volume: s.volume, tonnage: s.tonnage, top: s.best, reps: s.reps, sets: s.sets, rpe: s.avgRPE, rest: s.avgRest });
      }
    }
    return pts;
  }

  /* Latest session vs the one before it — the ▲/▼ the user asked for. */
  function compareLast(state, exId) {
    const pts = seriesFor(state, exId);
    if (pts.length < 2) return null;
    const cur = pts[pts.length - 1], prev = pts[pts.length - 2];
    const pct = (a, b) => (b > 0 ? ((a - b) / b) * 100 : a > 0 ? 100 : 0);
    return {
      date: cur.date, prevDate: prev.date,
      est1RM: { cur: cur.est1RM, prev: prev.est1RM, pct: pct(cur.est1RM, prev.est1RM) },
      volume: { cur: cur.volume, prev: prev.volume, pct: pct(cur.volume, prev.volume) },
      top:    { cur: cur.top,    prev: prev.top,    pct: pct(cur.top, prev.top) },
      better: cur.est1RM > prev.est1RM || (cur.est1RM === prev.est1RM && cur.volume > prev.volume),
    };
  }

  /* ---------- next-session target (progressive overload) ---------- */
  /* The smallest practical load step. Plates come in 1.25/2.5/5 kg pairs, so
     ~2.5% of the working load snapped to a multiple of 1.25 kg (the step a
     fractional plate pair actually gives you — 3 kg is not loadable), floored at
     1.25 kg. Deliberately conservative: a jump you cannot make is not a target,
     it is a missed session. */
  const kgStep = (w) => Math.max(1.25, Math.round((w * 0.025) / 1.25) * 1.25);

  /* A target derived from the user's OWN last session, by double progression —
     the standard approach: add reps at the same load until the top of the rep
     range, then add load and reset the reps. Both options are offered because
     either is a legitimate way to progress; neither is mandated. */
  function nextTarget(state, exId) {
    const mode = exMode(state, exId);
    if (mode !== "weight_reps" && mode !== "reps") return null;

    const sessions = [];
    for (const w of (state.workouts || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
      for (const en of w.entries || []) {
        if (en.id !== exId) continue;
        const st = entryStats(en);
        if (st.sets) sessions.push({ date: w.date, st, sets: en.sets || [] });
      }
    }
    if (!sessions.length) return null;
    const last = sessions[sessions.length - 1];
    const prev = sessions.length > 1 ? sessions[sessions.length - 2] : null;

    if (mode === "reps") {
      const best = Math.max(0, ...last.sets.map((s) => num(s.r)));
      if (!best) return null;
      return {
        mode, date: last.date, sessions: sessions.length, step: 0,
        last: { w: 0, r: best },
        options: [{ w: 0, r: best + 1 }],
        trend: prev ? last.st.reps - prev.st.reps : null,
      };
    }

    // reference set = the one that produced the best estimated 1RM, i.e. the
    // user's actual best effort last time (a warmup triple will not win)
    let ref = null, refE = 0;
    for (const s of last.sets) {
      const e = est1RM(num(s.w), num(s.r));
      if (e > refE) { refE = e; ref = s; }
    }
    if (!ref || !num(ref.w) || !num(ref.r)) return null;

    const w = num(ref.w), r = num(ref.r);
    const step = kgStep(w);
    const options = [{ w, r: r + 1 }];                       // +1 rep at the same load
    options.push({ w: w + step, r: r >= 12 ? Math.max(5, r - 4) : r });  // +load
    return { mode, date: last.date, sessions: sessions.length, step,
             last: { w, r }, options, trend: prev ? last.st.est1RM - prev.st.est1RM : null };
  }

  /* ---------- the six attributes ---------- */
  function bestLifts(state, ws) {
    const out = {};
    for (const w of ws) for (const en of w.entries || []) {
      if (!isCoreLift(state, en.id)) continue;
      const k = liftKey(exInfo(state, en.id).n);
      const s = entryStats(en);
      if (s.est1RM > (out[k] || 0)) out[k] = s.est1RM;
    }
    return out;
  }

  function strengthScore(state, ws) {
    const bw = bodyweight(state) || 80;
    const sex = state.profile.sex || "M";
    const lifts = bestLifts(state, ws);
    const keys = Object.keys(lifts);
    if (keys.length) {
      const scores = keys.map((k) => liftScore(lifts[k] / bw, k, sex));
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return { score: clamp(avg), basis: "standards", lifts, bw, n: keys.length };
    }
    // Fallback: no free-weight standard lift yet. Take the median of the top
    // three estimated 1RMs and discount it — machine stacks under-report true
    // barbell strength, so this stays deliberately conservative and the UI
    // flags it "est." until a real barbell lift is logged.
    const loads = [];
    for (const w of ws) for (const en of w.entries || []) {
      const s = entryStats(en);
      if (s.est1RM > 0) loads.push({ v: s.est1RM, id: en.id });
    }
    if (!loads.length) return { score: 0, basis: "none", bw, n: 0 };
    loads.sort((a, b) => b.v - a.v);
    const top = loads.slice(0, 3);
    const med = top[Math.floor(top.length / 2)];
    const disc = isMachine(state, med.id) ? 0.62 : 0.85;
    const score = Math.min(75, liftScore((med.v * disc) / bw, "bench", sex));
    return { score: clamp(score), basis: "estimated", bw, n: 0, from: exName(state, med.id) };
  }

  function staminaScore(state, ws) {
    // cardio minutes/week
    let cardioMin = 0, distKm = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const m = exMode(state, en.id);
      const info = exInfo(state, en.id);
      if (m === "distance_time" || info.c === "Cardio") {
        for (const s of en.sets || []) { cardioMin += num(s.t) / 60; distKm += num(s.d) / 1000; }
      }
    }
    const weeks = Math.max(1, ws.length ? (28 / 7) : 1);
    const minPerWk = cardioMin / weeks;
    const cardioScore = interp(minPerWk, [0, 30, 75, 150, 300], [6, 30, 52, 75, 95]);
    // rep capacity: best single-set reps logged
    let maxReps = 0;
    for (const w of ws) for (const en of w.entries || []) {
      for (const s of en.sets || []) maxReps = Math.max(maxReps, num(s.r));
    }
    const repScore = interp(maxReps, [5, 10, 15, 20, 30], [10, 30, 48, 66, 88]);
    // volume tolerance: sets per week
    let sets = 0;
    for (const w of ws) for (const en of w.entries || []) sets += entryStats(en).sets;
    const setScore = interp(sets / weeks, [0, 20, 40, 60, 90], [6, 30, 55, 75, 95]);

    // Rest interval is a training VARIABLE, not a virtue. Short rest raises the
    // cardiovascular demand (endurance); long rest is what LETS you express heavy
    // loads (strength/power). So rest moves Stamina only — Strength and Power are
    // deliberately untouched, because penalising long rest would punish exactly
    // the heavy work they are built from. Counted only when rest was actually
    // recorded; otherwise the original weighting stands rather than inventing a
    // default nobody entered.
    let restSum = 0, restN = 0, workSec = 0, hardReps = 0, highReps = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const st = entryStats(en);
      restSum += st.totalRest; restN += st.restN; workSec += st.workSec;
      hardReps += st.hardReps; highReps += st.highReps;
    }
    const avgRest = restN ? restSum / restN : null;
    // share of the session spent working rather than resting
    // Density needs rest to mean anything: with no rest logged the work-time
    // fraction is trivially 100%, which reads as "perfectly efficient session"
    // when the truth is that we do not know.
    const density = restN > 0 && (workSec + restSum) > 0
      ? Math.round((workSec / (workSec + restSum)) * 100) : null;

    let score;
    if (avgRest != null) {
      const densityScore = avgRest <= 45 ? 92
        : avgRest >= 300 ? 22
        : clamp(interp(avgRest, [45, 60, 90, 120, 180, 300], [92, 78, 62, 50, 36, 22]), 22, 92);
      score = 0.36 * cardioScore + 0.24 * repScore + 0.22 * setScore + 0.18 * densityScore;
    } else {
      score = 0.42 * cardioScore + 0.28 * repScore + 0.30 * setScore;
    }
    return { score: clamp(score), cardioMinPerWk: minPerWk, distKm, maxReps, setsPerWk: sets / weeks,
             avgRest, density, hardReps, highReps, restN };
  }

  function powerScore(state, ws) {
    const bw = bodyweight(state) || 80, sex = state.profile.sex || "M";
    let olympic = 0, olyKey = null, plyoReps = 0, heavySets = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const info = exInfo(state, en.id), s = entryStats(en);
      const k = liftKey(info.n);
      if (k === "clean" || k === "snatch") { if (s.est1RM > olympic) { olympic = s.est1RM; olyKey = k; } }
      if (/jump|plyo|hop|bound|throw|slam|explosive|kettlebell swing|clean|snatch|push press/i.test(info.n)) {
        for (const x of en.sets || []) plyoReps += num(x.r) || 1;
      }
      for (const x of en.sets || []) if (num(x.r) > 0 && num(x.r) <= 3 && num(x.w) > 0) heavySets++;
    }
    const parts = [];
    if (olyKey) parts.push(liftScore(olympic / bw, olyKey, sex));
    const plyoScore = interp(plyoReps, [0, 20, 60, 120, 240], [8, 32, 55, 76, 95]);
    parts.push(plyoScore);
    const heavyScore = interp(heavySets, [0, 4, 10, 20, 40], [10, 34, 55, 76, 94]);
    parts.push(heavyScore);
    const score = parts.reduce((a, b) => a + b, 0) / parts.length;
    return { score: clamp(score), plyoReps, heavySets, olympic };
  }

  const MOB_RE = /stretch|mobility|yoga|foam|flexib|range of motion|dynamic warm/i;
  function mobilityScore(state, ws) {
    let min = 0, sessions = 0;
    for (const w of ws) {
      let touched = false;
      for (const en of w.entries || []) {
        if (!MOB_RE.test(exInfo(state, en.id).n)) continue;
        touched = true;
        for (const s of en.sets || []) min += (num(s.t) / 60) || num(s.r) * 0.5;
      }
      if (touched) sessions++;
    }
    const perWk = min / 4;
    return { score: clamp(interp(perWk, [0, 15, 40, 80, 150], [4, 30, 55, 78, 95])), minPerWk: perWk, sessions };
  }

  function consistencyScore(state, ws) {
    const target = num(state.profile.weeklyTarget) || 4;
    const sessions = ws.length;
    const expected = target * (28 / 7);
    const rate = expected > 0 ? sessions / expected : 0;
    const s = clamp(interp(rate, [0, 0.25, 0.5, 0.75, 1, 1.25], [0, 22, 45, 68, 86, 97]));
    const st = streaks(state);
    return { score: s, sessions, expected, rate, streakDays: st.days, streakWeeks: st.weeks };
  }

  /* Below this, fat is not leanness any more, it is the essential-fat floor:
     widely cited as roughly 3-5% for men and 10-13% for women. A goal under the
     lower bound is worth flagging rather than silently accepting, because the
     app would otherwise help someone aim somewhere they cannot stay. */
  const ESSENTIAL_BF = { M: 5, F: 13 };
  const belowEssentialBF = (pct, sex) => num(pct) > 0 && num(pct) < ESSENTIAL_BF[sex === "F" ? "F" : "M"];

  function vitalityScore(state, asOfDate) {
    // asOfDate re-evaluates an earlier month using the measurements that existed
    // THEN. Without it a history point would silently borrow today's bodyweight.
    const log = (state.bodylog || []).filter((b) => !asOfDate || b.date <= asOfDate)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const bw = bodyweight(state, asOfDate);
    const goal = num(state.profile.goalWeightKg);
    const parts = [], used = [];
    if (log.length >= 2 && goal > 0) {
      const start = num(log[0].weightKg), cur = num(log[log.length - 1].weightKg);
      const total = Math.abs(start - goal);
      const done = total > 0 ? 1 - Math.abs(cur - goal) / total : 1;
      parts.push({ w: 0.5, v: clamp(done * 100) }); used.push("weight trend");
    } else if (log.length === 1 && goal > 0) {
      const gap = Math.abs(bw - goal);
      parts.push({ w: 0.5, v: clamp(100 - gap * 4) }); used.push("weight vs goal");
    }
    // Prefer the log (the source of truth); the profile copy is only a fallback.
    const bfLogged = log.filter((b) => num(b.bodyFatPct) > 0);
    const bf = bfLogged.length ? num(bfLogged[bfLogged.length - 1].bodyFatPct) : num(state.profile.bodyFatPct);
    const bfGoal = num(state.profile.goalBodyFatPct);
    if (bf > 0 && bfGoal > 0) {
      // A goal turns "are you inside a healthy band" into "are you closing the
      // gap", exactly as the weight goal does — and it is what a body-fat target
      // is FOR, so it carries the same weight as the weight trend rather than the
      // smaller band-weighting. Without a goal the healthy band still applies.
      if (bfLogged.length >= 2) {
        const start = num(bfLogged[0].bodyFatPct);
        const total = Math.abs(start - bfGoal);
        const done = total > 0 ? 1 - Math.abs(bf - bfGoal) / total : 1;
        parts.push({ w: 0.5, v: clamp(done * 100) }); used.push("body fat trend vs goal");
      } else {
        parts.push({ w: 0.5, v: clamp(100 - Math.abs(bf - bfGoal) * 6) }); used.push("body fat vs goal");
      }
    } else if (bf > 0) {
      const sex = state.profile.sex || "M";
      const lo = sex === "F" ? 18 : 8, hi = sex === "F" ? 28 : 18;
      const v = bf < lo ? clamp(100 - (lo - bf) * 6) : bf > hi ? clamp(100 - (bf - hi) * 5) : 100;
      parts.push({ w: 0.3, v }); used.push("body fat");
    }
    const h = num(state.profile.heightCm);
    if (h > 0 && bw > 0) {
      const bmi = bw / Math.pow(h / 100, 2);
      const v = bmi < 18.5 ? clamp(100 - (18.5 - bmi) * 12) : bmi > 25 ? clamp(100 - (bmi - 25) * 7) : 100;
      parts.push({ w: 0.2, v }); used.push("BMI");
    }
    // No measurements means no score, exactly like the other five attributes.
    // Returning a middle value here implied "Decent" body composition on a fresh
    // install, which is a number the user never gave us.
    if (!parts.length) return { score: 0, basis: "no data", log: log.length, used: [] };
    const tw = parts.reduce((a, p) => a + p.w, 0);
    let score = clamp(parts.reduce((a, p) => a + p.v * p.w, 0) / tw);
    // BMI alone is a weak signal and says nothing about body composition,
    // so a BMI-only score is capped rather than allowed to read "Fantastic".
    if (used.length === 1 && used[0] === "BMI") score = Math.min(score, 85);
    return { score, basis: used.join(" + "), log: log.length, used };
  }

  /* Full attribute readout for a window, with deltas vs the previous window. */
  function attributes(state, days = 28, offsetDays = 0) {
    const cur = windowWorkouts(state, days, offsetDays);
    const prev = windowWorkouts(state, days, days + offsetDays);
    const asOf = offsetDays > 0 ? dstr(Date.now() - offsetDays * DAY) : null;
    const now = {
      STR: strengthScore(state, cur),
      END: staminaScore(state, cur),
      POW: powerScore(state, cur),
      MOB: mobilityScore(state, cur),
      CON: consistencyScore(state, cur),
      VIT: vitalityScore(state, asOf),
    };
    const was = {
      STR: strengthScore(state, prev).score,
      END: staminaScore(state, prev).score,
      POW: powerScore(state, prev).score,
      MOB: mobilityScore(state, prev).score,
      CON: consistencyScore(state, prev).score,
      VIT: now.VIT.score,
    };
    // (VIT has no meaningful "previous window" of its own — it is a body-
    // composition read, not a training volume — so its delta stays 0.)
    const hasPrev = prev.length > 0;
    const out = {};
    for (const a of ATTRIBUTES) {
      const score = Math.round(now[a.key].score);
      const prevScore = Math.round(was[a.key]);
      out[a.key] = {
        ...a, score, tier: tierOf(score),
        prev: hasPrev ? prevScore : null,
        delta: hasPrev ? score - prevScore : null,
        detail: now[a.key],
      };
    }
    return out;
  }

  /* ---------- history: the attributes, month by month ---------- */
  /* One point per month, each an HONEST re-evaluation of the training that
     preceded that month — not a projection and not a re-scaled number. A month
     with no sessions reads 0, exactly as the live view would have read then. */
  function attributeHistory(state, months = 12) {
    const out = [];
    const anchor = new Date(); anchor.setHours(12, 0, 0, 0);
    for (let i = months - 1; i >= 0; i--) {
      const end = new Date(anchor);
      end.setMonth(end.getMonth() - i);
      const offsetDays = Math.max(0, Math.round((anchor.getTime() - end.getTime()) / DAY));
      const a = attributes(state, 28, offsetDays);
      const scores = {};
      for (const k of ATTRIBUTES) scores[k.key] = a[k.key].score;
      out.push({ date: dstr(end), offsetDays, scores, any: a.CON.detail.sessions > 0 });
    }
    return out;
  }

  /* Sets and tonnage per week for the last N weeks. */
  function volumeWeeks(state, weeks = 12) {
    const out = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = windowWorkouts(state, 7, i * 7);
      let sets = 0, tonnage = 0, rpeSum = 0, rpeN = 0, reps = 0;
      for (const w of ws) for (const en of w.entries || []) {
        const st = entryStats(en);
        sets += st.sets; tonnage += st.tonnage; reps += st.reps;
        if (st.avgRPE != null && st.sets) { rpeSum += st.avgRPE * st.sets; rpeN += st.sets; }
      }
      out.push({ weeksAgo: i, sessions: ws.length, sets, tonnage, reps,
                 avgRPE: rpeN ? rpeSum / rpeN : null });
    }
    return out;
  }

  /* Autoregulation read. Only two things count as evidence, both from logged
     data, and both are stated as the shape of accumulating fatigue rather than a
     verdict: effort climbing while output stalls, or sustained volume at the top
     of the useful range. Silence is the default — an app that cries "deload"
     every other week trains the user to ignore it. */
  function deloadCheck(state) {
    const w = volumeWeeks(state, 9).filter((x) => x.sessions > 0);
    if (w.length < 4) return { suggest: false, why: "Not enough training weeks logged to judge yet.", weeks: w.length };
    const last3 = w.slice(-3), prev3 = w.slice(-6, -3);
    const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const setsNow = mean(last3.map((x) => x.sets));
    const setsPrev = prev3.length ? mean(prev3.map((x) => x.sets)) : null;
    const rpeNow = mean(last3.map((x) => x.avgRPE).filter((x) => x != null));
    const rpePrev = mean(prev3.map((x) => x.avgRPE).filter((x) => x != null));
    if (rpeNow != null && rpePrev != null && rpeNow - rpePrev >= 0.5
        && setsPrev != null && setsNow <= setsPrev * 1.02) {
      return { suggest: true, setsNow, rpeNow, rpePrev,
        why: `Average RPE has risen ${(rpeNow - rpePrev).toFixed(1)} over three weeks while weekly sets stayed level (${Math.round(setsPrev)} → ${Math.round(setsNow)}). Effort climbing at a flat workload is the classic shape of accumulated fatigue.`,
        fix: "Take a lighter week — roughly half your sets at the same loads — then resume." };
    }
    return { suggest: false, setsNow, rpeNow, why: "No fatigue pattern in the last three weeks.", weeks: w.length };
  }

  /* A target for one exercise, with progress and an ETA that is only offered
     when there is a real trend to extrapolate. A date invented from two data
     points would be worse than no date. */
  function targetProgress(state, exId) {
    const t = (state.targets || {})[exId];
    if (!t || !(num(t.value) > 0)) return null;
    const target = num(t.value);
    const mode = exMode(state, exId);
    // bestFor exposes a metric per mode (est1RM / reps / time / dist) — there is
    // no generic `best`, and reading one gave 0 progress on every target.
    const b = bestFor(state, exId);
    const current = mode === "weight_reps" ? num(b.est1RM)
      : mode === "reps" ? num(b.reps)
      : mode === "time" ? num(b.time)
      : mode === "distance_time" ? num(b.dist)
      : (num(b.est1RM) || num(b.time));
    const pts = seriesFor(state, exId)
      .map((p) => ({ t: new Date(p.date + "T12:00:00").getTime(), v: mode === "weight_reps" ? p.est1RM : p.top }))
      .filter((p) => p.v > 0).sort((a, b2) => a.t - b2.t);
    let eta = null, ratePerWeek = null, basis = "not enough sessions";
    if (pts.length >= 4) {
      const spanDays = (pts[pts.length - 1].t - pts[0].t) / DAY;
      if (spanDays >= 14) {
        // least squares on value vs days
        const n = pts.length;
        const mx = pts.reduce((a, p) => a + p.t, 0) / n, my = pts.reduce((a, p) => a + p.v, 0) / n;
        let sxy = 0, sxx = 0;
        for (const p of pts) { sxy += (p.t - mx) * (p.v - my); sxx += (p.t - mx) * (p.t - mx); }
        const slopePerDay = sxx > 0 ? sxy / sxx : 0;
        ratePerWeek = slopePerDay * 7;
        if (ratePerWeek > 0 && current < target) {
          const weeks = (target - current) / ratePerWeek;
          // A projection further out than a year is noise dressed as a date.
          if (weeks <= 104) { eta = Math.ceil(weeks); basis = "your logged rate"; }
          else { eta = null; basis = "over a year at your current rate"; }
        } else if (current >= target) { basis = "already met"; }
        else { basis = ratePerWeek <= 0 ? "you are not currently trending up" : "not enough sessions"; }
      }
    }
    const pct = clamp((current / target) * 100);
    return { target, current, pct, eta, ratePerWeek, basis, mode, date: t.set || null,
             remaining: Math.max(0, target - current) };
  }

  /* ---------- the user's own notes-app shorthand ---------- */
  /* Exactly the format he started with, so an export can be pasted straight back
     into his notes:

       Bench press machine:
       1:100x10
       2:100x10

     RPE and rest are appended only when they were actually logged — dropping
     them would lose real entries, inventing them would be worse. */
  function exportNoteShorthand(state, workoutId) {
    const w = (state.workouts || []).find((x) => x.id === workoutId);
    if (!w) return "";
    // Plain numbers only. Unit conversion and repeated addition produce values
    // like 120.80000000000001, and that noise would land straight in the user's
    // notes — the whole point is that the output is as clean as what he typed.
    const r2 = (v) => { const n = num(v); return Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : Math.round(n * 100) / 100; };
    const lines = [];
    if (w.note) lines.push("# " + w.note);
    for (const en of w.entries || []) {
      const mode = en.mode || exMode(state, en.id);
      lines.push(en.name + ":");
      (en.sets || []).forEach((s, i) => {
        const sfx = [];
        if (num(s.rpe) > 0) sfx.push("@" + r2(s.rpe));
        const rest = num(s.rest) > 0 ? num(s.rest) : num(en.restDefault);
        if (rest > 0) sfx.push("r" + rest);
        const tail = sfx.length ? " " + sfx.join(" ") : "";
        let body;
        if (mode === "time") body = `${r2(num(s.t) || num(s.r))}s`;
        else if (mode === "weight_time") body = `${r2(s.w)}x${r2(s.t)}s`;
        else if (mode === "distance_time") body = `${r2(num(s.d) / 1000)}km ${num(s.t) ? Math.floor(num(s.t) / 60) + ":" + String(Math.round(num(s.t) % 60)).padStart(2, "0") : ""}`.trim();
        else if (mode === "weight_distance") body = `${r2(s.w)}x${r2(s.d)}m`;
        else if (mode === "reps") body = String(r2(s.r));
        else body = `${r2(s.w)}x${r2(s.r)}`;
        lines.push(`${i + 1}:${body}${tail}`);
      });
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  /* Progress toward the body-fat goal, mirroring how the weight goal reads.
     Pure measurement vs target — no projection, no invented date. */
  function bodyFatProgress(state) {
    const goal = num(state.profile.goalBodyFatPct);
    if (!(goal > 0)) return null;
    const log = (state.bodylog || []).filter((b) => num(b.bodyFatPct) > 0)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    const cur = log.length ? num(log[log.length - 1].bodyFatPct) : num(state.profile.bodyFatPct);
    if (!(cur > 0)) return { goal, current: null, pct: null, from: null, change: null, belowEssential: belowEssentialBF(goal, state.profile.sex) };
    const start = log.length >= 2 ? num(log[0].bodyFatPct) : null;
    const total = start != null ? Math.abs(start - goal) : null;
    const pct = total > 0 ? clamp((1 - Math.abs(cur - goal) / total) * 100)
      : (Math.abs(cur - goal) < 0.05 ? 100 : 0);
    return { goal, current: cur, start, from: log.length ? log[0].date : null,
             change: start != null ? Math.round((cur - start) * 10) / 10 : null,
             remaining: Math.round((cur - goal) * 10) / 10,
             pct, met: Math.abs(cur - goal) < 0.5,
             belowEssential: belowEssentialBF(goal, state.profile.sex) };
  }

  /* ---------- consistency calendar ---------- */
  /* A per-day map of the last N days: everything the year grid needs, computed
     from logged sessions only. */
  function dayMap(state, days = 371) {
    const out = {};
    const anchor = new Date(); anchor.setHours(12, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(anchor); d.setDate(d.getDate() - i);
      out[dstr(d)] = { sets: 0, tonnage: 0, sessions: 0, groups: [] };
    }
    for (const w of state.workouts || []) {
      const cell = out[w.date];
      if (!cell) continue;
      const gs = new Set();
      for (const en of w.entries || []) {
        const st = entryStats(en);
        cell.sets += st.sets; cell.tonnage += st.tonnage;
        for (const g of exGroups(state, en.id)) gs.add(g);
      }
      cell.sessions = 1;
      cell.groups = Array.from(gs);
    }
    return out;
  }

  /* ---------- muscle freshness (recovery-aware) ---------- */
  /* How long since each group was trained, as a 0-100 "freshness" read against a
     72-hour recovery window — the point at which most people are ready to train
     a group again. This is recency, not a physiological measurement, and it is
     labelled that way in the UI. */
  function freshness(state) {
    const mg = muscleGroups(state, 28);
    const anchor = new Date(); anchor.setHours(12, 0, 0, 0);
    const out = {};
    for (const g of GROUP_ORDER) {
      const last = mg[g] && mg[g].last;
      if (!last) { out[g] = { fresh: null, days: null, setsThisWeek: mg[g] ? mg[g].setsPerWk : 0 }; continue; }
      const days = Math.max(0, (anchor.getTime() - new Date(last + "T12:00:00").getTime()) / DAY);
      out[g] = {
        days,
        fresh: clamp(Math.round((days / 3) * 100)),
        setsThisWeek: mg[g].setsPerWk,
        last,
      };
    }
    return out;
  }

  /* ---------- muscle-group balance (radar 2 + weak points) ---------- */
  function muscleGroups(state, days = 28) {
    const ws = windowWorkouts(state, days, 0);
    const weeks = days / 7;
    const sets = {}, vol = {}, lastTrained = {};
    for (const g of GROUP_ORDER) { sets[g] = 0; vol[g] = 0; lastTrained[g] = null; }
    for (const w of ws) for (const en of w.entries || []) {
      const st = entryStats(en);
      if (!st.sets) continue;
      const gs = exGroups(state, en.id).filter((g) => GROUP_ORDER.includes(g));
      if (!gs.length) continue;
      // primary group takes full credit, others share it
      gs.forEach((g, i) => {
        const share = i === 0 ? 1 : 0.5;
        sets[g] += st.sets * share;
        vol[g] += st.volume * share;
        const d = w.date; if (!lastTrained[g] || d > lastTrained[g]) lastTrained[g] = d;
      });
    }
    const out = {};
    for (const g of GROUP_ORDER) {
      const L = LANDMARKS[g];
      const perWk = sets[g] / weeks;
      // 100 = at or above the adaptive sweet spot; below that, linear to MEV.
      let score = perWk <= 0 ? 0
        : perWk < L.mev ? (perWk / L.mev) * 55
        : perWk < L.mav ? 55 + ((perWk - L.mev) / (L.mav - L.mev)) * 40
        : 95 + Math.min(5, ((perWk - L.mav) / Math.max(1, L.mrv - L.mav)) * 5);
      score = clamp(Math.round(score));
      const status = perWk <= 0 ? "untrained" : perWk < L.mev ? "below MEV"
        : perWk <= L.mrv ? (perWk < L.mav ? "MEV→MAV" : "optimal") : "over MRV";
      out[g] = { group: g, score, setsPerWk: Math.round(perWk * 10) / 10, totalSets: Math.round(sets[g] * 10) / 10,
                 volume: Math.round(vol[g]), last: lastTrained[g], status, landmarks: L };
    }
    return out;
  }

  /* ---------- weak points + recommendations ---------- */
  function weakPoints(state, days = 28) {
    const mg = muscleGroups(state, days);
    const attrs = attributes(state, days);
    const ws = windowWorkouts(state, days, 0);
    const out = [];
    const trained = GROUP_ORDER.filter((g) => mg[g].setsPerWk > 0);
    const vals = trained.map((g) => mg[g].score);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

    // 1. lagging muscle groups
    const lag = GROUP_ORDER.filter((g) => mg[g].setsPerWk > 0 && mg[g].score < Math.max(45, mean * 0.7))
      .sort((a, b) => mg[a].score - mg[b].score);
    for (const g of lag.slice(0, 3)) {
      const need = Math.max(0, Math.ceil(mg[g].landmarks.mev - mg[g].setsPerWk));
      out.push({ kind: "volume", severity: mg[g].score < 40 ? "high" : "med", group: g,
        title: `${g} is under-trained`, detail: `${mg[g].setsPerWk} sets/wk vs a ${mg[g].landmarks.mev}–${mg[g].landmarks.mav} target.`,
        fix: need > 0
          ? `Add ~${need} ${need === 1 ? "set" : "sets"}/week of ${g.toLowerCase()} work.`
          : `Progressively overload ${g.toLowerCase()}.` });
    }
    // 2. completely untrained
    const untrained = GROUP_ORDER.filter((g) => mg[g].setsPerWk <= 0 && g !== "Calves");
    if (untrained.length) out.push({ kind: "gap", severity: untrained.length > 2 ? "high" : "med",
      title: `No data for ${untrained.join(", ")}`, detail: "No sets logged for these groups in the last 4 weeks.",
      fix: `Add a compound movement for ${untrained.length === 1 ? "it" : "each"}: ${untrained.map((g) => suggestFor(g)).join("; ")}.` });

    // 3. push / pull balance
    const push = mg.Chest.volume + mg.Shoulders.volume + mg.Arms.volume * 0.5;
    const pull = mg.Back.volume + mg.Arms.volume * 0.5;
    if (push > 0 && pull > 0) {
      const ratio = push / pull;
      if (ratio > 1.35) out.push({ kind: "balance", severity: "med", title: "Push-dominant imbalance",
        detail: `Push volume is ${ratio.toFixed(2)}× pull volume. A 1.0–1.2 ratio keeps shoulders healthy.`,
        fix: "Add rows, pulldowns or face-pulls to bring pulling up to match pressing." });
      else if (ratio < 0.75) out.push({ kind: "balance", severity: "low", title: "Pull-dominant imbalance",
        detail: `Pull volume is ${(1 / ratio).toFixed(2)}× push volume.`, fix: "Add pressing volume (bench, OHP, dips)." });
    }
    // 4. quad / hamstring balance
    if (mg.Legs.setsPerWk > 0) {
      const hs = (state.workouts || []).flatMap((w) => w.entries || []);
      let quad = 0, ham = 0;
      for (const en of hs) {
        const info = exInfo(state, en.id);
        const st = entryStats(en);
        if (info.p.includes("Quads") || info.p.includes("Glutes")) quad += st.sets;
        if (info.p.includes("Hamstrings") || info.p.includes("Glutes")) ham += st.sets;
      }
      if (quad > 0 && ham > 0 && quad / ham > 1.8) out.push({ kind: "balance", severity: "med",
        title: "Quad / hamstring gap", detail: `Quads ${Math.round(quad)} sets vs hamstrings ${Math.round(ham)}.`,
        fix: "Add Romanian deadlifts, leg curls or good mornings for the posterior chain." });
    }
    // 5. stagnant lifts. Deliberately a longer window than the muscle analysis:
    // four sessions of a lift trained every few weeks do not fit inside 90 days,
    // so a genuine plateau could never be seen. The four-session guard below
    // keeps it meaningful either way.
    for (const id of trainedExerciseIds(state, 365)) {
      const pts = seriesFor(state, id);
      if (pts.length < 4) continue;
      const last4 = pts.slice(-4).map((p) => p.est1RM || p.top).filter((v) => v > 0);
      if (last4.length < 4) continue;
      const spread = (Math.max(...last4) - Math.min(...last4)) / Math.max(...last4);
      const flat = last4[3] <= Math.max(...last4.slice(0, 3)) && spread < 0.03;
      if (flat) {
        // RPE turns a generic "change the stimulus" into an actual instruction:
        // near-maximal effort with no progress means recover, not push harder.
        const lastRpe = pts[pts.length - 1].rpe;
        const fix = lastRpe == null
          ? "Change the stimulus: add a rep, drop to 3×5 and push load, or deload a week."
          : lastRpe >= 8.5
            ? `Stalled at RPE ${lastRpe.toFixed(1)} — that is near-maximal, so the limiter is recovery, not effort. Deload a week, then retest.`
            : `Stalled but only at RPE ${lastRpe.toFixed(1)} — there is headroom. Add load next session.`;
        out.push({ kind: "stagnant", severity: "low", title: `${exName(state, id)} has plateaued`,
          detail: `No estimated-1RM improvement across the last 4 sessions.`, fix });
      }
    }
    // 6. rest interval judged against the work it is resting FROM
    let rSum = 0, rN = 0, hard = 0, high = 0, totSets = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const st = entryStats(en);
      rSum += st.totalRest; rN += st.restN; hard += st.hardReps; high += st.highReps; totSets += st.sets;
    }
    if (rN && totSets) {
      const avgRest = rSum / rN;
      const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
      if (avgRest < 75 && hard / totSets > 0.35) {
        out.push({ kind: "density", severity: "low",
          title: `Short rest (${mmss(avgRest)}) on heavy sets`,
          detail: `${hard} of ${totSets} sets are 5 reps or fewer, but your average rest is under 1:15. Short rest caps the load you can express, so the strength work suffers even when the effort feels maximal.`,
          fix: "Rest 2\u20133 min between sets of 5 or fewer reps, and keep the short rest for your higher-rep sets." });
      } else if (avgRest > 150 && high / totSets > 0.35) {
        out.push({ kind: "density", severity: "low",
          title: `Long rest (${mmss(avgRest)}) on high-rep sets`,
          detail: `${high} of ${totSets} sets are 12+ reps but you rest over 2:30, which blunts the endurance stimulus those sets are there for.`,
          fix: "Cut rest to 45\u201375 s on the high-rep work, or superset it with something else." });
      }
    }

    // 7. low attributes
    for (const a of ATTRIBUTES) {
      if (attrs[a.key].score < 30 && attrs[a.key].score > 0)
        out.push({ kind: "attribute", severity: "low", title: `${a.label} is your weakest attribute`,
          detail: `Score ${attrs[a.key].score}/100 (${attrs[a.key].tier}).`,
          fix: FIXES[a.key] });
    }
    const sev = { high: 0, med: 1, low: 2 };
    return out.sort((a, b) => sev[a.severity] - sev[b.severity]);
  }

  const FIXES = {
    STR: "Anchor one heavy compound per session in the 3–6 rep range and add load weekly.",
    END: "Add 20–30 min of easy cardio twice a week and finish a lift with one high-rep back-off set.",
    POW: "Add jumps, throws or a power clean at the start of a session, 3–5 sets of 3.",
    MOB: "Book 10 minutes of stretching or mobility after each session.",
    CON: "Set a fixed weekly target and schedule the sessions — consistency is the multiplier.",
    VIT: "Log bodyweight weekly and hold a small, steady deficit or surplus toward your goal.",
  };
  function suggestFor(g) {
    return { Chest: "bench press or push-ups", Back: "rows or pulldowns", Shoulders: "overhead press or lateral raises",
      Arms: "curls and triceps extensions", Legs: "squat, leg press or lunges", Calves: "standing calf raises",
      Core: "planks, leg raises or cable crunches" }[g] || "a compound movement";
  }
  function trainedExerciseIds(state, days = 90) {
    const ws = windowWorkouts(state, days, 0);
    const s = new Set();
    for (const w of ws) for (const en of w.entries || []) if (entryStats(en).sets) s.add(en.id);
    return [...s];
  }

  /* ---------- PRs ---------- */
  function prTable(state) {
    const rows = [];
    for (const id of trainedExerciseIds(state, 3650)) {
      const mode = exMode(state, id);
      const b = bestFor(state, id);
      const series = seriesFor(state, id);
      const hist = [];
      // The first session for an exercise is a baseline, not a record —
      // you cannot beat a number that never existed. Skip it.
      let run = null;
      for (const p of series) {
        if (!run) { run = { est1RM: p.est1RM, reps: p.reps, volume: p.volume, tonnage: p.tonnage }; continue; }
        const hit = [];
        if (p.est1RM > run.est1RM) { run.est1RM = p.est1RM; hit.push("e1RM"); }
        if (p.reps > run.reps) { run.reps = p.reps; hit.push("reps"); }
        if (p.volume > run.volume) { run.volume = p.volume; hit.push("volume"); }
        if (p.tonnage > run.tonnage) { run.tonnage = p.tonnage; hit.push("tonnage"); }
        if (hit.length) hist.push({ date: p.date, hit });
      }
      rows.push({ id, name: exName(state, id), mode, best: b, prs: hist, sessions: series.length });
    }
    return rows.sort((a, b) => (b.best.date || "").localeCompare(a.best.date || ""));
  }

  function prCount(state, days = 28) {
    const b = new Date(); b.setHours(12, 0, 0, 0); b.setDate(b.getDate() - days);
    const from = dstr(b);
    let n = 0;
    for (const r of prTable(state)) for (const p of r.prs) if (p.date >= from) n += p.hit.length;
    return n;
  }

  /* ---------- streaks ---------- */
  function streaks(state) {
    const dates = [...new Set((state.workouts || []).map((w) => w.date))].sort();
    if (!dates.length) return { days: 0, weeks: 0, lastDate: null, daysSince: null };
    const set = new Set(dates);
    const today = dayKey(Date.now());
    const daysSince = daysBetween(dates[dates.length - 1], today);
    // consecutive days ending today or yesterday
    // walk back in whole LOCAL days from noon so DST never skips a date
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    const back = (i) => { const d = new Date(noon); d.setDate(d.getDate() - i); return d; };
    let days = 0;
    for (let i = 0; i < 400; i++) {
      if (set.has(dstr(back(i)))) days++;
      else if (i > 0) break;
    }
    // consecutive weeks with >=1 session, ending this or last week
    let weeks = 0;
    const wk = (t) => { const d = new Date(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dstr(d); };
    const wset = new Set(dates.map((d) => wk(d + "T12:00:00")));
    for (let i = 0; i < 60; i++) {
      const d = new Date(noon); d.setDate(d.getDate() - i * 7);
      if (wset.has(wk(d))) weeks++;
      else if (i > 0) break;
    }
    return { days, weeks, lastDate: dates[dates.length - 1], daysSince };
  }

  /* ---------- XP & levels ---------- */
  function xp(state) {
    let total = 0;
    for (const w of state.workouts || []) {
      total += 50;
      let tonnage = 0, sets = 0;
      for (const en of w.entries || []) { const s = entryStats(en); tonnage += s.tonnage; sets += s.sets; }
      total += Math.round(tonnage / 1000) + sets * 2;
      total += (w.entries || []).length * 5;
    }
    total += prCount(state, 3650) * 20;
    const st = streaks(state);
    total += st.days * 15 + st.weeks * 50;
    total += (state.bodylog || []).length * 10;
    return total;
  }
  function levelInfo(totalXp) {
    let lvl = 1, need = 300, cum = 0;
    while (cum + need <= totalXp && lvl < 200) { cum += need; lvl++; need = Math.round(300 * Math.pow(lvl, 1.28)); }
    return { level: lvl, into: totalXp - cum, need, pct: Math.round(((totalXp - cum) / need) * 100), total: totalXp };
  }
  const TITLES = ["Rookie", "Trainee", "Grinder", "Lifter", "Ironclad", "Forged", "Veteran", "Beast", "Titan", "Mythic"];
  const title = (lvl) => TITLES[Math.min(TITLES.length - 1, Math.floor((lvl - 1) / 5))] + (lvl > 50 ? " ★" + (lvl - 50) : "");

  /* ---------- achievements ---------- */
  const ACHIEVEMENTS = [
    { id: "first",     name: "First Blood",      desc: "Log your first workout",            test: (c) => c.sessions >= 1 },
    { id: "w10",       name: "Getting Serious",  desc: "10 workouts logged",                test: (c) => c.sessions >= 10 },
    { id: "w50",       name: "Habit Formed",     desc: "50 workouts logged",                test: (c) => c.sessions >= 50 },
    { id: "w100",      name: "Centurion",        desc: "100 workouts logged",               test: (c) => c.sessions >= 100 },
    { id: "t10k",      name: "10 Tonnes",        desc: "10,000 kg total tonnage",           test: (c) => c.tonnage >= 10000 },
    { id: "t100k",     name: "100 Tonnes",       desc: "100,000 kg total tonnage",          test: (c) => c.tonnage >= 100000 },
    { id: "t1m",       name: "Kilotonne",        desc: "1,000,000 kg total tonnage",        test: (c) => c.tonnage >= 1e6 },
    { id: "pr1",       name: "New Best",         desc: "Set your first PR",                 test: (c) => c.prs >= 1 },
    { id: "pr10",      name: "PR Hunter",        desc: "Set 10 PRs",                        test: (c) => c.prs >= 10 },
    { id: "pr50",      name: "Record Breaker",   desc: "Set 50 PRs",                        test: (c) => c.prs >= 50 },
    { id: "s3",        name: "Three in a Row",   desc: "3-day training streak",             test: (c) => c.streakDays >= 3 },
    { id: "s7",        name: "Perfect Week",     desc: "7-day training streak",             test: (c) => c.streakDays >= 7 },
    { id: "s30",       name: "Unbreakable",      desc: "30-day training streak",            test: (c) => c.streakDays >= 30 },
    { id: "wk4",       name: "One Month Strong", desc: "4 consecutive training weeks",      test: (c) => c.streakWeeks >= 4 },
    { id: "wk12",      name: "A Full Season",    desc: "12 consecutive training weeks",     test: (c) => c.streakWeeks >= 12 },
    { id: "wk52",      name: "One Year Iron",    desc: "52 consecutive training weeks",     test: (c) => c.streakWeeks >= 52 },
    { id: "bench1",    name: "Bodyweight Bench", desc: "Bench press 1× bodyweight",         test: (c) => c.ratio.bench >= 1 },
    { id: "squat15",   name: "Squat Club",       desc: "Squat 1.5× bodyweight",             test: (c) => c.ratio.squat >= 1.5 },
    { id: "dead2",     name: "Double Bodyweight",desc: "Deadlift 2× bodyweight",            test: (c) => c.ratio.dead >= 2 },
    { id: "ohp1",      name: "Overhead Boss",    desc: "Press 0.75× bodyweight",            test: (c) => c.ratio.ohp >= 0.75 },
    { id: "cardio10",  name: "Road Work",        desc: "10 km of logged cardio",            test: (c) => c.cardioKm >= 10 },
    { id: "cardio50",  name: "Long Haul",        desc: "50 km of logged cardio",            test: (c) => c.cardioKm >= 50 },
    { id: "cardio100", name: "Endurance Athlete",desc: "100 km of logged cardio",           test: (c) => c.cardioKm >= 100 },
    { id: "bigset",    name: "Volume King",      desc: "20+ sets in one session",           test: (c) => c.maxSetsSession >= 20 },
    { id: "balanced",  name: "Balanced",         desc: "Every muscle group scoring 60+",    test: (c) => c.balanced },
    { id: "variety",   name: "Well-Rounded",     desc: "Train 6+ muscle groups in a week",  test: (c) => c.groupsWeek >= 6 },
    { id: "weighin",   name: "On the Record",    desc: "Log 10 bodyweight check-ins",       test: (c) => c.weighins >= 10 },
    { id: "goal",      name: "Goal Reached",     desc: "Hit your target bodyweight",        test: (c) => c.goalHit },
    { id: "mob60",     name: "Bend Don't Break", desc: "60 min of mobility work",           test: (c) => c.mobilityMin >= 60 },
    { id: "nightowl",  name: "No Days Off",      desc: "Train on a weekend",                test: (c) => c.weekend },
  ];

  function achievementContext(state) {
    const ws = state.workouts || [];
    let tonnage = 0, maxSetsSession = 0, cardioKm = 0, mobilityMin = 0, weekend = false;
    for (const w of ws) {
      let ss = 0;
      for (const en of w.entries || []) {
        const s = entryStats(en); ss += s.sets; tonnage += s.tonnage; cardioKm += s.dist / 1000;
        if (/stretch|mobility|yoga|foam/i.test(exInfo(state, en.id).n)) mobilityMin += s.time / 60;
      }
      maxSetsSession = Math.max(maxSetsSession, ss);
      const dow = new Date(w.date + "T12:00:00").getDay();
      if (dow === 0 || dow === 6) weekend = true;
    }
    const bw = bodyweight(state) || 80;
    const lifts = bestLifts(state, ws);
    const ratio = { bench: 0, squat: 0, dead: 0, ohp: 0, row: 0 };
    for (const k of Object.keys(lifts)) if (k in ratio) ratio[k] = lifts[k] / bw;
    const mg = muscleGroups(state, 28);
    const trainedG = GROUP_ORDER.filter((g) => mg[g].setsPerWk > 0);
    const st = streaks(state);
    const goal = num(state.profile.goalWeightKg), cur = bodyweight(state);
    return {
      sessions: ws.length, tonnage, maxSetsSession, cardioKm, mobilityMin, weekend,
      ratio, prs: prCount(state, 3650), streakDays: st.days, streakWeeks: st.weeks,
      balanced: trainedG.length >= 5 && trainedG.every((g) => mg[g].score >= 60),
      groupsWeek: trainedG.length, weighins: (state.bodylog || []).length,
      goalHit: goal > 0 && cur > 0 && Math.abs(cur - goal) <= Math.max(0.7, goal * 0.01),
    };
  }

  function achievements(state) {
    const ctx = achievementContext(state);
    const unlocked = state.achievements || {};
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: !!unlocked[a.id], unlockedOn: unlocked[a.id] || null, met: safe(() => a.test(ctx), false) }));
  }
  function newAchievements(state) {
    const unlocked = state.achievements || {};
    return achievements(state).filter((a) => a.met && !a.unlocked).map((a) => a.id);
  }
  const safe = (f, d) => { try { return f(); } catch (e) { return d; } };

  /* ---------- summary ---------- */
  function summary(state) {
    const ws = state.workouts || [];
    let tonnage = 0, sets = 0, reps = 0, time = 0, dist = 0, restTotal = 0, restN = 0, workSec = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const s = entryStats(en);
      tonnage += s.tonnage; sets += s.sets; reps += s.reps; time += s.time; dist += s.dist;
      restTotal += s.totalRest; restN += s.restN; workSec += s.workSec;
    }
    const avgRest = restN ? restTotal / restN : null;
    const density = restN > 0 && (workSec + restTotal) > 0
      ? Math.round((workSec / (workSec + restTotal)) * 100) : null;
    const totalXp = xp(state);
    return {
      sessions: ws.length, tonnage, sets, reps, timeMin: time / 60, distKm: dist / 1000,
      restMin: restTotal / 60, avgRest, density,
      xp: totalXp, level: levelInfo(totalXp), title: title(levelInfo(totalXp).level),
      streak: streaks(state), prs: prCount(state, 28), prsAll: prCount(state, 3650),
      exercises: trainedExerciseIds(state, 3650).length,
    };
  }

  return {
    DAY, ATTRIBUTES, GROUP_ORDER, LANDMARKS, STANDARDS, TIERS, ACHIEVEMENTS,
    clamp, num, interp, tierOf, est1RM, setVolume, entryStats, liftKey, isCoreLift,
    exInfo, exName, exMode, exGroups, bodyweight, bestFor, seriesFor, compareLast,
    attributes, muscleGroups, weakPoints, prTable, prCount, streaks, xp, levelInfo,
    title, achievements, newAchievements, achievementContext, summary, windowWorkouts,
    trainedExerciseIds, bestLifts, liftScore, FIXES, suggestFor, dstr,
    nextTarget, kgStep,
    attributeHistory, volumeWeeks, deloadCheck, targetProgress,
    exportNoteShorthand, dayMap, freshness, bodyFatProgress, belowEssentialBF, ESSENTIAL_BF,
  };
})();
if (typeof module !== "undefined") module.exports = Engine;
