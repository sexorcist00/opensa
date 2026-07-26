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
  // What the run was CONFIGURED with, PER WHEEL (stiffness, damping, travel, rest length, force cap). It
  // recorded one wheel until 2026-07-26, when the authored axle bias gave the two axles different springs —
  // and a savanna capture showed wheel 0 is not reliably the front one either (the order follows the
  // model's own dummy frames). A capture that cannot say what it was configured with proves nothing.
  "springs": [{ "stiffness": 25, "travel": 0.25 /* … */ }],
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

### 2026-07-26 — angular damping 2 → 0.5, and back (081/02)

The band-aid dropped to 0.5 on both flipping cars, to decide from data whether plan 02's retirement of it
should ship. It should not, and the runs are kept because the REASON is the interesting part: the braking
dive does not change at all between the two values (0.15° either way — the suspension suppresses it, not the
damping), while impact flips get worse. Checking every flip against the vertical g before it showed that none
of them is a cornering flip: three follow impacts of 24-31 g, two happen at walking pace on an
already-destabilised car.

Runs: [`2026-07-26-headless-damping05-infernus.json`](2026-07-26-headless-damping05-infernus.json) ·
[`2026-07-26-headless-damping05-comet.json`](2026-07-26-headless-damping05-comet.json).

### 2026-07-26 — AFTER 081/02 (authored mass properties + per-car springs), all four cars

The chain's first real improvement, measured against the BEFORE matrix on the same pak and scenes.
**Four of the five flips in the record are gone** — comet and firetruck slalom, firetruck crest landing,
infernus handbrake turn — with roll maxima collapsing from 180°/113.8°/99.7°/180° to 23.9°/11.9°/6.8°/3.0°.
The one survivor (infernus slalom) halved. The chassis angular damping was NOT touched: what changed is that
the mass sits where the car was designed to carry it and each car rides its own springs.

The body also starts moving under braking (comet 0.25° → 0.45° of dive on the strip, 6.8° → 20.9° in the
handbrake turn) and braking distance is finally per-car in both directions (admiral 23.7 → 28.5 m, comet
32.3 → 24.8 m). Captures carry a `springs` block from this run on — what the run was configured with.

Runs: `2026-07-26-headless-after02-{infernus,comet,admiral,firetruk}.json`.

### 2026-07-26 — the spring, re-expressed as the ORIGINAL writes it (081/03)

A clean A/B on the same head, the same pak and the same scenes, changing ONE thing: how the spring rate is
derived. Before, the rate was a fitted constant scaled by the authored force level, with a fitted sag target,
a fitted sag-of-travel floor and two fitted damping clamps. After, it is SA's own law —
`springForce = (1 − normalisedCompression) × mass × fSuspensionForceLevel × 0.016 × dt × bias` — which, once
the normalisation to the car's own travel is carried through, says `rate ∝ forceLevel / travel`. One bridging
constant survives (`SUSPENSION_LEVEL_SCALE = 5.2`, absorbing SA's `0.016` and Rapier's internal factor), plus
a bump stop, because SA has one and this engine does not.

The `pedalbase` runs are the baseline — the committed state, recaptured, because the older `softspring`
numbers predate the foot-brake pedal and their braking distances are not comparable.

| car      | rate         | static sag         | dive under brake   | brake distance |
| -------- | ------------ | ------------------ | ------------------ | -------------- |
| infernus | 37.1 → 25.0  | 5.4 → 8.0 cm (32 %) | −0.48° → **−0.71°** | 96.1 → 96.1 m  |
| comet    | 57.1 → 57.1  | 3.5 cm (35 %, stop) | −1.05° → −1.05°    | 38.5 → 38.5 m  |
| admiral  | 28.7 → 26.0  | 7.0 → 7.7 cm (35 %) | −0.95° → −1.01°    | 50.5 → 50.5 m  |
| firetruk | 37.1 → 13.3  | 5.4 → 15.1 cm (32 %)| −0.50° → **−1.41°** | 90.7 → 90.7 m  |

