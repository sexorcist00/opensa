# model-repack — the LOD half of the OpenSA one-model swap (opensa-lod-generator plan 007)

**Date:** 2026-08-17 · **Machine:** macOS 25.6 (Darwin), APFS, Node 24 · **Code:** opensa-lod-generator plan 007 phase 1.

**Inputs:** `build/gostown/opensa` (599 MB — the only OpenSA tree on disk; `build/original/opensa` was wiped
at session 18's close), `game-src/gostown/models/*.img` (`gostown6.img` 189 MB), `mods-src/gostown/mods`;
target `gp_dt_01`, one placement, rect `3,-4` (1 cell, 9 models).

| Run | Wall | LOD rebake | Lab pak |
| --- | --- | --- | --- |
| `model-repack.ts gp_dt_01 --game gostown` | 1.9 s | 1.2 s (1 cell) | 1.5 MB, 2 entries: `3,-4,hd` 33 425 B, `3,-4,lod` 24 383 B, 16 texture arrays |
| same, `--raw` | ~1.9 s | 1.0 s | 1.6 MB, 2 entries |
| shipping `build/gostown/opensa/pak` for reference | — | — | `3,-4,lod` 24 992 B |

The two runs' `gp_dt_01.dff` differ (md5 `be87b1ae…` / `f2a79fa5…`) and so do their `lod_3_-4.dff`
(`4a0b16c8…` / `cbcb4ac5…`): the lab's far view is cut from the swapped HD, which is the point of the phase.
Before today the same run reported "no DFF source for 9 model(s)" and welded 0 cells — the script read
`game-src/<game>/models/gta3.img` alone, and gostown's world lives in `gostown6.img` (fixed: `openArchiveIndex`
over every source archive). The `original` numbers (a 111-model rect took ~10 s in plan 024 phase 0) will be
re-measured when `build/original/opensa` exists again.
