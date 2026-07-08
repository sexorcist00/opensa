# 04 — Basic CLEO support for OpenSA

Run compiled GTA:SA CLEO `.cs` scripts inside the OpenSA browser engine — starting from the two real mods in `NO_COMMIT/1/` (both Junior_Djjr "spin an object" scripts) — on a small but **deliberately extensible** architecture so the opcode surface can grow toward real coverage later.

## Primer — what CLEO is (so the architecture is grounded, not guessed)

- **SCM bytecode.** GTA:SA's mission logic is compiled **SCM** — little-endian bytecode: a `u16` opcode (top bit `0x8000` = negated conditional) followed by operands, each prefixed by a **data-type byte** (0x01 int32, 0x04 int8, 0x05 int16, 0x06 float32, 0x02 global var, 0x03 local var, 0x09 fixed 8-char string, 0x0E length-prefixed string, arrays, …). Execution is a **cooperative thread model**: each script is a thread with an instruction pointer, 0–31 local vars (+ two timers), a condition flag, a gosub stack; it runs opcodes until `WAIT`, then yields; the scheduler resumes it after the wait elapses. Global vars are a shared block.
- **CLEO** (Alien/Seemann) is a runtime ASI that loads standalone **`.cs` scripts** from a `CLEO/` folder, each running as its own thread alongside `main.scm` — plus a set of **CLEO opcodes** the base game lacks: raw memory read/write (`0x0A8C`/`0x0A8D`), SCM-function call (`0x0AB1`), file IO, etc. **CLEO 5 / CLEO+** extend this with more high-level opcodes (easier object/ped/vehicle manipulation, more memory helpers). **cleo_redux** (Sanny Builder team) is a modern reimplementation running JS/TS scripts — the reference for "extensible, non-address-bound scripting".
- **Our two target scripts** (confirmed by decoding): both create a map object and rotate it each frame. Ferris Wheel (876 B) = `0x0107` CREATE_OBJECT + `0x0453` SET_OBJECT_ROTATION + `0x0001` WAIT + conditionals/jumps. Wind Farm (3689 B) = the same class plus `0x0AB1` CLEO_CALL subroutines and length-prefixed model-name strings (`windturb_base`/`windturb_fan`/LODs) with a "models not installed" guard. **Neither needs raw memory pokes** — the ideal first class of script.

## The three open questions — answered as decisions

1. **How to parse existing CLEO** → [001](001-scm-decoding.md). A binary SCM decoder on the engine's existing `BinaryStream`, driven by a **data-driven opcode database** (the open **Sanny Builder library** JSON: opcode → name + typed params) so we don't hand-transcribe thousands of opcodes. Standalone `.cs` = raw thread body (no main.scm header).
2. **Give CLEO scripts an API to act inside OpenSA** → [003](003-engine-api-bridge.md). Opcodes are bridged to engine primitives via a **handler registry**: an opcode handler = a small function receiving decoded operands + an engine facade (spawn object by model id, set position/heading, query time, …). The "CLEO API" IS this handler set; it grows by registering handlers, never by editing the VM.
3. **Engine part, or a separate module like modloader?** → [004](004-module-packaging-wiring.md). **A separate runtime module** (`packages/cleo`) depending on `@opensa/game` + `@opensa/renderware`, attached via `game.addSystem(...)` from `canvas-host` — following the `game/mods` precedent (GTA-specific, may import renderware; the engine core stays script-free). It loads `.cs` from the VFS the way modloader overlays assets. NOT baked into the core, NOT a rendering `Plugin`. The engine gains only a tiny seam (a `loadModelByName`-style adapter method); everything else lives in the module.

## Architecture to lay in now (cheap) for extensibility later

- **Opcode DB is data, handlers are plugins.** Decoding (param shapes) comes from the Sanny library; behaviour comes from a registry keyed by opcode id. Unknown opcode → a single, observable "unimplemented" path (log + defined fallback), never a silent misparse.
- **The VM is engine-agnostic.** The thread scheduler / var spaces / control flow know nothing about three.js — they call an injected `CleoHost` facade. This keeps the VM unit-testable headless and lets the same core later target more opcodes or even a non-GTA host.
- **A handle table** maps script object/car/actor handles → engine objects (mirror `VehicleLodSystem` bookkeeping), so scripts can create, reference, move, and destroy things across frames.
- **A memory-op boundary from day one.** `0x0A8C`/`0x0A8D` and friends have no meaning in a browser (there's no `gta_sa.exe` address space). Basic support targets scripts that don't need them, but the VM routes memory opcodes through an explicit `MemoryModel` seam (default: unimplemented-log) so a future emulated/shimmed memory map is an extension, not a rewrite.
- **Everything gated + debuggable.** `CleoConfig.enabled`, ticks only while `gameState==='play'`, a script tracer (opcode-level log), and an opcode-coverage report against a script corpus.

## The chain

| #   | Plan                                                                       | Delivers                                                                                                                            | Status |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | [001 — SCM/CLEO decoding & opcode model](001-scm-decoding.md)              | `.cs` binary decoder + Sanny-library opcode DB; the two scripts fully disassembled → the exact opcode whitelist                     | idea   |
| 2   | [002 — Script VM & thread scheduler](002-script-vm.md)                     | cooperative thread engine: vars, wait/yield, conditionals/jumps/gosub, opcode-handler registry (engine-agnostic, headless-testable) | idea   |
| 3   | [003 — Engine API bridge](003-engine-api-bridge.md)                        | `CleoHost` facade + `loadModelByName` adapter seam; handlers for the object-spawn/rotate class; coordinate/units                    | idea   |
| 4   | [004 — Module, packaging, config & wiring](004-module-packaging-wiring.md) | `packages/cleo` as a runtime module (modloader-style), `CleoConfig`, canvas-host wiring; the two mods run in-engine                 | idea   |
| 5   | [005 — Extensibility, debugging & maintenance](005-extensibility-debug.md) | script tracer, opcode-coverage tooling, unimplemented/memory-op policy, "how to add an opcode" flow, tests                          | idea   |

Linear 001 → 005. 001+002 build the language core, 003+004 make it act inside OpenSA and ship the two mods, 005 makes it maintainable and growable.

## References

- **Opcode database**: Sanny Builder library (github.com/sannybuilder/library — machine-readable opcode/param JSON for GTA:SA); Sanny Builder (compiler/decompiler) for cross-checking disassembly.
- **CLEO**: cleo-team/cleo_redux (modern JS-scripted CLEO — architecture reference), the CLEO 4/5 opcode extensions, CLEO+ opcode list.
- **SCM format**: the GTAMods wiki (SCM/opcode/data-type-byte docs), gta3sc (open-source SCM compiler) for the binary grammar.
- **In-repo**: `packages/renderware/src/parsers/binary/binary-stream.ts` (the cursor to build the decoder on); `packages/game/src/core/system.ts` + `mods/mod.interface.ts` + `game.ts` `installMod`/`addSystem` (the attach seam); `adapters/gta-sa-world.adapter.ts` `loadVehicle` (the `loadModelByName` pattern to copy); `vehicle-lod.system.ts` (handle-table/lifecycle precedent); `three/animated-objects.ts` + `vehicle-damage.system.ts` (per-frame rotate precedents). Target scripts: `NO_COMMIT/1/**/CLEO/*.cs`.
