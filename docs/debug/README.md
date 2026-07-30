# Debugging toolbox

The standing convention (2026-07-22): **a debug script that proved useful is kept in the repo** —
one-off inspectors live in `scripts/debug/`, and every kept script gets a row here (what it answers +
how to run it). Throwaway experiments run as `scripts/debug/.tmp-*.ts` (inside the repo so `@opensa/*`
path aliases resolve) and are deleted after; the moment one earns its keep, it is renamed, linted and
documented here in the same change.

## The triage method

Field bugs are traced to data BEFORE any code is touched (plans 084/085 proved the order):

1. **Symptom** — the user's in-game report, with a position and a model name if possible (F2 helps).
2. **Source asset** — is the DFF/TXD/IDE itself what we think it is? (`dump-texture`, `dump-chunks`,
   `find-instances`, `model-bbox`, IDE flags.) **Ask the MATERIALS, not the dictionary**: a TXD serves many
   models, so "this txd has a glass texture" does not mean this model draws it — plan 092 picked a field
   control that way and its windows turned out to be opaque (`dump-dff-materials.ts` is the answer).
3. **Pipeline stage** — which converter stage owns the transformation; its report/ledger first
   (`report.json` → `textures.missing` / `textures.crossTxd`, the pack log's ⚠/ℹ lines).
4. **Pak bytes** — what actually shipped (`dump-osm`, `dump-osm-meta`, `dump-texel-avg`). Byte-faithful
   output means the LOOK is the data's — see row G of plan 085: a "missing" radar texture was the mod's
   own near-black texture, proven by matching opaque texel averages source↔pak.
5. **Shader** — only after 1–4 are clean. The test suite cannot catch shader defects (the fake GPUDevice
   records, it does not validate); patch the shader to output its own terms as colour channels and shoot
   the game headless instead (that is how "ambient = 1.0 under the car" was found in 084).

The field verdict decides. Every measured number lands in the owning plan doc in the same change.

## Inspectors — source-asset side (`scripts/debug/`)

Run any of them as `npx tsx scripts/debug/<name>.ts …`; `--game <id>` picks the variant under
`game-src/` (default `original`).

| Script | Answers |
| --- | --- |
| `find-instances.ts <model\|id>…` | every placement of a model across ALL map IPLs (text + binary streams), with source file — "ghost text placement vs real streamed placement" |
| `inspect-area.ts <x> <y> [radius]` | every instance near a point and WHY it would (not) render: def, LOD class, interior, DFF/TXD presence, parse result |
| `handling-diff.ts [baseline.cfg] <candidate.cfg> [--rows]` | two `handling.cfg` tables column by column, and **how much of the difference the engine can even see** — per column: how many cars changed it, the mean relative move, and whether it is one of the five columns the adapter maps. Answers "a well-calibrated handling mod is installed and the car still feels wrong": against a 210-car realism table, 58 % of its edits never reach the physics (081/01) |
| `road-straights.ts [minLength]` | REAL flat straights + crests from the game's own vehicle path graph (`NODES*.DAT`): each run's length, its Δz, its heading, and crests as rise/drop within a launch length — where a scripted drive scene can be put without guessing coordinates (081/01) |
| `dump-texture.ts <txd> <name> [out.png] [alpha]` | one TXD texture as PNG (software DXT decode). **Gotcha:** transparent texels take the viewer's background colour — always check the `alpha` dump too; for DXT1a ground truth decode blocks (3-colour mode ⇒ index 3 is transparent black) |
| `dump-chunks.ts <file> [filterHex]` | a RenderWare file's chunk tree — WHERE a plugin chunk lives |
| `model-bbox.ts <model>…` | render extents (DFF) vs collision extents (COL) — partial mesh vs transform/culling bug |
| `dump-dff-materials.ts <model>…` | per-material DFF breakdown: texture, tris/verts, DAY vs NIGHT prelit RGBA averages + per-material bbox — "which submesh is this and how does the artist light it at night" (closed 085 rows G/H) |
| `txd-retune.ts <mod.txd> [--match <txd\|entry>] [--halve n] [--add <txd>#<name>] [--max n] [--no-mips] [--write]` | **rewrites** a mod's dictionary: every texture resized to the dimensions a REFERENCE (normally the stock) dictionary carries, plus textures an earlier mod ADDED that this one would silently drop. Dry-run by default; prints the plan and the bytes saved. Three real cases it exists for: an HD retexture that cost 5.6 MB against a stock 106 KB (mod 56 → −95 %); mod 4 overwriting mod 3's `cj_commercial.txd` so `cj_frame_glass2` vanished and mod 3's fridge lost its glass (the pak already reports these in `report.json` → `textures.missing` — `--add` is how you put one back); and simply halving an oversized mod (58 → −60/−75 %). **`--match` is a FLOOR as well as a target**, so `--halve` on a mod that already carries some textures at stock size shrinks only what is genuinely oversized. **Gotchas:** the author's DXT format is kept (forcing stock `dxt1` onto a `dxt5` glass would throw away its alpha), and a reference with a different ASPECT cannot be reached by halving — the tool stops at the nearest step above it and says so rather than squashing what the author drew |
| `plate-census.ts [model…]` | which models wear a license plate and how: per model the `carplate` (text strip) / `carpback` (city background) quads, their geometries and tri/vert counts, plus the both-vs-one-face split. The stock sweep: 14 865 DFFs → 143 plated, 139 with both faces (082 phase 0) |
| `plate-render.ts <vehicle.txd> [out.png]` | composed plates from a real `generic/vehicle.txd` → a zoomed PNG, plus the derived cell grid and compose timing. **Point it at a BUILT pak**: a mod may replace `platecharset`/`plateback*` wholesale (the shipped pack carries 512×256 backgrounds against the stock 64×32), and this is what proves the grid still lines up with the atlas the game actually reads |
| `alpha-class-census.ts [--img <path>] [--flips] [--json <out>] [--below/--above/--near <share>] [--txd <substring>]` | the alpha CLASS of every texture in an archive — which ones the pack sends to the depth-writing cutout pass and which land in the blend pass, **where the background paints over the foreground** (plan 092). Reports both readings of the histogram: the current absolute one (`mid ≤ 2 %` ⇒ cutout) and the mask one relative to the A2C reference 128 (`below` / `near` / `above`), plus the flip list. Defaults to `build/<game>/sa/models/gta3.img` — the merged, mods-installed tree — and **silently falls back to `game-src/` when that target was not built** (an `opensa`-only build leaves no `sa/`), which is a DIFFERENT, unmodded population: it prints the archive it read, so check that line before comparing two runs. The thresholds are CLI flags on purpose: the class is BAKED, so the rule is fitted on the census instead of on a re-pack |
| `txd-alpha.ts <txd\|path>…` | per-texture format/hasAlpha — vanilla only puts a model through blended render states on its ALPHA pass, so a DXT1 no-alpha texture draws opaque even on an ADDITIVE-flagged def (085 row H) |
| `find-2dfx.ts [--img <path>]` | 2d Effect entries across the map: type histogram + decoded roadsigns; diff archives to expose re-export damage |
| `ide-flag-histogram.ts` | which IDE object-flag bits the map actually uses, with example models per bit (flag semantics: `packages/renderware/src/parsers/text/ide-flags.ts` — verify bits against a real asset before acting on them) |
| `audit-rw-coverage.ts` | what the archive's DFF/TXD data contains vs what our parsers handle (chunk histograms, parse failures, dropped textures) |
| `check-cell-signs.ts <x> <y>` | the cell build's roadsign path offline — where a missing sign drops out |
| `procobj-stats.ts <x> <y>` | procobj scatter counts for one cell, per model/category |
| `dump-fx-system.ts <system>` | one effects.fxp system: emitters, blend modes, textures, keyframed tracks |
| `wind-coverage.ts` | how each wind-listed model will sway; folder↔constant drift |
| `solve-roadsign.ts` | brute-forces the roadsign plate transform (kept as the method record) |

## Inspectors — pak side (what actually shipped)

| Script | Answers |
| --- | --- |
| `dump-osm.ts <model> [--pak dir]` | a built pak `.osm`'s sections + DESC fixture: parts, submeshes, texture-array refs, own-TEXS vs world-sourced |
| `dump-osm-meta.ts <model> [--pak dir]` | per-submesh texture-LAYER histograms (vertex meta) + each TEXS layer's size/format/mips/name-hash — the layer-mismatch finder |
| `dump-texel-avg.ts <model> [pakDir]` | average colour of each own-TEXS layer (BC endpoint scan) — tells a black/greyed bake from a faithful one in seconds |
| `dump-vehicle-ao.ts` | per-part night-alpha (vehicle AO channel) stats for the mods-src admiral/comet — bakes from the DFF, so it judges a sky-occlusion change offline (run · stash · run · diff) |
| `dump-vehicle-materials.ts <game> <model>` | what every submesh of a BUILT car ended up as — material class (matte/paint/chrome/glass), lamp tag, night-twin layer, min vertex alpha, reflection slots and mean SKY occlusion — read out of `build/<game>/opensa`, the tree a field run actually loads. The answer to "why does this panel shine / glow / turn red?": it found the previon's dash trim coming out CHROME at coefficient 0.5 with sky 0.63, mirroring the sun through the windscreen |
| `dump-vehicle-rig.ts <model\|path.dff> [--game <game>]` | what the vehicle BUILDER sees in a car: frame tree, emitted parts, doors + their hinges, wheels, and the retractable-headlight pod with its derived open angle. Two traps are called out by name: a `<part>_ok`/`_dam` frame carrying its OWN transform (**SA destroys that frame** — a mod parked 1.518 m there and its doors hung off the car) and a ROTATED hinge/pivot (which is how a scissor door is built). A bare name is read from the game archives, a path from a mod folder |
| `dump-cell.ts <x> <y> [pakDir]` | a WELDED cell's tables at a world point: objectTable rows (kind, timed window, per-group class/array/sphere) + placement boxes near the point — the pak-bytes step for bugs in the welded look (built for 085 row H) |
| `stream-ring-bounds.ts [pakDir]` | per-cell TRUE geometry XZ AABB vs the slot's 250-grid rect: overhang stats/worst offenders, hd-only↔lod-only slot pairing, ring-skip check from spawn — the plan-087 streaming-holes verifier (default pak `build/gostown/opensa/pak`) |
| `grid-extent.ts [gameDir]` | the true occupied 250-grid extent of a game dir (default `build/gostown/sa`) — measures a game's `PACK_RECTS.full` rect BEFORE any pak exists (gostown `[-8,-16,37,5]`, original `[-12,-12,11,11]` measured 2026-07-23) |
| `water-depth-map.ts [pakDir] [x0 y0 x1 y1]` | ASCII heatmap of the baked water DEPTH field (water.bin) over a GTA region — the pak-bytes step for water-look bugs (found 087 row C: T-junction false shorelines striped every gostown lake; default region = the bridge/dam lakes) |

Default pak: `build/original/opensa/pak` (086 phase 8 — the game dir is self-contained; older builds are
probed at `opensa-pack/` and the nested `opensa/opensa`). The world-welded side of a model lives in
cell bundles, not its `.osm` — `dump-cell.ts` covers that path.

## Mutators — write to the source IMG (`scripts/debug/`)

Unlike the inspectors, these EDIT `game-src/<id>` in place. `game-src/*` is git-ignored, so the edit is
local and reversible by re-extraction; each is report-by-default, `--write` to apply, and drops a one-time
`.bak` of the target IMG first.

| Script | Does |
| --- | --- |
| `teleport-spot.ts <model> [--near x,y] [--distance N] [--eye 1.6] [--top 3] [--src <builtDir>]` | **inspector, does not write** — where to STAND to look at a map object: a ring of candidate spots around its placement, each one ray-cast onto the collision of every instance nearby (the z you would actually land on), rejected if a player-sized box there is inside anything, and annotated when the view to the target crosses another model. Instance rotation is honoured (rays go into each model's own space), and the world AABB comes from the eight ROTATED corners — swelling to the bounding radius made one long fence veto every direction. Prints ready-to-paste `SA_TELEPORTS` rows. Reads `build/<game>/opensa`, the tree a field run loads. Written for plan 092's field controls after a hand-picked spot put the camera inside a building |
| `model-repack.ts <model…> [--strip-normals] [--crease <deg>] [--prelit-floor <luma>] [--margin <cells>] [--raw] [--no-mods] [--mod-only a,b] [--no-ao] [--game g] [--out <dir>]` (+ `LAB_NO_WATER=1`) | swap EXPERIMENTAL versions of world models into a servable lab copy of the built game WITHOUT a full rebuild (plan 024 phase 0) — the static world renders from `pak/world.ospak` welded cells, so a DFF edit in the built tree changes nothing. Resolves each affected model's source the way the build does (last mod wins, PNG texture-folders replayed), re-runs the map-optimizer geometry chain in-memory (targets get the experimental flags), re-welds ONLY the cells the targets touch via `convertDistrict` rect, and writes `build/<game>/opensa-lab` — a per-file-symlink mirror of the built game with the lab pak. ~10 s for a one-cell rect (111 models). Serve with `npm run serve:static`, app `?src=/build/<game>/opensa-lab`, spots via `teleport-spot.ts`. Bisection levers (blue-strip hunt, `docs/open-issues/beach-blue-strip.md`): `--raw` welds SOURCE bytes (no optimizer chain), `--no-mods` resolves vanilla-only, `--mod-only a,b` re-mods just those DFFs, `LAB_NO_WATER=1` drops the water pass. Caveats in the header: world-context prelight not replayed, generated LODs thinner, `.osm` props may lose textures inside the rect |
| `scan-model-defects.ts [--game g] [--top N] [--dz 0.5] [--json out]` | ranks every PLACED world model by broken-authored-vertex-data criteria (plan 024 phase 1), scanning the SOURCE assets the build consumes (last mod wins, vanilla otherwise) so each hit NAMES the mod that shipped it. Family A: faces referencing an authored vertex normal facing the GROUND ≥ `--dz` more than the face itself, ranked by summed flagged AREA — the test is asymmetric and area-weighted because field round 1 falsified the naive angle version twice (`standard01_lawn`: up-rotated grass-card normals are a legal authoring trick that only brightens; 686 tiny faces ≠ 22 road slabs). Family B: day-prelit black holes (verts < 10 luma, whole-black triangles) on models with a healthy day median (≥ 40; `tobj` excluded). ~1 min for the 7 177-model original map. First run's headline: 65 Family A models; 2 243 Family B (186 with ≥100 black tris — 125 of those VANILLA: SA authoring baked shadow to 0 relying on the renderer's ambient floor) |
| `verify-cell-normals.ts <cellKey> <model> [labPakDir] [mainPakDir]` | **inspector, does not write** — reads a MODEL's welded vertex normals straight out of a pak cell (oswire→oscell decode, placement table → exactly the vertices its triangles reference) and prints the n.up histogram — the offline proof that an experiment reached the shipping cells without booting the game. Defaults to comparing the main pak against `model-repack.ts`'s lab pak. Cell key = `<cx>,<cy>,hd\|lod` from the instance pivot (`position/250` floored). Proved plan 024's Family A end-to-end: main pak roads17 = 96/165 verts sideways/down, lab (strip-normals) = clean up |
| `txd-from-pngs.ts <folder> [out.txd] [--version-from <t.txd>] [--replace]` | builds a `.txd` FROM a folder of PNGs — the missing half of the texture-folder convention (`docs/contracts/mods.md`), which only ever PATCHES a dictionary that already exists. Use it when the installer says `texture folder … — no entry <name>.txd`: a mod that ships the PNGs of a whole dictionary has nothing to patch, so every texture is dropped and the models naming it render untextured. Writes `<folder>.txd` beside the folder; `--replace` then deletes the folder (the PNGs were its unpacked form). The RW version is READ from a sibling dictionary, never assumed, and each texture's format follows its own image (DXT5 with real alpha, DXT1 without) — the same rule the merge applies. Real case: `52. Abandoned Cars`'s `gta3_img/philss/`, 22 PNGs that were exactly `cuntwjunk04`'s 22 textures. **Writes into `mods-src/`**, unlike the row below |
| `strip-polygons-from-dff.ts --img <path> --tex <name[,name…]> [--models a,b,…] [--write]` | drops every submesh whose material references a given texture (its triangles) from DFF models inside an IMG — for cards that render as flat missing-texture quads because the texture is absent from the mod. Vertices + the material list are left untouched (the material just goes unused — no re-indexing), so the other cards on the same model survive; each edited DFF is re-parsed and verified before write. Default scans all DFFs; `--models` restricts. Fixed gostown's `LODEnsemble*` `Gp_feuillu1` magenta (`lodveg.txd` ships 6 of the 7 LOD-veg card textures; `Gp_feuillu1` is absent from the mod — not a recovery miss) |

## Driving the map viewer — the folder-to-folder A/B (094)

`sa-map-viewer` renders the map straight from a folder of **SA-format** files (`game-src/<game>`,
`build/<game>/sa`, `build/salod`) — no repack in the loop, and a pose fully specified by query params. For an
OpenSA-converted dir (`build/<game>/opensa`, geometry is `.osm`) use the in-game debugger's map viewer
instead; this one says so and welds nothing.

Interactively it is the debugger's map panel: the cell grid, whole map, LOD mode, and **click-to-pick** —
a click reports the placement's model/txd/GTA position and can hide it (`Restore all` brings it back). That
is the fastest way to put a NAME on something odd in a screenshot before any bisecting starts.

The **sea** is drawn too (the flat `water.dat` build — no bake exists for a source folder), with a
**Show water** checkbox: an inspector has to be able to look UNDER the sheet at a sunken road or a
mis-levelled pool. It is the one thing in the viewer that moves on its own, so `map-viewer-shot.ts` shoots
with `water=0` unless the URL says `water=1` — with the sea in frame two runs are no longer byte-identical.

The other direction — you have the NAME and want the place — is **FIND MODEL**: type a substring, the rows
list every PLACED name with its placement count, Enter (or the row) centres the view on the nearest
placement and makes its cell resident. Pressing Enter again walks the same name's other placements outwards,
so a model placed 30 times is reachable past the first one. The pose (height, pitch, yaw) is deliberately
NOT changed by a jump — a search from a whole-map height stays there, so it cannot silently alter what a
capture is showing; dolly in afterwards.

| Script | Answers |
| --- | --- |
| `map-viewer-shot.ts <appUrl> <outPng> [timeoutMs]` | one scripted pose of a source, captured headless. Adds `panel=0` unless the URL sets it (the panel carries a live fps line, and a pixel diff must not compare a frame counter) and echoes the viewer's own `[sa-map-viewer]` load lines, which NAME the source. **Two runs of one URL are byte-identical PNGs** (wind is off by default — it was the only thing animating a noon frame), so two sources at one pose diff directly: `magick a.png b.png -compose difference -composite -colorspace Gray -format '%[fx:maxima*255]' info:` |

```bash
npm run serve:static && npm run dev   # /build + /game-src on :3001, the app on :5173
npx tsx scripts/debug/map-viewer-shot.ts \
  'http://localhost:5173/sa-map-viewer.html?src=http://localhost:3001/game-src/original&at=150,-1700' a.png
```

## Driving the game itself — the scripted physics lap (081/01)

The most useful tool this repo has for a gameplay bug: **the real game, driven by a script, printing
numbers**. Not a simulation of the game and not a unit test — the timeline goes through the same
`InputState` and the same `drive()` a player's keyboard does, so what it measures is what ships.

```bash
npm run serve:static && npm run dev              # the build on :3001, the app on :5173
SRC=http://localhost:3001/build/original/opensa
# one scene, or `phys=all` for the seven; `car=` picks the model
TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&phys=all&car=infernus" phys 1200000 7
npx tsx scripts/phys-compare.ts before.log after.log [--determinism]   # diff two capture sets
npx tsx scripts/phys-regression.ts sweep-*.log                        # gate a sweep on the shipped pack
```

A lap teleports beside a real road spot, waits for streaming AND the collision behind it, spawns the car,
seats the player, settles the springs, then plays a keyframe timeline while the telemetry ring records every
fixed step — and prints one `[phys] {json}` line (summary + a 20 Hz series). Scenes:
`apps/web/src/phys-scenes.ts`. Captures belong in
[`docs/benchmarks/vehicle-physics/`](../benchmarks/vehicle-physics/readme.md).

**What it is good for beyond physics tuning:** it is a repeatable driver for anything that only happens while
a car moves. Two engine bugs were found in its first day of use — telemetry reading every orientation-derived
rate as zero (an aliased array), and a car unloaded after you left it killing the fixed step permanently —
and both were invisible to the unit suites.

**How to read a failed lap.** The runner names its own failures (`[phys] scene 'x' failed: …`), and the
harness screenshots on exit — the on-screen HUD carries `FIXED-STEP ERROR: …`, which is how the despawn
crash was identified in one look. A capture that came back absurd (a car "airborne" for its whole lap) is
usually the lap seating into a WRECK a previous scene left at a shared spot.

Companion scanner: `road-straights.ts` (above) — where to put a new scene without guessing coordinates.

**Full guide: [`docs/development/physics-laps.md`](../development/physics-laps.md)** — the scene format, how
to add one, the capture schema, how to read a failed lap, and the gotchas five sweeps produced.

## Approaches beyond scripts

- **`report.json` ledgers first** — `textures.missing` (name → models that asked) and
  `textures.crossTxd` (donor txd per rescued name) at `<pak>/opensa/report.json`; one ⚠/ℹ pack-log
  line per event. A clean ledger rules out the resolver in one grep.
- **F2 debugger in game** — Position teleports (feature spots are pre-listed in
  `apps/web/src/game-config.tsx`), time-of-day presets, "Missing Textures: magenta" toggle.
- **Headless field check** — boot+screenshot+bench the real game without a window:
  `?loader=http-dir` + `npm run serve:static` (`tools-debug/bench-harness`); one-liners in
  [`docs/commands.md`](../commands.md). The served dir must be an opensa-pack `--out`.
- **The `[slow]` frame breakdown** — the dev-mode console line (Perf screen toggle) for any frame over
  20 ms: `render (submit) · stream (blob N worst M upload U) · camera · fixed (steps: controller + physics ·
  cars) · collision · vehicles · ped · anim · other`, plus draws / cells / bodies / colliders. **Read
  `other` first** — it is what the loop did NOT account for, and a 2026-07-27 field report of 20-250 ms
  frames was 90-98 % `other` until `blob` (the pak worker's texture upload, which ran BETWEEN frames) was
  given its own timer. A stall outside the loop cannot be found by reading the loop. `blob`/`worst` are the
  handler's residue (decode + createTexture) and `upload` is the budgeted in-frame drain, after the fix
  moved the writes into `StreamingDriver.update` (`docs/performance/applied/texture-upload-budget.md`).
- **The `[cam] jump` watchdog** — same Perf toggle: one line when the camera's look target jumps > 1.5 m,
  or the yaw jumps > 20° on an idle mouse, outside every legitimate discontinuity (teleport, mode switch,
  scripted seat sequence, fly, bench) — with the step state (mode, dt, distance, collision shown). Quiet on
  a healthy session. Distance-channel moves are deliberately not watched: the designed occlusion snap-ins
  live there (plan 080/09 §4.1; the seat-entry slam it hunted turned out to be a distance-channel glide,
  found by reading `resolveCollision` against the report).
- **Shader-term probe** — temporarily output a shader term as the fragment colour, shoot headless,
  compare against expectation. Reading the code had pointed at the wrong cause twice in 084.
- **Spot rebake (no full pmb run)** — APFS-clone the build (`cp -Rc build/original build/.x`), rebake
  one model, drop it in with `rewriteModelArchives` (inserts ONLY — a delete of the same name removes
  what you just inserted), serve, shoot, delete the clone.
- **Offline algorithm replica** — when a baked value looks wrong, rebuild the model through the SHARED
  builder in a `.tmp` script and instrument the exact function (per-azimuth traces pinned the 084 AO
  smudges to a scrap-ratio division in minutes; eyeballing histograms had only narrowed the part).
- **Real fixtures over synthetic** — a real GTA asset fixture is ONE manifest line
  (`npm run test:fixtures`); real files falsify what synthetic fakes confirm.
