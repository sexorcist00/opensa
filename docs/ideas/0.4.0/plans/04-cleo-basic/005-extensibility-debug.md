# 005 — Extensibility, debugging & maintenance

Part of the [basic CLEO chain](readme.md). Depends on [004](004-module-packaging-wiring.md) (a running CLEO module). Answers the user's explicit ask — _how to write, extend, maintain, and debug this_ — and sets the memory-op boundary so the architecture scales past two scripts without a rewrite.

## Context

Basic support (001–004) runs the object-spawn/rotate class. Real CLEO is thousands of opcodes plus raw-memory scripts that have no meaning in a browser. This plan makes GROWING coverage cheap and safe: the tooling to see what a script needs, the policy for the unimplementable, and the flow for adding an opcode.

## Decisions

1. **Opcode coverage as data.** A `coverage` tool runs the decoder (001) over a corpus of `.cs` (the two mods + any future set) and reports: opcodes used, which are implemented, which are unimplemented, frequency. This turns "what do we support" into a report and prioritises which handler to write next (implement by real-world frequency, not guesswork). Runs in CI over the shipped CLEO mods so a new mod's unsupported opcodes surface at build time.
2. **A script tracer.** `cleo.trace` (config) logs, per thread, each dispatched opcode (name from the Sanny DB) + operands + effects (`CleoHost` calls) + waits. This is THE debugger for scripts — you watch a thread's execution the way `winedbg`/logs debugged the ASI. A malfunctioning mod is diagnosed from its trace, no native tooling needed.
3. **Unimplemented-opcode policy, explicit.** Three tiers, chosen per opcode (not blanket): (a) **no-op-continue** (safe to ignore — cosmetic/irrelevant in a browser, e.g. audio-load); (b) **conditional-default** (an unimplemented conditional returns a defined result — usually false — so control flow stays sane); (c) **kill-thread** (genuinely unrunnable → stop that script, log). Default for unknown = no-op-continue with a once-per-opcode warning, tracked by the coverage tool. A registry maps opcode→tier so behaviour is declared, not accidental.
4. **Memory-op boundary (the big future fork).** `0x0A8C`/`0x0A8D`/`0x0AB1`-into-engine-addresses and CLEO+ memory helpers assume `gta_sa.exe`'s address space — nonexistent here. Route ALL memory opcodes through a `MemoryModel` seam with a default `UnsupportedMemoryModel` (log + tier policy). Document the future options without building them: (i) an **emulated virtual memory map** shimming the common addresses scripts poke (game state globals, timers) to engine equivalents; (ii) a **curated address→engine-binding table** (the addresses popular mods use → real engine getters/setters). This is where most "advanced" CLEO compatibility will eventually live; the seam means it's an addition, not a VM rewrite.
5. **"How to add an opcode" is a documented, one-file flow.** RE the opcode's semantics (Sanny DB + GTAMods wiki) → add a `CleoHost` method if it needs a new engine capability → `registerOpcode(id, handler)` → set its unimplemented tier if partial → add a fixture test. Documented in the module README so a contributor (or future us) extends coverage without relearning the VM.
6. **Corpus-driven regression.** Each newly-supported script becomes a fixture (its trace snapshotted); re-running the corpus catches regressions when handlers change. The two `NO_COMMIT/1/` mods are the seed corpus.

## Tasks

- [ ] Coverage tool: decode a `.cs` corpus → used/implemented/unimplemented/frequency report; CI step over the shipped `CLEO/` mods.
- [ ] Tracer: `cleo.trace` per-thread opcode/operand/effect/wait log (Sanny names); a "step one thread" debug affordance in the debug overlay.
- [ ] Unimplemented-tier registry (no-op-continue / conditional-default / kill-thread) + the default-unknown path + once-per-opcode warnings feeding the coverage report.
- [ ] `MemoryModel` seam + `UnsupportedMemoryModel` default; route 0x0A8C/0x0A8D/memory-touching CLEO opcodes through it; document the two future memory strategies (emulated map / curated bindings) in the module README.
- [ ] Module README: architecture overview + the "add an opcode" flow + the "debug a script via trace" flow + the memory boundary.
- [ ] Corpus regression: snapshot the two mods' traces as fixtures; a test re-runs and diffs.
- [ ] Memory + update the CLEO memory note ([[cleo-car-generator-parsing]] is the existing offline-parse memory — cross-link the new runtime VM).

## Verification

- The coverage report correctly lists the two mods' opcodes as implemented and flags any unimplemented ones with frequency.
- A trace of the Ferris script reads as a clear step-by-step (spawn → loop: rotate/wait) — usable to debug without a decompiler.
- An unknown opcode follows its declared tier (no-op-continue by default) and shows in coverage; a memory opcode hits the `UnsupportedMemoryModel` log, script degrades gracefully.

## Measurements / notes

_(record after implementation)_

- corpus coverage (% opcodes implemented across the corpus): …
- unimplemented tiers assigned: …
- memory-op strategy chosen for the future (documented, not built): …
