# Pedestrian route on a vehicle graph

**Live.** Taken 2026-07-31 with plan 096/07 (video mode's walk scene).

## What it is

`apps/web/src/ui/video/walk.ts` + the walk scene's route constraints in `engine-video-runs.ts`:

```ts
export const WALK_LANE_OFFSET = 6.5;  // m right of the ROAD CENTRE — "roughly where a pavement is"
const WALK_ROUTE = { laneOffset: WALK_LANE_OFFSET, maxTurnDeg: 100, maxWindowTurnDeg: 200, preferTurnDeg: 40 };
export const WALK_GROUND_DROP = 3;    // no ground within this below a waypoint ⇒ the route is rejected
```

A showcase walk is a DRIVING route pushed 6.5 m to the right of the carriageway and walked. The lane offset
is the whole of the "pavement": there is no pavement in the data, only a number that usually lands on one.

## What it stands in for

SA's own pedestrian paths. The game ships them — the `NODES*.DAT` files carry ped node types alongside the
vehicle ones, and SA's peds walk a genuine pavement network with crossings — and **we do not parse them**.
`packages/game/src/adapters/path-graph.ts` reads the vehicle graph only, which is what plan 096/01 needed and
all any scene has had since.

The honest fix is to parse the ped nodes and build the walk route on the network the game itself walks peds
along. Nothing about that is hard; it simply was not what 096 was about.

## What it was judged on

A headless walk scene in San Francisco (seed 47, scene 8, 2026-07-31): a 160 m route, 62 of 82 waypoints
ground-probed (the rest outside the streamed collision ring), 0 rejections, the ped walked the whole thing
and the five cameras all framed him — `safe: 1.000` over 3 844 judged frames. That is the instrument saying
"a person walked down a street and was in shot". **It is not a human saying the route looked like a
pavement**, and nobody has watched a walk scene yet.

Two things it is known NOT to handle:

- **Furniture.** The ground probe rejects verticality — a waypoint over water, a bridge parapet, a void — and
  nothing else. A route that clips a bench, a lamppost or a set of building steps passes every check we have.
- **Anything the road has no pavement beside.** A tunnel mouth, a freeway shoulder, a desert verge: 6.5 m
  right of the centreline is dirt, a wall, or a drop. The ground probe catches the drop and not the other two.

## What would retire it

Parsing the ped nodes out of `NODES*.DAT` and giving `route-graph.ts` a pedestrian graph to walk. The walk
scene would then ask for a route the same way it does now, and this file's three constants would go with it —
`laneOffset` included, because a ped node already IS on the pavement.

## What else moves if it changes

- The walk scene's route length is derived from the ped's configured `walkSpeed`, not from this; a pedestrian
  graph changes WHERE the route goes, not how long it is.
- `WALK_STATION_LATERALS` (2.5-8 m) are measured off the walked line. On a real pavement network the same
  numbers mean the same thing, so the tripods carry over unchanged.
- The ground-probe rejection stays useful either way: a ped node over a collapsed piece of collision is still
  a route nobody can walk.

See also `docs/edge-cases/route-graph.md` (what the graph does and does not carry) and
`docs/features/video-mode.md` (the scene that uses it).
