# Map pipeline (DAT / IDE / IPL → streaming world)

`packages/renderware/src/parsers/text/`, `packages/renderware/src/map/`, `packages/game/src/streaming/`,
`packages/game/src/adapters/gta-sa-world.adapter.ts`.

## Implemented

**Text parsers**

- `gta.dat` (IDE/IPL/IMG directives).
- IDE: `objs` (incl. the mesh-count multi-draw-distance variant — max wins), `anim` (IFP name
  kept on `def.anim`), `tobj` (time windows), `txdp` (TXD parents). Other sections ignored.
- IDE flags (`ide-flags.ts`): DRAW_LAST, ADDITIVE, NO_ZBUFFER_WRITE, no-shadow (moot),
  IS_TREE/IS_PALM, DISABLE_BACKFACE_CULLING — full render-relevant set per the flag histogram.
  NO_ZBUFFER_WRITE (0x40) is applied only to **transparent** materials (decals/shadows/glass, which
  always also carry DRAW_LAST) — opaque geometry keeps depth writes, else bare-0x40 countryside
  terrain tiles show through under a free camera (plan 039 follow-up).
- IPL `inst` (11 columns), interior **area codes** (`interior & 0xFF`, world ids {0, 13}).
- Binary `bnry` IPL streams (full-detail placement) + **standalone script-gated groups**
  (`resolveMap({ extraIpl })`, default `['truthsfarm']`; barriers/carter/crack deliberately
  off — our world-state choice).
- zones (`info.zon`, `map.zon`), water.dat, timecyc(+24h), carcols, handling, vehicles.ide,
  procobj.dat, surfinfo.dat, GXT (CRC-32 without final inversion).

**World assembly**

- `resolveMap`: catalog + timed catalog + txdp + all instances (text + streams + extras).
- `buildWorldGrid`: 250 m cells, HD vs LOD lists (`isLodModel` by name), exterior filter.
- Cell building now happens OFFLINE in `tools/opensa-pack` (`weld.ts`): every cell is welded into
  merged per-material batches recorded as render bundles, with per-def IDE-flag treatment, hour-gated
  timed objects as objectTable kind-0 entries, 2dfx corona collection
  (HD only), animated `anim`-section objects (per-instance groups), road-sign text meshes,
  procobj clutter.
- Map meshes ignore DFF frame transforms (SA re-frames atomic model infos — junk-frame proof).
- **Floodlight beams** (`ws_floodbeams`, Vegas site lights): a `white` placeholder texture whose soft cone is
  baked into the per-vertex prelit ALPHA (the only transparency signal). `world-material.isVertexAlphaBeam`
  detects them and `build-clump` keeps the alpha as a vec4 `color` attribute; `buildWorldMaterial` renders them
  alpha-BLENDED (alphaTest 0 — the cone is ~0.2 alpha; no depth write). Without this they were opaque white
  blocks. **ASSUMPTION** (heuristic, not from SA — grep `ASSUMPTION`): "white texture + prelit alpha < 255 =
  beam". A full-map scan verified it matches only the genuine beams (never terrain blends — real textures — or
  foliage — texture alpha); tighten in `isVertexAlphaBeam` if a future model trips it. Tested against the real
  `tests/dff/floodbeams/ws_floodbeams.dff`.
- `StreamingSystem`: HD ring within `hdDrawDistance`, LOD ring to `lodDrawDistance`, async cell
  loads cached by the adapter, manual cell selection for the map viewer. **Seamless LOD↔HD swap**: the
  old detail level is kept until its same-cell replacement loads, then removed in the same step (no
  empty frame), and the new level appears at full opacity — `CellFader` fade-in runs only for
  genuinely new cells, never on a swap (fixed the LOD→HD "blink"). A hysteresis dead-band
  (`0.25 × cellSize`) holds a cell's level across the ring boundary so it doesn't flip-flop.
- Picking/describe: WebGL-era only — the engine has no ray query yet, so the debugger's Map screen is
  capability-gated off (plan 074/22).

## Known gaps / candidates

- IPL sections `cull`, `enex`, `grge`, `pick`, `jump`, `tcyc`, `auzo`, `mult`, `occlu` ignored.
- Interiors are filtered out entirely (no interior worlds yet).
- `anim`-def draw distance uses the normal HD ring only (fine for the rare props).
- No occlusion culling (SA `occlu`); frustum culling only.

## Test coverage anchors

Parser tests per format; `map/world-grid.test.ts`, `map/resolve-map.test.ts` (extraIpl),
`map/cell-groups.test.ts`, `streaming/grid.test.ts`, `streaming/collision-streaming.system.test.ts`,
`streaming/settle-watcher.test.ts`. Engine-side cell building is covered by
`engine/src/world/cells.test.ts` (100 %, through the fake `GPUDevice` — plan 077).
(`build-region.test.ts`, `build-cell.test.ts`, `fade.test.ts` and `streaming.system.test.ts` died with
the three renderer in 074/13.)
