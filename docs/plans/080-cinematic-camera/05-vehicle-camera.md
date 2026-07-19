# 080/05 — Vehicle camera (behaviours 5, 10) + enter/exit blends

Where the cinematic feel pays off most — and where all the data is already reachable but unused:
signed speed (`physics.vehicleSpeed`), full velocity (`getLinvel`), heading from the body quat
(`enter-vehicle.system.ts:470`). Today the vehicle camera is just the on-foot stick with the focus
swapped to the car (`engine-canvas-host.tsx:849`) plus a one-shot `aimCamera` yaw on entry.

## 1. Mode + snapshot

- `mode: 'vehicle'` when `vehicles.activeVehicle()` (seated) — the host already computes this for
  focus; the snapshot gains `vehicle: { speed, velocityDir, heading }` (signed forward speed u/s;
  planar velocity direction; car yaw in engine space). Climb-in/out (`ridingVehicle` without
  `activeVehicle`) stays in `foot` mode — the blend (§5) covers the visual transition.
- Vehicle mode RETUNES the shared channels (its own lambda/lag set from config) and adds writers;
  it does not fork the rig. One rig, two tuning tables — transitions are then just tuning blends.

## 2. Speed → distance + FOV (#5)

- `distanceTarget = followDistance + vehicleDistanceGain × smoothstep(0, vSpeedRef, |speed|)`,
  capped at `vehicleDistanceMax` (first guess: +2.0 m at ~40 u/s over a 6.5 m base). Through the
  02 distance damp — braking hard visibly lets the camera glide back in (#5's second half).
- `fovTarget = baseFov + vehicleFovKick × smoothstep(vFovLo, vFovHi, |speed|)` (first guess: up to
  +10° approaching top speed), damped with its own slower lambda — FOV pumping on throttle
  blips is the classic mistake; the damp plus the smoothstep dead-band below ~8 u/s prevents it.
  FOV is free per-frame (projection rebuilt in `Engine.frame`, readme constraint 2).
- Reverse uses |speed| for both; distance gain slightly lower (tunable).

## 3. Turn lag + drift framing (#10)

- **Yaw follows the car with mass**: the yaw target is the car's REAR direction; it is chased via
  `smoothDampAngle` with `vehicleYawLagTime` (~0.35 s first guess) — entering a corner the camera
  visibly hangs outside the turn, then swings through. This is the single biggest "GTA in a car"
  ingredient. Manual look still overrides (036 rule) with a shorter re-engage grace than on foot
  (~1.5 s) since hands-off is the norm while driving.
- **Drift framing**: slip = wrapped angle between `velocityDir` and car heading, dead-banded ~8°
  and only above ~10 u/s. The effective yaw target becomes
  `heading + driftLookBlend × slip` (`driftLookBlend` ~0.5): in a slide the camera looks partway
  along the actual travel direction — the player reads the trajectory, exactly the requested
  behaviour. Below the dead-band, zero contribution (straight driving is unaffected).
- **Pitch**: vehicle mode holds a slightly lower default polar and damps the look-point height a
  bit faster than on foot (suspension bounce must not pump the horizon — the vertical-softness
  channel from 02 does this with a vehicle lambda).

## 4. Collision variant

Same 04 layer; vehicle tuning widens the whisker angle (higher closing speeds) and raises
`collisionReleaseTime` slightly. Budget stays ≤ 5 casts/frame. Seated car body excluded from casts.

## 5. Enter/exit blends

- On seat (the moment `aimCamera` fires today): instead of snapping yaw, seed the vehicle yaw
  target and let the `smoothDampAngle` channel carry the camera behind the car (~0.6 s swing).
  Distance/FOV likewise re-target through their damps. `aimCamera`'s snap semantics remain only
  for teleport-grade cases (respawn in car).
- On exit: mode flips to foot tuning; channels keep their state — no cut, the camera just relaxes
  to on-foot framing. A test scripts seat→drive→exit and asserts continuity (no state reset).

## 6. Look-behind (polish, small)

Hold-key (default `KeyC`-class, config in `controls`): yaw target flips to car FRONT direction
through a fast damp; release swings back. Pure writer on the existing channel — cheap, high value
for gameplay. Ships last, behind the field round.

## Subtasks

- [ ] Snapshot: vehicle speed/velocityDir/heading assembly in the host (engine-space conversion).
- [ ] `vehicle-rig.ts`: distance/FOV curves + yaw chase + drift blend + pitch/vertical tuning;
      unit tests with scripted drive traces (corner entry lag then settle; slip dead-band; FOV
      dead-band under 8 u/s; reverse).
- [ ] Enter/exit blend + continuity test; `aimCamera` demoted to teleport cases.
- [ ] Vehicle tuning table in `CameraConfig` + Camera-tab rows.
- [ ] Look-behind key.
- [ ] **Field round** (drive-heavy): city corners at speed, handbrake drifts, highway top speed,
      tunnel (collision + FOV together), enter/exit repeatedly. The bench-road-cars scenes give a
      dense traffic backdrop. Freeze the two tuning tables in the ledger.

## Acceptance

- Corner-entry lag reads as weight, never as losing the car; drift shows travel direction.
- Speed changes move distance/FOV smoothly, no pumping on gear-shift-scale speed noise.
- Enter/exit shows zero camera cuts. Tests green; budgets hold.

## Ledger

_(append here)_
