# Roadsigns and escalators on baked cells (roadmap 0.5.0, plan 07)

**Died 2026-08-07, before any code was written.** Was
`docs/roadmap/0.5.0/plans/07-lod-generators-extended/opensa-lod-generator/02`, the item its own plan called
"the visible win of the whole 2dfx line". Two measurements knocked out both of its premises, and the user's
call closed the one route that survived them: **glyphs are not to be welded into the LOD level.**

## The goal

Carry rotation-bearing 2dfx types — roadsign (7) and escalator (10) — into `opensa-lod-generator`'s baked cell
LODs, so distant street-name plates read correctly instead of being dropped by a keep-set that only ever
carried type-0 lights.

## What killed it

**1. Roadsign positions are WORLD coordinates, not model-local.** Measured over the stock corpus
(14 865 models, `scripts/debug/two-dfx-census.ts`):

| Type | Entries | Space | Instancing |
| --- | --- | --- | --- |
| 7 roadsign | 489 in 207 models | **world, 489 / 489** | each of the 207 models is placed EXACTLY ONCE; 28 on a rotated instance |
| 10 escalator | 5 in 4 models | model-local, 5 / 5 | 2 of the 4 placed more than once (`escl_la` ×4) |
| 0 light | 2203 | model-local | — |

`cen_bit_08` sits at (−487.6, 1929.9, 67.0) with its plates at (−456.1, 2014.2), (−434.2, 2039.0),
(−530.2, 1989.4) — city coordinates. The plan's central instruction, "route each entry through
`transform2dfxEntry` with the transform it already computes", would therefore have thrown every plate about a
kilometre from where it belongs. `opensa-pack` has relied on the world-space fact since plan 076.

**2. Nothing reads a cell LOD's 2dfx section.** In every path we ship, 2dfx is gathered from HD models only:

- `packages/cell-weld/src/weld.ts` — `if (!lod) { collectLights(...); collectParticles(...) }`, and the
  roadsign weld sits in the same HD-only branch ("LOD duplicates would double every lamp");
- `tools/opensa-pack/src/convert.ts` → `collectRoadsigns` skips `instance.isLod`;
- `packages/renderware/src/map/resolve-map.ts` → `markCellLods` flags **every** instance in
  `opensa-lod-generator`'s `lods.ipl` as `isLod`, on purpose;
- both map consumers go through that welder — the pak and the in-browser `sa-map-viewer`.

So widening the cell keep-set to `{0, 7, 10}` would have produced a larger DFF and no visible change at all.

**3. The gap the plan was named for is real, and it is not in this tool.** Field run 2026-08-07 against
`build/original/opensa` (no rebuild): the pak carries **481 welded roadsigns** and plates render normally
close up, while `packages/engine/src/stream/streaming.ts` sets `HD_RADIUS 380`, `LOD_RADIUS 1000`,
`HYSTERESIS 60`. A cell drops to its LOD bundle at ~440 u and keeps drawing to 1000 u, and the text is welded
HD-only — so **between ~440 u and 1000 u a sign area draws with no text**, a 560-unit band. The defect is in
`packages/cell-weld`, not in `opensa-lod-generator`.

**4. And that route is closed by decision.** 2026-08-07, the user: **glyphs are not to be welded into the LOD
level.** So the 560-unit band stands as a known, accepted property rather than a bug to fix — which is what
makes this a postmortem instead of a re-scoped plan.

**5. Escalators never had a consumer at all.** Nothing in `packages/engine`, `packages/cell-weld` or
`opensa-pack` mentions type 10; `OscellObject`'s kinds are timed / breakable / animated / roadsign / uvScroll.
Moving steps on a baked cell is a new engine feature, not a LOD carry.

## What survives it

- [`rw-codec/001`](../../tools/rw-codec/docs/plans/001-typed-2dfx-payload-codecs.md) — typed 2dfx payload
  codecs, shipped and byte-identical on round trip.
- [`lod-common/005`](../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) +
  [`006`](../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) — the declared carry-policy and
  `transform2dfxEntry`, both shipped. `006` handles rotation correctly for anything that ever needs it.
- [`opensa-lod-generator/005`](../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) — the
  cell bake reads the shared policy instead of a private literal.
- The per-type coordinate-space table, now in
  [`lod-common/docs/2dfx-policy.md`](../../tools/lod-common/docs/2dfx-policy.md), where no future carry
  decision can be taken without it.
- `scripts/debug/two-dfx-census.ts [--frames]` — the corpus denominator, kept.

## The residue, still open

**The cell LOD's 2dfx section is dead weight.** `opensa-lod-generator` still writes type-0 lights into every
baked cell DFF and no consumer we ship reads them. Stopping that write would shrink each cell DFF slightly and
remove a section a future reader would otherwise trust. Not done here — it is a separate decision about
shipped output, and it belongs to whoever takes `opensa-lod-generator` next.

## When to revisit

If the engine ever draws welded cell content from the DFF's own 2dfx (rather than from HD models through
`cell-weld`), or if the HD/LOD split stops being the thing that decides what carries text, this plan's body is
the research record for doing it correctly — in particular finding 1, which is not obvious from any code that
consumes a roadsign.
