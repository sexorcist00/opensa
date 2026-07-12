# 06·05 — Real trains

[← chain](readme.md) · prev: [04 lights & barriers](04-lights-barriers.md)

Trains are the easiest "alive" win: fully deterministic, on rails (literally), visible from far away.

## Design

- **Track network** from `tracks*.dat` (01): polylines with arc-length parameterization — a train is
  `(routeId, s, speed)`; car N sits at `s − N × carLength` (chain kinematics, no physics).
- **Schedule**: authored in the editor (02) — per route: departure times, station stop list + dwell,
  cruise speed segments. Deterministic from the game clock: the 14:03 freight is ALWAYS at the same place
  at 14:07 — this is what makes crossings (04) able to close ahead of time, and what players subconsciously
  read as "real".
- **Consists**: seeded composition per departure (engine + N cars from the SA train model pool: brownstreak,
  freight flats/boxes) — same seed, same consist.
- **Rendering LODs mirror the traffic rings**: ring 0/1 = real train models (rigid part entities, wheels
  rotate by `ds`); ring 2 = the far pass (07) with headlight corona + lit-window strip at night — a train
  crossing the far valley at night is the postcard shot.
- **Interactions v1**: crossings close (04); collision = solid kinematic collider (the train wins);
  ridable/boardable = OUT of v1 (a later gameplay plan); ped/vehicle agents yield via the crossing's
  virtual red.

## SA data notes

- SA's own trains follow `tracks*.dat` with hardcoded route logic — we replace the logic, keep the rails.
- Station platforms (Unity, Cranberry, Market, LV stations) become station nodes in the format (01) —
  positions authored once in the editor.

## Tasks

- [ ] Track arc-length runtime + train-as-chain kinematics (engine + cars, curve-following per bogie so
      long cars don't clip on bends).
- [ ] Schedule runtime from the game clock + station stop/dwell states.
- [ ] Seeded consist generator from the SA train model pool.
- [ ] Crossing integration (presence windows → 04's lookahead) — the first end-to-end demo: train
      approaches, barrier closes, traffic queues, train passes, everything reopens.
- [ ] Far-pass representation (07): headlight corona + night window strip.
- [ ] Field acceptance: ride alongside a train across the map edge-to-edge; schedule holds under streaming.