Two things to read here. **Braking is bit-identical** on every car — the spring does not touch grip, so the
change is isolated to the body's motion, which is what makes this a trustworthy A/B. And the **firetruck** is
where the old fitted rate was most wrong: it rode at 11 % of its authored travel and pitched half a degree
under a full stop; on its own law it uses 32 % and dives 1.4°, nearly three times as much. The comet is
unchanged because it was, and still is, held by the bump stop — its authored level (0.64) over its 10 cm of
travel asks for 52 % sag.

`rest` re-run on all four with the new law: zero airborne time, zero tremor, static attitude only
(admiral −0.58° pitch / +0.11° roll is the road, not the car).

Runs: `2026-07-26-headless-pedalbase-{infernus,comet,admiral,firetruk}.json` (baseline) ·
`2026-07-26-headless-salaw-{infernus,comet,admiral,firetruk}.json` (after, `brake-strip` + `rest`).

### 2026-07-26 — the drivetrain: gears, drive type and air drag (081/04)

The longitudinal model was one constant force (`mass × engineAccel × 0.28`) against a hard speed cap. The
original's is a gearbox plus air drag, and it is short enough to translate line for line
(`cTransmission::InitGearRatios`, `CalculateDriveAcceleration`, `CPhysical::ApplyAirResistance`). Baseline is
the `kmh` state — the SA-law spring with `fMaxVelocity` read as km/h, i.e. everything except the gearbox.

| car      | 0-100 km/h    | speed at 8 s WOT | peak accel g |
| -------- | ------------- | ---------------- | ------------ |
| infernus | 3.98 → 4.05 s | 165.7 → 124.1    | 0.85 → 1.07  |
| comet    | 5.43 → 2.30 s | 130.0 → 179.1    | 0.66 → 1.65  |
| admiral  | never → 5.27 s | 77.3 → 104.8    | 0.40 → 1.00  |
| firetruk | 4.53 → 3.12 s | 149.0 → 130.1    | 0.76 → 1.86  |

Read it as the cars separating. Before, one number scaled by `engineAccel` gave four cars the same shape of
acceleration; now first gear pulls four times what top gear pulls, so every car launches hard and tails off
at its own rate. The **admiral** could not reach 100 km/h in the old model at all and now does it in 5.3 s.
The **comet** (a mod with a 296 km/h row and the lowest drag in the set, 0.93) becomes the rocket its owner
describes. The **infernus** loses top-end because it is 4WD and the original divides the engine by 4 for
four-wheel drive against 2 for everything else — its 0-100 is unchanged, its 8-second speed is not.

Braking distances in the same runs are not comparable across the A/B: the cars now arrive at the braking
point at different speeds. Dive is unchanged (−0.71 → −0.67, −1.41 → −1.31 …), which is the expected
non-result — the spring did not move.

**The firetruck's 1.86 g launch is the honest reading of a row that authors 27 m/s² of engine, and it is
also a warning**: nothing is limiting it but a shared tyre-grip constant. That is plan 05's subject.

Top speed is now EMERGENT: drag rises with v² until it matches what the top gear pulls. The infernus balances
at ~228 km/h against an authored 240; the comet's mod row balances above its own gear ceiling and is held
there. Nothing is clamped to `fMaxVelocity` anywhere.

`pull-away-reverse` and `crest-jump` re-run on infernus and firetruck: launch clean, reverse reaches the
original's `−0.3 × top` limit, 1.28 s of air over the crest with no flip.

Runs: `2026-07-26-headless-drivetrain-{infernus,comet,admiral,firetruk}.json`.

### 2026-07-26 — the authored axle bias reaches the springs (081/03)

`fSuspensionBias` was parsed and ignored. The original turns it into a factor of `2 × bias` on the front
springs and `2 − 2 × bias` on the rear (`CAutomobile::ProcessCarWheelPair`), and that is now what happens.

Nothing moved on the calibration trio, and that is the point: all four reference cars author a neutral 0.5,
and the infernus `brake-strip` came back **bit-identical** to the run before the change (stiffness 25.0, dive
−0.67°, top 124.1 km/h, brake 52.7 m). Of the shipped table's ~220 rows, 130 are neutral and about 90 are
not, so this is a change that only speaks when a row asks it to.

The savanna (bias 0.3, a rear-leaning lowrider) is the demonstration: front springs 19.05, rear 24.27 —
and its front is at the **bump stop**, because 0.6 × its authored force over 0.30 m of travel would sag past
what the floor allows. So a strong bias is partly absorbed by the stop, which is the floor doing its job: a
car cannot be biased into standing on its stops. Both regimes are pinned by tests.

