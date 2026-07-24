# Camera

`apps/web/src/ui/camera/`, `packages/math/src/damping.ts`, `Config.camera`, plans 036 (the three-era rig)
and 080 (the own-engine cinematic chain).

## Implemented

**The director** (plan 080/01) — one pure step per rendered frame:

- `stepCamera(state, snapshot, config)` takes a `CameraSnapshot` (dt, focus, mode, raw look deltas, wheel
  notches, fly walk keys / drag pan) and returns the `CameraState` the engine draws. The host assembles the
  snapshot and owns nothing else: its pointer/wheel handlers only ACCUMULATE input, which is what lets the
  smoothing layers see whole frames.
- `CameraRigState` (yaw, pitch, distance, the detached fly eye) is a plain mutable record the host holds and
  the director steps in place — no per-frame allocation.
- Layer order is fixed: **look → zoom → mode rig (foot | vehicle | fly) → collision (plan 04) → additive
  motion (plan 06) → resolve**. Collision resolves BEFORE additive motion so a bob can never push the eye
  through a wall.
- **The bench bypass is an invariant**: `resolveCamera`'s priority is bench > fly eye > follow rig, so a
  running bench owns the frame whatever the rig did. Camera work cannot move ritual/soak numbers.

**The smoothed rig** (plan 080/02) — the "cinematic" part, split into channels that damp at different rates
instead of one global smoothing knob:

- **Input dampening**: pointer deltas go into a pending pool and are released exponentially over
  `inputSmoothTime`. Nothing is dropped — a gesture's total rotation equals raw mouse travel, it is only
  spread over ~5 frames, which is the difference between "dampened" and "laggy".
- **Look point, not focus**: the rig orbits a smoothed point that trails the player — a planar spring on
  `positionLagTime`, a slower exponential on `verticalLagTime` for height (stairs and jump arcs must not
  jolt the horizon), and a smoothstep **dead zone** (`deadZone`) so idle jitter moves nothing. Two floors
  keep it honest: the point never trails by more than `lagMaxDistance`, and a focus jump past
  `teleportSnapDistance` snaps (respawn, debugger warp).
- **Steered yaw**: when something other than the player aims the camera — vehicle entry today, auto-center
  in plan 03 — the yaw swings over `yawLagTime` instead of snapping, and any mouse movement takes it back.
- **Zoom** damps toward a target the wheel (and later the mode/collision layers) writes, so it glides.
- **`?cam=legacy`** turns every one of those channels off and runs the pre-080 rigid stick — the A/B a
  field round compares one reload apart, pinned by the parity test.

**Composition** (plan 080/03) — the camera doing its own work while the player's hands are busy, all of it
ON FOOT only for now (the vehicle versions are plan 05):

- **Turn-follow**: a heading change faster than `turnThreshold` swings the camera behind the new direction
  through the steered-yaw channel and stops once it is within `settleEpsilon`. A straight run never engages
  it — a framing the player chose survives the whole run.
- **Idle recenter**: after `recenterDelaySec` of untouched look, a MOVING player is eased behind at
  `recenterRate` scaled by speed (a walk barely drifts home, a sprint commits). Standing still never
  recenters — a parked camera is left alone.
- **Manual always wins**: any look input cancels both, restarts the idle clock, and holds turn-follow off
  for `manualGraceSec`. Pitch is never auto-touched.
- **Look-ahead**: the frame leans toward travel by up to `lookAheadDistance`, damped over `lookAheadTime`
  and scaled by speed. It moves eye and target together, so only the composition changes — the orbit
  geometry stays put.
- The behind-yaw convention: a GTA heading `h` points along `(−sin h, cos h)` and the camera looks along
  `(sin yaw, −cos yaw)`, so the camera sits behind at `yaw = h + π`. In practice: running the way the
  camera already looks needs no correction.

**Modes**

- `foot` / `vehicle` — the follow rig: mouse look (yaw free, pitch clamped to `pitchMin`/`pitchMax`), wheel
  zoom inside `followZoomMin`/`followZoomMax` (gated by `followZoom`), eye target at `followHeight` above the
  focus. While seated the focus is the CAR, not the rider (the rider is teleported into the seat every frame
  and would judder).
