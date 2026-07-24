# 082/03 — Engine: plate atlas array + per-instance slot + WGSL override

The engine half: per-INSTANCE plates on models whose textures are shared per MODEL. One shared
atlas, one small per-instance index, one shader branch.

## Design

- **Plate atlas**: one engine-owned RGBA8 texture array, fixed slot size (plan 01's, first guess
  128×64) × capacity N (first guess 256 slots ≈ 8 MB with mips; measure a full-map drive before
  settling). Created lazily on first plate upload; NOT part of any model's `textures`.
  Slot 0 = reserved "stock look" (see below).
- **API**: `engine.uploadPlate(slot, rgba)` (queue.writeTexture into the slot + mip gen consistent
  with other runtime textures) and `VehicleInstance.setPlate(slot, backSlot)` — writes the
  per-instance row, the exact `setPaint`/`setLamps` mechanism (`engine.ts:306-309`, paint 64 B /
  lamp 16 B rows): a new 16-byte row (face slot, back slot, 2 spares) or the two spare components
  of the lamp row if review prefers zero new buffers (decide at implementation, record).
- **WGSL (vsRigid/fsRigid path)**: a submesh flagged `plate` (plan 02, reaching the shader via the
  existing submesh-level bind/draw split — plate submeshes already draw separately by
  construction) samples the plate atlas at the instance's slot instead of the model array layer;
  slot 0 means "sample the model array as today" so unassigned cars and old `.osm`s render stock.
  `face` uses the composed raster; `back` uses the city background slot (the three backgrounds are
  uploaded once at boot into fixed slots 1–3).
- **Slot allocator** (host side, `packages/game`): `(text, city) → slot` map + LRU over N;
  eviction only reclaims slots whose refcount (live instances wearing it) is zero — the plan-21
  claim-before-evict lesson applies verbatim. Parked-car respawn re-requests the same pair and
  hits the map — the determinism chain stays cheap.
- **Bind model**: the plate atlas joins the rigid path's on-demand bind groups as one more fixed
  binding (rebuilt bind-group layout for the vehicle pipelines — behind the veil, no steady-state
  compile). A submesh whose model array hasn't streamed in keeps its existing skip behaviour.

## Subtasks

- [ ] Atlas + `uploadPlate` + boot upload of `plateback1..3` slots; asset-driven size guard
      (a modded larger plateback resamples at compose time, plan 01 — the atlas slot is a CAP
      constant like probes/LUTs, per the standing rule).
- [ ] Per-instance plate row + `setPlate` + capacity-grow restore (mirror the paint row's grow
      path and its "not re-sent per frame" note).
- [ ] WGSL: plate-flagged submesh sample override + slot-0 passthrough; shader snapshot update
      (golden-variant flow).
- [ ] Fake-device tests: setPlate row writes, bind group includes the atlas, slot-0 path binds
      nothing new; smoke render with a flagged fixture.
- [ ] Slot allocator + refcounted LRU + tests (evict-only-free, same-pair reuse).
- [ ] Measure: atlas bytes at N=256, bind-group count delta, GPU cost delta on the vehicle-heavy
      bench scene (expect ≈0 — one extra small texture binding).

## Acceptance

- A spawned car with `setPlate` shows the composed plate on face + city background on back;
  another instance of the SAME model shows a different plate simultaneously (the core requirement
  the three-era design got for free and this design must prove).
- Slot-0/old-osm path pixel-identical to today (bench draws unchanged).
- Memory + GPU deltas in the ledger, inside noise.

## Ledger

_(slot size/capacity decisions, row placement decision, memory + bench numbers)_
