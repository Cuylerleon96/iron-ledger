/* nutrition.js — the Nutrition tab's view-model. PURE: no DOM, no storage, no
   implicit state — the profile and the training summary are ARGUMENTS, exactly
   like macros.js / food.js. It turns Macros' numbers into the sentences the user
   reads, so the tab can be tested in a bare sandbox without a browser.

   Rules this file enforces, so the UI cannot quietly break them:
     - Nothing numeric is shown without its reason. Each target carries a
       one-line plain-language `reason` built from the engine's OWN output
       (gPerKg, basis, floorApplied, the pace adjustment) — never invented.
     - No age is ever invented. A missing or nonsense birth year shows a pointer
       to Profile and NO numbers at all.
     - A refusal from the engine is shown INSTEAD of targets, never alongside a
       number the engine refused to give.
     - The intake floor and the maintenance caveat are shown verbatim.
   Loaded AFTER macros.js (it reads the global Macros). */
const Nutrition = (() => {
  "use strict";

  const MAX_AGE = 120;                       // oldest a birth year may imply
  const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- birth year ----------
     Four digits, not in the future, and within the last MAX_AGE years. Anything
     else is treated as UNSET, so no age is ever derived from nonsense. */
  function validBirthYear(y, year) {
    const cy = year || new Date().getFullYear();
    const s = (typeof y === "string") ? y.trim() : y;
    if (s === null || s === undefined || s === "") return null;
    const n = Number(s);
    if (!isFinite(n) || Math.floor(n) !== n) return null;   // integers only
    if (n < 1000 || n > 9999) return null;                  // must be 4 digits
    if (n > cy) return null;                                // no future year
    if (n < cy - MAX_AGE) return null;                      // rejects 1800 etc.
    return n;
  }

  function ageFrom(profile, year) {
    const cy = year || new Date().getFullYear();
    const by = validBirthYear(profile && profile.birthYear, cy);
    return by == null ? null : cy - by;
  }

  /* ---------- goal direction from the profile's own numbers ----------
     The profile has no goal dropdown; the direction is DERIVED from the current
     weight vs the goal weight, the same way the activity factor is derived. */
  function goalFromProfile(p) {
    p = p || {};
    const w = num(p.weightKg), gw = num(p.goalWeightKg);
    if (w == null || gw == null || w <= 0) return "maintain";
    const diff = gw - w;
    if (Math.abs(diff) < 0.01 * w) return "maintain";       // within ~1% is neutral
    return diff > 0 ? "gain" : "lose";
  }

  /* ---------- training summary (last 7 days) ----------
     Feeds Macros.activityFactor. Kept here (not in the UI) so it is testable and
     the same numbers drive the factor and its stated basis. */
  function trainingFor(workouts, todayStr, exMode) {
    const t0 = Date.parse(todayStr);
    let sessions = 0, cardioMin = 0;
    (workouts || []).forEach((w) => {
      const t = Date.parse(w && w.date);
      if (!isFinite(t) || !isFinite(t0)) return;
      const days = (t0 - t) / 86400000;
      if (days < 0 || days > 7) return;                     // last 7 days, today inclusive
      sessions++;
      (w.entries || []).forEach((en) => {
        const mode = exMode ? exMode(en.id) : (en.mode || "");
        if (mode !== "distance_time") return;
        (en.sets || []).forEach((s) => {
          const sec = num(s && s.t);
          if (sec != null && sec > 0) cardioMin += sec / 60;
        });
      });
    });
    return { sessionsPerWeek: sessions, cardioMinutesPerWeek: Math.round(cardioMin) };
  }

  /* ---------- reason lines ----------
     One line each, built from the engine's own figures. */
  const GOAL_WORD = { gain: "gaining", lose: "cutting", maintain: "maintaining" };
  const BASIS_WORD = { "bodyweight": "bodyweight", "lean-mass": "lean mass" };

  function calorieReason(plan, phase) {
    if (plan.target.floorApplied)
      return "Raised to the " + plan.target.floor + " kcal/day safety floor — maintenance plus the " +
        phase.label + " adjustment fell below it.";
    const adj = plan.target.adjustmentKcalPerDay || 0;
    const dir = adj < 0 ? "down" : adj > 0 ? "up" : "level";
    return "Your maintenance estimate, adjusted " + dir + " by " + Math.abs(adj) +
      " kcal/day for the " + phase.label + " pace.";
  }
  function proteinReason(plan, goal) {
    const p = plan.protein;
    const flavor = goal === "gain" ? "enough to build with"
      : goal === "lose" ? "set high to protect muscle while it comes off"
      : "enough to hold what you have";
    return p.gPerKg + " g per kg of " + (BASIS_WORD[p.basis] || p.basis) +
      " — because you're " + (GOAL_WORD[goal] || "training") + ", " + flavor + ".";
  }
  function fatReason(plan) {
    const f = plan.fat;
    return f.gPerKg + " g per kg of bodyweight — set above the essential-fat floor and the " +
      "20% AMDR lower bound, so hormones and recovery are covered.";
  }
  function carbsReason(plan) {
    return plan.carbs.floorApplied
      ? "The calories left after protein and fat — floored at the " + Macros.CARB_FLOOR + " g/day RDA."
      : "The calories left after protein and fat, rounded to the nearest 5 g.";
  }

  /* ---------- the view model ---------- */
  function view(profile, cfg) {
    profile = profile || {};
    cfg = cfg || {};
    const year = cfg.year || new Date().getFullYear();

    const base = { phaseKeys: Macros.PHASES.map((p) => p.key), phases: Macros.PHASES.map((p) => ({ key: p.key, label: p.label, blurb: p.blurb })) };

    /* --- no birth year: no age is invented, no numbers at all --- */
    const age = ageFrom(profile, year);
    if (age == null) {
      const html =
        '<div class="card-head"><h3>Nutrition</h3><span class="muted">not set up yet</span></div>' +
        '<p class="n-hint" id="n-need-birthyear">Add your birth year in Profile to see your targets.</p>' +
        '<p class="muted small">Calorie and macro targets depend on your age, so nothing is shown ' +
        'until it is set. The tab fills in as soon as you add it.</p>';
      return Object.assign(base, { state: "no-birth-year", age: null, targets: null, html });
    }

    /* --- phase: the caller's choice, else the engine's recommendation --- */
    const goal = goalFromProfile(profile);
    const rec = Macros.recommendedPhase({ goal });
    const phaseKey = (cfg.phase && Macros.phaseFor(cfg.phase)) ? cfg.phase : rec.key;
    const phase = Macros.phaseFor(phaseKey);

    /* --- the plan. The activity factor is DERIVED from logged training, never a
           dropdown, and is passed into the plan so the number shown is the number
           used. --- */
    const training = cfg.training || { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 };
    const activity = Macros.activityFactor(profile, training);

    const plan = Macros.plan({
      sex: profile.sex, weightKg: num(profile.weightKg), heightCm: num(profile.heightCm),
      ageY: age, bodyFatPct: num(profile.bodyFatPct),
      goal: phase.goal, pace: phase.pace, pal: activity.pal,
    });

    /* --- refusal (under 18, or a missing required field): refusal INSTEAD of any
           number the engine would not give --- */
    if (plan.refused) {
      const html =
        '<div class="card-head"><h3>Nutrition</h3><span class="muted">not for this profile</span></div>' +
        '<p class="n-refusal" id="nutrition-refusal">' + esc(plan.reason) + "</p>" +
        '<p class="muted small">No calorie or macro number is shown here, on purpose.</p>';
      return Object.assign(base, { state: "refused", age, reason: plan.reason, targets: null, html });
    }

    /* --- targets, each with its reason --- */
    const targets = [
      { key: "kcal", label: "Calories", value: plan.target.kcal, unit: "kcal", reason: calorieReason(plan, phase) },
      { key: "protein", label: "Protein", value: plan.protein.g, unit: "g", reason: proteinReason(plan, goal) },
      { key: "fat", label: "Fat", value: plan.fat.g, unit: "g", reason: fatReason(plan) },
      { key: "carbs", label: "Carbs", value: plan.carbs.g, unit: "g", reason: carbsReason(plan) },
    ];

    /* --- maintenance estimate --- */
    const ffm = plan.bmr.method === "ffm-mifflin";
    // one decimal: this app does not show more precision than the input carries
    const lbm1 = plan.bmr.lbmKg == null ? null : Math.round(plan.bmr.lbmKg * 10) / 10;
    const maintenance = {
      rmr: plan.bmr.kcal,
      method: plan.bmr.method,
      lbmKg: lbm1,
      equation: ffm
        ? "the Mifflin fat-free-mass form (19.7 × lean mass + 413)"
        : "the Mifflin weight-based form (10 × weight + 6.25 × height − 5 × age, +5 / −161)",
      why: ffm
        ? "Fat-free-mass form, because your profile has a body-fat % — lean mass (" + lbm1 + " kg) is known and used."
        : "Weight-based form, because no body-fat % is set on the profile.",
      activity: { pal: activity.pal, method: activity.method, basis: activity.basis, caveat: activity.caveat },
      tdee: plan.tdee.kcal,
      tdeeNote: plan.tdee.note,
      floor: plan.target.floor,
      floorLabel: profile.sex === "F" ? "women" : "men",
      floorApplied: plan.target.floorApplied,
    };

    /* --- goal conflict: shown ONLY when it fires --- */
    const gc = Macros.goalConflict({
      weightKg: num(profile.weightKg), goalWeightKg: num(profile.goalWeightKg),
      bodyFatPct: num(profile.bodyFatPct), goalBodyFatPct: num(profile.goalBodyFatPct),
    });
    const conflict = gc.conflict ? { kind: gc.kind, note: gc.note, requiredLeanChangeKg: gc.requiredLeanChangeKg } : null;

    const limits = "This is an estimate: the equation explains about 71% of the variation in " +
      "measured resting energy, so treat it as a starting point, not a fact. It rounds on purpose " +
      "(calories to 10, macros to 5 g) — there is no fake precision here. And there is no completion " +
      "date: a rate is a direction, not a promise.";

    /* ---------- html ---------- */
    const opts = base.phases.map((p) =>
      '<option value="' + esc(p.key) + '"' + (p.key === phase.key ? " selected" : "") + ">" + esc(p.label) + "</option>").join("");

    const targetRows = targets.map((t) =>
      '<div class="n-target"><div class="n-t-head"><span class="n-t-label">' + esc(t.label) + "</span>" +
      '<span class="n-t-val">' + t.value + '<span class="n-t-unit"> ' + esc(t.unit) + "</span></span></div>" +
      '<p class="n-t-reason muted small">' + esc(t.reason) + "</p></div>").join("");

    const conflictHtml = conflict
      ? '<aside class="n-conflict" id="nutrition-conflict"><div class="card-head"><h3>Your two goals pull apart</h3></div>' +
        '<p class="small">' + esc(conflict.note) + "</p></aside>"
      : "";

    const html =
      '<div class="card-head"><h3>Nutrition</h3><span class="muted">' + phase.label + '</span></div>' +
      '<p class="small n-age" id="n-age">Age ' + age + " — from the birth year in your Profile.</p>" +
      '<label class="n-pace">Pace<select class="inp" id="n-phase">' + opts + "</select></label>" +
      '<p class="n-blurb muted small" id="n-blurb">' + esc(phase.blurb) + "</p>" +
      conflictHtml +
      '<div class="n-targets" id="n-targets">' + targetRows + "</div>" +
      '<div class="n-maint" id="n-maint">' +
        '<div class="card-head"><h3>Maintenance estimate</h3><span class="muted">a starting value</span></div>' +
        "<p class=\"small\">RMR <b>" + maintenance.rmr + "</b> kcal/day — " + esc(maintenance.equation) + ".</p>" +
        '<p class="small">' + esc(maintenance.why) + "</p>" +
        '<p class="small">Activity factor <b>' + maintenance.activity.pal + "</b> (" +
          esc(maintenance.activity.method) + "): " + esc(maintenance.activity.basis) + ".</p>" +
        '<p class="muted small">' + esc(maintenance.activity.caveat) + "</p>" +
        '<p class="small">Maintenance ≈ <b>' + maintenance.tdee + "</b> kcal/day — " + esc(maintenance.tdeeNote) + ".</p>" +
        '<p class="small">Intake floor <b>' + maintenance.floor + "</b> kcal/day (" + esc(maintenance.floorLabel) + "). " +
          (maintenance.floorApplied
            ? "The floor is what's shown — the computed target came in below it."
            : "Not applied — your target sits above it.") + "</p>" +
      "</div>" +
      '<p class="muted small n-limits">' + esc(limits) + "</p>";

    return Object.assign(base, {
      state: "ok", age, goal, phase: { key: phase.key, label: phase.label, blurb: phase.blurb },
      recommended: rec.key, targets, maintenance, conflict, limits, plan, html,
    });
  }

  /* ---------- food logging: building a SNAPSHOT entry ----------
     The consumer keeps the macro ORDER the database uses. A nutrient absent from
     the food is absent from the snapshot (never a 0) — dayTotals excludes it. */
  const NUTRIENTS = ["kcal", "protein", "fat", "carb", "fibre"];
  const round2 = (x) => Math.round(x * 100) / 100;

  /* Turn a chosen food + a gram weight into a log entry. The name and macros are
     COPIED here, at log time: the bundled database changes between releases and a
     past day must not silently rewrite. Returns null when there is no real
     portion (no food, no name, or a non-finite/non-positive gram weight) — grams
     are never invented, here or anywhere. */
  function intakeEntry(food, grams, opts) {
    opts = opts || {};
    if (!food || !food.name || typeof Food === "undefined") return null;
    const g = Number(grams);
    if (!isFinite(g) || g <= 0) return null;
    const macros = Food.gramsToMacros(food, g);        // absent stays absent
    const entry = {
      src: food.code != null ? food.code : (food.id != null ? food.id : null),
      name: String(food.name),
      grams: round2(g),
      macros,
    };
    if (opts.date) entry.date = opts.date;             // else Store stamps LOCAL today
    if (opts.meal) entry.meal = String(opts.meal);
    return entry;
  }

  /* The grams behind a portion CHOICE: either a household measure (converted via
     the food's OWN measure table) or grams typed directly. An unknown measure
     returns null through Food.portionToGrams — it is NEVER silently read as
     grams (the caller must then ask for grams). */
  function portionGrams(food, choice) {
    if (typeof Food === "undefined") return null;
    choice = choice || {};
    if (choice.measure != null && choice.measure !== "") {
      const q = (choice.qty == null || choice.qty === "") ? 1 : choice.qty;
      return Food.portionToGrams(food, choice.measure, q);
    }
    const g = Number(choice.grams);
    return (isFinite(g) && g > 0) ? round2(g) : null;
  }

  /* Today's totals read against the tab's targets. TONE (a hard rule): a total
     BELOW target is never framed as failure and a total ABOVE is never a
     warning — no red, no "over", no "exceeded", no "cheat". Being over on one
     day is ordinary. No good/bad-food framing, no exercise-earned-food language.
     The tab's target keys are kcal/protein/fat/carbs; the intake log stores
     kcal/protein/fat/carb/fibre — `carbs` (the tab) is `carb` (the log). */
  const TARGET_TO_LOG = { carbs: "carb" };
  function intakeSummary(targets, totals) {
    totals = totals || {};
    return (targets || []).map((t) => {
      const key = TARGET_TO_LOG[t.key] || t.key;
      const logged = (typeof totals[key] === "number") ? totals[key] : 0;
      const target = t.value;
      const remaining = round2(target - logged);
      const text = (logged < target)
        ? logged + " of " + target + " " + t.unit + " — " + remaining + " to go"
        : logged + " " + t.unit + " — your target is " + target + " " + t.unit;
      return { key: t.key, label: t.label, unit: t.unit, logged, target, remaining, text };
    });
  }

  /* One encouraging headline for the Today card. Neutral on both sides of the
     target: "to go" when below, "a normal day" when at or above. */
  function intakeHeadline(rows, count) {
    if (!count) return "Nothing logged yet today — add your first food below.";
    const kcal = (rows || []).find((r) => r.key === "kcal");
    if (!kcal) return "Logged today: " + count + (count === 1 ? " item." : " items.");
    return (kcal.logged < kcal.target)
      ? "Nice. " + kcal.remaining + " kcal to go if you want to land on target today."
      : "That's a normal day — a target is a guide, not a rule.";
  }

  return { validBirthYear, ageFrom, goalFromProfile, trainingFor, view, MAX_AGE,
    NUTRIENTS, intakeEntry, portionGrams, intakeSummary, intakeHeadline };
})();
if (typeof module !== "undefined") module.exports = Nutrition;
