# Camera "On Top" fallback — lift overhead on a genuine full pin

**Status:** in reserve — a camera-feel idea, never coded. (It was originally filed alongside the multi-ray
fan; that fan was built, field-rejected, and moved to
[`docs/postmortem/camera-collision-approaches.md`](../../postmortem/camera-collision-approaches.md). On Top
is the one part still worth keeping.)

## What we do today

Plan 080/04 ships a single sphere CAST with a near-plane cap (`collisionMinDistance` 0.5): a wall closer than
that pulls the eye right up to the surface. When the camera is fully pinned — a real wall hard behind the
subject, no room to sit behind it — today's stop-point clips the eye into the ped a touch.

## The lever

When the camera IS fully occluded and pinned, instead of clipping into the model, **lift the camera overhead**
— ease the pitch up toward a top-down framing as the allowed distance collapses, so the subject stays visible
from above. It decides WHAT to do at a genuine full pin; it does not change WHEN collision reacts.

**Overhead does NOT cast upward** (user's call): if there's a ceiling above the subject (indoors), the
overhead camera clips through it — an accepted edge case, not worth a vertical cast. This keeps On Top cheap:
no extra rays, just a pitch/height blend.

## What it would cost

- No extra casts — a pitch/height blend driven by how pinned the camera is. Effectively free.
- The feel work is the risk, not the perf:
  - **Blend, don't snap.** Drive the pitch toward top-down proportionally to how pinned the camera is, with
    hysteresis, or it flips between behind-view and overhead in a tight alley.
  - **Camera-relative movement** degenerates at top-down (forward projects to ~0); the controller already has
    a stable-axis fallback, so it won't break, but movement feel changes overhead.
  - **Recovery**: ease the pitch back down the moment open space returns.

## What would have to be true to pull it

- A field round finds real full pins (a wall hard behind the subject, no room) frequent enough that the
  current into-the-ped clip annoys, AND the blend/hysteresis feel work is worth it over just living with the
  clip. Absent that, the simple near-plane cap is the accepted stop point (see
  [`docs/features/camera.md`](../../features/camera.md)).
