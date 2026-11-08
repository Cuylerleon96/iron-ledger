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

    /* --- the activity factor: the OBSERVED value when its gate passes, else the
           user's DECLARED level, else the training-derived value, else the 1.2
           fallback. Macros.activityFactor owns that precedence and reports which
           tier it used; the chosen factor is handed to the plan so the number shown
           is the number the targets were built from. AMENDED 2026-11-08: a declared
           level IS allowed now — but only as a starting value, replaced by an
           observed one once intake and weigh-ins exist (see Macros.observedTdee). --- */
    const training = cfg.training || { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 };
    const rmrInputs = { sex: profile.sex, weightKg: num(profile.weightKg), heightCm: num(profile.heightCm),
      ageY: age, bodyFatPct: num(profile.bodyFatPct) };
    const observed = Macros.observedTdee({
      intakes: cfg.intake || [], bodylog: cfg.bodylog || [],
      windowDays: cfg.windowDays, rmrKcal: Macros.rmr(rmrInputs).kcal,
    });
    const activity = Macros.activityFactor(profile, training, observed);

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

    /* --- the rounding note for THIS plan (honesty: grams to 5 g, target to 10
           kcal, so the two can differ by a few kcal — said plainly) --- */
    const roundingNote = roundingNoteFor(plan);

    /* --- maintenance estimate --- */
    const ffm = /^ffm-/.test(plan.bmr.method);
    const EQ = {
      "ffm-cunningham": "the Cunningham fat-free-mass form (500 + 22 × lean mass)",
      "ffm-mifflin": "the Mifflin fat-free-mass form (19.7 × lean mass + 413)",
      "ffm-katch": "the Katch-McArdle fat-free-mass form (370 + 21.6 × lean mass)",
    };
    // one decimal: this app does not show more precision than the input carries
    const lbm1 = plan.bmr.lbmKg == null ? null : Math.round(plan.bmr.lbmKg * 10) / 10;
    /* The maintenance line NAMES which activity factor is in use and WHY — no number
       without its basis. */
    const activityText = activity.method === "observed"
      ? "OBSERVED from " + Math.round(activity.spanDays || 0) + " days of your intake and weigh-ins"
      : activity.method === "declared" ? "YOU SET THIS — a starting estimate"
      : activity.method === "fallback" ? "the default start (no activity level set, no training logged)"
      : "derived from your logged training";
    const r2 = (x) => Math.round(x * 100) / 100;
    const declared = Macros.activityLevelFor(profile.activityLevel);
    /* If the set level and the observed value disagree, say so PLAINLY rather than
       silently switching. */
    const disagreement = (declared && observed && isFinite(observed.factor) &&
        Math.abs(observed.factor - declared.factor) >= 0.05)
      ? "Heads up: your set level (activity factor " + declared.factor + ") and the OBSERVED value (activity factor " +
        r2(observed.factor) + ") disagree — the observed value is the one being used."
      : null;
    const maintenance = {
      rmr: plan.bmr.kcal,
      method: plan.bmr.method,
      lbmKg: lbm1,
      equation: ffm ? EQ[plan.bmr.method] : "the Mifflin weight-based form (10 × weight + 6.25 × height − 5 × age, +5 / −161)",
      why: ffm
        ? "Fat-free-mass form, because your profile has a body-fat % — lean mass (" + lbm1 + " kg) is known and used."
        : "Weight-based form, because no body-fat % is set on the profile.",
      activity: { pal: activity.pal, method: activity.method, tier: activity.tier, basis: activity.basis,
        caveat: activity.caveat, level: activity.level || null, text: activityText, why: activity.why,
        disagreement, n: (activity.n == null ? null : activity.n), spanDays: (activity.spanDays == null ? null : activity.spanDays),
        source: activity.source },
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
      '<p class="muted small n-rounding" id="n-rounding">' + esc(roundingNote) + "</p>" +
      '<div class="n-maint" id="n-maint">' +
        '<div class="card-head"><h3>Maintenance estimate</h3><span class="muted">a starting value</span></div>' +
        "<p class=\"small\">RMR <b>" + maintenance.rmr + "</b> kcal/day — " + esc(maintenance.equation) + ".</p>" +
        '<p class="small">' + esc(maintenance.why) + "</p>" +
        '<p class="small">Activity factor <b>' + maintenance.activity.pal + "</b> (" +
          esc(maintenance.activity.text) + ").</p>" +
        '<p class="muted small">' + esc(maintenance.activity.basis) + ".</p>" +
        (maintenance.activity.disagreement
          ? '<p class="small n-disagree" id="n-activity-disagree">' + esc(maintenance.activity.disagreement) + "</p>"
          : "") +
        '<p class="muted small">' + esc(maintenance.activity.caveat) + "</p>" +
        '<p class="small">Maintenance ≈ <b>' + maintenance.tdee + "</b> kcal/day — " + esc(maintenance.tdeeNote) + ".</p>" +
        '<p class="small">Intake floor <b>' + maintenance.floor + "</b> kcal/day (" + esc(maintenance.floorLabel) + "). " +
          (maintenance.floorApplied
            ? "The floor is what's shown — the computed target came in below it."
            : "Not applied — your target sits above it.") + "</p>" +
      "</div>" +
      '<p class="muted small n-limits">' + esc(limits) + "</p>";

    return Object.assign(base, {
      state: "ok", age, goal, phase: { key: phase.key, label: phase.label, blurb: phase.blurb, goal: phase.goal },
      recommended: rec.key, targets, maintenance, conflict, limits, roundingNote, plan, html,
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

  /* ---------- Today's totals read against the tab's targets ----------
     TONE, and it is GOAL-AWARE. The wording is driven by the SAME phase (goal)
     the targets were built from — the caller passes `_nutriView.phase.goal` — so
     the numbers and the sentence can never disagree about the goal.
       - a GAIN phase: "to go" IS offered, because on a gaining goal the remaining
         figure is what you are aiming to eat.
       - a LOSS phase: the remaining figure is NEVER framed as something to
         consume. It is stated as progress ("still in today's budget"), so the row
         cannot read as pressure to eat up to the target.
       - AT OR ABOVE the target, on EVERY goal: ordinary, stated neutrally and
         encouragingly. Never red, never "over" / "exceeded" / "too much", never a
         warning colour; no good/bad-food framing; no exercise-earned-food talk.
     The tab's target keys are kcal/protein/fat/carbs; the intake log stores
     kcal/protein/fat/carb/fibre — `carbs` (the tab) is `carb` (the log). */
  const TARGET_TO_LOG = { carbs: "carb" };
  const goalWord = (g) => (g === "lose" || g === "gain") ? g : "maintain";

  function intakeSummary(targets, totals, goal) {
    totals = totals || {};
    const g = goalWord(goal);
    return (targets || []).map((t) => {
      const key = TARGET_TO_LOG[t.key] || t.key;
      const logged = (typeof totals[key] === "number") ? totals[key] : 0;
      const target = t.value;
      const remaining = round2(target - logged);
      let text;
      if (logged >= target) {
        /* neutral on EVERY goal — a day at or above a target is ordinary */
        text = logged + " " + t.unit + " — your target is " + target + " " + t.unit;
      } else if (g === "gain") {
        text = logged + " of " + target + " " + t.unit + " — " + remaining + " to go";
      } else if (g === "lose") {
        /* progress, NOT an instruction to eat */
        text = logged + " of " + target + " " + t.unit + " so far — " + remaining + " still in today's budget";
      } else {
        text = logged + " of " + target + " " + t.unit + " today";
      }
      return { key: t.key, label: t.label, unit: t.unit, logged, target, remaining, text, goal: g };
    });
  }

  /* One encouraging headline for the Today card, on the same goal. Neutral on
     both sides of the target: an under day is never framed as failure to eat up,
     and an at-or-above day is never a warning. */
  function intakeHeadline(rows, count, goal) {
    if (!count) return "Nothing logged yet today — add your first food below.";
    const g = goalWord(goal);
    const kcal = (rows || []).find((r) => r.key === "kcal");
    if (!kcal) return "Logged today: " + count + (count === 1 ? " item." : " items.");
    if (kcal.logged >= kcal.target) {
      return "That's a normal day — " + kcal.logged + " kcal logged, and a target is a guide, not a rule.";
    }
    if (g === "gain") {
      return "Nice. " + kcal.remaining + " kcal to go if you want to land on target today.";
    }
    if (g === "lose") {
      return kcal.logged + " kcal logged today — " + kcal.remaining +
        " still in today's budget, and no need to eat up to it.";
    }
    return kcal.logged + " kcal logged today — a target is a guide, not a rule, so take it at your own pace.";
  }

  /* ---------- the rounding note (honesty) ----------
     The macro grams are each rounded on their own to 5 g and the calorie target
     to 10 kcal, so adding the grams up can land a few kcal away from the target
     (the owner's own plan: 145 P / 75 F / 230 C = 2175 kcal against a 2170 target).
     Say that plainly rather than leaving an unexplained discrepancy. */
  const MACRO_ROUNDING_NOTE =
    "Grams are rounded on their own to the nearest 5 g, and the calorie target to the nearest 10 kcal, " +
    "so the macro grams can add up to a few kcal different from the calorie target. Both numbers are " +
    "right — only the rounding differs.";

  /* The note with THIS plan's own arithmetic spelled out, so the gap is never a
     mystery. Built from the engine's figures; nothing is computed twice. */
  function roundingNoteFor(plan) {
    const macroKcal = plan.protein.g * 4 + plan.fat.g * 9 + plan.carbs.g * 4;
    const gap = Math.round((macroKcal - plan.target.kcal) * 100) / 100;
    return MACRO_ROUNDING_NOTE + " Here: " + plan.protein.g + " g protein + " + plan.fat.g + " g fat + " +
      plan.carbs.g + " g carbs = " + macroKcal + " kcal against the " + plan.target.kcal + " kcal target" +
      (gap ? " (" + Math.abs(gap) + " kcal apart)." : " (they agree).");
  }

  return { validBirthYear, ageFrom, goalFromProfile, trainingFor, view, MAX_AGE,
    NUTRIENTS, intakeEntry, portionGrams, intakeSummary, intakeHeadline,
    MACRO_ROUNDING_NOTE, roundingNoteFor };
})();
if (typeof module !== "undefined") module.exports = Nutrition;
