# The `strip-noon` bench anchor has no floor — a player put there falls out of the world

**Status: OPEN, measured 2026-08-09 (plan 102 step 3). Deterministic. It costs one of nine bench rows.**

## The symptom, in the row that reports it

`strip-noon`'s anchor is `[1934, 1177, 14]` — "South Strip at street level (the Flamingo/Pirate block)",
added 2026-07-29 for the casino district's density. The plan-102 settle probes the ground under that anchor,
gets an answer, warps the player onto it, and then waits for him to come to rest. He never does:

| Run | `legStart.targetZ` | `dz` | `grounded` | `worstDrop` |
| --- | --- | --- | --- | --- |
| A/A arm 1 (2026-08-09) | 14.00 | −897.25 m | false | 4.66 m |
| A/A arm 2 (2026-08-09) | 14.00 | −895.04 m | false | 4.66 m |

Every other scene in the same sweeps reports `dz −0.08 m`, `grounded true`, `worstDrop 0`. The two arms agree
to ~2 m out of 900, so this is not a race — it is the same fall every time.

## What is known

- **`groundBelow([1934, 1177, 14], 60)` answers `13.00`** — a suspiciously round number — so the settle
  places the capsule at `14.00` and it falls straight past whatever the ray hit. The probe ray is a line; the
  capsule is a 0.35 m radius body that also has to be supported where it lands.
- The fall does not end. With the rest gate waiting its full 12 s budget the player reaches ~900 m below the
  anchor, so there is no surface under that spot at all within reach.
- It is not the plan-102 settle: before that chain existed the same anchor produced a 1.5 s free fall
  (`dz −11.16`, the warmup's worth) with identical numbers across runs
  ([`benchmarks/opensa-engine/2026-08-09-ingame-102-probe-arm-a.json`](../benchmarks/opensa-engine/2026-08-09-ingame-102-probe-arm-a.json)).
- The scene's own comment records a 093 field round that teleported here as `&spawn=1934,1177` — **with no
  Z**, i.e. asking the game to ground-snap. The bench anchor's `14` is authored by hand. Whether the real
  street there is at a different height, or the spot sits inside a casino footprint, is not yet established.

## Why it is not being "fixed" by moving the anchor

Moving a scene anchor to dodge a hole is exactly the workaround that hid this class for a month: the
`ocean-horizon` anchor was moved "ON the sand" on 2026-07-10 because "an over-water anchor drops the player
into the sea and the run never settles", and that comment turned out to be the datestamp of the settle bug
nobody had looked at (plan 102). A per-scene workaround for a world-level fact is a note nobody reads.

**Nothing is contaminated while this is open**: `legStart.ok` is false on that row, the sweep prints a
`[fall]` line, and the readme rule already says a red row's cost columns compare nothing.

## Where to pick it up

1. Field probe the spot in the real game: `?spawn=1934,1177,14` versus `?spawn=1934,1177` (ground-snapped),
   and read `#engine-hud` for the resting Z. That answers "is there a street there at all" in one run.
2. If there IS a street: find what the ray hit at exactly `13.00` — `scripts/debug/` has the collision
   probes, and a collider the capsule cannot rest on (thin shell, one-sided trimesh, a removed cell body) is
   a converter-side finding, not a scene-side one.
3. If there is NOT: the anchor was authored against a world state that no longer exists, and the honest fix
   is to derive the anchor's Z from the built collision rather than to retype a number.
