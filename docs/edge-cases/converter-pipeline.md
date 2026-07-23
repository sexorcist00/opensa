# Converter-pipeline edge cases

Boundaries of opensa-pack / perfect-map-builder / map-optimizer / the LOD generators.

- **Node heap ceilings.** A full pmb build **or a standalone `opensa-pack` run with AO on** needs
  `NODE_OPTIONS=--max-old-space-size=12288` (the cell bake holds the mod-grown ~1.3 GB `gta3.img` + merged
  cells); the default 4 GB dies around 37 % of the AO bake. sa-lod-generator needs ~8 GB. The full map cannot
  weld in one heap — welding is chunked.
- **Map objects have no standalone `.osm` texture set.** Only by-name classes (peds, vehicles, props,
  breakables, clutter) carry private `TEXS` dictionaries. Map objects are `textureSource: 'world'`
  (`DESC + GEOM` with global refs into the pak's shared dictionary — ~400 MB shared vs ~3.7 GB per-model) —
  such a model is **not viewable standalone**; the object/compare viewer skips that side and says so. At
  runtime a submesh whose world array hasn't streamed in is skipped, not drawn.
- **Vehicle `.osm` path degrades doors + mesh COL** — both are DFF-only today; a vehicle DFF with no
  embedded COL falls back to a box hull collider.
- **Unconditioned (vanilla) maps convert with bad lighting — run map-optimizer first.** 12,004 of 12,964
  vanilla world models ship no normals; the converter's naive fallback produces polygon-shaped light patches
  (it warns when >10% of world models take it; synthesis is map-optimizer's job).
- **map-optimizer refuses geometry it can't provably remap** — skinned, multi-UV, or multi-morph geometry
  is skipped per-asset on any count-changing pass rather than corrupted.
- **Two-sided world geometry breaks smooth-group normals.** SA's world is heavily two-sided (mirrored
  coplanar pairs); where incident faces cancel, faces degrade to flat shading and
  `sanitizeDegenerateNormals` substitutes an arbitrary face — sometimes pointing down.
- **Prelit is dark and load-bearing.** SA bakes map lighting into the _dark_ prelit set (mean luma 88/255);
  dropping it renders ~3× too bright. Night synthesis is gated on a model actually having prelit; ONE
  `NIGHT_AMBIENT` formula must be shared across weld/rigid/clutter paths.
- **QEM must be UV-drift guarded.** GTA roads tile V as per-segment patchwork; unguarded collapses smear it
  into lengthwise stripes (`maxUvDrift`). Never flip windings — a wrong flip is a hole.
- **Gamma vs linear TXD split.** Real SA (D3D9-era RW) multiplies/filters texels in GAMMA, the own engine in
  LINEAR, and the conversion isn't per-pixel invertible — atlases are encoded per target (gamma into the
  real-SA build, a linear sidecar swapped into the OpenSA img). **And never bake a lighting LEVEL into a
  texture the engine lights again** — bake a normalized atlas and carry prelit/night on vertices, so unknown
  pipeline multipliers (skygfx etc.) cancel; a level baked into texels breaks under any of them.
- **LOD bakes must exclude exactly what the engine excludes** — timed (tobj), interior, `lod`-target, and
  script-gated binary-only IPL groups (except `truthsfarm`) — or closed props get painted into far LODs
  (the bridge-roadblocks-in-LOD bug). Trees/procobj are excluded from cell LODs (they get impostors from
  the sibling tools).
- **Elevated lakes have no TRUE depth** — the water bake's height grid only rasterizes ground at GTA
  z ≤ 4 (`Z_CAP`, sized for SA's sea), so a TC reservoir far above it takes the shore-distance
  pseudo-depth path (plan 087 row C). Fine for the look; anything needing the real lakebed (underwater
  rendering, buoyancy) will need the cap rethought per water level.
- **Texture sizes are asset-driven.** Never hardcode a size that belongs to a source asset — texture arrays
  derive one size from `max(assets)`, fixed slots resample instead of throwing. Only shadow maps / probes /
  LUTs stay constants.
- **Mod vegetation is ~48× stock density, and almost none of it buys coverage.** `mods-src/vegetation`
  models run 1451–5813 triangles against SA's 48–132; in draw range of the Ganton path that is 13 524 →
  645 433 triangles (×47.7) for a leaf-area growth of only ×1.66 — **~96 % of the added triangles add no
  screen coverage**. `veg_palm04` is the extreme: 105× the triangles for LESS painted area than stock
  (524 vs 621 m²), average triangle 0.104 m² (~32 cm), i.e. under the rasteriser's 2×2 quad at play
  distance. There is no duplication to blame — each DFF is 1 atomic / 1 geometry. The chain also has no mid
  LOD: 5000 triangles HD → 16-triangle impostor, carried to a stock `vegepart.ide` draw distance of 150 that
  was sized for 48-triangle models.
- **A placement-only mod costs nothing until the `trees` stage swaps the models under it.** The mod
  "39. Green Piece 1.47" shipped no models at all — one IPL, 233 `inst` lines, installed into
  `data/maps/interior/stadint.ipl`. It was invisible in the mods-layer benchmark (stock trees then) and
  became **73 % of the whole trees-layer regression at Ganton** (6.09 of 8.36 ms) once the swap landed. When
  a stage multiplies per-instance cost, re-audit every earlier stage that added instances.
