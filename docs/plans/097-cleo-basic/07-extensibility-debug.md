# 097/07 — Extensibility, debug surface & close-out

Turns "seven scripts run" into "we support CLEO": coverage as data, the tracer in F2, explicit
unimplemented tiers, the add-an-opcode/add-an-atlas-row flow, and the chain's documentation + audit
close-out.

## Decisions

1. **Opcode coverage as data, in CI.** `cleo-census` (plan 02) joined against the handler + tier +
   atlas registries runs in CI over the SHIPPED `cleo/` scripts of every game build — a newly
   installed mod's unsupported opcodes/addresses surface at build time, sorted by real frequency
   (the next-handler priority list writes itself).
2. **The tracer IS the debugger.** `cleo.trace`: per thread, each dispatched opcode (Sanny name) +
   operands + host effects + waits — and atlas ops as SYMBOLS ("GetFrameFromName('misc_a') → part 7"),
   never raw addresses. Readable as a story.
3. **F2 CLEO screen, the `PhysicsPanel` pattern exactly** (recon: there is no registry — the flow is
   mechanical): a `Screen` literal + capability flag in `debug-capabilities.ts`, gate in
   `SCREEN_CAPABILITY`, accessor members on `DebugActions` (`debug-overlay.tsx`), implementations as
   thin host closures in `engine-debug-actions.ts`, deps wired in `engine-canvas-host.tsx`. Screen
   contents: enable/trace toggles, running-thread list (name, state, wait, instr/frame), per-thread
   trace view, coverage summary (implemented/unimplemented counts + the unserved-address list from
   plan 05), a step-one-thread affordance. Unsupported rows hidden, never dead (the doctrine).
4. **Unimplemented tiers, explicit per opcode AND per atlas row**: (a) no-op-continue (cosmetic),
   (b) conditional-default (defined result, usually false — class C's task opcodes live here so Car
   Left Door degrades to "detected, did nothing, said why"), (c) kill-thread (genuinely unrunnable).
   Unknown default = (a) + once-per-opcode warning feeding coverage.
5. **"Add an opcode" and "add an atlas row" are documented one-file flows** (module README): RE the
   semantics (Sanny DB + GTAMods wiki / gta-reversed) → host method if a new capability → register →
   declare tier → fixture test. This is the growth path the whole chain was shaped for.
6. **Corpus regression**: every supported script snapshots its headless host-call trace as a fixture
   (Ferris + Wind Farm + firela + van door + rhino + Car Left Door's degraded trace); the corpus
   re-runs on handler/atlas changes (the physics-CI philosophy applied to scripts).
7. **Docs close-out in the same change set** (the standing rules): `docs/features/cleo.md` (+ README
   row), `docs/architecture/` module doc + mermaid diagram (`arch:render`), `docs/contracts/` already
   done in 06, `docs/commands.md` tool rows done in 02, memory cross-links updated. **Chain close =
   audit in `docs/audit/` + before/after benchmark in `docs/benchmarks/`** (big-rework rule): boot
   cost with N scripts, steady-state per-frame VM+host+atlas cost with the full corpus live, versus
   `cleo.enabled: false`.

## Subtasks

- [ ] Census→registry join + CI step over shipped scripts.
- [ ] Tracer (symbolised atlas ops) + trace ring buffer sized for the F2 view.
- [ ] F2 screen (decision 3) + capability plumbing.
- [ ] Tier registries (opcode + atlas) + default-unknown path + warnings→coverage plumbing.
- [ ] Class C tier assignment: Car Left Door runs, boarding opcodes answer tier-b, coverage names the
      missing ped-task facet (pointer to city-life).
- [ ] Module README: architecture, add-an-opcode flow, add-an-atlas-row flow, debug-a-script flow.
- [ ] Trace-snapshot fixtures for the corpus + regression test.
- [ ] Docs + audit + benchmark close-out (decision 7).

## Verification

- Coverage report: classes A+B 100 % implemented; class C flags exactly the ped-task set with
  frequencies. A Ferris trace reads step-by-step without a decompiler. An unknown opcode follows its
  tier and shows in coverage. The benchmark records the corpus's total per-frame cost against the
  plan 03 budget, and `enabled: false` measures zero.

## Ledger

_(corpus coverage %, tiers assigned, per-frame numbers, audit + benchmark links)_
