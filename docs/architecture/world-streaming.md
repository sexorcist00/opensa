# Native formats & world streaming

The engine never parses RenderWare at runtime — everything is converted offline into the native formats in
`packages/engine-formats` and streamed from a single pak. Format details live in
[plan 074/02](../plans/074-opensa-engine/02-native-formats.md); this page is the map.

## The formats

| Format    | Magic  | One file is…                                  | Key contents                                                                                                                                                                                  |
| --------- | ------ | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.oscol`  | `OSCL` | one **cell's collision**, baked (plan 200/3) | regions: model name · flat vertex/index arrays · primitive boxes/spheres · the per-**triangle** surface table · the world transform of every placement · **v2**: the per-placement breakable instance keys, present exactly when the model shatters — the writer decides, so the reader never opens a DFF to ask. Replaces a 9.6-78.3 ms per-cell COL parse in the browser; a v1 file is REFUSED (its breakability is unknown, not "false") and the runtime falls back to COL |
| `.osm`    | `OSM1` | one **model** (vehicle/ped/prop/…), sectioned | `DESC` (JSON: parts/submeshes/wheels/layout) · `GEOM` · `COLL` (baked collision) · `HULL` · `SHAT` (shatter mesh) · `SKEL` · `TEXS` (the model's private texture dictionary)                  |
| `.ostex`  | `OST1` | one `texture_2d_array`                        | BC1/BC2/BC3/BC7/RGBA8, full offline mip chain, premultiplied alpha, alpha class (opaque/cutout/soft-blend)                                                                                    |
| `.oscell` | `OSC1` | one streamed **cell** level (HD or LOD)       | 36-byte vertices (pos, normal + baked sunVis, uv, day/night prelit, layer + AO/emissive channels), object/breakable/particle/light tables (object kinds incl. 4 uv-scroll / 5 timed uv-scroll, minor 7), pipeline classes opaque/cutout/blend/beam/**additive**, placement mapper for the debugger, roadsign glyph-quad COUNT (minor 8 — a diagnostic, drawn from no table) |
| `.oswire` | `OSW1` | meshopt-compressed transport of a cell        | the pak worker decodes it back into exact `.oscell` bytes                                                                                                                                     |
| `.ospak`  | —      | the **archive**                               | manifest (`game` + `appVersion` for fetch cache-keying (plan 086), `buildTime`, cells with offsets/hashes + per-cell texture refs + per-cell geometry `aabb` (world XZ — what the streaming rings test, plan 087), the **shared world texture dictionary**, uv animations, water (a LOOSE `water.bin` next to the pak — stride-20 `x,y,z,depth,class`, plan 075), `missingLayers` — the stand-in layers the runtime's magenta highlight repaints, and `collision` + `collisionCellSize` — baked per-cell `.oscol` ranges keyed on the **GAME** grid (256), never on `cellSize` (250)) + 4096-aligned blobs; runtime reads byte ranges only |

Sections are read independently — the main thread takes `COLL` without touching geometry; consumers reject
unknown **major** versions loudly, minors only add optional sections.

**A vehicle's vertex streams carry two things the names do not say** (plan 084): the NIGHT colour set's
**alpha** is the model's own sky occlusion — a car has no prelit set, so that byte was a constant 255 and now
holds the AO the builder computes — and `reflect.x` is SPARE, because the reflection pipe reflects the live
probe rather than the DFF's env texture. `DESC` submeshes also gained an optional `extra` (which `extraN`
alternative a submesh belongs to; the spawn picks one), `tyre` (rubber, found by geometry, never
reflective) and `plate` (plan 082 — `'face'` = the `carplate` text strip, `'back'` = the `carpback` city
background, taken from the material's texture NAME, which conversion otherwise discards; never set on a
`_vlo` LOD mesh). All are additive: a pak built before them still reads, and its cars simply wear the stock
placeholder plate.

**`DESC` also carries the model's UV animations** (plan 099): `uvAnimations` — the DFF UVAnimDict entries
this model's materials actually reference, keyframes verbatim — plus a per-submesh `uvAnim` index into that
list. Model-LOCAL on purpose: the cell path registers dict names GLOBALLY (cells index one manifest array),
but a rigid model streams in and out on its own, so it carries its animations with it. Absent on the models
that animate nothing, which is every vehicle and nearly every prop — and on every `.osm` written before 099.

**Private vs world textures.** By-name classes (vehicles, peds, clutter, props, breakables) carry their own
dictionary in the `.osm` `TEXS` section — self-contained, viewable standalone. **Map objects** are planned
against the pak's shared world dictionary instead: their `.osm` is `DESC + GEOM` with global array
references (`textureSource: 'world'`), which keeps the full map at ~400 MB instead of ~3.7 GB of per-model
copies — but such a model only renders inside the streamed world.

## Streaming at runtime

![World streaming](./assets/world-streaming.svg)

<details><summary>diagram source</summary>

```mermaid
%%| world-streaming
flowchart LR
  pak[(".ospak<br/>manifest + 4096-aligned blobs")]:::data
  setup["setupStreaming<br/>validate manifest · buildTime ·<br/>water · uv-anims"]:::engine
  worker["pak worker<br/>Range reads · .oswire → .oscell<br/>(pak bytes never on main thread)"]:::infra
  driver["StreamingDriver<br/>rings + hysteresis · ≤1 create/frame ·<br/>atomic HD↔LOD swap · eviction"]:::engine
  col["PakCollisionSource<br/>.oscol ranges on the GAME grid (256)<br/>→ the game's collision streamer"]:::engine
  cells["CellStore<br/>.oscell → GPU buffers +<br/>recorded render bundle · pick()"]:::engine
  tex["TextureArrays<br/>.ostex → texture_2d_array ·<br/>per-ring residency + ref-keying"]:::engine
  frame[["frame graph<br/>replay bundles while frustum-visible"]]:::engine

  pak --> setup --> driver
  setup --> col
  col <--> worker
  driver <--> worker
  worker --> cells
  driver --> tex
  cells --> frame
  tex --> frame

  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

