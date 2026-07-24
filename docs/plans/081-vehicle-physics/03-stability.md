# 081/03 — Stability forces: anti-roll, anti-dive/squat, downforce, stabiliser

The plan that replaces the global `CHASSIS_ANGULAR_DAMPING` band-aid with the real mechanisms, and
directly kills the remaining loud complaint: **braking must dip the nose, not lift it.**

All four systems are **chassis-level external forces** computed from telemetry-grade signals the
controller already exposes (wheel compression, contact, load) and applied via
`applyImpulseAtPoint`/`applyTorqueImpulse` per fixed step — controller-agnostic by construction
(the readme's architecture rule). They live in a new `packages/game/src/vehicle/stability.ts`
(pure force calculators, unit-tested) driven from the vehicle fixed update.

## 1. Anti-roll bars (per axle)

- Per axle: `F = k_arb × (compressionLeft − compressionRight)` applied down on the more-extended
  side's connection point and up on the other (equal/opposite) — the textbook bar. Compression from
  `wheelSuspensionLength` vs rest (plan-01 signal). Airborne wheel ⇒ that axle's bar contributes 0.
- `k_arb` derived from handling: proportional to suspension force level × mass share per axle
  (`suspBias`), with a front/rear ratio knob — front-biased bars understeer (safe default), tunable
  per class in plan 07. Documented formula, live-tunable in the F2 Physics tab.
- Acceptance signal: slalom roll amplitude at the plan-02 baseline speed drops to a target band
  (set from the field round, recorded); flips require deliberate abuse (kerb + full lock at speed).

## 2. Anti-dive / anti-squat (the nose fix)

- Physical cause of the reported nose-LIFT: brake force is applied by the controller at wheel
  contact along −Y while the COM sits above → pitch-back torque; with the old high COM and soft
  shared suspension the rear compressed MORE than the front → visual nose-up. Plans 02 (COM,
  per-car suspension) reduce it; this system finishes it the way SA's own `fSuspensionAntiDiveMultiplier`
  intends:
- Pitch-compensation torque: `T = antiDive × brakeForceApplied × h_com` opposing the brake pitch
  moment (and the mirrored `antiSquat × driveForce` for launch squat — keep a LITTLE squat, it
  reads as power). `antiDive` from handling (0 for many cars — then plan-02 physics alone must
  look right; the multiplier only ASSISTS).
- Acceptance: brake-strip capture shows **pitch sign = nose DOWN** with a magnitude band (~1–3°
  sedan, tighter for sports), settle without porpoising.

## 3. Downforce

- `F_down = c × dragMult-agnostic area proxy × v²` applied at COM height, clamped; SA vanilla has a
  per-vehicle down-force factor semantically inside its handling flags/engine — we use a simple
  speed² term with a per-class constant (sports > sedan > truck), field-tuned. Purpose: highway
  stability + jump attitude, NOT lap-time realism.
- Guard: downforce must not crush per-car suspension onto the bump stops at top speed (check
  compression fraction in the brake-strip capture's top-speed segment; `suspensionHighSpeedDamp`
  from plan 02 is the companion knob).

## 4. Arcade roll stabiliser (the SA safety net)

- Above a roll-RATE threshold: a small opposing roll torque (vanilla SA does this too). This is the
  honest, scoped replacement for the global angular damping: it acts only on fast roll, leaves
  pitch/yaw/slow body motion alive. Threshold + gain live-tunable; OFF below threshold so normal
  cornering roll is untouched.
- With 1–4 in place, drop `CHASSIS_ANGULAR_DAMPING` to its plan-02 target (≤0.5) and re-run the
  whole scene matrix — this is the moment the band-aid actually comes off.

## Subtasks

- [ ] `stability.ts`: four pure calculators + application order (bars → anti-dive → downforce →
      stabiliser) + unit tests on scripted wheel states (bar zero when airborne, torque signs,
      clamps).
- [ ] Wire into vehicle fixed update (post plan-02 pre-step hook, before `updateVehicle` consumes).
- [ ] F2 Physics tab: live gains per system + per-system enable toggles (in-session A/B).
- [ ] Replay A/B: slalom/u-turn/brake-strip/kerb/crest, trio of cars; ledger the roll/pitch bands.
- [ ] **Field round**: brake feel ("nose dips"), flip resistance, highway stability, jump behaviour.
      Freeze gains.

## Acceptance

- Brake-strip: nose-down pitch on all three reference cars (the 2026-07-12 complaint closed with a
  number and a field verdict).
- Slalom/u-turn at plan-01 speeds: zero flips; deliberate-abuse flip still possible (it's SA).
- Angular damping at target; scene matrix regressions none (tolerance bands).
- Fixed-step cost of all four systems ≤ 0.05 ms for the player car.

## Ledger

_(gains, formulas as shipped, A/B numbers, field verdict)_
