# Surveying camera stations at RUNTIME instead of baking them into the pak

**Status:** in reserve — costs almost nothing today (205 casts across 25 scenes, ≤ 3 in any frame), and the
alternative would put a camera decision into the build, where a modded map could never move it.

## What we do today

A tripod shot's stand is chosen live (plan [096/04](../../plans/096-video-mode/04-stations-and-occlusion.md),
`apps/web/src/ui/video/stations.ts`). While the shot BEFORE it plays, the survey walks a seeded list of
candidates around the driven line — 8/11/14/18 m to either side, three height classes — and spends up to
three casts a frame on them: one `groundBelow` to snap the candidate to whatever is under it, then a
`pathClear` against each of five predicted car positions across the shot's window. The first candidate to
clear four of five and hold the car within reading distance wins.

Measured over 5 seeds × 5 scenes (096/04's ledger): **205 casts total**, never more than **3 in a frame**, a
verdict inside **14 frames**, 12 of 12 tripod slots filled.

## The lever

Bake the answer. `opensa-pack` already walks the whole map with collision available, and the road graph is a
build-time input too — so a build could emit, per road segment, a handful of pre-validated camera stands with
their sightline coverage, and the runtime would read a table instead of casting anything at all.

## What it would win

The cast budget, entirely: 3/frame → 0/frame during a survey, and the ~0.2 s of survey latency disappears
with it. In frame-time terms this is close to nothing today — `pathClear` is a single Rapier ray and the
survey only runs during one shot in four — so the honest win is **headroom**, not milliseconds: it is what
would let a scene run several tripods at once (a multi-camera scene, roadmap material) without touching the
080 five-casts-a-frame ground rule.

## What it would cost

- **A camera decision moves into the build.** `docs/restrictions/build-vs-runtime.md`'s whole subject: a
  baked stand cannot know that a mod added a wall, moved a building or replaced the road. The survey exists
  precisely because the world it films is the merged, modded one.
- **A new pak product** to version, invalidate and keep in step with the map — for a feature that is not
  shipped in the game.
- **The dwell and framing tests are per-SHOT, not per-place**: the window a station is judged over depends on
  the fragment length, the car's speed and where the scene happens to start, none of which exist at build
  time. A baked table could only pre-filter geometry, so the runtime would still need the window pass.

## What would have to be true to pull it

- A scene wanting **several simultaneous tripods**, or the survey running for every shot rather than one in
  four, pushing past the 3-cast budget.
- Or a measured frame-time cost: today's survey has never appeared in a `[slow]` line.
