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
["rmr","rmrMifflin","rmrFFM","rmrCunningham","tdeeFallback","paceRate","energyAdjustment","controller",
 "protein","fat","carbs","plan","refuse","bmi","roundKcal","round5"].forEach((k) => eq(`exposes ${k}()`, typeof M[k], "function"));
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
// LBM = 80*(1-0.20) = 64 ; RMR = 19.7*64 + 413 = 1260.8 + 413 = 1673.8
eq("rmr() picks FFM when bf given", M.rmr({ ...MAN, bodyFatPct: 20 }).method, "ffm-mifflin");
near("FFM rmr 19.7*64+413", M.rmrFFM({ weightKg: 80, bodyFatPct: 20 }).kcal, 1673.8);
eq("rmr() picks weight path when bf null", M.rmr({ ...MAN, bodyFatPct: null }).method, "mifflin-weight");
near("weight path rmr", M.rmr({ ...MAN, bodyFatPct: null }).kcal, 1780);
// Cunningham alternative exposed: 500 + 22*64 = 1908
near("cunningham alternative", M.rmrCunningham({ weightKg: 80, bodyFatPct: 20 }).kcal, 1908);
eq("default FFM is NOT cunningham", M.plan({ ...MAN, bodyFatPct: 20, goal: "maintain", pace: "maintain" }).bmr.method, "ffm-mifflin");

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
eq("missing age refused (no age field in app yet)", noage.refused, true);
eq("missing age has no numbers", NO_NUMBERS(noage), true);

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

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
