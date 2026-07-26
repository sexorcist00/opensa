# Vehicle physics — the behaviour record

The second measurement family in this folder. The rest of `benchmarks/` records what a frame **COSTS**; this
records what a car **DOES** — how long it takes to stop, how far it rolls, whether it goes over. Same standing
rule, same reason: a number that exists only in a conversation is gone when the session ends, and no later
tuning round can prove it improved anything without the run it improved on.

These are the captures plans 081/02-07 are judged against. `scripts/phys-compare.ts` diffs any two of them.

## How a run is produced

`?phys=<scene|all>&car=<model>` drives a scripted lap and prints one `[phys] {json}` line per scene — the
`[bench]` protocol's twin. Headless: `TAG='[phys]'` makes `tools-debug/bench-harness/drive.js` collect it.
**Full guide: [`../../development/physics-laps.md`](../../development/physics-laps.md)** · commands:
[`../../commands.md`](../../commands.md) · toolbox: [`../../debug/README.md`](../../debug/README.md).

## File naming

`YYYY-MM-DD-<surface>-<what>-<car>.json` — e.g. `2026-07-26-headless-before-infernus.json`. `surface` is
`headless` (the harness) or `ingame`. A full sweep is **one file per CAR** (an array of that car's scene
captures); a single-scene sweep across cars is one file named for the SCENE
(`2026-07-26-headless-step-steer-four-cars.json`).

## Format

Each file is the array of `[phys]` lines, verbatim. One capture:

```jsonc
{
  "car": "infernus",
  "key": "brake-strip", // scene id, from apps/web/src/phys-scenes.ts
  "what": "Time to speed, then a full-brake stop: …", // the scene's own statement of purpose
  "seriesHz": 20,
  "columns": ["t", "speed", "slipAngle", "pitch", "roll", "yawRate", "gLong", "gLat", "gVert", "throttle", "steer"],
  "series": [[0.0167, 0, 0, -0.0022 /* … */]], // thinned to seriesHz; SI + radians
  "summary": {
    "topSpeedKmh": 165.69,
    "timeTo100S": 3.98, // null when the car never gets there
    "brake": { "distanceM": 59.94, "fromKmh": 165.18, "seconds": 2.92 }, // null when the lap never braked to a stop
    "pitchUnderBrakeDeg": 0.07, // POSITIVE IS NOSE UP — the braking complaint is a sign on this field
    "pitchDeg": { "min": -0.53, "max": 0.07 },
    "rollDeg": { "min": 0, "max": 0 }, // positive = right side down
    "slipMaxDeg": 0, // largest body slip angle reached
    "turnedDeg": 0, // integrated yaw — counts a whole spin, not the shortest way round
    "gLong": { "min": -3.17, "max": 0.85 },
    "gLat": {}, "gVert": {}, // gravity excluded: resting on the springs reads 0 vertical
    "airborneS": 0, // seconds with NO wheel in contact
    "flip": null, // { atKmh, atS } the first time |roll| passed 90°
    "frames": 960, "durationS": 15.98,
  },
}
```

**The summary peaks come from EVERY fixed step; the series is thinned.** A spike survives as a number even
when its own sample is dropped from the curve — never read a peak off `series`.

## What makes two captures comparable

- **The build and the pak.** Same as the perf record: what the world contains decides what the car drives on.
  Record it in the index row.
- **The scene definition.** Scenes are calibrated data (`apps/web/src/phys-scenes.ts`) — a spot moved or a
  timeline retimed makes two runs of the same `key` incomparable. Note it when it changes.
- **The car model**, and that the same three (infernus / admiral / firetruk) are the calibration trio:
  sports, sedan, heavy.
- **NOT the machine.** Unlike a perf run, a lap is fixed-step physics: it does not care how fast the frames
  came. Determinism is measured — `brake-strip` reproduced to the second decimal across an isolated run and
  a full sweep on the same build.

## Chronology

### 2026-07-26 — the 081 BEFORE matrix (3 cars × 7 scenes, 21 of 21 laps)

The baseline the whole 081 chain is tuned against. **Pak: the canonical `./build/original/opensa`,
`pak/manifest.json` buildTime `08:41 24-07-2026`, cellSize 250, 1 272 901 632 B** (the same build every dev
surface reads — plan 079). Code at commit `596b0e9`; headless via the bench harness (M3 Pro, ANGLE/Metal).
Scenes v1 as authored that day; the analysis lives in the plan's ledger
([`../../plans/081-vehicle-physics/01-telemetry.md`](../../plans/081-vehicle-physics/01-telemetry.md)).

Headlines: a **firetruck reaches 149.1 km/h and does 0-100 in 4.53 s** while an infernus does 3.98 and an
**admiral never reaches 100 at all**; the infernus goes fully over (roll ±180°) in the slalom AND the
handbrake turn, the firetruck goes over in the slalom and lands on its side off the crest with **5.22 s of
air**, and the admiral goes over nowhere; a kerb throws the ten-tonne truck **2.45 s into the air** and spins
the infernus **−89.5°** at 125 km/h; and on a straight brake at 1.6 g the body pitches **+0.07°, nose UP** —
it does not dive at all.

