# The Santa Maria / SF-west "blue strip" — LIVE investigation

**Status: OPEN 2026-07-29 (one long session, root cause NOT yet found — but the suspect space is
mostly burned down; do not re-run the exonerated probes).**

## Field reports (user, after the 024/093 rebuild — build 10:53+vehicles)

- Santa Maria beach lane: a flat light-blue strip where road/ground should read, running along the
  beach-house row. Named refs: `pier01_law2` (2335,-1712), `bealantr03_law2` (232,-1692),
  `bealantr02_law2` (136,-1715) — those are the visible NEIGHBOURS (the bealantr are vanilla-shaped
  bush-only models, "Tr" = trees, NOT transitions).
- `land_42_sfw` (-2318,1280) "positioned wrong" — visually; its pak weld is byte-correct.

## Established facts (each one measured, scripts in the session log)

1. **Reproduces in the engine-lab viewer** (`:4300 ?pak=1&at=180,-1680,50&orbit=70`) against BOTH
   the main pak and a `model-repack.ts` rect lab. Small flat light-blue patch ≈ (125..180,
   -1725..-1685), sharp polygon edges, a lamppost STANDS on it; srgb ≈ (134,162,198) at noon.
2. **Street level is fine**: headless game shots at 290,-1690 (day + night) show road underfoot,
   grounded z 7.2. The user's screenshots are high-camera views.
3. **The pak data is clean** — exonerated one by one: instances complete vs vanilla (only stripped
   lod + props differ, by design); placements present; tri counts = source (roads03 114/114,
   bealand01 120/120, pier01 983/986); welded world positions exact (land_42 bbox matches
   instance+source to 0.1); pipeline classes opaque/cutout as expected; group bounds sane; texture
   arrays' layer hashes match the models' texture names; the layers' PIXELS average
   gray/green (desgreengrass 81/97/57, roads31/32 layers 114/113/105 and 152/158/156); no >255
   layer overflow (arrays cap at 256, layer field is 8-bit by design); `manifest.missingLayers` has
   4 entries, none blue; cells' texture refs all valid; `objects[]` empty in the cells.
4. **The optimizer chain is exonerated**: `model-repack --raw` (source bytes, no chain) reproduces.
   The 024 gate touched NOTHING in these cells (all area models ship no normals → `created`, the
   path every earlier build ran).
5. **Vanilla-resolve lab is clean** (`--raw --no-mods`): the strip shows the vanilla road. So a
   MOD-RESOLVED asset triggers it. BUT the single-file bisect (`--mod-only roads32_law2`) verdicts
   were INVALIDATED: the lab's orbit camera phase differs per run, so fixed-pixel probes compared
   different world spots — the patch is visible in ALL mod-resolve shots regardless.
6. **Water: rows 118/119/184 of the BUILT `water.dat` are MOD-ADDED** (absent in vanilla): quads at
   z=0 reaching x≤140 across y −1552..−1792 — 79 baked verts sit in the strip box. **BUT a lab
   without `water.bin` still shows the blue patch** → the visible blue is NOT the water pass (the
   mod rows remain suspicious data — z=0 under terrain, harmless in real SA).
7. Side find, separate issue: `21. Wind Project` `bealantr02` bushes carry **sway amplitude up to
   24 (metres!)** in the welded sway channel — absurd; worth its own look.

## Where to resume

- **Plan [094 — sa-map-viewer](../plans/094-sa-map-viewer/readme.md) (PLANNED 2026-07-29) exists
  because of this issue**: a standalone viewer over ORIGINAL files with a fixed top-down camera —
  folder-swappable vanilla-vs-merged A/B with no repack and no orbit drift. Its Phase 6 is this
  bisect.
- **Kill the orbit for A/B**: fixed camera (orbit=0 / a static `at`+look param, or add one to the
  lab) so pixel diffs are valid; then re-run the file-level bisect (`model-repack --no-mods
  --mod-only …`, halving over the ~6 mod-shipped DFFs + txd events of cells 0,-7 / 0,-8 / -1,-7).
- Identify the surface authoritatively: the engine's placement PICK (debug), or render the lab with
  the debug unlit/normals view, or brute-force: delete placements one at a time from a lab cell
  (pak surgery) until the patch dies.
- Check whether the patch predates today's build (likely: the area was last eyeballed long ago; the
  gate/vehicles changes measurably did not touch these cells).
- Tooling gained this session (keep using): `model-repack.ts --raw / --no-mods / --mod-only / 
  LAB_NO_WATER=1`, the engine-lab orbit shots via `tools-debug/bench-harness/drive.js`, and the
  pak-side probes in the session transcript.
