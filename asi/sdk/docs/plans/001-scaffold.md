# 001 — Scaffold & workspace wiring

Part of the [asi/sdk chain](readme.md). No dependencies — the chain's first step. Delivers the
workspace project every later plan builds inside, the widened repo wiring, and the BASELINE the
whole chain's referee measures against.

## Context

The `cleo/sdk` scaffold (its plan 001) is the template, which itself copied `asi/perfect-map`'s
shape. Differences here: the SDK ships no CLI and no `dist/` (it is a header/library project — its
consumers build the artifacts), so there is no "build command that reports zero"; the standing
green command is the CONSUMER's build (`npm run build:asi -w @opensa/perfect-map-asi`), which must
stay green through every step of the chain.

## Decisions

1. **Names as decided:** project `asi/sdk`, package `@opensa/asi-sdk` (`private: true`, nx tag
   `type:tool`), no per-package tsconfig, no declared dependencies (repo convention: one root
   tsconfig, workspace-wide resolution).
2. **The baseline is recorded now**, before anything moves: build perfect-map from the untouched
   tree and record `dist/perfect-map.asi`'s size + sha256 (APPLY=1 and verify-only both), plus the
   import-table listing (`objdump -p`). 003/004 diff against these numbers.
3. **Same-change doc alignments** (decided at review): the roadmap's `asi/common` wording
   (`docs/roadmap/0.5.0/plans/06-city-life/1-preparation/01-asi-clean-streets.md`) becomes
   `asi/sdk`; `docs/links.md`'s gta-reversed row is aligned to `gta-reversed-modern` (the repo the
   catalogue actually cites).
4. **Tests co-located** for the TS half (the `packages/` convention, as cleo chose and for the
   same reason: plain TS, no cross-compile boundary in the SDK's own test surface).

## Tasks

- [ ] `asi/sdk/package.json`, added to the root `workspaces` list.
- [ ] `asi/sdk/README.md` — layout, the why-root-not-tools line, pointers to
      `docs/architecture.md` and this chain.
- [ ] Widen `vitest.config.ts` glob `asi/perfect-map/**/*.test.ts` → `asi/**/*.test.ts`; widen
      `eslint.config.ts` node-globals glob the same way.
- [ ] Roadmap + links wording (decision 3).
- [ ] Record the baseline (decision 2) in this file's ledger.
- [ ] Meta-checks: root tsc, full `eslint .`, vitest, `npm run arch` (`asi-sdk` must land in the
      TOOLS subgraph — `scripts/arch-graph.ts` already classifies the `asi/` prefix, verify the
      render; revert any unchanged-source mermaid assets the render jitters).

## Verification

Full lint + typecheck + test run green with the empty project in the tree; `npm run build:asi -w
@opensa/perfect-map-asi` builds byte-for-byte what the baseline records (nothing moved yet);
`git status` clean after a build.

## Measurements / notes

*(ledger filled when shipped: suite counts, baseline sizes + hashes, import table)*
