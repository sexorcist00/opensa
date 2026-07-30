# 096/01 — Path graph + seeded route builder (offline-first)

**Priority P0. Ships alone: a debug script that prints validated candidate routes per region, plus the
parser/graph/builder code under test. No engine or host changes.**

## Why first

Everything downstream consumes a route. Building and validating routes OFFLINE (a node script over the
same data the game reads) means the route heuristics are argued about with printed numbers before a
single in-game frame — the same measure-first method that paid for itself in 084 and 095.

## What exists

- `vehiclePathNodes(areas)` (`packages/renderware/src/parsers/binary/paths.ts`) parses `NODES*.DAT` into
  flat `VehiclePathNode { area, id, position, heading, linkCount, boats }` — but `parseArea` builds the
  link table `[area u16, node u16]` (`paths.ts:98-103`) and THROWS IT AWAY; each node keeps only a
  first-link bearing. No traversable graph exists.
- `scripts/debug/road-straights.ts` proves geometric node-hopping over this data works (heading-tolerance
  hop, 40 m grid hash) — it found the phys-scene straights. It reconstructs adjacency geometrically
  because the parser hides it; this phase makes that unnecessary.
- `roadCarPlacements` (`packages/game/src/adapters/road-cars.ts`) shows the conventions: skip `boats`,
  lane offset 2.5 m to the RIGHT of node heading, deterministic seeding by position.

## Tasks

1. **Expose adjacency in the parser.** Extend `vehiclePathNodes` output (or add a sibling
   `vehiclePathGraph`) so each node carries `links: { area, node }[]` — the data `parseArea` already
   reads. Keep the existing shape backward-compatible (`road-cars.ts`, `road-straights.ts`, tests).
   Extend `paths.test.ts`: synthetic areas assert cross-area links resolve; the real-install check
   asserts a known node's degree.
2. **Pure graph ops** — `packages/game/src/paths/route-graph.ts` (NO renderware import; plain data in):
   node lookup by id, neighbour iteration, nearest-node-to-point (grid hash, reuse the `road-cars.ts`
   hashing idiom), and `walkRoute(graph, startNode, rng, constraints)` returning a polyline of nodes.
3. **Adapter** — `packages/game/src/adapters/path-graph.ts`: `loadRouteGraph(fs)` reads
   `data/paths/nodes{0..63}.dat` (same file loop as `road-cars.ts:56-61`), returns the graph. Lives in
   `adapters/` because it imports renderware (the lint boundary).
4. **Route builder** (in `route-graph.ts`) — seeded, constraint-driven, DERIVED from the data (no
   hand-placed coordinates):
   - target length `L = toSeconds × cruiseSpeed × 1.3` (margin for the speed ramp; cruise ≈ 12 m/s v1);
   - prefer straight continuations: at each junction score candidates by turn angle, hard-reject hops
     > `maxTurnDeg` (start 35°), soft-prefer < 15° (D5: long straights, gentle curves);
   - reject `boats` nodes and dead ends shorter than the remainder;
   - no node revisits (no loops through the same junction);
   - region containment (D15): accept only nodes inside the scene's region — region classification is a
     predicate passed IN (phase 05 supplies it from zone data; the offline script uses the same one);
   - output: ordered world-space polyline + per-vertex target speed from local curvature
     (`v = min(vCruise, sqrt(aLatMax / κ))`, `aLatMax` start 2.5 m/s² — calm cruise, D8) + the lane
     offset already applied (2.5 m right, the `road-cars.ts` convention), plus a corner-smoothed
     spline view for the follower (SA links are polylines; smoothing = Chaikin or arc-fillet at
     junction vertices, radius capped by lane offset).
5. **Seeded RNG** — `mulberry32`-style, one implementation, seed threading through every choice
   (start node, junction picks). Lives with the graph (pure); the app re-exports it later.
   `Math.random` is banned in the module by construction (D9 reproducibility).
6. **Offline validation script** — `scripts/debug/video-routes.ts` (KEPT, debug README row): for a given
   game dir, region predicate and seed, print N candidate routes with their numbers (length, straightness
   histogram, max turn, min curve radius, node count) and reject stats. This is the tool the field
   rounds of 02 will use to pick a hard-corner route deliberately.
7. **Tests** (deterministic; negative describe first per project rules): graph ops on synthetic areas;
   builder rejects loops/region-exits/sharp turns; same seed → identical route; real-fixture check via
   the existing manifest pattern if a NODES fixture is available (`real-fixtures-over-synthetic-tests`).

## Acceptance / verification

- `npm run test` green; lint/tsc clean.
- `video-routes.ts` over `build/original/opensa` prints ≥ 20 accepted routes per region for 5 seeds with
  0 region-exit violations and max turn ≤ 35°.
- Record in the readme ledger: routes accepted/rejected per region, mean length vs target, worst min
  curve radius.

## Risks / notes

- Link table crosses NODES area boundaries — the synthetic test must cover a cross-area link explicitly
  (the parser already resolves them for the heading hint).
- Node density differs wildly between city and desert; the length target may be unreachable in sparse
  areas — the builder returns its best route WITH its achieved length, and the sequencer (05) shortens
  the fragment rather than looping a bad route.
