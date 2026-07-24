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

**Config + tuning** (`Config.camera`): `followDistance`, `followHeight`, `followZoom` + zoom bounds,
`sensitivity`, `pitchMin`, `pitchMax`. All of it is live on the debug **Camera** screen (`cameraRig`
capability, on for the engine host since 080/01) — field rounds tune with sliders, not rebuilds.

## Known gaps / candidates

- No smoothing yet: the rig is still the pre-080 rigid stick (plan 080/01 ships the seams and reproduces it
  bit for bit). Rotational lag, inertia, dead zone and vertical softness are plan 02; auto-center and
  look-ahead plan 03.
- No camera collision — the eye clips through walls (plan 04 adds `PhysicsWorld` ray/sphere casts + whiskers).
- No vehicle framing (speed distance/FOV curves, turn lag, drift framing) — plan 05.
- No bob / landing dip / impact shake / sprint FOV kick, and no motion-reduction toggle — plan 06.
- No mode-transition blending (foot ⇄ vehicle ⇄ viewer) — plan 07.
- No gamepad look (there is no gamepad input path at all) and no first-person mode.
- `followLerp` / `followPolar` / `followMinPolar` / `followMaxPolar` are 036-era fields the own-engine rig
  does not read; they stay in `CameraConfig` until the chain closes and replaces them.

## Test coverage anchors

`ui/camera/camera-director.test.ts` (the legacy-parity gate: the director reproduces the pre-080 stick
camera over a scripted look+zoom sequence; mode clamps, zoom notches, fly walk/pan/dolly, top-down snap),
`ui/camera/engine-camera.test.ts` (bench priority, cursor ray, forward convention), `ui/camera/fly-rig.test.ts`,
`math/damping.test.ts` (convergence, no overshoot, ±π seam both directions, maxSpeed clamp, rate
independence at 1/60 vs 1/10 vs 1 s).