Two things noted rather than fixed: the shipped table contains bias 0.0 and 2.0 rows (zero and NEGATIVE
rates) — all of them boats and aircraft, none of which reach a raycast car, and the floor would catch them
anyway. And the savanna's dive reads **+0.65° (nose UP)** where the trio reads ≈ −0.7°; with the softer front
that is backwards, and the suspect is the brake split, which is still equal across the axles while
`fBrakeBias` sits unread (plan 04 §3).

Runs: `2026-07-26-headless-bias-savanna.json` (+ the infernus null-result alongside it).

### 2026-07-26 — the tyre gets its authored grip, and the fleet stops being a slot car (081/05, early)

**Field verdict that forced this** (user, on the drivetrain build): *"launches are very violent on both cars —
a 1976 Mercedes should be heavy and smooth and instead it rips away, barely slower than the sports car; the
cars have become hard to control from the speed and the lightness, they fly like aeroplanes; a kerb at speed
launches us into a flip. It feels like something is missing."* All three are one missing number.

`WHEEL_FRICTION_SLIP` was **10.5** — Bullet's raycast-vehicle demo default, and a friction coefficient
fifteen times a real tyre's. `fTractionMultiplier` is that same coefficient and the shipped table gives cars
**0.55…0.75**, which is what a tyre actually does. Everything the 10.5 touched was wrong in one direction: a
car turned in the instant the wheel moved, never slid, put every newton of engine straight into the road, and
tripped over kerbs instead of sliding along them.

Two things had to land together:

1. **Grip per wheel from `fTractionMultiplier`**, split across the axles by `fTractionBias` in the original's
   own `2 × bias` / `2 − 2 × bias` form.
2. **The clamp itself, applied on our side.** Rapier computes the friction limit `μ × suspensionForce × dt`
   and a `skid_info` factor — and then applies it only `if wheel.side_impulse != 0.0`. A car accelerating or
   braking DEAD AHEAD therefore has no longitudinal grip limit whatsoever, and eats any force it is handed.
   That is a Bullet inheritance and it is why the fleet launched at 5 g. The original clamps in exactly this
   place (`CVehicle::ProcessWheel`), so the model is SA's; only the location is ours.

Engine force also reaches DRIVEN wheels only now (`nDriveType`), which is what the drive-type divisor was
always for: engine ÷ 4 pushed by four wheels and engine ÷ 2 pushed by two come to the same total.

| car      | drive | μ    | launch g      | brake g       | 0-100 km/h    |
| -------- | ----- | ---- | ------------- | ------------- | ------------- |
| infernus | 4     | 0.70 | 1.07 → **0.70** | 1.33 → 1.14 | 4.05 → 5.40 s |
| comet    | R     | 0.67 | 1.65 → **0.43** | 2.39 → 0.92 | 2.30 → never  |
| admiral  | R     | 0.70 | 1.00 → **0.37** | 0.71 → 0.58 | 5.27 → never  |
| firetruk | R     | 0.55 | 1.86 → **0.35** | 1.36 → 0.80 | 3.12 → never  |

The infernus lands exactly on its coefficient (4WD, all four wheels pushing, 0.70 g = μ); the rear-drive cars
land near half of theirs, because a rear axle only carries about half the car. **These are real cars' numbers**
— and they agree with the original: running SA's own adhesion formula by hand for the admiral
(`adhesiveLimit × fTractionMultiplier × 2.5 × suspension term`, two driven wheels) gives ≈ 0.4 g against our
measured 0.37.

**Field verdict on THIS build** (user): *"significantly better — we pull away well at low speed, gather speed,
you feel the weight of the car, you feel the power. The best result so far. One flaw: it is now hard to turn
into a corner at speed — as if the car has been made too heavy."* That last one is the next item: the
steering still carries two FITTED constants (0.6 of the authored lock, falling by another 0.6 toward top
speed) that were tuned when grip was infinite, and they now stack on top of a real tyre.

Runs: `2026-07-26-headless-tyregrip-{infernus,comet,admiral,firetruk}.json`.
