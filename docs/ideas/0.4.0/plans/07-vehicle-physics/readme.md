# 07 — Vehicle driving physics overhaul (THE priority gameplay task)

**Problem (user, 2026-07-12, marked very important):** driving feels awful — steering responds instantly
(no rate/feel), braking pitches the nose up instead of down, cars flip far too easily. The bar: driving
must feel GREAT — SA-arcade responsive but physically grounded.

**Migration note:** physics is renderer-agnostic (Rapier world + game systems — confirmed by the 074/10
boundary audit). This plan runs on the CURRENT engine and survives the flip untouched: the vehicle
controller outputs body transforms; both renderers consume them. Do it in 0.4.0 — no reason to wait.

## Root-cause hypotheses (verify in phase 0 — do not tune blind)

1. **Steering is a direct set, not a rate**: wheel angle jumps to target instantly → twitch at speed.
2. **Braking as a body force at the wrong height** (or wheel brake torque without load transfer modelling)
   → nose LIFTS: the decel force is applied above the contact patches with no anti-dive.
3. **Centre of mass too high / default inertia**: Rapier computes inertia from collider shape; a box the
   size of a car with uniform density rolls over eagerly. SA's `handling.cfg` ships an explicit
   `centreOfMass` per vehicle — likely unused or misapplied.
4. **No slip-based tyres**: if lateral grip is a hard constraint (or raw friction), the car snaps instead
   of breathing through a slip curve.

## Approach — three layers, in order

### Layer 1: the vehicle model (the foundation)

Adopt Rapier's **`DynamicRayCastVehicleController`** (@dimforge/rapier ships it — Bullet's raycast-vehicle
design: chassis rigid body + per-wheel raycast suspension; no wheel colliders to fight the world). If a
phase-0 spike finds it too rigid for SA feel, the fallback is our OWN raycast vehicle on top of a Rapier
rigid body (same design, ~400 lines, full control) — decide by the spike, not by preference.

Per-wheel: suspension rest length / stiffness / damping (compression ≠ rebound), max travel, wheel radius,
contact query via ray (later: shapecast for kerbs).

### Layer 2: `handling.cfg` is the tuning source of truth

SA already ships per-vehicle physics data — parse and MAP it, don't invent numbers: mass,
**centreOfMass (x,y,z)** (fixes rollover at the root), dragMult, tractionMult/tractionLoss/tractionBias,
suspension force/damping/high-low limits/anti-dive multiplier, brake deceleration/bias, steering lock,
gear count + velocity, engine acceleration/drive type (F/R/4). Build the mapping table Rapier-units ↔
handling-units ONCE with unit tests (SA uses odd units — document each conversion).

### Layer 3: the FEEL systems (what actually fixes the complaints)

- **Steering**: rate-limited approach to target angle; speed-sensitive max lock (full lock at parking
  speeds, few degrees at highway speed); optional counter-steer assist; return-to-centre force.
- **Load transfer & anti-dive/anti-squat**: suspension geometry factors so braking COMPRESSES the front
  (nose down) and acceleration squats the rear — this is the direct fix for the reported brake nose-lift.
- **Anti-roll bars**: per-axle spring coupling left↔right wheel compression — the principled fix for easy
  flipping (together with handling's centreOfMass). Plus an SA-style arcade stabiliser: a small
  roll-damping torque above a roll-rate threshold (vanilla SA does this too).
- **Tyre model**: slip-ratio (longitudinal) + slip-angle (lateral) → force via a simplified Pacejka
  ("magic formula" lite or a 3-segment curve: linear grip → peak → sliding falloff), combined-slip friction
  circle, load-dependent (normal force from suspension). This is what makes cars breathe instead of snap.
- **Drivetrain**: engine curve → gears (handling data) → wheel torque by drive type; engine braking;
  handbrake = rear grip cut (the SA slide).
- **Aids (SA-feel, toggleable)**: downforce with speed, in-air attitude control (SA lets you pitch),
  wheel-contact smoothing over kerbs.

## Phase plan / tasks

- [ ] **Phase 0 — telemetry harness FIRST** (nothing gets tuned blind): on-screen plots for wheel loads,
      slip angles/ratios, suspension travel, body roll/pitch, g-forces; deterministic test track scene
      (slalom, 180° turn, braking strip, kerb strike, jump) driveable by scripted inputs for A/B replays;
      capture-to-JSON like the render bench (the same ritual philosophy).
- [ ] Phase 0.5 — spike `DynamicRayCastVehicleController` on one car with handling-mapped params; verdict:
      adopt or build own raycast vehicle (decision recorded here).
- [ ] Phase 1 — handling.cfg parser + unit-mapping table (unit-tested); centreOfMass + inertia applied.
- [ ] Phase 2 — suspension + load transfer + anti-dive/anti-squat + anti-roll bars; acceptance: braking
      dips the nose, flip requires deliberate abuse.
- [ ] Phase 3 — tyre slip model + drivetrain + handbrake; acceptance: progressive cornering, controllable
      slides, drive-type character (FWD understeers, RWD oversteers on power).
- [ ] Phase 4 — steering feel (rate + speed-sensitivity) + aids; acceptance: highway lane change is calm,
      parking lock is full.
- [ ] Phase 5 — per-class presets from handling groups (sports/truck/bus/bike-ready) + regression pack:
      scripted-input replays with tolerance bands on telemetry (physics CI).
- [ ] Reference calibration: pick 3 vehicles (infernus / admiral / firetruck), side-by-side feel targets
      against vanilla SA gameplay capture; the user signs off feel per phase (feel is the acceptance test).

## References to study during phase 0.5

- Rapier `DynamicRayCastVehicleController` sources (Bullet raycast-vehicle lineage) — our default.
- Bullet `btRaycastVehicle` docs/known pitfalls (skidding at low speed, suspension jitter fixes).
- SA `handling.cfg` community documentation (units and flag semantics are well reverse-engineered).
- Space Dust Racing / randygaul articles on arcade vehicle physics (industry-standard raycast car writeups).
