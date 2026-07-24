# 06·04 — Traffic lights & railroad barriers

[← chain](readme.md) · prev: [03 sim](03-traffic-sim.md)

Intersections are the arbitration points: agents never negotiate with each other directly — they obey the
node's controller. This keeps the sim O(agents) instead of O(agents²).

## Traffic lights

- **Controller per intersection** (from the 01 format's intersection records): a phase table (phase →
  links-with-green, durations, all-red gaps), advanced by the game clock — DETERMINISTIC (same time →
  same phase city-wide; the SA feel of synchronized avenues comes free).
- **Compliance**: ring-1 agents sample their link's phase on approach (decelerate to the stop node, queue
  behind the leader); ring-0 driver AI gets the same query; ring 2 IGNORES lights beyond a stochastic slow
  factor at controlled nodes (invisible at that distance, saves the work — the AAA trick).
- **Visuals**: the physical traffic-light models are 2dfx light anchors we already collect — bind the
  corona colour per phase (red/amber/green) by matching light anchors to controller nodes at import time
  (nearest-controlled-node within a radius, editor-overridable). Distant lights = the corona pass showing
  the phase — the city breathes at night.

## Railroad barriers

- Crossing record (01) binds: a track segment window + the barrier objects + the road links it gates.
- State machine: `open → warn (bell/blink) → closing → closed → opening`, triggered by train presence
  windows from the schedule (05) — with a lookahead so barriers close BEFORE the train arrives.
- The gated road links get a virtual red phase while not-open — agents queue exactly like at lights.
- Barrier visuals: the crossing models are timed/animated objects — rotate the arm part via the dummy
  hierarchy (074/08 part transforms); SA's own barrier models have the pivot dummies.

## Tasks

- [ ] Controller runtime (phase tables, deterministic clock) + link-phase query API for the sim.
- [ ] Import-time binding: 2dfx light anchors ↔ controller nodes (+ editor override in 02).
- [ ] Corona-per-phase rendering hook (extend the 074 corona instance data with a phase-colour source).
- [ ] Rail crossing state machine + schedule lookahead + virtual red phases.
- [ ] Barrier arm animation via part transforms.
- [ ] Field acceptance: a junction cycles correctly at any hour; a crossing closes ahead of every train and
      reopens after; queues form and drain naturally.
