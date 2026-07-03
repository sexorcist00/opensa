# 060 — Streaming smoothness (cell-swap freeze)

**Status: 🚧 Phases 0–2 shipped (instrumentation, velocity lookahead, budgeted ingest) — awaiting the in-game measurement round; worker parse / compileAsync / GPU-ready format deferred.** Crossing a cell boundary (LOD↔HD swap or a new LOD ring cell) produces
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

## Deferred (next levers, in effect order)

- **Worker parse** — move parseDff/parseTxd + mesh-array assembly into a Web Worker (archives shared via
  SharedArrayBuffer, results transferable), main thread only wraps ready arrays into BufferGeometry. Removes
  most of the CPU hump at its source.
- **`renderer.compileAsync` + `initTexture`** — take shader compilation and texture upload out of the
  appearance frame (KHR_parallel_shader_compile).
- **GPU-ready cell format** — perfect-map-builder emits transcoded cells (raw vertex/index buffers +
  KTX2/compressed textures): runtime parse becomes memcpy, uploads shrink. Biggest lever, biggest work; also
  check whether TXD DXT is currently CPU-decoded to RGBA (S3TC upload would cut decode time and VRAM ×4).

## Measurements

_(fill per phase: build-time distribution before/after, post-add spike counts, subjective check)_
