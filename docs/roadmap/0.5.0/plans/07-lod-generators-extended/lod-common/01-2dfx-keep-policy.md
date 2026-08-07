# lod-common/01 — One declared 2dfx keep-policy

Part of [07 — LOD generators, extended](../readme.md). **Gated on nothing.** The foundation of the whole 2dfx
line: make the carry policy ONE thing before adding types ([opensa-lod-generator/02](../opensa-lod-generator/02-rotation-bearing-2dfx-on-cells.md))
or emitters ([sa-lod-generator/02](../sa-lod-generator/02-particle-emitters.md)).

Was A1. The adoption tasks moved out to the generators that own them
([sa-lod-generator/01](../sa-lod-generator/01-adopt-2dfx-policy.md),
[opensa-lod-generator/01](../opensa-lod-generator/01-adopt-2dfx-policy.md)) so each generator's change is its
own reviewable, byte-compared diff. What is left here is the policy itself and the correctness bar it has to
meet.

## Context

The keep-set is spelled three times, in three shapes, in three packages:

- **sa-lod verbatim** (`finalize.ts:203`): byte-copies HD, drops only particles → keeps coronas, roadsigns,
  escalators and every undecoded type **implicitly**.
- **sa-lod decimate** (`finalize.ts:197`): `build2dfxSection(collectClumpEffects(hdDff, clump))` — the
  function's default keep is all-but-particle, positions mapped through frame transforms.
- **opensa-lod cells** (`merge.ts:12`): `LIGHT_2DFX = new Set([0])` — type-0 only; roadsigns and escalators
  dropped, because a raw transplant repositions but does not re-rotate.

So a corona survives all three; a roadsign survives two of three; an undecoded type survives one of them by
accident. None of that was decided — it is three local answers to a question nobody asked globally.

## Decisions

1. **`LOD_2DFX_POLICY` in `@opensa/lod-common`: one table, one verdict per entry type** — carry /
   carry-rate-scaled / drop — plus a `keepTypesFor(target)` that resolves it. Every path reads it; no path
   keeps a local set or a policy-bearing default.
2. **The default reproduces today exactly.** Resolving the policy for the current target must yield `{0}` for
   cells and all-but-particle for the sa-lod paths. New capability arrives dormant and is switched on by the
   plans that earn it.
3. **Undecoded types get an explicit entry too** — default DROP on LODs. Sun glare (4), enex (6) and friends
   are not wanted at range, and today they survive the verbatim path only because a byte copy has no notion
   of type. Making that a written decision is half the value of this plan.
4. **The policy decides carry, never payload.** `extract2dfxEntries` / `build2dfxSection` keep their
   byte-verbatim contract; transforming a payload is [02](02-2dfx-entry-transform.md)'s job, and the policy
   has no opinion about it.
5. **The policy is per-TARGET, not per-generator.** The two generators feed different hosts (real SA vs the
   OpenSA engine) and that is what a target expresses. Keying on the generator instead would put the same
   fact in two rows.

## Tasks

- [ ] `LOD_2DFX_POLICY` (type → verdict, per target) + `keepTypesFor(target)` in lod-common.
- [ ] Unit-test that the policy resolves to today's three sets — this is the contract the two adoption plans
      are compared against.
- [ ] Corona/light correctness fixtures: real models with known type-0 entries (a refinery chimney, a
      streetlamp) → assert the carried entry's world position matches the HD one on the decimate path AND the
      cell path. This is the baseline every richer type is built on, and it has never been asserted.
- [ ] Document the policy as the single source of truth in the lod-common docs — the table, and one line per
      type saying why its verdict is what it is.

## Verification

- Policy resolves to today's sets for every target (unit).
- Carried coronas are in position on both transformed paths — no drift, no doubles.
- No generator output has moved yet: this plan adds a table and tests, and changes no call site.

## Measurements / notes

_(record after implementation)_

- the policy table (type → verdict per target), as shipped: …
- corona position error, HD vs decimate and HD vs cell (expected ~0): …
