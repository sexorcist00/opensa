# 080/01 — Foundations: damp math, CameraDirector skeleton, config, debug, A/B

**Everything else in the chain sits on this plan.** It ships no visible behaviour change by itself
(the director in "legacy" tuning reproduces the current stick camera bit-for-bit) — it ships the
seams: math, module layout, config, debug surface, and the A/B switch.

## 1. Smoothing math → `@opensa/math`

New helpers next to `lerp` in `packages/math/src/math-utils.ts` (or a sibling `damping.ts` if the
file grows past focus):

- `damp(current, target, lambda, dt)` — frame-rate-independent exponential approach:
  `lerp(current, target, 1 − exp(−lambda · dt))`. `lambda` is "per second"; the doc comment states
  the half-life relation (`t½ = ln2/λ`) so tuning reads as time, not magic.
- `dampAngle(current, target, lambda, dt)` — same, but the error is wrapped to (−π, π] first via
  `euclideanModulo` so yaw never unwinds the long way around.
- `smoothDamp(current, target, velocityRef, smoothTime, maxSpeed, dt)` — critically damped spring
  (the Unity/Game Programming Gems form). This is the "inertia" primitive: it eases IN as well as
  out, which plain `damp` does not (behaviour #2 needs both ends eased). Carries its velocity in a
  caller-owned ref object — the math package stays allocation-free and stateless.
- `smoothDampAngle(...)` — wrapped variant.

**Why both `damp` and `smoothDamp`:** `damp` is one number of state and is right for channels that
should start moving immediately but settle softly (pitch, FOV, distance). `smoothDamp` carries
velocity and is right for channels that must feel massy (yaw catch-up, position lag, look-ahead).
Choosing per channel is a tuning decision made in plans 02/05; both primitives exist from day one.

### Subtasks

- [ ] Implement the four helpers with doc comments (units: radians, seconds, per-second lambdas).
- [ ] Unit tests: convergence, overshoot-free for critical damping, angle wrap both directions
      across the ±π seam, `maxSpeed` clamp engages.
- [ ] **Rate-independence tests** (ground rule 2): 60 × dt=1/60 vs 6 × dt=1/10 vs 1 × dt=1 land
      within 1e-3 for `damp`; for `smoothDamp` assert small-step/large-step agreement within the
      documented tolerance (the discrete form is only approximately rate-independent — the test
      pins HOW approximate, so a regression is visible).

## 2. `CameraDirector` skeleton — `apps/web/src/ui/camera/`

`engine-camera.ts` grows into a directory; the existing pure functions move unchanged
(`resolveCamera`, `flyStep`, `createChordWatcher` keep their tests green — pure file move):

```
apps/web/src/ui/camera/
  engine-camera.ts        // resolveCamera / flyStep / chord — as today (moved)
  camera-director.ts      // the state machine + layer order; owns CameraRigState
  camera-input.ts         // look-delta smoothing, idle timer, zoom intent   (plan 02)
  follow-rig.ts           // on-foot spherical rig springs                   (plans 02, 03)
  vehicle-rig.ts          // vehicle chase behaviour                         (plan 05)
  camera-collision.ts     // whisker casts + pull-in/release                 (plan 04)
  camera-motion.ts        // additive bob/dip/shake/FOV-kick layer           (plan 06)
```

### The contract

```ts
type CameraSnapshot = {
  // assembled by the host, all plain data, engine Y-up
  dt: number;
  mode: 'foot' | 'vehicle'; // photo/bench never reach the director (resolveCamera priority)
  focus: Vec3; // player or seated car position (already the host's `focus`)
  focusHeading: number; // ped render heading or car heading, as engine yaw
  velocity: Vec3; // planar+vertical, engine space
  grounded: boolean;
  vehicle?: { speed: number; velocityDir: Vec3; heading: number }; // plan 05
  look: { x: number; y: number }; // this frame's raw pointer deltas (px)
  zoomSteps: number; // wheel notches this frame
};

type CameraRigState = {
  /* yaw, pitch, distance, their spring velocities, offsets, timers … */
};

// pure: (state, snapshot, config, probe) → { state, camera: CameraState & { fovYRad } }
```

- The **physics probe** is one injected function, `castToEye(fromGta, toGta) → number | null`
  (plan 04 defines it; until then the director receives `null` ⇒ no collision layer). Tests stub it.
- `CameraRigState` is a plain mutable record owned by the host ref, stepped by pure functions —
  the same shape the character controller uses. Zero allocation per frame (reuse scratch vectors).
- **Legacy parity mode**: with lag/spring lambdas set to `Infinity` (config default OFF for every
  new behaviour until its plan ships), the director must output exactly today's camera. A test pins
  this against the current `resolveCamera` math.

### Host wiring (`engine-canvas-host.tsx`)

- Replace the inline yaw/pitch/wheel mutation block (`:367-382`) with snapshot assembly feeding
  `director.update` — raw deltas go INTO the snapshot; sensitivity/smoothing move into the director
  (plan 02). The `forwardOf`/`resolveCamera` call site (`:849-870`) consumes the director's output.
- `resolveCamera` gains `fovYRad` (and keeps near/far/up ownership): the ONLY signature change to
  existing pure code. Its tests update; bench/photo paths pass the constant π/3 — pinned unchanged.
- **`?cam=legacy`** query flag: host skips the director entirely and runs the pre-080 inline path
  (kept as one small function, deleted at chain close-out in plan 07).

### Subtasks

- [ ] Move `engine-camera.ts` → `camera/engine-camera.ts`; imports + tests follow (mechanical).
- [ ] `camera-director.ts` with the layer-order spine (rig → mode → collision → motion), all layers
      pass-through stubs except the legacy-parity follow math.
- [ ] `resolveCamera` takes `fovYRad`; test updates.
- [ ] Host: snapshot assembly, director call, `?cam=legacy` branch.
- [ ] Legacy-parity unit test (director output === old math for a scripted input sequence).

## 3. Config plumbing

Extend `CameraConfig` (`config.interface.ts:12-31`) — existing 036-era fields keep their names and
meanings; new fields land in this plan as TYPES with neutral defaults (behaviour off), each
sub-plan turns its own group on with tuned defaults:

- Rig: `sensitivity` (replaces the hard-coded 0.004), `pitchMin/pitchMax` (replace [−1.2, 0.9]).
- Lag/springs (02): `yawLagTime`, `positionLagTime`, `verticalLagTime`, `inputSmoothTime`, `deadZone`.
- Auto-center (03): `recenterDelaySec`, `recenterRate`, `lookAheadDistance`, `lookAheadTime`.
- Collision (04): `collisionRadius`, `collisionReleaseTime`.
- Vehicle (05): `vehicleDistanceCurve` (base + per-speed gain + max), `vehicleFovCurve`,
  `vehicleYawLagTime`, `driftLookBlend`.
- Motion (06): `bobAmplitude`, `bobFrequency`, `landingDipScale`, `shakeScale`, `sprintFovKick`,
  `reducedMotion` (the accessibility master switch).

The debug **Camera tab** exists but is gated off for the engine host (`debug-capabilities.ts`,
`cameraRig: false`). Flip it on and extend rows group-by-group as sub-plans land — live sliders are
how field rounds tune without rebuilds (the 036 pattern, which worked).

### Subtasks

- [ ] `CameraConfig` extension + defaults in `game-runtime-config.ts` (all new behaviour neutral).
- [ ] Host reads `sensitivity`/pitch clamps/`followHeight` from config instead of the hard-coded
      0.004 / [−1.2, 0.9] / EYE_HEIGHT constants (the first visible config win, zero feel change
      with defaults matching current values).
- [ ] Debug capabilities: `cameraRig: true` for the engine host; Camera tab rows for the rig group.
- [ ] Config test fixtures updated (the 4 fixtures carry the full `camera` block — 036 note).

## Acceptance

- Suite green; `engine-camera.test.ts` (moved) green; new math + parity tests green.
- With default config and no `?cam` flag: gameplay camera is **visually identical** to pre-080
  (parity test + a manual sanity walk).
- Ritual bench row: fps/draws within noise of the reference (bench bypass proof).

## Ledger

_(append measurements + decisions here as the plan executes)_
