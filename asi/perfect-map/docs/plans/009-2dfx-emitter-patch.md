# 009 — 2dfx emitter-lifecycle patch

Part of the [perfect-map ASI chain](readme.md), Phase 2. Depends on [008](008-2dfx-emitter-re.md) (the confirmed mechanism + catalogue rows), [007](007-2dfx-reproduce.md) (the repro fixture + detection oracle), and Phase 1's [003](003-patch-framework.md) (the patch framework) / [005](005-build-debug-test.md) (the test harness). Implements the fix in OUR asi so particle 2dfx can ride LODs without the leak.

## Context

008 pins the mechanism (missing/incomplete effect-destroy path for LOD-cloned emitters, and/or a bounded fx pool that overruns under many-simultaneous-emitters pressure) and produces two-source-cited catalogue rows. This plan turns those rows into patch-table entries — declared, byte-verified, conflict-guarded, logged — exactly like the limit patches in Phase 1's [004](004-limit-patches.md). Nothing new in the framework; this is a second payload on it.

## Decisions

1. **Prefer the real lifecycle fix over a pool bump.** Per 008's "fix vs mask" finding: restore/complete the effect-destroy path so emitters actually UNLOAD when a LOD leaves range. Enlarging a pool only delays the crash and leaves the far-view emitter storm fully active. A pool relocation is a fallback (or complement) only if the lifecycle can't be cleanly restored via a hook.
2. **Implemented as patch-table entries** (from 003): each site has `expectedOriginalBytes` + `apply` + `conflictsWith` (any FLA/OLA or PF-owned overlap → skip + log). A per-fix enable flag for bring-up bisection (same pattern as 004).
3. **Hook, not raw-write, for the logic change.** A missing destroy call is naturally an injector function-hook on the entity stream-out / `DestroyEffects` path (mirror the SA convention: pair every `CreateEffects` with `DestroyEffects`). Raw byte edits reserved for any bound/pointer change on a pool relocation fallback.
4. **Compose with the limit patches, don't fight them.** This fix touches the effect/fx subsystem, disjoint from the IplDef/array zones of Phase 1 — verify no address overlap; both payloads live in the same table, gated independently.
5. **Correctness bar = emitters unload, not just "no crash".** Acceptance requires the effect/pool count returning to baseline as LODs stream out (measured, via 007's detection oracle), not merely surviving the new-game load.

## Tasks

- [ ] Implement the fix as patch-table entries from 008's catalogue rows: the lifecycle hook (pair create/destroy for LOD-path emitters) and/or the pool bound/relocation fallback; byte-verified originals; `conflictsWith` for PF/FLA overlap.
- [ ] Per-fix enable flags; default build enables the 2dfx fix alongside the Phase-1 limit fixes.
- [ ] Host-side (macOS) byte-level tests for any raw edits (fake-buffer apply, per 005); catalogue-parser tests for the new rows.
- [ ] Wine validation with the 007 repro fixture (un-stripped particle LODs): (a) new game no longer crashes at `0x004AA3A1`; (b) effect/fx count returns to baseline as the emitting LODs leave range (the real-unload proof, instrumented per 007); (c) up-close HD emitters still work (we didn't break normal effects); (d) a stock/unmodded game still boots and plays (patch inert when no leak exists).
- [ ] Regression with all Phase-1 patches on: full asi (limits + 2dfx) boots clean on a normal build; no zone overlap between payloads.
- [ ] Update the tool README's patch list + the "extend" section: this is the worked example of adding a second engine fix on the framework.

## Verification

- The 007 repro that crashes on stock 1.0 boots clean with OUR asi (no ProperFixes) — the standing goal for this class met with our own code.
- Emitters demonstrably UNLOAD (count/memory returns to baseline), not just "crash delayed".
- Normal HD effects and a stock game are unaffected; each fix independently toggleable via its flag.

## Measurements / notes

_(record after implementation)_

- fix implemented: lifecycle-hook / pool-relocation / both: …
- emitter count over a new-game load (before/after, showing unload): …
- per-site original/patched bytes (cross-ref patch-catalogue): …
