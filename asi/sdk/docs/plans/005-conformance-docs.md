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

- [ ] Full meta sweep: root tsc, full `eslint .`, complete vitest run, `npm run arch`
      (re-render; revert unchanged-source assets — the mermaid jitter trap).
- [ ] Wine dry-run + field oracle verdicts (user-manual): recorded here when taken, marked
      pending until then.
- [ ] Docs: `docs/architecture/tools.md` (the asi section reflects sdk + consumer),
      `docs/commands.md` (only if a command/knob changed), `asi/perfect-map` docs cross-check,
      roadmap city-life plan already points at `asi/sdk` (001), chain readme statuses → done,
      the architecture doc's Decided section confirmed against what actually shipped.
- [ ] Ledger below + the chain readme's "what done means" confirmed line by line.

## Verification

Every chain plan's ledger is filled; the suite/tsc/lint are green at the closing commit; the
duplication list in the city-life roadmap plan is demonstrably dead (a second plugin writes only:
catalogue, payloads, config knobs, thin Makefile); the manual verdicts are either recorded or
explicitly pending.

## Measurements / notes

*(ledger: final suite counts, artifact sizes/hashes, the Wine + oracle verdicts with dates, the
second-plugin file list)*
