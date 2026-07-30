# Road graph and route builder (096) — edge cases

Current limitations of the drivable-route layer (`packages/game/src/paths/`, read by video mode). Read
alongside [`docs/features/video-mode.md`](../features/video-mode.md).

## A dense city GRID yields no route at all

The builder rejects a walk whose turns exceed 45° accumulated over any 25 m window (096/01, the constraint
that moved the tightest driven corner from 2.0 m to ~19 m). Downtown Los Santos is a right-angle grid whose
blocks are shorter than that window, so **every** walk out of it dies as `too-tight`.

Measured 2026-07-30 (096/04): pinning video mode to downtown LS (`?video=1&at=1450,-1500`) produced **0
accepted routes in 40 tries per scene, across 5 scenes** — the runner said so each time and fell back to a
seeded route elsewhere. The same pin one district over (`&at=847,-1772`, the hardest accepted LA start that
`scripts/debug/video-routes.ts --worst` prints) accepted immediately, every scene.

Consequences:

- **A pinned field round can silently be a run somewhere else.** The fallback is logged
  (`no route out of the pinned start in 40 tries`) — grep for it before believing a pinned capture.
- Video mode's Los Santos scenes are biased toward open, sweeping roads. That is the turn budget's doing,
  not the sequencer's, and loosening it is 05's variety knob (`maxWindowTurnDeg`).
- Anything that wants a route through a city grid — a walk scene, a curated route list — needs its own
  constraint set, not the drive-scene one. The constraints are already parameters
  (`RouteConstraints`), so this is a caller's decision and not a builder change.

## Travel DIRECTION is not expressible from the link table

The graph's links are 100 % mutual (096/01 measured: 0 links without a reverse edge over 30 587 vehicle
nodes), so a route may be walked the wrong way up a one-way street. SA keeps lane direction in the navi
nodes, which are not parsed. Nothing catches this — it needs a human watching the footage.
