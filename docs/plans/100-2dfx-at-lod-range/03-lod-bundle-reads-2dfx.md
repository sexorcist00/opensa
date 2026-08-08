# 03 — The LOD bundle reads the cell bake's 2dfx

**SHIPPED 2026-08-08** (code + tool-level verification; the FIELD check is owed to the chain's single
rebuild — see below). Part of [100 — 2dfx survives to LOD range](readme.md). Landed in `packages/cell-weld`
and `tools/opensa-pack`. Depended on
[02](../../../tools/opensa-lod-generator/docs/plans/006-cell-bake-carries-effects.md). **This is the step that
makes the whole OpenSA line visible** — without it, 01 and 02 write bytes nobody reads.

Neither package keeps a numbered plan chain, so the record stays here.

## Context

`weld.ts` gathered 2dfx **HD-only**:

```ts
// 2dfx corona anchors (074/06 row 13) — HD level only (LOD duplicates would double every lamp).
if (!lod) {
  collectLights(...);
  collectParticles(...);
}
```

and the roadsign weld sat in the same branch. Every instance of `opensa-lod-generator`'s `lods.ipl` is flagged
`isLod` by `resolveMap`'s `markCellLods`, so the cell bake's section was unreachable. The comment names the
real hazard — **doubling** — and any fix has to answer it.

## Decisions

1. **Lights and emitters come from the LOD MODEL's own 2dfx.** That is what step 02 bakes, it is already
   cell-relative, and it keeps the thinning decisions in the generator rather than re-derived in the welder.
   No second pass over HD models.
2. **Doubling is prevented by the STREAMER — verified, not assumed.** `CellSlot.current` is a single
   `Level | null`, and the HD↔LOD swap in `Streaming.create` calls `cells.unload(previousKey)` in the same
   synchronous call that loaded the replacement ("the replacement is live — drop the old level the same
   frame; no hole, no double-draw"). No frame can render both levels of one slot, so no explicit suppress is
   needed. What a bundle must still guarantee is that it carries each anchor ONCE, and that is what the tests
   pin.
3. **Roadsigns keep coming from the WORLD-KEYED pre-pass, for both levels — a correction to decision 1.**
   This is the one place a LOD's effects do NOT come from the LOD model, and the reason is a measurement the
   step did not have when it was written: **131 of the map's 489 plates sit outside the cell holding the
   instance that carries them** (`opensa-lod-generator/006`). Read off the LOD model, such a plate welds into
   cell A's LOD bundle while `collectRoadsigns` files it under cell B — **two different keys**, so decision
   2's one-level-per-slot rule does not cover them and the plate draws twice whenever A is LOD-resident and B
   is HD-resident, which at a 250 u grid and a 380 u HD ring is an ordinary standing position. Bucketing by
   world position keeps every plate on exactly one key at both levels.
4. **Particle anchors ride as `OscellParticle`, lights as `OscellLight`** — both unchanged in shape, no format
   version bump.
5. **A LOD light is never breakable** (`owner: 0`): breakables are HD-only by design, so a far corona cannot
   be tied to a prop that can be smashed at that range. Passed explicitly rather than relied on via "the
   baked cell model is not in `breakableModels` anyway".

## What shipped

- `weld.ts`: the `!lod` gate is gone from `collectLights` / `collectParticles` and from the roadsign weld;
  `weldCellParts`' `roadsigns` parameter is documented as feeding both levels.
- `opensa-pack/convert.ts`: `weldGridCell` hands the same world-keyed roadsign list to both levels.
- Tests: a LOD bundle carries the anchors its cell model declares, at the same positions the HD bundle puts
  them; each bundle carries every anchor and every plate exactly once; a LOD bundle with no sign list welds no
  text, and with one welds real geometry (bucket rows grow, not just the counter).

## Verification

**Answered before any code was written (the step's own first task):** HD and LOD of one slot can never be
resident together — see decision 2 for the mechanism and the line that guarantees it.

**Tool-level, against real assets** — twelve real cells baked in-process through
`createGtaSaLodAdapter().bakeCell()`, which needs no pmb run:

| Cell | Instances | 2dfx entries | Section | Breakdown |
| --- | --- | --- | --- | --- |
| 9,−7 | 290 | 195 | 19 360 B | 189 lights, 3 emitters, **3 plates** |
| 3,−7 | 288 | 185 | 18 504 B | 185 lights |
| 9,0 | 277 | 64 | 5 996 B | 51 lights, 8 emitters, **5 plates** |
| 5,1 | 250 | 111 | 8 376 B | 60 lights, **49 emitters**, 2 plates |
| 8,9 | 234 | 331 | 32 936 B | 328 lights, 3 emitters |

12 of 12 carry a section; **2066 lights, 103 emitters, 17 plates** between them. Per-entry cost, read off the
run: a light is **100 B**, an emitter **44 B**, a plate **108 B**. Across those twelve cells the new types add
**6368 B of 213 016 B (+3.1 %)**. Map-wide that projects to 878 × 44 + 489 × 108 ≈ **89 KB** added to the cell
LOD DFFs, against the 22 366 lights already there.

**The FIELD check is NOT done, and cannot be without the deferred rebuild.** The pack's LOD input is a pmb
intermediate (`<out>/.work/opensa-lod`) that the pipeline deletes as it consumes it — the built tree's
`lods.img` holds `.osm`, the pack's OUTPUT. So "from >440 u a chimney smokes, a lamp glows and a plate reads"
lands with the chain's single rebuild, per the standing rule that no full map rebuild runs until plan 07's
chain is finished. Two things ride on that same run: the look verdict for both
[`docs/hacks/`](../../hacks/README.md) entries from 04, and the confirmation that no plate or plume doubles at
the transition distance.

## Measurements / notes

- **HD/LOD simultaneous residency: impossible by construction** — one `slot.current`, and the swap unloads the
  old key inside `create()`.
- **Anchors added to the LOD bundles, per type**: every cell LOD's own section — projected map-wide from the
  measured corpus, 22 366 lights / 878 emitters / 489 plates, the last two new in this chain.
- **Pak bytes delta**: not measured directly (no rebuild). The DFF-side projection above is ~89 KB of new 2dfx
  payload; the welded glyph geometry for 489 plates duplicated into LOD bundles is the larger unknown and is
  what the rebuild's report should be read for.
- **Frame cost in the band**: unmeasured, and note that [04](04-authored-cull-distance.md) showed the bench
  cannot see emitter cost at all — the meaningful measurement here is pak size and the visual check, not
  `gpuMs.pass`.
