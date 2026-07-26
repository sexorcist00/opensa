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
- [x] `ScriptedDriveSource` + scenario spec + the 7 scenes v1.
- [ ] `[phys]` capture protocol + `phys-compare.ts` + headless harness lane. (Protocol + runner + harness
      lane SHIPPED and proven on a real lap; `phys-compare.ts` still owed.)
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

### 2026-07-26 — the scripted track and the `[phys]` protocol (subtask 4, most of 5)

**What landed**

- `packages/game/src/vehicle/scripted-drive.ts` — `ScriptedDriveSource` IS an `InputState`, so a lap drives
  through `drive()`'s own ramps, steer slew and reverse seeding. A capture that bypassed them would measure a
  car the player never drives. Keyframes HOLD (no interpolation): a slalom is "full left, then full right",
  and a scene has to be describable in words to be reproducible. Its clock runs on the FIXED step — a
  timeline advanced by the render rate replays differently on a different machine. Idle it contributes
  nothing to the `CombinedInput` sum, so it lives in the host permanently and only speaks during a lap.
- `apps/web/src/phys-scenes.ts` — the 7 scenes. **Every spot is REAL**: `scripts/debug/road-straights.ts`
  (promoted from a throwaway, row added to `docs/debug/README.md`) walks the game's own `NODES*.DAT` vehicle
  graph for chains that hold one heading, and reports each run's length and Δz. The straights used are the SF
  west shore (450 m, **Δz 0.00**), an LV avenue (336 m, Δz 0.00) and an LS east straight (294 m, Δz 0.00);
  the crest is a Red County rise of +4.3 m then −3.3 m within 50 m of the peak. Guessing "the airport runway
  is about here" would have put the whole BEFORE matrix on unverifiable ground.
- `apps/web/src/ui/engine-phys-runs.ts` — `?phys=<scene|all>&car=<model>`, the `[bench]` runner's twin.
  A lap teleports beside the spot, waits for the streaming ring to drain (the collision cell must exist
  before a car is dropped into it), spawns the model, presses enter/exit and **walks the ped in through the
  real sequence**, lets the springs settle, then plays the timeline with the capture ON and prints
  `[phys] {json}`. Everything outside the timed window happens with the capture OFF.
- `packages/game/src/vehicle/phys-capture.ts` — the summary every later plan is judged by (peak nose-up
  angle WHILE braked, braking distance/time from its start speed, roll range, first flip + the speed it
  happened at, air time, integrated rotation, time to 100). Peaks come from EVERY frame; the printed series
  is thinned to 20 Hz, so a spike survives as a number even when its sample is dropped from the curve.
- The telemetry ring went 600 → 3600 frames: the longest scene is 24 s and a ring that wrapped mid-lap would
  silently drop the launch and report the tail as the run.

**Numbers — the first real capture (infernus, `brake-strip`, headless, build `./build/original/opensa`)**

The first run held WOT to 12 s and the car **ran out of straight at 190 km/h** — an 18.8 g lateral spike and
0.13 s of air that had nothing to do with braking. That is the harness working: a bad scene showed up as data,
not as a plausible number. Brake moved to 8 s (~200 m in); the clean lap:

| channel                     | value                                       |
| --------------------------- | ------------------------------------------- |
| time to 100 km/h            | **3.98 s**                                  |
| speed at brake              | **165.2 km/h**                              |
| braking distance / time     | **59.9 m / 2.92 s** (≈1.6 g average)        |
| peak longitudinal g         | **−3.17 g**                                 |
| **pitch while braking**     | **+0.07° (nose UP)**, whole-lap range −0.53…+0.07° |
| roll / slip / lateral g     | 0 / 0 / 0 (a dead-straight lap)             |
| frames                      | 960 @ 60 Hz, 401 rows printed at 20 Hz      |

**The braking complaint, quantified.** The nose does not dive: at 1.6 g of deceleration the body pitches
**+0.07°, and the sign is UP**. It is not that the car pitches up a lot — it is that it does not pitch at all,
and what little there is goes the wrong way. `CHASSIS_ANGULAR_DAMPING = 2` (the band-aid plan 03 retires) is
the obvious suspect, and the number to beat is now on record.

**Still owed by this plan**: `phys-compare.ts` (determinism check + tolerance bands), and the BEFORE matrix
(3 cars × 7 scenes) with the user's vanilla-SA expectations in words.

_(the BEFORE matrix follows)_
