# 083/03 — Engine host bridge: CleoHost on the rigid-model path

The fully-rethought plan: "CLEO can act inside OpenSA" against the own engine. The three-era
version added `loadModelByName → Object3D under streamingRoot`; none of that exists. The new
grounding: **the engine's generic prop path IS the vehicle-model machinery** (clutter, anim
objects and debris already reuse it — 074 B7), and models arrive as per-model `.osm` from the
game VFS.

## Decisions

1. **Model loading = the existing lazy rigid-model path.** `CleoHost.requestModel(idOrName)`
   resolves id→name through the IDE defs (the adapter owns `defByName`/defs already), reads the
   model `.osm` via the VFS (`readVehicleOsm` precedent, `gta-sa-world.adapter.ts:618`; 076's
   loose-basename lookup), builds in the **vehicle-model worker** (plan-21 lesson — no spawn
   freeze), registers `createVehicleModel`. `isModelAvailable` returns true once registered —
   which is EXACTLY the SCM request/poll contract (both target scripts loop on it), so async
   loading bridges to synchronous SCM semantics with no blocking.
2. **VFS-subset check first** (the procobj burn, [[local-loader-vfs-subset]]): verify the browser
   ingest path can produce an arbitrary map-object `.osm` on demand from a pack `--out` dir. If
   the local-loader subset blocks it, add `cleoModelRefs` discovery (enumerate `CLEO/*.cs`,
   pre-decode with plan 01 offline-style, collect model names — the procObjModelRefs pattern,
   now elegant because the decoder EXISTS). Record which path was needed.
3. **Objects = engine vehicle instances** (`createVehicle(modelId)`) tracked in a handle table
   (`Map<scriptHandle, instance>`): CREATE_OBJECT allocates + `setTransform`; SET_OBJECT_ROTATION
   / COORDS update the stored transform (GTA Z-up native — **no axis conversion**; degrees→radians
   centralised in one place); DELETE_OBJECT destroys and frees. Detach-safe: a handle whose
   instance was torn down (teleport cleanup, future streaming) no-ops with a once-log.
4. **No physics by default.** Script objects are visual transforms (matching what the two mods do
   in-game). A collider is a later opcode-driven addition (the breakable-clutter precedent shows
   how colliders attach to instanced props) — recorded as an extension point, not built.
5. **Time/queries**: `getGameTimeMs` from the game clock (play-gated), player position from the
   ECS transform — added as the whitelist demands, no speculative surface.

## Subtasks

- [ ] Phase-0 spike: load ONE known map-object `.osm` by name at runtime from the host, render it
      at a fixed transform (proves decision 1/2 before any CLEO code touches it). Record the path.
- [ ] `CleoHost` impl in `packages/cleo`: request/available cache, handle table, create/rotate/
      coords/delete, unit conversions; disposal on delete + runner teardown.
- [ ] World-opcode handlers for the plan-01 whitelist (REQUEST_MODEL, IS_MODEL_AVAILABLE/LOADED,
      CREATE_OBJECT, SET_OBJECT_ROTATION, SET_OBJECT_COORDS, DELETE_OBJECT,
      MARK_MODEL_AS_NO_LONGER_NEEDED + the conditional guards the scripts use).
- [ ] Integration test (mock adapter): the decoded Ferris script spawns one object at the scripted
      coords and its rotation advances per tick — asserted on the handle table, headless.
- [ ] Detach-safety + missing-model tests (`isModelAvailable` stays false + warn — the scripts'
      own not-installed guard then runs, same as real CLEO).

## Verification

- Ferris (decoded 01, run on 02, bridged here) produces the expected transform sequence headless.
- The phase-0 spike model renders in-engine; missing/streamed-out handles never throw.

## Ledger

_(VFS path verdict — lazy lookup vs cleoModelRefs; host method set; whitelist coverage)_
