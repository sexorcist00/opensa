# 081/01 — Telemetry harness + scripted test track (the BEFORE baseline)

**Nothing in 02–06 gets tuned blind.** This plan builds the instruments, the repeatable driving
scenarios, and captures the CURRENT feel as data — the "before" every later ledger compares against.

## 1. Telemetry channel

A per-fixed-step sampler for the active (player-seated) vehicle, assembled from what Rapier + the
controller already expose — no physics changes:

| Signal                | Source                                                                      |
| --------------------- | --------------------------------------------------------------------------- |
| speed (signed), v3    | body linvel + heading projection (the `drive()` math, extracted)            |
| per-wheel: in contact | `wheelIsInContact(i)`                                                       |
| per-wheel: suspension | `wheelSuspensionLength(i)` → compression fraction of travel                 |
| per-wheel: susp force | `wheelSuspensionForce(i)` → normal load                                     |
| slip proxy (lateral)  | angle(planar velocity, body forward) — body-level; per-axle later if needed |
| slip proxy (long.)    | wheel-roll speed (from `VehicleRig` distance) vs ground speed               |
| body roll / pitch     | from body quaternion vs heading frame                                       |
| g-forces              | Δlinvel / dt, projected into body frame                                     |
| steer angle, controls | the values `drive()` actually applied this step                             |

- Implementation: `packages/game/src/vehicle/vehicle-telemetry.ts` — a pure sampler
  `sample(physics, controller, body) → TelemetryFrame`, ring buffer of the last N seconds. Runs
  only when enabled (debug/capture) — zero steady-state cost when off.
- **The slip proxy is the signal 080/05 (camera drift framing) will consume** — export it on the
  vehicles facade (`EngineVehicles`), not just into the HUD.

## 2. F2 Physics tab (live view + live tuning seam)

- New debug screen (capabilities system, plan 22 infra): live strips for the table above — per-wheel
  load/compression bars, slip dial, roll/pitch, g-meter, speed/gear (gear from plan 04 on).
- The same tab hosts **live-patchable physics constants** group-by-group as plans 02–06 land (the
  080 pattern: tune in-session, freeze into config). This plan ships the seam + the current shared
  constants (suspension four, friction slip, damping pair) as read-only rows first.

## 3. Scripted test track (replays)

Deterministic scenario runner, same philosophy as the render bench (`[bench]` protocol):

- **`ScriptedDriveSource` implements `InputState`** — a timeline of `{t, move, actions}` keyframes;
  the vehicle systems consume it unchanged (interface already narrow: `move()/isActive()`).
- Scenario = spawn spec (model, position, heading — real map locations, teleport + collision-cell
  settle via the existing defer-until-collision lesson) + input timeline + capture length.
- **Scenes v1** (each ~10–20 s, chosen on flat/known map spots):
  `brake-strip` (LS airport runway: WOT to top speed, full brake) · `slalom` (runway, metronome
  steering at fixed speed) · `u-turn` (180° at moderate speed) · `kerb-strike` (curb mount at an
  angle, docks) · `crest-jump` (a known hill crest at speed) · `handbrake-turn` (WOT, Space + full
  lock) · `pull-away+reverse` (from rest, incl. the seedReverse path).
- Runner rides the standalone/host page with a query param (`?phys=<scene>&car=<model>`), captures
  telemetry frames, prints **`[phys] {json}`** (the `[bench]` twin) → headless harness
  (`tools-debug/bench-harness/`) can run the whole matrix in Chrome unattended.
