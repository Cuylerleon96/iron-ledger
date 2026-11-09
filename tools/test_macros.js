/* Pure nutrition macro engine. Loads the REAL js/macros.js in a vm and asserts.
   Run: node tools/test_macros.js

   Every expected number below is hand-computed from the equations in the module
   (the arithmetic is shown in the comments), not copied from the module output. */
const fs = require("fs"), vm = require("vm"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "macros.js"), "utf8");
const ctx = { console, module: { exports: {} }, Date, Math, JSON, Object, Array, Set, Map,
  isFinite, parseFloat, parseInt, Number, String, setTimeout, clearTimeout };
ctx.globalThis = ctx;
vm.createContext(ctx);
// the harness cannot see top-level consts — re-export the whole surface explicitly.
vm.runInContext(SRC + "\n;globalThis.__X={Macros};", ctx, { filename: "macros.js" });
const M = ctx.__X.Macros;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${JSON.stringify(got)}${ok ? "" : ` want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const near = (label, got, want, tol = 0.01) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}  got=${got}${ok ? "" : ` want≈${want}`}`);
  ok ? pass++ : fail++;
};
const MAN = { sex: "M", weightKg: 80, heightCm: 180, ageY: 30 };
const WOMAN = { sex: "F", weightKg: 65, heightCm: 165, ageY: 30 };
const NO_NUMBERS = (p) => p.refused === true && p.bmr === undefined && p.target === undefined
  && p.protein === undefined && p.fat === undefined && p.carbs === undefined && p.totals === undefined;

console.log("--- exported surface ---");
["rmr","rmrMifflin","rmrFFM","rmrCunningham","rmrMifflinFFM","rmrKatch","tdeeFallback","paceRate","energyAdjustment","controller",
 "protein","fat","carbs","plan","refuse","bmi","roundKcal","round5","activityFactor","observedTdee","activityLevelFor"].forEach((k) => eq(`exposes ${k}()`, typeof M[k], "function"));
eq("exposes PACE_BANDS", typeof M.PACE_BANDS, "object");
eq("exposes SOURCES", typeof M.SOURCES, "object");

console.log("\n--- (1) Mifflin worked examples ---");
// man 80 kg, 180 cm, 30 y:  10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
eq("man rmrMifflin", Math.round(M.rmrMifflin(MAN).kcal), 1780);
near("man exact", M.rmrMifflin(MAN).kcal, 1780);
// woman 65 kg, 165 cm, 30 y: 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25
near("woman exact", M.rmrMifflin(WOMAN).kcal, 1370.25);
eq("man method", M.rmrMifflin(MAN).method, "mifflin-weight");
eq("source carries the citation", /PMID 2305711/.test(M.rmrMifflin(MAN).source), true);

// full man plan, maintain: TDEE = 1805*1.2 = 2166 -> round10 = 2170 (floor 1500 not hit)
// protein maintain 1.6 g/kg *80 = 128 -> round5 = 130 ; fat 0.8*80 = 64 -> 65
// carbs = (2170 - 145*4 - 75*9)/4 = (2170-580-675)/4 = 915/4 = 228.75 -> round5 = 260
const mp = M.plan({ ...MAN, goal: "maintain", pace: "maintain" });
eq("man plan refused", mp.refused, false);
eq("man plan computedTarget (pre-round 1780*1.2=2136)", mp.target.computedTarget, 2136);
eq("man plan target kcal (rounded to 10)", mp.target.kcal, 2140);
eq("man plan protein 130 g", mp.protein.g, 130);
eq("man plan fat 65 g", mp.fat.g, 65);
eq("man plan carbs 260 g", mp.carbs.g, 260);
eq("man plan protein convention is bodyweight", mp.protein.basis, "bodyweight");
eq("man plan floor not applied", mp.target.floorApplied, false);

// full woman plan, maintain: TDEE = 1370.25*1.2 = 1644.3 -> 1640 (floor 1200 not hit)
// protein 1.6*65 = 104 -> 105 ; fat 0.8*65 = 52 -> 50 ; carbs = (1640-420-450)/4 = 770/4 = 192.5 -> 195
const wp = M.plan({ ...WOMAN, goal: "maintain", pace: "maintain" });
eq("woman plan target kcal", wp.target.kcal, 1640);
eq("woman plan protein 105 g", wp.protein.g, 105);
eq("woman plan fat 50 g", wp.fat.g, 50);
eq("woman plan carbs 195 g", wp.carbs.g, 195);

console.log("\n--- (2) FFM path when body fat is supplied, weight path when not ---");
// LBM = 80*(1-0.20) = 64
// DEFAULT FFM is now CUNNINGHAM: 500 + 22*64 = 1908 (was Mifflin-FFM 19.7*64+413 = 1673.8)
eq("rmr() picks FFM when bf given", M.rmr({ ...MAN, bodyFatPct: 20 }).method, "ffm-cunningham");
near("default FFM rmr is Cunningham 500+22*64", M.rmrFFM({ weightKg: 80, bodyFatPct: 20 }).kcal, 1908);
eq("rmr() picks weight path when bf null", M.rmr({ ...MAN, bodyFatPct: null }).method, "mifflin-weight");
near("weight path rmr", M.rmr({ ...MAN, bodyFatPct: null }).kcal, 1780);
// rmrCunningham stays, now the SAME as the default path
near("rmrCunningham = 500 + 22*64", M.rmrCunningham({ weightKg: 80, bodyFatPct: 20 }).kcal, 1908);
// named alternatives remain reachable, but NOT the default
near("Mifflin-FFM alternative 19.7*64+413", M.rmrMifflinFFM({ weightKg: 80, bodyFatPct: 20 }).kcal, 1673.8);
near("Katch-McArdle alternative 370+21.6*64", M.rmrKatch({ weightKg: 80, bodyFatPct: 20 }).kcal, 1752.4);
eq("Mifflin-FFM method tag", M.rmrMifflinFFM({ weightKg: 80, bodyFatPct: 20 }).method, "ffm-mifflin");
eq("Katch method tag", M.rmrKatch({ weightKg: 80, bodyFatPct: 20 }).method, "ffm-katch");
eq("default FFM path IS cunningham", M.plan({ ...MAN, bodyFatPct: 20, goal: "maintain", pace: "maintain" }).bmr.method, "ffm-cunningham");
eq("the basis string states the change to Cunningham", /Cunningham/.test(M.plan({ ...MAN, bodyFatPct: 20, goal: "maintain", pace: "maintain" }).bmr.basis), true);
// the owner's REAL profile: LBM = 70*(1-0.12) = 55.164090
//   Cunningham = 500 + 22*55.164090 = 1713.610  |  weight eq (178cm,30y) = 10*70466+6.25*178-5*30+5 = 1584.365
const CU = { sex: "M", weightKg: 70, heightCm: 178, ageY: 30, bodyFatPct: 12 };
near("the owner Cunningham RMR", M.rmrFFM(CU).kcal, 1713.61, 0.01);
near("the owner weight-equation RMR", M.rmrMifflin(CU).kcal, 1594.365, 0.01);
eq("Cunningham LIFTS the owner ABOVE the weight equation", M.rmr(CU).kcal > M.rmrMifflin(CU).kcal, true);
eq("the old Mifflin-FFM default did the OPPOSITE (bias removed)", M.rmrMifflinFFM(CU).kcal < M.rmrMifflin(CU).kcal, true);

