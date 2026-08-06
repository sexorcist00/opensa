# 003 — Dual-target whitelist (the gate)

Part of the [cleo/sdk chain](readme.md). Depends on [002](002-assembler-core.md) (the IR the gate
walks). Delivers the guarantee behind the SDK's central claim: an emitted `.cs` runs on BOTH
runtimes, or its name says it does not.

## Context

The root plan's decision 4: allowed = (opcodes real CLEO 4.x serves on SA 1.0 US) ∩ (our VM's
handler registry). The danger this plan removes is silent drift — a hand-maintained list would rot
the day either side moves. So both halves are machine-derived, and the gate can never disagree with
reality without a build going red.

## Decisions

1. **Our side is `HandlerRegistry.ids()`** — genuinely SERVED opcodes only. Declared tiers
   (`noop` / `conditional-false` / `kill-thread`) are degradation policy for foreign scripts, NOT
   support: an authored script may not lean on a tier, so tiered ids stay outside the whitelist.
2. **The real-CLEO side is derived from the vendored `sa.json`** — the Sanny library attributes
   commands to the base game vs extensions (CLEO et al.). The FIRST task of this plan is research:
   pin exactly what the DB encodes (attribute names, edge cases, opcodes CLEO 4 serves that the
   attribution misses or over-claims), and record the derivation rule + its known residual in this
   file's notes. If the DB's attribution proves insufficient, the fallback is an explicit generated
   list with its provenance stated — never a silent hand-list.
3. **The whitelist is GENERATED data** (`src/whitelist/whitelist.generated.ts`, a
   `npm run cleo:opcodes`-style script beside it): regenerated from the two sources, committed, and
   a CI test fails when regeneration would change it — same discipline as the opcode table.
4. **Gate placement:** walking the IR after DSL construction, before assembly. A violation is a
   build ERROR naming the opcode (id + Sanny name) and WHICH runtime lacks it — the error message
   is the fix's map.
5. **The escape hatch is per-script and visible:** `target: 'opensa-only'` in the script definition
   lifts the real-CLEO half of the gate (the VM half always holds — we never emit what we cannot
   run). The artifact is then named `<name>.opensa-only.cs`. A NAME now carries behaviour →
   **`docs/contracts/mods.md` is extended in the same change** (what the suffix means, what happens
   when it is absent on a script that needed it: real CLEO faults on an unknown opcode — the
   failure is theirs, loud, not ours, silent).

## Tasks

- [ ] Research the vendored DB's extension attribution; write the derivation rule + residual into
      Measurements below (counts per source: base-game opcodes, CLEO-extension opcodes, VM-served,
      intersection size).
- [ ] Whitelist generator + committed `whitelist.generated.ts` + the regeneration-drift CI test.
- [ ] The gate over IR + located build errors; unit tests: a dual-target script passes, a
      forbidden opcode fails naming both the opcode and the missing runtime, `opensa-only` lifts
      exactly the real-CLEO half.
- [ ] Artifact naming in `build.ts` (`<name>.cs` / `<name>.opensa-only.cs`).
- [ ] `docs/contracts/mods.md` — the naming rule, in the same change.
- [ ] Ledger: the intersection counts per runtime (the whitelist size IS the SDK's usable surface —
      record it).

## Verification

Regenerating the whitelist is a no-op diff in CI; the three gate behaviours are unit-tested; the
contract doc carries the suffix rule. The whitelist counts are recorded in Measurements.

## Measurements / notes

_(filled when executed — derivation rule, residual, counts per source and the intersection)_
