# 081/06 — Air control, kerb smoothing, visible suspension

The perceived-quality plan: three smaller systems that turn "correct" into "alive". Runs after the
gate (05) so it tunes against the final tyre behaviour.

## 1. In-air attitude control (SA lets you fly a little)

- Airborne = all four wheels out of contact for > 0.15 s (debounced — kerbs must not trigger it).
- While airborne: pitch torque from throttle/brake input (W noses up, S noses down — SA semantics),
  small roll torque from steering; magnitudes scaled by `turnMass`, clamped so a crest jump is
  correctable but backflips take commitment. Landing: no special-case — plan-02/03 suspension +
  stabiliser absorb it (the crest-jump replay pins the landing pitch envelope).
- The 080/06 camera landing-dip integration point: vehicle landings feed the same impact channel
  as the damage system's contact events (no new plumbing).

## 2. Kerb / step contact smoothing

- Known raycast-vehicle weakness: a vertical kerb face is invisible to a downward ray until the
  wheel centre crosses the edge → snag or launch. v1 mitigation inside DRCVC: a short forward
  low-height probe per front wheel (reuses the plan-04/080 raycast API) that converts a detected
  step ≤ ~0.25 m at low speed into a brief upward impulse ramp (curb-mount assist), and above a
  height/speed threshold lets the collision happen honestly (kerbs at 80 km/h SHOULD punish).
- If plan 05 went own-controller: the honest fix is wheel SHAPECAST instead of ray — do that there
  and this section reduces to tuning.
- The `kerb-strike` replay is the acceptance instrument (mount smoothness at low speed, honest hit
  at high speed, no launch).

## 3. Visible suspension travel (the render-side item of the chain)

- `VehicleHandle.setWheel(index, spin, steer)` gains `travel` (compression offset in metres);
  `VehicleRig` passes the smoothed `wheelSuspensionLength` delta; the engine host applies it as a
  local-Z offset on the wheel's per-wheel transform (the render path already positions wheels
  per-frame — this is one more term, no format/pipeline change).
- Smoothing: a short damp (~25 Hz equivalent) so ray jitter never buzzes the visual; clamped to
  authored travel.
- Body roll/pitch are already real (rigid body transform) — with 02/03 they finally SHOW; this item
  makes the wheels stop looking welded to the chassis over bumps, which is half the perceived
  suspension feel.
- Fake-handle tests pin the travel plumbing; the field eye judges the rest.

## Subtasks

- [ ] Airborne detector + attitude torques + clamps + tests (debounce, no-input = no torque,
      crest-jump envelope).
- [ ] Kerb probe + impulse ramp + thresholds + tests; `kerb-strike` A/B captures.
- [ ] `travel` through handle/rig/host + smoothing + tests; visual check clip in the field round.
- [ ] **Field round**: jumps (crest at varying speed), kerb mounts, cobbled/uneven streets ("do the
      wheels live?"), plus regression drive of everything since 02.

## Acceptance

- Crest jump: attitude correctable in air, landing absorbed without porpoising or nose-plant
  (replay envelope + field).
- Low-speed kerb mount smooth; high-speed kerb honest (replay).
- Wheels visibly work over uneven ground; no visual buzz (field).

## Ledger

_(thresholds, torque clamps, capture numbers, field verdict)_
