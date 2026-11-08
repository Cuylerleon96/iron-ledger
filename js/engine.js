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
    { key: "MOB", label: "Mobility",  sub: "range & control",color: "#6ee7b7" },
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

  /* ---------- bodyweight movements ----------
     On a pull-up or a push-up the load is YOURSELF, not the number in the weight
     box. Those sets used to be rejected outright (the filter demanded w > 0), so
     unweighted bodyweight work could not be logged or graded at all, and adding
     20 lb of belt weight estimated a 1RM of about 26 lb — nonsense, because the
     weight you enter is strapped ON TOP of the body moving it.

     The fraction of bodyweight actually moved, per movement family. These are the
     standard published figures from kinetic and EMG work (push-up ~0.64 BW, dip
     ~0.95, pull-up/chin-up ~1.0), rounded; anything unmatched takes a mid-range
     0.65. They are approximations and are labelled as such. */
  const BW_FACTOR = [
    /* "Australian pull-up" is a low-bar bodyweight row, not a hanging pull-up:
       it must resolve to the row reference (0.57), not the pull-up's 1.00. The row
       rule below lists it too, but this rule sits first so the pull-up pattern
       cannot shadow it. Gated by BW_NAME ("australian"). */
    [/australian/i, 0.57],
    [/pull.?up|chin.?up|muscle.?up|lat pull.?up/i, 1.00],
    [/\bdip\b|dips/i, 0.95],
    /* Push-up variants from published force-plate measurement, NOT derived.
       Percentage of bodyweight carried by the hands: flat 64-66% (two independent
       studies agree; Int J Exerc Sci 2023 measures standard push-up 67.0 +/- 3.8%
       men / 65.1 +/- 3.1% women), knee push-up 49-52.5%, and across hand/foot
       elevation the measured range is approximately 41% to 74% of body mass
       (Gouvali & Boudolos 2005). Assumed standard setups, same convention as the
       40-degree bench: hands elevated ~30-40 cm (near the low end), feet elevated
       ~40-60 cm (near the top).
       The published relationship with elevation is roughly LINEAR in height, not a
       pure cosine: Ebben measures 64 -> 55 -> 41 %BM for flat -> +30.5 cm -> +61 cm
       of hand elevation, about 0.20 %BM per 30 cm.
       NAMING TRAP: for push-ups 'incline' means HANDS elevated = EASIER, and
       'decline' means FEET elevated = HARDER — the opposite of the bench-crunch
       convention. These match on the direction word, never a shared 'incline'. */
    [/push.?up.*(feet|decline)|decline push.?up|feet.?elevated push.?up/i, 0.74],
    [/push.?up.*(hands|incline)|incline push.?up|hands.?elevated push.?up/i, 0.55],
    /* 0.49, not a midpoint: Ebben/Wurm 2011 and Suprak 2011 independently measure
       49%; Gouvali & Boudolos 2005 report 52.9% for the on-knees variant. Two of
       three agree, so the consensus value wins. */
    [/knee push.?up|modified push.?up|push.?up.*knee/i, 0.49],
    [/push.?up|press.?up/i, 0.64],
    /* Rows — fitted to the four MEASURED suspension-row anchors.
       Melrose & Dawes (J Athl Enhancement 2014/15) dynamometer values, % of body
       mass lifted by the arms vs body angle from VERTICAL:
         theta 30 -> 0.3744, 45 -> 0.5288, 60 -> 0.6808, 75 -> 0.7938.
       Giancotti 2021 agrees directionally (force platform). The plain-bar inverted
       row has no independent published %BW figure, but it is the same lever (the
       body pivoting about the hands); a fixed bar only removes the stabiliser
       demand, not the load fraction, so the fit transfers.
       Three candidate relationships were fitted to the four anchors (theta = deg):
         (a) cosine of angle from horizontal  f = k*sin(theta)      RMSE 0.0238
         (b) linear in angle from vertical     f = a + b*theta       RMSE 0.0111  <- best
         (c) lever about the feet, rigid body, vertical arm force:
             f = COM lever / hand lever = c/L, INDEPENDENT of angle  residual +/-0.20 (fails)
             (with a horizontal strap instead, f = (c/L)tan(theta))   RMSE 0.0636
       The measured increments (0.154, 0.152, 0.113 over equal 15 deg steps) are
       near-linear then lightly saturating, so the linear fit wins and the pure
       lever model is out (it predicts a constant fraction, which the data deny).
       Least squares: a = 0.1009, b = 0.009401 per degree. ESTIMATED, calibrated to
       the MEASURED anchors. Reference angle assumed: 50 deg from vertical (matches
       the 0.60 this replaces).
         more-upright / high anchor  30 deg -> 0.1009 + 0.009401*30 = 0.383 -> 0.38
         reference plain inverted    50 deg -> 0.1009 + 0.009401*50 = 0.571 -> 0.57
         more-horizontal / low anchor 75 deg -> 0.1009 + 0.009401*75 = 0.806 -> 0.81
       Endpoints keyed on the direction word; the more upright the body, the less of
       it the arms lift. */
    [/incline row|standing row|upright row|high anchor row/i, 0.38],
    [/decline row|feet.?elevated row|horizontal row|low anchor row/i, 0.81],
    [/inverted row|bodyweight row|australian pull/i, 0.57],
    [/pistol|single.?leg squat|bulgarian|split squat|lunge|step.?up/i, 0.85],
    /* Nordic hamstring curl / glute-ham raise: the hamstrings resist the lean of
       everything above the KNEE. Upper-body mass = trunk + head + both arms
       (Dempster/Winter 2009: head 0.081 + trunk 0.497 + 2 arms 0.100 = 0.678 BW;
       Winter's table, derived from Dempster 1955). That mass acts at its COM,
       whose horizontal moment arm about the knee is r*sin(theta), theta = trunk
       lean from vertical. Equivalent load fraction = 0.678*sin(theta):
         Nordic, trunk reaches horizontal (theta = 90 deg): 0.678*1.000 = 0.68
         Glute-ham, the hip hinge folds the lever so the trunk tops out about
           60 deg from vertical (theta = 60 deg):       0.678*0.866 = 0.59
       Moving the foot plate lengthens/shortens the shank lever below the knee and
       shifts a given rep between the two. ESTIMATED (unanchored: no %BW force-plate
       study exists for these; the mass/COM tables are the only published basis). */
    [/nordic|razor curl/i, 0.68],
    [/glute.?ham/i, 0.59],
    [/calf raise|heel raise/i, 1.00],
    [/bodyweight squat|air squat|\bsquat\b.*bodyweight/i, 0.65],
    [/sissy squat|reverse hyper|back extension|hyperextension/i, 0.45],
    /* Isometric holds. The forearm plank's forearms DO carry a share of bodyweight
       — the body is a two-support lever on the toes and forearms, so that share is
       (COM distance from toes)/(forearm distance from toes) ~ 0.60-0.68 BW, close
       to the measured push-up hand load (0.64-0.69, Ebben/Wurm 2011). But a hold
       MOVES nothing: work = force x displacement = 0. This factor feeds tonnage
       (load x reps) and an Epley e1RM, both of which presume a rep displaced
       against gravity, so a non-zero value here would manufacture tonnage and a
       1RM out of a static pose. Left at 0.00 deliberately: the static forearm
       share is a real force but not a moved load, and mode "time" never reads this
       factor anyway. */
    [/plank|hold|isometric|hollow|\bl.?sit\b|dead ?hang|flexed arm hang/i, 0.00],
    /* --- crunch / sit-up on an angled bench, both directions: trunk sweep ---
       phi = the trunk's angle from horizontal, head-up positive. The moving mass
       is the trunk, whose centre sits a distance r from the hip axis, so the
       resisting torque at the hip is m*g*r*cos(phi) and one rep's work is
       integral m*g*r*cos(phi) dphi = m*g*r*(sin(phi_top) - sin(phi_rest)).
       That one expression carries BOTH effects this family turns on: the mean
       moment arm (mean cos = (sin top - sin rest)/sweep) and the range of motion
       (the sweep itself). Every value below is 0.40 (the flat-crunch reference)
       scaled by (sin top - sin rest) relative to the flat sweep — i.e. exactly
       (mean-cos ratio) x (range-of-motion ratio). Nothing here is a guessed number.

       Reference — flat crunch / sit-up: rest 0 deg, top +35 deg. The assumed top
       of the curl is 35 deg above horizontal: the shoulders finish ~35 deg up,
       where a floor crunch tops out. Work_ref ∝ sin35 = 0.574; sweep 35 deg;
       mean cos 0.939.

       Head-below (bench at 40 deg with the HEAD BELOW THE HIPS — the owner's
       standard, whatever the bench is called): rest -40 deg, top +35 deg. It
       sweeps 75 deg, and the work ∝ sin35 - sin(-40) = 1.216 = 2.12x the flat
       sweep. The peak load is unchanged (mean cos 0.929 vs 0.939) — all of the
       extra cost is the longer arc. Hence 0.40 x 2.12 = 0.85, and the same 2.12
       is carried as a work factor (below) because the PER-REP WORK rose, not just
       the load. (The plate rides the same longer arc so this is very slightly
       conservative on the added weight; the body is ~89% of the load, so it
       captures the effect.) */
    [/incline crunch|decline crunch|decline sit.?up/i, 0.85],
    /* Head-above (bench at 40 deg with the HEAD ABOVE THE HIPS): the torso rests
       at +40 deg and curls the same 35 deg a flat crunch does, to +75 deg — the
       SAME range as flat, but the whole arc sits where cos(phi) is small, so the
       moment arm is short. Work ∝ sin75 - sin40 = 0.323 = 0.56x the flat sweep
       (mean cos 0.529 vs 0.939; range unchanged). 0.40 x 0.56 = 0.23: easier,
       exactly as the geometry says. Keyed on the head-up geometry ("incline
       sit-up" / "head-above" / "head-elevated"); note the owner's "Incline
       Crunches" is the head-below case above, which is why the two spellings
       land on different rules. */
    [/incline sit.?up|head.?above|head.?elevated/i, 0.23],
    /* Leg raise / knee raise: HIP flexion — the LEGS swing about the hip, unlike a
       crunch where the trunk does. Moving mass = both lower limbs. Per-leg segment
       masses (Winter 2009, from Dempster 1955): thigh 0.100, shank 0.0465,
       foot 0.0145 -> 0.161 per leg, 0.322 both. Their composite COM sits 0.218 of
       body HEIGHT from the hip (thigh COM at 0.433*Lt, shank COM at Lt+0.433*Ls,
       foot COM at Lt+Ls+0.5*Lf), i.e. 0.446 of the hip-to-ankle length.
       Equivalent load fraction = 0.322 * mean cos(theta_leg) over the sweep, the
       same mean-moment-arm convention the crunches use:
         straight-leg (legs hang 90 deg from horizontal, raise to horizontal):
           mean cos = 2/pi = 0.637 -> 0.322*0.637 = 0.205 -> 0.21
         bent-knee (thigh to horizontal, shank hangs vertical): the shank and foot
           hang straight down so only the thigh keeps a moment arm; per-leg moment
           falls to 0.02556*H vs 0.03514*H straight = 0.727x -> 0.205*0.727 = 0.15
       ESTIMATED, and UNANCHORED — no force-plate %BW figure exists for leg raises
       (as with crunches); the geometry above is the sole basis. */
    [/knee raise|reverse crunch|bent.?knee/i, 0.15],
    [/hanging leg raise|straight.?leg|leg raise/i, 0.21],
    /* Flat crunch / sit-up — the reference sweep 0 -> +35 deg (mean cos 0.939).
       This 0.40 is the base both angled-bench values are derived from. It also
       stands for the other TRUNK-flexion movements (v-up) that share a flat-ish
       arc. (Leg and knee raises are NOT trunk flexion — see the derived hip-flexion
       values above.) */
    [/sit.?up|crunch|\bv.?up\b/i, 0.40],
  ];
  const BW_NAME = /pull.?up|chin.?up|push.?up|press.?up|\bdips?\b|(incline|decline|feet.?elevated|horizontal|standing|upright|high anchor|low anchor|australian|bodyweight) row|\binverted row\b|bodyweight|plank|hollow|\bl.?sit\b|pistol|nordic|glute.?ham|razor curl|hanging|flexed arm hang|muscle.?up|air squat|sissy|reverse hyper|back extension|hyperextension|crunch|sit.?up|leg raise|knee raise|bird dog|dead ?bug|bear crawl|mountain climber/i;
  const bwFactor = (name) => {
    const n = String(name || "");
    for (const [re, f] of BW_FACTOR) if (re.test(n)) return f;
    return 0.65;                        // mid-range assumption, labelled as one
  };
  /* Equipment that supplies the load itself. "Seated Dip Machine" matches \bdip\b
     but its resistance is the stack, not the body — counting bodyweight on top of
     it inflated a machine movement. Anything naming its own load source is not a
     bodyweight movement, however bodyweight-like its pattern looks. */
  const SUPPLIES_LOAD = /machine|smith|cable|lever|assisted|band|sled|weighted vest/i;
  /* A name is bodyweight when EITHER list recognises it. The gate and the factor
     table were two independent lists, so a movement could carry a factor (0.85
     for every lunge, 1.00 for a calf raise) and still be REFUSED by the gate —
     the factor was dead code, and worse, entryStats then filtered its unweighted
     sets out of the totals entirely. The gate is now DERIVED from the factor
     table: anything with a factor is admitted, so the two can never disagree
     again. Equipment that supplies its own load is still excluded. */
  const hasBwFactor = (name) => BW_FACTOR.some(([re]) => re.test(String(name || "")));
  const isBodyweight = (name) => {
    const n = String(name || "");
    if (SUPPLIES_LOAD.test(n)) return false;
    return BW_NAME.test(n) || hasBwFactor(n);
  };

  /* Epley: 1RM = w·(1 + r/30). Accurate to ~12 reps; flagged as an estimate. */
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

  /* ---------- set types ---------- */
  /* What KIND of set this was — one fact, one field (`s.ty`). It is not a
     decorative tag: it changes what the set is worth, in exactly two ways.
       - a warm-up is NOT a working set: it adds no volume, no tonnage and no
         effort. It is still logged and shown, just counted separately so the
         numbers the app reports stay honest about what is a working set.
       - a drop set and a failure set are harder than a straight set, so they feed
         the effort path (muscleGroups' effSets) at more than one working set, the
         same path the per-exercise effort weight already uses.
     The multipliers are deliberate heuristics, NOT measurements: the smallest
     numbers that make the difference visible, kept here in one place so there is
     one thing to tune. A set carries ONE type — the values are mutually exclusive. */
  const SET_TYPES = {
    normal:  { label: "Set",      effort: 1,    working: true  },
    warmup:  { label: "Warm-up",  effort: 0,    working: false },
    drop:    { label: "Drop set", effort: 1.25, working: true  },
    failure: { label: "Failure",  effort: 1.2,  working: true  },
  };
  const setType = (s) => (s && SET_TYPES[s.ty]) ? s.ty : "normal";
  const setTypeLabel = (s) => SET_TYPES[setType(s)].label;
  const isWarmupSet = (s) => !!(s && s.ty === "warmup");
  /* How much a set counts as a working set for the effort path: 1 for a straight
     set, more for a drop or failure set, 0 for a warm-up. */
  const setEffort = (s) => SET_TYPES[setType(s)].effort;
  
  /* Sets logged before bodyweight-aware scoring shipped — or imported from an
     export — carry no `bwKg` stamp, and entryStats has no fallback for a missing
     one: `num(undefined)` is 0, so the bodyweight quietly contributed nothing.
     A weighted incline crunch holding 15 lb on the chest scored an e1RM of 21 lb
     as though the body weighed nothing, when the honest load is 138.2 x 0.40 + 15.

     Stamp each bodyweight set with the bodyweight that was true on its own
     session's date. Idempotent, and it never invents one: with no bodyweight
     known at all the set is left alone and still scores on the plate alone. */
  function backfillBodyweight(state) {
    let n = 0;
    for (const w of state.workouts || []) {
      const bw = bodyweight(state, w.date);
      if (!(bw > 0)) continue;
      for (const e of w.entries || []) {
        if (!isBodyweight(e.name)) continue;
        for (const s of e.sets || []) {
          if (!(num(s.bwKg) > 0)) { s.bwKg = bw; n++; }
        }
      }
    }
    return n;
  }

  function entryStats(entry) {
    const mode = entry.mode || "weight_reps";
    const bw = isBodyweight(entry.name);
    const valid = (entry.sets || []).filter((s) => {
      // a bodyweight movement is valid on reps alone — the weight box holds only
      // what is strapped on, so requiring it discarded every unweighted set
      if (mode === "weight_reps") return num(s.r) > 0 && (num(s.w) > 0 || bw);
      if (mode === "reps") return num(s.r) > 0;
      if (mode === "time") return num(s.t) > 0;
      if (mode === "distance_time") return num(s.d) > 0 || num(s.t) > 0;
      if (mode === "weight_time") return num(s.t) > 0;
      if (mode === "weight_distance") return num(s.d) > 0;
      return false;
    });
    /* A warm-up is logged and shown but is NOT a working set: it contributes no
       volume, no tonnage, no reps and no effort. Everything below runs on the
       working sets only; the warm-ups are counted so the UI can say so out loud
       instead of quietly folding a ramp into the totals. */
    const sets = valid.filter((s) => !isWarmupSet(s));
    const warmups = valid.length - sets.length;
    let volume = 0, reps = 0, time = 0, dist = 0, best = 0, bestSet = null, bestReps = 0, tonnage = 0, rpeSum = 0, rpeN = 0;
    let restSum = 0, restN = 0, workSec = 0, hardReps = 0, highReps = 0, effSets = 0;
    for (const s of sets) {
      volume += setVolume(s, mode);
      reps += num(s.r); time += num(s.t); dist += num(s.d);
      // effort sets: a working set is worth 1, a drop or failure set more, and
      // this is the value muscleGroups weighs by the exercise's own effort factor
      effSets += setEffort(s);
      /* Tonnage is load x reps and nothing else. It used to run for any set with
         a weight and substitute Math.max(1, reps) when reps were undefined, so a
         20kg x 45s hold scored "20 kg of tonnage" — a number nobody lifted,
         feeding totals, XP and badges. */
      /* The load actually moved: body weight for a bodyweight movement, plus
         whatever is strapped on. `loadKg` on the set is a full override, and
         bwKg is stamped at log time so an old session is scored with the
         bodyweight that was true THAT day rather than today's. */
      const loadKg = mode === "weight_reps"
        ? (num(s.loadKg) > 0 ? num(s.loadKg)
           : num(s.w) + (bw ? num(s.bwKg) * bwFactor(entry.name) : 0))
        : 0;
      if (mode === "weight_reps" && loadKg > 0) tonnage += loadKg * num(s.r);
      /* `best` has to be the mode's OWN best, or every non-weight mode reports 0
         and its trend, ETA and plateau detection silently never work. */
      const e = mode === "weight_reps" ? est1RM(loadKg, num(s.r))
        : mode === "reps" ? num(s.r)
        : mode === "time" ? num(s.t)
        : mode === "distance_time" ? num(s.d)
        : mode === "weight_distance" ? num(s.d)
        : num(s.w) || num(s.t);
      if (e > best) { best = e; bestSet = s; bestReps = num(s.r); }
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
      sets: sets.length, warmups, effSets, volume, reps, time, dist, tonnage,
      est1RM: mode === "weight_reps" ? best : 0,
      // Epley is only trustworthy to ~12 reps, so est1RM is capped there and a
      // 12-rep and a 20-rep set at the same load estimate the same. Exposed so
      // the UI can SAY that instead of showing a real improvement as 0%.
      bestReps,
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
  /* The name is always the library/custom name. There is deliberately NO rename
     override: overrides carry only {mode, weight, g}, all of which this engine
     reads (exMode / exerciseWeight / exGroups). A rename goes through
     custom[].n, so a stored overrides.n would be written and never read. */
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

  /* How many weeks of that window the user has ACTUALLY existed for.
     A brand-new account was measured against the full 28 days, so its first two
     or three sessions read as a huge shortfall against a month it was not there
     for: Discipline judged 3 sessions in 3 days against 16 expected, Stamina and
     Mobility divided weekly rates by 4, and every muscle group's sets/week was
     averaged over four weeks nobody had. Judging someone against time that
     predates them is wrong in the same way as scoring an old session with today's
     bodyweight, and it is discouraging for exactly the people most likely to quit.

     Counted from their FIRST logged session, capped at the window. Once a user is
     28 days in this is 4 and changes nothing, so no established number moves; and
     it cannot be gamed, because the span only starts at the first session. */
  function activeWeeks(state, days = 28) {
    const full = days / 7;
    const dates = (state.workouts || []).map((w) => w.date).filter(Boolean).sort();
    if (!dates.length) return full;
    const spanDays = daysBetween(dates[0], dstr(Date.now())) + 1;
    return Math.max(1, Math.min(full, spanDays / 7));
  }

  /* ---------- date windowing ---------- */
  /* HALF-OPEN: from <= t < to. Both ends used to be inclusive, so a session
     sitting exactly on a boundary (7, 14, 21, 28 days ago) was counted in TWO
     adjacent windows — inflating the weekly volume chart, the cur-vs-prev
     deltas, the deload read and Stamina's sets/week. Half-open windows tile
     exactly: every session lands in one window and only one. */
  function inWindow(w, fromMs, toMs) {
    const t = new Date(w.date + "T12:00:00").getTime();
    return t >= fromMs && t < toMs;
  }
  /* Windows are anchored to local noon so a DST shift never drops or
     double-counts a day. The current window's exclusive end is tomorrow noon,
     which is what makes today always count. */
  function windowWorkouts(state, days, offsetDays = 0) {
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    const to = new Date(noon); to.setDate(to.getDate() - offsetDays + 1);
    const from = new Date(noon); from.setDate(from.getDate() - offsetDays - days + 1);
    return (state.workouts || []).filter((w) => inWindow(w, from.getTime(), to.getTime()));
  }

  /* ---------- bodyweight ---------- */
  /* Only entries that actually carry a weight count. A body-fat-only check-in
     used to zero this out (the last entry existed but had no weightKg), which
     silently dropped the Strength ratio to the hardcoded 80kg guess and removed
     BMI from Vitality — a measurement he never gave being replaced by one invented. */
  function bodyweight(state, atDate) {
    const log = (state.bodylog || []).filter((b) => num(b.weightKg) > 0)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
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
      {
        const en = mergedEntry(w, exId);
        if (!en) continue;
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

  /* All of one exercise's entries in a single session, as one entry. Logging an
     exercise on two cards in one workout used to produce TWO series points with
     the SAME date, so compareLast could compare a session against its own second
     card (60kg x 10 instead of the session's 100kg x 5 best) or, with no later
     session, against itself. A session is one point. */
  function mergedEntry(w, exId) {
    const es = (w.entries || []).filter((en) => en.id === exId);
    if (!es.length) return null;
    if (es.length === 1) return es[0];
    return {
      id: exId, name: es[0].name, mode: es[0].mode,
      restDefault: es.find((en) => en.restDefault != null) ? es.find((en) => en.restDefault != null).restDefault : undefined,
      sets: es.flatMap((en) => en.sets || []),
      _merged: es.length,
    };
  }

  /* Per-exercise series (one point per workout that trained it). */
  function seriesFor(state, exId) {
    const pts = [];
    for (const w of (state.workouts || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
      const en = mergedEntry(w, exId);
      if (!en) continue;
      const s = entryStats(en);
      pts.push({ date: w.date, est1RM: s.est1RM, volume: s.volume, tonnage: s.tonnage, top: s.best, reps: s.reps, sets: s.sets, rpe: s.avgRPE, rest: s.avgRest });
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
      // Same merge as the rest of the engine: an exercise logged on two cards in
      // one workout is ONE session, not two. Iterating w.entries raw here made a
      // single session count twice and let the trend compare a session against
      // its own second card (e.g. against 60kg x 10 instead of the session's
      // 100kg x 5 best), inflating apparent progress.
      const en = mergedEntry(w, exId);
      if (!en) continue;
      const st = entryStats(en);
      if (st.sets) sessions.push({ date: w.date, st, sets: en.sets || [] });
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
      /* A movement can be a core lift and still have no published ratio table —
         pull-ups, chin-ups, dips. Those entered the average under a `null` key and
         were then scored as 0, so three good lifts plus one pull-up read worse
         than the three alone. Only tabled lifts are averaged here; the rest are
         handled by the fallback. */
      if (!k || !STANDARDS[k]) continue;
      const s = entryStats(en);
      if (s.est1RM > (out[k] || 0)) out[k] = s.est1RM;
    }
    return out;
  }

  function strengthScore(state, ws) {
    /* No bodyweight, no ratio. This used to fall back to a hardcoded 80 kg and
       then PRINT it — telling a user who had never entered a weight that his
       bodyweight was 80 kg, and scoring his bench against it. A fabricated
       measurement presented as a real one is worse than no score, so this reports
       "no weight" and the UI asks for one, exactly like the other attributes do
       when they have nothing to go on. */
    const bw = bodyweight(state);
    if (!(bw > 0)) return { score: 0, basis: "no weight", bw: 0, n: 0, lifts: {} };
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
    /* Score each movement against its OWN published table wherever one exists.
       This used to take the median lift and read it off the BENCH PRESS table
       regardless of what it was — so a 200kg leg press, judged as a bench press,
       gave a leg-press-only lifter 75/100 "Very good" on pressing he had never
       done, and a seated dip machine could decide the headline Strength number.
       Machine work is still discounted, because a stack is not a barbell. Only
       movements with no table at all fall back to a generic load-vs-bodyweight
       read, and that read is capped low. */
    const loads = [];
    for (const w of ws) for (const en of w.entries || []) {
      const s = entryStats(en);
      if (!(s.est1RM > 0)) continue;
      const info = exInfo(state, en.id);
      const disc = isMachine(state, en.id) ? 0.62 : 0.85;
      loads.push({ v: s.est1RM * disc, id: en.id, key: liftKey(info.n), name: info.n });
    }
    if (!loads.length) return { score: 0, basis: "none", bw, n: 0 };
    const rated = loads.filter((l) => l.key && STANDARDS[l.key]).sort((a, b) => b.v - a.v);
    if (rated.length) {
      const use = rated.slice(0, 3);
      const scores = use.map((l) => liftScore(l.v / bw, l.key, sex));
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      // still capped: these are machine and submaximal loads, not tested maxes
      return { score: clamp(Math.min(75, avg)), basis: "estimated", bw, n: 0,
               from: use.map((l) => l.name).join(", ") };
    }
    loads.sort((a, b) => b.v - a.v);
    const med = loads[Math.min(1, loads.length - 1)];
    const score = Math.min(55, interp(med.v / bw, [0.5, 1.0, 1.5, 2.0, 2.5], [8, 24, 40, 58, 72]));
    return { score: clamp(score), basis: "estimated", bw, n: 0, from: med.name };
  }

  /* A run or a ride is gauged by TIME and DISTANCE, never by load: there is no
     tonnage and no reps. Scoring cardio on minutes alone meant a 30-minute stroll
     scored exactly the same as a 30-minute threshold run, and the logged distance
     was thrown away.

     Distance is scored against the modality's OWN weekly reference range, because
     20 km is a hard week on foot and a warm-up on a bike — one shared distance
     scale would make every cyclist Elite and every runner Novice. Hours still come
     from the modality-agnostic 150 min/week guidance. */
  const CARDIO_MOD = [
    [/run|jog|treadmill|sprint|walk|hik|ruck/i, "on foot", [0, 5, 15, 35, 70]],
    [/bike|cycl|spin|ride|velo/i,           "cycling", [0, 20, 60, 120, 250]],
    [/row|erg/i,                                "rowing",  [0, 3, 10, 25, 50]],
    [/swim/i,                                   "swim",    [0, 1, 3, 7, 15]],
    [/elliptical|stair|jump rope|rope/i,        "other",   [0, 5, 15, 35, 70]],
  ];
  const cardioMod = (name) => {
    for (const [re, label, xs] of CARDIO_MOD) if (re.test(name)) return { label, xs };
    return { label: "other", xs: [0, 5, 15, 35, 70] };
  };

  function staminaScore(state, ws) {
    // cardio: minutes AND distance, kept apart per modality
    let cardioMin = 0, distKm = 0, cardioKm = 0, cardioSec = 0;
    const byMod = new Map();
    for (const w of ws) for (const en of w.entries || []) {
      const m = exMode(state, en.id);
      const info = exInfo(state, en.id);
      if (m === "distance_time" || info.c === "Cardio") {
        const mod = cardioMod(info.n);
        if (!byMod.has(mod.label)) byMod.set(mod.label, { km: 0, min: 0, xs: mod.xs });
        const bucket = byMod.get(mod.label);
        for (const s of en.sets || []) {
          const mins = num(s.t) / 60, km = num(s.d) / 1000;
          cardioMin += mins; distKm += km; bucket.min += mins; bucket.km += km;
          if (num(s.d) > 0 && num(s.t) > 0) { cardioKm += num(s.d) / 1000; cardioSec += num(s.t); }
        }
      }
    }
    const weeks = activeWeeks(state, 28);
    const minPerWk = cardioMin / weeks;
    const minScore = interp(minPerWk, [0, 30, 75, 150, 300], [6, 30, 52, 75, 95]);
    // each modality scored against its own range; the best one carries, so
    // logging one sport properly is never penalised for not doing another
    let distScore = 0, distMod = null;
    for (const [label, v] of byMod) {
      if (!(v.km > 0)) continue;
      const sc = interp(v.km / weeks, v.xs, [6, 30, 52, 75, 95]);
      if (sc > distScore) { distScore = sc; distMod = label; }
    }
    // distance is only half the score when distance was actually logged — with
    // none recorded, minutes alone stand rather than inventing a penalty
    const hasDist = distKm > 0;
    const cardioScore = hasDist ? 0.6 * minScore + 0.4 * distScore : minScore;
    const paceKmh = cardioSec > 0 ? cardioKm / (cardioSec / 3600) : null;
    // rep capacity: best single-set reps logged
    let maxReps = 0;
    for (const w of ws) for (const en of w.entries || []) {
      for (const s of en.sets || []) maxReps = Math.max(maxReps, num(s.r));
    }
    const repScore = interp(maxReps, [5, 10, 15, 20, 30], [10, 30, 48, 66, 88]);
    // volume tolerance: strength sets per week — cardio intervals are not
    // working sets and were inflating this, so a runner's interval session read
    // as gym volume he had not done
    let sets = 0;
    for (const w of ws) for (const en of w.entries || []) {
      const m = exMode(state, en.id);
      if (m === "distance_time" || m === "time") continue;
      sets += entryStats(en).sets;
    }
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
    return { score: clamp(score), cardioMinPerWk: minPerWk,
             distKmPerWk: distKm / weeks, distKm, cardioKm, distMod,
             paceKmh, paceMinPerKm: paceKmh ? 60 / paceKmh : null,
             maxReps, setsPerWk: sets / weeks, avgRest, density, hardReps, highReps, restN };
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

  /* Mobility is the range you can PRODUCE and CONTROL, so two kinds of work feed
     it: flexibility and joint work (stretching, yoga, foam rolling, joint
     rotations), and control-at-range work — rotations and anti-movement stability
     holds, which are the second half of usable range.

     Previously only the first kind counted, and only when the exercise NAME
     happened to contain one of six words: of 166 mobility and stability movements
     in the library, 96 scored zero, including Plank, Side Plank, Bird Dog,
     Deadbug, Pallof Press, Turkish Get-Up and Thoracic Rotation.

     Loaded spinal FLEXION under a short range is deliberately excluded, however
     much core work it represents: a crunch trains about 30 degrees of flexion
     against resistance and lengthens nothing. Counting it would make this axis
     stop measuring range — and the point of the axis is to be accurate. */
  const MOB_RE = /stretch|mobility|yoga|foam|flexib|range of motion|dynamic warm|rotat|pallof|anti.?rotation|bird ?dog|dead ?bug|deadbug|clamshell|\bcars?\b|dislocat|thoracic|cervical|90\/90|hip opener|get.?up|cat.?cow|world'?s greatest|bear crawl|plank|\bhold\b|side.?lying|scapular|ankle|wrist|hip circle|shoulder circle|arm circle|leg swing|deep squat/i;
  // strength done in a short range, not range itself
  const NOT_MOB_RE = /crunch|sit.?up|roll ?out|jack|knee.?raise|leg ?raise|v.?up|hanging|toe touch|good morning/i;
  const isMobility = (name) => MOB_RE.test(name) && !NOT_MOB_RE.test(name);

  function mobilityScore(state, ws) {
    let min = 0, sessions = 0;
    for (const w of ws) {
      let touched = false;
      for (const en of w.entries || []) {
        if (!isMobility(exInfo(state, en.id).n)) continue;
        touched = true;
        for (const s of en.sets || []) min += (num(s.t) / 60) || num(s.r) * 0.5;
      }
      if (touched) sessions++;
    }
    const perWk = min / activeWeeks(state, 28);
    return { score: clamp(interp(perWk, [0, 15, 40, 80, 150], [4, 30, 55, 78, 95])), minPerWk: perWk, sessions };
  }

  /* Discipline has two parts, and only one of them used to count.
     FREQUENCY — did you show up enough times (sessions vs your weekly target).
     CONTINUITY — did you show up regularly, which is a different question, and the
     streak the card printed contributed exactly nothing to the score.

     Continuity is deliberately built from two SMOOTH signals rather than a streak
     counter, because a counter is all-or-nothing: break it and it reads zero. One
     hard week should be a dent, not a collapse.
       - the longest stretch with no session anywhere in the window (plus the wait
         since the last one), interpolated, so 3 days is near-perfect and 7 days
         still scores 75
       - how many of the window's four weeks had at least one session
     The stretch before a first-ever session is ignored: that is when he started,
     not evidence of irregularity. */
  function consistencyScore(state, ws) {
    const target = num(state.profile.weeklyTarget) || 4;
    const sessions = ws.length;
    // only the weeks this user has existed for — see activeWeeks
    const weeks = activeWeeks(state, 28);
    const expected = target * weeks;
    const rate = expected > 0 ? sessions / expected : 0;
    /* Softer around the target than it used to be: hitting three quarters of your
       plan is still good training, and the old curve read it as a fail. */
    const frequency = clamp(interp(rate, [0, 0.25, 0.5, 0.75, 1, 1.25], [0, 25, 50, 72, 88, 97]));
    const st = streaks(state);
    if (!sessions) {
      return { score: 0, sessions: 0, expected, rate: 0, frequency: 0, continuity: 0,
               longestGap: null, weeksCovered: 0, streakDays: st.days, streakWeeks: st.weeks };
    }
    const dates = [...new Set(ws.map((w) => w.date))].sort();
    const t = (d) => new Date(d + "T12:00:00").getTime();
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    let longestGap = Math.max(0, Math.round((noon.getTime() - t(dates[dates.length - 1])) / DAY));
    for (let i = 1; i < dates.length; i++) longestGap = Math.max(longestGap, Math.round((t(dates[i]) - t(dates[i - 1])) / DAY));
    const gapScore = interp(longestGap, [0, 3, 7, 10, 14, 21], [100, 95, 75, 58, 40, 18]);
    const weekOf = (d) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return dstr(x); };
    const covered = new Set(dates.map(weekOf)).size;
    // and coverage is out of the weeks that existed, not a fixed four
    const avail = Math.max(1, Math.ceil(weeks));
    const coveredScore = interp(Math.min(avail, covered) / avail, [0, 0.25, 0.5, 0.75, 1], [0, 25, 52, 78, 100]);
    /* Coverage-led rather than gap-led. Coverage (how many of the window's four
       weeks had a session) is the CHRONIC signal — it moves slowly and cannot be
       reset by one bad week. The longest-gap term is the acute one. Weighting
       coverage up gives regular-but-infrequent training its due and takes a
       sharper view of cramming, without making a single missed week expensive. */
    const continuity = clamp(0.35 * gapScore + 0.65 * coveredScore);
    // frequency leads, continuity carries real weight but not control
    const score = clamp(0.70 * frequency + 0.30 * continuity);
    return { score, sessions, expected, rate, frequency, continuity, longestGap,
             weeksCovered: covered, streakDays: st.days, streakWeeks: st.weeks };
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
    /* Step by calendar month with the day CLAMPED to 28. setMonth alone rolls
       over: 31 March minus one month is 3 March, so on the 29th-31st the year
       chart's months drifted, overlapped and repeated. */
    const anchorDay = Math.min(anchor.getDate(), 28);
    // a month before the first logged session is not a zero month, it is not a
    // month — plotting eleven of them drew a flat line then a spike
    const firstDate = (state.workouts || []).map((w) => w.date).filter(Boolean).sort()[0] || null;
    for (let i = months - 1; i >= 0; i--) {
      const end = new Date(anchor.getFullYear(), anchor.getMonth() - i, anchorDay, 12, 0, 0, 0);
      if (firstDate && dstr(end) < firstDate) continue;
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
    /* x is DAYS, not milliseconds. Fitting against epoch ms made the slope
       ~1e-8 per unit, so ratePerWeek was always ~0 and every target fell through
       to "over a year at your current rate" — the ETA has never once produced a
       date for any exercise, because the two axes were never comparable. */
    const raw = seriesFor(state, exId)
      .map((p) => ({ t: new Date(p.date + "T12:00:00").getTime(), v: mode === "weight_reps" ? p.est1RM : p.top }))
      .filter((p) => p.v > 0).sort((a, b2) => a.t - b2.t);
    const t0 = raw.length ? raw[0].t : 0;
    const pts = raw.map((p) => ({ t: (p.t - t0) / DAY, v: p.v }));
    let eta = null, ratePerWeek = null, basis = "not enough sessions";
    if (pts.length >= 4) {
      const spanDays = pts[pts.length - 1].t - pts[0].t;   // already in days
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

  /* ---------- history filtering ---------- */
  /* One pure selector shared by the History screen and the bulk notes export, so
     what a filter shows is exactly what gets exported. `q` matches an exercise
     name (case-insensitive substring); `from`/`to` are inclusive YYYY-MM-DD
     bounds. Empty values mean "no bound". Returns newest-first, matching how the
     history list reads; callers that want chronological order sort themselves. */
  function filterSessions(state, opts = {}) {
    const q = String(opts.q == null ? "" : opts.q).trim().toLowerCase();
    const from = opts.from || "";
    const to = opts.to || "";
    return (state.workouts || [])
      .filter((w) => {
        if (!w || !w.date) return false;
        if (from && w.date < from) return false;
        if (to && w.date > to) return false;
        if (q && !(w.entries || []).some((en) => String(en.name || "").toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }

  /* ---------- the user's own notes-app shorthand ---------- */
  /* Exactly the format he started with, so an export can be pasted straight back
     into his notes:

       Bench press machine:
       1:100x10
       2:100x10

     RPE and rest are appended only when they were actually logged — dropping
     them would lose real entries, inventing them would be worse.

     ONE encoder: noteShorthandBlock turns a single session into its block, and
     BOTH the per-session export and the bulk export below go through it, so the
     two can never drift in how a set is written. */
  function noteShorthandBlock(state, w) {
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
        /* The set type rides in front of the set, and only when it is set: a
           straight set stays byte-for-byte what he wrote. parseSet reads the same
           word back, so the notes round-trip is lossless. */
        const tyTok = s.ty === "warmup" ? "warmup " : s.ty === "drop" ? "drop " : s.ty === "failure" ? "failure " : "";
        let body;
        if (mode === "time") body = `${r2(num(s.t) || num(s.r))}s`;
        else if (mode === "weight_time") body = `${r2(s.w)}x${r2(s.t)}s`;
        else if (mode === "distance_time") body = `${r2(num(s.d) / 1000)}km ${num(s.t) ? Math.floor(num(s.t) / 60) + ":" + String(Math.round(num(s.t) % 60)).padStart(2, "0") : ""}`.trim();
        else if (mode === "weight_distance") body = `${r2(s.w)}x${r2(s.d)}m`;
        else if (mode === "reps") body = String(r2(s.r));
        else body = `${r2(s.w)}x${r2(s.r)}`;
        lines.push(`${i + 1}:${tyTok}${body}${tail}`);
      });
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  function exportNoteShorthand(state, workoutId) {
    return noteShorthandBlock(state, (state.workouts || []).find((x) => x.id === workoutId));
  }

  /* Bulk: lift the WHOLE log (or a chosen window) back into a notes app in one
     go. Selection is the SAME filter the History screen uses, and the set lines
     come from the SAME encoder — this is a wrapper, not a second exporter, so a
     change to the format can never make the two disagree. Sessions are written
     oldest-first with a date header per session; the header carries no colon and
     starts with "#", so the notes importer (which keys exercises off "name:")
     reads it as neither an exercise nor a set. */
  function exportNotesShorthand(state, opts = {}) {
    const list = filterSessions(state, opts)
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return list
      .map((w) => "## " + w.date + "\n" + noteShorthandBlock(state, w))
      .filter((s) => s.trim())
      .join("\n\n")
      .trim();
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

  /* ---------- body measurements ---------- */
  /* Tape measures, stored on the SAME bodyweight check-in as weight and body fat
     (one entry per date, one field per measurement), canonical in centimetres
     exactly as weight is canonical in kilograms. Only the three that a lifter
     actually acts on are collected, and each is shown back as a trend — nothing
     here is entered to sit unread. */
  const MEASURES = [
    { key: "waistCm", label: "Waist", color: "#f8d030" },
    { key: "chestCm", label: "Chest", color: "#58c8f8" },
    { key: "armCm",   label: "Arm",   color: "#a878f8" },
  ];
  const bodyMeasureSeries = (state, key) => (state.bodylog || [])
    .filter((b) => num(b[key]) > 0)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((b) => ({ date: b.date, value: num(b[key]) }));
  const bodyMeasureLatest = (state, key) => {
    const s = bodyMeasureSeries(state, key);
    return s.length ? s[s.length - 1] : null;
  };

  /* ---------- consistency calendar ---------- */
  /* A per-day map of the last N days: everything the year grid needs, computed
     from logged sessions only. */
  function dayMap(state, days = 371) {
    const out = {};
    const anchor = new Date(); anchor.setHours(12, 0, 0, 0);
    /* Start at the first logged workout. The grid used to draw a full year, so a
       new account showed 369 empty squares and read as deeply inconsistent to
       someone who had trained every single day since installing it. Days before
       the account existed are not rest days — they are not days. */
    const first = (state.workouts || []).map((w) => w.date).filter(Boolean).sort()[0] || null;
    /* No sessions at all: the account is empty, not a year of missed days. Return
       an empty map so the grid shows an empty state instead of 371 blank cells.
       Only a real first workout anchors the span. */
    if (!first) return out;
    const span = Math.min(days, Math.max(1, daysBetween(first, dstr(anchor)) + 1));
    for (let i = 0; i < span; i++) {
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
  /* ---------- per-exercise stimulus weight ----------
     A set is not a set. A machine chest press drives chest AND triceps AND front
     delts through a long arc; a pec deck does one joint and nothing else. A
     weighted incline crunch moves the torso against gravity through a longer
     range than a flat crunch. Counting them identically is exactly why a balance
     chart built on raw set counts reads wrong.

     Derived from each exercise's OWN attributes — how many muscles it recruits,
     its equipment, and its range/leverage modifiers — so it covers all ~930
     library movements and any custom exercise with nothing to maintain by hand.

     These are transparent, adjustable WEIGHTS, not measurements. They never
     touch a logged weight, an e1RM or a PR: those stay raw so they stay
     comparable between sessions and between exercises. Override per exercise
     with an explicit weight. */
  const EQ_W = [
    [/barbell|olympic|trap bar/i, 1.00],
    [/dumbbell/i, 0.97],
    [/kettlebell/i, 0.93],
    [/bodyweight|pull-?up|chin-?up|\bdip\b|push-?up|plank/i, 0.90],
    [/cable|pulley|lat pull/i, 0.88],
    [/machine|smith|sled|hack|stack|pec deck|\bdeck\b/i, 0.84],
    [/band|resistance/i, 0.75],
  ];
  const ROM_W = [/incline/i, /decline/i, /deficit/i, /full[- ]?range|\brom\b/i,
                 /wide|stretch|extended/i, /single[- ]?arm|single[- ]?leg|unilateral/i];
  /* Compound or isolation, which is the single biggest driver of what a set is
     worth. Read from the NAME first: the library's own muscle arrays are
     inconsistent — "Leg Press on Hackenschmidt Machine" lists one group and no
     synergists, so a pure array test files the biggest compound in the gym as an
     isolation. The arrays are the fallback, not the source. */
  const ISO_RE = /curl|extension|fly|raise|pushdown|kickback|crunch|plank|shrug|pull-?over|abduction|adduction|calf|pec deck|\bdeck\b|kickback/i;
  const COMPOUND_RE = /squat|deadlift|press|row|pull-?up|chin-?up|\bdip\b|lunge|clean|snatch|thruster|push-?up|pulldown|step-?up|hip thrust|good morning|swing|carry/i;
  function isIsolation(state, id) {
    const n = exInfo(state, id).n;
    if (ISO_RE.test(n)) return true;
    if (COMPOUND_RE.test(n)) return false;
    const info = exInfo(state, id);
    return exGroups(state, id).length <= 1 && (info.s || []).length === 0;
  }

  /* Work per rep relative to the movement's own flat/standard variant, derived
     from the SAME trunk-sweep integral as the bodyweight factors above: at trunk
     angle phi from horizontal, one rep's work ∝ (sin(phi_top) - sin(phi_rest)).
     A head-below 40-degree bench sweeps -40 -> +35 deg (75 deg) against a flat
     crunch's 0 -> +35 deg (35 deg), so the same set is 2.12x the work; a
     head-above 40-degree bench sweeps +40 -> +75 deg, i.e. 0.56x the flat sweep.
     The effort weight has to be able to SAY that — the +/-15% range cap could
     not, which is why an incline crunch scored barely above a flat one while
     being more than twice the work. Applied after the clamp, because the clamp
     is for attribute-derived nudges, not geometry. */
  const WORK_FACTOR = [
    [/incline crunch|decline crunch|decline sit.?up/i, 2.12],
    [/incline sit.?up|head.?above|head.?elevated/i, 0.56],
  ];
  const workFactor = (name) => {
    const n = String(name || "");
    for (const [re, f] of WORK_FACTOR) if (re.test(n)) return f;
    return 1;
  };

  function exerciseWeight(state, id) {
    const info = exInfo(state, id);
    const o = (state.overrides && state.overrides[id]) || {};
    if (o.weight != null && isFinite(num(o.weight)) && num(o.weight) > 0) return num(o.weight);
    // recruitment: an isolation set drives one joint and nothing else, so it is
    // worth less than a compound set; more muscles driven is worth more
    const groups = exGroups(state, id).length;
    const sec = (info.s || []).length;
    let w = (isIsolation(state, id) ? 0.85 : 1)
      + Math.min(0.24, 0.08 * Math.max(0, groups - 1) + 0.06 * Math.min(3, sec));
    // stability: free weights demand it, a stack does not
    const eqs = (info.e || []).map((x) => String(x).toLowerCase());
    for (const [re, v] of EQ_W) if (eqs.some((x) => re.test(x)) || re.test(info.n)) { w *= v; break; }
    // range and leverage, counted once each
    const hay = info.n + " " + eqs.join(" ");
    let rom = 0;
    for (const re of ROM_W) if (re.test(hay)) rom++;
    w *= 1 + Math.min(0.15, rom * 0.05);
    return Math.round(Math.max(0.6, Math.min(1.35, w)) * workFactor(info.n) * 100) / 100;
  }

  function muscleGroups(state, days = 28) {
    const ws = windowWorkouts(state, days, 0);
    const weeks = activeWeeks(state, days);
    const sets = {}, eff = {}, vol = {}, lastTrained = {};
    for (const g of GROUP_ORDER) { sets[g] = 0; eff[g] = 0; vol[g] = 0; lastTrained[g] = null; }
    for (const w of ws) for (const en of w.entries || []) {
      const st = entryStats(en);
      if (!st.sets) continue;
      const gs = exGroups(state, en.id).filter((g) => GROUP_ORDER.includes(g));
      if (!gs.length) continue;
      // primary group takes full credit, others share it; how much a set is WORTH
      // comes from the exercise itself (see exerciseWeight)
      const wgt = exerciseWeight(state, en.id);
      gs.forEach((g, i) => {
        const share = i === 0 ? 1 : 0.5;
        sets[g] += st.sets * share;             // raw working sets — comparable to MEV/MAV/MRV
        eff[g] += st.effSets * share * wgt;     // stimulus — what the score uses
        vol[g] += st.volume * share;
        const d = w.date; if (!lastTrained[g] || d > lastTrained[g]) lastTrained[g] = d;
      });
    }
    const out = {};
    for (const g of GROUP_ORDER) {
      const L = LANDMARKS[g];
      const perWk = sets[g] / weeks;          // raw sets, vs the published landmarks
      const effPerWk = eff[g] / weeks;        // stimulus-equivalent sets, for the score
      // 100 = at or above the adaptive sweet spot; below that, linear to MEV.
      /* 0 -> 55 up to MEV, 55 -> 95 across MEV..MAV, then a small top-up to 100
         at MRV, and it FALLS past MRV. It used to keep climbing, so 24 sets/wk
         (flagged "over MRV") scored 100 while 18 sets/wk ("optimal") scored 98 —
         the number and the flag disagreed about which week was better. */
      let score = effPerWk <= 0 ? 0
        : effPerWk < L.mev ? (effPerWk / L.mev) * 55
        : effPerWk < L.mav ? 55 + ((effPerWk - L.mev) / (L.mav - L.mev)) * 40
        : effPerWk <= L.mrv ? 95 + ((effPerWk - L.mav) / Math.max(1, L.mrv - L.mav)) * 5
        : Math.max(40, 100 - (effPerWk - L.mrv) * 3);
      score = clamp(Math.round(score));
      /* Judged on the SAME stimulus-weighted value the score uses. Reading raw
         sets here while the score read weighted ones let the flag and the number
         disagree — a group could be "optimal" and score like it was under MEV. */
      const status = effPerWk <= 0 ? "untrained" : effPerWk < L.mev ? "below MEV"
        : effPerWk <= L.mrv ? (effPerWk < L.mav ? "MEV→MAV" : "optimal") : "over MRV";
      out[g] = { group: g, score,
                 setsPerWk: Math.round(perWk * 10) / 10,
                 effPerWk: Math.round(effPerWk * 10) / 10,
                 totalSets: Math.round(sets[g] * 10) / 10,
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
    /* Groups below their MEV are lagging by the same bands the card prints next to
       them. Without this, Core showed "below MEV" in the status list while the
       weak-point list ignored it — two halves of one card disagreeing about the
       same group because one used a score threshold and the other a volume band. */
    const lag = GROUP_ORDER.filter((g) => mg[g].setsPerWk > 0
      && (mg[g].score < Math.max(45, mean * 0.7) || mg[g].status === "below MEV"))
      .sort((a, b) => mg[a].score - mg[b].score);
    for (const g of lag.slice(0, 3)) {
      const need = Math.max(0, Math.ceil(mg[g].landmarks.mev - mg[g].setsPerWk));
      out.push({ kind: "volume", severity: mg[g].score < 40 ? "high" : "med", group: g,
        title: `${g} is under-trained`, detail: `${mg[g].setsPerWk} sets/wk vs a ${mg[g].landmarks.mev}–${mg[g].landmarks.mav} target.`,
        fix: need > 0
          ? `Add about ${need} ${need === 1 ? "set" : "sets"}/week of ${g.toLowerCase()} work.`
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
      // windowed like every other check — this read the entire history, so the
      // quads/hamstrings numbers were all-time while the muscle card beside them
      // was 28 days, and the two drifted apart the longer he trained.
      const hs = ws.flatMap((w) => w.entries || []);
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

  /* One PR per exercise per session, whatever moved. reps, volume and tonnage all
     rise together when you add a set, so counting hits made a single extra set
     fire three "PRs" and inflated the HUD count and its XP bonus. The individual
     hits stay on the record for display; the COUNT is the achievement. */
  function prCount(state, days = 28) {
    const b = new Date(); b.setHours(12, 0, 0, 0); b.setDate(b.getDate() - days);
    const from = dstr(b);
    let n = 0;
    for (const r of prTable(state)) for (const p of r.prs) if (p.date >= from && p.hit.length) n += 1;
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
    /* Longest run ever. XP is recomputed from state on every render, so paying
       XP for the CURRENT streak made it fall the moment a streak broke: identical
       training scored 60 XP less ten days later and a level could go DOWN. Paying
       for the best run instead only ever moves one way. */
    let bestDays = 0, runD = 0;
    for (let i = 0; i < dates.length; i++) {
      runD = i > 0 && daysBetween(dates[i - 1], dates[i]) === 1 ? runD + 1 : 1;
      if (runD > bestDays) bestDays = runD;
    }
    const wks = [...wset].sort();
    let bestWeeks = 0, runW = 0;
    for (let i = 0; i < wks.length; i++) {
      runW = i > 0 && daysBetween(wks[i - 1], wks[i]) === 7 ? runW + 1 : 1;
      if (runW > bestWeeks) bestWeeks = runW;
    }
    return { days, weeks, bestDays, bestWeeks, lastDate: dates[dates.length - 1], daysSince };
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
    total += st.bestDays * 15 + st.bestWeeks * 50;   // best ever, never current
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
    // same rule as strengthScore: a ratio needs a real weight, or the badge fires
    // on a number the user never gave
    const bw = bodyweight(state);
    const lifts = bestLifts(state, ws);
    const ratio = { bench: 0, squat: 0, dead: 0, ohp: 0, row: 0 };
    if (bw > 0) for (const k of Object.keys(lifts)) if (k in ratio) ratio[k] = lifts[k] / bw;
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
    SET_TYPES, setType, setTypeLabel, isWarmupSet, setEffort,
    exInfo, exName, exMode, exGroups, bodyweight, bestFor, seriesFor, compareLast,
    attributes, muscleGroups, weakPoints, prTable, prCount, streaks, xp, levelInfo,
    title, achievements, newAchievements, achievementContext, summary, windowWorkouts,
    strengthScore, staminaScore, powerScore, mobilityScore, consistencyScore,
    trainedExerciseIds, bestLifts, liftScore, FIXES, suggestFor, dstr,
    nextTarget, kgStep, exerciseWeight, isIsolation, isMobility, bwFactor, isBodyweight, activeWeeks, backfillBodyweight, workFactor,
    BW_FACTOR, BW_NAME, SUPPLIES_LOAD, hasBwFactor,
    attributeHistory, volumeWeeks, deloadCheck, targetProgress,
    exportNoteShorthand, exportNotesShorthand, filterSessions, dayMap, freshness, bodyFatProgress, belowEssentialBF, ESSENTIAL_BF,
    MEASURES, bodyMeasureSeries, bodyMeasureLatest,
  };
})();
if (typeof module !== "undefined") module.exports = Engine;
