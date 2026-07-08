# 000 — Reproduce the ghost-barriers bug (deterministic repro harness)

Part of the [opensa-asi chain](readme.md), Phase 1 — **the very first task, before any RE or patching.** Everything downstream (RE in [001](001-reverse-engineering.md), the patch in [004](004-limit-patches.md), the pipeline flip in [006](006-pipeline-integration.md)) needs a fast, deterministic, ISOLATED reproduction to use as its pass/fail oracle. You cannot confirm a fix you can't reliably trigger the bug for.

## Context

The ghost-barriers post-mortem ([ghost-barriers.md](../../../../../docs/open-issues/ghost-barriers.md)) already reproduced this ONCE, the hard way: the full perfect-map build (~22k rows) flips the bug at **exactly 2^15 = 32,768** total permanent text-IPL instances map-wide (bisected: **31,300 rows → clean; 33,210 → bug**). Symptom: script-gated `barriers2.ipl` roadblocks appear permanently at the Hampton Barns bridge on any save, and teleport-then-save near the bridge crashes. Root: `CIplStore::IncludeEntity` (0x404C90) truncates the building-pool index to int16; `RemoveIpl` then deletes entities by that wrapped range.

Two problems make the full build a poor day-to-day oracle:

1. **Slow** — a full map build takes minutes; we'll rebuild the repro dozens of times while bringing up the patch.
2. **Entangled** — the full build stresses all FOUR unbounded structures at once (int16 `IplDef`, `gpLoadedBuildings` 4096/scene, `IplEntityIndexArrays` 40 slots, FLA×OLA `LinkLods`). Any of them can crash first, so a crash isn't attributable to int16 without controlling the other three.

We want a repro that is **fast, deterministic, and isolates the int16 ceiling as the ONLY variable**, with the full build kept as the guaranteed-correct fallback.

## Decisions

1. **Full-build repro first as the safety net, then minimize.** The full over-budget build is KNOWN to reproduce (it's how the bug was found) — stand it up as the guaranteed baseline oracle immediately. Then build the fast synthetic repro and prove it triggers the SAME crash; if synthetic isolation proves finicky, the full build (other three structures kept in-bounds) remains the fallback.
2. **Row-count dial.** A generator that inflates the map-wide permanent text-IPL row count to a chosen `N` with trivial dummy instances, so we can build at `N` just below and just above 2^15 on demand. This dial is the acceptance instrument for 004: patched → no flip at ANY `N`.
3. **Isolate the other three structures.** The repro build MUST keep text-IPL slots ≤ 39 (`IplEntityIndexArrays`), per-scene loaded buildings ≤ 4096 (`gpLoadedBuildings`), and exactly one limit adjuster (no FLA×OLA `LinkLods` double-patch). Then a crash past 2^15 is attributable to int16 alone. Log these counts per build so isolation is verifiable, not assumed.
4. **A detection oracle, not eyeballing.** Pass/fail must be crisp: **buggy** = the ghost `barriers2` props present at the bridge OR the teleport-save crash at its known address; **clean** = neither over K save/teleport cycles. A checklist + log-grep of the crash address, reusing the user's Wine setup — a repeatable procedure, not vibes. (A later enhancement: a tiny logging ASI that reads `IplDef.firstBuilding/lastBuilding` to observe the wrap directly — but that presupposes 002's toolchain, so it's optional and comes after.)
5. **Reuse the pipeline machinery — do NOT hand-roll IPLs.** The row-inflation rides the existing `@opensa/map-placement` / mod-installer text+binary emission (correct IDE↔IPL id matching, atomic text+stream coupling). This dodges the post-mortem's two test-hygiene traps directly (see below). `checkTextIplSlotBudget` currently PREVENTS exceeding 30k — the repro needs a documented flag to bypass it intentionally.
6. **Bake in the post-mortem's hygiene guards** so we never chase a false result:
   - **IDE↔IPL id match** — an IDE whose ids don't match its IPL silently skips ALL instances → a false "clean". Assert the dummy model's id is consistent across IDE + IPL + streams.
   - **Atomic text+stream toggling** — an orphan binary stream with `lod ≥ 0` crashes at boot (NULL `staticIdx`); the generator must emit/toggle text rows and their streams together.
   - **Stale caches** — disable modloader `CINFO.BIN`/`CColAccel` (they cached a wrong world on this install).
   - **Fresh saves** — always start from an uncontaminated save; a contaminated save is its own false signal.

## Tasks

- [ ] Stand up the full-build repro as the baseline: an over-budget build (>2^15 rows) with the other three structures kept in-bounds; confirm it reproduces the crash/ghosts on the user's install (re-confirm the exact 2^15 flip). Document the procedure.
- [ ] Row-inflation generator: given `N`, emit a mod/synthetic area adding ~`N` permanent text-IPL inst rows of a trivial dummy model via the existing map-placement/mod-installer path (correct ids, atomic text+stream), plus at least one binary-streamed group near the test location so stream-out exercises the wrapped range. Bypass `checkTextIplSlotBudget` behind a repro flag.
- [ ] Isolation asserts: per build, log slots (≤39), estimated per-scene buildings (≤4096), and confirm a single adjuster — so int16 is provably the only variable.
- [ ] Build the bracket: **clean** (`N` below 2^15, e.g. 32,000) and **buggy** (`N` above, e.g. 33,000); verify clean boots/plays and buggy reproduces — pinning the flip on this install (should match 31,300/33,210).
- [ ] In-game repro procedure (Wine): scripted-as-far-as-possible steps — install build, fresh save, load, teleport to the Hampton Barns bridge coords, save, observe; document the exact Wine commands, coords, and the crash address / ghost-appearance to watch.
- [ ] Detection oracle: crisp pass/fail checklist + log-grep of the crash address / ghost-prop presence over K cycles.
- [ ] Behavioural cross-check: the buggy build + real `ProperFixes.asi` → clean (bounds the fix; the same oracle 001's RE uses).
- [ ] Package as a one-command repro: `<cmd> --rows N` → a build ready to drop into the Wine install + the documented procedure. This is THE shared oracle for 001/004/006 — reference it, don't re-derive it.

## Verification

- The bracket reproduces the exact 2^15 flip on the user's install (clean at 32k, buggy at 33k), matching the post-mortem's 31,300/33,210 bisection.
- Isolation confirmed: the buggy build stays within slot/scene/adjuster bounds — the other three structures are ruled out, int16 is the sole cause.
- Real ProperFixes.asi turns the buggy build clean (oracle validated end to end).
- The synthetic repro is fast (minutes, not a full map build) and deterministic (same `N` → same result); the full-build repro stands as the fallback.

## Measurements / notes

_(fill during the repro build)_

- exact flip point re-confirmed on this install: …
- minimal rows to trigger + synthetic build time vs full build: …
- repro command + Wine procedure + detection oracle (crash address / ghost check): …
- isolation counts per build (slots / per-scene / adjuster): …
