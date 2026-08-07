# 02 — The cell bake carries lights, emitters and plates

Part of [100 — 2dfx survives to LOD range](readme.md). Lands in `tools/opensa-lod-generator`. Depends on
[01](01-policy-space-and-cell-carry.md).

## Context

`collectCellLightEffects` (`adapters/gta-sa/merge.ts`) gathers the cell's 2dfx and hands it to
`build2dfxSection`, which writes one section into the baked cell DFF. It already reads the shared policy
([`opensa-lod-generator/005`](../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md)) and
already routes every entry through `transform2dfxEntry`. With 01 widening the set, two things are missing:
the per-space transform choice, and the dedup a world-space type needs.

## Decisions

1. **Transform per SPACE, not per type.** `spaceOf(type) === 'model'` → the instance transform it computes
   today; `'world'` → a translation by `−cellOrigin` only. One branch, driven by the table, so a future type
   inherits the right behaviour by declaring its space.
2. **A world-space entry is deduped by MODEL, not emitted per instance.** A roadsign's coordinates are the
   same for every placement of its model — that is why `opensa-pack` dedups by model id in its own pre-pass.
   Emitting one per instance would stack N identical plates. (Stock makes this nearly moot — all 207
   sign-carrying models are placed exactly once — but a mod is not stock, and stacking is silent.)
3. **A model-local entry stays per-instance.** Two chimneys are two plumes; `escl_la`'s four placements are
   four escalators. The per-model memoisation cache stays untransformed, as it is today.
4. **The name stops lying**: `collectCellLightEffects` becomes `collectCellEffects` — it has not collected
   only lights since this step.
5. **No thinning here.** How many emitters a far cell may run is [04](04-authored-cull-distance.md)'s and the
   budget's business; this step carries what the policy says and counts what it carried.

## Tasks

- [ ] Branch the transform on `spaceOf(entry.type)`; rename `collectCellLightEffects` → `collectCellEffects`
      and update the call site in `adapters/gta-sa/index.ts`.
- [ ] Dedup world-space entries by model within a cell.
- [ ] Tests: a cell with two instances of a sign-carrying model emits ONE plate at its authored world position
      minus the cell origin, with its rotation untouched; a cell with two instances of a chimney emits TWO
      emitters, each at its own instance position; the existing corona assertions keep passing unchanged.
- [ ] Count what a full bake would carry, per type, without running one: the census script already has the
      corpus numbers — report entries-per-cell distribution from the cell grid instead.

## Verification

- Baked cells gain type-1 and type-7 entries; type-0 output is byte-identical to today.
- Plates land at their authored world position (cell-relative), not at an instance-transformed one.
- No consumer sees any of it yet — that is [03](03-lod-bundle-reads-2dfx.md).

## Measurements / notes

_(record after implementation)_

- entries carried per type, and the cells that gain them: …
- cell DFF size delta: …
