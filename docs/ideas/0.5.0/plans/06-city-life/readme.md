# 06 — City Life (THE flagship feature chain)

**The most important system we will build (user, 2026-07-12):** a living city — traffic and pedestrians
with REAL routes, real trains, traffic lights and rail barriers, visible into the distance — running on
the OpenSA engine AND, through an ASI twin, inside real SA. Everything fast.

## The architecture in one picture (the AAA pattern)

Every big open-world game solves city life the same way — **simulation LOD rings around the player**, with
agent IDENTITY preserved across rings (this is what makes it feel alive instead of spawn-despawn soup):

```
Ring 0  FULL       ~0–120 m   real vehicles (physics, 0.4.0/07), skinned peds, light compliance, collisions
Ring 1  KINEMATIC  ~120–500 m spline-followers on the lane graph — no physics; vehicle_vlo / ped LOD meshes
Ring 2  FLOW       ~0.5–3 km  agents are DATA (position on a path segment + speed); rendered as light
                              coronas / micro-billboards — the GTA-V "rivers of headlights" effect
```

References mined for the design: Insomniac's Spider-Man traffic GDC talk (lane graph + hierarchical agent
LOD + far traffic as lights), GTA V's ambient population (density maps per zone/time, distant headlight
streams), Cyberpunk 2077 / AC Unity crowd systems (imposter tiers, budgeted promotion), Cities: Skylines
(agents on a graph at scale). The unifying rules we adopt:

1. **One data model, three consumers**: the lane/path graph + agent state drives ring 0/1/2 rendering AND
   the SA ASI — simulate once, render appropriately per ring.
2. **Data-oriented agents**: SoA typed arrays (position-on-segment, speed, seed, kind), fixed per-ring
   budgets, zero per-agent allocation at steady state; the sim tick is worker-friendly by construction.
3. **Deterministic identity**: every agent = (seed, route) — promotion between rings re-materializes the
   SAME car with the same colour on the same route (every agent owns its route — the core ask); nothing pops into existence
   in view.
4. **The intersection is the unit of traffic logic**: lights, yielding, rail barriers — all arbitration
   happens at graph nodes, agents only obey.

## The chain

| #   | Plan                                       | What                                                                                                                                       |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | [path data model](01-path-format.md)       | SA nodes/tracks import → OUR path format (lanes, lights, spawn density, train tracks) — the single source both the engine and the ASI read |
| 02  | [path editor](02-path-editor.md)           | separate app (viewer-family): visualize/edit/validate the graph over the map                                                               |
| 03  | [traffic sim core](03-traffic-sim.md)      | agents, rings, promotion/demotion, routes, intersection arbitration                                                                        |
| 04  | [lights & barriers](04-lights-barriers.md) | traffic-light controllers + railroad crossing state machines                                                                               |
| 05  | [trains](05-trains.md)                     | real trains on real tracks with schedules and crossings                                                                                    |
| 06  | [pedestrians](06-peds.md)                  | sidewalk graph, zone/time density, ped LOD chain                                                                                           |
| 07  | [far rendering](07-far-rendering.md)       | vehicle_vlo + corona streams + ped imposters — the ring 1/2 visuals                                                                        |
| 08  | [SA ASI twin](08-sa-asi-twin.md)           | hide vanilla population in real SA, drive it from OUR format, far draw for cars/peds                                                       |

## Order & dependencies

01 (format) → 02 (editor, can start on the importer's output) → 03 (sim core on the engine) →
04/05/06 in any order (each consumes 03) → 07 (visual tiers; corona pass already exists in 074) →
08 (the ASI twin — after the format and sim semantics are proven in the engine).

## Performance gates (set now, measured per plan)

- Sim tick ≤ 2 ms for the full ring set (target: ring 2 = thousands of agents as flat array math).
- Ring 1/2 rendering rides EXISTING 074 passes (instancing + corona pass) — new pipelines only if measured.
- Zero steady-state GC pressure from the sim (the 073 heap lesson applies to gameplay too).