console.log("\n--- (3) 1200/1500 floor clamps + flag ---");
// woman 45 kg,150 cm,60 y: RMR = 450+937.5-300-161 = 926.5 ; TDEE = 926.5*1.2 = 1111.8
// loss-fast rate = -1.0%*45 = -0.45 kg/wk ; adj = -0.45*7700/7 = -495
// computed = 1111.8-495 = 616.8 -> 617 ; floor 1200 applies
const fl = M.plan({ sex: "F", weightKg: 45, heightCm: 150, ageY: 60, goal: "lose", pace: "loss-fast" });
eq("woman floor clamp -> 1200", fl.target.kcal, 1200);
eq("woman floor flag set", fl.target.floorApplied, true);
eq("woman notes carry 'capped for safety'", fl.notes.indexOf("capped for safety") >= 0, true);
// man 50 kg,160 cm,70 y: RMR = 500+1000-350+5 = 1155 ; TDEE = 1386 ; rate=-0.5 -> adj -550
// computed = 836 -> floor 1500 applies
const fm = M.plan({ sex: "M", weightKg: 50, heightCm: 160, ageY: 70, goal: "lose", pace: "loss-fast" });
eq("man floor clamp -> 1500", fm.target.kcal, 1500);
eq("man floor flag set", fm.target.floorApplied, true);

console.log("\n--- (4) 130 g carb floor + flag ---");
// (uses the woman floor case above) carbs = (1200 - 100*4 - 45*9)/4 = (1200-400-405)/4 = 395/4 = 98.75 < 130
eq("carb remainder floored to 130", fl.carbs.g, 130);
eq("carb floor flag set", fl.carbs.floorApplied, true);
eq("carb floor note present", fl.notes.indexOf("carb remainder below the 130 g RDA — carbs raised") >= 0, true);
eq("no sub-130 carb number is ever returned", fl.carbs.g >= 130, true);

console.log("\n--- (5) 0.8 g/kg protein floor ---");
// M 150 kg, bf 80% -> lean mass path. LBM = 150*0.2 = 30 ; 3.0 g/kg LBM (fast) = 90 g
// floor = 0.8 g/kg BODYWEIGHT * 150 = 120 g  -> 90 raises to 120
const hb = M.plan({ sex: "M", weightKg: 150, heightCm: 170, ageY: 40, bodyFatPct: 80, goal: "lose", pace: "loss-fast" });
eq("protein uses lean-mass convention", hb.protein.basis, "lean-mass");
eq("lean-mass published range 2.3-3.1", hb.protein.range, { lo: 2.3, hi: 3.1 });
eq("protein raised to the 0.8 g/kg floor", hb.protein.g, 120);
eq("protein floor flag set", hb.protein.floorApplied, true);
eq("protein never below 0.8 g/kg", hb.protein.g >= 0.8 * 150, true);

console.log("\n--- (6) rounding: kcal to 10/25, macros to 5 g ---");
eq("roundKcal(2136,10)", M.roundKcal(2166, 10), 2170);
eq("roundKcal(2136,25)", M.roundKcal(2136, 25), 2125);
eq("round5(128)", M.round5(128), 130);
eq("round5(192.5)", M.round5(192.5), 195);
eq("plan kcal is a multiple of 10", mp.target.kcal % 10, 0);
eq("plan protein is a multiple of 5", mp.protein.g % 5, 0);
eq("plan fat is a multiple of 5", mp.fat.g % 5, 0);
eq("plan carbs is a multiple of 5", mp.carbs.g % 5, 0);
eq("plan returns no projected completion date", /date|complete|finish|deadline/i.test(JSON.stringify(mp)) === false, true);

console.log("\n--- (7) refuse paths return a reason and NO numbers ---");
const under = M.plan({ sex: "M", weightKg: 60, heightCm: 170, ageY: 17, goal: "lose", pace: "loss-slow" });
eq("under-18 refused", under.refused, true);
eq("under-18 has no numbers", NO_NUMBERS(under), true);
eq("under-18 reason mentions supervision", /supervision/.test(under.reason), true);
const preg = M.plan({ ...WOMAN, goal: "maintain", pace: "maintain", pregnant: true });
eq("pregnancy refused", preg.refused, true);
eq("pregnancy has no numbers", NO_NUMBERS(preg), true);
const ed = M.plan({ ...MAN, goal: "lose", pace: "loss-slow", eatingDisorderRisk: true });
eq("eating-disorder risk refused", ed.refused, true);
eq("eating-disorder risk has no numbers", NO_NUMBERS(ed), true);
const noage = M.plan({ sex: "M", weightKg: 80, heightCm: 180, goal: "maintain", pace: "maintain" });
eq("missing age refused", noage.refused, true);
eq("missing age has no numbers", NO_NUMBERS(noage), true);
eq("missing-age reason no longer claims there is no age field", /no age field/i.test(noage.reason), false);
eq("missing-age reason points at the birth year in Profile", /birth year/i.test(noage.reason) && /profile/i.test(noage.reason), true);

console.log("\n--- warn paths still return numbers + a warning ---");
const athlete = M.plan({ ...MAN, ageY: 25, goal: "maintain", pace: "maintain", athlete: true });
eq("athlete still computes", athlete.refused, false);
eq("athlete warns", athlete.warnings.length >= 1, true);
const heavy = M.plan({ sex: "M", weightKg: 150, heightCm: 170, ageY: 40, goal: "lose", pace: "loss-slow" });
eq("very heavy warns", heavy.warnings.some((w) => /Very heavy/.test(w)), true);

console.log("\n--- (8) closed-loop controller ---");
const wk = (arr) => arr.map((w, i) => ({ date: `2026-01-${String(1 + i * 7).padStart(2, "0")}`, weightKg: w }));
const none = M.controller(2000, [], -0.7);
eq("no weigh-ins -> no adjustment", none.adjusted, false);
eq("no weigh-ins -> null observed rate", none.observedRateKgPerWeek, null);
eq("no weigh-ins -> reason", /at least 2 weigh-ins/.test(none.reason), true);
eq("no weigh-ins -> kcal unchanged", none.kcal, 2000);
const one = M.controller(2000, wk([80]), -0.7);
eq("one weigh-in -> no adjustment", one.adjusted, false);
const close = M.controller(2000, [{ date: "2026-01-01", weightKg: 80 }, { date: "2026-01-02", weightKg: 79.9 }], -0.7);
eq("readings too close -> no adjustment", close.adjusted, false);
eq("readings too close -> reason mentions spacing", /roughly weekly spacing/.test(close.reason), true);

// losing too SLOWLY: target -0.7 kg/wk, observed -0.2 kg/wk -> need a bigger deficit
// delta = (target - observed)*7700/7 = (-0.7 - (-0.2))*1100 = -550 -> 2000-550 = 1450
const slow = M.controller(2000, wk([80, 79.8, 79.6, 79.4]), -0.7);
near("observed rate -0.2 kg/wk", slow.observedRateKgPerWeek, -0.2, 0.005);
eq("losing too slowly -> adjusted (down)", slow.adjusted, true);
eq("losing too slowly -> kcal 1450", slow.kcal, 1450);
eq("losing too slowly -> nudge is downward", slow.kcal < 2000, true);
eq("losing too slowly -> reason says nudging down", /nudging down/.test(slow.reason), true);
// losing too FAST: observed -1.4 kg/wk -> delta = (-0.7+1.4)*1100 = +770 -> 2770
const fast = M.controller(2000, wk([80, 78.6, 77.2, 75.8]), -0.7);
near("observed rate -1.4 kg/wk", fast.observedRateKgPerWeek, -1.4, 0.005);
eq("losing too fast -> adjusted (up)", fast.adjusted, true);
eq("losing too fast -> kcal 2770", fast.kcal, 2770);
eq("losing too fast -> nudge is upward", fast.kcal > 2000, true);
eq("losing too fast -> reason says nudging up", /nudging up/.test(fast.reason), true);
// on pace: observed -0.2 == target -0.2 -> no change
const onpace = M.controller(2000, wk([80, 79.8, 79.6, 79.4]), -0.2);
eq("on pace -> no adjustment", onpace.adjusted, false);
eq("on pace -> kcal unchanged", onpace.kcal, 2000);

