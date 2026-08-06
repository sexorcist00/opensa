# 005 — hello-conformance (the end-to-end proof)

Part of the [cleo/sdk chain](readme.md). Depends on [004](004-dsl-builder.md) (the full pipeline).
Delivers the first AUTHORED script and the four verdicts that close the chain — plus the docs and
ledger sweep that makes the SDK a finished feature rather than a working pile.

## Context

Root-plan decision 5: the conformance proof is a minimal script, not a corpus rewrite. One tiny
`.cs` that a human can hold in their head end-to-end is worth more as evidence than a big one:
every byte of it is explainable, so any divergence between runtimes is attributable. The script is
also the SDK's living documentation — the example every future script (city-life included) starts
from.

## Decisions

1. **The script:** `hello-conformance` — `SCRIPT_NAME`, a `wait`-paced loop printing a periodic
   `0ACD PRINT_STRING_NOW`, clean termination (`004E`) after a fixed number of iterations. Dual
   target (no `opensa-only` flag), tiny declared budget (tens of instructions per tick, far under
   rhino's ~2 000 calibration point).
2. **Four verdicts, in order of increasing cost:**
   a) assemble → decode → disasm LISTING SNAPSHOT committed;
   b) headless STORY TEST on the VM — the print appears on schedule, the thread terminates, the
      measured instructions/tick is within the declared budget;
   c) FIELD boot — hand-place the artifact into `build/original/opensa/cleo/`, boot `?cleo=1`,
      census line +1, the print visible on screen;
   d) REAL CLEO under Wine — MANUAL, the user's harness; recorded in the ledger WHEN taken, with
      the exact exe/CLEO version. Until then the dual-target claim rests on the whitelist + the
      corpus-proven format, and this file says so honestly.
3. **Hand-placing is acceptable HERE** (a conformance artifact, not a shipping mod); if an authored
   script ever ships with the game build, it goes through the installers and
   `docs/contracts/mods.md` like any other CLEO mod — explicitly out of this plan's scope.
4. **Docs sweep in the same change** (the CLAUDE.md maintenance rules, applied once at the chain's
   close): `docs/features/cleo.md` gains the SDK state row; `docs/commands.md` already carries the
   build command (001) — verify it still matches; `docs/plans/097-cleo-basic/08-authoring-sdk.md`
   ledger updated with this chain's outcome; `docs/architecture/cleo-scripts.md` gains the SDK as
   a producer arrow (+ re-render the diagram) — the module map pointer goes to
   `cleo/sdk/README.md`.

## Tasks

- [ ] `cleo/scripts/hello-conformance/script.ts` + `story.test.ts` (behaviour + budget assertion).
- [ ] Listing snapshot committed; artifact builds deterministically.
- [ ] Field boot: census +1, print visible — verdict + screenshot/log line into Measurements.
- [ ] Real-CLEO Wine run (manual, with the user): artifact into the real game's CLEO folder, the
      print visible in-game — verdict + versions into Measurements. If deferred, the ledger says
      "not yet taken", never silence.
- [ ] Docs sweep per decision 4; chain readme statuses updated.
- [ ] Ledger: artifact size in bytes, instructions/tick measured vs declared, whitelist counts
      (from 003) restated, the field and Wine verdicts.

## Verification

All four verdicts recorded (or the manual one explicitly deferred); the full suite green; the docs
sweep landed in the same change. The chain's "done" definition in [readme.md](readme.md) holds.

## Measurements / notes

_(filled when executed — sizes, instructions/tick, verdicts with dates)_
