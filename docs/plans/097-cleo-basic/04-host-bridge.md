# 097/04 — Engine host bridge + wiring: class A alive in the engine

`CleoHost` implemented over the engine's real seams, wired into the real frame loop, and the first
field checkpoint: **the Ferris wheel spins in the browser**. All engine facts below were re-verified
in the 2026-08-04 recon (file:line current as of that date).

## Decisions

1. **Model loading = the existing rigid-model path.** `host.requestModel(idOrName)` resolves id→name,
   reads `<name>.osm` from the VFS, `readModelOsm` (`packages/game/src/adapters/vehicle-osm.ts:57`) →
   `engine.createVehicleModel` → `engine.createVehicle` → `instance.entity.setRoot(mat4)`. The working
   template is `apps/web/src/ui/engine-props.ts:73-127` (props already spawn arbitrary models this
   way, with a DFF/TXD fallback). Build in the vehicle-model worker if profiling shows spawn hitches —
   props currently build on-thread; measure first, copy the worker only if needed.
   `isModelAvailable` returns true once registered — exactly the SCM request/poll contract, so async
   loading bridges to SCM semantics with no blocking.
2. **A model id→name resolver must be BUILT** (recon: none exists). Compose from
   `MapDefinitions.catalog` (IDE object defs, `packages/renderware/src/parsers/text/types.ts:74-86`)
   + the adapter's `vehicleDefs`; name-first (`GET_MODEL_BY_NAME 0E9C` gives names — Wind Farm uses
   it), ids resolved through the composed map. Lives adapter-side (the game layer touches renderware
   only through `adapters/` — lint-caught restriction).
3. **Phase-0 spike stays first** (the `[[local-loader-vfs-subset]]` burn): load ONE known map-object
   `.osm` by name at runtime from the host, render it at a fixed transform. If the local-loader subset
   blocks arbitrary lookup, fall back to `cleoModelRefs` discovery (enumerate `cleo/*.cs`, pre-decode
   with plan 01, collect model names — the `procObjModelRefs` pattern in
   `packages/loaders/src/asset-local-loader/build-vfs.ts`). Record which path was needed.
4. **Objects = engine rigid instances in a handle table** (`Map<scriptHandle, instance>`):
   CREATE_OBJECT_NO_SAVE allocates + places; SET_OBJECT_ROTATION/COORDS/HEADING update the stored
   transform (GTA Z-up native — **no axis conversion**; degrees→radians centralised in ONE place);
   DELETE_OBJECT destroys and frees. Detach-safe: a torn-down handle no-ops with a once-log.
   No physics (readme's out-of-scope).
5. **`CONNECT_LODS 0827`**: pair the two script handles so the far model renders when the near one is
   outside its draw distance — served with a simple camera-distance visibility swap on the pair (both
   Junior mods spawn their own lod models and link them). Not the world-LOD system; just the pair.
6. **Query facets the corpus demands, no speculative surface**: clock (`GET_CURRENT_HOUR` from the
   game clock), camera distance (`0EBE` against the active camera position), area visible (`077E`),
   player position (ECS `Transform`/`Locomotion` — `packages/game/src/ecs/components.ts`),
   `GET_PLAYER_CHAR/IS_PLAYER_PLAYING` (trivially true/0 in play state), vehicle queries
   (`activeVehicle()`/`ridingVehicle()` via `apps/web/src/ui/engine-vehicles.ts:59/:101`,
   `GET_CAR_MODEL`, `IS_CAR_MODEL`, `IS_THIS_MODEL_A_CAR`), **`IS_GAME_VERSION_ORIGINAL 0AA9` → true**
   (the impersonation doctrine — van door bails otherwise), `IS_PC_VERSION` → true. Text facet:
   `PRINT_STRING_NOW/0ACD` and friends onto the existing HUD message surface (or a minimal toast if
   none exists — record which).
7. **Wiring is explicit, not `addSystem`** (recon: `SystemRegistry` is dead). `CleoRunnerSystem`
   implements the `System` interface (`packages/game/src/core/system.ts:6`) but is constructed in the
   `engine-canvas-host.tsx` boot closure and called by name inside `runFixedSteps` — AFTER
   `vehicles?.fixedUpdate` (scripts read seated-vehicle state the same step they animate), gated
   `config.gameState !== 'play'` early-return (the `physics.system.ts:35` pattern). Script count
   announced at boot (the populations restriction). `Config.cleo` added to
   `packages/game/src/interfaces/config.interface.ts` + the default literal in
   `apps/web/src/ui/game-runtime-config.ts` — `{ enabled: false, trace: false, maxScripts }`,
   live-read.
8. **Scripts for THIS plan are hand-placed** in `build/<game>/opensa/cleo/` (loose files ride every
   pipeline stage untouched — recon-verified; the mods pipeline learns to put them there in plan 06).
   Boot discovery: `vfs.names` filtered on `cleo/` + `.cs` (keys are lowercase in all loaders).

## Subtasks

- [ ] Phase-0 spike (decision 3); record the verdict + the path taken.
- [ ] id→name resolver (adapter-side) + tests.
- [ ] `CleoHost` object facet: request/available cache, handle table, create/rotate/coords/delete,
      unit conversions, disposal on runner teardown; detach-safety + missing-model tests
      (`isModelAvailable` stays false → the scripts' own not-installed guard runs, same as real CLEO).
- [ ] Query facets (decision 6) + tests against mock game state.
- [ ] `CONNECT_LODS` pairing + test.
- [ ] `CleoRunnerSystem` + `Config.cleo` + boot discovery + explicit wiring + play gating + boot
      census line.
- [ ] Headless integration: decoded Ferris (01) on the VM (03) against the REAL host facets with a
      fake engine — expected transform sequence asserted on the handle table.
- [ ] **Field checkpoint 1**: Ferris Wheel + Wind Farm hand-placed into a gostown/original build,
      `cleo.enabled` on — the wheel spins, the turbines turn (Wind Farm's two global reads land on
      plan 05's globals table; until then its not-installed/zero-wind fallback path is the accepted
      behaviour — record what the field actually shows). Screenshot + boot census + frame numbers
      into the ledger.

## Verification

- Ferris produces the expected transform sequence headless; the spike model renders in-engine;
  missing/streamed-out handles never throw; `enabled: false` = zero overhead (measured).

## Ledger

_(spike verdict, worker vs on-thread decision + numbers, facet inventory, field checkpoint 1 record)_
