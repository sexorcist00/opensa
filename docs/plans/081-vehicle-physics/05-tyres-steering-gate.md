# 081/05 — Tyres + steering feel + THE GATE (own controller: go / no-go)

The chain's decision plan. Everything DRCVC's tyre scalars can express lands first; then the gate
measures whether that ceiling blocks the feel bar, and the own-controller call is made on numbers.

## 1. Traction mapping (inside DRCVC)

- `frictionSlip` per wheel from `tractionMult` (today: flat 10.5 for every car), split front/rear
  by `tractionBias`; `sideFrictionStiffness` scaled by the same pair — documented formulas, the
  same values an own controller would consume (controller-agnostic rule).
- `tractionLoss` engages where SA uses it: as the wet/offroad/surface scale hook. v1: a single
  surface factor from the collider the wheel ray hit (road vs grass/sand via collision material —
  IF the streamed colliders carry a usable material tag; if they don't, record that as a plan-07
  note and keep the global factor). No weather coupling yet (0.5.0 weather plan owns rain).
- With drive-type torque (plan 04) + per-axle grip, the classes should now separate: FWD pushes
  wide on power, RWD rotates. The slalom + a new `throttle-in-corner` scene quantify it.

## 2. Steering feel v2

- Keep the shipped rate-limit + speed-sensitive lock (they answered the 2026 complaint half-way);
  re-derive constants from handling `steeringLock` honestly (the 0.6 scale becomes a named factor)
  and make the speed falloff curve live-tunable.
- **Counter-steer assist** (toggleable, default ON — SA is arcade): when the body slip proxy
  exceeds a threshold with steering opposing the slide, widen the effective lock toward the slide
  and add a small self-aligning yaw torque — catches feel natural instead of pendulum spins.
- **Return-to-centre**: recenter rate scaled by speed (parking: lazy; highway: firm) — replaces the
  flat 2.4 rad/s.
- Keyboard reality check: A/D are digital; the rate limiter IS the analogue feel. Tune rates on the
  slalom replay (keyboard metronome input) — not against an imagined analogue stick (no gamepad
  path exists; 080 records the same scope cut).

## 3. THE GATE — measured verdict on DRCVC's tyre ceiling

Run after 1+2 are field-tuned. **Criteria (all from replays + the field round):**

| #   | Test                               | DRCVC passes if                                                           |
| --- | ---------------------------------- | ------------------------------------------------------------------------- |
| G1  | throttle-in-corner, RWD (Infernus) | breakaway is PROGRESSIVE (slip proxy ramps over ≥0.5 s, not a step)       |
| G2  | handbrake-turn                     | slide is holdable ≥1.5 s and recoverable without a spin ≥50 % of attempts |
| G3  | slalom at 80 % top speed           | no snap oversteer on direction change (yaw-rate spikes within band)       |
| G4  | user field verdict                 | "cornering breathes; slides are controllable" — the feel bar, in words    |

- **PASS** → DRCVC stays; the own-controller question closes for 081 (revisit only if 0.5.0
  vehicle types hit it again — bikes probably will).
- **FAIL** → build the own raycast controller as designed below; the chain's 02–04 systems carry
  over UNCHANGED (they are chassis forces + per-wheel parameters by construction).

### The own-controller design (pre-agreed shape, built only on FAIL)

Behind the SAME `PhysicsWorld` surface (`createDynamicVehicle` / `setVehicleControls` /
`updateVehicle` signatures unchanged; a per-car flag chooses the backend during bring-up):
Rapier dynamic body + per-wheel ray (later shapecast for kerbs); suspension = spring/damper from
the plan-02 per-car values; tyres = **3-segment slip curve** (linear grip → peak → sliding falloff)
on slip angle (lateral) + slip ratio (longitudinal), **combined via friction circle**, load-dependent
from suspension force; the plan-04 drivetrain feeds wheel torques directly (wheelspin becomes real).
~500 focused lines + the plan-01 telemetry already speaks its language. Quirks ledger items
seedReverse/phantom-speed die with it; parking brake + spawn lessons stay.

## Subtasks

- [ ] Traction mapping + per-wheel application + tests (bias split, surface factor path).
- [ ] `throttle-in-corner` scene + drive-type A/B captures (F vs R vs 4 on one chassis — synthetic
      handling rows make this a clean experiment).
- [ ] Steering v2 (named factors, counter-steer assist, speed recenter) + slalom retune + tests.
- [ ] Gate run: G1–G3 captured on the tuned build, G4 field round; **verdict + reasoning recorded
      here** (the decision record the 0.4.0 idea asked for, finally with data).
- [ ] If FAIL: own controller bring-up as its own ledger section (scenes re-run, quirk tests
      retired/kept explicitly).

## Acceptance

- Gate verdict recorded with the four criteria's numbers/verdicts; either path leaves the scene
  matrix green within bands and the field round accepted.
- FWD/RWD/4WD visibly distinct in captures and in the field.

## Ledger

_(traction formulas, steering factors, gate captures, THE VERDICT)_
