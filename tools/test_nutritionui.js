/* Nutrition UI view-model suite — the Change A/B pure logic added to
   js/nutrition.js: the day's no-bar macro card, the weekly adherence measure,
   and the History tab's Nutrition view (loggedDays / nutritionHistory). Runs the
   REAL module in a vm sandbox — these paths need no Macros, Food or Store, so the
   module is loaded alone.
   Run: node tools/test_nutritionui.js */
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.resolve(__dirname, "..");
process.env.TZ = process.env.TZ || "America/New_York";

const ctx = { console, module: { exports: {} }, JSON, Math, Object, Array, Number, String,
  Boolean, isFinite, parseFloat, parseInt, Date, RegExp, Map, Set };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "js/nutrition.js"), "utf8") +
  "\n;globalThis.__N = Nutrition;", ctx, { filename: "nutrition.js" });
const N = ctx.__N;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); }
};
const eq = (name, a, b) => ok(name, a === b, { got: a, want: b });

console.log("surface:", Object.keys(N).join(", "));

const TARGETS = [
  { key: "kcal", label: "Calories", value: 2000, unit: "kcal" },
  { key: "protein", label: "Protein", value: 150, unit: "g" },
  { key: "fat", label: "Fat", value: 60, unit: "g" },
  { key: "carbs", label: "Carbs", value: 240, unit: "g" },
];
const TOTALS = { kcal: 1560, protein: 96, fat: 52, carb: 180 };

/* ---------- the day's macro card: the no-bar replacement for the gauge strip ---------- */
{
  const vm = N.macroCard(TOTALS, TARGETS, { goal: "gain", count: 3 });
  eq("macroCard: one row per target", vm.rows.length, 4);
  ok("macroCard: hasTargets true when targets exist", vm.hasTargets === true);
  eq("macroCard: the calories row reads the log total", vm.rows[0].logged, 1560);
  eq("macroCard: the protein row reads the log total", vm.rows[1].logged, 96);
  eq("macroCard: the fat row reads the log total", vm.rows[2].logged, 52);
  /* the tab's "carbs" target reads the log's "carb" key */
  eq("macroCard: the carbs row reads the log's carb total", vm.rows[3].logged, 180);
  eq("macroCard: the carbs row keeps its target (logged / target line)", vm.rows[3].target, 240);
  eq("macroCard: goal is passed through", vm.rows[0].goal, "gain");
  eq("macroCard: row text is intakeSummary's own wording",
    vm.rows[0].text, N.intakeSummary(TARGETS, TOTALS, "gain")[0].text);
  /* THE POINT OF THE CHANGE: no gauge, so a row carries no fill percentage */
  ok("macroCard: a row carries NO gauge percentage (no bar anywhere)",
    vm.rows.every((r) => r.pct === undefined));
  /* the day's headline moved up with the macros, so the Today card need not repeat it */
  eq("macroCard: the day's headline rides along",
    vm.headline, N.intakeHeadline(N.intakeSummary(TARGETS, TOTALS, "gain"), 3, "gain"));

  /* at or above every target: stated neutrally, never a failure */
  const over = N.macroCard({ kcal: 3000, protein: 140, fat: 70, carb: 300 }, TARGETS, { goal: "lose", count: 4 });
  ok("macroCard: nothing reads as failure (no over/exceeded/too much/fail)",
    over.rows.every((r) => !/over|exceed|too much|fail|warning|missed/i.test(r.text)));

  /* a zero target cannot divide: the gauge that used to divide it is gone, and the
     row is still well-formed (a finite logged value, the real 0 target, real text) */
  const z = N.macroCard({ kcal: 100 }, [{ key: "kcal", label: "Calories", value: 0, unit: "kcal" }], { count: 1 });
  ok("macroCard: a zero target still yields a well-formed row (no divide, no NaN)",
    z.rows[0].target === 0 && isFinite(z.rows[0].logged) && /100/.test(z.rows[0].text));

  /* no targets at all (no birth year): no rows, no numbers */
  const none = N.macroCard({}, null, { goal: "maintain", count: 0 });
  eq("macroCard: no targets -> no rows", none.rows.length, 0);
  ok("macroCard: no targets -> hasTargets false", none.hasTargets === false);
  eq("macroCard: no targets -> the day's headline is still there",
    none.headline, N.intakeHeadline([], 0, "maintain"));
}

