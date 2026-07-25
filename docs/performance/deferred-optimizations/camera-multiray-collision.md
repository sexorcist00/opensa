# Camera collision — multi-ray (PULLED) + the "On Top" fallback (in reserve)

**Status:** the multi-ray fan was **PULLED 2026-07-25** (plan 080/04 — shipped, see below). The "On Top"
overhead fallback for a genuine full pin stays **in reserve** — this file now tracks that remaining lever.

## Multi-ray fan — SHIPPED 2026-07-25

The single sphere cast reacted to every thin pole/sign/tree on the sight line, so city driving jittered
constantly. Replaced with a 5-ray fan in `resolveCollision` (`apps/web/src/ui/camera/camera-collision.ts`):

- **Centre + 4 corners** (5 sphere casts, radius `collisionRadius`), the corners offset by the subject's
  silhouette half-width (`CameraSnapshot.subjectRadius`) along the camera's `screenBasis` right/up.
- The subject radius is the ped framing radius on foot (`PED_SUBJECT_RADIUS` 0.45) or the car's larger planar
  half-extent + `VEHICLE_SUBJECT_MARGIN` while seated (host `cameraSubjectRadius`).
- **Pull in ONLY when every ray hits** something closer than the desired distance (a wall spanning the whole
  silhouette); the distance caps at `min(hits)`, floored at `collisionMinDistance`. Any clear ray (a pole
  thinner than the subject) → no pull-in, the camera drives past and the pole sweeps a slice of the frame.
- Centre is cast first, so the fan early-exits on the most common miss (~1 cast in the open).

Cost as predicted: ≤5 sphere casts on the ONE render-frame camera step, **< 0.05 ms**, below bench noise
(soak/ritual numbers unchanged — the bench owns the frame and the rig output is discarded). Whiskers and
`collisionWhiskerAngle` were removed (the fan subsumes them). **Accepted trade-off**, unchanged: a wall
covering only part of the silhouette (some rays clear) is ignored, so the camera can enter a partial wall a
little — the deliberate meaning of "react only to full occlusion".

## The "On Top" fallback (a companion idea, not a replacement)

When the camera IS fully occluded and pinned (a real wall hard behind the subject, no room to sit behind it),
today's stop-point clips the eye into the ped a touch. A nicer fallback: **lift the camera overhead** — ease
the pitch up toward a top-down framing as the allowed distance collapses, so the subject stays visible from
above instead of the camera clipping into the model or sitting behind the wall. It is orthogonal to the
multi-ray lever: multi-ray decides WHEN to react (less often), On Top decides WHAT to do at a genuine full
pin.

**Overhead does NOT cast upward** (user's call): if there's a ceiling above the subject (indoors), the
overhead camera clips through it — that's an accepted edge case, not worth a vertical cast. This keeps On Top
cheap: no extra rays, just a pitch/height blend.

Caveats to settle before building it:

- **Blend, don't snap.** Drive the pitch toward top-down proportionally to how pinned the camera is, with
  hysteresis, or it flips between behind-view and overhead in a tight alley.
- **Camera-relative movement** degenerates at top-down (forward projects to ~0); the controller already has
  a stable-axis fallback, so it won't break, but movement feel changes overhead.
- **Recovery**: ease the pitch back down the moment open space returns.

## What would have to be true to pull On Top

- Multi-ray shipped (done) made genuine full pins rare, as expected. Pull On Top only if a later field round
  finds real full pins (a wall hard behind the subject, no room) still frequent enough that the current
  into-the-ped clip annoys. Then overhead is the graceful answer to a true full occlusion.
