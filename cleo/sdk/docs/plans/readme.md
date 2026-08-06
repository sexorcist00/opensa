# cleo/sdk — plan chain (CLEO authoring SDK)

Build `@opensa/cleo-sdk`: author CLEO scripts in TypeScript, compile to standard CLEO 4 `.cs` —
one source, two runtimes (real CLEO on SA 1.0 US, and our VM). The standing design is
[`../architecture.md`](../architecture.md); the root-level plan with the goals check and scope cuts
is [`docs/plans/097-cleo-basic/08-authoring-sdk.md`](../../../../docs/plans/097-cleo-basic/08-authoring-sdk.md).

Scope cuts inherited from the root plan (the user's call, 2026-08-05): NO corpus rewrites — rhino
tracks stays the author's script, `no_lights.cs` stays skipped; ped-task opcodes and the city-life
scripts themselves arrive with the class-C facet, not here.

## The chain

| #   | Plan                                                      | Delivers                                                                                                                     | Status  |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [001 — Scaffold & workspace wiring](001-scaffold.md)      | the `cleo/` root category, the `cleo/sdk` workspace project, `cleo/scripts/` home, build command, CI/lint/tsc green on empty | done    |
| 2   | [002 — Assembler core](002-assembler-core.md)             | the decoder's mirror: operand writer, labels/jumps, LVARs, native-call tails, trailer; corpus re-encode byte-identical       | done    |
| 3   | [003 — Dual-target whitelist](003-dual-target-whitelist.md) | generated allowed-set (real CLEO ∩ VM registry), the build gate, `opensa-only` flag + artifact-name contract               | planned |
| 4   | [004 — DSL builder](004-dsl-builder.md)                   | the typed authoring surface: threads, labels, wait, if/else lowering, opcodes by Sanny name, raw escape hatch                | planned |
| 5   | [005 — hello-conformance](005-hello-conformance.md)       | first authored script end-to-end: listing snapshot, headless story, field boot, manual real-CLEO verdict; docs sweep         | planned |

Dependencies are linear 001 → 005. 002 is the load-bearing step (the bytes); 003 and 004 both sit
on 002's IR; 005 is the proof that closes the chain and carries the docs/ledger sweep. The chain is
independent of the runtime — it touches no engine file, so it may interleave with any parallel work.

## What "done" means for the chain

A script authored in TS compiles to a `.cs` that (a) our disassembler renders to the expected
committed snapshot, (b) runs headless within its declared per-frame budget, (c) boots in the field
via the normal `cleo/` path, and (d) contains only dual-target opcodes unless explicitly flagged in
its artifact name. Re-running the build yields byte-identical artifacts. The manual real-CLEO run
under Wine is recorded in 005's ledger when taken.
