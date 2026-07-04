# 060 — Streaming smoothness (cell-swap freeze)

**Status: 🚧 Phases 0–4 + round-6 parse-step split shipped — awaiting round 7.** Crossing a cell boundary (LOD↔HD swap or a new LOD ring cell) produces
a visible frame hitch. The streaming _policy_ is already right (hysteresis dead-band, old level kept until the
new one is in, cell cache); the hitch is _work placement_: `adapter.loadCell` is async only by signature — the
whole `buildCell` (parse every DFF/TXD of the cell, build three.js meshes, procobj scatter) runs synchronously
on the main thread in the request frame, and the first render of the added objects then uploads buffers +
compiles shaders in one more frame.

## Phases

- **Phase 0 — measure.** Instrument the two humps so tuning is data-driven and regressions visible:
  - CPU hump: time the cache-miss `buildCell` path in `gta-sa-world.adapter.loadCell` — log
    `[stream] built <cx,cy,level> in <ms> (<n> objects)` for builds over a threshold.
  - GPU hump: after the streaming system adds a cell, watch the NEXT frame's delta — log
    `[stream] post-add frame <ms> (<key>)` when it spikes. Attribution without renderer surgery.
- **Phase 1 — velocity lookahead.** `streamKeys` is computed from the current view position, so a cell is
  first requested exactly at the boundary. Add a second key-collection pass around a predicted point
  (`view + normalize(velocity) × lookahead`, capped at one cell) that only ADDS keys (never flips a level the
  view-pass already chose). First-visit builds then start seconds before the boundary and land in the cell
  cache; by the crossing the swap is a cache hit.
- **Phase 2 — budgeted ingest.** Don't add a whole cell's meshes in one frame: the load handler queues the
  built objects and `update()` drains the queue under a per-frame time budget (~4 ms). The seamless-swap
  invariant is preserved — the old detail level is removed (and the cell marked loaded) only after its whole
  batch is in; removal logic treats queued cells as still loading.

- **Phase 3 — sliced cell build.** Round 1 measured `built … 100–234 ms` — one synchronous main-thread block
  per first-visit cell, regardless of when the lookahead started it. `buildCellSteps` (renderware) exposes the
  build as a generator (one step per model group + the tail passes); the adapter drives it cooperatively with
  a 5 ms per-slice budget, yielding a macrotask between slices — the same total work now interleaves with
  rendered frames. The `built` log line reports wall time (spanning slices), no longer a freeze length.
- **Phase 4 — precompile before appearance.** Round 1 measured `post-add frame 33–75 ms` — shader compilation
  - texture upload landing in the frame a cell first renders. `game.precompile(objects)` runs
    `renderer.compileAsync` (KHR_parallel_shader_compile) against the live scene between build and ingest;
    the streaming system awaits it before queueing the batch.

## Deferred (next levers, in effect order)

- **Worker parse** — move parseDff/parseTxd + mesh-array assembly into a Web Worker (archives shared via
  SharedArrayBuffer, results transferable), main thread only wraps ready arrays into BufferGeometry. Removes
  the CPU hump at its source (the sliced build merely interleaves it).
- **GPU-ready cell format** — perfect-map-builder emits transcoded cells (raw vertex/index buffers +
  KTX2/compressed textures): runtime parse becomes memcpy, uploads shrink. Biggest lever, biggest work; also
  check whether TXD DXT is currently CPU-decoded to RGBA (S3TC upload would cut decode time and VRAM ×4).

## Measurements

**Round 1 (after Phases 0–2, user drive):** `built` 19–234 ms (LOD cells 89–237 objects), `post-add frame`
33–75 ms — both humps confirmed on the main thread; lookahead/ingest rescheduled but could not shrink them →
Phases 3–4.

**Round 2 (after Phases 3–4, user drive):** noticeably smoother subjectively; `built` wall times DOWN
(140–175 ms vs 234, now interleaved slices — Phase 3 works); but `post-add frame` 50–100 ms remained on
almost every cell. Root cause: the ingest TIME budget measures `root.add()` (microseconds), so a whole
237-object cell entered in ONE ingest frame — and every object's FIRST DRAW uploaded its geometry in that one
frame, which `compileAsync` does not cover (it compiles programs + uploads textures, not vertex buffers).
Fix: **hard count cap, 24 objects/frame** on top of the time budget — first-draw uploads now spread across
~10 frames per cell.

