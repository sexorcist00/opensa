# 03 — The LOD bundle reads the cell bake's 2dfx

Part of [100 — 2dfx survives to LOD range](readme.md). Lands in `packages/cell-weld` (+ `tools/opensa-pack`).
Depends on [02](02-cell-bake-carries-effects.md). **This is the step that makes the whole OpenSA line
visible** — without it, 01 and 02 write bytes nobody reads.

## Context

`weld.ts` gathers 2dfx **HD-only**:

```ts
// 2dfx corona anchors (074/06 row 13) — HD level only (LOD duplicates would double every lamp).
if (!lod) {
  collectLights(...);
  collectParticles(...);
}
```

and the roadsign pre-pass in `opensa-pack/convert.ts` skips `instance.isLod`. Every instance of
`opensa-lod-generator`'s `lods.ipl` is flagged `isLod` by `resolveMap`'s `markCellLods`, so the cell bake's
section is unreachable. The comment names the real hazard — **doubling** — and any fix has to answer it.

## Decisions

1. **The LOD level's effects come from the LOD MODELS' own 2dfx**, not from a second pass over HD models.
   That is what step 02 bakes, it is already cell-relative, and it means the thinning decisions live in one
   place (the generator) rather than being re-derived in the welder.
2. **Doubling is prevented by the STREAMER, not by a keep-set** — but only if that is true, and it must be
   checked before this ships. The engine holds one representation per cell (`slot.current` is `'hd'` or
   `'lod'`); if a transition can ever have both resident, the LOD bundle's anchors need an explicit suppress
   while the HD bundle is live. **Verify first, then choose** — this is the step's one real risk.
3. **Roadsign text welds into the LOD bundle as glyph quads**, the same beam-class geometry the HD bundle
   gets, filed by the sign's world position. The pre-pass already buckets by world cell; what changes is that
   it also runs for the LOD level, deduped so a sign is not welded twice into one bundle.
4. **Particle anchors ride as `OscellParticle`**, unchanged in shape — the format already carries
   `effectName` + cell-local position and needs no version bump.
5. **Lights ride as `OscellLight`**, unchanged. A LOD light has no smashable owner (`owner: 0`): breakables
   are HD-only by design, so a far corona cannot be tied to a prop that can be smashed at that range.

## Tasks

- [ ] Establish whether HD and LOD bundles of one cell can be resident simultaneously (read `streaming.ts`'s
      slot machine; write the answer into this doc before writing code).
- [ ] Collect lights + particles from LOD-level clumps' 2dfx in `weld.ts`; keep the HD path untouched.
- [ ] Run the roadsign pre-pass for the LOD level too, deduped by world position.
- [ ] Tests: a welded LOD bundle carries the anchors its cell model declares; an HD bundle is byte-identical
      to today; a cell whose LOD and HD both declare the same sign welds it once per bundle, never twice into
      one.
- [ ] Field check: from >440 u, a chimney smokes, a street lamp glows at night and a plate reads.

## Verification

- The 440 → 1000 u band shows effects; the HD band is unchanged.
- No doubled lamp, plume or plate at the transition distance (the hysteresis window is where this shows).
- Pak size and cell bake time move by an amount the counts explain.

## Measurements / notes

_(record after implementation)_

- HD/LOD simultaneous residency: …
- anchors added to the LOD bundles, per type: …
- pak bytes delta, frame cost in the band: …
