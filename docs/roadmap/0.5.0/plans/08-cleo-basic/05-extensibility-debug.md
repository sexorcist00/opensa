# 0.5.0/08/05 — Extensibility, debugging & maintenance

Makes GROWING opcode coverage cheap and safe — the difference between "two scripts run" and "we
support CLEO". Carried from the idea with the tooling re-homed onto the F2 debugger.

## Decisions

1. **Opcode coverage as data.** A coverage tool decodes a `.cs` corpus (the two mods + whatever
   the user adds) → used / implemented / unimplemented / frequency. Runs in CI over the shipped
   `CLEO/` scripts so a newly-installed mod's unsupported opcodes surface at build time, and
   prioritises which handler to write next by real frequency.
2. **A script tracer = THE debugger.** `cleo.trace`: per thread, each dispatched opcode (Sanny
   name) + operands + host effects + waits — readable as a story (spawn → loop: rotate/wait).
   Surfaced in the F2 CLEO group (live thread list → open trace; a "step one thread" affordance).
3. **Unimplemented-opcode policy, explicit tiers** per opcode, declared in a registry:
   (a) no-op-continue (cosmetic/browser-irrelevant), (b) conditional-default (unimplemented
   conditional returns a defined result — usually false — so control flow stays sane),
   (c) kill-thread (genuinely unrunnable). Unknown default = no-op-continue + once-per-opcode
   warning feeding the coverage report.
4. **MemoryModel seam** (the big future fork): all memory opcodes (`0x0A8C/0x0A8D`, CLEO+ helpers)
   route through `MemoryModel`, default `UnsupportedMemoryModel` (log + tier). Future options
   documented, not built: an emulated virtual map shimming common addresses to engine getters, or
   a curated address→binding table. The seam makes either an addition, not a VM rewrite.
5. **"Add an opcode" is a documented one-file flow** (module README): RE semantics (Sanny DB +
   GTAMods wiki) → add a `CleoHost` method if a new capability is needed → `registerOpcode` →
   declare its tier → fixture test.
6. **Corpus regression**: each newly-supported script snapshots its trace as a fixture; the corpus
   re-runs on handler changes (the physics-CI philosophy applied to scripts).

## Subtasks

- [ ] Coverage tool + CI step over shipped `CLEO/` scripts.
- [ ] Tracer + F2 integration (thread list, per-thread trace, step).
- [ ] Tier registry + default-unknown path + warnings→coverage plumbing.
- [ ] `MemoryModel` seam + default + README documentation of the two future strategies.
- [ ] Module README: architecture, add-an-opcode flow, debug-a-script flow, memory boundary.
- [ ] Trace-snapshot fixtures for both mods + corpus regression test.
- [ ] Memory update: cross-link the runtime VM from [[cleo-car-generator-parsing]] (the offline
      ancestor) + chain close-out.

## Verification

- Coverage report lists both mods 100 % implemented (or flags exactly what's missing with
  frequency); a Ferris trace reads step-by-step without a decompiler; an unknown opcode follows
  its tier and shows in coverage; a memory opcode hits `UnsupportedMemoryModel` and the script
  degrades gracefully.

## Ledger

_(corpus coverage %, tiers assigned, memory strategy noted for the future)_
