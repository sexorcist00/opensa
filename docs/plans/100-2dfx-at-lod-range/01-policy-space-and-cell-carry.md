# 01 — The policy learns coordinate space, and cells carry 1 + 7

Part of [100 — 2dfx survives to LOD range](readme.md). Lands in `tools/lod-common`. **Gated on nothing.**

## Context

[`lod-common/005`](../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md) made the carry decision one
table, and its `cell` column reads `{0}` because a raw transplant could not re-orient a plate.
[`006`](../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) removed that reason —
`transform2dfxEntry` re-orients. What the table still does not carry is the fact that decides which transform
is even correct: **a type's coordinate space.** It lives in prose in `docs/2dfx-policy.md` and in nothing a
caller can read.

That matters here because the three carried types disagree:

| Type | Space | What a cell bake must do with it |
| --- | --- | --- |
| 0 light | model-local | instance transform (what it does today) |
| 1 particle | model-local | instance transform |
| 7 roadsign | **WORLD** (489/489) | subtract the cell origin, **do not** apply instance rotation or position |

## Decisions

1. **`space: 'model' \| 'world'` becomes a field on the policy row**, not a comment. A carry decision without
   it is a plate a kilometre from its post — the failure the dead plan would have shipped.
2. **The `cell` column becomes `carry` for 1 and 7.** Type 10 stays `drop`: nothing consumes an escalator at
   any range, and a LOD cannot carry what nothing draws.
3. **No transform code moves here.** `transform2dfxEntry` already handles orientation; choosing WHICH
   transform to hand it is the caller's job (step 02), and the policy only states the fact it needs.
4. **The `clone` column does not change.** SA reads 2dfx off the model itself, so a clone's carry is already
   correct — step 05 is about the decimate path, not about the table.

## Tasks

- [ ] Add `space` to `Lod2dfxRule`, fill it for all eight rows, export a `spaceOf(type)` helper.
- [ ] Flip `cell` to `carry` for types 1 and 7.
- [ ] Update `docs/2dfx-policy.md`: the space column moves into the main table, and the "cell drops 7/10"
      row's reasoning is replaced with what is actually true now.
- [ ] Tests: the resolved cell set becomes `{0, 1, 7}`; `spaceOf(7) === 'world'` and every other carried type
      is `'model'`; the unlisted-type fallback still drops.

## Verification

- `keepTypesFor('cell')` = `{0, 1, 7}`, `keepTypesFor('clone')` unchanged.
- No generator output moves on this step alone — the generators still filter by their own call sites until 02.

## Measurements / notes

_(record after implementation)_
