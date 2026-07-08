# 004 — Module, packaging, config & wiring

Part of the [basic CLEO chain](readme.md). Depends on [001](001-scm-decoding.md)–[003](003-engine-api-bridge.md). Answers open question #3 (engine vs separate module) concretely and makes the two `NO_COMMIT/1/` mods actually run in the browser.

## Context

The engine has two extension seams: rendering-only `Plugin`s (no world/entity access) and `System`s + the `game/mods` precedent (`WorldMod` via `game.installMod`, GTA-specific, may import `@opensa/renderware`). CLEO is GTA-specific, needs renderware types (model ids, spawning) and per-frame ticks — it fits the `System`/`mods` seam, not `Plugin`, and not the renderware-free core. Modding today is either build-time (mod-installer bakes into the VFS) or the runtime `modloader` VFS overlay — CLEO adds a THIRD kind: runtime code execution, loading `.cs` from the VFS the way modloader overlays assets.

## Decisions

1. **Separate runtime module `packages/cleo`** depending on `@opensa/game` + `@opensa/renderware` (NOT in the engine core, which stays script-free; the core gains only 003's `loadModelByName` adapter method). This mirrors how `game/mods` and adapters are the only renderware-touching layers — CLEO is analogous but big enough to be its own package. It exports a `CleoRunnerSystem` (implements `System`) + `installCleo(game, adapter, opts)`.
2. **Attached via `game.addSystem` from `canvas-host`** (the wiring hub), after `adapter`/`spawnVehicle` exist so the `CleoHost` can be handed real handles. Same shape as every other system wiring there. The engine exposes no dynamic plugin discovery — wiring stays compile-time in the host, exactly like `VehicleLodSystem`.
3. **Scripts loaded from the VFS.** `.cs` files live under a `CLEO/` path in the asset tree (the mod-installer/modloader conventions already move mod folders into the shipped tree — a CLEO mod's `CLEO/*.cs` gets placed there). The runner enumerates `CLEO/*.cs` at load, decodes (001), and starts a thread per script. This makes CLEO mods install through the SAME pipeline as asset mods — no separate loader UX.
4. **`CleoConfig`** in `config.interface.ts`: `{ enabled: boolean; trace?: boolean; maxScripts?: number }`; `Config.cleo`; `Game.setCleo` (mirror the other `setX` setters, broadcast `configChanged`). Runner reads it live; ticks only while `gameState==='play'` (mirror `game.ts` play-gating). Disabled by default until proven.
5. **Install path for CLEO mods.** mod-installer/bake gains awareness of a mod's `CLEO/` folder (place `.cs` into the shipped `CLEO/` tree, like it handles `gta3_img/` etc.) — so the two `NO_COMMIT/1/` mods (Wind Farm, Ferris Wheel) install their models (existing path) AND their scripts (new) together. The models already flow through the mod pipeline; this closes the loop.
6. **Failure isolation.** One malformed/unsupported script must not kill the others or the game: decode/exec errors are caught per thread, logged, and that thread is killed; the runner and other scripts continue. A CLEO mod that pokes unsupported memory ops degrades to "did nothing" with a clear log, never a crash.

## Tasks

- [ ] `packages/cleo` package (Nx project, deps `@opensa/game` + `@opensa/renderware`): exports `CleoRunnerSystem` + `installCleo`.
- [ ] `CleoRunnerSystem implements System`: on install, enumerate `CLEO/*.cs` from the VFS, decode + start threads; `update(delta)` → `runner.tick`; per-thread error isolation; dispose cleans handles/threads.
- [ ] `CleoConfig` + `Config.cleo` + `Game.setCleo`; export types; live-read + play-gate in the runner.
- [ ] canvas-host wiring: construct `installCleo(game, adapter, { spawn, streamingRoot, getGameTimeMs })` after the vehicle wiring; `game.addSystem`.
- [ ] mod-installer/bake: recognise a mod's `CLEO/` folder → place `.cs` into the shipped `CLEO/` tree (tests mirroring the existing img-folder handling).
- [ ] End-to-end in the browser: install Wind Farm + Ferris Wheel (models + `.cs`), enable `cleo`, load into the world → the wind turbines and the ferris wheel spawn and rotate. Screenshot/gif.
- [ ] Error-isolation test: a deliberately broken `.cs` is killed + logged; the other script keeps running.

## Verification

- Both `NO_COMMIT/1/` mods run in-engine: objects appear at their scripted locations and rotate, matching the real game's behaviour.
- `cleo.enabled=false` → no scripts run, zero overhead; ticks only in play state.
- A broken script doesn't take down the runner or the frame loop.

## Measurements / notes

_(record after implementation)_

- packaging decision recorded (packages/cleo) + engine-core delta (just loadModelByName): …
- the two mods' behaviour vs real game: …
