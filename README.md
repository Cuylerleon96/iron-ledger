# Iron Ledger

A gamified workout tracker with game-style stat charts. You log sets the way you
already write them in a notes app; the app figures out whether you are getting
better or worse, where your weak points are, and turns it into a character sheet.

Local-first. No account, no server, no telemetry — everything lives on the device.

<p align="center"><em>Android app · 930-exercise library · GBA-styled stat hexagon</em></p>

---

## What it does

**Logging** — pick an exercise from 930 movements, type your sets. The quick-add
box understands the shorthand you already use: `100x10`, `80x8@9`, `60s`, `1:30`,
`5km 24:00`. Sets pre-fill from your last session for that exercise.

**Bulk import** — *Paste from notes* takes a whole session in the format you were
already writing:

```
Bench press machine:
1:100x10
2:100x10
3:110x3
4:90x8
```

Each exercise name is matched against the library; anything that does not match
becomes a custom exercise you own.

**Comparison** — every exercise card shows this session against the last one:
estimated 1RM, total volume and top set, with a ▲/▼ delta. Records are only
counted from the second session onward, because you cannot beat a baseline.

**The stat chart** — six attributes on a hexagonal spider chart, each with a tier
word (*Best / Fantastic / Very good / Pretty good / Decent / Not great / Poor /
No good*) and a delta arrow against the previous 28 days.

**Muscle balance** — a second radar of your seven muscle groups, scored on working
sets per week against published volume landmarks, plus a bar chart marking the
minimum-effective-volume line so under-trained groups are obvious.

**Weak points** — the app analyses your history and tells you what to fix, with a
concrete next move: lagging muscle groups, untrained groups, push/pull imbalance,
quad/hamstring gap, plateaued lifts, and any attribute scoring below 30.

**Gamification** — XP from tonnage, sets and sessions; levels with titles; 30
badges; daily and weekly streaks; per-exercise PR tracking.

---

## Tracking modes

Different movements need different numbers, so each exercise carries a mode
(auto-assigned, overridable per exercise):

| Mode | Tracked as | Examples |
|---|---|---|
| `weight_reps` | load × reps | bench press, squat, curls |
| `reps` | reps only | pull-ups, push-ups, dips |
| `time` | seconds held | planks, dead hangs, stretches |
| `weight_time` | load × seconds | weighted carries, loaded holds |
| `distance_time` | distance + duration | run, row, bike, swim |
| `weight_distance` | load × distance | farmer's walks |

Set-level optional extras: RPE (1–10) and rest seconds.

---

## How the scores are derived

Nothing is invented. Every number traces to something you logged plus a published
reference.

**Estimated 1RM** — Epley: `weight × (1 + reps/30)`, applied to sets of 1–12 reps.
Above 12 reps the estimate is unreliable, so reps are capped rather than extrapolated.

**Strength** — estimated 1RM on a core lift as a multiple of bodyweight, mapped
onto the five published strength-standard tiers (Beginner → Elite).
Ratios from the Strength Level and Brolic standard tables; women's ratios use
Brolic's stated ~80% lower-body / ~65% upper-body scaling. Only free-weight core
lifts (barbell, dumbbell, SZ-bar, kettlebell, pull-up bar) count. Until you log
one, Strength is *estimated* from your best machine work at a 0.62 discount and
capped at 75 — machine stacks are not comparable to free weights, so it is
deliberately conservative and labelled as an estimate.

**Stamina** — 42% weekly cardio minutes, 28% best single-set rep count, 30% weekly
working-set volume.

**Power** — olympic-lift standard score blended with explosive rep count and heavy
low-rep (≤3) set count.

**Mobility** — minutes per week of logged stretching/mobility work.

**Discipline** — sessions in 28 days against your weekly target, plus streak length.

**Vitality** — weight trend toward your goal, body fat, and BMI. If only BMI is
available the score is capped at 85, because BMI says nothing about composition.

**Muscle balance** — weekly working sets per group, scored against published
volume landmarks (MEV / MAV / MRV). Primary muscles take full credit for a set,
secondary muscles half.

**Weak points** are flagged relative to your own mean, not an absolute ideal:
a group below 70% of your average score and under its MEV is "under-trained".

### Sources
- Exercise data: [wger](https://wger.de) open exercise database, CC-BY-SA (930 exercises).
- Strength standards: Strength Level and Brolic published bodyweight-ratio tables.
- Volume landmarks: Renaissance Periodization's published MEV/MAV/MRV ranges (mid-range values).
- 1RM formula: Epley.
- Fonts: Press Start 2P, Silkscreen, Pixelify Sans — all SIL OFL 1.1, self-hosted.

> Every figure is an estimate. A machine stack is not a barbell, an Epley 1RM is
> not a tested max, and BMI is not body composition. The app labels its estimates.

---

## Data & persistence

- Stored in the browser/WebView `localStorage`, mirrored to app-private storage on
  Android so a cleared WebView cache does not lose your history.
- A rolling previous-state backup is kept in `localStorage`.
- **Export JSON** for a real backup; **Export CSV** for spreadsheets; **Import JSON**
  merges or replaces. Export regularly — the exported file is the durable copy.

---

## Running it

### Browser
```bash
./serve.sh          # http://localhost:8787
```

### Android
Requires JDK 17, Android SDK with `platforms;android-34`, and Node.

```bash
npm install
npm run build              # tools/build_www.py -> www/
npx cap sync android       # copies www/ into the Android project
cd android && ./gradlew assembleDebug --no-daemon
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`npx cap sync android` is the step that matters: without it the APK ships a stale
copy of the web assets. Re-sync after every change.

---

## Layout

```
index.html               shell
css/style.css            the whole visual system
css/fonts.css            self-hosted pixel fonts
js/data.js               930-exercise library (generated)
js/engine.js             all scoring, PRs, weak points, XP — pure, no DOM
js/chart.js              dependency-free SVG radar / line / bar charts
js/store.js              persistence, import/export, migration
js/native.js             Android bridge (no-ops in a browser)
js/app.js                UI layer
js/seed.js               the example session
data/library.json        source of js/data.js
tools/build_www.py       assembles the web bundle
tools/make_icons.py      generates the launcher icons
tools/test_engine.js     headless maths checks
android/                 Capacitor project
```

`js/engine.js` is deliberately free of DOM and storage, so all the maths can be
tested headlessly with `node tools/test_engine.js`.