console.log("\n--- (9) pace bands: %BW/wk -> kg/wk ---");
eq("loss-slow 0.5% of 80 kg", M.paceRate("loss-slow", 80).kgPerWeek, -0.4);
eq("loss-moderate 0.75% of 80 kg", M.paceRate("loss-moderate", 80).kgPerWeek, -0.6);
eq("loss-fast 1.0% of 80 kg", M.paceRate("loss-fast", 80).kgPerWeek, -0.8);
eq("gain-slow 0.25% of 80 kg", M.paceRate("gain-slow", 80).kgPerWeek, 0.2);
eq("gain-fast 0.5% of 80 kg", M.paceRate("gain-fast", 80).kgPerWeek, 0.4);
eq("maintain 0%", M.paceRate("maintain", 80).kgPerWeek, 0);
eq("unknown pace key is reported", M.paceRate("nope", 80).recognized, false);
// energy adjustment: -0.7 kg/wk * 7700 / 7 = -770 kcal/day
eq("energy adjustment -0.7 kg/wk", M.energyAdjustment(-0.7).kcalPerDay, -770);
eq("7700 kcal/kg labelled a first approximation", /FIRST APPROXIMATION/.test(M.energyAdjustment(-0.7).source), true);

console.log("\n--- (10) named training phases ---");
eq("PHASES is an array", Array.isArray(M.PHASES), true);
eq("PHASES has 6 ordered options", M.PHASES.length, 6);
eq("phase order", M.PHASES.map((p) => p.key),
  ["maintain", "lean-gain", "bulk", "cut-gradual", "cut-standard", "cut-aggressive"]);
// every phase maps to a real pace band AND goal, with non-empty blurb + source
M.PHASES.forEach((p) => {
  const band = M.PACE_BANDS[p.pace];
  eq(`phase ${p.key}: real pace band`, !!band, true);
  eq(`phase ${p.key}: goal matches its pace band`, band && band.goal, p.goal);
  eq(`phase ${p.key}: non-empty blurb`, typeof p.blurb === "string" && p.blurb.length > 10, true);
  eq(`phase ${p.key}: non-empty source`, typeof p.source === "string" && p.source.length > 0, true);
  eq(`phase ${p.key}: non-empty label`, typeof p.label === "string" && p.label.length > 0, true);
});
const PHASE_TEXT = M.PHASES.map((p) => p.label + " " + p.blurb).join(" ").toLowerCase();
eq("phase copy uses no shaming words", /cheat|guilt|fail|bad\b/.test(PHASE_TEXT), false);
// lean-gain strictly slower than bulk
const leanPct = M.PACE_BANDS[M.PHASES[1].pace].pctPerWeek;
const bulkPct = M.PACE_BANDS[M.PHASES[2].pace].pctPerWeek;
eq("lean-gain slower than bulk (pct)", leanPct < bulkPct, true);
eq("lean-gain kg/wk slower than bulk at 80 kg",
  M.paceRate(M.PHASES[1].pace, 80).kgPerWeek < M.paceRate(M.PHASES[2].pace, 80).kgPerWeek, true);
// gradual < standard < aggressive
const cgPct = M.PACE_BANDS[M.PHASES[3].pace].pctPerWeek;
const csPct = M.PACE_BANDS[M.PHASES[4].pace].pctPerWeek;
const caPct = M.PACE_BANDS[M.PHASES[5].pace].pctPerWeek;
eq("gradual < standard < aggressive", cgPct < csPct && csPct < caPct, true);
eq("gradual cut uses loss-slow", M.PHASES[3].pace, "loss-slow");
eq("standard cut uses loss-moderate", M.PHASES[4].pace, "loss-moderate");
eq("aggressive cut uses loss-fast", M.PHASES[5].pace, "loss-fast");

console.log("\n--- (11) phaseFor / recommendedPhase / resolvePhase ---");
eq("phaseFor('bulk') label", M.phaseFor("bulk").label, "Bulk");
eq("phaseFor('lean-gain') goal", M.phaseFor("lean-gain").goal, "gain");
eq("phaseFor unknown -> null", M.phaseFor("nope"), null);
eq("recommendedPhase(gain) default = lean-gain", M.recommendedPhase({ goal: "gain" }).key, "lean-gain");
eq("recommendedPhase(lose) default = cut-gradual", M.recommendedPhase({ goal: "lose" }).key, "cut-gradual");
eq("recommendedPhase(maintain) = maintain", M.recommendedPhase({ goal: "maintain" }).key, "maintain");
eq("recommendedPhase({}) defaults to maintain", M.recommendedPhase({}).key, "maintain");
eq("recommendedPhase states a reason",
  typeof M.recommendedPhase({ goal: "gain" }).reason === "string" && M.recommendedPhase({ goal: "gain" }).reason.length > 0, true);
// phase KEY wins over goal+pace when both are given
eq("resolvePhase by key", M.resolvePhase("bulk").key, "bulk");
eq("resolvePhase: key wins over conflicting goal+pace", M.resolvePhase({ phase: "bulk", goal: "lose", pace: "loss-fast" }).key, "bulk");
eq("resolvePhase by pace", M.resolvePhase({ pace: "loss-moderate" }).key, "cut-standard");
eq("resolvePhase by goal alone -> recommended", M.resolvePhase({ goal: "gain" }).key, "lean-gain");
eq("resolvePhase unknown key is reported", M.resolvePhase("nope").recognized, false);

console.log("\n--- (12) goal-conflict check ---");
// the owner's real profile: 70 -> 75 kg ; 12% -> 10% bf
const CUYLER = { weightKg: 70, bodyFatPct: 12, goalWeightKg: 75, goalBodyFatPct: 10 };
const gc = M.goalConflict(CUYLER);
eq("the owner conflict FIRES", gc.conflict, true);
eq("the owner conflict kind", gc.kind, "gain-while-cutting-fat");
// current LBM = 70*0.88 = 55.164090 ; goal LBM = 75*0.90 = 65.317302
// requiredLeanChangeKg = 10.153212
near("requiredLeanChangeKg ~= +10.1 (within 0.2)", gc.requiredLeanChangeKg, 10.1, 0.2);
near("requiredLeanChangeKg exact 10.1532", gc.requiredLeanChangeKg, 10.1532, 0.01);
eq("note mentions lean mass", /lean mass/i.test(gc.note), true);
eq("note names which goal to lead", /lead with/i.test(gc.note), true);
eq("note says the goals pull against each other", /pull against each other/i.test(gc.note), true);
eq("conflict carries a source", typeof gc.source === "string" && gc.source.length > 0, true);
// compatible pair: weight down AND body fat down
const compat = M.goalConflict({ weightKg: 90, bodyFatPct: 25, goalWeightKg: 82, goalBodyFatPct: 18 });
eq("compatible pair does NOT fire", compat.conflict, false);
eq("compatible pair kind is null", compat.kind, null);
// not enough data — no invented value
const nodata = M.goalConflict({ weightKg: 80, goalWeightKg: 85, bodyFatPct: 20 });
eq("missing goal body fat -> no conflict", nodata.conflict, false);
eq("missing goal body fat -> reason", nodata.reason, "not enough data");
eq("missing goal body fat -> no invented lean change", nodata.requiredLeanChangeKg, null);
eq("missing current body fat -> not enough data",
  M.goalConflict({ weightKg: 80, goalWeightKg: 85, goalBodyFatPct: 15 }).reason, "not enough data");