</details>

- **`stream/setup.ts`** — `setupStreaming(engine, source, radii)`: validates the manifest, spins up the pak
  worker (folder mode hands it the pak Blob; HTTP mode the `world.ospak` URL), returns
  `StreamSetup { buildTime?, cellSize, center, driver, radius, water? }`. A `LocalPakSource` returning `null`
  throws loudly — no fallback (see [boot-and-loading.md](./boot-and-loading.md)).
- **`stream/pak-worker.ts`** — all pak IO: HTTP Range mode when the server honours `Range:` (auto-detected;
  falls back to whole-pak), meshopt/`.oswire` decode, transfers cell blobs. JS heap stays flat — pak bytes
  never live whole on the main thread.
- **`stream/streaming.ts`** — `StreamingDriver`: ring model with hysteresis, the old level stays visible
  until its replacement is resident (atomic HD↔LOD swap), ≤1 cell create per frame, eviction outside the
  outer ring. The LOD ring doubles as the fog-mask boundary, and it tests the cell's TRUE geometry rect
  (manifest `aabb`; grid-rect fallback for pre-`aabb` paks) — an instance welds into the cell of its
  PIVOT, so meshes reach past the grid rect (gostown mean 141 u, max 799 u — plan 087) and a grid-rect
  ring skipped cells whose geometry already sat inside the fog. **Per-ring texture residency**: a shared
  array is fetched with the first cell that draws it and released with the last.
- **`stream/collision-source.ts`** — `PakCollisionSource`: the baked-collision half of the pak (plan
  200/3-01), present only when the manifest carries `collision`. Reads an entry's range through the SAME pak
  worker (keys prefixed `collision-`, so the driver ignores replies that are not its cells), de-dupes
  concurrent reads of one cell, and answers `null` for a cell with no bake or a failed read — the game layer
  then parses COL exactly as before. It publishes `cellSize` (the GAME grid, 256) because a consumer
  streaming on another grid would be handed a NEIGHBOURING cell's colliders; `GtaSaWorldAdapter` refuses such
  a source in its constructor.
- **`world/cells.ts`** — `CellStore`: one `.oscell` becomes GPU buffers + a recorded `GPURenderBundle`
  replayed while frustum-visible; also the debugger's ray `pick()` over the placement mapper (parsed only
  under `debugPicking`).
- **`world/textures.ts`** — `TextureArrays`: `.ostex` upload + material bind groups; CPU payload released
  after upload. **Streamed arrays upload RESUMABLY**: the worker's `message` handler only decodes and
  creates the texture (`beginLoad`), and the (layer, mip) writes drain from `StreamingDriver.update` under
  `UPLOAD_BUDGET_MS` (1.5 ms/frame, ≥1 write) — a whole-array upload in the handler ran between frames at
  15-85 ms a call, outside every budget the loop keeps (2026-07-27). `has(ref)` turns true only with the
  last write, so cells wait exactly as for an un-arrived array. The handler's residue is
  `StreamStats.blobMs` / `worstBlobMs`, the drain is `uploadMs`; the record lives in
  ([texture-upload-budget](../performance/applied/texture-upload-budget.md)). The eager boot path
  (pre-`textures` paks) and per-model dictionaries still upload in one go.

Dynamic models (`.osm`) load outside this path: vehicles/peds go through their own readers
(`readModelOsm` / `readPedOsm`) and workers — see [features/vehicles.md](../features/vehicles.md) and
[features/character.md](../features/character.md).