/* ---------- nutrition no longer feeds Vitality: the strip is gone ---------- */
{
  eq("Nutrition no longer exposes a vitalityPart helper", typeof N.vitalityPart, "undefined");
  ok("the exported surface carries no vitality-named member",
    !/vitality/i.test(Object.keys(N).join(",")));
  const mc = N.macroCard(TOTALS, TARGETS, { goal: "gain", count: 3 });
  eq("macroCard carries NO vitality field", mc.vitality, undefined);
  ok("macroCard has no 'vitality' key at all", !Object.prototype.hasOwnProperty.call(mc, "vitality"));
  ok("the macroCard view-model never names Vitality", !/vitality/i.test(JSON.stringify(mc)));
  eq("macroCard still carries its goal (unchanged)", mc.goal, "gain");
  eq("macroCard still carries one row per target (unchanged)", mc.rows.length, 4);
  ok("macroCard still carries the day's headline (unchanged)",
    typeof mc.headline === "string" && mc.headline.length > 0);
  const none = N.macroCard({}, null, {});
  eq("no-targets macroCard carries NO vitality field either", none.vitality, undefined);
  ok("no-targets macroCard still has its headline (unchanged)",
    typeof none.headline === "string" && none.headline.length > 0);
  const legacy = N.macroCard(TOTALS, TARGETS, { vitality: { w: 0.3, v: 77, days: 8 }, vitalityOptOut: true });
  eq("a legacy {vitality} opt is ignored, not surfaced", legacy.vitality, undefined);
  ok("...and adds no Vitality text anywhere in the model", !/vitality/i.test(JSON.stringify(legacy)));
}

/* ---------- the weekly adherence measure (Change A) ---------- */
{
  const met = N.adherence({ weeklyTarget: 4, sessionsThisWeek: 5, weeksAtTarget: 12, loggedDaysThisWeek: 6 });
  eq("adherence: target met -> pct capped at 100", met.pct, 100);
  ok("adherence: met wording leads with the good news",
    met.text.indexOf("Target met this week") === 0, met.text);
  ok("adherence: met text states sessions, weeks and logged days",
    /5 of 4 sessions logged this week/.test(met.text) && /12 weeks on target/.test(met.text) &&
    /food logged on 6 days/.test(met.text), met.text);

  const under = N.adherence({ weeklyTarget: 4, sessionsThisWeek: 2, weeksAtTarget: 3 });
  eq("adherence: 2 of 4 -> pct 50", under.pct, 50);
  eq("adherence: text is neutral when under",
    under.text, "2 of 4 sessions logged this week \u00b7 3 weeks on target so far.");
  eq("adherence: logged-day clause omitted when not supplied", under.loggedDaysThisWeek, null);

  eq("adherence: one week is singular",
    N.adherence({ weeklyTarget: 4, sessionsThisWeek: 1, weeksAtTarget: 1 }).text,
    "1 of 4 sessions logged this week \u00b7 1 week on target so far.");

  const dflt = N.adherence({});
  eq("adherence: default weekly target is 4", dflt.target, 4);
  eq("adherence: no sessions -> pct 0", dflt.pct, 0);

  /* the hard tone rule: never consecutive days, never a scold */
  ["", ].forEach(() => {});
  ok("adherence: never counts consecutive days and never scolds",
    !/consecutive|streak|missed|failed|behind|warning/i.test(met.text + under.text));
}