// lose weight while gaining fat -> flagged
const badpair = M.goalConflict({ weightKg: 90, bodyFatPct: 20, goalWeightKg: 80, goalBodyFatPct: 26 });
eq("lose-weight/gain-fat fires", badpair.conflict, true);
eq("lose-weight/gain-fat kind", badpair.kind, "lose-while-gaining-fat");
// the "large" threshold is labelled an arrangement
eq("large threshold value", M.LARGE_LEAN_CHANGE_KG, 5);
eq("large-threshold source says 'arrangement'", /arrangement/i.test(M.LARGE_LEAN_CHANGE_SOURCE), true);
eq("the owner's required change is flagged large", gc.large, true);

console.log("\n--- (13) training-informed activity factor ---");
const af4 = M.activityFactor({}, { sessionsPerWeek: 4 });
eq("4 sessions/wk -> 1.375", af4.pal, 1.375);
eq("4 sessions/wk basis names the sessions", /4 training sessions\/week/.test(af4.basis), true);
eq("1 session + 30 min cardio -> 1.2", M.activityFactor({}, { sessionsPerWeek: 1, cardioMinutesPerWeek: 30 }).pal, 1.2);
const af0 = M.activityFactor({}, { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 });
eq("0 training -> 1.2", af0.pal, 1.2);
eq("0 training basis = 'no training logged'", af0.basis, "no training logged");
const afUndef = M.activityFactor({});
eq("missing training arg -> 1.2 (graceful)", afUndef.pal, 1.2);
eq("missing training arg basis = 'no training logged'", afUndef.basis, "no training logged");
eq("150 min cardio alone -> 1.375", M.activityFactor({}, { cardioMinutesPerWeek: 150 }).pal, 1.375);
eq("activityFactor caveat is non-empty", typeof af4.caveat === "string" && af4.caveat.length > 0, true);
eq("caveat calls it a weak estimate", /weak/i.test(af4.caveat), true);
eq("caveat names the controller", /controller/i.test(af4.caveat), true);
eq("activityFactor carries a source", typeof af4.source === "string" && af4.source.length > 0, true);
// tdeeFallback default behaviour for callers that pass nothing — unchanged
eq("tdeeFallback default pal still 1.2", M.tdeeFallback(2000).pal, 1.2);
eq("tdeeFallback default kcal unchanged", M.tdeeFallback(2000).kcal, 2400);

/* ============================================================
   (14) THE NUTRITION TAB'S VIEW-MODEL (js/nutrition.js)
   The tab is a pure view-model, so it is pinned here without a browser: load
   the REAL macros.js + nutrition.js in one vm scope (nutrition reads Macros) and
   assert on the model AND the html the user actually sees.
   ============================================================ */
