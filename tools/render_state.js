/* render_state.js — build and VALIDATE the state object a render is made from.

   WHY THIS FILE EXISTS (audit 2026-11-10)
   The dashboard's Attributes radar and its "weak points" cards both present the
   same 28-day read of the same attribute, and both call the SAME function —
   Engine.attributes(state, 28) — so given ONE state they cannot disagree. A pair
   of renders nevertheless appeared to show POWER/MOBILITY six points apart
   (radar 11/12, cards 17/18). It was not the product: the two frames were built
   from DIFFERENT injected states in one batch, and the multi-week fixture
   builder stamped FUTURE-dated sessions, so a render could show numbers derived
   from training that had not happened yet.

   THE RULE this file enforces, so that can never look like a bug again:
     1. A state used for a render must carry NO session dated after today.
     2. A render must be built from exactly the state its numbers are computed
        from (inject once, then capture every surface off that one state).

   assertNoFutureDates() throws, so a bad injection fails loudly instead of
   quietly rendering an unreproducible number. */
"use strict";

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
/* Monday of the calendar week holding d, at local noon (matches the engine's own
   Monday-start week convention without pulling the engine in). */
const mondayOf = (d) => {
  const x = new Date(d.getTime()); x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

/* Every session date in `state` that lies AFTER `now`'s calendar day. */
function futureDated(state, now = new Date()) {
  const today = dstr(now);
  return ((state && state.workouts) || []).map((w) => w.date).filter((d) => d && d > today);
}

/* Throw if the state describes training that has not happened yet. */
function assertNoFutureDates(state, now = new Date()) {
  const bad = futureDated(state, now);
  if (bad.length) {
    throw new Error(
      `state-injection guard: ${bad.length} future-dated session(s) [${bad.join(", ")}] ` +
      `— refusing a state that describes training past ${dstr(now)}. ` +
      `A render must be built from exactly the state its numbers are computed from.`);
  }
  return state;
}

/* The seven groups the multi-week fixture trains, one movement each. */
const EX = {
  Chest:     { id: 2735, n: "Cable Side Pressure",            g: ["Chest", "Shoulders"] },
  Shoulders: { id: 1223, n: "Claps over the head",            g: ["Shoulders"] },
  Arms:      { id: 439,  n: "Overhand Cable Curl",            g: ["Arms"] },
  Back:      { id: 1245, n: "Front Lever",                    g: ["Back", "Core"] },
  Core:      { id: 1966, n: "1/2 Kneeling Thoracic Rotation", g: ["Core"] },
  Legs:      { id: 9,    n: "2 Handed Kettlebell Swing",      g: ["Legs", "Core"] },
  Calves:    { id: 2661, n: "Dumbbell Calf Raise",            g: ["Calves"] },
};

function baseProfile() {
  return { name: "Render Subject", sex: "M", heightCm: 180, weightKg: 82, bodyFatPct: 15,
    goalWeightKg: 78, goalBodyFatPct: 12, birthYear: 1985, weeklyTarget: 4, units: "kg",
    activityLevel: "moderate", nutritionVitality: false };
}

/* A deterministic multi-week training history for renders and tests. THE FIX:
   the original builder laid the CURRENT week's sessions on this week's
   Monday/Wednesday/Friday regardless of what day it was, so on a Monday it
   stamped Wednesday and Friday as already-trained. Those future dates are now
   SKIPPED, and the result is asserted future-free before it is returned. */
function buildMultiweekState(now = new Date(), weeks = 8) {
  const monday = mondayOf(now);
  const state = {
    version: 1,
    createdAt: dstr(addDays(monday, -weeks * 7)) + "T12:00:00.000Z",
    profile: baseProfile(),
    nutrition: { phase: "lean-gain" },
    workouts: [], bodylog: [], overrides: {}, custom: [], achievements: {},
    settings: { seeded: true, welcomeSeenVersion: "1" },
  };
  const mk = (ex, sets, load) => ({
    id: ex.id, name: ex.n, g: ex.g, mode: "weight_reps",
    sets: Array.from({ length: sets }, (_, i) => ({ w: load + i * 2.5, r: 8 })),
  });
  for (let w = 0; w < weeks; w++) {
    const mon = addDays(monday, -(weeks - 1 - w) * 7);
    const plan = [
      [0, [[EX.Chest, 3 + (w % 3), 60], [EX.Shoulders, 2 + (w % 2), 30], [EX.Arms, 3, 25]]],
      [2, [[EX.Back, 4 + (w % 2), 70], [EX.Core, 3, 20]]],
      [4, [[EX.Legs, 5 + (w % 3), 80], [EX.Calves, 3 + (w % 2), 50]]],
    ];
    for (const [off, list] of plan) {
      const date = dstr(addDays(mon, off));
      if (date > dstr(now)) continue;               // never stamp a future session
      state.workouts.push({
        id: "mw" + w + "_" + off, date, note: "",
        entries: list.map(([ex, sets, load]) => mk(ex, sets, load || 20)),
      });
    }
  }
  return assertNoFutureDates(state, now);
}

module.exports = { futureDated, assertNoFutureDates, buildMultiweekState, baseProfile, dstr, mondayOf };