/* ---------- the History tab's Nutrition view (Change B) ---------- */
const LOG = [
  { date: "2026-11-09", name: "Oats", macros: { kcal: 380, protein: 13, fat: 7, carb: 67 } },
  { date: "2026-11-09", name: "Milk", macros: { kcal: 120, protein: 8, fat: 5, carb: 12 } },
  { date: "2026-11-08", name: "Egg", macros: { kcal: 70, protein: 6, fat: 5, carb: 1 } },
  { name: "no date", macros: { kcal: 999 } },
  null,
];
{
  const days = N.loggedDays(LOG, {});
  eq("loggedDays: one row per distinct day", days.length, 2);
  eq("loggedDays: newest first", days[0].date, "2026-11-09");
  eq("loggedDays: entries on the same day collapse to one row", days[0].items, 2);
  eq("loggedDays: a day's totals are summed (kcal)", days[0].totals.kcal, 500);
  eq("loggedDays: a day's totals are summed (protein)", days[0].totals.protein, 21);
  eq("loggedDays: a day's totals are summed (carb)", days[0].totals.carb, 79);
  ok("loggedDays: an absent nutrient stays absent (never 0)", days[0].totals.fibre === undefined);
  eq("loggedDays: undated / null entries are ignored", days[1].items, 1);

  eq("loggedDays: from-filter is inclusive", N.loggedDays(LOG, { from: "2026-11-09" }).length, 1);
  eq("loggedDays: to-filter is inclusive", N.loggedDays(LOG, { to: "2026-11-08" })[0].date, "2026-11-08");
  eq("loggedDays: a range with no days -> []", N.loggedDays(LOG, { from: "2026-11-10" }).length, 0);
  eq("loggedDays: q filters by food name", N.loggedDays(LOG, { q: "oats" })[0].date, "2026-11-09");
  eq("loggedDays: q filter narrows the day's items", N.loggedDays(LOG, { q: "milk" })[0].items, 1);
  eq("loggedDays: no match -> []", N.loggedDays(LOG, { q: "zzz" }).length, 0);
  eq("loggedDays: empty log -> []", N.loggedDays([], {}).length, 0);
}

{
  const hist = N.nutritionHistory(LOG, {}, TARGETS, "gain");
  eq("nutritionHistory: one card per logged day", hist.length, 2);
  eq("nutritionHistory: newest day first", hist[0].date, "2026-11-09");
  eq("nutritionHistory: each day reads against every target", hist[0].rows.length, 4);
  eq("nutritionHistory: rows reuse intakeSummary wording",
    hist[0].rows[0].text, N.intakeSummary(TARGETS, hist[0].totals, "gain")[0].text);
  ok("nutritionHistory: each day carries a headline", typeof hist[0].headline === "string" && hist[0].headline.length > 0);
  ok("nutritionHistory: nothing reads as failure",
    hist.every((d) => !/over|exceed|too much|fail|warning|bad/i.test(d.headline)));

  /* --- the pinned property: a PAST day must not be worded as "today" ---
     nutritionHistory() used to reuse the Today card's intakeHeadline, so the
     2026-11-08 card read "…to land on target TODAY". Pin the fix on BOTH sides:
     history is history-free of "today", while the Today path may still say it. */
  ok("nutritionHistory: NO past-day headline contains \"today\"",
    hist.every((d) => !/\btoday\b/i.test(d.headline)),
    hist.map((d) => d.headline));
  ok("nutritionHistory: the same rows DO say \"today\" on the Today card (unchanged path)",
    /\btoday\b/.test(N.intakeHeadline(N.intakeSummary(TARGETS, hist[0].totals, "gain"),
      hist[0].items, "gain")));
  eq("nutritionHistory: past-day headline is the factual summary",
    hist[0].headline, "500 kcal logged across 2 items.");
  eq("nutritionHistory: a lightly-logged past day is stated as a fact",
    hist[1].headline, "70 kcal logged across 1 item.");

  /* no targets (no birth year): the day is listed with its count, no numbers */
  const bare = N.nutritionHistory(LOG, {}, null, "maintain");
  eq("nutritionHistory: no targets -> no target rows", bare[0].rows.length, 0);
  eq("nutritionHistory: no targets -> item-count headline", bare[0].headline, "Logged 2 items on this day.");
  eq("nutritionHistory: no targets -> still no \"today\"", bare[0].headline.indexOf("today"), -1);
  eq("nutritionHistory: singular item worded once", N.nutritionHistory(LOG, { q: "egg" }, null, "maintain")[0].headline,
    "Logged 1 item on this day.");
}

console.log("\nnutritionui: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
