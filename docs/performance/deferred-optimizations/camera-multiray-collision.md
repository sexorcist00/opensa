# Multi-ray camera collision (ignore small objects, react only to full occlusion)

**Status:** in reserve — a camera-feel improvement with a tiny, measured cost. Not pulled yet; the current
collision is a single sphere cast (plan 080/04), which reacts to every thin object.

## What we do today

One sphere cast (radius `collisionRadius` ~0.35) from the look point straight back along −forward. It is
binary — hit / no hit — so a thin pole, sign, tree or fence on the sight line is treated exactly like a
solid wall, and the camera pulls in on the full distance. Driving through a city (poles/signs everywhere)
makes the camera constantly re-adjust. Whiskers are already OFF for the same reason (they fired on objects
BESIDE the subject).

## The lever

Distinguish "an object covers the WHOLE subject silhouette" (a real wall → pull in) from "an object covers
only a slice" (a pole → ignore). Cast a small fan of rays instead of one:

- **4 corners + centre** (5 rays) from the look point, the corners offset by the subject's silhouette radius
  (car half-extent / ped capsule) projected onto the camera's right/up basis (`screenBasis` already yields
  that basis).
- **React only when ALL of them hit** an obstacle closer than the desired distance — that means the object
  spans the whole back/side of the subject (a wall). Cap the distance at `min(hits)`.
- If only some hit (a pole thinner than the subject), IGNORE — the camera visually slides past it; the pole
  covers a slice of the frame for a moment, which reads far better than the constant pull-in.

Optional hybrid for near-plane cover: use thin RAYS for the wall/not-wall decision, then a single sphere
cast for the exact distance once it's decided a wall is there (a thin ray has no width, so the near plane
could still clip between rays at a surface).

## What it would win

The city-driving jitter goes away: the camera stops reacting to poles, signs, thin trees, fences — only a
genuine wall square behind the subject pulls it in. This is the single biggest remaining collision-feel
complaint.

## What it would cost

- 5 rays/frame instead of 1 sphere cast. The camera steps ONCE per rendered frame (not the fixed loop), and
  a Rapier `castRay` is trivial at our collider density — the current single-cast collision already
  benchmarked as free (bench unchanged). 5 thin rays are still **< 0.05 ms/frame**, below noise. No perf
  concern.
- ~40–60 lines in `camera-collision.ts` + a couple of tests. No new physics API (`raycast`/`sphereCast`
  already exist). The host already has the subject half-extents (car `halfExtents`, ped capsule).
- **Accepted trade-off**: a wall covering only HALF the subject (2–3 of 5 rays) is ignored by the "all hit"
  rule, so the camera can enter that partial wall a little. That is the deliberate meaning of "react only to
  full occlusion" — fine for city play, worth knowing.

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

## Suggested order if pulled

1. **Multi-ray (4+centre) first** — it removes the actual complaint (city jitter) and makes a genuine full
   pin rare, so the current into-the-ped clip happens far less often and may become tolerable on its own.
2. **On Top second** — only if, after multi-ray, real full pins are still frequent enough that the clip
   annoys. Then overhead is the graceful answer to a true full occlusion.

## What would have to be true to pull it

- A field round confirms city-driving jitter is the priority (it is, per the 2026-07-25 rounds), and the
  simple single-cast stop-point (into-the-ped clip on a very close wall) is not good enough to ship.
