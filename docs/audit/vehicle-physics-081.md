# Audit — vehicle driving physics (plan 081/01–05), 2026-07-26

The chain that turned `handling.cfg` from a file we parsed into the file the cars are driven by. Five
sub-plans, seven field rounds in one day, every change measured on the same replays.

Raw numbers: [`../benchmarks/vehicle-physics/`](../benchmarks/vehicle-physics/) (schema + full chronology).
Per-decision reasoning: each sub-plan's ledger in [`../plans/081-vehicle-physics/`](../plans/081-vehicle-physics/).

## What changed

`handling.cfg` had **5 of ~40 fields** consumed. It now has **21**, and every one of them arrived as a
translation of the original's own code rather than as a fitted curve:

| Field(s)                                     | What now reads them                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `CentreOfMass`, `fTurnMass`                   | body mass properties, and the static load each corner carries             |
| `fSuspensionForceLevel/Bias/UpperLimit/LowerLimit/DampingLevel` | the spring, per axle, by SA's own law                    |
| `nNumberOfGears`, `fMaxVelocity`, `fEngineAcceleration`, `fEngineInertia`, `nDriveType` | the gearbox      |
| `fDragMult`                                   | air drag — and therefore the top speed, which is now emergent             |
| `fBrakeDeceleration`, `fBrakeBias`            | the foot brake, split across the axles                                    |
| `fTractionMultiplier/Bias/Loss`               | tyre grip per wheel, per axle, and what a sliding tyre keeps of it        |
| `fSteeringLock`                               | the steering limiter, against the tyres rather than a tuned falloff       |

Six global constants died: `ENGINE_ACCEL_SCALE`, `MAXVEL_SCALE`, `REVERSE_FRACTION`, `ENGINE_RAMP_TIME`,
`STEER_LOCK_SCALE`, `STEER_SPEED_FALLOFF`. Two more were replaced by their measured or authored originals
(`WHEEL_FRICTION_SLIP 10.5` → `fTractionMultiplier`; `CHASSIS_ANGULAR_DAMPING 2` → SA's own 0.5).

Three new modules, all pure and unit-tested: `vehicle/drivetrain.ts` (`cTransmission`, line for line),
`vehicle/steering.ts` (the original's speed-sensitive lock limiter), and the `stance` block in the capture
protocol (what a car is standing on).

## What it cost

- **Tests**: 2 810 → 2 819 green, no suite slower.
- **Runtime**: no new per-frame allocation on the driving path; the drivetrain is arithmetic on ~10 numbers
  per step, the grip clamp four reads and four writes per car, both inside the existing fixed step. The
  per-step budget the plan set (≤ 0.5 ms for 8 live cars) is **not yet isolated** — owed at plan 07.
- **Code**: `enter-vehicle.system.ts` grew a drivetrain state and lost three branches; the rest landed in the
  two new modules and in `setVehicleControls`, which is now the one place where per-wheel forces are decided.

## What it bought, in numbers

| Behaviour                              | Before        | After                            |
| -------------------------------------- | ------------- | -------------------------------- |
| Admiral launch (a 1976 sedan)          | 1.00 g        | **0.37 g**                       |
| Firetruck launch                       | 1.86 g        | 0.35 g                           |
| Cars separating at all (0–100 km/h)    | 3.9…5.4 s     | 2.3 s … never (per car's row)    |
| Top speed                              | clamped       | **emergent** (infernus ~228 of an authored 240 km/h) |
| Braking                                | up to 2.4 g   | 0.58…1.14 g, grip-limited        |
| Coasting off-throttle                  | 0.27 m/s²     | ~6 m/s² (the original's own)     |
| Romero rake (a rear-heavy hearse)      | **+1.67°**    | +0.09°                           |
| Cornering yaw (u-turn, admiral)        | 36.9° round   | 49.2° round                      |
| Handbrake flick (admiral body slip)    | n/a           | 2.3° → **33.0°**                 |

## The five bugs the field found, and what they had in common

Every one was **a number this engine had guessed where the game ships the answer**:

1. `WHEEL_FRICTION_SLIP = 10.5` — Bullet's demo default, a tyre fifteen times grippier than a tyre.
2. `ROAD_ADHESION = 1` — `data/surface.dat` says 4.5 for rubber on road, so cars had 4.5× too little steering.
3. `sag = 2 / stiffness` — assumed every corner carries a quarter of the car; a hearse's rear carries 71 %.
4. `CHASSIS_ANGULAR_DAMPING = 2` — left 14 % of a car's yaw after a second; three field rounds blamed grip.
5. The handbrake's rear lock, faithful to the original and inert — because Rapier's friction circle weighs
   braking at half and cornering at full, so a locked wheel keeps 87 % of its lateral bite.

The first four are the same mistake. The fifth is a different one and the more interesting: **a faithful
translation can be inert if the host solver does not express the quantity it relies on.**

## What the chain owes

- **06 kerb probe** — the comet flips on kerbs since the damping band-aid came off (20.6° of roll → 179°).
  A raycast wheel cannot see a vertical kerb face until its centre crosses the edge. Do NOT re-raise the
  damping instead: that trades the whole fleet's cornering for one car's kerb.
- **06 visible suspension** — the wheels still do not move in their arches.
- **07** — the per-step cost measurement, the regression pack, and the class presets.
- Read `surface.dat`/`surfinfo.dat` instead of carrying 4.5; `abs`; gear-dependent engine braking; the
  firetruck's brake residual; the sag-per-rate constant (a measured bridge, ±7 %).