Runs: [`2026-07-26-headless-before-infernus.json`](2026-07-26-headless-before-infernus.json) ·
[`2026-07-26-headless-before-admiral.json`](2026-07-26-headless-before-admiral.json) ·
[`2026-07-26-headless-before-firetruk.json`](2026-07-26-headless-before-firetruk.json).

### 2026-07-26 — comet, the car the user reported (a fourth set, same conditions)

Added at the user's request: *"measure the comet — constant flips and very fast."* Same pak, same commit,
same seven scenes. It earns its place in the record because it isolates the diagnosis: by the five fields the
engine READS, the comet is almost exactly an infernus (mass 1400, engineAccel 30, brakeDecel 11 — identical;
only maxVelocity differs, 200 vs 240). Everything it should differ by is unread.

**It spins under braking on a dead-straight road, with no steering input at all.** Slip is 0.00° for the
whole eight-second run-up; the brake goes on, and 1.7 s later the yaw rate is 48.5°/s and the slip angle 48°.
The lap ends **50.9° off its heading**, stopped sideways, having braked 32.3 m from 129.6 km/h (**1.93 g**,
the hardest of the four). The other three cars finish the same scene with slip 0.0 and turned 0.0.

It also goes over in the slalom (like the infernus) and takes the kerb far worse (roll −14.7…29.3° against
±3.5°), while doing a CLEAN 135° handbrake turn the infernus cannot (that one flips instead).

Run: [`2026-07-26-headless-before-comet.json`](2026-07-26-headless-before-comet.json).

### 2026-07-26 — step-steer: the missing transient, measured

The scene the matrix could not see (every other one is straight or at full lock). A gentle held input —
0.15 after a 3 s run-up — on its own LV straight, across all four cars. Same pak and commit as above.

| Car      | Step at   | **Yaw rise** | Settled yaw | Overshoot | Settled slip |
| -------- | --------: | -----------: | ----------: | --------: | -----------: |
| infernus |  77 km/h  |  **0.08 s**  |  13.91 °/s  |     1.05  |      0.91°   |
| admiral  |  36 km/h  |  **0.17 s**  |   7.48 °/s  |     1.06  |      1.01°   |
| firetruk |  69 km/h  |  **0.07 s**  |   8.10 °/s  |     1.04  |      0.75°   |
| comet    |  60 km/h  |  **0.15 s**  |  16.95 °/s  |     1.06  |      0.86°   |

Three findings in one table. **The response is 0.07-0.17 s** where a road car takes 0.3-0.5. **A 6.5-tonne
fire truck answers FASTER (0.07 s) than a 1.4-tonne supercar** — yaw inertia is not modelled, and the
authored `turnmass` (36 671 vs 2 725) is the field that would say so. **Settled slip is ~1° and overshoot
~1.05 for every car**: no slip builds, nothing oscillates, and all four differ only in magnitude, never in
shape. The raw series is blunter still — the yaw goes 0.00 → 11.38 °/s in ONE 50 ms sample.

Run: [`2026-07-26-headless-step-steer-four-cars.json`](2026-07-26-headless-step-steer-four-cars.json).

**Method note.** The steady window is 0.3-1.0 s after the step, not the tail of the hold: a held corner
leaves a two-lane street in about two seconds, and the v1 scene's tail was a kerb strike, a spin and a bounce
backwards. Measuring a car SLOWER than ~0.3 s properly needs an open-ground scene — owed, and flagged in
code by `settled: false` rather than silently under-reported.

### 2026-07-26 — AFTER the authored centre of mass (081/02, infernus + comet)

Same pak, same scenes, the only change being that the body takes its mass, centre of mass and inertia from
`handling.cfg` instead of from an equal share per collision primitive. Two decisive wins and two regressions
— the analysis is in the plan's ledger
([`../../plans/081-vehicle-physics/02-handling-truth.md`](../../plans/081-vehicle-physics/02-handling-truth.md)).

The comet's braking spin — the bug the user reported for that car — goes from **50.9° of unasked-for rotation
to 1.6°**, and the infernus u-turn from a 3.65 s flight with ±55° of roll to a corner (0.35 s, ±7°). The
flips do NOT go away: the slalom and the handbrake turn still roll through ±180°, and airborne cases got
worse. Braking also got sharper (1.6 → 2.0 g), which is a regression against the complaint and makes plan
04's brake formula more urgent.

Runs: [`2026-07-26-headless-com-infernus.json`](2026-07-26-headless-com-infernus.json) ·
[`2026-07-26-headless-com-comet.json`](2026-07-26-headless-com-comet.json).
