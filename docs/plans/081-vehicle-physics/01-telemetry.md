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

- [ ] `vehicle-telemetry.ts` sampler + ring buffer + unit tests (pure math on scripted inputs).
- [ ] Slip proxy exported on the vehicles facade (typed, documented for 080/05).
- [ ] F2 Physics tab: live telemetry strips; read-only constants group.
- [ ] `ScriptedDriveSource` + scenario spec + the 7 scenes v1.
- [ ] `[phys]` capture protocol + `phys-compare.ts` + headless harness lane.
- [ ] BEFORE matrix captured (3 cars × 7 scenes) + ledger summary + user expectation notes.

## Acceptance

- Determinism: same scene twice → within tolerance bands; harness runs the matrix headless.
- The nose-lift and flip complaints are VISIBLE AS NUMBERS in the baseline ledger (pitch sign under
  braking; roll/flip in slalom or u-turn) — if they are not, the scenes get redesigned until they are.
- Telemetry cost when enabled ≤ 0.05 ms/step; zero when disabled.

## Ledger

_(baselines, scene specs, measured costs)_
