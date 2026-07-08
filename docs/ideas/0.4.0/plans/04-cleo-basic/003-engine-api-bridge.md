# 003 — Engine API bridge (CleoHost + world opcodes)

Part of the [basic CLEO chain](readme.md). Depends on [002](002-script-vm.md) (the VM + `CleoHost` shape). Delivers the actual "CLEO can act inside OpenSA" — the `CleoHost` implementation, the one small adapter seam it needs, and the world-opcode handlers for the object-spawn/rotate class.

## Context

The VM (002) calls an injected `CleoHost` facade for anything world-touching. This plan implements that facade against the engine and registers the handlers for the opcodes the two target scripts use (from 001's whitelist): model request/availability, CREATE_OBJECT, SET_OBJECT_ROTATION / coords, delete object, and the "is model available" guard.

Engine grounding: the adapter can already turn a model name into a mesh (`loadVehicle`/`loadCharacter` pattern: `defByName` → DFF/TXD buffers → `parseDff` → `buildClump`), but there's **no generic "spawn arbitrary map object by model id"** yet — that's the one seam to add. Placed objects go under `streamingRoot` (native Z-up: SA world XYZ maps directly, **no axis swap**); heading = `object.rotation.z` in radians (SA opcodes give **degrees** → convert). Per-frame rotation precedent: `vehicle-damage.system.ts` mutates `object.rotation.z`; `animated-objects.ts` shows detach-safe per-frame updates.

## Decisions

1. **One new adapter method** on `WorldAdapter`: `loadModelByName(name): Promise<Object3D>` (and/or `loadModelById(id)` via a `Map<number, IdeObjectDef>` built from `this.defs`) — copies the `loadVehicle` body but uses `buildClump` for a generic object. This is the ONLY engine-core change; everything else lives in `packages/cleo`.
2. **`CleoHost` is the whole API surface.** Methods map 1:1 to what handlers need: `requestModel(id)`/`isModelAvailable(id)` (kick off the async load, report readiness), `createObject(id, x, y, z) → handle`, `setObjectRotation(handle, degZ)` / `setObjectCoords`, `deleteObject(handle)`, `getGameTimeMs()`, plus player/time queries as they're needed later. Model **ids** (numeric) resolve through the adapter's id→name map; string model names (CLEO length-prefixed) resolve directly.
3. **Handle table.** `CleoHost` owns a `Map<scriptHandle, Object3D>` (mirror `VehicleLodSystem` bookkeeping): CREATE_OBJECT allocates a handle + adds the group to `streamingRoot`; subsequent opcodes look objects up by handle; delete removes + disposes. Handles survive across frames/threads for the script's lifetime.
4. **Async model load bridged to synchronous SCM.** SCM does `REQUEST_MODEL` then loops on `IS_MODEL_AVAILABLE` until ready (both target scripts do this) — so `requestModel` starts the async `loadModelByName`, `isModelAvailable` returns true once resolved, and `createObject` uses the cached result. This matches SA semantics exactly and needs no blocking. Missing model → `isModelAvailable` stays false + a logged warning (the scripts already handle "not installed" with their own error path).
5. **Rotation each frame is the script's job, not a special case.** These scripts set a new rotation every WAIT cycle; that's just repeated `setObjectRotation` calls — no engine animation system needed. (A future `0x0774 ROTATE_OBJECT`-style smooth-rotate opcode would register as a handler that stores a target + interpolates in the host's per-frame update — the extension point exists but isn't built here.)
6. **Units/space centralised.** One place converts SCM degrees→radians and validates SA-XYZ; handlers never touch three.js directly (only via host), keeping the VM/handlers portable.

## Tasks

- [ ] Adapter seam: `loadModelByName`/`loadModelById` on `WorldAdapter` (interface) + impl in `gta-sa-world.adapter.ts` (reuse `defByName` + `buildClump`; numeric id→name map from `this.defs`); test it returns a positioned Group for a known model.
- [ ] `CleoHost` impl in `packages/cleo`: handle table over `streamingRoot`, model request/availability cache, create/rotate/coords/delete, game-time + degree→radian conversion; disposal on delete + on runner teardown.
- [ ] World-opcode handlers registered on the VM for 001's whitelist (REQUEST_MODEL, IS_MODEL_AVAILABLE/LOADED, CREATE_OBJECT, SET_OBJECT_ROTATION, SET_OBJECT_COORDS, DELETE_OBJECT, MARK_MODEL_AS_NO_LONGER_NEEDED, and any conditional model guards the two scripts use).
- [ ] Wire `CleoHost` into a per-frame update (detach-safe like `animated-objects.ts` — a streamed-out/removed object handle must not throw).
- [ ] Integration test (headless-ish, mock adapter): run the decoded Ferris script → asserts one object created at the known coords and rotation advancing each tick.
- [ ] Unit tests: handle lifecycle (create→lookup→delete), degree/radian + coord conversion, missing-model path.

## Verification

- The Ferris Wheel script, decoded (001) + run on the VM (002) + this host, spawns the wheel at its scripted coordinates and rotates it each cycle (verified against expected transforms; full in-engine run is 004).
- `loadModelByName` produces the correct mesh for `windturb_fan` etc.
- No throw when a script references a handle whose object was streamed out/removed.

## Measurements / notes

_(record after implementation)_

- CleoHost method set implemented: …
- world opcodes handled (of the whitelist): …
