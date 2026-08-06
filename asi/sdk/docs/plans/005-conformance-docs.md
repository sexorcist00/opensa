# 005 — Conformance & docs sweep (chain close)

Part of the [asi/sdk chain](readme.md). Depends on 004. The proof that closes the chain and
carries the docs/ledger sweep — the `hello-conformance` role, played here by the migration itself.

## Context

cleo's 005 set the shape: the cheapest sufficient artifact proven end-to-end, verdicts of
increasing cost, the manual step recorded honestly until taken. For this chain the artifact is
`dist/perfect-map.asi` built through the SDK, and the verdict ladder is: (a) the build matrix +
referee diffs (done in 003/004), (b) the Wine dry-run on the real install — the verify-only log
must show the same site verdicts as the pre-SDK plugin, (c) the in-game int16 oracle (ghost
barriers stay gone on the 33k repro) — (b) and (c) are user-manual, and this file says so honestly
until they are taken.

## Decisions

1. **No new verdict machinery** — the existing ladder (dry-run log, FLA/OLA coexistence, the
   repro oracle) is the whole proof; the chain adds no test theatre around a manual step.
2. **Docs sweep in this plan, not later** (the cleo 005 discipline), including the graduated-idea
   trail: the ideas README row is already gone (graduation), the architecture/tools doc gains the
   SDK, and every doc that described perfect-map's framework as its own now points at the SDK.

## Tasks

- [x] Full meta sweep: root tsc, full `eslint .`, complete vitest run, `npm run arch:render`
      (revert unchanged-source assets — the mermaid jitter trap).
- [ ] Wine dry-run + field oracle verdicts (user-manual): **PENDING** — see the ledger.
- [x] Docs: `docs/architecture/tools.md` (the asi section now describes sdk + consumers),
      `asi/perfect-map` docs cross-check, roadmap city-life plan points at `asi/sdk` (001), chain
      readme statuses, the architecture doc's Decided section confirmed against what shipped.
      `docs/commands.md` needed no change: `build:asi` / `build:verify` / `build:debug` / `gen`
      and the `make APPLY=1|DEBUG=1|PM='-D…'` knobs are all unchanged by the migration.
- [x] Ledger below + the chain readme's "what done means" confirmed line by line.

## Verification

Every chain plan's ledger is filled; the suite/tsc/lint are green at the closing commit; the
duplication list in the city-life roadmap plan is demonstrably dead (a second plugin writes only:
catalogue, payloads, config knobs, thin Makefile); the manual verdicts are either recorded or
explicitly pending.

## Measurements / notes

### Shipped (2026-08-06) — with one verdict honestly outstanding

**What a second plugin now writes**, measured by listing what is left in the consumer after the
migration (this is the chain's headline claim, and the city-life roadmap plan's copy-verbatim list
is dead):

| Consumer file | What it is |
| --- | --- |
| `gen/catalogue.ts` (+ its test) | its rows: addresses, expected bytes, provenance |
| `gen/generate.ts` | 20 lines calling the SDK renderer with its namespace + output path |
| `src/patches/*.hpp` | what its fixes actually do |
| `src/apply.hpp` | the `asi::ApplyFn` that runs them |
| `src/plugin.hpp`, `src/identity.hpp` | one `constexpr asi::Plugin`: tag, log file, tables, apply |
| `src/dllmain.cpp` | 18 lines: hand the plugin to `asi::OnAttach` |
| `Makefile` | 10 lines: `PLUGIN_OUT`/`SRC`/`HDRS`, then include the SDK fragment |

Everything else — the fingerprint gate, byte-verify, coexistence, hooks, both loggers, the attach
lifecycle, the freestanding CRT builtins and the whole cross-compile line — is the SDK's.

**Meta sweep:** full suite **431 files / 3 737 tests green** (was 429/3 733 pre-chain: +2 files,
+4 tests — the SDK's renderer tests and perfect-map's catalogue tests); root `tsc --noEmit` clean;
full `eslint .` clean; `npm run arch:render` shows `asi_sdk` in the TOOLS subgraph with
`runtime-packages.svg` untouched (`boot-flow.svg` jittered with no source change — reverted).

**Artifact (the migration's product), pinned `SOURCE_DATE_EPOCH`:** apply 19 456 B sha256
`53397add32394e0d…`, verify-only 11 264 B `a46a779952467e37…`, import table KERNEL32-only, the
same 17 functions as the pre-SDK baseline. The five build modes (apply / verify-only / apply+debug
/ both per-fix bisections) all link.

**The outstanding verdicts — NOT taken, and this file says so rather than implying otherwise:**

1. **Wine dry-run on the real install** — run the verify-only build against the modded install and
   confirm the site report reads as before (13 sites now, up from 10: the three continuation
   anchors joined the catalogue in 004). Expected: all pristine, or FLA/OLA-owned sites deferring
   exactly as they did.
2. **The int16 oracle in-game** — ghost barriers still gone on the 33k repro
   (`tools-debug/sa-int16-repro`), and the 2dfx guard still holding.

Both are user-manual by nature (a Windows game under Wine, judged by a human). Everything a
macOS-side check CAN prove has been proven above; what remains is the half only the field can
answer, and until it is taken this chain is **code-complete, not field-confirmed**.
