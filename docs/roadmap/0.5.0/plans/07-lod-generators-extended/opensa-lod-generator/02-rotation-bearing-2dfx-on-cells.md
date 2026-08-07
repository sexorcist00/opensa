# opensa-lod-generator/02 — Roadsigns and escalators ride baked cells

Part of [07 — LOD generators, extended](../readme.md). Depends on
[lod-common/006](../../../../../../tools/lod-common/docs/plans/006-2dfx-entry-transform.md) (the typed
transform) and [005](../../../../../../tools/opensa-lod-generator/docs/plans/005-adopt-2dfx-policy.md) (the
policy adoption).

> **STOPPED 2026-08-07, before any code, and it needs a decision.** Two measurements taken while scoping it
> knocked out both of its premises: the payload space it assumed, and the consumer it assumed. The plan as
> written would emit bytes nothing reads, having first thrown every plate thousands of metres from where it
> belongs. What follows is the evidence and the three routes out; the original body is kept below the fold
> because it is still the right idea aimed at the wrong layer.

## Finding 1 — roadsign positions are WORLD coordinates, not model-local

Measured over the stock corpus (14 865 models):

| Type | Entries | Coordinate space | Instancing |
| --- | --- | --- | --- |
| 7 roadsign | 489 in 207 models | **world, 489 / 489** | every one of the 207 models is placed EXACTLY ONCE; 28 sit on a rotated instance |
| 10 escalator | 5 in 4 models | **model-local, 5 / 5** | 2 of the 4 models are placed more than once (`escl_la` ×4, `escl_singlela` ×2) |
| 0 light | 2203 | model-local, 2094 / 2094 checked | — |

`cen_bit_08` is the shape of it: the instance sits at (−487.6, 1929.9, 67.0) and its three sign entries are at
(−456.1, 2014.2, 61.6), (−434.2, 2039.0, 62.0), (−530.2, 1989.4, 62.0) — real city coordinates, near the
instance but not relative to it. `packages/renderware/src/roadsign/glyph-quads.ts` says so in its header, and
`opensa-pack` has relied on it since plan 076 ("roadsigns store world coords, not instance-local").

**So this plan's decision 1 — "route each entry through `transform2dfxEntry` with the transform it already
computes" — would have been a bug**, and a spectacular one: applying the instance rotation and translation to
an already-world position throws the plate a kilometre away. The right carry for a roadsign is
`world − cellOrigin` with the authored rotation untouched. That the type-7 half of the policy is a
`space: world` fact, not just a `carry` fact, is the shared piece this plan should have started from.

Escalators are the opposite and the plan's "same model at different rotations in one cell" worry is real for
them specifically — `escl_la` is placed four times.

## Finding 2 — nothing reads a cell LOD's 2dfx section

The bigger one. In the OpenSA consumption path, 2dfx is gathered **from HD models only**:

- `packages/cell-weld/src/weld.ts`: `if (!lod) { collectLights(...); collectParticles(...) }` — *"LOD
  duplicates would double every lamp"*. Roadsign text is welded in the same HD-only branch.
- `tools/opensa-pack/src/convert.ts` → `collectRoadsigns` skips `instance.isLod` outright.
- `packages/renderware/src/map/resolve-map.ts` → `markCellLods` flags **every instance in this generator's
  `lods.ipl`** as `isLod`, precisely so they bucket as LOD.
- Both consumers of the map go through that welder: the pak (`opensa-pack`) and the in-browser
  `sa-map-viewer` (`weldCell`).

So the 2dfx section `opensa-lod-generator` writes into each cell DFF — the coronas it carries today included —
**is dead weight in every path we ship**. Widening its keep-set to `{0, 7, 10}` would produce a larger DFF and
no visible change whatsoever.

And the win this plan was named for is already shipped, elsewhere: plan 076's global pre-pass welds every
roadsign's text into the cell containing its world position, deduped by model id, once. What is NOT known —
and is the actual question behind "distant street-name signs" — is whether that text is drawn when only the
LOD level of that area is resident.

## Finding 3 — the field check, and the number that settles the gap

