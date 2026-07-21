# Converter-pipeline edge cases

Boundaries of opensa-pack / perfect-map-builder / map-optimizer / the LOD generators.

- **Node heap ceilings.** A full pmb build needs `NODE_OPTIONS=--max-old-space-size=12288` (the cell bake
  holds the mod-grown ~1.3 GB `gta3.img` + merged cells); sa-lod-generator needs ~8 GB. The full map cannot
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
- **Texture sizes are asset-driven.** Never hardcode a size that belongs to a source asset — texture arrays
  derive one size from `max(assets)`, fixed slots resample instead of throwing. Only shadow maps / probes /
  LUTs stay constants.