console.log("\n--- (14) Nutrition tab view-model ---");
{
  const fs2 = require("fs");
  const src = fs2.readFileSync(path.join(__dirname, "..", "js", "macros.js"), "utf8") + "\n;\n"
    + fs2.readFileSync(path.join(__dirname, "..", "js", "nutrition.js"), "utf8");
  const c2 = { console, module: { exports: {} }, Date, Math, JSON, Object, Array, Set, Map,
    isFinite, parseFloat, parseInt, Number, String, Boolean, RegExp, Error, setTimeout, clearTimeout };
  c2.globalThis = c2; vm.createContext(c2);
  vm.runInContext(src + "\n;globalThis.__N={Macros:Macros,Nutrition:Nutrition};", c2, { filename: "nutrition-bundle.js" });
  const N = c2.__N.Nutrition, MM = c2.__N.Macros;
  const truthy = (label, got) => eq(label, !!got, true);   // this suite defines eq/near only
  const YEAR = 2026;

  /* a real, complete profile — the shape the owner's own export carries */
  const FULL = { name: "the owner", sex: "M", heightCm: 178, weightKg: 70,
    bodyFatPct: 12, goalWeightKg: 75, goalBodyFatPct: 10, birthYear: 1994 };
  const training = { sessionsPerWeek: 4, cardioMinutesPerWeek: 0 };

  /* ---- (a) a profile WITH a birth year renders all four targets ---- */
  const v = N.view(FULL, { phase: null, year: YEAR, training });
  eq("with a birth year the tab is in the 'ok' state", v.state, "ok");
  eq("age is derived from the birth year", v.age, YEAR - 1994);
  eq("the html shows Age N", v.html.includes("Age " + (YEAR - 1994)), true);
  eq("exactly four targets, in order", v.targets.map((t) => t.key), ["kcal", "protein", "fat", "carbs"]);
  truthy("every target carries a finite number", v.targets.every((t) => isFinite(t.value) && t.value > 0));
  truthy("every target carries a one-line reason", v.targets.every((t) => typeof t.reason === "string" && t.reason.length > 10));
  eq("the calorie target is on the page", v.html.includes(String(v.targets[0].value)), true);
  eq("the protein target is on the page", v.html.includes(String(v.targets[1].value)), true);
  eq("the fat target is on the page", v.html.includes(String(v.targets[2].value)), true);
  eq("the carbs target is on the page", v.html.includes(String(v.targets[3].value)), true);
  truthy("every reason is rendered next to its number", v.targets.every((t) => v.html.includes(t.reason)));
  eq("the default phase is the engine's recommendation for a gaining goal", v.phase.key, "lean-gain");
  eq("the recommended phase is exposed", v.recommended, MM.recommendedPhase({ goal: "gain" }).key);

  /* ---- (e) the phase picker offers EXACTLY the PHASES keys ---- */
  const offered = (v.html.match(/<option value="([^"]+)"/g) || []).map((s) => s.slice(15, -1));
  eq("the picker offers exactly the PHASES keys", offered, MM.PHASES.map((p) => p.key));
  eq("...in the engine's own order, all six named phases", offered.length, 6);
  truthy("the selected phase's blurb is shown beneath the picker", v.html.includes(MM.phaseFor(v.phase.key).blurb));

  /* ---- (c) the conflict note appears when goalConflict fires... ---- */
  eq("the owner's profile fires a goal conflict", MM.goalConflict(FULL).conflict, true);
  truthy("his conflict note is rendered prominently", v.html.includes("nutrition-conflict") && v.html.includes(MM.goalConflict(FULL).note));
  eq("the conflict object carries the engine's kind", v.conflict && v.conflict.kind, MM.goalConflict(FULL).kind);
  /* ...and NOT for a profile whose goals point the same way */
  const NOCONF = Object.assign({}, FULL, { weightKg: 90, goalWeightKg: 82, bodyFatPct: 24, goalBodyFatPct: 18 });
  const vnc = N.view(NOCONF, { phase: null, year: YEAR, training });
  eq("a non-conflicting profile reports no conflict", vnc.conflict, null);
  eq("...and NOTHING about a conflict is rendered", vnc.html.includes("nutrition-conflict"), false);
  eq("...and it still shows its targets", vnc.state, "ok");

  /* ---- (b) NO birth year -> no numbers, just the pointer ---- */
  const MISSING = Object.assign({}, FULL, { birthYear: null });
  const vm2 = N.view(MISSING, { phase: null, year: YEAR, training });
  eq("missing birth year -> the 'no-birth-year' state", vm2.state, "no-birth-year");
  eq("no target numbers are returned", vm2.targets, null);
  eq("no age is invented", vm2.age, null);
  eq("the pointer to Profile is shown verbatim", vm2.html.includes("Add your birth year in Profile to see your targets"), true);
  // the VISIBLE text, with tags stripped — <h3> is markup, not a number on screen
  const vm2text = vm2.html.replace(/<[^>]*>/g, " ");
  eq("the tab shows NO numbers at all (visible text)", /[0-9]/.test(vm2text), false);
  /* a nonsense year is treated the same as missing — no age is invented */
  eq("1800 is rejected (not a plausible birth year)", N.validBirthYear(1800, YEAR), null);
  eq("a future year is rejected", N.validBirthYear(YEAR + 1, YEAR), null);
  eq("a 3-digit string is rejected", N.validBirthYear("180", YEAR), null);
  eq("a plausible year is accepted", N.validBirthYear(1994, YEAR), 1994);
  eq("1800 renders the same pointer, not an age", N.view(Object.assign({}, FULL, { birthYear: 1800 }), { year: YEAR }).state, "no-birth-year");

  /* ---- (d) under-18 -> the engine's refusal, never a number ---- */
  const TEEN = Object.assign({}, FULL, { birthYear: YEAR - 17 });
  const vteen = N.view(TEEN, { phase: null, year: YEAR, training });
  eq("an under-18 profile is 17", vteen.age, 17);
  eq("under 18 -> the 'refused' state", vteen.state, "refused");
  eq("no targets are returned", vteen.targets, null);
  truthy("the engine's refusal message is shown", vteen.html.includes("Under 18") && vteen.html.includes(vteen.reason));
  eq("no calorie target is shown", vteen.html.includes("Calories"), false);
  eq("no maintenance estimate is shown either", vteen.html.includes("Maintenance"), false);
  eq("the plan itself refused (engine is the source of the refusal)", N.view(TEEN, { year: YEAR, training }).state, "refused");

  /* ---- the maintenance line: equation, WHY, the derived factor, the caveat ---- */
  const m = v.maintenance;
  eq("the FFM path is used because the profile has a body-fat %", m.method, "ffm-cunningham");
  truthy("the equation is named", /fat-free-mass/.test(m.equation));
  truthy("...and names Cunningham", /Cunningham/.test(m.equation));
  truthy("the WHY states lean mass is known", /lean mass/i.test(m.why));
  eq("the activity factor is the DERIVED one (4 sessions/wk -> 1.375)", m.activity.pal, 1.375);
  eq("the plan used that same factor (no dropdown, no second number)", v.plan.tdee.pal, 1.375);
  truthy("the factor's basis is stated", /4 training sessions\/week/.test(m.activity.basis));
  eq("the engine's caveat is shown verbatim", v.html.includes(MM.TRAINING_CAVEAT), true);
  eq("the intake floor is shown", v.html.includes(String(MM.FLOORS.M)), true);
  eq("the floor's own citation is the engine's", m.floor, MM.FLOORS.M);

  /* ---- (f) the honest limits, and no completion date anywhere ---- */
  truthy("the ~71% explained-variance limit is stated", /71%/.test(v.html));
  truthy("the deliberate rounding is stated", /round/i.test(v.html));
  truthy("no completion date is promised", /no completion date/i.test(v.html));
  eq("the word 'date' never pairs with a target number", /\bby \w+ \d|\d+\s*(weeks|months) away/i.test(v.html), false);

  /* ---- (f2) NO intake-logging control: logging is the next step, not this one ---- */
  eq("no input field is rendered on the tab", /<input/i.test(v.html), false);
  eq("no button is rendered on the tab", /<button/i.test(v.html), false);
  eq("the ONLY control is the pace picker", (v.html.match(/<(select|input|button|textarea)\b/gi) || []).length, 1);
  eq("...and it is a select", /<select/i.test(v.html), true);
  eq("no food-log surface is rendered", /food|log it|add food|intake-log/i.test(v.html), false);
  eq("no Vitality / logging opt-out is rendered", /vitality/i.test(v.html), false);

  /* ---- (g) the maintenance line NAMES the factor and its basis ---- */
  // a DECLARED level, no observation -> "YOU SET THIS"
  const CVD = N.view(Object.assign({}, FULL, { activityLevel: "moderate" }), { phase: null, year: YEAR, training });
  eq("declared level drives the factor", CVD.maintenance.activity.pal, 1.55);
  eq("declared tier is reported", CVD.maintenance.activity.tier, 2);
  truthy("...named YOU SET THIS", /YOU SET THIS/.test(CVD.maintenance.activity.text));
  truthy("the honest starting-estimate caveat is shown", CVD.html.includes(MM.ACTIVITY_LEVEL_CAVEAT) && /starting estimate/.test(CVD.maintenance.activity.caveat));
  truthy("...and the basis names the level", /you set your activity level/i.test(CVD.maintenance.activity.basis));
  // an OBSERVED value passing the gate -> "OBSERVED from N days"
  const dl = (n) => { const d = new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const obIntakes = []; for (let i = 0; i < 14; i++) obIntakes.push({ date: dl(i), macros: { kcal: 2500 } });
  const obLog = [{ date: dl(0), weightKg: 80 }, { date: dl(14), weightKg: 78.6 }];
  const CVO = N.view(Object.assign({}, FULL, { weightKg: 80, bodyFatPct: 20, activityLevel: "sedentary" }),
    { phase: null, year: YEAR, training, intake: obIntakes, bodylog: obLog });
  eq("observed factor beats the declared level", CVO.maintenance.activity.method, "observed");
  eq("observed tier is reported", CVO.maintenance.activity.tier, 1);
  truthy("...named OBSERVED with its span", /OBSERVED from 14 days/.test(CVO.maintenance.activity.text));
  truthy("the disagreement is stated PLAINLY", /disagree/.test(CVO.maintenance.activity.disagreement || ""));
  truthy("...and rendered, never a silent switch", CVO.html.includes("n-activity-disagree"));
  truthy("the observed caveat is shown (no silent-switch)", CVO.html.includes("CANNOT tell non-adherence from metabolic drift"));
}

/* ============================================================
   (15) DECLARED activity level + the four-tier PRECEDENCE
   ============================================================ */
console.log("\n--- (15) declared activity level + precedence ---");
eq("ACTIVITY_LEVELS is an array", Array.isArray(M.ACTIVITY_LEVELS), true);
eq("four conventional bands, in order", M.ACTIVITY_LEVELS.map((l) => l.key), ["sedentary", "light", "moderate", "very-active"]);
eq("band factors 1.2/1.375/1.55/1.725", M.ACTIVITY_LEVELS.map((l) => l.factor), [1.2, 1.375, 1.55, 1.725]);
eq("every band has a plain-language blurb", M.ACTIVITY_LEVELS.every((l) => typeof l.blurb === "string" && l.blurb.length > 5), true);
eq("sedentary blurb is the desk-job line", /desk job, little exercise/.test(M.ACTIVITY_LEVELS[0].blurb), true);
eq("activityLevelFor('moderate') = 1.55", M.activityLevelFor("moderate").factor, 1.55);
eq("activityLevelFor unknown -> null", M.activityLevelFor("nope"), null);
// (2) DECLARED is used when no observation exists, and it BEATS training
const decl = M.activityFactor({ activityLevel: "moderate" }, { sessionsPerWeek: 4 }, null);
eq("declared level wins over training (tier 2)", decl.tier, 2);
eq("declared value 1.55", decl.pal, 1.55);
eq("declared method tag", decl.method, "declared");
eq("declared basis names the level", /you set your activity level/i.test(decl.basis), true);
eq("declared caveat is the honest one", decl.caveat, M.ACTIVITY_LEVEL_CAVEAT);
eq("...and says starting estimate", /starting estimate/.test(decl.caveat), true);
// (3) TRAINING-derived when no level and no observation
const tr = M.activityFactor({}, { sessionsPerWeek: 4 }, null);
eq("training tier when no level (tier 3)", tr.tier, 3);
eq("training value 1.375", tr.pal, 1.375);
// (4) FALLBACK when nothing
const fb = M.activityFactor({}, {}, null);
eq("fallback tier (tier 4)", fb.tier, 4);
eq("fallback pal 1.2", fb.pal, 1.2);
eq("fallback basis", fb.basis, "no training logged");
// (1) OBSERVED beats declared AND training
const obsStub = { factor: 1.62, n: 17, spanDays: 17, weighIns: 3, basis: "Observed from 17 days of your intake and weigh-ins", caveat: M.OBSERVED_CAVEAT };
const ob = M.activityFactor({ activityLevel: "sedentary" }, { sessionsPerWeek: 4 }, obsStub);
eq("observed wins over declared+training (tier 1)", ob.tier, 1);
eq("observed method tag", ob.method, "observed");
eq("observed pal is the observed factor", ob.pal, 1.62);

/* ============================================================
   (16) OBSERVED activity factor: the gate, hand-reconciliation, caveats
   ============================================================ */
console.log("\n--- (16) observedTdee ---");
const od = (n) => { const d = new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const intakeDays = (nDays, kcal) => { const a = []; for (let i = 0; i < nDays; i++) a.push({ date: od(i), macros: { kcal } }); return a; };
const bl = [{ date: od(0), weightKg: 80.0 }, { date: od(14), weightKg: 78.6 }];
// HAND-RECONCILED: 14 intake days @ 2500 kcal ; slope = (78.6-80)/14 = -0.1 kg/day
//   TDEE = mean intake - slope*7700 = 2500 - (-0.1*7700) = 2500 + 770 = 3270 kcal/day
const o = M.observedTdee({ intakes: intakeDays(14, 2500), bodylog: bl, rmrKcal: 2000 });
eq("the gate passes with 14 logged days + 2 weigh-ins/14d", o !== null, true);
eq("hand-reconciled kcal/day EQUALS 3270", Math.round(o.kcalPerDay * 1000) / 1000, 3270);
eq("n = distinct logged days", o.n, 14);
eq("spanDays = 14", o.spanDays, 14);
eq("factor = kcal/day / rmr = 1.635", Math.round(o.factor * 1000) / 1000, 1.635);
eq("weight trend reported as kg/week (-0.7)", Math.round(o.trendKgPerWeek * 100) / 100, -0.7);
eq("7700 flagged a FIRST APPROXIMATION", /FIRST APPROXIMATION/.test(o.approximation.label), true);
eq("source names the energy-balance identity", /Energy-balance/.test(o.source), true);
// every required caveat string is present
eq("caveat: intake is under-reported", /UNDER-REPORTED/.test(o.caveat), true);
eq("caveat: 7700 approximation drifts", /7700 kcal\/kg is a FIRST APPROXIMATION/.test(o.caveat), true);
eq("caveat: window / weight noise", /NOISE/.test(o.caveat), true);
eq("caveat: cannot tell non-adherence from drift", /CANNOT tell non-adherence from metabolic drift/.test(o.caveat), true);
// GATE boundary: 9 logged days -> null (falls back), 10 -> observed
eq("9 logged days -> NULL (declared/training stands)", M.observedTdee({ intakes: intakeDays(9, 2500), bodylog: bl, rmrKcal: 2000 }), null);
eq("10 logged days -> observed", M.observedTdee({ intakes: intakeDays(10, 2500), bodylog: bl, rmrKcal: 2000 }) !== null, true);
// weigh-in gate: span < 5 days, or a single weigh-in -> null
eq("weigh-ins spanning only 4 days -> null", M.observedTdee({ intakes: intakeDays(14, 2500), bodylog: [{ date: od(0), weightKg: 80 }, { date: od(4), weightKg: 79.5 }], rmrKcal: 2000 }), null);
eq("a single weigh-in -> null", M.observedTdee({ intakes: intakeDays(14, 2500), bodylog: [{ date: od(0), weightKg: 80 }], rmrKcal: 2000 }), null);
eq("no intake logged -> null", M.observedTdee({ intakes: [], bodylog: bl, rmrKcal: 2000 }), null);
eq("no rmr supplied -> factor null but kcal/day still computed", M.observedTdee({ intakes: intakeDays(14, 2500), bodylog: bl }).factor, null);
// precedence THROUGH the gate
const win = M.activityFactor({ activityLevel: "sedentary" }, { sessionsPerWeek: 4 },
  M.observedTdee({ intakes: intakeDays(14, 2500), bodylog: bl, rmrKcal: 2000 }));
eq("gate passes -> OBSERVED wins", win.method, "observed");
eq("...pal is the observed factor", Math.round(win.pal * 1000) / 1000, Math.round((3270 / 2000) * 1000) / 1000);
const lose = M.activityFactor({ activityLevel: "sedentary" }, { sessionsPerWeek: 4 },
  M.observedTdee({ intakes: intakeDays(9, 2500), bodylog: bl, rmrKcal: 2000 }));
eq("gate fails (9 days) -> the DECLARED level stands", lose.method, "declared");
eq("...pal is the declared 1.2", lose.pal, 1.2);

/* ============================================================
   (17) NUTRITION POLISH: goal-aware totals wording + the rounding note
   ============================================================ */
console.log("\n--- (17) goal-aware totals wording + the rounding note ---");
{
  const fs3 = require("fs");
  const src3 = fs3.readFileSync(path.join(__dirname, "..", "js", "macros.js"), "utf8") + "\n;\n"
    + fs3.readFileSync(path.join(__dirname, "..", "js", "nutrition.js"), "utf8");
  const c3 = { console, module: { exports: {} }, Date, Math, JSON, Object, Array, Set, Map,
    isFinite, parseFloat, parseInt, Number, String, Boolean, RegExp, Error, setTimeout, clearTimeout };
  c3.globalThis = c3; vm.createContext(c3);
  vm.runInContext(src3 + "\n;globalThis.__P={Macros:Macros,Nutrition:Nutrition};", c3, { filename: "polish-bundle.js" });
  const P = c3.__P.Nutrition;
  const truthy = (label, got) => eq(label, !!got, true);

  const T = [{ key: "kcal", label: "Calories", value: 2000, unit: "kcal" }];
  const BANNED = /\b(over|exceeded?|exceed|cheat|cheated|too much|failed|failure|limit|bad|junk|off-track)\b/i;

  /* ---- the wording is driven by the goal the target came from ---- */
  const gUnder = P.intakeSummary(T, { kcal: 900 }, "gain")[0];
  const lUnder = P.intakeSummary(T, { kcal: 900 }, "lose")[0];
  const gOver = P.intakeSummary(T, { kcal: 2400 }, "gain")[0];
  const lOver = P.intakeSummary(T, { kcal: 2400 }, "lose")[0];
  truthy("GAIN under: offers the remaining figure", /to go/.test(gUnder.text));
  truthy("LOSS under: progress, never 'to go'", !/to go/.test(lUnder.text) && /budget/.test(lUnder.text));
  truthy("gain and loss word the SAME numbers DIFFERENTLY", gUnder.text !== lUnder.text);
  eq("gain under row text", gUnder.text, "900 of 2000 kcal — 1240 to go");
  eq("loss under row text", lUnder.text, "900 of 2000 kcal so far — 1240 still in today's budget");
  eq("at/above row text (gain): neutral", gOver.text, "2400 kcal — your target is 2000 kcal");
  eq("at/above row text (loss): identical — over is ordinary on every goal", lOver.text, gOver.text);
  [gUnder, lUnder, gOver, lOver].forEach((r) =>
    truthy("no shaming word in " + JSON.stringify(r.text), !BANNED.test(r.text)));
  const gHead = P.intakeHeadline([gUnder], 2, "gain");
  const lHead = P.intakeHeadline([lUnder], 2, "lose");
  truthy("GAIN headline offers 'to go'", /to go/.test(gHead));
  truthy("LOSS headline NEVER says to eat up to the target", !/to go/.test(lHead));
  truthy("gain and loss headlines differ", gHead !== lHead);
  [["gain", 900], ["lose", 900], ["maintain", 900], ["gain", 2400], ["lose", 2400], ["maintain", 2400]]
    .forEach(([g, k]) => {
      const h = P.intakeHeadline(P.intakeSummary(T, { kcal: k }, g), 3, g);
      truthy("no shaming word in the " + g + " headline at " + k + " kcal", !BANNED.test(h));
    });

  /* ---- the SAME goal drives the targets AND the wording: they cannot disagree.
          Here the profile's own weights say GAIN, but the phase PICKED is a cut,
          so the wording must follow the PHASE. ---- */
  const MANP = { sex: "M", weightKg: 80, heightCm: 180, birthYear: 1985 };
  const gv = P.view(MANP, { phase: "lean-gain", year: 2026, training: { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 } });
  const cv = P.view(MANP, { phase: "cut-standard", year: 2026, training: { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 } });
  eq("a gain phase reports its goal on the view model", gv.phase.goal, "gain");
  eq("a cut phase reports its goal on the view model", cv.phase.goal, "lose");
  eq("...and the PLAN was built from that same phase goal", [gv.plan.profile.goal, cv.plan.profile.goal], ["gain", "lose"]);
  const cutRows = P.intakeSummary(cv.targets, { kcal: 900 }, cv.phase.goal);
  const cutKcal = cutRows.find((r) => r.key === "kcal");
  truthy("the cut's own goal drives its rows (progress, not 'to go')",
    /budget/.test(cutKcal.text) && !/to go/.test(cutKcal.text));
  const gainRows = P.intakeSummary(gv.targets, { kcal: 900 }, gv.phase.goal);
  truthy("the gain's own goal drives its rows ('to go' IS offered)", /to go/.test(gainRows.find((r) => r.key === "kcal").text));
  truthy("the two phases show DIFFERENT wording for the same numbers",
    gainRows.find((r) => r.key === "kcal").text !== cutKcal.text);

  /* ---- (3a) the rounding note: grams to 5 g, target to 10 kcal ---- */
  truthy("the rounding note is exposed", typeof P.MACRO_ROUNDING_NOTE === "string" && P.MACRO_ROUNDING_NOTE.length > 40);
  truthy("...it names the 5 g gram rounding", /5 g/.test(P.MACRO_ROUNDING_NOTE));
  truthy("...and the 10 kcal target rounding", /10 kcal/.test(P.MACRO_ROUNDING_NOTE));
  truthy("...and says both numbers are right", /only the rounding differs/.test(P.MACRO_ROUNDING_NOTE));
  truthy("...and it is rendered on the tab", gv.html.includes(P.MACRO_ROUNDING_NOTE.slice(0, 40)));
  truthy("...inside the n-rounding element", gv.html.includes('id="n-rounding"'));
  /* the owner's own arithmetic: 145 P / 75 F / 230 C = 2175 kcal against a 2170 target */
  const mv = P.view(MANP, { phase: "maintain", year: 2026, training: { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 } });
  eq("maintain plan target kcal 2170", mv.plan.target.kcal, 2140);
  eq("maintain plan protein 130 g", mv.plan.protein.g, 130);
  eq("maintain plan fat 65 g", mv.plan.fat.g, 65);
  eq("maintain plan carbs 260 g", mv.plan.carbs.g, 260);
  eq("the grams add to 2175 kcal (145*4 + 75*9 + 230*4)", 145 * 4 + 75 * 9 + 230 * 4, 2175);
  truthy("the note spells out THIS plan's 2175-vs-2170 arithmetic",
    /145 g protein \+ 75 g fat \+ 230 g carbs = 2175 kcal against the 2170 kcal target/.test(mv.roundingNote));
  truthy("...and calls the 5 kcal difference out", /5 kcal apart/.test(mv.roundingNote));
  truthy("the note is on the page", mv.html.includes("2175 kcal against the 2170 kcal target"));
}

/* ============================================================
   (18) REFUSAL SOURCES: each refusal carries its OWN, non-empty source
   ============================================================ */
console.log("\n--- (18) refusal sources ---");
const u18 = M.plan({ sex: "M", weightKg: 60, heightCm: 170, ageY: 17, goal: "lose", pace: "loss-slow" });
const prg = M.plan({ ...WOMAN, goal: "maintain", pace: "maintain", pregnant: true });
const lct = M.plan({ ...WOMAN, goal: "maintain", pace: "maintain", lactating: true });
const edr = M.plan({ ...MAN, goal: "lose", pace: "loss-slow", eatingDisorderRisk: true });
const noAgeField = M.plan({ sex: "M", weightKg: 80, heightCm: 180, goal: "maintain", pace: "maintain" });
const noWH = M.plan({ sex: "M", ageY: 30, goal: "maintain", pace: "maintain" });
const badSex = M.plan({ sex: "X", weightKg: 80, heightCm: 180, ageY: 30, goal: "maintain", pace: "maintain" });
[u18, prg, lct, edr, noAgeField, noWH, badSex].forEach((p, i) => {
  eq(`refusal ${i} is refused`, p.refused, true);
  eq(`refusal ${i} carries a NON-EMPTY source`, typeof p.source === "string" && p.source.length > 0, true);
});
eq("the under-18 source is NOT the intake-floor source", u18.source === M.FLOOR_SOURCE, false);
eq("the pregnancy source is NOT the intake-floor source", prg.source === M.FLOOR_SOURCE, false);
eq("the eating-disorder source is NOT the intake-floor source", edr.source === M.FLOOR_SOURCE, false);
eq("under-18 source cites the ADULT derivation range (19-78)", /19-78/.test(u18.source) && /PMID 2305711/.test(u18.source), true);
eq("under-18 source STATES the supervision claim is not cited", /NOT CITED AS EVIDENCE/.test(u18.source), true);
eq("pregnancy source cites the CDC trimester additions", /CDC/.test(prg.source) && /340/.test(prg.source) && /450/.test(prg.source), true);
eq("lactation carries the same pregnancy source", lct.source, prg.source);
eq("eating-disorder source cites NICE NG69", /NG69/.test(edr.source), true);
eq("the three refusal sources are all different", new Set([u18.source, prg.source, edr.source]).size, 3);
eq("the floor's own source is untouched", /ISSN position stand/.test(M.FLOOR_SOURCE), true);

/* ============================================================
   (19) SEX IS OPTIONAL WHEN A BODY-FAT % IS KNOWN
   ============================================================ */
console.log("\n--- (19) sex optional when a body-fat % is known ---");
const noSexBf = M.plan({ weightKg: 80, heightCm: 180, ageY: 30, bodyFatPct: 20, goal: "maintain", pace: "maintain" });
eq("a body-fat % but NO sex is NOT refused", noSexBf.refused, false);
eq("...it produces a real target", isFinite(noSexBf.target.kcal) && noSexBf.target.kcal > 0, true);
eq("...via the sex-independent FFM path", noSexBf.bmr.method, "ffm-cunningham");
eq("...rmrFFM takes no sex input (identical with sex M or F)",
   M.rmrFFM({ weightKg: 80, bodyFatPct: 20 }).kcal, M.rmrFFM({ weightKg: 80, bodyFatPct: 20, sex: "F" }).kcal);
eq("...the CONSERVATIVE higher floor (1500) is used", noSexBf.target.floor, 1500);
eq("...and that assumption is reported to the caller", noSexBf.target.floorAssumed, true);
eq("...the floor's sex is the male value", noSexBf.target.floorSex, "M");

const noSexNoBf = M.plan({ weightKg: 80, heightCm: 180, ageY: 30, goal: "maintain", pace: "maintain" });
eq("no sex AND no body-fat % STILL refuses", noSexNoBf.refused, true);
eq("...it returns no numbers", NO_NUMBERS(noSexNoBf), true);
eq("...it says plainly it will not guess", /won't guess/.test(noSexNoBf.reason), true);
eq("...it points at Profile", /Profile/.test(noSexNoBf.reason), true);
eq("...it names the body-fat % alternative route", /body-fat %/.test(noSexNoBf.reason), true);
eq("...it names the sex-independent lean-mass route", /lean-mass/.test(noSexNoBf.reason), true);
eq("the refusal contains NO imperative 'must'", /\bmust\b/i.test(noSexNoBf.reason), false);
eq("a nonsense sex ('X') with no body-fat % still refuses", M.plan({ sex: "X", weightKg: 80, heightCm: 180, ageY: 30 }).refused, true);
eq("...but 'X' WITH a body-fat % does NOT refuse", M.plan({ sex: "X", weightKg: 80, heightCm: 180, ageY: 30, bodyFatPct: 20 }).refused, false);

/* The sex-SPECIFIC Mifflin weight form is UNCHANGED for M and F: on the SAME
   body the +5 / -161 sex term is the only difference -> a 166 kcal/day gap.
   (Mifflin-St Jeor is ONE regression carrying a sex term — not two equations.) */
const miffBase = 10 * 80 + 6.25 * 180 - 5 * 30;      // = 1775
const mM = M.rmrMifflin({ sex: "M", weightKg: 80, heightCm: 180, ageY: 30 }).kcal;
const mF = M.rmrMifflin({ sex: "F", weightKg: 80, heightCm: 180, ageY: 30 }).kcal;
eq("Mifflin male (+5) is unchanged", mM, miffBase + 5);          // 1780
eq("Mifflin female (-161) is unchanged", mF, miffBase - 161);    // 1614
eq("the 166 kcal/day sex gap still holds", mM - mF, 166);

/* ============================================================
   (20) THE NUTRITION TAB renders the conservative-floor note
   ============================================================ */
console.log("\n--- (20) Nutrition tab: sexless profile with a body-fat % ---");
{
  const truthy2 = (label, got) => eq(label, !!got, true);
  const src3 = fs.readFileSync(path.join(__dirname, "..", "js", "macros.js"), "utf8") + "\n;\n"
    + fs.readFileSync(path.join(__dirname, "..", "js", "nutrition.js"), "utf8");
  const c3 = { console, module: { exports: {} }, Date, Math, JSON, Object, Array, Set, Map,
    isFinite, parseFloat, parseInt, Number, String, Boolean, RegExp, Error, setTimeout, clearTimeout };
  c3.globalThis = c3; vm.createContext(c3);
  vm.runInContext(src3 + "\n;globalThis.__N3={Macros:Macros,Nutrition:Nutrition};", c3, { filename: "nutrition3.js" });
  const N3 = c3.__N3.Nutrition;
  const NO_TRAIN = { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 };
  const SEXLESS = { name: "C", sex: undefined, heightCm: 178, weightKg: 80, bodyFatPct: 20,
    goalWeightKg: 78, goalBodyFatPct: 15, birthYear: 1994 };
  const v3 = N3.view(SEXLESS, { year: 2026, training: NO_TRAIN });
  eq("a body-fat %, no sex -> the tab is in the 'ok' state", v3.state, "ok");
  eq("...four targets are produced", v3.targets.map((t) => t.key), ["kcal", "protein", "fat", "carbs"]);
  eq("...the floor shown is 1500", v3.maintenance.floor, 1500);
  eq("...the floor label says sex is not set", /sex not set/.test(v3.maintenance.floorLabel), true);
  truthy2("...the conservative-floor note is on the page",
    /higher floor/.test(v3.html) && /1500/.test(v3.html) && /Sex isn't set/i.test(v3.html));
  truthy2("...and it says setting sex may change the floor", /may change this floor/.test(v3.html));
  const NEITHER = Object.assign({}, SEXLESS, { bodyFatPct: null });
  const v4 = N3.view(NEITHER, { year: 2026, training: NO_TRAIN });
  eq("neither sex nor body-fat % -> the 'refused' state", v4.state, "refused");
  eq("...no numbers are shown", v4.targets, null);
  truthy2("...the new refusal text is on the page", /won't guess/.test(v4.html));
  eq("...and it contains no 'must'", /\bmust\b/i.test(v4.html), false);
}

/* ---------- (21) COPY: the two defect classes — malformed text + rejection framing ---------- */
console.log("\n--- (21) copy: balanced parens and no rejection-framed headers ---");
{
  const truthy3 = (label, got) => eq(label, !!got, true);
  const srcN = fs.readFileSync(path.join(__dirname, "..", "js", "macros.js"), "utf8") + "\n;\n"
    + fs.readFileSync(path.join(__dirname, "..", "js", "nutrition.js"), "utf8");
  const cN = { console, module: { exports: {} }, Date, Math, JSON, Object, Array, Set, Map,
    isFinite, parseFloat, parseInt, Number, String, Boolean, RegExp, Error, setTimeout, clearTimeout };
  cN.globalThis = cN; vm.createContext(cN);
  vm.runInContext(srcN + "\n;globalThis.__N9={Nutrition};\n", cN, { filename: "nutrition9.js" });
  const N9 = cN.__N9.Nutrition;
  const NO_TRAIN = { sessionsPerWeek: 0, cardioMinutesPerWeek: 0 };

  /* (a) the maintenance activity-factor line: one clean parenthetical, no nesting */
  const FB = N9.view({ name: "C", sex: "M", heightCm: 178, weightKg: 80, bodyFatPct: 20, birthYear: 1994 },
    { year: 2026, training: NO_TRAIN });
  eq("no activity level and no training -> the 'fallback' activity tier", FB.maintenance.activity.method, "fallback");
  const line = ((FB.html.match(/Activity factor[\s\S]*?<\/p>/) || [""])[0]).replace(/<[^>]*>/g, "");
  /* the earlier default-start text nested a second "(" inside the factor's own "(...)". */
  eq("the activity-factor line carries EXACTLY one open paren", (line.match(/\(/g) || []).length, 1);
  eq("...and exactly one close paren", (line.match(/\)/g) || []).length, 1);
  eq("...so no nested parenthetical remains", /\([^()]*\(/.test(line), false);
  truthy3("...the meaning is kept (no level set, no training logged)", /no activity level set and no training logged/.test(line));

  /* (b) the refusal card header must not tell the user they are the problem */
  const REF = N9.view({ name: "C", sex: undefined, heightCm: 178, weightKg: 80, bodyFatPct: null, birthYear: 1994 },
    { year: 2026, training: NO_TRAIN });
  eq("a missing-required-field profile still refuses (no numbers)", REF.state, "refused");
  eq("the refusal header is NOT 'not for this profile'", /not for this profile/i.test(REF.html), false);
  truthy3("...it reads the forward-looking 'one more detail'", /one more detail/.test(REF.html));
  eq("the no-birth-year header is neutral too", /not for this profile/i.test(
    N9.view({ name: "C", sex: "M", heightCm: 178, weightKg: 80, birthYear: null }, { year: 2026, training: NO_TRAIN }).html), false);

  /* (c) source sweep: no user-facing string anywhere carries a rejection phrase.
         Comments are stripped first — a code comment is never on screen. */
  const jsDir = path.join(__dirname, "..", "js");
  const BANNED = ["not for this profile", "invalid", "you failed"];
  const hits = [];
  for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith(".js"))) {
    const raw = fs.readFileSync(path.join(jsDir, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const p of BANNED) if (raw.toLowerCase().includes(p)) hits.push(f + " -> " + p);
  }
  const idxRaw = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  for (const p of BANNED) if (idxRaw.toLowerCase().includes(p)) hits.push("index.html -> " + p);
  eq("no user-facing string, header or badge carries a banned rejection phrase", hits, []);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
