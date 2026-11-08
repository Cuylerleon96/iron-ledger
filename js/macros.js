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
    cunningham: "Cunningham JJ, Am J Clin Nutr 1980;33(11):2372-2374 (RMR = 500 + 22 x lean mass)",
    katch:      "Katch & McArdle, Exercise Physiology (textbook constant; 370 + 21.6 x lean mass)",
    rmrCaveat:  "RMR regression equations — Mifflin, Cunningham, Katch-McArdle — each explain only " +
                "about R^2 = 0.71 of the variance in measured resting energy. Choosing the better " +
                "default removes a known BIAS; it does NOT turn the number into a measurement.",
    activityLevel: "The conventional FAO/WHO/UNU PAL bands (1.2 sedentary / 1.375 light / 1.55 " +
                "moderate / 1.725 very active), used only as a STARTING value; a self-selected PAL " +
                "overestimates TDEE by ~200-300 kcal/day (PMC4383286) and individual self-reported " +
                "activity error runs -25% to +42% (PubMed 10023727).",
    observed:   "Energy-balance identity solved from LOGGED intake and a WEIGHED trend: " +
                "TDEE = mean daily intake - (weight trend kg/day x 7700). It holds only once intake " +
                "AND weight are logged — the 'two unknowns, one equation' limit of intake-unlogged " +
                "data no longer applies.",
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
    /* Added for the nutrition-polish batch. These THREE refusals previously
       carried the INTAKE-FLOOR citation (SOURCES.floor), which is evidence for a
       calorie floor — not for being under 18, pregnant, or at eating-disorder
       risk. Each now carries its own source. Verified 2026-11-08 against:
         - PMID 2305711 (Mifflin-St Jeor): "498 healthy subjects ... aged 19-78 y"
         - CDC, Weight Gain During Pregnancy: "about 340 additional daily calories
           during the second trimester and about 450 additional daily calories
           during the third trimester"
         - NICE NG69, Eating disorders: recognition and treatment (2017, updated
           2020), rec. 1.1.x and "Only offer dietary counselling as part of a
           multidisciplinary approach." */
    under18: "Mifflin MD et al., Am J Clin Nutr 1990;51(2):241-247, PMID 2305711 — the equation was " +
                "derived in 498 healthy ADULTS aged 19-78 y, so it is OUTSIDE its validation range " +
                "under 18. NOT CITED AS EVIDENCE: the 'needs medical supervision' part. No specific " +
                "publication was verified that sets a supervised adolescent calorie target — that is a " +
                "clinical-care statement, not a numeric claim, so it is stated as guidance rather than " +
                "dressed up as a citation.",
    pregnancy: "CDC, Weight Gain During Pregnancy — about +340 kcal/day in the 2nd trimester and " +
                "+450 kcal/day in the 3rd, and lactation carries its own added energy requirement. A " +
                "Mifflin-RMR x PAL formula has no term for any of those additions, so it cannot " +
                "produce a pregnancy or lactation target.",
    eatingDisorder: "NICE NG69, Eating disorders: recognition and treatment (2017, updated 2020) — " +
                "assessment and treatment are clinical, and dietary counselling is offered only as part " +
                "of a multidisciplinary approach. A formula-derived calorie/macro target is part of that " +
                "clinical care, not something the app can hand out.",
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
    return { kcal, method: "mifflin-weight", sex, source: SOURCES.mifflin,
      basis: "Mifflin-St Jeor weight form (10 x weight + 6.25 x height - 5 x age, +5 / -161)" };
  };

  /* ---------- STEP 1b: RMR, body fat KNOWN (FFM path) ----------
     LBM = kg*(1 - bf/100). DEFAULT regression is CUNNINGHAM: 500 + 22*LBM.
     It REPLACED Mifflin's own FFM form (19.7*FFM + 413) because that form, for a
     lean person, returned a LOWER RMR than the plain weight equation — the exact
     opposite of the reason the FFM path is preferred for lean/muscular people
     (a lean profile). Cunningham is peer-reviewed and behaves
     as the literature describes for lean individuals. HONEST CAVEAT: both are
     peer-reviewed with R^2 ~0.71, so this removes a known BIAS — it does not make
     the number a measurement. */
  const rmrFFM = ({ weightKg, bodyFatPct }) => {
    const lbmKg = weightKg * (1 - bodyFatPct / 100);
    const kcal = 500 + 22 * lbmKg;
    return { kcal, lbmKg, method: "ffm-cunningham", source: SOURCES.cunningham,
      basis: "Cunningham fat-free-mass form (500 + 22 x lean mass) — the DEFAULT FFM path; " +
             "changed from Mifflin-FFM (19.7 x lean mass + 413), which under-stated RMR for lean people" };
  };

  /* Named alternatives, exposed but NEVER the default. */
  const rmrMifflinFFM = ({ weightKg, bodyFatPct }) => {
    const lbmKg = weightKg * (1 - bodyFatPct / 100);
    return { kcal: 19.7 * lbmKg + 413, lbmKg, method: "ffm-mifflin", source: SOURCES.mifflin,
      basis: "Mifflin fat-free-mass form (19.7 x lean mass + 413) — named alternative, not the default" };
  };
  const rmrKatch = ({ weightKg, bodyFatPct }) => {
    const lbmKg = weightKg * (1 - bodyFatPct / 100);
    return { kcal: 370 + 21.6 * lbmKg, lbmKg, method: "ffm-katch", source: SOURCES.katch,
      basis: "Katch-McArdle (370 + 21.6 x lean mass) — named alternative, not the default" };
  };
  /* The default FFM path, kept under its own name for callers that used it. */
  const rmrCunningham = rmrFFM;

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
    /* Sex is read here ONLY to pick the essential-fat threshold. When it is not
       set, fall back to the HIGHER threshold (F = 12%) so a very-lean reading is
       still flagged — a safety warning must never be silently dropped just
       because sex is missing. */
    const essSex = inputs.sex === "M" ? "M" : "F";
    if (b < LEAN_BMI || (bf && inputs.bodyFatPct <= ESSENTIAL_BF[essSex]))
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
      return refuse("Add your birth year in Profile so we can work out your age for Mifflin-St Jeor.", SOURCES.mifflin);
    if (ageY < 18)
      return refuse("Under 18 — adolescent energy and macro targets need medical supervision, not a formula.", SOURCES.under18);
    if (inputs.pregnant || inputs.lactating)
      return refuse("Pregnancy or lactation — needs clinician-set targets, not a formula.", SOURCES.pregnancy);
    if (inputs.eatingDisorderRisk)
      return refuse("Disclosed eating-disorder risk — calorie and macro targets are not appropriate here.", SOURCES.eatingDisorder);
    if (weightKg == null || heightCm == null || !isFinite(weightKg) || !isFinite(heightCm))
      return refuse("Weight and height are required.", SOURCES.mifflin);
    /* Sex: the WEIGHT-based Mifflin form needs it, and so does the intake floor.
       It is NOT needed by the FFM path — rmrFFM (Cunningham) reads weight +
       body-fat % only, taking no sex argument — so a profile that knows its
       body-fat % can be planned without sex. Only when NEITHER sex NOR body-fat
       % is available does this refuse, and even then it says what to do rather
       than issuing a "must". */
    const sexKnown = sex === "M" || sex === "F";
    if (!sexKnown && !bfKnown(inputs))
      return refuse("We won't guess this one. Set your sex in Profile — or add a body-fat % " +
        "and we'll use the lean-mass equation instead, which doesn't need it.", SOURCES.mifflin);

    const bmr = rmr(inputs);
    /* `pal` is optional and additive: when the UI supplies the factor DERIVED
       from logged training (see activityFactor), the plan uses it, so the number
       shown on the maintenance line is the number the targets were built from.
       Omitted, tdeeFallback keeps its own default — existing callers unchanged. */
    const tdee = tdeeFallback(bmr.kcal, inputs.pal);
    const pace = paceRate(paceKey, weightKg);
    const targetRate = pace.recognized ? pace.kgPerWeek : 0;
    const adj = energyAdjustment(targetRate);
    const computedTarget = Math.round(tdee.kcal + adj.kcalPerDay);

    /* The intake floor is sex-specific (1500 M / 1200 F). When sex is not set we
       use the HIGHER floor — FLOORS.M = 1500 — the conservative choice, so the
       plan never lands under what either floor intends. Reported as
       `floorAssumed` so the UI can say plainly that sex was missing. */
    const floorSex = sexKnown ? sex : "M";
    const floor = FLOORS[floorSex];
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
      bmr: { kcal: Math.round(bmr.kcal), method: bmr.method, lbmKg: bmr.lbmKg ?? null, source: bmr.source,
             basis: bmr.basis ?? null },
      tdee: { kcal: Math.round(tdee.kcal), pal: tdee.pal, method: "fallback",
              note: "temporary start value; the controller is preferred once weigh-ins exist", source: tdee.source },
      pace: { key: pace.key, label: pace.label, pctPerWeek: pace.pctPerWeek,
              targetRateKgPerWeek: targetRate, source: pace.source },
      target: { kcal: targetKcal, computedTarget, adjustmentKcalPerDay: roundKcal(adj.kcalPerDay, 10),
                targetRateKgPerWeek: targetRate, floor, floorSex, floorAssumed: !sexKnown,
                floorApplied, source: FLOOR_SOURCE },
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

  /* ---------- 3. ACTIVITY FACTOR: declared level, then observed, then training ----------
     PRECEDENCE (report which one was used, and why, every time):
       (1) OBSERVED factor        — when the gate in observedTdee() passes (see below).
       (2) DECLARED level         — the user's own starting level (a Profile fact).
       (3) TRAINING-derived value — the existing weak, low-range estimate.
       (4) the 1.2 PAL fallback   — when there is no level and no training logged.

     AMENDMENT (2026-11-08): the earlier rule was "ship NO activity dropdown"
     because a self-selected PAL overestimates TDEE (PMC4383286; error -25% to
     +42%, PubMed 10023727). That rule is AMENDED: a NEW user MAY set a starting
     activity level. The guardrail is that the self-chosen value is only a STARTING
     value and is REPLACED by an OBSERVED factor once intake AND weight are logged
     (observedTdee below). The caveat is shown in the UI, not hidden. */
  const ACTIVITY_LEVELS = [
    { key: "sedentary",   label: "Sedentary",   factor: 1.2,   blurb: "desk job, little exercise" },
    { key: "light",       label: "Light",       factor: 1.375, blurb: "light exercise 1-3 days a week" },
    { key: "moderate",    label: "Moderate",    factor: 1.55,  blurb: "moderate exercise 3-5 days a week" },
    { key: "very-active", label: "Very active", factor: 1.725, blurb: "hard exercise 6-7 days a week" },
  ];
  const activityLevelFor = (key) => {
    const k = String(key == null ? "" : key);
    return ACTIVITY_LEVELS.filter((l) => l.key === k)[0] || null;
  };
  const ACTIVITY_LEVEL_CAVEAT =
    "A starting estimate you chose, not a measurement. After a couple of weeks your own logged " +
    "intake and weigh-ins replace it with an observed value.";
  const OBSERVED_CAVEAT =
    "Observed from your own logs — closer to a measurement than any formula, but still an " +
    "estimate: self-reported intake is UNDER-REPORTED by a large margin; 7700 kcal/kg is a FIRST " +
    "APPROXIMATION (Hall & Chow 2013) and drifts as body composition changes; the window must be " +
    "long enough that weight NOISE does not dominate; and this method CANNOT tell non-adherence " +
    "from metabolic drift.";

  const TRAINING_CAVEAT =
    "Weak, low-range estimate: a PAL derived from logged training is systematically biased and " +
    "individual-level error runs ~50-60%. It only chooses between the two lowest conventional " +
    "factors (1.2 sedentary / 1.375 light). Once weigh-ins exist the closed-loop controller " +
    "supersedes this starting value.";

  /* ---------- 3b. OBSERVED ACTIVITY FACTOR (the real payload) ----------
     Once the user LOGS INTAKE and WEIGHS IN, the energy-balance identity can be
     solved for TDEE — the "two unknowns, one equation" problem the research flagged
     only holds while intake is unlogged. PURE: every input is an argument; the
     window end is derived from the DATA (the latest dated entry), never from the
     clock. Returns null below the gate — an observation is NEVER invented from
     thin data.
        TDEE(kcal/day) = mean daily logged intake - (weight trend kg/day x 7700) */
  const OBS_MIN_WEIGHINS = 2, OBS_MIN_WEIGHIN_SPAN_DAYS = 5, OBS_MIN_INTAKE_DAYS = 10, OBS_WINDOW_DAYS = 14;

  function observedTdee(opts = {}) {
    const intakes = opts.intakes || [];
    const bodylog = opts.bodylog || [];
    const windowDays = (opts.windowDays == null || !isFinite(opts.windowDays)) ? OBS_WINDOW_DAYS : Number(opts.windowDays);
    const rmrKcal = (opts.rmrKcal == null || !isFinite(opts.rmrKcal)) ? null : Number(opts.rmrKcal);

    const di = intakes
      .map((e) => ({ date: e && e.date, t: Date.parse(e && e.date),
                     kcal: e && e.macros && e.macros.kcal }))
      .filter((r) => isFinite(r.t) && r.kcal != null && isFinite(Number(r.kcal)))
      .map((r) => ({ date: String(r.date).slice(0, 10), t: r.t, kcal: Number(r.kcal) }));
    const dw = bodylog
      .map((b) => ({ date: b && b.date, t: Date.parse(b && b.date), w: b && b.weightKg }))
      .filter((r) => isFinite(r.t) && r.w != null && isFinite(Number(r.w)) && Number(r.w) > 0)
      .map((r) => ({ date: String(r.date).slice(0, 10), t: r.t, w: Number(r.w) }));
    if (!di.length || !dw.length) return null;

    /* Window end = the latest DATED entry of any kind (pure: derived from data). */
    const end = Math.max.apply(null, di.map((r) => r.t).concat(dw.map((r) => r.t)));
    const start = end - windowDays * 86400000;
    const inWin = (r) => r.t >= start && r.t <= end;

    const iw = di.filter(inWin);
    const ww = dw.filter(inWin).sort((a, b) => a.t - b.t);
    const n = new Set(iw.map((r) => r.date)).size;            // distinct days with intake logged
    const nW = ww.length;
    const spanDays = nW >= 2 ? (ww[nW - 1].t - ww[0].t) / 86400000 : 0;

    /* THE GATE — below it, return null and let the declared/training value stand. */
    if (nW < OBS_MIN_WEIGHINS || spanDays < OBS_MIN_WEIGHIN_SPAN_DAYS || n < OBS_MIN_INTAKE_DAYS) return null;

    const meanDailyIntake = iw.reduce((a, r) => a + r.kcal, 0) / n;
    const t0 = ww[0].t;
    const xs = ww.map((r) => (r.t - t0) / 86400000), ys = ww.map((r) => r.w);
    const mx = xs.reduce((a, b) => a + b, 0) / nW, my = ys.reduce((a, b) => a + b, 0) / nW;
    let num = 0, den = 0;
    for (let i = 0; i < nW; i++) { num += (xs[i] - mx) * (ys[i] - my); den += Math.pow(xs[i] - mx, 2); }
    const slopePerDay = den === 0 ? 0 : num / den;            // kg/day (least squares over weigh-ins)
    const trendKgPerWeek = slopePerDay * 7;
    const kcalPerDay = meanDailyIntake - slopePerDay * KCAL_PER_KG;
    const factor = rmrKcal ? kcalPerDay / rmrKcal : null;

    return {
      kcalPerDay, factor, n, spanDays: Math.round(spanDays), weighIns: nW, windowDays,
      meanDailyIntake, trendKgPerWeek,
      basis: `Observed from ${n} days of logged intake and ${nW} weigh-ins over ${Math.round(spanDays)} days ` +
             `(mean intake ${Math.round(meanDailyIntake)} kcal/day, weight trend ${trendKgPerWeek.toFixed(2)} kg/week)`,
      caveat: OBSERVED_CAVEAT,
      approximation: { kcalPerKg: KCAL_PER_KG, label: "7700 kcal/kg is a FIRST APPROXIMATION (Hall & Chow 2013)" },
      source: SOURCES.observed,
    };
  }

  const activityFactor = (inputs = {}, training = {}, observed = null) => {
    /* (1) OBSERVED — wins whenever the gate passed. */
    if (observed && observed.factor != null && isFinite(observed.factor)) {
      return {
        pal: observed.factor, method: "observed", tier: 1,
        basis: observed.basis, source: SOURCES.observed,
        caveat: observed.caveat || OBSERVED_CAVEAT,
        n: observed.n, spanDays: observed.spanDays, weighIns: observed.weighIns,
        why: "observed: your own logged intake and weigh-ins passed the gate, so the formula is replaced",
      };
    }
    /* (2) DECLARED — the user's own starting level (a Profile fact). */
    const lvl = activityLevelFor(inputs && inputs.activityLevel);
    if (lvl) {
      return {
        pal: lvl.factor, method: "declared", tier: 2, level: lvl.key, label: lvl.label,
        basis: `you set your activity level to "${lvl.label}" (${lvl.blurb}) — a starting estimate`,
        source: SOURCES.activityLevel, caveat: ACTIVITY_LEVEL_CAVEAT,
        why: "you set this level; it is a starting estimate until logs replace it",
      };
    }
    /* (3) TRAINING-derived — the existing weak, low-range estimate. */
    const t = training || {};
    const s = (t.sessionsPerWeek == null || !isFinite(t.sessionsPerWeek)) ? 0 : Number(t.sessionsPerWeek);
    const c = (t.cardioMinutesPerWeek == null || !isFinite(t.cardioMinutesPerWeek)) ? 0 : Number(t.cardioMinutesPerWeek);
    if (s > 0 || c > 0) {
      const active = s >= 3 || c >= 150;          // 3 sessions, or the WHO 150 min/wk
      const pal = active ? 1.375 : 1.2;
      const parts = [];
      if (s > 0) parts.push(`${s} training session${s === 1 ? "" : "s"}/week logged`);
      if (c > 0) parts.push(`${c} min/week cardio logged`);
      let basis = parts.join("; ");
      if (!active) basis += " — below the 3-session / 150-min thresholds, so the sedentary factor is used";
      return {
        pal, method: active ? "logged-training-light" : "logged-training-sedentary", tier: 3,
        basis, thresholds: { sessionsPerWeek: 3, cardioMinutesPerWeek: 150 },
        source: SOURCES.training, caveat: TRAINING_CAVEAT,
        why: "derived from the training you logged; no activity level set and no observation yet",
      };
    }
    /* (4) FALLBACK — no declared level and no training logged. */
    return {
      pal: PAL_FALLBACK.value, method: "fallback", tier: 4, basis: "no training logged",
      source: SOURCES.pal, caveat: TRAINING_CAVEAT,
      why: "no activity level set and no training logged, so the low conventional 1.2 start value is used",
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
    rmr, rmrMifflin, rmrFFM, rmrCunningham, rmrMifflinFFM, rmrKatch,
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
    ACTIVITY_LEVELS, activityLevelFor, ACTIVITY_LEVEL_CAVEAT, OBSERVED_CAVEAT,
    observedTdee, OBS_MIN_WEIGHINS, OBS_MIN_WEIGHIN_SPAN_DAYS, OBS_MIN_INTAKE_DAYS, OBS_WINDOW_DAYS,
  };
})();
if (typeof module !== "undefined") module.exports = Macros;
