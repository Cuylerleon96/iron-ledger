/* macros.js — pure nutrition macro engine. No DOM, no storage, no implicit
   `state`: every input is an ARGUMENT. Same shape as engine.js (an IIFE whose
   whole surface is one explicit return object).

   Chain: RMR -> TDEE -> target kcal -> protein -> fat -> carbs, plus pace bands
   and a closed-loop weight-trend controller. Every output block carries a
   `source` string naming the published reference the number derives from, so a
   claim is auditable.

   Design rules: no decimals, no implied precision (RMR explains ~R^2=0.71 of
   variance), and NEVER a projected completion date. Deficit/surplus targets are
   recommendations for a healthy adult; refuse paths below hand off to a human. */
const Macros = (() => {
  "use strict";

  /* ---------- rounding (honest, not falsely precise) ---------- */
  const roundKcal = (x, step = 10) => Math.round(x / step) * step;
  const round5 = (x) => Math.round(x / 5) * 5;
  const ceil5 = (x) => Math.ceil(x / 5) * 5;   // never round a floor away
  const clampRound5 = (raw, minG) => {
    let g = Math.max(raw, minG);
    g = round5(g);
    if (g < minG) g = ceil5(minG);
    return g;
  };

  /* ---------- citations (verbatim from the brief; do not re-research) ---------- */
  const SOURCES = {
    mifflin:    "Mifflin MD et al., Am J Clin Nutr 1990;51(2):241-247, PMID 2305711",
    rmrFloor:   "ISSN position stand; Harvard Health",
    pal:        "Self-selected PAL overestimates TDEE by ~200-300 kcal/day (PMC4383286); " +
                "individual self-reported activity error runs -25% to +42% (PubMed 10023727)",
    controller: "Intake-balance model: Hall KD 2010 (Am J Physiol Endocrinol Metab); Hall 2011 (Lancet)",
    kcalkg:     "Hall & Chow, Int J Obes 2013 (PMC3859816) — 7700 kcal/kg is a FIRST APPROXIMATION",
    floor:      "Harvard Health; ISSN position stand (LED 800-1200 kcal/day, VLED <800 = medical supervision)",
    protein:    "ISSN 2017 (PMID 28642676); Helms 2014 (PMID 24864135); Iraki 2019 (PMID 31247944)",
    fat:        "IOM DRI AMDR; Helms 2014; Iraki 2019; Whittaker & Wu 2021 (PMID 33741447)",
    carbs:      "IOM DRI — carbohydrate RDA 130 g/day",
    pace:       "Cut-points are OUR arrangement of published ranges, not themselves published. " +
                "Anchor: Garthe 2011 — ~1.4 %BW/wk did not add lean mass (men tended to lose it).",
    phase:      "User-facing names for the SAME pace bands above; the bands are OUR arrangement of " +
                "published ranges (see SOURCES.pace), not published themselves.",
    training:   "WHO 2020 physical-activity guidelines (150-300 min/wk moderate activity); the " +
                "conventional LOW PAL factors 1.2 (sedentary) and 1.375 (lightly active) are from " +
                "FAO/WHO/UNU 2004.",
    goalConflict: "Lean-mass arithmetic is definitional (LBM = weight x (1 - bf/100)). The 'large' " +
                "cut-point is OUR arrangement, not a published number.",
  };

  /* ---------- constants ---------- */
  const KCAL_PER_KG = 7700;                 // first approximation (Hall & Chow 2013)
  const KCAL_PER_KG_SOURCE = SOURCES.kcalkg;
  const CARB_FLOOR = 130;                   // IOM RDA, g/day
  const PROTEIN_FLOOR_G_PER_KG = 0.8;       // absolute, g/kg bodyweight
  const FAT_FLOOR_G_PER_KG = 0.5;           // absolute, g/kg bodyweight
  const FAT_AMDR_LOWER = 0.20;              // IOM AMDR fat lower bound (20% of kcal)
  const AMDR_FAT_SOURCE = SOURCES.fat;
  const FLOORS = { M: 1500, F: 1200 };      // kcal/day
  const FLOOR_SOURCE = SOURCES.floor;

  /* PAL fallback: only the lowest plausible factor, as a temporary starting
     value, because there is no user-facing activity-level input (and there must
     not be one — self-selected PAL overestimates TDEE). */
  const PAL_FALLBACK = { value: 1.2, range: [1.2, 1.375], source: SOURCES.pal };

  /* ---------- pace bands ----------
     kg/week is derived from %bodyweight/week. The cut-points are OUR arrangement
     of published ranges, not themselves published. */
  const PACE_BANDS = {
    "loss-slow":     { goal: "lose",     pctPerWeek: 0.5,  label: "Slow loss" },
    "loss-moderate": { goal: "lose",     pctPerWeek: 0.75, label: "Moderate loss" },
    "loss-fast":     { goal: "lose",     pctPerWeek: 1.0,  label: "Fast loss" },
    "maintain":      { goal: "maintain", pctPerWeek: 0.0,  label: "Maintain" },
    "gain-slow":     { goal: "gain",     pctPerWeek: 0.25, label: "Slow gain" },
    "gain-fast":     { goal: "gain",     pctPerWeek: 0.5,  label: "Faster gain" },
  };
  const DEFAULT_PACE = { lose: "loss-slow", maintain: "maintain", gain: "gain-slow" };

  /* Protein: which printed range we pick a point inside, by goal/convention.
     Units are g per kg of the stated basis (lean mass or bodyweight). */
  const PROTEIN_RANGE = {
    "loss-lean": { lo: 2.3, hi: 3.1 },   // cutting, body fat known -> g/kg LEAN mass
    "loss-bw":   { lo: 1.6, hi: 2.4 },   // cutting, bodyweight       -> g/kg BODYWEIGHT
    "maintain":  { lo: 1.4, hi: 2.0 },   // g/kg bodyweight
    "gain":      { lo: 1.6, hi: 2.2 },   // g/kg bodyweight
  };
  const PROTEIN_PICK = {
    "loss-lean": { slow: 2.4, moderate: 2.7, fast: 3.0 },
    "loss-bw":   { slow: 1.8, moderate: 2.0, fast: 2.2 },
    "maintain":  { slow: 1.5, moderate: 1.6, fast: 1.8 },
    "gain":      { slow: 1.8, moderate: 1.9, fast: 2.0 },
  };
  const FAT_PICK = { "loss-slow": 0.7, "loss-moderate": 0.8, "loss-fast": 1.0, maintain: 0.8, gain: 0.8 };

  /* Warning thresholds (OUR arrangement, not a published cut). */
  const LEAN_BMI = 18.5, HEAVY_BMI = 35;
  const ESSENTIAL_BF = { M: 6, F: 12 };

  /* ---------- helpers ---------- */
  const paceTempo = (key) => {
    const k = String(key || "");
    if (k.indexOf("slow") >= 0) return "slow";
    if (k.indexOf("fast") >= 0) return "fast";
    return "moderate";
  };
  const defaultPace = (goal) => DEFAULT_PACE[goal] || "maintain";
  const bmi = (weightKg, heightCm) => weightKg / Math.pow(heightCm / 100, 2);

  /* ---------- STEP 1: RMR, body fat UNKNOWN (default path) ---------- */
  const rmrMifflin = ({ sex, weightKg, heightCm, ageY }) => {
    const base = 10 * weightKg + 6.25 * heightCm - 5 * ageY;
    const kcal = base + (sex === "F" ? -161 : 5);
    return { kcal, method: "mifflin-weight", sex, source: SOURCES.mifflin };
  };

  /* ---------- STEP 1b: RMR, body fat KNOWN (FFM path) ----------
     LBM = kg*(1 - bf/100). Default regression is Mifflin's own peer-reviewed FFM
     form: 19.7*FFM + 413 — NOT Katch-McArdle (a textbook constant). */
  const rmrFFM = ({ weightKg, bodyFatPct }) => {
    const lbmKg = weightKg * (1 - bodyFatPct / 100);
    const kcal = 19.7 * lbmKg + 413;
    return { kcal, lbmKg, method: "ffm-mifflin", source: SOURCES.mifflin };
  };

  /* Named alternative, exposed but never the default. */
  const rmrCunningham = ({ weightKg, bodyFatPct }) => {
    const lbmKg = weightKg * (1 - bodyFatPct / 100);
    return { kcal: 500 + 22 * lbmKg, lbmKg, method: "ffm-cunningham", source: "Cunningham 1980 (alternative)" };
  };

  const bfKnown = (inputs) => inputs.bodyFatPct != null && isFinite(inputs.bodyFatPct);
  const rmr = (inputs) => (bfKnown(inputs) ? rmrFFM(inputs) : rmrMifflin(inputs));

  /* ---------- STEP 2: fallback TDEE ---------- */
  const tdeeFallback = (rmrKcal, pal = PAL_FALLBACK.value) => ({
    kcal: rmrKcal * pal, pal, method: "fallback", range: PAL_FALLBACK.range, source: SOURCES.pal,
  });

  /* ---------- PACE BANDS: %BW/wk -> kg/wk ---------- */
  const paceRate = (paceKey, weightKg) => {
    const band = PACE_BANDS[paceKey];
    if (!band) return { key: paceKey, recognized: false, reason: `Unknown pace key "${paceKey}".`, source: SOURCES.pace };
    const sign = band.goal === "lose" ? -1 : band.goal === "gain" ? 1 : 0;
    const kgPerWeek = sign * (band.pctPerWeek / 100) * weightKg;
    return {
      key: paceKey, recognized: true, goal: band.goal, label: band.label,
      pctPerWeek: band.pctPerWeek, pctOf: "bodyweight", kgPerWeek, source: SOURCES.pace,
    };
  };

  /* ---------- STEP 3: energy adjustment ---------- */
  const energyAdjustment = (rateKgPerWeek) => ({
    kcalPerDay: rateKgPerWeek * KCAL_PER_KG / 7,
    rateKgPerWeek, kcalPerKg: KCAL_PER_KG, approximation: true,
    source: SOURCES.kcalkg,
  });

  /* ---------- STEP 2b: closed-loop controller ----------
     True TDEE cannot be solved without intake data (two unknowns, one equation),
     so we do NOT solve it. We compute the OBSERVED rate of change (kg/wk) over a
     rolling window from the dated weigh-ins, compare it to the target rate, and
     nudge kcal in the corrective direction by the energy-balance gap. Pure. */
  const MIN_READINGS = 2, MIN_SPAN_DAYS = 5, WINDOW = 4;

  const controller = (targetKcal, series, targetRateKgPerWeek) => {
    const pts = (series || [])
      .map((r) => ({ t: Date.parse(r && r.date), w: r && r.weightKg }))
      .filter((r) => isFinite(r.t) && isFinite(r.w))
      .sort((a, b) => a.t - b.t);
    const target = targetRateKgPerWeek || 0;

    if (pts.length < MIN_READINGS) {
      return {
        kcal: targetKcal, adjusted: false, observedRateKgPerWeek: null,
        reason: `Need at least ${MIN_READINGS} weigh-ins to estimate a trend; have ${pts.length}. No adjustment made.`,
        source: SOURCES.controller,
      };
    }
    const win = pts.slice(-WINDOW);
    const spanDays = (win[win.length - 1].t - win[0].t) / 86400000;
    if (spanDays < MIN_SPAN_DAYS) {
      return {
        kcal: targetKcal, adjusted: false, observedRateKgPerWeek: null,
        reason: `Weigh-ins span only ${Math.round(spanDays)} day(s); need roughly weekly spacing. No adjustment made.`,
        source: SOURCES.controller,
      };
    }
    /* least-squares slope over the window — a rolling average, not a single pair */
    const xs = win.map((r) => (r.t - win[0].t) / 86400000);
    const ys = win.map((r) => r.w);
    const n = win.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += Math.pow(xs[i] - mx, 2); }
    const slopePerDay = den === 0 ? 0 : num / den;
    const observed = slopePerDay * 7;

    const delta = (target - observed) * (KCAL_PER_KG / 7);
    if (Math.abs(delta) < 10) {
      return {
        kcal: targetKcal, adjusted: false, observedRateKgPerWeek: observed,
        reason: `Observed ${observed.toFixed(2)} kg/wk vs target ${target.toFixed(2)} kg/wk — on pace, no change.`,
        source: SOURCES.controller,
      };
    }
    const kcal = roundKcal(targetKcal + delta, 10);
    return {
      kcal, adjusted: true, observedRateKgPerWeek: observed,
      deltaKcalPerDay: roundKcal(delta, 10), window: win.length, spanDays: Math.round(spanDays),
      reason: `Observed ${observed.toFixed(2)} kg/wk vs target ${target.toFixed(2)} kg/wk — ` +
        `nudging ${delta < 0 ? "down" : "up"} by ${Math.abs(Math.round(delta))} kcal/day.`,
      source: SOURCES.controller,
    };
  };

  /* ---------- STEP 5: protein ---------- */
  const protein = (inputs, goal, paceKey) => {
    const bf = bfKnown(inputs);
    const convention = goal === "lose" && bf ? "lean-mass" : "bodyweight";
    const key = goal === "maintain" ? "maintain"
      : goal === "gain" ? "gain"
      : (convention === "lean-mass" ? "loss-lean" : "loss-bw");
    const perKg = PROTEIN_PICK[key][paceTempo(paceKey)];
    const basisKg = convention === "lean-mass" ? inputs.weightKg * (1 - inputs.bodyFatPct / 100) : inputs.weightKg;
    const raw = perKg * basisKg;
    const floorG = PROTEIN_FLOOR_G_PER_KG * inputs.weightKg;
    const g = clampRound5(raw, floorG);
    return {
      g, gPerKg: perKg, basis: convention, basisKg: Math.round(basisKg * 10) / 10,
      range: PROTEIN_RANGE[key], floorGPerKg: PROTEIN_FLOOR_G_PER_KG,
      floorApplied: raw < floorG, source: SOURCES.protein,
    };
  };

  /* ---------- STEP 6: fat (set explicitly, BEFORE carbs) ---------- */
  const fat = (inputs, goal, paceKey, targetKcal) => {
    const w = inputs.weightKg;
    let perKg = goal === "maintain" ? FAT_PICK.maintain : goal === "gain" ? FAT_PICK.gain : (FAT_PICK[paceKey] || 0.8);
    if (targetKcal <= 1500) perKg = Math.max(perKg, 1.0);   // low calories -> higher end
    const raw = perKg * w;
    const floorG = Math.max(FAT_FLOOR_G_PER_KG * w, FAT_AMDR_LOWER * targetKcal / 9);
    const g = clampRound5(raw, floorG);
    return {
      g, gPerKg: perKg, floorG: Math.round(floorG * 10) / 10, floorGPerKg: FAT_FLOOR_G_PER_KG,
      amdrLowerPct: FAT_AMDR_LOWER, floorApplied: raw < floorG, source: SOURCES.fat,
    };
  };

  /* ---------- STEP 7: carbs as the remainder, floored at 130 g ---------- */
  const carbs = (targetKcal, proteinG, fatG) => {
    const raw = (targetKcal - proteinG * 4 - fatG * 9) / 4;
    const floorApplied = raw < CARB_FLOOR;
    const g = clampRound5(raw, CARB_FLOOR);
    return {
      g, raw: Math.round(raw * 10) / 10, floorG: CARB_FLOOR, floorApplied,
      note: floorApplied ? "Target too low, or protein/fat set too high — carbs raised to the 130 g RDA." : null,
      source: SOURCES.carbs,
    };
  };

  /* ---------- refusals (no numbers) and warnings ---------- */
  const refuse = (reason, source) => ({ refused: true, ok: false, reason, source });

  const warningsFor = (inputs, goal) => {
    const out = [];
    const b = bmi(inputs.weightKg, inputs.heightCm);
    const bf = bfKnown(inputs);
    if (inputs.athlete) out.push("Athlete: a formula RMR under-reads trained energy needs — validate against measured intake.");
    if (b < LEAN_BMI || (bf && inputs.bodyFatPct <= ESSENTIAL_BF[inputs.sex]))
      out.push("Very lean: a calorie deficit may be unsafe at this body composition.");
    if (b >= HEAVY_BMI) out.push("Very heavy (BMI >= 35): have a clinician review these targets.");
    return out;
  };

  /* ---------- full plan ---------- */
  const plan = (inputs = {}) => {
    const { sex, weightKg, heightCm, ageY } = inputs;
    const goal = inputs.goal || "maintain";
    const paceKey = inputs.pace || defaultPace(goal);

    /* REFUSE — return a reason and NO numbers. */
    if (ageY == null || !isFinite(ageY))
      return refuse("Age is required for Mifflin-St Jeor (the app has no age field yet).", SOURCES.mifflin);
    if (ageY < 18)
      return refuse("Under 18 — adolescent energy and macro targets need medical supervision, not a formula.", SOURCES.floor);
    if (inputs.pregnant || inputs.lactating)
      return refuse("Pregnancy or lactation — needs clinician-set targets, not a formula.", SOURCES.floor);
    if (inputs.eatingDisorderRisk)
      return refuse("Disclosed eating-disorder risk — calorie and macro targets are not appropriate here.", SOURCES.floor);
    if (weightKg == null || heightCm == null || !isFinite(weightKg) || !isFinite(heightCm))
      return refuse("Weight and height are required.", SOURCES.mifflin);
    if (sex !== "M" && sex !== "F")
      return refuse('Sex must be "M" or "F" (Mifflin-St Jeor is sex-specific).', SOURCES.mifflin);

    const bmr = rmr(inputs);
    const tdee = tdeeFallback(bmr.kcal);
    const pace = paceRate(paceKey, weightKg);
    const targetRate = pace.recognized ? pace.kgPerWeek : 0;
    const adj = energyAdjustment(targetRate);
    const computedTarget = Math.round(tdee.kcal + adj.kcalPerDay);

    const floor = FLOORS[sex];
    let targetKcal = computedTarget;
    let floorApplied = false;
    if (targetKcal < floor) { targetKcal = floor; floorApplied = true; }
    targetKcal = roundKcal(targetKcal, 10);
    if (targetKcal < floor) targetKcal = floor;   // never sub-floor

    const p = protein(inputs, goal, paceKey);
    const f = fat(inputs, goal, paceKey, targetKcal);
    const c = carbs(targetKcal, p.g, f.g);
    const warnings = warningsFor(inputs, goal);
    const notes = [];
    if (floorApplied) notes.push("capped for safety");
    if (c.floorApplied) notes.push("carb remainder below the 130 g RDA — carbs raised");

    return {
      refused: false, ok: true,
      profile: { sex, weightKg, heightCm, ageY, bodyFatPct: inputs.bodyFatPct ?? null, goal, pace: paceKey },
      bmr: { kcal: Math.round(bmr.kcal), method: bmr.method, lbmKg: bmr.lbmKg ?? null, source: bmr.source },
      tdee: { kcal: Math.round(tdee.kcal), pal: tdee.pal, method: "fallback",
              note: "temporary start value; the controller is preferred once weigh-ins exist", source: tdee.source },
      pace: { key: pace.key, label: pace.label, pctPerWeek: pace.pctPerWeek,
              targetRateKgPerWeek: targetRate, source: pace.source },
      target: { kcal: targetKcal, computedTarget, adjustmentKcalPerDay: roundKcal(adj.kcalPerDay, 10),
                targetRateKgPerWeek: targetRate, floor, floorApplied, source: FLOOR_SOURCE },
      protein: { g: p.g, gPerKg: p.gPerKg, basis: p.basis, basisKg: p.basisKg, range: p.range,
                 floorApplied: p.floorApplied, kcal: p.g * 4, source: p.source },
      fat: { g: f.g, gPerKg: f.gPerKg, floorApplied: f.floorApplied, kcal: f.g * 9, source: f.source },
      carbs: { g: c.g, floorApplied: c.floorApplied, kcal: c.g * 4, source: c.source },
      totals: { kcal: p.g * 4 + f.g * 9 + c.g * 4, proteinG: p.g, fatG: f.g, carbsG: c.g },
      warnings, notes,
      source: SOURCES.mifflin,
    };
  };

  /* ============================================================
     ADDITIONS (additive only — plan()/rmr()/controller()/protein()/fat()/
     carbs() above are untouched)
     ============================================================ */

  /* ---------- 1. NAMED TRAINING PHASES ----------
     User-facing CHOICES that map onto the EXISTING pace bands — no new rates.
     A phase is the pairing of a goal with one of the published-derived bands. */
  const PHASES = [
    { key: "maintain", label: "Maintain", goal: "maintain", pace: "maintain",
      blurb: "Eating to stay about the same weight — enough to train and recover without drifting up or down.",
      source: SOURCES.phase },
    { key: "lean-gain", label: "Lean gain", goal: "gain", pace: "gain-slow",
      blurb: "Gaining slowly, so most of what you add is muscle.",
      source: SOURCES.phase },
    { key: "bulk", label: "Bulk", goal: "gain", pace: "gain-fast",
      blurb: "Gaining faster — quicker progress, but more of what you add is fat.",
      source: SOURCES.phase },
    { key: "cut-gradual", label: "Gradual cut", goal: "lose", pace: "loss-slow",
      blurb: "Losing fat slowly, so you keep as much muscle as possible while it comes off.",
      source: SOURCES.phase },
    { key: "cut-standard", label: "Standard cut", goal: "lose", pace: "loss-moderate",
      blurb: "A steady middle-speed cut — a good balance of visible progress and holding onto muscle.",
      source: SOURCES.phase },
    { key: "cut-aggressive", label: "Aggressive cut", goal: "lose", pace: "loss-fast",
      blurb: "The fastest fat loss — and the most likely to cost you muscle.",
      source: SOURCES.phase },
  ];

  const phaseByKey = (key) => PHASES.filter((p) => p.key === String(key || ""))[0] || null;
  const phaseFor = (key) => {
    const p = phaseByKey(key);
    return p ? Object.assign({}, p) : null;
  };

  /* Default CHOICE for a goal direction, with the reason stated. */
  const recommendedPhase = (inputs = {}) => {
    const goal = (inputs && inputs.goal) || "maintain";
    if (goal === "gain") {
      const p = phaseFor("lean-gain");
      p.reason = "Default for a gaining goal: the slowest gain band adds the least fat for the same training.";
      return p;
    }
    if (goal === "lose") {
      const p = phaseFor("cut-gradual");
      p.reason = "Default for a cutting goal: the slowest loss band best preserves muscle.";
      return p;
    }
    const p = phaseFor("maintain");
    p.reason = "No gain or loss goal set, so the neutral band is the default.";
    return p;
  };

  /* The UI may pass EITHER a phase key OR goal+pace. A phase KEY WINS if both are
     given (it is the more specific, already-resolved choice). */
  const resolvePhase = (sel = {}) => {
    const asObj = (typeof sel === "string") ? { phase: sel } : (sel || {});
    if (asObj.phase) {
      const p = phaseByKey(asObj.phase);
      if (!p) return { recognized: false, resolvedBy: "phase-key", key: String(asObj.phase),
        reason: `Unknown phase key "${asObj.phase}".`, source: SOURCES.phase };
      return Object.assign({ recognized: true, resolvedBy: "phase-key" }, p);
    }
    if (asObj.pace) {
      const p = PHASES.filter((x) => x.pace === asObj.pace)[0] || null;
      if (!p) return { recognized: false, resolvedBy: "pace", key: null,
        reason: `No phase uses pace "${asObj.pace}".`, source: SOURCES.phase };
      return Object.assign({ recognized: true, resolvedBy: "pace" }, p);
    }
    if (asObj.goal) {
      return Object.assign({ recognized: true, resolvedBy: "goal" }, recommendedPhase(asObj));
    }
    return { recognized: false, resolvedBy: "none", key: null,
      reason: "No phase key, pace or goal supplied.", source: SOURCES.phase };
  };

  /* ---------- 2. GOAL-CONFLICT CHECK ----------
     A profile can carry two goals that pull in opposite directions. Compare the
     DIRECTION of the weight goal against the DIRECTION of the body-fat goal. */
  const LARGE_LEAN_CHANGE_KG = 5;
  const LARGE_LEAN_CHANGE_SOURCE =
    "Arrangement, not a published cut-point. Rationale: a trained lifter adds on the order of " +
    "1-2 kg of lean mass in a normal 12-16 week gaining phase, and a body-fat measurement carries " +
    "a few kg of error at these weights, so 5 kg sits clearly beyond one realistic phase.";

  const goalConflict = (inputs = {}) => {
    const src = SOURCES.goalConflict;
    const num = (v) => (v == null || !isFinite(v)) ? null : Number(v);
    const w = num(inputs.weightKg), gw = num(inputs.goalWeightKg);
    const bf = num(inputs.bodyFatPct), gbf = num(inputs.goalBodyFatPct);
    const fmt = (x) => (Math.round(x * 10) / 10).toFixed(1);

    if (bf == null || gbf == null)
      return { conflict: false, kind: null, requiredLeanChangeKg: null, large: false,
        note: "Not enough data — both a current and a goal body-fat percentage are needed to " +
              "compare the two goals. No value is invented.",
        reason: "not enough data", source: src };
    if (w == null || gw == null)
      return { conflict: false, kind: null, requiredLeanChangeKg: null, large: false,
        note: "Not enough data — both a current and a goal weight are needed to compare the two goals.",
        reason: "not enough data", source: src };

    const currentLBM = w * (1 - bf / 100);
    const goalLBM = gw * (1 - gbf / 100);
    const requiredLeanChangeKg = goalLBM - currentLBM;
    const large = Math.abs(requiredLeanChangeKg) >= LARGE_LEAN_CHANGE_KG;
    const wDir = Math.sign(gw - w);
    const bfDir = Math.sign(gbf - bf);

    if (wDir > 0 && bfDir < 0) {
      const note =
        `Gaining weight while reducing body fat implies adding about ${fmt(requiredLeanChangeKg)} kg of ` +
        `pure lean mass while your fat mass goes DOWN. A real gaining phase adds some fat alongside the ` +
        `muscle, so these two goals pull against each other${large ? ` — and this one is large` : ""}. ` +
        `Lead with the weight goal (a gaining phase) and treat the ${gbf}% body-fat target as a separate ` +
        `later cut; chasing both at once usually delivers neither.`;
      return { conflict: true, kind: "gain-while-cutting-fat", requiredLeanChangeKg, large, note, source: src };
    }
    if (wDir < 0 && bfDir > 0) {
      const note =
        `Losing weight while body fat goes UP means the weight you lose is lean mass while you add fat — ` +
        `the opposite of what most people want. Lead with preserving lean mass: keep protein high and keep ` +
        `training, and re-check which goal is realistic.`;
      return { conflict: true, kind: "lose-while-gaining-fat", requiredLeanChangeKg, large, note, source: src };
    }
    return { conflict: false, kind: null, requiredLeanChangeKg, large: false,
      note: "Weight and body-fat goals point the same way (or one is unchanged) — no conflict.",
      source: src };
  };

  /* ---------- 3. TRAINING-INFORMED STARTING ACTIVITY FACTOR ----------
     Use the user's OWN LOGGED training to choose between the two CONVENTIONAL LOW
     factors only. This is a WEAK signal, so it never becomes a continuous formula
     and there is never a user-selected dropdown (self-selected PAL overestimates
     TDEE by ~200-300 kcal/day). */
  const TRAINING_CAVEAT =
    "Weak, low-range estimate: a PAL derived from logged training is systematically biased and " +
    "individual-level error runs ~50-60%. It only chooses between the two lowest conventional " +
    "factors (1.2 sedentary / 1.375 light). Once weigh-ins exist the closed-loop controller " +
    "supersedes this starting value.";

  const activityFactor = (inputs = {}, training = {}) => {
    const t = training || {};
    const s = (t.sessionsPerWeek == null || !isFinite(t.sessionsPerWeek)) ? 0 : Number(t.sessionsPerWeek);
    const c = (t.cardioMinutesPerWeek == null || !isFinite(t.cardioMinutesPerWeek)) ? 0 : Number(t.cardioMinutesPerWeek);
    const hasTraining = s > 0 || c > 0;
    const active = s >= 3 || c >= 150;          // 3 sessions, or the WHO 150 min/wk
    const pal = active ? 1.375 : 1.2;

    let basis;
    if (!hasTraining) {
      basis = "no training logged";
    } else {
      const parts = [];
      if (s > 0) parts.push(`${s} training session${s === 1 ? "" : "s"}/week logged`);
      if (c > 0) parts.push(`${c} min/week cardio logged`);
      basis = parts.join("; ");
      if (!active) basis += " — below the 3-session / 150-min thresholds, so the sedentary factor is used";
    }
    return {
      pal, method: active ? "logged-training-light" : "logged-training-sedentary",
      basis, thresholds: { sessionsPerWeek: 3, cardioMinutesPerWeek: 150 },
      source: SOURCES.training, caveat: TRAINING_CAVEAT,
    };
  };

  return {
    /* constants */
    KCAL_PER_KG, KCAL_PER_KG_SOURCE, CARB_FLOOR, PROTEIN_FLOOR_G_PER_KG, FAT_FLOOR_G_PER_KG,
    FAT_AMDR_LOWER, AMDR_FAT_SOURCE, FLOORS, FLOOR_SOURCE, PAL_FALLBACK, SOURCES,
    PACE_BANDS, DEFAULT_PACE, PROTEIN_RANGE, PROTEIN_PICK, FAT_PICK,
    LEAN_BMI, HEAVY_BMI, ESSENTIAL_BF, MIN_READINGS, MIN_SPAN_DAYS, WINDOW,
    /* rounding */
    roundKcal, round5, ceil5, clampRound5,
    /* rmr */
    rmr, rmrMifflin, rmrFFM, rmrCunningham,
    /* tdee / pace / controller */
    tdeeFallback, paceRate, energyAdjustment, controller,
    /* macros */
    protein, fat, carbs,
    /* orchestration */
    refuse, warningsFor, plan, bmi, paceTempo, defaultPace,
    /* additions: named phases, goal conflict, training-informed activity factor */
    PHASES, phaseFor, recommendedPhase, resolvePhase,
    goalConflict, LARGE_LEAN_CHANGE_KG, LARGE_LEAN_CHANGE_SOURCE,
    activityFactor, TRAINING_CAVEAT,
  };
})();
if (typeof module !== "undefined") module.exports = Macros;
