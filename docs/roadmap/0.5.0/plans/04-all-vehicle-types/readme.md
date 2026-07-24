# 04 — All land vehicle types (everything except air & water)

Extend the current car support to the full SA land fleet. Scope (user, 2026-07-12): cars are the baseline;
add motorbikes, bicycles, quads, trucks with trailers, buses/long vehicles, and the utility oddballs
(forklift, combine, mower, sweeper, tractor, golf cart, Caddy…). Aircraft and boats are explicitly OUT.

**Migration note:** rides on the vehicle-physics chain
([docs/plans/081-vehicle-physics/](../../../../plans/081-vehicle-physics/readme.md) — per-class presets
are its plan 07; the class-factor table it ships is this plan's preset seed) and on the 074 dynamics
layer (plan 08: dummy hierarchies, part flattening, damage states). Render side is engine-ready by then; this plan is mostly gameplay + data.

## Per-class work breakdown

| Class                                                | Physics specifics                                                                                                                 | Render/anim specifics                                                                                      | Data                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Motorbikes / quads                                   | two-wheel balance controller (lean into curvature, gyro damping, low-speed balance assist), rider mass shift, fall-off conditions | RIDER on the bike: seated skinned ped + handlebar IK-lite (plan 08 sampler covers pose clips), lean visual | bikes.ide handling lines, rider anim sets    |
| Bicycles                                             | pedal cadence ↔ speed, bunny-hop, stamina hook                                                                                    | pedal/leg anim sync to wheel speed                                                                         | same as bikes minus engine                   |
| Trucks + trailers                                    | hitch joint (Rapier revolute/spherical with limits), trailer stability (anti-jackknife damping), reverse articulation             | trailer as an own entity with the truck's carcols                                                          | trailer pairing table (which cab pulls what) |
| Buses / long wheelbase                               | steering geometry (wheelbase-aware turn radius), passenger capacity hook                                                          | door anims (dummy-driven — 08's dummy tree)                                                                | handling long-vehicle group                  |
| Utility (forklift, combine, mower, sweeper, tractor) | per-vehicle quirks: forklift mast (animated part + tiny physics lift), combine kill-zone, low max speed governors                 | extra animated parts via the dummy hierarchy (mast, brushes, reel)                                         | misc.ide part data                           |
| Tow/pickup specials (towtruck)                       | tow hook joint (reuse trailer hitch)                                                                                              | hook part anim                                                                                             | —                                            |

## Cross-cutting tasks

- [ ] Class registry: vehicle type → controller variant + preset (extends the 0.4.0/07 preset system).
- [ ] Rider/driver attachment framework: seat dummies → skinned ped mount points (bikes need it visibly;
      cars get proper driver posture for free).
- [ ] Hitch/joint framework (trailers, tow) with save/restore.
- [ ] Two-wheel balance controller (the hard novel piece — prototype FIRST on one bike, telemetry harness
      from 0.4.0/07 reused).
- [ ] Enter/exit + camera per class (bike mount, truck cab height, bus door) — gameplay layer.
- [ ] Per-class acceptance drives on the physics test track + user feel sign-off (same ritual as 0.4.0/07).
