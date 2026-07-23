# Plan 087 — the gostown field round (TC bugs after the first full boot)

The first TC to boot end-to-end (2026-07-23: player model, collision sweep, per-game draw distance,
hole-fill in the cell bake, phase-8 layout all landed the same day) surfaced its own field-bug batch.
Same method as 085: symptom → source asset → pipeline stage → pak bytes → shader; inspectors in
`docs/debug/README.md`.

## Rows

### A — the paradise bridge at LOD range (OPEN, bake side DONE)

`gp_paradisebridgea` (44 784 verts of trusses/cables, IPL lod = −1, its authored `LODParadiseBridge*`
defined but never placed) vanished from the far view. The hole-fill exemption
(`mods-src/gostown/lod-holes.json`, plan 086) IS in the rebuilt bake — `lods.img` `lod_5_-6.osm` is
2.8 MB (the bake grid is **256**, so the bridge's cell is `5,-6`, not the pak-grid `5,-7` — a
comparison trap that cost an hour). Field: the main span still pops only at its 190 u HD draw; a
SECOND span IS visible far, so part of the family already rides the lods. Next: in-browser evidence —
console errors at cell create, F2 map inspector pinning lod cells `5,-6 / 6,-6 / 5,-7` (their welded
verts: 50 627 / 84 239 / 15 621; the engine handles uint32 indices, weld has no 65 535 cap — both
checked). If the pinned cells draw the bridge, the streaming path is fine and the miss is elsewhere
(group class? distance?); if not, decode the welded positions.

### B — part of an island not streamed at range; a lone tree floats where its ground should be (OPEN)

Screenshot 2026-07-23: a chunk of a far island absent while a palm renders mid-air over the water —
the tree's cell loaded, the terrain's didn't (or its terrain got reduced out of the lod bake — the
row-A family). Suspects: a lod cell failing at create (console!), the reduction tracks eating TC
terrain, or the LOD ring boundary. Triage with the F2 map grid + console first.

### C — black stripes on the water (OPEN)

Long parallel dark bands across every lake (screenshots 2026-07-23, from the pre-click orbit view).
They look like shadows of the suspension bridge/cliffs stretched across the water — but gostown was
packed WITHOUT `--bakes` (no sun-vis), so where does the water darkening come from? Suspects: the
world AO bake (on by default — did the bake see the water shore-field?), the water shader's
night/indirect term, or welded-cell vertex colours under the water plane. Compare `?hour=12` vs
night; check whether the stripes move with the sun.

## Closed the same day (2026-07-23)

- Player model from `GAME_CONFIG.mainCharacter` (gostown → BMYCG) — boots.
- Collision: the world col/ipl sweep covers override archives — gostown collides.
- Far islands: per-game `drawDistance` (gostown 3000) — confirmed better in field.
- Boot clock from `GAME_CONFIG.loadGame.startMinutes` (gostown 12:00; original keeps 22:00) — the
  host's hardcoded NIGHT_HOUR ignored the config until now.
- Phase-8 layout: `opensa/` self-contained (pak at `pak/`), `opensa-pack/` = the fetch build,
  `build:game:*` chains both; `npm run fetch:pack` alias deleted (redundant).