- Determinism check: run each scene twice in one session — frames must match within float noise
  (Rapier same-build determinism); a `phys-compare.ts` (bench-compare twin) diffs captures with
  per-signal tolerance bands (consumed by plan 07's regression pack).

## 4. BEFORE baselines + vanilla expectations

- Capture the full scene matrix × 3 reference cars (**infernus / admiral / firetruck** — sports,
  sedan, heavy; the idea doc's calibration trio) on the CURRENT physics. Store JSONs under the plan
  (small; they are the chain's "before" exhibit) + summary numbers in the ledger: peak body pitch
  under braking (sign = the nose-lift bug quantified), roll angle in slalom, speed at flip if any,
  time-to-100, brake distance.
- Record the user's per-scene EXPECTATIONS from vanilla SA (words, not captures — real SA runs
  outside the browser): e.g. "handbrake turn rotates ~90-120° with a held slide". These become the
  feel targets later plans are judged against.

## Subtasks

- [x] `vehicle-telemetry.ts` sampler + ring buffer + unit tests (pure math on scripted inputs).
- [x] Slip proxy exported on the vehicles facade (typed, documented for 080/05).
- [x] F2 Physics tab: live telemetry strips; read-only constants group.
- [ ] `ScriptedDriveSource` + scenario spec + the 7 scenes v1.
- [ ] `[phys]` capture protocol + `phys-compare.ts` + headless harness lane.
- [ ] BEFORE matrix captured (3 cars × 7 scenes) + ledger summary + user expectation notes.

## Acceptance

- Determinism: same scene twice → within tolerance bands; harness runs the matrix headless.
- The nose-lift and flip complaints are VISIBLE AS NUMBERS in the baseline ledger (pitch sign under
  braking; roll/flip in slalom or u-turn) — if they are not, the scenes get redesigned until they are.
- Telemetry cost when enabled ≤ 0.05 ms/step; zero when disabled.

## Ledger

### 2026-07-25 — the sampler + the facade channel (subtasks 1 and 2)

**What landed**

- `packages/game/src/physics/physics-world.ts` — `readVehicleWheels(controller)`, the only new physics API:
  per wheel contact, spring length/rest/max-travel, suspension force, the forward/side tyre impulses and the
  cumulative roll angle. Read-only, no physics change.
- `packages/game/src/vehicle/vehicle-telemetry.ts` — `computeFrame` (pure), `TelemetryRing` (fixed-capacity,
  reads back oldest → newest) and `VehicleTelemetry` (the clock + previous sample + the ring, `enabled` off
  by default). Conventions PINNED in the module doc and in tests: **pitch positive nose UP**, roll positive
  right-side down, slip angle positive when the car points LEFT of its travel, g excludes gravity.
- `EnterVehicleSystem.appliedControls()` — the values `drive()` handed the controller last step (ramped
  engine force, slewed steer, the throttle behind them). A capture that recorded raw input instead could not
  explain the response, since neither channel reaches the car unfiltered. Zeroed unless seated.
- `EngineVehicles.telemetry` — the facade export 080/05 consumes. Only the SEATED car is sampled, its
  history resets when the player changes cars, and the `enabled` check runs before any physics read, so a
  shipped build pays nothing.

**Correction to this plan's channel table.** The doc specified the longitudinal slip proxy as "wheel-roll
speed (from `VehicleRig` distance) vs ground speed". That proxy is DEGENERATE: the rig's roll is itself
derived from the car's planar displacement (`VehiclePhysicsSystem.rollWheels`), so it would have reported
zero slip by construction — a wheelspin is exactly the case where the wheel's speed and the ground's differ.
Rapier's controller exposes more than the plan assumed: `wheelRotation` (cumulative, unwrapped) gives the
wheel's REAL angular speed, so the shipped `slipRatio` is a true `(surfaceSpeed − groundSpeed) / |groundSpeed|`
— positive for wheelspin, −1 for a locked wheel. `wheelForwardImpulse` / `wheelSideImpulse` are recorded
too: the tyre forces actually delivered, which plans 03–05 need per corner and the plan did not list.

**Tests**: `vehicle-telemetry.test.ts` (21) — signs and conventions per channel, rates reading 0 on the
first step (one sample cannot show a rate), the slip floor, the ring's order/capacity, a disabled sampler
doing nothing at all. `physics-world.test.ts` gained 3 real-Rapier cases: an airborne car reads no contact,
a car resting on ground reads compressed springs whose four loads sum past half its weight, and a wheel-less
controller reads empty. Full vehicle + physics suites 171 green; `tsc` + eslint clean.

**Not done here** (the rest of this plan): the F2 Physics tab, `ScriptedDriveSource` + the 7 scenes, the
`[phys]` capture protocol + `phys-compare.ts`, and the BEFORE matrix (3 cars × 7 scenes) with the user's
vanilla expectations. No numbers are recorded yet BECAUSE none have been measured — the baseline needs the
scripted track, not a hand-driven session.

### 2026-07-26 — the F2 Physics tab (subtask 3)

**What landed**

- `apps/web/src/ui/debug/physics-panel.tsx` — the screen. The body block prints the frame's channels in the
  units a driver reads (km/h, degrees, g, kN); the wheel block prints one line per corner with a monospace
  travel meter (`● ████░░░░░░ 4.2kN -0.25`). The row builders (`bar`, `bodyRows`, `wheelRows`) are pure and
  unit-tested — a unit slip in the instrument would be indistinguishable from a physics bug in a field round.
  `pitch (+ nose up)` and `roll (+ right down)` carry their sign convention IN the label, because the whole
  braking complaint is a sign on that channel.
- **The capture switch belongs to the screen.** Mounting calls `setPhysicsCapture(true)`, leaving calls it
  with `false`; the host resets the ring on both edges, so an opened tab never shows a stale car's history.
  This is the Perf panel's `setPerfEnabled` pattern, and it keeps the "zero cost when disabled" promise the
  sampler was built with — a closed debugger reads nothing off the body.
- `VEHICLE_PHYSICS_CONSTANTS` (`physics-world.ts`) — the twelve shared numbers exported as `[label, value]`
  rows and printed read-only under the divider. Seeing "every car runs these" next to the live telemetry is
  the plan-02 argument made visible while driving.
- `wheelCornerLabels` (`vehicle-telemetry.ts`) — wheel INDEX order comes from the model's own hub dummies, so
  it means nothing across cars. The axle comes from the model's front flag, the side from the hub's x sign
  (the driver's side is −X), and a straddled hub (bike) reads `F`/`R` with no side invented. The `[phys]`
  capture will name its corners with the same function.
- Screen gating followed the existing capability system: a `physicsScreen` capability (engine host true,
  three host false — there is no raycast-vehicle telemetry there) and the screen added to the dev-only set,
  like every other live-tuning screen. `menuFor`'s per-screen gate is now a `SCREEN_CAPABILITY` map instead of
  a growing chain of ternaries.

**Numbers.** None measured here, and deliberately so: this subtask ships an INSTRUMENT, and every number this
plan owes (telemetry cost per step, the BEFORE matrix) needs the scripted track from subtask 4 to be
reproducible. A hand-driven reading would not survive its own re-run. What is verified: `tsc` clean, eslint
clean, `npm run build` clean, and 63 green across the touched suites (`physics-panel` 10 ·
`debug-capabilities` 14 · `vehicle-telemetry` 26 · `engine-debug-actions` 13), of which 13 are new: 10 panel
formatting/meter cases, 2 corner-label cases (four-corner car, straddled bike hub), 1 menu-gating case.

**Still owed by this plan**: `ScriptedDriveSource` + the 7 scenes, the `[phys]` capture protocol +
`phys-compare.ts`, and the BEFORE matrix (3 cars × 7 scenes) with the user's vanilla-SA expectations in words.

_(baselines, scene specs, measured costs follow)_
