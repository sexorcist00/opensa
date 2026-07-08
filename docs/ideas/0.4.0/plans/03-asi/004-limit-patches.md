# 004 — Limit-lift patches (the payload)

Part of the [opensa-asi chain](readme.md). Depends on [003](003-patch-framework.md) (safe declarative machinery) which depends on [001](001-reverse-engineering.md) (the addresses). This is the whole point of the chain: **remove the int16 ceiling** so builds can add unlimited objects.

## Context

The four unbounded structures, from [ghost-barriers.md](../../../../../docs/open-issues/ghost-barriers.md), in impact order:

1. **`IplDef` int16 pool indexes** — THE root cause. `CIplStore::IncludeEntity` (0x404C90) truncates building-pool indexes to int16; `RemoveIpl` deletes entities by that `[firstBuilding..lastBuilding]` range. Past 32,767 permanent text rows the ranges wrap negative → stream-out corrupts CIplStore → ghost barriers + crashes. Ceiling: **2^15**, bisected exactly.
2. **`gpLoadedBuildings`** (0xBCC0E0, `CFileLoader::LoadScene`) — 4096 rows/scene into a static array; a 30k monolith writes ~26k pointers past it → trashed statics.
3. **`IplEntityIndexArrays`** (0x8E3F08) — 40 slots (one per gta.dat text IPL with inst rows); slot 41+ overwrites neighbours → boot crash in `LoadIplBoundingBox`.
4. **FLA×OLA `LinkLods` double-patch** — not ours to fix, but ours to NOT collide with (handled by 003's coexistence).

Our build's current work-around budgets (≤30k rows, ≤39 slots) exist ONLY because of 1–3. Lifting them is this plan; relaxing the budgets is [006](006-pipeline-integration.md).

## Decisions

1. **Widen by relocation, not in-place field edits, where the struct layout is fixed.** Per 001's per-structure strategy: `IplDef`'s int16 fields can't grow in place (the struct has a fixed size the whole engine indexes). The robust fix is to **widen the truncation logic to int32 and back the values with a parallel int32 store** keyed by IPL, OR relocate the pool-index bookkeeping — 001 decides which is minimal-and-complete. The patch here implements that decision; the completeness check (EVERY read of the four fields is covered) is the acceptance bar.
2. **Enlarge/relocate the two arrays** (`gpLoadedBuildings`, `IplEntityIndexArrays`) to our own `VirtualAlloc`'d blocks sized generously (e.g. 16× headroom), repointing every accessor found in 001. Static arrays are the easy case — no logic change, just base-pointer + bound edits.
3. **Each logical fix is one or more entries in 003's patch table** — declared, byte-verified, conflict-guarded, logged. No raw `WriteMemory` outside the table.
4. **Prove each fix independently.** A staged bring-up: patch (2) and (3) first (they crash at boot on big builds — easy pass/fail), then (1) (the subtle corruption — needs the row-count bisection test). Ship a build config that enables patches individually for bisection during bring-up.
5. **Headroom, not infinity.** int32 pool indexes + generously-sized arrays lift the ceiling far past any real build (millions of rows) without pretending other SA limits (streaming memory, pool sizes owned by FLA) vanish — those stay FLA's job. We fix exactly the truncation/overflow bugs, and document that streaming-memory/pool sizing is still FLA's domain (our ASI + FLA compose).

## Tasks

- [ ] Implement fix (2) `gpLoadedBuildings`: relocate to a sized block, repoint accessors; patch-table entries with verified original bytes.
- [ ] Implement fix (3) `IplEntityIndexArrays`: relocate/enlarge the 40-slot array + neighbours it currently clobbers; repoint `LoadIplBoundingBox` accessors.
- [ ] Implement fix (1) `IplDef` int16 → int32: widen `IncludeEntity` min/max logic AND every `RemoveIpl`/bounding-box read of `firstBuilding/lastBuilding/firstDummy/lastDummy` (the completeness bar from 001). This is the hard one — hooks + backing store as 001 specifies.
- [ ] Per-fix enable flags for bring-up bisection; default build enables all.
- [ ] In-game validation ladder (Wine), driven by **[000](000-reproduce-bug.md)'s repro dial + detection oracle**: (a) a >4096-row single-area build boots (fix 2); (b) a >40 text-IPL-slot build boots (fix 3); (c) a >33k-row build (past the 2^15 flip) runs WITHOUT ghost barriers and survives teleport-save near the Hampton Barns bridge (fix 1 — 000's buggy build, now clean). Then dial 000 to progressively higher `N` and confirm NO flip at any count. Record the row counts tested.
- [ ] Regression: with all patches on, a stock/unmodded game still boots and plays normally (patches are inert when limits aren't exceeded).

## Verification

- The ghost-barriers repro (>33k rows, save near the bridge) that flips the bug at 2^15 is CLEAN with our ASI and no ProperFixes installed — the standing goal met with our own code.
- Stock game unaffected; each fix independently demonstrable via its enable flag.
- All patches byte-verified against 1.0 US; wrong version / FLA-owned zones handled by 003.

## Measurements / notes

- max rows tested clean (target ≫ 2^15): …
- per-fix original/patched bytes (cross-ref patch-catalogue): …
- new effective ceiling + remaining FLA-owned limits: …
