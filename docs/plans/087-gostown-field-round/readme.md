# Plan 087 — the gostown field round (TC bugs after the first full boot)

The first TC to boot end-to-end (2026-07-23: player model, collision sweep, per-game draw distance,
hole-fill in the cell bake, phase-8 layout all landed the same day) surfaced its own field-bug batch.
Same method as 085: symptom → source asset → pipeline stage → pak bytes → shader; inspectors in
`docs/debug/README.md`.

## Rows

### A+B — lod cells missing from RING streaming (DIAGNOSED 2026-07-23; rect + `aabb` fixes landed, grid re-alignment rolled back, bridge hole-fill widened — rebuild owed)

**Field discriminator (user): pinning the whole map with "Show LODs" renders EVERYTHING — the bridge,
the islands, no holes, no console errors.** Diagnosed OFFLINE from the pak bytes + `lods.ipl` (no
instrumentation needed — `scripts/debug/stream-ring-bounds.ts` is the verifier). THREE stacked root
causes, none of them the ring state machine (suspect 2, eviction pressure, is ruled out BY CODE:
inside the 3000 u gostown ring nothing ever evicts — there is no residency target at all):

**Root cause 1 — the pak convert CLIPPED the map.** pmb's `pack.rect` was hardcoded `[-12,-12,12,12]`
("covers the whole map" — true for SA, false for a TC). Gostown content occupies cells x −8..37,
y −16..5; **95 of the 374 baked lod impostors (and every hd cell beyond ±12) were silently dropped**
— the far islands never existed in the pak at ANY level. That part of row B was unfixable by any
streaming logic. → FIX: the rect is now optional everywhere (pmb config / `packGameDir` /
`convertDistrict` / CLI `--rect`); the default auto-fits the occupied world grid (`occupiedRect`).

