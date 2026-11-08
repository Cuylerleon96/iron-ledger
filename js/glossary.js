/* glossary.js — the ONE place a term is explained.

   The app is gamified and aimed at someone just starting out, but it shows words
   a beginner cannot be expected to know: MEV/MAV/MRV, e1RM, RPE, tonnage,
   density, freshness, the muscle-balance status words, the six attribute names.
   This file is the single source those explanations live in, so the same term
   reads the same way wherever it is shown. Two rules keep it honest:

     1. Every term the UI displays has an entry here, and no entry exists for a
        term the UI never shows. Each entry's `id` is the `data-term` hook the
        card uses to open it, and tools/test_features.js checks both directions.
     2. Nothing explains the same thing twice in different words: the dashboard's
        "What the numbers mean" block and the per-attribute blurbs read their
        definitions from here (see Glossary.attrPlain / app.js attrExplain).

   Style: plain language first (`plain`), then the actual definition or formula
   underneath (`real`) for anyone who wants the real thing.

   No DOM and no storage here — every function that touches the document takes it
   from the supplied ctx, so this module loads in a bare sandbox for testing. */
const Glossary = (() => {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* One entry per displayed term. `term` is the heading shown; `aliases` are the
     other wordings the UI uses for the same idea, so the scope test can prove
     the entry corresponds to something on screen. */
  const TERMS = [
    {
      id: "xp-multiplier", term: "XP multiplier", aliases: ["XP multiplier", "XP scaler", "multiplier"],
      plain: "A session's XP is not paid flat. What you did earns a base amount, and a small multiplier — shown next to the XP as \u201cx1.5\u201d — rewards the things this app already values: getting stronger, and turning up as often as you planned. Piling on extra sets past what a muscle can recover earns less, not more.",
      real: "Composed from named factors and capped at \u00d72.0: improvement \u00d71.25 when the session sets a PR; consistency \u00d71.10\u20131.25 when the sessions logged in that week meet your weekly target (a SESSION count, never consecutive days); and volume, the negative side, down to \u00d70.5 when the session pushes a muscle group past its own MRV from the landmarks. The session's base is multiplied once — a PR that also raises tonnage is counted once, not once per metric.",
    },
    {
      id: "volume", term: "Volume", aliases: ["volume", "weekly volume", "sets per week"],
      plain: "How much training you did — the work you gave a muscle, counted in sets. More is not automatically better: there is a range that builds muscle and a point past which it only costs you recovery.",
      real: "Volume here is completed working sets per muscle group, per week. A set counts when it is a real, finished set for that movement; the muscle-balance card weights each set by the movement's effort factor before comparing it to your landmarks.",
    },
    {
      id: "tonnage", term: "Tonnage", aliases: ["tonnage", "t lifted"],
      plain: "The total weight you moved — how much actual load passed through your hands. Think of it as the size of the job, not the quality of it.",
      real: "Tonnage = weight × reps, summed over the sets in the window. It is computed once, in the engine, and every display (the dashboard chip, the chart, the session totals) reads that same number. A hold or a carry has no tonnage: there are no reps of load to count.",
    },
    {
      id: "reps", term: "Reps", aliases: ["reps", "reps per week"],
      plain: "The number of times you moved the weight, added up across a week. Reps show the raw amount of movement even when the weight stays the same.",
      real: "Weekly reps = the sum of every logged repetition in the week, across all movements. Reps feed the effort read and the endurance part of Stamina; they are separate from tonnage, which also counts the weight.",
    },
    {
      id: "effort-set", term: "Effort sets (vs raw sets)", aliases: ["effort sets", "raw sets", "working set", "working sets"],
      plain: "A raw set is just a set you did. An effort set is that same set weighted by how demanding the movement is — a heavy squat counts for more than a leg extension. The muscle-balance card shows both so you can see the difference.",
      real: "Each logged set is multiplied by the movement's effort weight (its `g`/effort factor, shown as \"Effort weight\" on the exercise screen, 1.00 = baseline) to give an effort set. Raw sets are the unweighted count. Totals are effort sets per week against the muscle group's MEV / MAV / MRV landmarks.",
    },
    {
      id: "set-type", term: "Set type", aliases: ["Set type", "Warm-up", "Drop set", "Failure set"],
      plain: "What kind of set it was. A warm-up is a ramp, not working work: it is logged and shown, but it is not counted as a working set and adds no tonnage. A drop set or a set taken to failure is harder than a straight set, so it counts for more effort.",
      real: "One field per set (`ty`), one value: warm-up, drop or failure (unset = a straight working set). A warm-up is filtered out of entryStats' working sets and so adds no volume, no tonnage, no reps and no effort. A drop set and a failure set each contribute more than one effort set (×1.25 and ×1.2) to the muscle-group stimulus — the same path the per-exercise effort weight already uses. Raw working-set counts are unchanged.",
    },
    {
      id: "rpe", term: "RPE", aliases: ["RPE", "effort (RPE)"],
      plain: "How hard a set felt, on a scale of 1 to 10. A 10 means you could not have done another rep; a 7 means you had about three left in you. It is how the app knows whether effort is climbing even when the weight is not.",
      real: "RPE is Rate of Perceived Exertion, entered per set (@8 in shorthand). It is compared session to session: effort rising while output stalls is the classic shape of accumulated fatigue, and near-maximal effort with no progress is treated as a recovery problem rather than a call to push harder.",
    },
    {
      id: "e1rm", term: "e1RM / 1RM", aliases: ["e1RM", "1RM", "estimated 1RM"],
      plain: "Your best single rep — the most you could lift once. If you have not actually tested it, the app estimates it from a set you did, so a steady 100×5 becomes a 1RM number you can watch go up.",
      real: "1RM is a true one-rep max. e1RM is the estimate: Epley's formula, weight × (1 + reps ÷ 30), capped at about 12 reps because the estimate stops being accurate past there. Strength and the record tracking both read e1RM on your logged core lifts.",
    },
    {
      id: "mev-mav-mrv", term: "MEV / MAV / MRV", aliases: ["MEV", "MAV", "MRV", "landmarks"],
      plain: "Three landmarks for a muscle, in sets per week. MEV is where a muscle starts to grow, MAV is the sweet spot, MRV is the most it can take before it stops recovering. Every muscle group has its own numbers.",
      real: "MEV = minimum effective volume, MAV = maximum adaptive volume, MRV = maximum recoverable volume. Reference ranges come from Renaissance Periodization's published volume-landmark tables (Israetel et al.), mid-range values. The muscle-balance bars mark MEV; a group is placed against its own MEV→MAV→MRV band.",
    },
    {
      id: "below-mev", term: "below MEV", aliases: ["below MEV", "status-belowMEV"],
      plain: "You are training that muscle less than it needs to grow. It is not a warning — it is the app telling you where the next easy gain is.",
      real: "Effort sets per week for the group are under its MEV. Nothing is lost; the fix is simply more sets for that group.",
    },
    {
      id: "mev-mav", term: "MEV→MAV", aliases: ["MEV→MAV", "MEV-MAV"],
      plain: "You are past the minimum and on the way to the sweet spot. This is productive territory — keep going.",
      real: "Effort sets per week for the group are at or above its MEV and below its MAV. Growth is expected here.",
    },
    {
      id: "optimal", term: "optimal", aliases: ["optimal", "status-optimal"],
      plain: "That muscle is being trained right in the band where it grows best — neither starved nor overworked.",
      real: "Effort sets per week for the group are at or above its MAV and at or below its MRV.",
    },
    {
      id: "over-mrv", term: "over MRV", aliases: ["over MRV", "status-overMRV"],
      plain: "You are doing more for that muscle than it can recover from. More sets now cost you rather than build you.",
      real: "Effort sets per week for the group exceed its MRV, so the muscle-group score falls rather than rises — the flag and the number agree.",
    },
    {
      id: "untrained", term: "untrained", aliases: ["untrained"],
      plain: "No sets at all for that group in the window. Nothing logged means nothing to judge.",
      real: "Zero completed working sets for the group in the last 28 days.",
    },
    {
      id: "deload", term: "Deload", aliases: ["deload", "lighter week"],
      plain: "A deliberately easier week — roughly half your usual sets at the same weights — to let built-up fatigue clear. You come back stronger for it.",
      real: "Suggested only from logged evidence: average RPE rising over three weeks while weekly sets stayed level. Silence is the default, because a suggestion that fires every other week teaches you to ignore it.",
    },
    {
      id: "plateau", term: "Plateau", aliases: ["plateau", "plateaued", "stagnant"],
      plain: "The number has stopped moving even though you keep training. It is information, not failure — it tells you to change one thing.",
      real: "Flagged when an exercise shows no estimated-1RM improvement across its last four sessions (spread under 3%). The suggested change depends on effort: near-maximal RPE points at recovery, a comfortable RPE points at adding load.",
    },
    {
      id: "density", term: "Density / work time %", aliases: ["work time", "density"],
      plain: "The share of your session you spent actually working rather than resting. Resting less makes the same session harder on your heart and lungs — which is why it counts toward Stamina.",
      real: "Work time % = work seconds ÷ (work seconds + rest seconds), over the logged sets. Work seconds assume about 3 s per rep. It needs rest to be logged to mean anything: with none, the app shows no figure rather than a false 100%. The dashboard chip is all-time; the Stamina readout is the last 28 days.",
    },
    {
      id: "freshness", term: "Freshness", aliases: ["freshness", "Days since each group was last trained"],
      plain: "How long it has been since you last trained each muscle group. It is recency, not a measurement of how recovered you are.",
      real: "Days since the group's most recent logged session. The chip is coloured on a 0-100 freshness read against a recovery window; a group not trained in the last four weeks reads \"no data\".",
    },
    {
      id: "baseline", term: "Baseline", aliases: ["baseline"],
      plain: "Your first real number for an exercise — the thing your later sessions are measured against. The first time you log something there is nothing to compare it to, so it becomes the baseline.",
      real: "The earliest saved session for an exercise with a usable metric. Comparisons (the ▲ / ▼ banner) need at least two sessions; with one, that session is the baseline and no percentage is claimed.",
    },
    {
      id: "pr", term: "PR", aliases: ["PR", "PRs", "records"],
      plain: "A personal record — your best ever on that exercise. The app watches for them and lists them, so progress you would not notice day to day still shows up.",
      real: "A PR is a new best estimated-1RM (or best reps / time / distance, by the movement's mode) for an exercise, dated when it was set. The dashboard counts this month's PRs and all-time PRs separately.",
    },
    {
      id: "next-target", term: "NEXT target", aliases: ["NEXT", "double progression", "next target"],
      plain: "A suggestion for your next session, built from what you did last time. Add a rep first, and once the reps are comfortable, add weight — that pair is called double progression.",
      real: "Double progression: hold the load and push reps to the top of the range, then increase the load and drop back to the bottom. The NEXT line offers concrete options derived from your own last session; if you set an explicit Target, progress and an ETA are shown only when there is a real trend to extrapolate.",
    },
    {
      id: "tiers", term: "Score tiers", aliases: ["Best", "Fantastic", "Pretty good", "Decent", "Not great"],
      plain: "The word under each score is just the number in plain English — a rough band, not a grade. Only the number matters.",
      real: "A 0-100 score maps to a word: 95+ Best, 85+ Fantastic, 72+ Very good, 58+ Pretty good, 44+ Decent, 28+ Not great, 12+ Poor, else No good.",
    },
    /* ---- the six attributes: the basis behind each name ---- */
    {
      id: "attr-STR", term: "Strength", aliases: ["Strength", "STR"],
      plain: "How much you can lift for your bodyweight. A heavier person lifting the same weight is not stronger, so the number is a ratio, not a total.",
      real: "Best estimated 1RM on your core lifts (bench, squat, deadlift, press, row, clean, snatch, and their variants) divided by bodyweight, read against published bodyweight strength standards. With no bodyweight, or no free-weight core lift yet, it stays unscored or is estimated conservatively from machine work and marked as such.",
    },
    {
      id: "attr-END", term: "Stamina", aliases: ["Stamina", "END", "work capacity"],
      plain: "Your engine — cardio and how long you can keep working. Runs, rides and long sets all feed it, and resting less between sets raises the demand it sees.",
      real: "A weighted blend of cardio minutes per week against the 150 min/week guidance, distance per week scored against the logged modality's own range (running and cycling are not the same scale), best single-set reps, strength sets per week, and the training density figure. Short rest lowers the density score, which is why it moves Stamina only.",
    },
    {
      id: "attr-POW", term: "Power", aliases: ["Power", "POW", "explosiveness"],
      plain: "Explosive strength — how fast you can put force out. Jumps, throws and heavy low-rep sets build it.",
      real: "Olympic-lift score (clean/snatch 1RM vs bodyweight standards, when logged), explosive reps logged (jumps, plyos, throws, swings), and heavy low-rep sets (3 reps or fewer at a real load), averaged together.",
    },
    {
      id: "attr-MOB", term: "Mobility", aliases: ["Mobility", "MOB", "range"],
      plain: "The range of movement you can produce and control — stretching, joint work, and stability at end-range. Loaded short-range work like crunches deliberately does not count.",
      real: "Minutes per week of recognised mobility and control work (stretching, foam rolling, joint rotations, and stability/anti-rotation holds such as plank, bird dog, Pallof press, Turkish get-up), scored against a weekly reference range. Loaded flexion under a short range trains strength, not range.",
    },
    {
      id: "attr-CON", term: "Discipline", aliases: ["Discipline", "CON", "consistency"],
      plain: "How often you turn up — and, separately, how regularly. Missing one week dents it; it does not wipe it out.",
      real: "70% frequency (sessions in the last 28 days against your weekly target) plus 30% continuity. Continuity is two smooth signals — the longest stretch without a session, and how many of the window's weeks had at least one — so a single hard week is a dent rather than a collapse.",
    },
    {
      id: "attr-VIT", term: "Vitality", aliases: ["Vitality", "VIT", "body comp"],
      plain: "Your body composition, read from the weigh-ins and body-fat check-ins you log — how you are trending toward the goals you set.",
      real: "A weighted blend of weight trend (or weight vs goal), body-fat trend (or body fat vs goal, or the healthy band with no goal), and BMI. No measurements means no score; a BMI-only score is capped.",
    },
  ];

  const INDEX = TERMS.reduce((m, t) => { m[t.id] = t; return m; }, {});
  const get = (id) => INDEX[id] || null;
  const has = (id) => !!INDEX[id];
  const list = () => TERMS.slice();

  /* Map an engine muscle-balance status word onto its entry id. */
  const STATUS_ID = {
    "below MEV": "below-mev", "MEV→MAV": "mev-mav", "MEV->MAV": "mev-mav",
    "optimal": "optimal", "over MRV": "over-mrv", "untrained": "untrained",
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

  /* One entry's body: plain first, the real thing underneath. */
  function entryHTML(e) {
    return `<h3>${esc(e.term)}</h3>`
      + `<p class="gloss-plain">${esc(e.plain)}</p>`
      + `<p class="gloss-real"><span class="gloss-lab">In full</span> ${esc(e.real)}</p>`;
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
    box.innerHTML = `<p class="muted small">Every word the app uses, in plain English. Tap one to read it, or open it from the term itself on any card.</p>`
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
