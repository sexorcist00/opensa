# 081/04 — Drivetrain + brakes: gears, drive type, engine braking, brake bias, the SA handbrake

Today's longitudinal model is one scaled force (`engineForce = mass × engineAccel × 0.28`, top speed
`= maxVelocity × 0.25`, brake `= 480 × decel/8.5` — `enter-vehicle.system.ts:80-103,381-440`) split
equally over 4 wheels. It moves the car; it has no character. This plan gives every car its
handling-authored longitudinal identity.

## 1. Gears + force curve

- Per-gear model from handling: `gears` (nNumberOfGears) split `[0, maxVelocity]` (now honestly in
  m/s — km/h÷3.6 from plan 02) into SA-style bands; wheel force per gear =
  `mass × engineAccel × gearFactor × (1 − (v/vGearTop)^k)` — a documented arcade curve, NOT a
  torque-map simulation. Gear shifts introduce a short force dip (~120 ms) — the "breathing" that
  makes acceleration read as mechanical. `engineInertia` scales the dip + the ramp time (replacing
  the flat `ENGINE_RAMP_TIME 0.2`).
- The `MAXVEL_SCALE 0.25` / `MIN_TOP_SPEED 8` hacks die; their honest replacements are the unit fix
  plus a documented global "city scale" factor if raw SA top speeds prove too fast for the map in
  the field round (record the factor, don't hide it in a magic 0.25).
- Current gear exposed on telemetry (plan-01 HUD gear readout goes live).

## 2. Drive type F / R / 4

- `setVehicleControls` splits engine force by `drive`: F → front pair, R → rear pair, 4 → all
  (per-wheel engine force is already the API shape). Behaviour difference arrives with plan 05's
  traction mapping (FWD understeer on power / RWD power-oversteer need per-wheel grip, not just
  torque placement) — but the torque placement lands here and is testable now (burnout scene:
  driven-axle slip proxy rises first).

## 3. Brakes: bias + engine braking + coast

- Brake force distributed by `brakeBias` (front share) instead of the equal split; total from
  `brakeDecel × mass` (honest units — the 480-N constant dies). `abs` flag = keep today's behaviour
  (no lockup model exists to modulate; note for the plan-05 gate: a slip-based ABS only makes sense
  with an own tyre model).
- Engine braking: off-throttle in gear = drag force scaled by gear (low gear brakes harder),
  replacing the flat 8 % `IDLE_BRAKE_FRACTION`; plus `dragMult` as the always-on rolling/air term
  (plan-02 mapping).
- Reverse rework: keep the `seedReverse` quirk (documented DRCVC limitation) but drive reverse
  through the same force curve at `REVERSE_FRACTION` of gear-1 (today's 0.4 stays as the arcade
  factor), and fix the throttle<0 semantics split (brake-vs-reverse threshold 0.6 m/s stays,
  test-pinned).

## 4. Handbrake = the SA slide (rear grip cut)

- Space while driving: **rear wheels only** get high brake torque AND their
  `sideFrictionStiffness` drops (×~0.35, live-tunable) for the hold duration + a short release
  fade (~0.3 s) — this is the SA handbrake turn, expressible entirely inside DRCVC's per-wheel API.
  Front wheels keep steering grip: the car rotates around the front axle instead of just stopping.
- The parked/stopping behaviour (full-stop hold, parking brake 80) is untouched — handbrake-as-
  stopper below ~3 m/s degrades to today's behaviour so parking feel doesn't change.
- Acceptance: `handbrake-turn` replay rotates the car through a held, recoverable slide (target
  band from the user's vanilla expectation notes, plan 01); 080/05's drift framing gets its first
  real workout here.

## Subtasks

- [ ] Force-curve module (`drivetrain.ts`, pure: gear state + per-wheel forces from handling +
      controls) + unit tests (gear bands, shift dip, engine braking by gear, drive-type split,
      reverse path).
- [ ] Brake distribution + engine brake + dragMult wiring; delete the four dead constants.
- [ ] Handbrake rear-cut + release fade + parking degradation; quirk tests re-run.
- [ ] Telemetry: gear + per-wheel drive force channels; F2 rows.
- [ ] Replays: `pull-away+reverse`, `brake-strip`, `handbrake-turn`, plus a new `hill-start`
      scene (engine braking + drag visible on a grade); trio A/B into the ledger.
- [ ] **Field round**: acceleration character per car ("firetruck is a barge, Infernus pulls"),
      handbrake turns, hill behaviour, top-speed sanity on the map (decide the city-scale factor).

## Acceptance

- Time-to-top-speed and brake distance per car match handling-derived expectations (table in
  ledger); the trio's longitudinal captures are clearly distinct.
- Handbrake turn = held rotation + recovery (field verdict), parking unchanged (tests).
- No dead tuning constants left in `enter-vehicle.system.ts` — everything traces to handling or a
  named arcade factor.

## Ledger

_(curve constants, city-scale decision, A/B numbers, field verdict)_
