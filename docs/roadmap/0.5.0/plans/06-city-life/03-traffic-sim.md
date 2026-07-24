# 06·03 — Traffic simulation core (agents, rings, routes)

[← chain](readme.md) · prev: [02 editor](02-path-editor.md)

The heart. One simulation, three fidelity rings, agent identity preserved throughout.

## Agent model (data-oriented, the non-negotiable part)

SoA typed arrays per ring, budgeted: `routeId, segmentIndex, s (metres along segment), speed, seed, kindId,
laneIndex, state`. An agent's LOOK (model, colour) and BEHAVIOUR profile derive deterministically from
`seed` — a demoted-then-promoted agent re-materializes identically ("its own route" is literal: the route
is regenerated from the seed + route table, not stored per agent beyond the id).

## The rings

- **Ring 2 (FLOW)**: pure array math — `s += speed × dt`, junction choice = seeded hash, car-following =
  clamp speed to the agent ahead on the same lane (one sorted pass per busy segment). Thousands of agents;
  this is where "the city is alive to the horizon" comes from. Output: positions for plan 07's far pass.
- **Ring 1 (KINEMATIC)**: same graph-following, plus smoothed curves (link beziers), lane changes,
  light/stop compliance (from plan 04 controllers), simple gap acceptance at junctions. Rendered as
  vehicle_vlo / ped LOD meshes (07).
- **Ring 0 (FULL)**: hands the agent to the gameplay layer — real vehicle (0.4.0/07 physics) with an AI
  driver that FOLLOWS the same route (target-point chase along the lane spline); peds get the full skinned
  path. The driver AI stays thin: the graph and controllers make the decisions.
- **Promotion/demotion**: ring boundaries follow the camera with hysteresis (the streaming-driver pattern —
  same discipline, same lesson: follow the PLAYER, atomic swaps, budgets per frame). Demotion serializes
  the agent back to its array row; promotion re-materializes. Off-screen bias: promote in the view frustum
  first (AAA norm: fewer full agents behind the camera).

## Routes (every agent owns its route — the core ask)

- Route = seeded walk over the lane graph with purpose weights (through-traffic prefers big roads;
  residential seeds putter locally) — regenerable from (seed, entryNode, timeOfDay).
- Persistent SCRIPTED routes (missions, the user's parked-car style data) override seeded ones — the route
  table accepts authored entries (editor plan 02 can place them).
- Density fields (01) decide how many seeds are ALIVE per zone/hour — day/night traffic character shifts
  (popcycle semantics preserved).

## Tasks

- [ ] Agent SoA store + ring budgets + promotion/demotion machinery (with the frustum bias).
- [ ] Ring-2 flow tick (segment walk, seeded junction choice, per-lane follow clamp) — bench: 5 000 agents
      ≤ 1 ms.
- [ ] Ring-1 tick: bezier following, lane changes, light/stop compliance, gap acceptance.
- [ ] Ring-0 bridge: agent → gameplay vehicle/ped spawn with route-following driver AI; despawn → demote.
- [ ] Seeded route generator + authored-route table.
- [ ] Density-driven population control per zone/hour.
- [ ] Debug overlay in the game/lab: ring boundaries, agent counts, per-ring tick ms (the telemetry rule).
