# 3 — Off the main thread: the hitches are all one shape

Every spike this project has named is the same story — **heavy work executed inside a frame** — and the field
drive proved the render loop is not where the time goes: GPU pass mean 15.64 ms against a CPU render of
0.1–0.6 ms. There is nothing to win in the draw path and everything to win beside it.

The measured contributors, from [plan 091](../../../plans/091-frame-time-attribution/readme.md) and the
093 sweep:

| Cost | Measured | Where it runs today |
| --- | --- | --- |
| COL parse (per cell) | **9.6–78.3 ms** | main thread |
| Rapier body build (per cell) | **5.6–28.1 ms** | main thread |
| `.osm` read + parse (per NEW vehicle type) | worst **20.5 ms** (`bus`), typical 0.5–2 | main thread |
| Cold district entry | first frame 235 ms, then ~20 frames of 110–170 ms | main thread |
| Boot frame | **576.1 ms** | main thread |
| `unattributed` | 40–55 % of a bench spike; on a real drive it is **the CPU waiting on the GPU** | — |

A phone's CPU makes each of these several times worse, which is why this chain sits inside the mobile
bundle rather than beside it.

## 01 — Bake the collision into the pak (the format break, spent well)

The single largest named cost is a **parse of a 2004 file at runtime**. We have our own formats; there is no
reason a browser ever sees a COL.

- `opensa-pack` parses COL once, at build time, and writes the cell's collision as ready-to-transfer
  vertex/index buffers plus the per-triangle surface table.
- **The data must survive intact.** A baked collider that loses the surface id is a data regression however
  fast it loads — `p_grassmid1 ×0.71` under the wheels is authored design, and `SAND`/`ROUGHNESS` are the
  columns we still owe ([offroad-feels-like-tarmac](../../../open-issues/offroad-feels-like-tarmac.md)).
- Keep the parry back-face encoding in mind when baking triangle ids: a hit on the back of a triangle comes
  back as `featureId + triangleCount`, and the game's roads are wound so a downward ray lands there. Whatever
  the bake writes, the runtime lookup still takes it modulo the triangle count — and the regression fixture
  must wind its quad *away* from the ray or it passes while the game fails.
- Expected: `cell-collision-read` disappears from the census. Measure, do not assume.

## 02 — Cell collider assembly in a worker

With the parse gone, what remains is building Rapier bodies (5.6–28.1 ms). Move the assembly behind the
streaming worker and hand the main thread a finished descriptor.

- The handover is budgeted like the texture drain: a cell may not land in one frame if it costs more than
  the allowance.
- **The restriction to respect:** a dynamic body may only be *created* where its static collision already
  exists — a streamer gating on its own radius spawns cars into a hole
  ([restrictions/architecture.md](../../../restrictions/architecture.md)). Deferring collider assembly
  moves that ordering constraint; the spawn gate follows it or parked cars free-fall again.

## 03 — `.osm` parse into the worker

Per *new type*, worst 20.5 ms. The field drives say it never lands on a slow frame when types arrive one at a
time — so this is not urgent on desktop, and it is exactly the kind of cost a phone converts into a stutter.
Cheap once 02 has built the transport.

## 04 — The worker transport: `crossOriginIsolated` as progressive enhancement

- One worker pool, two transports: **SharedArrayBuffer + Atomics when the page is cross-origin isolated**,
  structured clone + transferables when it is not. Same code path, same results, different latency.
- The engine must not *require* the headers. Requiring them is a deployment and embedding constraint, and it
  would silently degrade any host that cannot set them — the failure mode being "slower", which nothing
  catches.
- **Same change, when this lands:** a row in `docs/restrictions/` — what may and may not be assumed about
  isolation, and what breaks (silently) when a host does not provide it.

## 05 — The physics step in a worker (gated on 04)

The big one, and the one with a real chance of being refused.

- Requires a fixed-step contract with the renderer and a transform ring buffer; the render side already
  interpolates camera position (the [camera-position-render-interpolation
  lever](../../../performance/deferred-optimizations/camera-position-render-interpolation.md) was
  PULLED on 2026-07-25), which is the same problem solved once already.
- The measured budget it has to beat: the vehicle slice is **7.6–9.5 µs per car**, 0.6 ms at 80 cars — i.e.
  the physics step is *not* currently a frame problem on desktop. So this step is justified by the phone or
  by 0.5.0's city-life population, and by nothing else. **If the phone measurement does not demand it, it
  does not ship** — an improvement nobody can point at is an opinion.
- Watch the known trap: a Rapier body is born **massless** and its mass properties fold in at the next
  `world.step`; anything that reorders stepping re-opens
  [that crash](../../../open-issues/fixed/map-car-generators-poison-physics.md).

## 06 — Re-run the census after every step

091 exists for this. `unattributed` was 40–55 % of a bench spike and, on a real drive, turned out to be the
CPU waiting on the GPU. As main-thread costs leave, that ratio changes meaning — and a step that moves work
without moving the census has not been demonstrated.

## Acceptance

- A cold district entry shows **no main-thread contributor above the frame budget** in the `[slow]` census.
- The boot frame's 576 ms is decomposed and reduced, with the residual named.
- Desktop steady state is neutral (this chain buys smoothness, not throughput — the same shape as the
  texture-upload fix, which measured neutral averages and won on the census).
- A non-isolated host still runs, measurably slower and never wrongly.
