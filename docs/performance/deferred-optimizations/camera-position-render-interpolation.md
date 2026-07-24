# Render interpolation for the camera position weight

**Status:** in reserve — the correctness path, not a speed one. The camera's POSITION smoothing (plan
080/02 behaviour #3, plus vertical follow softness) ships OFF (`positionLagTime`/`verticalLagTime`/`deadZone`
= 0) because there is no render interpolation, and a position spring without it judders.

## What we do today

Physics steps at a fixed 1/60 in `runFixedSteps` (`engine-canvas-host.tsx`). The ped pose, the camera focus
and the drawn vehicle transform all read the physics state in the VARIABLE-rate render loop. At 120 Hz that
means every other frame does no physics step, so the framed object's position is a stair-step. The camera
position tracks it RIGIDLY (config zeros), so the object and the camera move in lockstep — no judder, but no
weight either. Rotation, zoom and look-ahead are still smoothed (they do not fight the saw), and look-ahead
reads a `damp`-smoothed focus velocity so its offset does not stutter.

## The lever

Interpolate the render pose between the last two fixed states: keep `prev` and `cur` for every drawn
physics body, compute `alpha = accumulator / FIXED_STEP` after the catch-up, and draw the ped, each vehicle,
and the camera focus at `lerp(prev, cur, alpha)` (slerp for orientation). The focus becomes CONTINUOUS, so a
position spring smooths real motion instead of the fixed-step saw — and the object, drawn on the same
interpolated pose, stays in lockstep with the smoothed camera.

## What it would win

The position "weight" the follow rig was built for: the camera trailing a sharp direction change and easing
back, and the vertical softness that keeps stairs/curbs/jump arcs from jolting the horizon. Turn
`positionLagTime` (~0.12) and `verticalLagTime` (~0.28) back on and they work as their tests already
describe. It also smooths every OTHER drawn body at high refresh, not just the camera — the ped "doubling"
at a run is the same saw seen directly.

## What it would cost

- `prev`/`cur` storage and a lerp for every drawn physics body each frame — cheap per body, but it spans the
  ped pose path (`posePlayer`), the vehicle draw (`vehicle-physics.system` `setTransform`), and anything
  else drawn from a body (props?). Every such path must interpolate or it desyncs from the ones that do.
- One-frame-of-latency framing: interpolation draws BETWEEN the two latest states, i.e. ~one fixed step
  behind "now". Standard and invisible at 60 Hz+, but it is a real semantic change to the render pose.
- Care at teleports/respawns/vehicle entry — the same jumps the camera already guards must reset `prev` so
  the lerp does not sweep across the map for a frame.

## What would have to be true to pull it

- A field round wants the position weight badly enough to justify touching the ped + vehicle draw paths,
  OR the ped "doubling" at a run is judged bad enough on its own (it is the same root cause, so this fixes
  both at once).

## Cheaper things to try first

- Live-tune the rotational feel (auto-center, look-ahead, input smoothing) on the Camera tab — most of the
  "cinematic" read is rotation + FOV, and all of that is already smoothed and jitter-free.
- If only the ped doubling matters, interpolating JUST the ped pose (host-only, no vehicle path) is a much
  smaller change than the full sweep.
