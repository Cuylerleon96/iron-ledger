/* glossary.js — the ONE place a term is explained.

   The app is gamified and aimed at someone just starting out, but it shows words
   a beginner cannot be expected to know: MEV/MAV/MRV, e1RM, RPE, tonnage,
   density, freshness, the muscle-balance status words, the six attribute names —
   and, since the Nutrition tab landed, the whole nutrition vocabulary (kcal, g,
   RMR, maintenance, activity factor, lean mass, per kg of bodyweight, the pace
   and phase names, the AMDR/RDA shorthands, per 100 g, fibre).
   This file is the single source those explanations live in, so the same term
   reads the same way wherever it is shown. Four rules keep it honest:

     1. Every term the UI displays has an entry here, and no entry exists for a
        term the UI never shows. Each entry's `id` is the `data-term` hook the
        card uses to open it, and tools/test_features.js checks both directions.
     2. Nothing explains the same thing twice in different words: the dashboard's
        "What the numbers mean" block and the per-attribute blurbs read their
        definitions from here (see Glossary.attrPlain / app.js attrExplain).
     3. EVERY entry carries a `source` — the published reference the term's
        numbers come from, reused verbatim from js/macros.js SOURCES wherever one
        exists there. Where a term is the app's own rule, or the science is
        contested, the entry SAYS SO instead of borrowing authority it has not
        got. Nothing is dressed up as a citation.
     4. Where the science is contested (activity-factor estimates, protein
        targets, anything built from self-reported intake, the pace cut-points,
        body-fat measurement) the entry names the disagreement rather than
        implying a consensus.

   Style: plain language first (`plain`), then the actual definition or formula
   underneath (`real`) for anyone who wants the real thing, then the source.

   No DOM and no storage here — every function that touches the document takes it
   from the supplied ctx, so this module loads in a bare sandbox for testing. */
