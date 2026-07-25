# Postmortem: camera collision approaches that were rejected

Plan 080/04 collision ships a **single sphere CAST** that pulls the eye in on the first hit (near-plane cap,
commit `4316967`). Two richer models were explored to answer the same two field complaints; both were
rejected. Recorded here so neither is re-run from scratch.

The two complaints that drove the search:

1. Driving through the city, the camera reacts to every pole/sign/tree between the car and the eye and
   constantly re-adjusts (the cast reacts to anything on the subject→camera LINE).
2. When the camera does hit a real wall it PULLS IN toward the subject, where a SLIDE (keep distance, move
   along the wall) would feel better.

---

## Approach 1 — a kinematic sphere COLLIDER (move-and-slide). ✗ REJECTED by reasoning (2026-07-25)

Never coded. A physical camera collider is the wrong tool, even though it seemed to fit the "slide, don't
pull in" wish.

Give the camera its own kinematic ball collider and move it with Rapier's `computeColliderMovement`
(character-controller step) each frame: it would react only to what the camera itself TOUCHES (a pole between
subject and camera, past the sphere, is ignored) and SLIDE along walls keeping distance. On paper it answers
both complaints, and On Top (lift overhead, no upward cast) was the intended fallback when boxed in.

**Why rejected — before any code:**

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

---

## Approach 2 — the multi-ray fan (centre + 4 corners, react only to full occlusion). ✗ REJECTED by field (2026-07-25)

**Built and reverted the same day.** Code lived in commit `811bca9`; reverted in `e1541ec`. This was the
"kept instead" answer after Approach 1 was ruled out — and it turned out worse than the single cast it
replaced, so it is a postmortem, not a reserve lever.

**What it did:** `resolveCollision` cast a 5-ray fan — CENTRE + 4 CORNERS offset by the subject's silhouette
radius (`subjectRadius`, ped framing radius / car half-extent) along the camera's `screenBasis` right/up —
and pulled the eye in ONLY when EVERY ray hit an obstacle closer than the desired distance (a wall spanning
the whole silhouette), capping at `min(hits)`. Any clear ray (a pole thinner than the subject) → no pull-in.
The intent was to ignore poles/signs (complaint 1) while still reacting to real walls.

**Why it was rejected — the field verdict (user):** approaching a house *on foot*, **the camera immediately
starts JUMPING instead of sliding** — the single worst collision behaviour of the whole chain.

**Why it jumps (the root cause):** the "all rays hit" gate is **DISCONTINUOUS**. A single sphere cast reports
a continuously shrinking distance as you approach a wall, so the eye eases in smoothly — it *slides*. The fan
instead flips the whole response between two states — "ignore" (distance = desired) and "full pull-in"
(distance = `min(hits)`) — the instant the last/first corner ray catches or loses the wall. Real house
facades are not clean infinite planes: they have door/window recesses, columns, edges, a stoop. As the player
walks toward one, the 4 corner rays (spread ~0.45 m off the eye line) catch and lose those features at
different moments, so the all-hit gate toggles rapidly and the distance snaps between full and none →
visible jumping. The very feature meant to *reduce* reactions turned a smooth ease into a binary flicker.

**Deeper lesson:** a hard "all N rays / none" boolean over a moving fan is the wrong shape for a feel channel —
it has no continuous middle, so it cannot ease. Anything replacing the single cast has to stay a *continuous
function of approach distance* (e.g. a weighted/soft coverage that varies smoothly, not a boolean gate), or it
will jump. A single continuous cast already has that property, which is why it feels better despite being
"dumber".

---

## What we kept

The simple **single sphere cast + near-plane cap** (commit `4316967`, the state 080/04 ships):

- One sphere cast (radius `collisionRadius` 0.35) from the look point along −forward; whiskers OFF (they fired
  on objects BESIDE the subject).
- Asymmetric response — snap IN, `damp` OUT over `collisionReleaseTime`; CAPS the distance so the chosen zoom
  restores after the occlusion.
- Floor = `collisionMinDistance` (the near-plane radius 0.5): a wall closer than that pulls the eye up to the
  surface (may clip the ped a frame) but never slides BEHIND the wall and never stalls.

Accepted trade-offs it lives with: it reacts to thin poles on the sight line (complaint 1 unsolved), and a
very close wall behind the player can clip the camera into the ped a touch. Both were judged better than the
alternatives above.

## When to revisit

- **The pole problem (complaint 1)** needs a model that is a *continuous* function of how much of the subject
  is occluded — a soft coverage weight, not the boolean all-hit gate that jumped. Absent a design that keeps
  the ease, the single cast is the answer.
- **True wall-SLIDE framing (complaint 2)** only a physical body gives, with the sticking/jitter/tunnelling
  mitigation Approach 1 lists — a large investment, only if a field round wants it badly enough.
- **The into-the-ped clip on a genuine full pin** (a wall hard behind the subject, no room) could be answered
  by an **"On Top" fallback**: as the allowed distance collapses, ease the pitch up toward a top-down framing
  so the subject stays visible from above instead of the eye clipping into the model. Cheap (a pitch/height
  blend, no extra casts — and deliberately NO upward cast, so an indoor ceiling clips through, an accepted
  edge case). The risk is feel, not cost: it must BLEND with hysteresis (or it flips between behind-view and
  overhead in a tight alley) and ease back the moment open space returns. Only worth building if a field
  round finds real full pins frequent enough that the clip annoys.
