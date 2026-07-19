# 082/04 — Config, city + seeding at spawn, damage verification, close-out

The user-facing half (survives from the idea with new wiring targets) plus the end-to-end proof.

## 1. Config

- `VehicleConfig` gains `plates: { ls: string; sf: string; lv: string }` (mask DSL; empty →
  plan-01 default). Defaults in `game-runtime-config.ts`; the 4 config fixtures updated.
- Live setter follows the current config-broadcast pattern; **applies to NEW spawns only** (the
  idea's decision stands — retexturing the live fleet for a config knob is not worth it; document).
- F2: a plate-text input on the debug vehicle spawner (optional override), riding the existing
  spawn action.

## 2. Resolution at spawn

- `packages/game/src/vehicle/vehicle-plates.ts` (pure): `resolvePlate(placement, platesConfig,
cityBoxes) → { text, city }` — `cityAt(spawn position)` (NOT the player's city — a far-streamed
  SF car wears SF plates); COUNTRYSIDE/DESERT → deterministic pick of the three via the seed;
  seed = integer hash of (model, x, y, z). `VehiclePlacement` gains optional `plate` override
  (debug/missions win over the hash).
- Wiring: ONE call site in the host `spawnVehicle` (`engine-vehicles.ts:211-293`) —
  resolve → allocate slot (compose on miss, plan 01+03) → `setPlate`. Parked cars, car
  generators, popcycle road cars, bench road cars and the debug spawner all flow through it;
  a test pins that no second spawn path exists (grep-level assertion in review, behavioural test
  for the main path).
- LOD respawn determinism: `VehicleLodSystem` respawn from the stored placement must produce the
  identical plate — end-to-end test (hash → same text → same slot).

## 3. Damage / detach / doors verification (the census pays off)

- With plates as flagged submeshes INSIDE part geometry (plan 02), damage support is structural:
  `setSubmeshVisible` ok/dam swaps and part detach carry the plate automatically. This plan
  PROVES it: integration test on the plated fixture — swap to `_dam`, assert the visible plate
  submesh still resolves the instance's slot; detach path keeps rendering it.
- Census follow-ups from plan 02 (standalone-atomic models, `_dam` without plate material) get
  their in-game check here; missing-plate-on-dam = acceptable (SA behaves likewise), crash = bug.
- Slot lifetime: a detached part's plate must not be evicted while the debris renders — the
  refcount covers the instance; verify the detach path holds the ref until debris expiry.

## 4. Close-out

- Field session: drive LS→SF→LV — parked plates match districts; countryside shows a stable mixed
  distribution; custom masks via config apply to new spawns; ram a plated car — deformed bumper
  keeps the plate, second hit drops it with the part. Screenshots in the plan.
- Ledger: plate slots used after a full-map drive, spawn overhead, cache hit rate.
- Docs: config reference entry; idea-chain insight recorded (plates-inside-part-meshes) — the
  chain readme statuses flip; memory update.

## Subtasks

- [ ] Config + fixtures + setter + docs.
- [ ] `vehicle-plates.ts` + tests (city boxes → mask; countryside stable pick; override wins;
      hash determinism).
- [ ] Host wiring + LOD-respawn determinism test + debug-spawner input.
- [ ] Damage/detach integration tests + refcount-through-detach check.
- [ ] Field session + measurements + close-out sweep.

## Acceptance

- The user's original spec holds end-to-end: masks in config, city-correct backgrounds,
  deterministic per-vehicle plates, plates ride deform/swing/detach. Field verdict recorded.

## Ledger

_(distribution screenshots note, slots/overhead numbers, verdict)_
