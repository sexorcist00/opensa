# 05 — The SA clones carry the same three types on both paths

Part of [100 — 2dfx survives to LOD range](readme.md). Lands in `tools/sa-lod-generator`. Depends on
[01](../../../tools/lod-common/docs/plans/007-2dfx-space-and-cell-carry.md) only — this is the real-SA half and shares no code with the OpenSA
steps.

## Context

`sa-lod-generator` is a different algorithm to a different host: it clones ONE model into a far copy (byte
copy, or QEM-decimated + re-encoded) and places it as a `lod_*` model with an IPL LOD link. **Real SA reads
2dfx off whatever model it streams**, so a clone's own section is live — no consumer change is needed on this
side, which is why this step is small and independent.

Where the two paths stand:

| Path | Today | Wanted |
| --- | --- | --- |
| verbatim byte copy | carries every type implicitly, particles included (plan 010 flipped the strip; `--strip-particles` is the stock-target opt-out) | unchanged, but SUBTRACTIVE against the policy so a dropped type does not ride by accident |
| decimate + re-encode | `collectClumpEffects` default: all-but-particle, particles added back only under `keepParticles` | the policy's `clone` set, particles included, positions frame-transformed as now |

This step is the old roadmap `sa-lod-generator/01` (adopt the policy) merged with the carrying half of `02`;
the far-view **rate budget** stays where it was — `lod-common/03` + `sa-lod-generator/02` in roadmap 0.5.0
plan 07 — because it is a measurement nobody has taken, not a carry.

## Decisions

1. **Both paths resolve `keepTypesFor('clone')`.** No local keep-set survives in this package.
2. **The verbatim path applies the policy SUBTRACTIVELY** — strip what is `drop`, keep the rest byte-verbatim.
   A full re-encode would throw away the plugins the byte copy exists to preserve (breakable, and whatever
   else our writers do not model).
3. **A clone's 2dfx keeps the model's own frame**, so no space branch is needed here: SA places the clone
   where the HD model was, and a world-space roadsign is world-space in both.
4. **`--strip-particles` stays** as the stock-target opt-out (an install without `perfect-map.asi`'s emitter
   fix crashes on cloned emitters — `asi/perfect-map` 009), and it now expresses itself as a policy override
   rather than as a second code path.

## Tasks

- [ ] Route both paths through `keepTypesFor('clone')`; delete the local sets.
- [ ] Decimate path: carry particles by default (today they ride only under the flag).
- [ ] Tests: a decimated clone of a real chimney keeps its emitter and its coronas; a verbatim clone is
      byte-identical to the HD model except for the types the policy drops; `--strip-particles` removes type 1
      and nothing else.
- [ ] Confirm against the corpus that no stock clone gains or loses an entry the policy did not name.

## Verification

- Clone output is unchanged for every type the policy still carries; the decimate path stops losing emitters.
- `--strip-particles` behaves exactly as before.

## Measurements / notes

_(record after implementation)_

- entries carried per path, before/after: …
