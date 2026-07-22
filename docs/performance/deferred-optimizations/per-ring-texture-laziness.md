# Per-ring texture laziness (the ~767 MB world-array floor)

**Status:** in reserve — the last untouched item of the streaming/residency arc
([plan 074/05](../../plans/074-opensa-engine/05-streaming-runtime.md),
[074/21](../../plans/074-opensa-engine/21-fog-draw-distance.md)).

## What we do today

A district's texture ARRAYS are resident as a block. Range-read IO already stopped the multi-GB pak from
living in memory (full-LS startup transfer 1.15 GB → ~212 MB) and the vehicle-model cache became LRU-bounded
by a 256 MB texture budget (end-of-sweep texture bucket 2657 → 1161 MB, −1.5 GB). What is left underneath
all of that is a **~767 MB world-array floor** — every idle vehicle type evicts down to it and it does not
move.

## The lever

Make the world arrays lazy per LOD RING: a texture only becomes resident when a ring that samples it is
streamed in, and leaves with it. The cells already stream this way; their dictionaries do not.

## What it would win

Headroom under the floor — up to several hundred MB on a district, the largest single residency item left.
It buys nothing on frame time directly; it buys the ability to raise draw distance, keep more districts warm,
or run on a smaller GPU without thrashing.

## What it would cost

- Residency becomes ring-dependent, so a fast approach to a district can miss a texture the frame needs —
  the class of bug the streaming arc spent the most time closing (`lateCreates`, pop-in). Any version of this
  needs the late-create counters watched.
- The world planner's array packing is content-deduped across the whole map; splitting it by ring cuts that
  dedup, so the SUM of the parts is bigger than the whole even as the resident subset shrinks.
- A re-pack (the arrays are a converter product), i.e. it is not a runtime-only change.

## What would have to be true to pull it

- Memory is what actually hurts: OOM, eviction thrash, or a target device with less VRAM than the floor.
- Soak evidence that the working set really is a subset of the district — the 30-minute headless soak
  (index row #20) shows residency FLAT at 1805 MB, so today nothing is being wasted per-frame, only held.

## Cheaper things to try first

- `?draw=` (fewer rings resident at once).
- Lower the vehicle LRU floor below 256 MB before touching the world arrays — same axis, no format work.