Run 2026-08-07 against `build/original/opensa` (no rebuild — plan 07's working rule), headless through the
real load path (`?loader=http-dir`), at the desert freeway signs by the LV satellite dishes.

**The sign text is in the pak.** `pak/report.json` reports **`roadsigns: 481`** welded map-wide — plan 076's
pre-pass ran and its output ships. The plates render: `cxrf_desertsig` is drawn from 8 m and from 36 m, and
the cell carries them as ordinary welded placements (`dump-cell -456 2014`).

**And the engine's own radii say where that text stops** (`packages/engine/src/stream/streaming.ts`):

| Constant | Value |
| --- | --- |
| `HD_RADIUS` | **380 u** |
| `LOD_RADIUS` | 1000 u |
| `HYSTERESIS` | 60 u |

So a cell drops to its LOD bundle at ~380–440 u and keeps drawing until 1000 u. Roadsign text welds into the
**HD** bundle only (finding 2), which means **between ~440 u and 1000 u the area is drawn with no sign text at
all** — a 560-unit band where a lit board reads blank or vanishes with its plate. That is the gap this plan
was named for, expressed as a number instead of an impression, and it lands in `cell-weld`.

**What the run did NOT establish, honestly:** whether a *plate* survives into the baked cell LOD (blank board)
or the sign disappears entirely. Both runs stayed INSIDE the HD radius — 242 u and 197 u from the sign — so
neither crossed the boundary. Two site facts cost those runs: the sign sits in a road cut between embankments,
so running away loses line of sight to terrain long before 380 u, and the road descends to the Sherman dam.
**A conclusive shot needs a sign with an open sightline and a run past 440 u** — a Las Venturas desert board
(`ne_bit_07` ≈ (222, 2742), `ne_bit_08` ≈ (416, 2710)) across flat ground, not this cut.

**Two harness traps, both of which cost a run:**

1. **Streaming follows the PLAYER, not the photo camera.** The first probe flew the K+M camera 200 u back and
   read "everything still drawn" — the player had not moved, so nothing had unloaded. The eye can retreat
   without the world noticing.
2. **`?spawn` does not wait for collision.** Spawning at a point whose ground has not streamed drops the
   player to z ≈ −3800 (`grounded 0` in the HUD). Two of the four spawn points tried fell; land on a road
   surface whose z you have read out of the placements, not a guessed one.

## The decision this plan now needs

1. **Re-aim at the consumer** (`packages/cell-weld`). Weld roadsign glyph quads into the LOD level as well as
   the HD one, deduped by world position so a resident pair does not double the text. This is where the
   visible win actually lives, and finding 1 is already handled correctly there. **Finding 3 says the gap is
   real** — a 560-unit band, 440 → 1000 u, with no sign text — so this is a defect with a measured size, not a
   suspicion. What is still open is whether a blank plate stands in that band or nothing does, which changes
   how bad it looks but not whether the text is missing.
2. **Or delete the dead section.** If cell 2dfx is read by nothing, the honest move is to stop writing it and
   record that the policy's `cell` column is a no-op — which would retire this plan and shrink every cell DFF
   slightly. Cheap, and it removes a section a future reader would otherwise trust.
3. **Escalators: no consumer exists at all.** Nothing in `packages/engine`, `packages/cell-weld` or
   `opensa-pack` mentions type 10; `OscellObject`'s kinds are timed / breakable / animated / roadsign /
   uvScroll. Moving steps on a baked cell is a new engine feature, not a LOD-carry, and it should leave this
   plan for one of its own.

Route 1 is the one that keeps the plan's intent. It is not this generator's plan any more, though — it is a
`cell-weld` plan, and this file should die into `docs/postmortem/` or be rewritten under that tool once the
field check says whether there is a defect to fix.

---

## Original body (kept — the idea is right, the layer was wrong)

### Context

The cell bake merges many instances into one cell-centre-relative mesh and repositions each carried 2dfx via
`instanceTransform` — but only the entry's POSITION (`build2dfxSection` overwrites the first 12 bytes).
Roadsign (7) and escalator (10) encode orientation and geometry in their payload, so a position-only
transplant leaves a street-name plate facing the wrong way and an escalator's motion line pointing at nothing.
That is the whole reason `LIGHT_2DFX` was `{0}`. With lod-common/006 the transplant can rewrite those fields,
and that reason expires.

sa-lod's verbatim and decimate paths already carry these types correctly — they inherit the model's own frame.
Only the CELL path has the gap.

### Decisions (superseded by the findings above)

1. Widen the policy to carry 7 and 10 on cells and route each entry through `transform2dfxEntry`.
   **Superseded**: right for escalators, wrong for roadsigns (finding 1), and moot until finding 2 is settled.
2. Scope to types worth having at range; undecoded orientation-bearing types stay dropped by policy.
3. **The name stops being a lie** — `collectCellLightEffects` would no longer collect only lights. Not done:
   with the widening stopped, the name is still accurate.
4. Fidelity bar: a baked-cell roadsign faces the same way and sits in the same place as the HD one.

### Tasks (not started)

- [ ] Widen the cell keep-set; route every carried entry through `transform2dfxEntry`; rename
      `collectCellLightEffects`.
- [ ] Fixtures: rotated instances of real sign / escalator models → assert plate position and normal, and the
      escalator's three points, against the HD-instance-transformed expectation.
- [ ] Two instances of the same model at different rotations in one cell — the per-model memoization stores
      untransformed entries, and a caching bug here gives every sign in the cell the first instance's heading.
      **Still the right test, and now known to matter for escalators rather than for signs.**
- [ ] Viewer check; census of cells gaining entries.
