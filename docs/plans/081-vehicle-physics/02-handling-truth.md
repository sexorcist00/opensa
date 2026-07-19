# 081/02 — handling.cfg as the source of truth: mapping, COM, per-car suspension

The root-cause plan. Two of the three original complaints trace here: **cars flip easily because the
COM emerges high** (equal mass share across COL primitives incl. cabin boxes, `physics-world.ts:700`;
authored `CentreOfMass` unread), and every car drives the same because **35 of 40 handling fields are
ignored**.

## 1. The typed mapping table (written once, unit-tested, never re-derived)

Extend `VehicleHandling` (today 5 fields, `world-adapter.interface.ts:19-31`) to the full set the
chain consumes, with explicit unit conversions documented per field (SA community docs + the column
legend already in `tests/original/data/handling.cfg:24-84`):

| handling column                                       | → typed field                                          | Unit conversion                                              | Consumed by    |
| ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ | -------------- |
| fMass                                                 | `mass` (kg)                                            | as-is (already mapped)                                       | body           |
| fTurnMass                                             | `turnMass` (kg·m²)                                     | as-is → yaw inertia                                          | this plan      |
| fDragMult                                             | `dragMult`                                             | → linear damping term (documented factor)                    | plan 04        |
| CentreOfMass x,y,z                                    | `centreOfMass` (m, model)                              | model space: x=right, y=forward, z=up (GTA frame)            | this plan      |
| fTractionMultiplier / Loss / Bias                     | `traction{Mult,Loss,Bias}`                             | dimensionless; bias 0..1 front share                         | plan 05        |
| nNumberOfGears / fMaxVelocity                         | `gears`, `maxVelocity` (m/s)                           | **km/h ÷ 3.6** (today's `maxVelocity*0.25` hides this)       | plan 04        |
| fEngineAcceleration / nDriveType / EngineInertia      | `engineAccel`, `drive: 'F'\|'R'\|'4'`, `engineInertia` | accel as-is (m/s²); drive char                               | plan 04        |
| fBrakeDeceleration / fBrakeBias / bABS                | `brakeDecel`, `brakeBias`, `abs`                       | decel m/s²; bias 0..1 front share                            | plan 04        |
| fSteeringLock                                         | `steeringLock` (rad)                                   | degrees → rad (already mapped)                               | plan 05        |
| fSuspensionForceLevel / DampingLevel / HighSpdComDamp | `susp{Force,Damping,HighSpeedDamp}`                    | dimensionless levels → stiffness/damping scales (documented) | this plan      |
| Suspension upper / lower limit                        | `suspUpper`, `suspLower` (m)                           | metres → rest length + travel                                | this plan      |
| fSuspensionBias / AntiDiveMultiplier                  | `suspBias`, `antiDive`                                 | bias 0..1 front; anti-dive 0..1                              | this plan / 03 |
| fCollisionDamageMultiplier                            | `collisionDamageMult`                                  | → damage system (today's fixed thresholds scale)             | plan 07 note   |

- Parser stays raw-string (`handling.parser.ts` untouched); the adapter's `vehicleHandling()` grows
  the mapping + fallback row. Unit tests pin LANDSTAL, ADMIRAL, INFERNUS full rows against
  `tests/original/data/handling.cfg` (the real-fixtures rule).
- Fields deliberately NOT consumed by the chain get a one-line "why" here (nPercentSubmerged — no
  water physics; monetary/light/anim columns — other systems).

## 2. Centre of mass + inertia (THE flip fix)

- Apply authored COM: convert handling's model-space `CentreOfMass` (GTA: y forward, z up — same
  frame the chassis already uses) and set it as the body's mass properties:
  `setAdditionalMassProperties(mass, com, principalInertia, identity)` with collider densities
  zeroed (colliders keep SHAPE for contacts; mass properties become fully authored). Principal
  inertia: yaw from `turnMass`; pitch/roll from a box model on the chassis half-extents scaled to
  `turnMass` (document the formula; SA only ships yaw inertia).
- Telemetry A/B (plan-01 scenes, before/after): slalom roll angle and u-turn/flip behaviour must
  drop visibly; brake pitch changes sign only in plan 03 (COM alone helps but anti-dive finishes).
- **Then re-tune down `CHASSIS_ANGULAR_DAMPING` (2 → target ≤0.5)** — it was the band-aid for the
  high COM and it currently deadens legitimate body motion (part of why nothing feels alive). The
  stability that damping faked comes back honestly in plan 03.
- Watch the quirks ledger: parking brake hold, spawn pitch/slide, `holdBody` during enter/exit —
  re-run their tests with authored COM (a low COM changes rest attitude on slopes).

## 3. Per-car suspension

Replace the five shared suspension constants with handling-derived per-wheel values at
`createDynamicVehicle` time: rest length + travel from upper/lower limits, stiffness from force
level (mass-normalised — document), compression/rebound from damping level (keep the ratio lesson:
compression raised to damp the launch hop), front/rear split from `suspBias`,
`suspensionHighSpeedDamp` noted for plan 03. Wheels keep model-measured radius.

- Expected field outcome: firetruck stops wallowing like a sedan; Infernus sits stiff. The
  brake-strip and kerb scenes quantify it (pitch amplitude, settle time, no launch-hop regression —
  the compression=12 lesson stays honored via the mapping's floor).

## 4. Control-latency fix (small, here because 03–05 tune against it)

`drive()` currently writes controls AFTER the step consumed them (one-step latency,
`engine-canvas-host.tsx:708-719` + `physics.step` order). Split control application out of
`EnterVehicleSystem.fixedUpdate`: compute+apply controls via a pre-step hook (`physics.step` gains
an optional callback before `updateVehicle`), keep the state machine post-step where it reads
results. Verify by test (controls visible to the same step) and confirm no behavioural regression
in the enter/exit suite; capture steering-response delta in the slalom replay (expected small but
free).

## Subtasks

- [ ] Typed mapping + conversions + 3 pinned-row tests; fallback row documented.
- [ ] COM/inertia application + angular-damping retune + quirk-suite re-run.
- [ ] Per-car suspension mapping + spawn/settle re-verification (bench road cars still sit right —
      the 841-car sweep spots systemic suspension errors for free).
- [ ] Pre-step control hook + latency test.
- [ ] Replay A/B captures (3 cars × brake/slalom/u-turn/kerb) into the ledger.
- [ ] **Field round**: the flip complaint specifically — aggressive city driving, the user tries to
      flip a sedan honestly; plus "do different cars feel different now".

## Acceptance

- Slalom/u-turn: no flip at sane speeds on the trio; roll angle down vs baseline (numbers in ledger).
- Three cars measurably distinct in brake-strip + slalom captures.
- Angular damping ≤0.5 with stability not worse than baseline (03 finishes the job).
- Suite green incl. quirks ledger tests; bench road-car sweep unchanged.

## Ledger

_(mapping decisions, conversion factors, A/B numbers, field verdict)_
