# Plan 087 — the gostown field round (TC bugs after the first full boot)

The first TC to boot end-to-end (2026-07-23: player model, collision sweep, per-game draw distance,
hole-fill in the cell bake, phase-8 layout all landed the same day) surfaced its own field-bug batch.
Same method as 085: symptom → source asset → pipeline stage → pak bytes → shader; inspectors in
`docs/debug/README.md`.

## Rows

### A+B — lod cells missing from RING streaming (OPEN — narrowed 2026-07-23 evening)

**Field discriminator (user): pinning the whole map with "Show LODs" renders EVERYTHING — the bridge,
the islands, no holes, no console errors.** So the pak data is complete and the renderer is honest;
the defect lives in the ring SELECTION (`StreamingDriver.desiredLevel` / eviction / create scheduling)
— pinning bypasses exactly that. Ruled out: engine frustum culling (uses the cell's TRUE geometry
bounds from the oscell, not the grid rect), uint32 index handling (weld switches at 65 535, engine
sets the index format per cell), create errors (console clean).

Remaining suspects, in order:
1. `desiredLevel` ring math for slots whose hd/lod keys disagree (gostown: 290 hd vs 279 lod slots),
   or the hysteresis/`slot.current` state machine leaving slots at `null`.
2. Eviction / residency-target pressure dropping lod cells that were just created (holes WANDER while
   driving — an eviction smell).
3. The 256→250 grid drift (the bake's `lod_<cx>_<cy>` naming is 256-grid; the weld assigns each model
   to the SAME-NUMBERED 250 slot, so geometry sits up to ~150 u outside its slot's rect at high cell
   indices) — biases ring DISTANCE decisions, could starve edge slots. Original has the identical
   drift and its in-game LOD check is STILL OWED (plan 078) — this may not be gostown-specific.

Next: instrument the ring decision (log/HUD `desiredLevel` + eviction for a named slot, e.g. 5,-6)
and walk the spawn→bridge path; that is code for the next round.

### A (history) — the paradise bridge bake side (DONE)

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
