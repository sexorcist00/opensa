# Dedupe the clone-LOD textures into a `txdp` parent again

**Status: GIVEN UP for correctness, 2026-08-16 — and it will not come back without proof.** The clone
dictionaries `sa-lod-generator` writes are self-contained now: every `salodNNNN` carries every texture its
models name, and no `salodpar` parent is written at all
([plan 006](../../../tools/sa-lod-generator/docs/plans/006-txdp-parent-textures.md) built the parent; the
field retired it).

**Impact: archive bytes only — nothing per frame.** Plan 006's own measurement of the same map:

| clone TXD payload | size |
| --- | --- |
| 0.5 scale, per-atlas dictionaries (before 006) | 114.8 MB |
| 0.25 + `txdp` parent (006, retired) | **10.4 MB** — parent 5.2 MB / 2 475 shared textures + children 5.2 MB |
| 0.25, self-contained (today) | **45.9 MiB** across 1 020 dictionaries — measured on the 2026-08-16 build; `gta3.img` 1 602 MiB |

**Effort to pull it back: low in code, and that is not the problem.** The partition still exists behind
`selfContainedTxd: false` (`partitionCloneTextures`, unit-tested). What it costs is the thing the field
measured.

## Why it was given up

`txdp` is an SA-native mechanism and the OpenSA engine resolves the chain (`resolveTxdChain`) — which is
exactly why nothing caught this offline. **The real game does not deliver the parent's textures to the child's
materials.** Field-measured 2026-08-16: every texture the partition had moved into `salodpar` rendered
UNTEXTURED — white patches over the countryside where the grass material of a LOD is a parent-only name
(`lodcuntw65` → `grasstype4`, `lodcehollyhil06` → `rocktbrn128blndlit`), and **1 966 of 4 050 clone LODs
(49 %) depended on the parent**. See [`docs/open-issues/sa-lod-visibility-budget.md`](../../open-issues/sa-lod-visibility-budget.md)
for the bisect that isolated the dictionary half from the geometry half.

## What would have to be true to pull it back

1. **A field-proven mechanism, not a documented one.** A build where a KNOWN parent-only texture renders
   correctly on the real target — one model, one texture, photographed. The MixMods "SA Optimized Map" pack
   that plan 006 cited as proof at scale was never verified on OUR install, and that is the gap this cost us.
2. **A reason to want the bytes back.** ~100 MB of archive on a 1.6 GB `gta3.img` bought nothing measurable in
   frame time; the parent existed to keep the streamer's texture memory down, which nothing has ever
   complained about since.
