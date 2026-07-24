# Foliage fill (the parked levers)

**Status:** in reserve — parked by decision 2026-07-21 after the cause was found and removed. Evidence:
[layer decomposition](../../benchmarks/opensa-engine/2026-07-21-layer-decomposition.md), index rows #21/#22.

## What we know

The 07-18 → 07-20 "regression" was not a code change: rebuilding the map one pmb stage at a time put **~90 %
of it on the `trees` stage**, and an A/B traced **73 % of the trees cost to one placement-only mod**
("39. Green Piece 1.47", 233 instances). Removing it took ganton-noon from **13.72 → 7.63 ms** of pass,
**53 → 82 fps**.

The mechanism is the part worth keeping: triangles fell 18 % while the pass fell 44 % and **draws did not
move at all**. Alpha-tested canopies cost per PIXEL, and they overdraw each other. On these scenes draw
counts and triangle counts mislead.

The mod was deleted and every other foliage lever was parked ("будем наблюдать" — the user, 2026-07-21).

## The levers, if foliage ever hurts again

Unmeasured individually — each needs its own A/B before it is believed:

- **Swap to impostors earlier.** `tools/lod-trees-generator` already bakes them; the swap distance is the
  knob, and it attacks overdraw directly.
- **Cutout vs blend on canopies.** A blended canopy writes no depth, so trees show through trees; cutout with
  alpha-to-coverage is what the welder already prefers for vegetation.
- **Density / placement.** The measured case was placement-only: 233 instances of one species. A density cap
  per cell is a converter-side lever with no runtime cost.
- **Cheaper canopy shading.** These pixels run the full world fragment path (fog, prelit, AO, sun-vis) for
  what is mostly a flat leaf texture.

## What pulling any of them costs

Foliage is the look of the improved map — this is the content the whole conversion chain exists to ship, so
every lever here trades away something the user chose deliberately. That is why they are parked rather than
scheduled: the cause was one mod, not the system.

## What would have to be true to pull one

- A fill-bound scene that is NOT explained by a single mod. Re-run the stage decomposition first (it is a
  pmb rebuild per stage) — it answered this in one afternoon and it will name the layer again.
