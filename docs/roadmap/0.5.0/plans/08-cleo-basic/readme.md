# 0.5.0/08 — Basic CLEO support (run compiled `.cs` scripts in the engine)

**Status: DEFERRED to 0.5.0 on 2026-08-01** — moved here from `docs/plans/083-cleo-basic/` unstarted, by the
user's call while closing out 0.4.0. Nothing about the plan changed; only its cycle did. It was
**PLANNED 2026-07-19** and supersedes the idea chain `docs/ideas/0.4.0/plans/04-cleo-basic/`
(2026-07-12) — rethought for the own engine. The idea's language core (decoder + VM) was
engine-agnostic by design and survives nearly verbatim; the world bridge and packaging were written
against the deleted three path (`Object3D`, `streamingRoot`, `buildClump`, `canvas-host`) and are
re-grounded here.

**Goal:** run compiled GTA:SA CLEO `.cs` scripts in the browser engine on a deliberately
extensible architecture — starting with the object-spawn/rotate class (the two Junior_Djjr mods:
Rotating Ferris Wheel, Wind Farm), growing opcode coverage by data, not rewrites.

## Primer (carried from the idea — still the ground truth)

- **SCM bytecode**: little-endian `u16` opcode (top bit `0x8000` = negated conditional) +
  operands, each prefixed by a data-type byte (0x01 int32, 0x04 int8, 0x05 int16, 0x06 float32,
  0x02/0x03 global/local var, 0x09 fixed 8-char string, 0x0E length-prefixed string, arrays).
  Cooperative threads: IP, locals 0–31 + two auto-timers, condition flag, gosub stack; run until
  `WAIT`, yield, resume when it elapses. A standalone `.cs` is a raw thread body, no SCM header.
- **CLEO** loads `.cs` from a `CLEO/` folder as extra threads + adds opcodes (memory pokes
  `0x0A8C/0x0A8D`, SCM-call `0x0AB1`, file IO). cleo_redux is the architecture reference for
  extensible non-address-bound scripting.
- **Target scripts** (decoded during the idea round): both create an object and rotate it per
  frame. Ferris Wheel (876 B) = `0x0107` CREATE_OBJECT + `0x0453` SET_OBJECT_ROTATION + WAIT +
  jumps. Wind Farm (3 689 B) = same class + `0x0AB1` subroutines + length-prefixed model names
  (`windturb_base`/`windturb_fan`) with a not-installed guard. Neither touches raw memory — the
  ideal first class.

## What the new engine changes (the rethink)

1. **The decoder has an in-repo ancestor now.** The CLEO car-generator work (memory: opcode
   `0x014B` parking extraction) already reads SCM param types offline
   (`packages/renderware/src/parsers/text/` — see the `0x014B` references in `types.ts` /
   `ipl-binary.parser.ts` docs). Plan 01 generalises from that + `BinaryStream`, rather than
   starting cold.
2. **CREATE_OBJECT lands on the rigid-model path, not three.** The engine's generic "model at a
   transform" path is the vehicle-model machinery — clutter, anim objects and destruction debris
   all reuse it (074 B7). CleoHost = load model `.osm` by name/id from the game VFS
   (`readVehicleOsm` precedent, `gta-sa-world.adapter.ts:618`; loose-basename lookup from 076;
   built in the vehicle-model WORKER so a spawn never freezes the frame — the plan-21 lesson)
   → `createVehicleModel` + `createVehicle` instance → `setTransform` per frame. No new engine
   pipeline.
3. **The VFS-subset gotcha applies** ([[local-loader-vfs-subset]] burned procobj already): a
   CLEO-spawned model is neither IPL-placed nor a ped/vehicle. Since opensa-pack 003 the host
   boots from a full game-dir copy where EVERY map object has an `.osm` in the IMG — but the
   local-loader ingest path and the id→name map must be verified for arbitrary-model lookup;
   plan 03 carries a `cleoModelRefs`-style fallback (the procObjModelRefs pattern) if lazy lookup
   doesn't reach everything.
4. **Coordinates are FREE now.** Game systems and physics are native GTA Z-up — SCM coordinates
   pass through without axis swaps (the three-era plan had to reason about this). Degrees→radians
   stays the one conversion, centralised.
5. **Wiring hub is `engine-canvas-host`** (canvas-host is deleted): `packages/cleo` exports a
   `System` attached via `game.addSystem` after the vehicle/adapter wiring; ticks gated on
   `gameState === 'play'`. Tracer + coverage surface in the F2 debugger (capabilities system —
   plan 22 infra the idea predates).
6. **The target scripts must be re-sourced**: `NO_COMMIT/1/` was cleaned 2026-07-19. The two mods
   come back from the user's mod library into `mods-src`/`NO_COMMIT` for development; their `.cs`
   travel the normal data path (mod-installer bakes mods BEFORE opensa-pack; `.cs` files pass
   through a pack `--out` untouched as loose data).

## Sub-plans

| #   | Plan                                               | One-liner                                                                                      |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 01  | [SCM decoding + opcode DB](01-scm-decoding.md)     | Sanny-library opcode DB + two-layer decoder on `BinaryStream`; disassembler; opcode whitelist. |
| 02  | [Script VM + scheduler](02-script-vm.md)           | Engine-agnostic cooperative thread VM: vars, waits, control flow, handler registry, budgets.   |
| 03  | [Engine host bridge](03-engine-host-bridge.md)     | `CleoHost` on the rigid-model path: model load by name/id, handle table, spawn/rotate/delete.  |
| 04  | [Packaging + wiring](04-packaging-wiring.md)       | `packages/cleo` System, `Config.cleo`, VFS `CLEO/*.cs` discovery, the two mods run end-to-end. |
| 05  | [Extensibility + debug](05-extensibility-debug.md) | Tracer (F2), opcode-coverage tool, unimplemented tiers, MemoryModel seam, add-an-opcode flow.  |

Order: [priority.md](priority.md).

## Architecture rules (carried + sharpened)

1. **Opcode DB is data, handlers are plugins** — decoding shapes from the vendored, pinned Sanny
   Builder library JSON; behaviour from `registerOpcode(id, handler)`. Unknown opcode → one
   observable "unimplemented" path, never a silent misparse.
2. **The VM is engine-agnostic and headless-testable** — it depends on decoded instructions + an
   injected `CleoHost`; `packages/cleo`'s core has no engine import (the bridge module does).
3. **Handles are a table** mapping script handles → engine instances, detach-safe (a streamed-out
   or deleted object must not throw on a later opcode).
4. **A memory-op boundary from day one** — `0x0A8C/0x0A8D` route through a `MemoryModel` seam
   (default: unimplemented-log). A future emulated address map is an extension, not a VM rewrite.
5. **Gated + observable**: `Config.cleo.enabled` (default OFF until proven), play-state gating,
   per-frame instruction budget (a WAIT-less script must not hang the tab), per-thread failure
   isolation, tracer + coverage as first-class tools.
6. Measurements ledger per plan (standing rule): decode times, per-frame VM cost with both mods
   live (budget ≤ 0.2 ms), coverage percentages.
