# Postmortem: camera collision — the sphere-collider (move-and-slide) approach (REJECTED)

**Status: ✗ REJECTED by reasoning (2026-07-25).** Never coded. Recorded so the same idea is not re-run from
scratch: a physical camera collider is the wrong tool, even though it seemed to fit the "slide, don't pull
in" wish.

## The goal

Plan 080/04 collision ships a single sphere CAST that pulls the eye in on the first hit. Two field
complaints drove the search for a better model:

1. Driving through the city, the camera reacts to every pole/sign/tree between the car and the eye and
   constantly re-adjusts (the cast reacts to anything on the subject→camera LINE).
2. When the camera does hit a real wall it PULLS IN toward the subject, where a SLIDE (keep distance, move
   along the wall) would feel better.

## What was considered — a kinematic sphere COLLIDER

Give the camera its own kinematic ball collider and move it with Rapier's `computeColliderMovement`
(character-controller step) each frame: it would react only to what the camera itself TOUCHES (a pole between
subject and camera, past the sphere, is ignored) and SLIDE along walls keeping distance. On paper it answers
both complaints, and On Top (lift overhead, no upward cast) was the intended fallback when boxed in.

## Why it was rejected — before any code

- **Sticking in tight spaces (the killer).** The game is full of narrow nooks packed with objects (alleys,
  yards, interiors). A character controller wedged between colliders can fail to find a slide direction and
  gets stuck / behaves erratically. This is exactly where the camera must stay reliable, and it is the
  classic reason spring-arm cameras in Unreal/Unity use a sphere CAST, not a physical body.
- **Corner jitter** — the solver twitches the sphere on geometry seams.
- **Tunnelling** on a fast car (the sphere can skip a thin wall between frames).
- **Statefulness** — a collider carries position state that has to be reset on every teleport / respawn /
  vehicle entry, another failure surface.

A CAST has none of these: it is stateless, never wedges, and already computes the true sphere contact
(time-of-impact) — "real contact with a sphere" was never missing.

## What we kept instead

The `slide` behaviour dies with the collider (only a physical body gives it). We stayed on cast + logic:
**multi-ray (4 corners + centre)** — react only when the whole subject silhouette is occluded (a wall), ignore
partial (a pole). It is stateless (no sticking), cheap (≤5 casts/frame), and gives a PULL-IN, not a slide.
**SHIPPED 2026-07-25** (plan 080/04); the lever file
[`docs/performance/deferred-optimizations/camera-multiray-collision.md`](../performance/deferred-optimizations/camera-multiray-collision.md)
is marked PULLED and now tracks only the reserved On Top fallback.

## When to revisit

- If a future field round wants true wall-SLIDE framing badly enough to invest in sticking mitigation
  (robust slide-direction search + On Top as a guaranteed escape + damping + teleport resets), and accepts
  the jitter/tunnelling risk. Absent that, cast + multi-ray is the answer.
