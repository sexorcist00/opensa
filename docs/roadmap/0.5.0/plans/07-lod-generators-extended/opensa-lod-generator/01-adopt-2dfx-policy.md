# opensa-lod-generator/01 — The cell bake adopts the 2dfx policy

Part of [07 — LOD generators, extended](../readme.md). Depends on
[lod-common/01](../lod-common/01-2dfx-keep-policy.md). **Gated on nothing** — cell output is OpenSA-only
(see below), so no ASI is in this path.

The smallest possible step: delete this generator's private keep-set and read the shared one instead. Nothing
about WHICH types are carried changes here; that is [02](02-rotation-bearing-2dfx-on-cells.md).

## Context

`opensa-lod-generator/src/adapters/gta-sa/merge.ts:12` holds the whole of this generator's 2dfx policy:

```ts
/** 2dfx entry type 0 — light/corona. Cells carry only these (rotation-bearing types can't ride a raw transplant). */
const LIGHT_2DFX = new Set([0]);
```

It is correct today and it is a literal in a leaf file — which means the reason for it (a raw transplant
cannot re-rotate) lives in a comment, not in anything a second generator can consult. lod-common/01 makes
that reason a declared policy; this plan makes this generator obey it.

**Worth stating once, because the old plan got it wrong:** this generator's output is loaded by the OpenSA
engine only — [`restrictions/sa-target.md`](../../../../../restrictions/sa-target.md) records that real SA
cannot load an uncapped per-cell LOD, and the two LOD generators are not interchangeable. So nothing in this
folder is gated on `asi/perfect-map`, and the "asi target" framing the old A2 carried was a mistake.

## Decisions

1. **Replace the literal with `keepTypesFor(target)`.** The resolved set for the current target is `{0}`, so
   the output does not move. The regression fixture is what says so, not the diff.
2. **Keep the reasoning WITH the policy.** The comment explaining why rotation-bearing types cannot ride a
   raw transplant belongs in lod-common's policy table, next to the entry that drops them — the place a
   reader of the other generator will also find it.
3. **No widening here.** It is tempting to fold [02](02-rotation-bearing-2dfx-on-cells.md) in, since it is
   "one more line in a set". Do not: this step's whole value is that it is provably behaviour-preserving, and
   a step that both refactors and changes behaviour cannot prove either half.

## Tasks

- [ ] `merge.ts`: drop `LIGHT_2DFX`, resolve the keep-set from the policy; move the explanatory comment into
      lod-common's policy table.
- [ ] Golden compare: baked cells for a sample set are byte-identical to today's output.
- [ ] Grep guard: no residual private keep-set in this package.

## Verification

- Baked cell bytes unchanged across the sample set.
- The only place this generator's 2dfx fate is decided is the shared policy.

## Measurements / notes

_(record after implementation)_

- sample set used for the golden compare (cells, models, 2dfx entries carried): …