**Round 3 (after the count cap, user drive):** `built` 48–249 ms wall (sliced, unchanged), `post-add frame`
33–58 ms — DOWN from 50–100 (spreading works), but jerks remain AND the cap created a new, worse artifact:
cells now assemble piece-by-piece on screen ("все объекты прям на глазах строятся") because the 24-obj/frame
budget spread the VISIBLE adds. Root cause of the whole round-2/3 tension: `root.add()` is free, the cost is
the first DRAW of each object (geometry/instance-buffer upload) — so any scheme that spreads real adds spreads
the appearance too. Fix: decouple them. `game.warmUp(objects)` renders a slice into a 1×1 scissored viewport
(frustumCulled forced off, viewport/scissor restored) — forcing the uploads invisibly; the streaming system
warms each queued cell at ≤24 objects/frame (`WARM_PER_FRAME`) and only when the whole batch is warm does the
cell `root.add()` ALL objects + finish the swap in one step. Appearance is atomic again (like pre-round-2),
uploads never land on the appearance frame. The ingest time budget + injected clock were removed (nothing
timed anymore — warming is count-driven).

**Round 4 (after the invisible warm-up, user drive):** pop-in gone, but `post-add frame` UNCHANGED at
41–58 ms (`built` 57–181 ms wall). Diagnosis: warming 24 objects in one frame costs the same ~40–58 ms of
synchronous uploads as 24 first-draws did — the fixed count slice only MOVED the stall from the appearance
frame into the warm frame (and the post-add log then attributes the next cell's warm frame to the
just-swapped key). The insight the count cap missed: warming is INVISIBLE, so spreading it thinner is free —
no pop-in trade-off exists anymore. Fix: warm object-by-object under a per-frame TIME budget
(`WARM_BUDGET_MS = 3`, measured after every upload, ≥1 object/frame guaranteed; `WARM_PER_FRAME = 24` kept
as a determinism cap), `game.warmUp` holder scene/viewport hoisted to reused fields to keep the per-object
render-call overhead out of the budget. New log line `[stream] warm frame <ms> (<n> objects)` (>8 ms)
attributes warm cost explicitly, so post-add numbers stop double-counting it.

**Round 5 (after time-budgeted warming, user drive):** `warm frame` lines appeared but exposed the real cost:
`warm frame 28ms (1 objects)`, `warm frame 78ms (11 objects)` — a SINGLE object cannot cost 28 ms of pure
buffer upload. Diagnosis: the warm holder was a bare `new Scene()` — no fog/environment/lights — and those are
part of three.js's shader program cache key, so the warm draw SYNC-COMPILED a no-light/no-fog program variant
per material that no real frame ever uses (precompile built the correct live-scene variants; the warm was
compiling a second, wasted set). `post-add` 42–67 ms also persisted, clustering around `built` lines —
suspicion: single build-generator steps (one model group each) overrun the 5 ms slice deadline unobserved,
since the deadline is only checked BETWEEN steps. Fixes: (1) `game.warmUp` now mirrors the live scene's
context — borrows `scene.fog`/`scene.environment` and temporarily reparents the scene's lights into the warm
holder (restored after), plus `shadowMap.autoUpdate` off for the warm draw — so warming resolves to the exact
precompiled programs and pays uploads only; (2) the `built` log now reports `max slice <ms>` (longest single
generator step) to confirm/refute the slice-overrun attribution with data.

**Round 6 (after the warm-context fix, user drive):** `warm frame` DOWN 78→17–18 ms worst (the wasted variant
compile is gone; the residual 17 ms on 1 object is plausibly a genuine big LOD geometry+atlas upload — watch
next round). `max slice` data landed and confirmed the attribution: **LOD cells hit 65–79 ms single steps**
(`3,-5,lod` built 113 ms with max slice 79 ms) while a 361-object HD cell peaked at 5 ms — one baked cell-LOD
group folds a big DFF parse + TXD parse (CPU DXT decode) + geometry build into ONE generator step, invisible
to the between-steps deadline. The persistent `post-add` 33–50 ms lines are vsync-quantized (2–3 × 16.7 ms)
and cluster around those builds — largely the same slices attributed to whichever cell swapped last. Fix:
`buildCellSteps` warms the parse caches as separate steps (`getTextures` → yield, `getClump` → yield, then
`buildGroupInstancedMeshes` runs on cache hits) — a 79 ms monolith becomes ~3 slices of parse/decode/build.

_(Round 7: re-drive — watch `max slice`: if it drops to ~25–40 ms the split worked but the ceiling is one
TXD's DXT decode → next lever is worker parse (or S3TC compressed-texture upload, skipping the CPU decode);
`post-add` lines should thin out in proportion to `max slice`.)_