**Root cause 2 (measured mechanism; the fix was ROLLED BACK — see the user decision below).**
The 256-grid bake vs the 250-grid pak = two DIFFERENT partitions of the plane: an impostor (baked per
256-cell, anchored at that cell's centre) welds whole into the 250-slot of its anchor, so a slot's lod
footprint ≠ its hd footprint. Promoting a slot to HD unloads lod coverage that spills into neighbours
still at LOD range → holes that WANDER with the HD ring. Measured at the gostown spawn (slot 5,−6
centre is 187 u from spawn → HD): its lod spans z 1266..1731 (holds the paradise-bridge far span),
its hd only z 1233..1351; the neighbour 5,−7 sits 386 u away (> 380 HD ring) and its lod starts at
z 1646 — **the bridge span z 1351..1646 is covered by NOTHING**; ±10 u of walking flips 5,−7 across
the HD edge and the hole moves. The grid mismatch also produces the paired hd-only/lod-only slot
columns (31 hd-only vs 20 lod-only slots: `-4,y`↔`-3,y`, `11,y`↔`10,y`, `y=-11`↔`y=-10`…).
**User decision (2026-07-23 night): the 256→250 re-alignment is REVERTED** — 256 is deliberate (the
game grid; plan 002 originally sized the bake to the three-era streaming grid, which WAS 256; the pak
moved to 250 later). The mechanism stays measured and documented (edge-cases/streaming-formats.md);
whether to re-align is decided on field evidence AFTER the bridge-model fix below lands — the
bridge-shaped part of the symptom has a model-data explanation that must be separated out first.

**Root cause 3 — the ring tests the GRID rect, but geometry is welded by PIVOT.** Measured overhang of
true vertex XZ AABBs beyond the slot rect (gostown pak, 2026-07-23): hd mean 127 u / p90 171 / p99 339 /
max 799; lod mean 141 u / p90 215 / p99 339 / max 799 (worst: `4,-9` — one mesh spans x 245..2049 in a
250 u slot). With `FOG_RING_MARGIN = 100` any overhang > 100 u can hold geometry visible inside the fog
while its slot is still outside the ring (matters most for original's 1200 u ring — likely the 078
in-game LOD finding). → FIX: the manifest cell entry gains `aabb` (world XZ, from the weld's bucket
bounds, verified against the pak-measured bridge cell to ±1 u rounding); `StreamingDriver` now tests
the level's TRUE rect for LOD desire, the union of level rects for eviction, and the created level's
rect for the late-create honesty metric. Pre-`aabb` paks fall back to the grid rect. HD stays a
centre-distance quality ring.

**The bridge MODEL story (decoded 2026-07-23 night — corrects row A's history below).** The merged
build's `Gp_City.IPL` DOES place the authored `LODParadiseBridgea/b/c` (draw distance 2500) and links
them properly (the HD instances carry lod indices 194/195/196 → those text lines) — the old "defined
but never placed, IPL lod = −1" claim was wrong. What actually happens in the opensa chain:
`stripLods` removes the authored LODs (they are lod-targets), the cell bake's reduction then eats the
replacement impostors' bridge geometry, and only span **a** was exempted via `lod-holes.json`. So the
pak's far bridge = verbatim span a inside `5,-6,lod` only; spans b (HD draw 100!) and c have NO far
representation at all — "the main span pops at its ~190 u HD draw; a SECOND span IS visible far" was
exactly this. **User field addendum:** at spawn the missing span starts ~80 u away (HD range!) — that
is the root-cause-2 geometry above (span a+b HD lives in slot 5,−7 which sits 6 u outside the 380 HD
ring; the lod that should mask the band is hostage to 5,−6's HD promotion) COMBINED with b/c simply
absent from the lod bake. → FIX (data): `mods-src/gostown/lod-holes.json` now lists
`gp_paradisebridgea/b/c`; pivots — a (1494,−1522) slot 5,−7 · b (1478,−1664) slot 5,−7 · c
(1509,−1351) slot 6,−6.

**Per-game rects (user directive).** One hardcoded map rect is gone for good: pmb `PACK_RECTS` maps
game id → named rects — `full` (what the pipeline passes: original `[-12,-12,12,12]`, gostown
`[-8,-16,37,5]` measured this round) plus pinned debug/bench districts (original `ls = [8,-9,11,-5]`,
the 074/11 bench scenes). A game without a `full` entry auto-fits to content (`occupiedRect`);
`config.pack.rect` stays as a per-run override, CLI `--rect` for standalone subsets.

Owed: **rebuild gostown + original** (repack emits `aabb` + the per-game rect; gostown rebake picks up
the b/c hole-fill), then field-verify — spawn→bridge walk (span visible at HD range and at LOD range),
far islands present, wandering-hole check while driving; re-run `stream-ring-bounds.ts` on the new
paks. NB the bake stays 256, so the hd-only/lod-only slot pairing and the lod spill WILL still show in
the script's output — only the bridge rows and the island clipping are expected to die; if wandering
holes survive the b/c fix, root cause 2 returns to the table.

### A (history) — the paradise bridge bake side (superseded by the model story above)

**NB the premise here was WRONG** — the authored `LODParadiseBridge*` ARE placed and lod-linked in the
merged `Gp_City.IPL`; they vanish because `stripLods` removes lod-targets and the bake's reduction ate
their replacement (see "The bridge MODEL story" above). Kept as written for the history of the trap:

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

### B — part of an island not streamed at range; a lone tree floats where its ground should be (COVERED BY A+B)

Screenshot 2026-07-23: a chunk of a far island absent while a palm renders mid-air over the water.
Explained by the A+B root causes: the islands beyond cell ±12 were clipped out of the pak entirely
(root cause 1), and the palm-over-nothing pattern is the partition mismatch (the palm's anchor slot
loaded while the terrain's lod coverage lived in a different/absent slot — root cause 2). Re-check in
the field after the rebuild; only if a hole survives does this become its own row.

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