- `fly` — the photo camera and the map viewer are the SAME detached eye (`fly-rig.ts`): ARROW walk +
  PageUp/PageDown lift at `FLY_SPEED`, left-drag pan in the screen plane scaled by altitude, right-drag
  orbit, wheel dolly (also altitude-scaled, floored at 2 u above ground), top-down snap on activation. Fly
  pitch reaches `TOP_DOWN_PITCH` (just short of straight down — a vertical forward has no screen basis),
  lower than gameplay may look. Fly opts OUT of collision, auto-center/look-ahead and additive motion by
  construction.

**Field of view** is a director OUTPUT (`CameraState.fovYRad`, default π/3) — the projection is rebuilt from
it every frame, and cursor picking in the map viewer unprojects through the SAME value the frame was
rendered with, so an animated FOV (plan 05) can never send clicks off-target.

**Smoothing primitives** (`@opensa/math`, used from plan 02 on): `damp`/`dampAngle` (exponential approach,
`λ` reads as a half-life `t½ = ln2/λ`) and `smoothDamp`/`smoothDampAngle` (critically damped spring with a
caller-owned velocity, eases IN as well as out, `maxSpeed` cap). Both take dt — the camera runs in the
VARIABLE-rate section of the host loop, so frame-rate independence is tested, not assumed.

**Config + tuning** (`Config.camera`): framing (`followDistance`, `followHeight`, `followZoom` + zoom
bounds), look (`sensitivity`, `pitchMin`, `pitchMax`) and the 02 feel channels (`inputSmoothTime`,
`positionLagTime`, `verticalLagTime`, `deadZone`, `lagMaxDistance`, `teleportSnapDistance`, `yawLagTime`,
`zoomLambda`). All of it is live on the debug **Camera** screen (`cameraRig` capability, on for the engine
host since 080/01) — field rounds tune with sliders, not rebuilds.

## Known gaps / candidates

- The 080/02 and /03 defaults are FIRST GUESSES — they have not survived a field round yet, and the dead zone
  leaves the frame settling ~8 cm behind a focus that stopped (the price of a rock-still idle frame).
- No camera collision — the eye clips through walls (plan 04 adds `PhysicsWorld` ray/sphere casts + whiskers).
- No vehicle framing (speed distance/FOV curves, turn lag, drift framing) — plan 05.
- No bob / landing dip / impact shake / sprint FOV kick, and no motion-reduction toggle — plan 06.
- No mode-transition blending (foot ⇄ vehicle ⇄ viewer) — plan 07.
- No switchable view presets yet (a C-key ring per mode, first person included) — plan 08. The seam is
  already in place: every tuned value reaches the rig as one `CameraConfig`-shaped object, so a preset is a
  different object handed to the same `stepCamera`, never a second code path.
- No gamepad look — there is no gamepad input path at all.
- `followLerp` / `followPolar` / `followMinPolar` / `followMaxPolar` are 036-era fields the own-engine rig
  does not read; they stay in `CameraConfig` until the chain closes and replaces them.

## Test coverage anchors

`ui/camera/camera-input.test.ts` (gesture conservation, settle time, rate independence),
`ui/camera/auto-center.test.ts` (the behind-yaw convention, straight runs never engaging, the grace window,
stand-still exclusion, walk-vs-sprint recenter rates), `ui/camera/look-ahead.test.ts` (speed scaling, the
cap, the fade home, rate independence),
`ui/camera/follow-rig.test.ts` (no overshoot, dead zone holds still, vertical slower than planar, the lag
floor at a 12 m/s sprint, teleport snap, 1/120-vs-1/20 agreement),
`ui/camera/camera-director.test.ts` (the legacy-parity gate: the director reproduces the pre-080 stick
camera over a scripted look+zoom sequence; mode clamps, zoom notches, fly walk/pan/dolly, top-down snap),
`ui/camera/engine-camera.test.ts` (bench priority, cursor ray, forward convention), `ui/camera/fly-rig.test.ts`,
`math/damping.test.ts` (convergence, no overshoot, ±π seam both directions, maxSpeed clamp, rate
independence at 1/60 vs 1/10 vs 1 s).
