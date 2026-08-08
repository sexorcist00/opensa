# 098/08 — Acceptance & close-out (the big-rework rule)

**Goal:** the chain ends the way the repo requires a big rework to end: per-class acceptance drives, the
regression gate extended and green, before/after benchmarks committed, an audit written, and every doc
the chain touched settled in the same state as the code.

## Steps

- [ ] **Acceptance programme.** One field session per class family with the user driving: bikes (NRG +
      BMX), quad/mtruck, an artic combination, a lowrider, plus the sedan control. Each verdict recorded
      from the reporter's exact angle; a complaint that survives a fix triggers the second-cause rule
      before re-tuning (the 081 lesson).
- [ ] **Regression gate.** `phys-regression.ts` bands cover the new scenes (bike straight/slalom/
      wheelie, trailer stability) against reference captures committed to
      `docs/benchmarks/vehicle-physics/`; the pre-098 car bands are unchanged — proof the fleet work
      did not move the accepted car feel.
- [ ] **Performance benchmark.** Before/after drive benchmark with a representative busy scene
      (bikes + an artic + ability cars live) — the `vehicles` slice (`live`, `meanMs`, `maxMs`) is the
      headline number; the balance controller and joints must fit the fixed-step budget 081/07
      established. Numbers into `docs/benchmarks/opensa-engine/` with the pak build named.
- [ ] **Audit.** `docs/audit/all-land-vehicles-098.md`: what changed (parsers, module, controller,
      joints), what it cost (frame numbers, code size), what it bought (the fleet census before/after —
      from "144 of 201 land rows drivable" to the closing number).
- [ ] **Docs settle.** `docs/features/vehicles.md` + `vehicle-special-abilities.md` states final;
      `docs/contracts/vehicles.md` vocabulary complete for everything shipped;
      `docs/architecture/` vehicle module doc + diagram re-rendered; hacks/restrictions/edge-cases rows
      match reality; `docs/commands.md` for any new CLI/URL params; the 0.6.0 out-of-scope note checked
      against what actually shipped.
- [ ] **Memory.** The session memory carries only what the repo does not: field-verdict nuances and any
      trap that cost a round.

## Verification

The audit and benchmark files EXIST and are linked from the plans index row — a chain without them is
unfinished by definition (CLAUDE.md standing rule).

## Ledger

(final census, benchmark links, audit link)
