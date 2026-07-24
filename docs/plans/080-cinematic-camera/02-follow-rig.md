# 080/02 — Follow rig: lag, inertia, springs, input dampening (behaviours 1, 2, 3, 11)

**The heart of the chain — after this plan the camera already "feels GTA".** Everything here is
on-foot; the vehicle mode (05) reuses the same channels with different tuning.

## Design: per-channel springs on a spherical rig

The rig is spherical around a raised look point (the 036 design, proven in prod): `yaw`, `pitch`,
`distance` about `focus + followHeight`. The cinematic feel comes from splitting the camera into
**channels that damp at different rates**, instead of one global smoothing knob:

| Channel                 | Primitive             | Why                                                                   |
| ----------------------- | --------------------- | --------------------------------------------------------------------- |
| Look input (yaw/pitch)  | `damp` on the DELTAS  | #11 — raw mouse feels "cheap"; damping deltas keeps 1:1 total travel. |
| Yaw toward target       | `smoothDampAngle`     | #1/#3 — the massy catch-up when auto-centering or mode logic steers.  |
| Look-point position     | `smoothDamp` per axis | #2/#3 — camera trails a sharp direction change, then settles.         |
| Look-point height       | `damp`, slower lambda | vertical softness — stairs/jumps don't jolt the horizon.              |
| Distance (zoom + modes) | `damp`                | wheel zoom and mode changes glide instead of stepping.                |

### 1. Input dampening (#11) — `camera-input.ts`

- Pointer deltas accumulate into a **smoothed look velocity**: each frame the applied delta is
  `damp(applied, pending, 1/inputSmoothTime, dt)`; the remainder stays pending. Total rotation over
  time equals total mouse travel — **no accumulated input is ever dropped**, only redistributed
  across ~2–4 frames. This is the difference between "dampened" and "laggy": the test asserts
  conservation (sum of applied == sum of injected) and a settle time under 80 ms.
- Sensitivity from config (01). A hard flick still crosses the screen in the same total angle;
  it just has no single-frame step in it.
- Every nonzero look frame stamps `idleFor = 0` (the timer plan 03 consumes); zoom likewise.

### 2. Position lag + spring (#2, #3)

- The rig tracks a **smoothed look point**, not the raw focus: per-axis `smoothDamp` toward
  `focus + followHeight`, with `positionLagTime` planar and the slower `verticalLagTime` on height.
  A sharp 90° strafe leaves the character visibly leading the frame for a beat, then the camera
  eases back in — that IS behaviour #3; no separate "spring system" is needed beyond `smoothDamp`
  (it is a critically damped spring).
- **Soft dead zone**: focus movement under `deadZone` metres from the current smoothed point does
  not pull at all (error is remapped through a smoothstep from the dead-zone edge). Idle breathing
  and physics micro-jitter leave the frame rock-still.
- `maxSpeed` on the spring guarantees the look point can never fall further behind than a fixed
  distance at sprint speed — responsiveness floor: the player must never leave the frame. Teleports
  (respawn, debugger warp) snap the rig: any focus jump > 20 m resets springs to target (the
  streaming driver's teleport-grace idea, applied to the camera).

### 3. Rotational lag (#1)

On-foot yaw is **player-authored** — the camera never fights the mouse (036's hard lesson: pitch is
never auto-touched, manual look always wins). "Camera lags the character's turn" therefore means:
the character turns instantly with input (controller behaviour), and the RIG's yaw only moves when
(a) the player moves the mouse (through the input damper) or (b) auto-centering steers it (plan 03,
through `smoothDampAngle` — where the weight of #1 actually shows). This plan lands the
`smoothDampAngle` channel and its tuning; plan 03 feeds it a target.

### 4. Distance channel

Wheel zoom sets `distanceTarget` (clamped to `followZoomMin/Max` as today); the live distance
`damp`s toward it. Mode/collision layers later write the same target — one channel, many writers,
single smoothing point.

## Subtasks

- [ ] `camera-input.ts`: pending/applied delta damper + conservation + idle stamps; unit tests
      (conservation, settle time, sensitivity scaling, idle timer).
- [ ] `follow-rig.ts`: smoothed look point (per-axis spring, dead zone, vertical lambda, max-speed
      floor, teleport snap); yaw/pitch application; distance damp. Unit tests with scripted focus
      paths: step response has no overshoot, dead zone holds still, vertical slower than planar,
      20 m jump snaps.
- [ ] Director wiring: input → rig → resolveCamera; `?cam=legacy` still bypasses.
- [ ] Config defaults tuned to first-guess values (document them in the ledger with reasoning);
      Camera tab sliders for `inputSmoothTime`, `positionLagTime`, `verticalLagTime`, `deadZone`.
- [ ] **Field round 1** (the chain's first feel checkpoint): walk/run/jump around Grove Street,
      strafe hard, flick the mouse. Verdict per behaviour #2/#3/#11; freeze defaults in the ledger.

## Acceptance

- All rig tests green incl. rate-independence on every channel.
- Field verdict: input feels smooth but not floaty; strafe shows visible-but-small trailing;
  stairs do not bounce the horizon. (Recorded as the user's words, paraphrased in English.)
- `director.update` measured < 0.05 ms p95 at this stage (HUD long-frame check while sprinting).

## Ledger

_(append measurements + tuned values + field verdicts here)_
