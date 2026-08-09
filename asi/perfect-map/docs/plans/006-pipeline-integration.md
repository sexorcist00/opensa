# 006 — Pipeline integration & budget lift

Part of the [perfect-map ASI chain](readme.md). Depends on [004](004-limit-patches.md) (a working ASI) + [005](005-build-debug-test.md) (it's trustworthy). Closes the loop: **ship the ASI with our builds and relax the work-around budgets that only existed because of the bug**.

> **Read this before decision 2 (2026-08-08).** Two of its premises moved. **Stock SA is not a target of this
> project** (the declared configuration is OLA + FLA + this asi — `docs/gta-sa-original/reference-install.md`),
> so the "stock vs opensa-asi mode" split this plan proposes is not the axis to build: pmb already has a
> `--target sa|opensa` selector, and **its `opensa` means OUR ENGINE, not "SA with our asi"** — do not reuse
> the word for a third meaning.
>
> **And on 2026-08-09 decision 2 lost its subject entirely.** There is no int16 gate left to make ASI-aware:
> pmb's `checkTextIplBudgets` became `reportTextIplCensus`, and the 30,000-row throw, the 39-slot line and
> `--allow-text-row-overflow` were deleted — the target always carries OLA + FLA + this asi, so those are not
> its ceilings. **What survives of this plan is task 1 only: pmb SHIPS the asi into `sa/`.** That is now the
> whole point rather than a step toward a budget lift — the build already emits maps a plain install cannot
> run (39 219 permanent rows), and nothing checks the asi is there.

## Context

`checkTextIplSlotBudget` in `tools/perfect-map-builder/src/pipeline.ts` fails the build past **39 text-IPL slots / 30,000 rows** — guards that exist purely because of the int16/array bugs 004 now fixes. `checkImgIdBudgets` (the FLA FILE*TYPE*\* pools, just corrected in the shopping.dat work) is a DIFFERENT class (FLA's runtime pools, still real) and stays. The map-installer + placement machinery (binary streams, `linkedHeight`, per-area budgets) can stay as-is — they're still good economy — but the HARD CEILING they were fighting is gone.

## Decisions

1. **The ASI ships as a build output, installed like other real-game mods.** perfect-map-builder's `sa` target (the real-game dir) drops `perfect-map.asi` into the game's ASI folder (`scripts/` or root per the ASI loader convention), alongside the map. It's OUR dependency now — no user-supplied ProperFixes/FLA needed for the limit fix (FLA still recommended for its pool sizes — document the division of labour).
2. **Budgets become ASI-aware.** `checkTextIplSlotBudget` gains a mode: with the ASI shipped, the int16 ceiling guard (30k rows) and the 40-slot guard lift to the new effective ceiling (from 004's measured max) or off; without it, the stock guards stay (someone building for a vanilla exe). A build flag / config selects "target: stock" vs "target: opensa-asi". Loud, explicit, never silently over-budget.
3. **Keep the economy, drop the ceiling fight.** `linkedHeight`, per-area row budgets, slot folding stay (they reduce memory/draw regardless). We stop MIGRATING/cutting content solely to dodge 2^15 — the generators can place freely up to the new headroom.
4. **Version-pinned pairing.** The shipped `.asi` build hash is recorded in the build manifest so a map built for "opensa-asi target" is paired with the exact ASI that lifts its limits — a mismatch is detectable, not a mystery crash. (The ASI's own fingerprint gate already refuses the wrong exe; this pairs asi↔map.)
5. **Fallback honesty.** If the user runs the "opensa-asi" build WITHOUT the asi (deleted it, wrong loader), the game corrupts exactly as before — so the installer verifies the asi is present/loadable for that target and warns loudly (same spirit as the `Remove original` / merge guards).

## Tasks

- [ ] pmb `sa` target: emit `perfect-map.asi` (built by `tools/opensa-asi`) into the correct ASI-loader location; wire the native build into the pmb flow (or consume a pre-built artifact from CI — decide by build-time cost).
- [ ] `checkTextIplSlotBudget`: add stock vs opensa-asi target modes; new ceilings from 004's measured max; tests for both modes (mirrors the `checkImgIdBudgets` test style).
- [ ] Build manifest: record shipped `.asi` sha256 + the effective limits it grants; installer-side presence/version check with a loud warning on mismatch/absence.
- [ ] Generator budget knobs (lod-trees per-area 4000, lod-procobj, slot folding): expose their ceilings so the opensa-asi target can raise them; keep stock defaults for the stock target.
- [ ] End-to-end: build an intentionally >30k-row full map for the opensa-asi target, install with the asi, boot in Wine → clean (the 004 ladder, now driven by the REAL pipeline, not a hand build).
- [ ] Docs: update ghost-barriers.md status (🟡 → ✅ ROOT-FIXED, our own asi), the mod-installer memory (the "standing goal — own engine patch" line resolves), pmb readme (the two targets + the asi dependency).

## Verification

- A full build that exceeds the old 30k/39 budgets builds WITHOUT error in opensa-asi mode and boots clean with the shipped asi; the SAME build in stock mode still fails the budget guard (both modes correct).
- ghost-barriers repro driven by the real pipeline is clean; without the asi the same build corrupts (fallback honesty verified).

## Measurements / notes

- new effective row/slot ceilings shipped: …
- a real over-old-budget build's counts (rows/slots) + boot result: …
- docs/memory updated: …
