# Camera ideas deferred past 0.5.0

Three directions the 080 chain deliberately did NOT build, recorded at its close-out so nobody re-derives
the discussion. All three are cheap ON TOP of the shipped director — that is the point of the shape it
ended with (one rig, per-mode tuning tables, every tuned value in `CameraConfig`): each of these is a new
WRITER or a new config object, not a new code path.

Read [`docs/features/camera.md`](../../features/camera.md) first — it is the current state; this file is
only what is missing from it.

## 1. Idle cinematic auto-camera

**What**: after N seconds with no input at all, the camera drifts into composed "postcard" framings —
slow orbit, a low hero angle, a rooftop-ward tilt — and hands control back the instant anything is pressed.
GTA V does this while you idle on foot.

**Why it is cheap here**: the rig already has an idle clock (`AutoCenterState.idleFor`, reset by any look
input) and a steered-yaw channel that any writer may aim. An idle director would be one more writer on the
same channel plus a slow distance/pitch curve — no new state machine, and `manualGraceSec` already defines
"the player took it back".

**Open questions**: does it fight the auto-recenter (probably: it should SUPERSEDE it after a longer
delay)? Does it belong in cutscene-free play at all, or only in a photo mode? What resets it — any input,
or only look/move?

## 2. R-key cinematic vehicle camera

**What**: SA's cycling cinematic car cameras — chase-low, side-pan, bumper, and the "cinematic" pan that
follows the car through a corner from a fixed world point.

**Why it is cheap here**: plan 08's view presets already establish that a preset is a different
`CameraConfig` handed to the same `stepCamera`. Most of these are exactly that. The ONE that is not is the
fixed-world-point pan (the eye stops being attached to the focus) — but that path exists too: it is what
`flyEye` does for the map viewer, so a cinematic pan is a `flyEye` placed by a rule instead of by a drag.

**Open questions**: which of the SA set are worth having; does the fixed-point pan need its own collision
treatment (it frames from far away, so probably not); does it survive a field round at speed, or read as
losing control of the car.

## 3. Gamepad input path (camera-ready, input-blocked)

**What**: right-stick look with per-axis response curves, a dead zone, and the standard "the camera keeps
its own speed regardless of frame rate" treatment.

**Why it is BLOCKED**: there is no gamepad input path in `packages/game/src/input/` at all — the camera
side is ready (the director takes raw look deltas as data and its smoothing is already frame-rate
independent), but the plumbing is a separate plan touching input, controls config and the touch harness.

**Open questions**: dead-zone shape (radial vs per-axis), whether look sensitivity gets its own gamepad
scale (it must — pixels and stick units are not the same quantity), and whether the input damper
(`inputSmoothTime`) should apply to a stick at all: a stick is already continuous, so it may only need the
rate limit, not the pool.

## Not here on purpose

- **First-person and the C-key preset ring** are not an idea — they are [plan
  080/08](../../plans/080-cinematic-camera/08-view-presets.md), scheduled.
- **The landing dip** is implemented and shipped OFF (it never read at a third-person orbit); it is
  expected to earn its place inside 08's first-person preset rather than as a new idea.
- **Multi-ray collision** and the **overhead "On Top" fallback** died in the field —
  [`docs/postmortem/080-cinematic-camera/`](../../postmortem/080-cinematic-camera/) holds why.