const Glossary = (() => {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* One entry per displayed term. `term` is the heading shown; `aliases` are the
     other wordings the UI uses for the same idea, so the scope test can prove
     the entry corresponds to something on screen. `source` is the reference the
     numbers derive from (or a plain statement that there is none). */
  const TERMS = [
    {
      id: "xp-multiplier", term: "XP multiplier", aliases: ["XP multiplier", "XP scaler", "multiplier"],
      plain: "A session's XP is not paid flat. What you did earns a base amount, and a small multiplier — shown next to the XP as \u201cx1.5\u201d — rewards the things this app already values: getting stronger, and turning up as often as you planned. Piling on extra sets past what a muscle can recover earns less, not more.",
      real: "Composed from named factors and capped at \u00d72.0: improvement \u00d71.25 when the session sets a PR; consistency \u00d71.10\u20131.25 when the sessions logged in that week meet your weekly target (a SESSION count, never consecutive days); and volume, the negative side, down to \u00d70.5 when the session pushes a muscle group past its own MRV from the landmarks. The session's base is multiplied once — a PR that also raises tonnage is counted once, not once per metric.",
      source: "This app's own scoring rule, not a published standard. The factors themselves are our arrangement.",
    },
    {
      id: "hard-sets", term: "Hard sets", aliases: ["Hard sets", "hard set", "extra effort"],
      plain: "A drop set or a failure set is tougher than a straight set: you keep going past where you would normally stop. The app recognises that extra effort — those sets count for more toward a muscle group's weekly volume, and they earn a little extra XP for the session. Nothing is ever taken away for a set you push hard on.",
      real: "A set logged as a drop set (\u00d71.25) or a failure set (\u00d71.2) counts as more than one working set on the muscle-balance effort path, and earns extra session XP proportional to that multiplier above a straight set. The extra XP is capped per session, so marking every set as a hard set cannot inflate it — past the cap an extra hard set adds nothing. The session breakdown and the History card show how much extra the hard sets earned.",
      source: "This app's own scoring rule, not a published standard. The set-type multipliers and the per-session cap are deliberate heuristics — our arrangement, not measured values — kept in one place so they can be tuned.",
    },
    {
      id: "volume", term: "Volume", aliases: ["volume", "weekly volume", "sets per week"],
      plain: "How much training you did — the work you gave a muscle, counted in sets. More is not automatically better: there is a range that builds muscle and a point past which it only costs you recovery.",
      real: "Volume here is completed working sets per muscle group, per week. A set counts when it is a real, finished set for that movement; the muscle-balance card weights each set by the movement's effort factor before comparing it to your landmarks.",
      source: "The MEV/MAV/MRV ranges the count is read against are Renaissance Periodization's published volume-landmark tables (Israetel et al.), mid-range values. Counting sets per week is the standard unit in that literature.",
    },
    {
      id: "tonnage", term: "Tonnage", aliases: ["tonnage", "t lifted"],
      plain: "The total weight you moved — how much actual load passed through your hands. Think of it as the size of the job, not the quality of it.",
      real: "Tonnage = weight × reps, summed over the sets in the window. It is computed once, in the engine, and every display (the dashboard chip, the chart, the session totals) reads that same number. A hold or a carry has no tonnage: there are no reps of load to count.",
      source: "This app's own sum (weight × reps), in whatever unit your Profile is set to. No external definition is needed or cited.",
    },
    {
      id: "reps", term: "Reps", aliases: ["reps", "reps per week"],
      plain: "The number of times you moved the weight, added up across a week. Reps show the raw amount of movement even when the weight stays the same.",
      real: "Weekly reps = the sum of every logged repetition in the week, across all movements. Reps feed the effort read and the endurance part of Stamina; they are separate from tonnage, which also counts the weight.",
      source: "This app's own count. 'Repetition' as the basic unit of a set is standard training vocabulary.",
    },
    {
      id: "effort-set", term: "Effort sets (vs raw sets)", aliases: ["effort sets", "raw sets", "working set", "working sets"],
      plain: "A raw set is just a set you did. An effort set is that same set weighted by how demanding the movement is — a heavy squat counts for more than a leg extension. The muscle-balance card shows both so you can see the difference.",
      real: "Each logged set is multiplied by the movement's effort weight (its `g`/effort factor, 1.00 = baseline) to give an effort set — a fixed coefficient worked out from the movement itself, not something you set. Raw sets are the unweighted count. Totals are effort sets per week against the muscle group's MEV / MAV / MRV landmarks.",
      source: "The effort coefficients are this app's own weighting, derived from the movement. There is no published effort-factor scale for movements, and the app does not claim one.",
    },
    {
      id: "set-type", term: "Set type", aliases: ["Set type", "Drop set", "Failure set"],
      plain: "What kind of set it was. A drop set or a set taken to failure is harder than a straight working set, so it counts for more effort.",
      real: "One field per set (`ty`), one value: drop or failure (unset = a straight working set). A drop set and a failure set each contribute more than one effort set (×1.25 and ×1.2) to the muscle-group stimulus — the same path the per-exercise effort weight already uses. Raw working-set counts are unchanged.",
      source: "'Drop set' and 'training to failure' are standard training terms; the ×1.25 / ×1.2 multipliers are this app's own weighting, not a published scale.",
    },
    {
      id: "rpe", term: "RPE", aliases: ["RPE", "effort (RPE)"],
      plain: "How hard a set felt, on a scale of 1 to 10. A 10 means you could not have done another rep; a 7 means you had about three left in you. It is how the app knows whether effort is climbing even when the weight is not.",
      real: "RPE is Rate of Perceived Exertion, entered per set (@8 in shorthand). It is compared session to session: effort rising while output stalls is the classic shape of accumulated fatigue, and near-maximal effort with no progress is treated as a recovery problem rather than a call to push harder.",
      source: "The 1-10 effort scale is the standard convention in resistance-training practice. No specific publication is bundled with this app for it, and the app does not dress the scale up as one.",
    },
    {
      id: "e1rm", term: "e1RM / 1RM", aliases: ["e1RM", "1RM", "estimated 1RM"],
      plain: "Your best single rep — the most you could lift once. If you have not actually tested it, the app estimates it from a set you did, so a steady 100×5 becomes a 1RM number you can watch go up.",
      real: "1RM is a true one-rep max. e1RM is the estimate: Epley's formula, weight × (1 + reps ÷ 30), capped at about 12 reps because the estimate stops being accurate past there. Strength and the record tracking both read e1RM on your logged core lifts.",
      source: "Epley's 1RM estimation formula (weight × (1 + reps ÷ 30)) is a named, published formula; the ~12-rep cap is this app's own conservatism.",
    },
    {
      id: "mev-mav-mrv", term: "MEV / MAV / MRV", aliases: ["MEV", "MAV", "MRV", "landmarks"],
      plain: "Three landmarks for a muscle, in sets per week. MEV is where a muscle starts to grow, MAV is the sweet spot, MRV is the most it can take before it stops recovering. Every muscle group has its own numbers.",
      real: "MEV = minimum effective volume, MAV = maximum adaptive volume, MRV = maximum recoverable volume. Reference ranges come from Renaissance Periodization's published volume-landmark tables (Israetel et al.), mid-range values. The muscle-balance bars mark MEV; a group is placed against its own MEV→MAV→MRV band.",
      source: "Renaissance Periodization published volume-landmark tables (Israetel et al.), mid-range values.",
    },
    {
      id: "below-mev", term: "room to grow", aliases: ["room to grow", "below MEV"],
      plain: "You are training that muscle less than it needs to grow. It is not a warning — it is the app telling you where the next easy gain is.",
      real: "Effort sets per week for the group are under its MEV. Nothing is lost; the fix is simply more sets for that group.",
      source: "This app's own band on top of the MEV/MAV/MRV landmarks (see that entry). No separate publication.",
    },
    {
      id: "mev-mav", term: "building", aliases: ["building", "MEV→MAV", "MEV-MAV"],
      plain: "You are past the minimum and on the way to the sweet spot. This is productive territory — keep going.",
      real: "Effort sets per week for the group are at or above its MEV and below its MAV. Growth is expected here.",
      source: "This app's own band on top of the MEV/MAV/MRV landmarks (see that entry). No separate publication.",
    },
    {
      id: "optimal", term: "sweet spot", aliases: ["sweet spot", "optimal", "status-optimal"],
      plain: "That muscle is being trained right in the band where it grows best — neither starved nor overworked.",
      real: "Effort sets per week for the group are at or above its MAV and at or below its MRV.",
      source: "This app's own band on top of the MEV/MAV/MRV landmarks (see that entry). No separate publication.",
    },
    {
      id: "over-mrv", term: "over its limit", aliases: ["over its limit", "over MRV", "status-overMRV"],
      plain: "You are doing more for that muscle than it can recover from. More sets now cost you rather than build you.",
      real: "Effort sets per week for the group exceed its MRV, so the muscle-group score falls rather than rises — the flag and the number agree.",
      source: "This app's own band on top of the MEV/MAV/MRV landmarks (see that entry). No separate publication.",
    },
    {
      id: "untrained", term: "not trained yet", aliases: ["not trained yet", "untrained"],
      plain: "No sets at all for that group in the window. Nothing logged means nothing to judge.",
      real: "Zero completed working sets for the group in the last 28 days.",
      source: "This app's own rule (a 28-day window). No separate publication.",
    },
    {
      id: "deload", term: "Deload", aliases: ["deload", "lighter week"],
      plain: "A deliberately easier week — roughly half your usual sets at the same weights — to let built-up fatigue clear. You come back stronger for it.",
      real: "Suggested only from logged evidence: average RPE rising over three weeks while weekly sets stayed level. Silence is the default, because a suggestion that fires every other week teaches you to ignore it.",
      source: "Deloading is standard training practice; the trigger rule (rising average RPE over three weeks with level sets) is this app's own.",
    },
    {
      id: "plateau", term: "Plateau", aliases: ["plateau", "plateaued", "stagnant"],
      plain: "The number has stopped moving even though you keep training. It is information, not failure — it tells you to change one thing.",
      real: "Flagged when an exercise shows no estimated-1RM improvement across its last four sessions (spread under 3%). The suggested change depends on effort: near-maximal RPE points at recovery, a comfortable RPE points at adding load.",
      source: "This app's own rule (four sessions, under 3% spread). The idea of a plateau is standard training vocabulary.",
    },
    {
      id: "density", term: "Density / work time %", aliases: ["work time", "density"],
      plain: "The share of your session you spent actually working rather than resting. Resting less makes the same session harder on your heart and lungs — which is why it counts toward Stamina.",
      real: "Work time % = work seconds ÷ (work seconds + rest seconds), over the logged sets. Work seconds assume about 3 s per rep. It needs rest to be logged to mean anything: with none, the app shows no figure rather than a false 100%. The dashboard chip is all-time; the Stamina readout is the last 28 days.",
      source: "This app's own definition (and its own 3 s/rep assumption). The 150 min/week cardio reference behind the Stamina side is WHO 2020 physical-activity guidelines.",
    },
    {
      id: "freshness", term: "Freshness", aliases: ["freshness", "Days since each group was last trained"],
      plain: "How long it has been since you last trained each muscle group. It is recency, not a measurement of how recovered you are.",
      real: "Days since the group's most recent logged session. The chip is coloured on a 0-100 freshness read against a 72-hour recency window; a group not trained in the last four weeks reads \"no data\".",
      source: "This app's own recency read. It is not a recovery measurement and the app does not claim a published recovery window — the 72-hour reference is a product judgement, not a published standard.",
    },
    {
      id: "baseline", term: "Baseline", aliases: ["baseline"],
      plain: "Your first real number for an exercise — the thing your later sessions are measured against. The first time you log something there is nothing to compare it to, so it becomes the baseline.",
      real: "The earliest saved session for an exercise with a usable metric. Comparisons (the ▲ / ▼ banner) need at least two sessions; with one, that session is the baseline and no percentage is claimed.",
      source: "This app's own rule. No separate publication.",
    },
    {
      id: "pr", term: "PR", aliases: ["PR", "PRs", "records"],
      plain: "A personal record — your best ever on that exercise. The app watches for them and lists them, so progress you would not notice day to day still shows up.",
      real: "A PR is a new best estimated-1RM (or best reps / time / distance, by the movement's mode) for an exercise, dated when it was set. The dashboard counts PRs from the last 28 days and all-time PRs separately.",
      source: "This app's own rule, read off the e1RM estimate (see that entry).",
    },
    {
      id: "next-target", term: "NEXT target", aliases: ["NEXT", "double progression", "next target"],
      plain: "A suggestion for your next session, built from what you did last time. Add a rep first, and once the reps are comfortable, add weight — that pair is called double progression.",
      real: "Double progression: hold the load and push reps to the top of the range, then increase the load and drop back to the bottom. The NEXT line offers concrete options derived from your own last session; if you set an explicit Target, progress and an ETA are shown only when there is a real trend to extrapolate.",
      source: "Double progression is standard training practice. No specific publication is bundled with the app for it, and the NEXT line is derived from your own last session.",
    },
    {
      id: "tiers", term: "Score tiers", aliases: ["Best", "Fantastic", "Pretty good", "Getting there", "Building up"],
      plain: "The word under each score is just the number in plain English — a rough band, not a grade. Only the number matters.",
      real: "A 0-100 score maps to a word: 95+ Best, 85+ Fantastic, 72+ Very good, 58+ Pretty good, 44+ Getting there, 28+ Building up, 12+ Early days, else Just starting.",
      source: "This app's own bands, not a published grading system.",
    },
    /* ---- nutrition: units, estimates, and the words the Nutrition tab shows ---- */
    {
      id: "kcal", term: "kcal (calories)", aliases: ["kcal", "kcal/day", "calories", "Calories"],
      plain: "The unit food energy is counted in — what a food label calls a calorie. One kcal is roughly the energy it takes to warm a litre of water by one degree. Nothing here needs calorie maths; the number is just the size of the meal.",
      real: "1 kcal (the 'large Calorie' on a label) = 1000 cal = 4.184 kJ. The app shows kcal only, never kJ. Food energy per 100 g is copied from the bundled database at log time, so a past day cannot change under you.",
      source: "Unit definition (1 kcal = 4.184 kJ). Food energy values: USDA FoodData Central, public domain (CC0).",
    },
    {
      id: "grams", term: "g (grams)", aliases: ["grams", "g protein"],
      plain: "Grams — the weight a food or a nutrient is measured in. 100 g is a small bowlful; the app always logs the weight you actually ate rather than assuming a serving size.",
      real: "Macro targets and logged amounts are in grams. Grams are only turned into household measures through the food's OWN measure table; an unknown measure asks you for grams instead of guessing.",
      source: "Grams are a defined metric unit. Per-100 g nutrient values: USDA FoodData Central (CC0).",
    },
    {
      id: "weight-units", term: "kg / lb / cm", aliases: ["Kilograms", "Pounds", "cm"],
      plain: "The units the app shows your body in: kilograms (kg) or pounds (lb) for weight, and centimetres (cm) for height and tape measurements. You pick kg or lb in Profile, under Units, and every weight follows it — it is the same weight either way.",
      real: "1 kg = 2.20462 lb (exact by definition of the international avoirdupois pound); 1 inch = 2.54 cm. Everything is stored in kilograms and centimetres internally, so switching the display never changes the saved data.",
      source: "Unit definitions (1 lb = 0.45359237 kg; 1 in = 2.54 cm).",
    },
    {
      id: "controller", term: "the controller", aliases: ["controller"],
      plain: "The app's way of correcting itself from your own results. Once you have logged meals and weekly weigh-ins, it works out how fast you are actually changing and nudges the calorie target in the right direction — instead of trusting a formula forever.",
      real: "A closed-loop correction: observed change (kg/week) from your dated weigh-ins is compared with the pace you chose, and the target is moved by the energy-balance gap between them (7700 kcal per kg is a first approximation). It stays silent until there is enough data — at least two weigh-ins spanning about a week — because a trend drawn from thin data would be noise.",
      source: "Quoted verbatim from js/macros.js SOURCES.controller — \"Intake-balance model: Hall KD 2010 (Am J Physiol Endocrinol Metab); Hall 2011 (Lancet)\"; the 7700 kcal/kg figure is Hall & Chow, Int J Obes 2013 (PMC3859816), a FIRST APPROXIMATION.",
    },
    {
      id: "maintenance", term: "Maintenance", aliases: ["Maintenance estimate", "maintenance", "TDEE"],
      plain: "The amount you would eat to stay about the same weight — your day-to-day energy burn. Every other number on the tab is this one nudged up or down for the pace you picked.",
      real: "TDEE (total daily energy expenditure) estimated as resting metabolic rate multiplied by an activity factor. It is an estimate twice over: the RMR equations explain only about 71% of measured resting energy, and the activity factor is a placeholder until your own logs replace it. As soon as there is enough logged intake and enough weigh-ins, the app solves the figure from your own data instead.",
      source: "RMR equations: Mifflin-St Jeor (PMID 2305711), Cunningham 1980, Katch-McArdle; the ~R²=0.71 limit and the self-reported-intake caveat are Macros.SOURCES.rmrCaveat / .observed. See the 'RMR' and 'Activity factor' entries for where this is contested.",
    },
    {
      id: "rmr", term: "RMR", aliases: ["RMR"],
      plain: "Resting metabolic rate — roughly the energy your body uses just staying alive: breathing, keeping warm, running your organs. It is the biggest part of the maintenance number, and the part an equation tries to predict.",
      real: "Predicted from a published regression equation. Without a body-fat % the app uses the Mifflin-St Jeor weight form (10 × weight + 6.25 × height − 5 × age, +5 / −161); with a body-fat % it uses a lean-mass form (Cunningham, 500 + 22 × lean mass, as the default). RMR is not TDEE: RMR is the at-rest figure, and the activity factor is what turns it into a whole-day number.",
      source: "Quoted verbatim from js/macros.js SOURCES — Mifflin: \"Mifflin MD et al., Am J Clin Nutr 1990;51(2):241-247, PMID 2305711\"; Cunningham: \"Cunningham JJ, Am J Clin Nutr 1980;33(11):2372-2374 (RMR = 500 + 22 x lean mass)\"; Katch: \"Katch & McArdle, Exercise Physiology (textbook constant; 370 + 21.6 x lean mass)\". CONTESTED: \"RMR regression equations — Mifflin, Cunningham, Katch-McArdle — each explain only about R^2 = 0.71 of the variance in measured resting energy. Choosing the better default removes a known BIAS; it does NOT turn the number into a measurement.\"",
    },
    {
      id: "activity-factor", term: "Activity factor", aliases: ["Activity factor", "Activity level", "activity factor", "PAL"],
      plain: "A multiplier on your resting number for how much you move and train in a day — about 1.2 for a desk day, up to about 1.7 for hard exercise most days. It turns 'energy at rest' into 'energy for your whole day'.",
      real: "The tab names which of four values it used, and why: an OBSERVED factor solved from your own logged intake and weigh-ins (used as soon as the gate passes); the level you set in Profile (a starting estimate); a value derived from your logged training; otherwise the low 1.2 start value.",
      source: "Quoted verbatim from js/macros.js SOURCES.activityLevel — \"The conventional FAO/WHO/UNU PAL bands (1.2 sedentary / 1.375 light / 1.55 moderate / 1.725 very active), used only as a STARTING value; a self-selected PAL overestimates TDEE by ~200-300 kcal/day (PMC4383286) and individual self-reported activity error runs -25% to +42% (PubMed 10023727).\" The observed value is solved from your own logs (SOURCES.observed).",
    },
    {
      id: "intake-floor", term: "Intake floor", aliases: ["Intake floor", "intake floor", "safety floor"],
      plain: "A lowest daily calorie figure the app will not go under, however fast a pace you pick. If your pace would take you below it, the target is raised to the floor and the tab says so plainly.",
      real: "1500 kcal/day for men, 1200 kcal/day for women; with sex unset the app uses the higher 1500 value so the floor is never set below what either intends. There is no single published calorie floor — these figures sit in the lower end of the range used for supervised low-energy diets.",
      source: "Quoted verbatim from js/macros.js SOURCES.floor — \"Harvard Health; ISSN position stand (LED 800-1200 kcal/day, VLED <800 = medical supervision)\". Where exactly a floor should sit is a judgement call, not a published number.",
    },
    {
      id: "macros", term: "Macros", aliases: ["macros", "macro"],
      plain: "Short for macronutrients — the three things your food is mostly made of: protein, fat and carbs. The app turns your calorie target into a daily amount of each, so you can see what to aim for without weighing every meal forever.",
      real: "The split is set in a fixed order: calories first, then protein (by goal), then fat (above the essential-fat floor and the AMDR lower bound), then carbs take whatever calories are left, floored at the 130 g/day RDA.",
      source: "Protein: ISSN 2017 (PMID 28642676); Helms 2014 (PMID 24864135); Iraki 2019 (PMID 31247944). Fat: IOM DRI AMDR; Helms 2014; Iraki 2019; Whittaker & Wu 2021 (PMID 33741447). Carbs: IOM DRI — carbohydrate RDA 130 g/day. (Reused verbatim from js/macros.js SOURCES.)",
    },
    {
      id: "per-kg-bodyweight", term: "per kg of bodyweight", aliases: ["per kg of bodyweight", "g per kg"],
      plain: "A target written per kilogram of YOU, rather than as a flat number of grams — so two people of different sizes each get a sensible amount. '2 g per kg of bodyweight' means 2 g for every kilogram you weigh.",
      real: "Bodyweight-based targets move with the scale: if your weight changes, the same g/kg gives a different number of grams. Where a body-fat % is known, a cutting goal aims at your LEAN mass instead of your whole bodyweight.",
      source: "ISSN 2017 (PMID 28642676); Helms 2014 (PMID 24864135). CONTESTED: how much protein to eat is genuinely argued over — the ranges used here come from two literatures that do not agree at the extremes, and 'more is better' is not established. The point picked inside a published range is the app's own arrangement, not published.",
    },
    {
      id: "lean-mass", term: "Lean mass", aliases: ["lean mass", "fat-free mass"],
      plain: "Everything you weigh that is not fat — muscle, bone, organs and water (also called fat-free mass). When the app knows your body-fat % it can aim protein at your lean mass instead of your whole bodyweight.",
      real: "Lean mass = bodyweight × (1 − body-fat % ÷ 100). It depends entirely on whatever body-fat figure is in your log, so an inaccurate body-fat reading makes it inaccurate too.",
      source: "Definitional arithmetic (LBM = weight × (1 − bf/100)) — Macros.SOURCES.goalConflict. The body-fat figure it leans on is an estimate; see the 'Body fat %' entry.",
    },
    {
      id: "body-fat-pct", term: "Body fat %", aliases: ["Body fat %", "body fat", "body-fat %"],
      plain: "The share of your weight that is fat, entered when you check in. Treat it as a rough reading rather than a measurement — different methods disagree on the same person, and the app uses it accordingly.",
      real: "Used to choose the lean-mass equations, to set protein against lean mass on a cutting goal, and to check a pair of goals for conflict. A 1% change in the figure moves your lean-mass number, so a reading that is a few percent off moves several kg of 'lean mass' with it.",
      source: "No defensible citation is bundled: the error of a body-fat reading depends on the method (scales, calipers, lab scans) and the app carries no source for a specific figure. Said plainly rather than dressed up.",
    },
    {
      id: "pace", term: "Pace", aliases: ["Pace", "pace"],
      plain: "How fast you want the scale to move, written as a share of your bodyweight per week (for example 0.5% per week). Slower paces are easier to hold and kinder to muscle; faster ones get there sooner and cost more.",
      real: "A pace converts to a daily calorie change using the first-approximation figure of 7700 kcal per kg, and the tab states the change it made. This is a direction, never a promised date.",
      source: "Anchor: Garthe 2011 — about 1.4 %BW/week did not add lean mass. CONTESTED: the slow / moderate / fast cut-points are this app's OWN arrangement of published ranges, not published bands themselves (Macros.SOURCES.pace); 7700 kcal/kg is a FIRST APPROXIMATION (Hall & Chow, Int J Obes 2013, PMC3859816).",
    },
    {
      id: "phase", term: "Phase", aliases: ["Lean gain", "Bulk", "Gradual cut", "Standard cut", "Aggressive cut", "phase"],
      plain: "The name the app gives the pace you picked: Maintain, Lean gain, Bulk, Gradual cut, Standard cut or Aggressive cut. They are the same slow / moderate / fast settings in friendlier words — 'bulk' is just the fastest gaining band, and a 'cut' means eating to lose fat.",
      real: "A phase pairs a direction (gain, maintain, lose) with one of the pace bands; the names introduce no new rates. Changing the phase changes only the pace adjustment, not the profile or any past log.",
      source: "Macros.SOURCES.phase — user-facing names for the pace bands (see the 'Pace' entry for the bands and their contested cut-points).",
    },
    {
      id: "fibre", term: "Fibre", aliases: ["fibre"],
      plain: "The part of plant food your body does not digest — it feeds your gut and helps you feel full. The app shows it when a food's record has a value, and simply leaves it out when it does not.",
      real: "Shown in grams on the food's macro line when the database carries it. An absent value stays absent (never a 0), and fibre's energy is not added into the calorie total — the tab's macro line follows the same rule.",
      source: "USDA FoodData Central, public domain (CC0 — FNDDS + SR Legacy), the app's bundled food data.",
    },
    {
      id: "per-100-g", term: "per 100 g", aliases: ["per 100 g", "kcal/100 g"],
      plain: "A standard amount of 100 grams, used so two foods can be compared on the same footing. '89 kcal per 100 g' means 89 kcal in every 100 g of that food, whatever portion you actually take.",
      real: "Every food is stored per 100 g and scaled to the portion you pick, so a logged amount is the food's own numbers multiplied by your grams — never a guessed serving.",
      source: "USDA FoodData Central (public domain, CC0). Per 100 g is the database's own basis.",
    },
    {
      id: "portion", term: "Portion", aliases: ["Portion", "portion"],
      plain: "How much you actually ate — either grams you type in, or one of the food's own household measures such as a cup or a slice. The app shows the macros for that portion before you add it, so there are no surprises.",
      real: "A household measure is converted through the food's OWN measure table; an unknown measure returns nothing and the app asks you for grams rather than assuming. A portion with no positive weight is never logged.",
      source: "This app's logging rule. The household measures themselves come from the USDA FoodData Central (CC0) records.",
    },
    {
      id: "amdr", term: "AMDR", aliases: ["AMDR"],
      plain: "Acceptable macronutrient distribution range — the share of your daily calories that health authorities suggest should come from each macronutrient. Fat's range starts at 20% of calories, which is why the app's fat target sits above that line.",
      real: "AMDR is a range of percentages of energy intake published in the Institute of Medicine's Dietary Reference Intakes; for fat in adults it runs 20-35% of calories. The app uses the 20% LOWER bound as a floor, never as a target.",
      source: "IOM DRI AMDR (via Macros.SOURCES.fat: 'IOM DRI AMDR; Helms 2014; Iraki 2019; Whittaker & Wu 2021, PMID 33741447').",
    },
    {
      id: "rda", term: "RDA", aliases: ["RDA"],
      plain: "Recommended Dietary Allowance — an official daily amount set to cover what nearly everyone needs. The app uses the 130 g/day figure for carbohydrate as a floor, so a very low calorie target cannot squeeze carbs below it.",
      real: "The carbohydrate RDA of 130 g/day is the Institute of Medicine's figure for the glucose the brain needs; it is set independently of how much you train. When protein and fat have used up the calorie budget, the app raises carbs to this floor and says so on the target.",
      source: "IOM DRI — carbohydrate RDA 130 g/day (Macros.SOURCES.carbs).",
    },
    {
      id: "essential-fat", term: "essential fat", aliases: ["essential-fat", "essential fat"],
      plain: "The small amount of fat your body genuinely cannot do without — some vitamins only dissolve in fat, and some fats are building blocks your body cannot make. So fat gets its own floor, and a calorie target cannot drive it towards nothing.",
      real: "The floor is the higher of 0.5 g per kg of bodyweight and 20% of the calorie target (the AMDR lower bound); when the calorie target is 1500 kcal or less the app also lifts the fat it picks per kg. A low-fat target is never reached by squeezing fat towards zero.",
      source: "Macros.SOURCES.fat (IOM DRI AMDR; Helms 2014; Iraki 2019; Whittaker & Wu 2021, PMID 33741447). The absolute 0.5 g/kg value is this app's own floor and is stated as such, not as a published number.",
    },
    {
      id: "deficit-surplus", term: "deficit / surplus", aliases: ["deficit", "surplus"],
      plain: "A deficit is eating a little less than you burn, so the scale drifts down; a surplus is eating a little more, so it drifts up. 'Steady and small' is the app's whole approach, and neither one is framed as good or bad — a target is a guide, not a rule.",
      real: "The app never asks you to hit a deficit or surplus on a given day; it converts the pace you chose into a daily calorie change and stops there. The figure is a direction, not proof of what your body is doing.",
      source: "This app's arrangement, built on Hall & Chow 2013 (7700 kcal/kg as a FIRST APPROXIMATION). CONTESTED-BY-DESIGN: any figure built from logged intake leans on self-reported eating, which is known to be under-reported — Macros.SOURCES.observed / OBSERVED_CAVEAT say so in the app itself.",
    },
    {
      id: "usda", term: "USDA source", aliases: ["USDA source", "USDA"],
      plain: "Where the food numbers come from: the United States Department of Agriculture's public food database, bundled inside the app so search works offline and nothing is uploaded.",
      real: "The app ships two USDA datasets (FNDDS and SR Legacy) combined, stored per 100 g. Where the same food appears in both with materially different values, the app keeps one row and names the other record's figures on the picked-food card rather than letting the disagreement vanish.",
      source: "USDA FoodData Central — public domain (CC0). The app's own 'Another USDA source lists ...' disclosure is js/nutrition.js alternateNote.",
    },
    /* ---- the six attributes: the basis behind each name ---- */
    {
      id: "attr-STR", term: "Strength", aliases: ["Strength", "STR"],
      plain: "How much you can lift for your bodyweight. A heavier person lifting the same weight is not stronger, so the number is a ratio, not a total.",
      real: "Best estimated 1RM on your core lifts (bench, squat, deadlift, press, row, clean, snatch, and their variants) divided by bodyweight, read against published bodyweight strength standards. With no bodyweight, or no free-weight core lift yet, it stays unscored or is estimated conservatively from machine work and marked as such.",
      source: "The bodyweight-strength-standard bands are this app's arrangement of published strength standards; no single publication is bundled with the app, and the app does not pretend otherwise.",
    },
    {
      id: "attr-END", term: "Stamina", aliases: ["Stamina", "END", "work capacity"],
      plain: "Your engine — cardio and how long you can keep working. Runs, rides and long sets all feed it, and resting less between sets raises the demand it sees.",
      real: "A weighted blend of cardio minutes per week against the 150 min/week guidance, distance per week scored against the logged modality's own range (running and cycling are not the same scale), best single-set reps, strength sets per week, and the training density figure. Short rest lowers the density score, which is why it moves Stamina only.",
      source: "WHO 2020 physical-activity guidelines (150-300 min/week of moderate activity) for the cardio reference; the weighting of the blend is this app's own.",
    },
    {
      id: "attr-POW", term: "Power", aliases: ["Power", "POW", "explosiveness"],
      plain: "Explosive strength — how fast you can put force out. Jumps, throws and heavy low-rep sets build it.",
      real: "Olympic-lift score (clean/snatch 1RM vs bodyweight standards, when logged), explosive reps logged (jumps, plyos, throws, swings), and heavy low-rep sets (3 reps or fewer at a real load), averaged together.",
      source: "The Olympic-lift standards are published bodyweight tables; the averaging of the three components is this app's own weighting.",
    },
    {
      id: "attr-MOB", term: "Mobility", aliases: ["Mobility", "MOB", "range"],
      plain: "The range of movement you can produce and control — stretching, joint work, and stability at end-range. Loaded short-range work like crunches deliberately does not count, and neither does a mid-range lift: it can only express the range you already have.",
      real: "Minutes per week of recognised mobility and control work (stretching, foam rolling, joint rotations, and stability/anti-rotation holds such as plank, bird dog, Pallof press, Turkish get-up), scored against a weekly reference range. Loaded END-RANGE work — a Romanian deadlift held at the bottom, a paused hinge, a good morning — counts too, at a third of a stretch's rate, because it genuinely lengthens tissue under load, though range is a side effect of a strength lift rather than its purpose. A conventional deadlift pulled from the floor is a mid-range strength lift, so it does not count. Loaded flexion under a short range (crunches, sit-ups) trains strength, not range.",
      source: "This app's own minute-range reference and its own definition of what counts, including the one-third rate for loaded end-range work and the 5-second-per-rep assumption. It is a product judgement, not a published standard — the same convention the app uses for its recovery window. No specific publication is bundled for the weekly range.",
    },
    {
      id: "attr-CON", term: "Discipline", aliases: ["Discipline", "CON", "consistency"],
      plain: "How often you turn up — and, separately, how regularly. Missing one week dents it; it does not wipe it out.",
      real: "70% frequency (sessions in the last 28 days against your weekly target) plus 30% continuity. Continuity is two smooth signals — the longest stretch without a session, and how many of the window's weeks had at least one — so a single hard week is a dent rather than a collapse.",
      source: "This app's own 70/30 split and continuity definition. No separate publication.",
    },
    {
      id: "attr-VIT", term: "Vitality", aliases: ["Vitality", "VIT", "body comp"],
      plain: "Your body composition — how healthy your weight and body fat are, plus any progress toward the goals you set. Food logging never feeds it.",
      real: "A body-composition HEALTH score first: the sex-specific healthy body-fat band and a healthy BMI. Goal progress is then ADDED on top — closing the gap toward your goal weight or body-fat goal raises the score, but simply having a goal, or not having moved yet, never lowers it. It reads only your body measurements — food logging is a separate thing and never feeds it. No measurements means no score; a BMI-only score is capped.",
      source: "BMI is the standard weight-for-height index (WHO); the weighting of the blend and the cap are this app's own. The body-fat inputs are estimates — see the 'Body fat %' entry.",
    },
    {
      id: "firstlog", term: "First Entry", aliases: ["First Entry"],
      plain: "You logged your first food. That is the whole thing — the first step is the one that starts the habit, so it is worth a nod.",
      real: "Awarded the first time a day carries at least one logged food. It reads only whether a day has an entry, never what or how much, so it cannot be earned by eating less and logging many items in one day is still one day.",
      source: "This app's own first-time rule (a logged day exists). No external definition.",
    },
    {
      id: "logcover4", term: "Well Tracked", aliases: ["Well Tracked"],
      plain: "You logged food on five or more days in each of four separate weeks. Keeping a record is the habit that makes the rest of the nutrition tab work.",
      real: "Counted per Monday-start week: a week counts when at least five DISTINCT days in it carry a logged food. Fifty entries in one day is still one day, and the weeks do not have to be consecutive — a missed day is information, not a failure. It reads days, never amounts, so a low-calorie day earns nothing extra and eating less cannot trigger it.",
      source: "This app's own logging-coverage measure (5+ logged days per week). No external definition.",
    },
    {
      id: "logcover12", term: "In the Habit", aliases: ["In the Habit"],
      plain: "Twelve weeks of logging food on five or more days a week — the point where food tracking is simply part of your routine.",
      real: "The same 5+ distinct-logged-days-per-week coverage as Well Tracked, counted across twelve separate weeks (consecutive or not). It counts DAYS and never amounts, so it cannot be farmed by adding entries and cannot be earned by eating less.",
      source: "This app's own logging-coverage measure (5+ logged days per week). No external definition.",
    },
    {
      id: "foodvariety", term: "Varied Plate", aliases: ["Varied Plate"],
      plain: "Twenty different foods logged. Variety across what you eat is a gentle nudge, not a rule — a wider range of foods tends to cover more of what your body needs.",
      real: "Distinct foods counted by name, case-insensitive. Logging the same food many times counts once, so it cannot be farmed by volume; and it never reads portion size or calories, so it cannot be earned by eating less.",
      source: "This app's own variety count (distinct food names logged). No external definition.",
    },
  ];

  const INDEX = TERMS.reduce((m, t) => { m[t.id] = t; return m; }, {});
  const get = (id) => INDEX[id] || null;
  const has = (id) => !!INDEX[id];
  const list = () => TERMS.slice();

  /* Map an engine muscle-balance status word onto its entry id. The keys are the
     words the engine actually emits and the card actually shows, so a renamed
     status word must be renamed here too — test_features proves every emitted
     word resolves, and that the entry's own heading is the word on screen. */
  const STATUS_ID = {
    "room to grow": "below-mev", "building": "mev-mav",
    "sweet spot": "optimal", "over its limit": "over-mrv", "not trained yet": "untrained",
  };
  const statusId = (status) => STATUS_ID[status] || null;

  /* Map an engine attribute key onto its entry id. */
  const attrId = (key) => (has("attr-" + key) ? "attr-" + key : null);
  const attrPlain = (key) => { const e = get("attr-" + key); return e ? e.plain : ""; };
  const attrReal = (key) => { const e = get("attr-" + key); return e ? e.real : ""; };

  /* A tappable term. Every one of these opens its entry, so the handler in
     app.js is the single place the click is served. */
  function link(id, text, cls) {
    const e = get(id);
    if (!e) return esc(text);         // no entry: render plain text, never a dead button
    return `<button type="button" class="term-link${cls ? " " + cls : ""}" data-term="${id}"`
      + ` title="What does this mean?">${text == null ? esc(e.term) : text}</button>`;
  }

  /* One entry's body: plain first, the real thing underneath, then the source it
     rests on — an explanation without a source is not finished. */
  function entryHTML(e) {
    return `<h3>${esc(e.term)}</h3>`
      + `<p class="gloss-plain">${esc(e.plain)}</p>`
      + `<p class="gloss-real"><span class="gloss-lab">In full</span> ${esc(e.real)}</p>`
      + `<p class="gloss-src"><span class="gloss-lab">Source</span> ${esc(e.source)}</p>`;
  }

  /* Open one entry in the shared modal. ctx = { el, open, close }. */
  function open(ctx, id) {
    const e = get(id);
    if (!e) return false;
    const box = ctx.el("div", { class: "glossary" });
    box.innerHTML = entryHTML(e)
      + `<div class="row end"><button class="btn ghost" id="gl-close">Close</button></div>`;
    ctx.open(box, "wide");
    const cb = box.querySelector("#gl-close"); if (cb) cb.addEventListener("click", ctx.close);
    return true;
  }

  /* The whole list, reached from Profile. Each row opens its entry; a Back
     control on an entry returns to the list. */
  function openAll(ctx) {
    const box = ctx.el("div", { class: "glossary gloss-all" });
    box.innerHTML = `<p class="muted small">Every word the app uses, in plain English, with the source behind it. Tap one to read it, or open it from the term itself on any card.</p>`
      + `<div class="gloss-list">` + list().map((e) =>
        `<button type="button" class="gloss-item" data-term="${e.id}">${esc(e.term)}</button>`).join("") + `</div>`
      + `<div class="row end"><button class="btn ghost" id="gl-close">Close</button></div>`;
    ctx.open(box, "wide");
    const cb = box.querySelector("#gl-close"); if (cb) cb.addEventListener("click", ctx.close);
    Array.prototype.forEach.call(box.querySelectorAll(".gloss-item"), (b) =>
      b.addEventListener("click", () => open(ctx, b.dataset.term)));
    return true;
  }

  return { TERMS, get, has, list, link, entryHTML, open, openAll, statusId, attrId, attrPlain, attrReal, STATUS_ID };
})();
if (typeof module !== "undefined") module.exports = Glossary;
