# Commands cheat sheet

The everyday commands with all their params, in one place. Canonical folders:
**source game** `./game-src/original` · **mods** `./mods-src` · **canonical build** `./build/original`
(see [architecture/perfect-map-builder.md](./architecture/perfect-map-builder.md)).
Rule (also in `CLAUDE.md`): when a command or param is added/changed, update this file.

## The one build, per TARGET

A build is asked for by target, not as a whole — the two are independent and the opensa one is rebuilt far
more often, so it does not pay for the real game's LOD pass:

```bash
npm run build:game:original:opensa     # our target only  (pmb --exclude sa) + fetch-pack
npm run build:game:original:sa         # the real game    (pmb --exclude vehicles,peds,opensa)
npm run build:game:gostown:opensa      # TCs are opensa-only (also :carcer :anderius)
```

Both write into the same `./build/<id>`: `:opensa` fills `opensa/` + `opensa-pack/`, `:sa` fills `sa/`, and
neither touches the other's directory (the builder only clears its own `<out>/.work-<target>`, plus a legacy
shared `.work` if one is left from a pre-005 build).

**`<out>/.work-<target>` is wiped before any stage reads `--game`** (pmb plan 005: one work dir per target,
so building one target keeps the other's intermediates), so re-running one stage off an intermediate
(`--game <out>/.work-sa/5-trees`) inside the SAME target's dir deletes the intermediate first. Copy it out,
point `--out` elsewhere, or read the OTHER target's kept dir — the builder refuses the overlap rather than
wiping it. Every run writes `<out>/build-timings.json` — per-stage wall clock plus the target and procobj
knobs it was built with, so two durations are comparable — and each target that runs writes
`<out>/report-<target>.json` (`report-sa.json`, `report-opensa.json`): the target, the fetch game id, the
timings and one typed fragment per stage that produced one (optimize totals; the sa census/FLA pools/lift
requirements/asi sha; the pack summary with a POINTER to `opensa/pak/report.json` — there is no root
`report.json` any more). Standalone:

```bash
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src --exclude sa
```

Params: `--out <dir>` (default `./build/original`) · `--until <mods|vehicles|peds|optimize|trees|sa|procobj|opensa|pack|lod>` (that IS the run order — `procobj` is baked inside the `sa` branch since plan 014, so `--until sa` stops BEFORE the clutter)
(inclusive, keeps `.work-<target>/`) · **`--exclude <stage,stage>`** · **`--target <sa|opensa>`** ·
`--procobj-density <n>` · `--procobj-max <n>` · `--keep-work` · `--no-weld-seams` · `--no-textures` ·
**`--bake-collision`** (write every cell's collision into the pak — plan
200/3-01; off by default, and the same tree built with and without it is the A/B the claim is read on: the
runtime reads a bake when the pak has one and parses COL when it does not).

`--exclude` says WHICH STAGES run where `--until` is the stop point: it drops the named stages and keeps
everything after them (repeatable, comma-separated, same names as `--until` minus the `lod` alias; an unknown
name is an error, never a silent skip). Excluding `opensa` drops `pack` with it; excluding `pack` alone leaves
`opensa/` in GAME format; excluding `sa` also drops its `checkImgIdBudgets` guard, which reads the `sa/` tree.
**`:sa` builds no mod vehicles or peds** — that is what `--exclude vehicles,peds` means.

`--target` says which HOST the build is for, and it picks every knob whose right value is a fact about the
host rather than about the source data (limits, particle policy, procobj density). Omit it and it is DERIVED
from `--exclude` — `--exclude sa` builds for `opensa`, anything that still builds `sa/` is `sa`, because the
common chain is shared and its content has to satisfy the host that still has ceilings. `--target opensa`
without `--exclude sa` is refused for the same reason. The run prints the target it resolved, and the procobj
stage prints that layer's price against it (objects · permanent text rows · rows/object).
NB `--target` means a DIRECTORY in `vehicle-installer --rebake` — same word, unrelated meaning.

`--procobj-density` is the scatter density cutoff for the procobj stage — **1 = vanilla, max 3** (the
scatter's candidate ceiling; above it there are no candidates left to keep and the build refuses). The run
prints the density it built at, so a capture states its own configuration. **The flag is the whole-map
number; a PROFILE** — per category and per category×surface, plus a `maxDensity` that raises the candidate
ceiling — **is a config value, not a flag** (`BuilderConfig.procobjDensity` / `ProcObjLodConfig.density`
accept `number | ProcObjDensityConfig`). The build then prints every key (`base=1 rocks=2`) and a
per-category `objects / candidates / taken by the cap` breakdown. One density for both targets: it is not
keyed by host. `--procobj-max` raises the placed
-object safety cap with it; without that a high-density run measures the CAP, and the build says so with a
`CAP DROPPED n` line. **The 2026-08-08 finding that "the cutoff is not the density lever" is retired**: it was
true only because `cullByMinDistance` was deleting 99 % of the candidates with a column that is a camera
distance. Since [009](../tools/sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md)
density 1 IS the authored density (91 092 objects) and `procObjMax` defaults to 100 000 so it does not bind.

An `sa` build also **ships `perfect-map.asi` into the built game root** (sha256 recorded in
`build-timings.json`, so a map is paired with the exact asi that lifts its ceilings). The artifact comes from
`asi/perfect-map/dist/` — build it with `npm run build:asi` in that workspace, which needs MinGW; `dist/` is
gitignored, so a fresh checkout has none and the build **warns loudly** instead of quietly emitting a tree
that corrupts a plain install.

On the built `sa/` tree the build also prints its **install requirements** — every stock ceiling the artifact
crosses and the setting that lifts it (int16 rows → `perfect-map.asi`, which no adjuster provides; the
`CBuilding` pool → OLA `Buildings`; rows in one IPL → OLA `EntitiesPerIpl`; the three FLA id pools). A LINE,
never a throw: the ceilings that are REAL on the target are guarded beside it, and this one states the ones we
deliberately design past, so the install a build needs is read off the artifact rather than remembered.

On the built `sa/` tree the build prints a **map-cost census** (`reportTextIplCensus`: permanent text-IPL rows,
inst-bearing IPLs, and how many of the IPLs listed in `gta.dat` it could actually read) and enforces the **FLA
ID pools** (`checkImgIdBudgets` — the one set of ceilings the target really has). An `--exclude sa` run does
neither. There is no int16 row guard any more: the target always runs `perfect-map.asi` + OLA + FLA, so that
ceiling is lifted where our data lands — `--allow-text-row-overflow` was deleted with it (2026-08-09).

### Vehicle round: rebake instead of rebuilding

```bash
# Re-install + re-convert the mod cars of an ALREADY BUILT game, in place (one car ≈ 3.6 s)
npx tsx tools/vehicle-installer/src/cli.ts --rebake gostown --only previon
npx tsx tools/vehicle-installer/src/cli.ts --rebake gostown            # every mod car of that game
```

Defaults: `--target build/<game>/opensa` · `--in mods-src/<game>/vehicles` (both overridable). Per car it
merges its `*.settings.txt` into the BUILT `data/*`, merges its `features.txt` line into
`data/vehicle-features.txt`, re-converts its `dff`/`txd` and REPLACES `<model>.osm` in whichever
`models/*.img` holds it. Idempotent, and it touches nothing else in the tree.
It can also **ADD a car the built game never had**, when the mod declares its own `vehicles.ide` row: the
roster is text and a spawn resolves `<model>.osm` by name, so nothing about a car is baked into the pak. The
tool never allocates an id (it must match what a full build would write) and refuses one that already belongs
to another model. An added car has no traffic or parked presence until a full build writes the placements —
spawn it by name to look at it ([plan 006](../tools/vehicle-installer/docs/plans/006-rebake.md)).

## Serving & running

```bash
npm run dev                 # Vite dev server → http://localhost:5173
npm run serve:static        # static origin :3001 — mounts /build + /game-src (Range + /__index), static/ archives
npm run phone:setup         # ONCE per device: deps, tsx, the prebuilt app, and what is still missing
npm run phone               # the whole phone run in ONE command (convert if needed → check the pak → serve → print the URL)
npm run build:embed:dispatch # → dist-embed/ — the dispatch MAP as one ES module, for an external host
```

**Two commands is the whole phone workflow**: `npm run phone:setup` once, then `npm run phone` for every run
after. Setup is idempotent — re-running it after a failure, a pulled commit or a reboot costs seconds and
repeats nothing — and it installs only; the pak is `npm run phone`'s business because that is the expensive
half. It uses `HUSKY=0` rather than editing `package.json` to get past the `prepare` hook, so the worktree
stays clean on the one machine where `git status` is hardest to read.

`npm run phone` (`scripts/phone.sh`, plan 200 chain 4) is the field-run ritual for a device, written so the
command never changes and every knob is an env var: `REBUILD=1` re-converts, `BAKE=0` builds the other side of
the collision A/B, `TEXTURES=` picks the texture format (default `astc`; `rgba8` is the A/B's other side),
`MODELS=0` skips the model convert (fast, but then only `dispatch.html` is usable — it runs
no physics), `VEHICLES=` / `PEDS=` set the model SUBSET (default `admiral,infernus,comet` + `bmycg,wmycr`;
`all` converts the roster — hours on a phone), `ASTC_THREADS=` caps astcenc's worker pool (default 2 — the library's one-per-core is what OOMs a phone), `DISTRICT=` picks the measurement district — its rect, its
spawn and the map's opening point at once, from the table the console reads (`npx tsx scripts/district.ts`
lists them; the default is the one 201/1-01 pinned), `RECT=` / `SPAWN=` / `OUT=` / `GAME=` / `APP_PORT=` /
`STATIC_PORT=` move the rest, and `MAPOBJ=0` turns off the district lever (`--map-objects-in-rect`, on by
default here: convert only the map objects the rect PLACES instead of all ~14 000 the IDEs name — the slowest
stage of a district convert). It converts
only when there is no pak (a phone convert is minutes to hours), prints what the pak actually carries — the
collision GRID first, then what its textures cost — and reuses a server that is already up. **When it reuses a
pak it first asks that pak whether it is the one being requested** (`scripts/debug/pak-recipe.ts` against
`report.json`'s `build` block) and refuses to serve a mismatch, naming both sides: before that check,
`RECT=… npm run phone` over an existing pak served the OLD district in silence, because the knobs are read
only on the convert branch. Ctrl+C (or closing the Termux session) stops
the servers it started. A prebuilt app in `build/webapp` (or `WEBAPP=<dir>`) is served as static files and
vite is not started at all — which is the only way in on a device whose rolldown binding crashes
([edge-cases/browser-runtime.md](./edge-cases/browser-runtime.md)). A ready archive is committed:
`tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp` ([prebuilt/](../prebuilt/README.md)). Full phone recipe: [development/mobile-pak.md](./development/mobile-pak.md).

| Surface                  | URL                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Game on the served build | `http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa`                            |
| Bench sweep (8 scenes)   | `http://localhost:5173/?bench=all` (one scene: `?bench=country-dusk`)                                              |
| Soak (minutes)           | `http://localhost:5173/?soak=30`                                                                                   |
| Clutter A/B              | `&procobj=<×density, 0=off, saturates at 3>` · `&procobjLimit=<per-cell, saturates at 300>` · `&procobjRange=<units, overrides every category's draw distance — 150 = the pre-2026-08-10 ring, 100 = SA's own flat PLANTS_MAX_DISTANCE>` · `&procobjSampler=<area|corner — corner is the original's in-triangle routine, one sqrt apart>` · `&procobjSlope=<steep>,<flat> — ROCK candidate multipliers on steep vs flat faces; re-rolls the scatter>` · `&procobjFloor=<n, DEFAULT 1 since 2026-08-11 — keep at least n of every species the cell is eligible for; 0 is the A/B and brings back the 17.7 % species loss>`. Full table: [query-parameters.md](development/query-parameters.md) |
| Physics lap (081/01)     | `http://localhost:5173/?phys=all&car=infernus` (one scene: `?phys=brake-strip`) → `[phys]` JSON per lap            |
| Video mode (096)         | `http://localhost:5173/?video=1&seed=47` (`&car=` pins the car, `&at=x,y` pins the start, `&scenes=N` shortens the sequence, `&scene=N` starts at scene N — `&scene=57&scenes=1` plays exactly scene 57, `&diag=1` adds the per-frame camera capture) → a seeded SEQUENCE of drive scenes, scenes 1…100 of the seed (`&scenes=N` for a shorter one), one per region (LA→VEGAS→SF→COUNTRYSIDE→DESERT), `[video]` JSON per scene. **The URL rewrites itself as the reel plays** — `&seed=` and `&scene=` name the scene on screen, so the bar always points at what you are watching and can be copied to come back to it. `&car=` pins the car, else each scene picks one off the MOD-CAR roster when the build has any (`data/vehicle-mods.txt`), and off the stock road-car roster when it has none |
| Lab                      | `npx vite --config apps/engine-lab/vite.config.ts` → `http://localhost:4300/`                                      |
| Lab: streaming LS        | `http://localhost:4300/?pak=1&src=http://localhost:3001/build/original/opensa&at=2495,-1687,13&orbit=300&draw=1500` |
| Lab: vehicle probe       | `http://localhost:4300/?pak=1&stream=1&src=…&vehicle=1&vmodel=vehicle-comet&at=2495,-1675,13.3&orbit=26&hour=12`   |
| Viewers                  | `npm run dev` → `http://localhost:5173/viewer.html?tab=<object,vehicle,character,compare>`                         |
| sa-map-viewer (094)      | `http://localhost:5173/sa-map-viewer.html?src=http://localhost:3001/game-src/original` (no `?src=` → folder picker) |
| sa-map-viewer: a pose    | `…&at=2375,-1625&h=400&pitch=-89&yaw=180` (GTA x,y · height · degrees) · `&panel=0` capture mode · `&wind=1` unfreeze |
| sa-map-viewer: the sea   | on by default; `&water=0` hides it (the panel has "Show water") — scripted shots add `water=0` themselves |
| dispatch console         | `npm run dev` → `http://localhost:5173/dispatch.html` (defaults to `?src=build/original`) — the CAD surface: top-down map, live units, call queue, click-to-inspect |
| dispatch: no build       | `…/dispatch.html?demo=1` — a synthetic block city, no pak needed (and no model names on click) |
| dispatch: a PHONE pak    | `npx tsx tools/opensa-pack/src/cli.ts --game ./game-src/original --out ./build/district --textures astc --max-texture 256 --rect 8,-8,11,-5 --no-ao --no-models` → serve it and open `dispatch.html?src=build/district&at=2495,-1687`. `--textures astc` is what makes the pak loadable on a GPU without BC (every mobile one) at one byte per texel; `--textures rgba8` is the portable-but-4x fallback and `--max-texture N` takes back three quarters of ITS cost; `--rect` keeps the rest affordable. Full recipe, including building on the phone in Termux: [development/mobile-pak.md](./development/mobile-pak.md). Cells are `floor(worldXY / 250)` and **Los Santos sits at NEGATIVE GTA y** — `8,-8,11,-5` is x 2000…3000, y −2000…−1250 (Ganton/Idlewood); the whole of LS is about `1,-10,11,-3` |
| dispatch: a pose         | `…&at=1700,-1500&h=900&pitch=-66&yaw=180` (GTA x,y · height · degrees) — same convention as sa-map-viewer |
| dispatch: world knobs    | `&src=<built game>` · `&hd=450&lod=2200` streaming rings · `&hour=10` · `&weather=0` · `&fogscale=2.5` · `&fog=1` restores the game's fog (off by default, or a city view culls every cell) |
| dispatch: embedded       | `npm run build:embed:dispatch` → `dist-embed/dispatch.js` **plus `assets/pak-worker-*.js`, which must be served beside it at the path the entry names**. A host imports the module, calls `bootDispatch` / `bootPlanMode`, and configures it through `window.__opensaDispatch` — NOT the address bar, which belongs to the host. `&src=` accepts an absolute URL, so a hosted pak needs no local game files: [features/dispatch-console.md](./features/dispatch-console.md#embedding-it) |

Full query-param reference: [development/query-parameters.md](./development/query-parameters.md).

## Individual tools (run standalone when bisecting the chain)

```bash
# Mods → game dir
npx tsx tools/mod-installer/src/cli.ts --in ./mods-src/original/mods --game ./game-src/original --out <dir>

# Lossless map conditioning (normals/prelit/dedupe)
npx tsx tools/map-optimizer/src/cli.ts --game <dir> --out <dir>

# Tree LOD impostors
npx tsx tools/lod-trees-generator/src/cli.ts --in ./mods-src/vegetation --game <dir> --out <dir> \
  --prelight ./mods-src/vegetation/prelight/info.json --tex 512

# Procobj → static IPL + LODs ([--target sa|opensa]: the host the layer's cost is reported against; pmb passes
# its own. [--density n]: scatter cutoff, 1 = vanilla, max 3 — the run prints the density + rows/object it built)
npx tsx tools/sa-procobj-placement/src/cli.ts --in ./mods-src/procobj --game <dir> --out <dir> --prelight --draw 299
#   --sampler <area|corner>  where in a triangle a placement lands; corner is the original's recovered routine
#   --species-floor <n>  objects every species with a candidate is guaranteed per 250 u cell (default 1, 0 = off).
#   Its own gate, WIDER than the runtime's: nothing caps this path, so what empties a species locally is the
#   density lottery, and the floor ADDS objects rather than swapping them (+312 of 91 067 measured, +0.34 %).

# OpenSA cell LODs ([--holes <json>]: hole-fill models merged verbatim past the reduction tracks)
npx tsx tools/opensa-lod-generator/src/cli.ts --game <dir> --out <dir> --cell 250
#   --cell MUST equal the pak's 250 render grid: a mismatched bake puts an object's HD and LOD in different
#   streaming slots — field-proven holes (plan 087). NOT the 256 game grid (collision/procobj keep that).

# Real-SA per-object LOD clones ([--holes <json>]: per-game hole-fill list, e.g. mods-src/original/lod-holes.json)
NODE_OPTIONS=--max-old-space-size=8192 npx tsx tools/sa-lod-generator/src/cli.ts --game <dir> --out <dir>

# Game dir → native pak (the pack stage standalone)
NODE_OPTIONS=--max-old-space-size=12288 \
  npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --in ./mods-src
#   [--rect x0,y0,x1,y1] [--pak-out <dir>] [--game-id <id>] [--no-ao] [--bakes --clouds mods-src/clouds] [--no-models] [--bake-workers N] [--stochastic <file…>] [--platforms desktop|mobile[,…]] [--textures astc|bc|rgba8] [--max-texture N] [--vehicles a,b] [--peds a,b]
#   --rect: optional SUBSET override (bench districts); default auto-fits every cell with content — the old
#     hardcoded ±12 silently dropped gostown's far islands (plan 087)
#   --pak-out: where the pak products land (default: <out>/pak — the game dir is self-contained, 086 phase 8)
#   --game-id: fetch game id stamped into the pak manifest (default: basename of --game; pmb passes its own)
#   --bake-collision: write every cell's collision into the pak (.oscol v2, on the GAME grid 256 -- NOT the
#     render grid 250) so the browser never parses a COL, and resolve the breakable gate here too (the
#     per-placement instance keys ride along, so the runtime opens no DFF either). The runtime READS this
#     since 200/3-01; a cell without an entry falls back to parsing COL. Off by default: it costs build time
#   --platforms: ASSERT the build runs on the named GPU families, and fail the pack when it does not. Every
#     run reports the demand anyway (report.json `platforms`, and one log line): world arrays ∪ model
#     dictionaries, because a car is NOT in the pak — an --rgba8 world can still be unspawnable on a phone
#   --textures: the format the build WRITES, for the world AND every model dictionary (200/2-02).
#     bc (default) passes SA's DXT through untouched, desktop-only. astc re-encodes to ASTC 4x4 — one byte
#     per texel (the same as BC3, a QUARTER of rgba8) on the GPUs that have no BC; it costs build time and
#     one generation of loss. rgba8 leaves the pixels uncompressed: portable, 4x an astc payload.
#     `--rgba8` is the older spelling of `--textures rgba8`; passing both when they DISAGREE is an error
```

## Viewers' compare server

```bash
# BEFORE = any game dir (.dff), AFTER = a converted build (.osm); port 3002 (--port)
npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/opensa
```

## Headless field checks (tools-debug/bench-harness)

```bash
SRC=http://localhost:3001/build/original/opensa
# Boot + bench/soak. Env: DPR=2 · TAG='[soak]' · DRAG=<dy>. A screenshot lands at ./<outPrefix>.png in the
# REPO ROOT on exit — delete it before committing, nothing ignores it
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" <outPrefix> <timeoutMs> <expectReports>
# WebGPU boot gate: 'canvas' reports the context type, 'sorry' expects the no-WebGPU screen
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/gate-check.js canvas \
  "http://localhost:5173/?loader=http-dir&src=$SRC" <outPrefix>
# Scripted physics laps (081/01) — TAG switches the protocol the harness collects
TAG='[phys]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&phys=all&car=infernus" phys 900000 7
# Video mode (096/02) — the run ends after <expectReports> scenes have reported, or at the sequence's own end
# ALSO='[cam]' echoes a second protocol without counting it as a report (096/03 reads the jump watchdog)
TAG='[video]' ALSO='[cam]' NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&video=1&seed=47" video 600000 8
# Pick a corner-heavy route to look at first (offline, no boot): scripts/debug/video-routes.ts --worst
#   …then drive THAT street: append &at=<x>,<y> from the line it printed
# Camera-motion diagnosis (096, field round 1) — &diag=1 adds a [diag] line per scene, one row per FRAME;
#   ALSO='[diag]' to collect it, then: npx tsx scripts/debug/video-shiver.ts <harness.log>
# The acceptance exam off the same log: npx tsx scripts/debug/video-accept.ts <harness.log>…
# Is the CHROME out of the shot (096/08)? A DOM probe INSIDE a fragment — the one thing no log can answer.
#   Run the control first (no ?video=), or all-false proves nothing but a wrong selector:
npx tsx scripts/debug/video-chrome.ts "http://localhost:5173/?loader=http-dir&src=$SRC" 90000 --control
npx tsx scripts/debug/video-chrome.ts \
  "http://localhost:5173/?loader=http-dir&src=$SRC&video=1&seed=47&scene=1&scenes=1" 180000
# Do the MOBILE on-screen controls reach the game (055)? Boots with hasTouch and drives the overlay's own
#   pixels; needs `npm run dev` (it reads the dev HUD) and an OPEN spawn — a wall fails a healthy build
npx tsx scripts/debug/touch-controls-check.ts \
  "http://localhost:5173/?loader=http-dir&src=$SRC&hour=12&weather=0&spawn=342,-1803,4.8"
# Speed-grip dials (081/09) — session overrides for the lateral assist; captures record the active values
#   ?gripVd=<m/s>  boost reference speed (default 12)  ·  ?gripCap=<x>  boost ceiling (default 3)
# Surface grip (081/10) — ?surfGrip=0 puts every wheel back on tarmac, the A/B for reading surface.dat
# Dynamic particle probe (089/01) — ?fxprobe=<fxp system, e.g. prt_collisionsmoke> parks a one-shot
#   emitter beside the player (burst 1/fixed step = 60/s); the system must be in DYNAMIC_SYSTEMS
# Tyre smoke dials (089/02) — ?smokeStart=<m/s> ?smokeFull=<m/s> ?smokeRate=<n/wheel/s>
#   equivalent-slide thresholds + spawn rate (defaults 4 / 12 / 6); the fit: docs/hacks/tyre-smoke-intensity-fit.md
# Air control (081/06 §1) — ?airCtl=<x> scales the in-air pitch/roll/yaw authority; 0 = off (the jump A/B)
# CLEO (200) — ON by default since 2026-08-06; ?cleo=0 opts a session out, ?cleo=1 force-enables
#   (census line `[cleo] N script(s)`; atlas misses print as `[cleo] atlas miss:` lines) ·
#   ?osmspike=<model> renders one map-object .osm beside the player (the 04 phase-0 spike hook) ·
#   F2 → CLEO (097/07): runner/trace toggles, thread list with per-tick cost, unimplemented/atlas
#   coverage with tiers, per-thread trace, step-one
# HUD `signs N` — roadsign glyph quads in the cells drawn this frame (.oscell minor 8). The instrument for
#   "do plates survive to LOD range", which a screenshot cannot answer (~8 px at 440 u). 0 on a pre-minor-8
#   pak means UNKNOWN, not none — check the pak manifest's buildTime first (canonical: 13:19 08-08-2026 on)
# Effect draw distance — ?fx=N scales EVERY fx system's shipped distance (its authored cullDist with the
#   recorded departures and the dynamic lane's 300 u floor applied). 1 = as the data says; the debugger's
#   Graphics → EFFECTS DISTANCE slider is the same knob live. A tiny value (?fx=0.02) is the POSITIVE
#   CONTROL a distance capture needs: it culls the emitters, which is the only way a shot can prove the
#   specks in it are particles. Find something to aim at with scripts/debug/fx-anchor-census.ts
# Camera aim (100 field checks) — ?look=x,y,z points the boot camera at a GTA world point and turns the
#   ped with it (auto-centre then holds the aim). Without it every headless probe stares SOUTH, since
#   look is pointer-only and the harness has no mouse. Pair with ?spawn: `?spawn=2033,2832,80&look=2632,2832,127`
# Vehicle field checks (097/05) — ?spawncar=model[,x,y,z[,heading]] spawns one car (retries until the
#   ground streams in; default spot 8 m north of spawn; heading is RADIANS — 0 faces north, the boot
#   camera looks SOUTH, so put a car you want in frame at y − 10) · ?autoseat=1 seats the player once
#   it exists
# Warning catcher (bug rounds) — collects every console warning/error + WebGPU validation message from a
#   live headless run into JSON (deduped, with counts) + screenshot; KEYS holds keys, TAGS echoes info
#   lines like [spawncar]. See tools-debug/bench-harness/README.md
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/warnings.js \
  "http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa&cleo=1&spawn=X,Y,Z" out 30000
# Diff two capture sets (raw harness logs are accepted as-is); --determinism gates a replay check
npx tsx scripts/phys-compare.ts before.log after.log [--determinism]
# The regression pack (081/07): a fresh 5-car sweep against the committed accepted-feel matrix
npx tsx scripts/phys-regression.ts sweep-*.log
```

Guides: [development/benchmarks.md](./development/benchmarks.md) (perf) ·
[development/physics-laps.md](./development/physics-laps.md) (`?phys=` laps).

## ASI plugins (real SA, cross-compiled — needs `brew install mingw-w64`)

```bash
# Build a plugin. Every plugin gets these three via asi/sdk's Makefile fragment.
npm run build:asi    -w @opensa/perfect-map-asi   # shipping: APPLY, both fixes → dist/perfect-map.asi
npm run build:verify -w @opensa/perfect-map-asi   # DRY RUN: patches nothing, logs every site's verdict
npm run build:debug  -w @opensa/perfect-map-asi   # APPLY + verbose site dump + the plugin's own traces
npm run gen          -w @opensa/perfect-map-asi   # catalogue.ts → src/generated/patches.hpp only

# Per-fix bisection (the flags are the plugin's; EXTRA_CXXFLAGS is the SDK's knob)
make -C asi/perfect-map APPLY=1 EXTRA_CXXFLAGS='-DPM_FIX_INT16=1 -DPM_FIX_FX2DFX=0'
# DEBUG=1 without APPLY=1 is refused: every debug switch is read inside an APPLY build.

# Reproducible artifact for an A/B — pin BOTH the PE timestamps (already in the link line) and the
# banner's __DATE__/__TIME__, or two builds a second apart differ:
SOURCE_DATE_EPOCH=315532800 make -C asi/perfect-map clean && \
  SOURCE_DATE_EPOCH=315532800 make -C asi/perfect-map APPLY=1
```

The verdict lives in `perfect-map-asi.log` next to `gta_sa.exe`. **Read its first line before anything
else** — `built <date> <time> (APPLY|verify-only)` is the only thing identifying which artifact the game
actually loaded, and a verify-only build patches nothing.

## Debug & repro

```bash
# Ghost-barriers int16 repro dial (33k rows = buggy, 32k = clean)
npx tsx tools-debug/sa-int16-repro/src/cli.ts --game ./game-src/original --out <dir> --rows 33000

# One-off inspectors (scripts/debug/) — catalog + the triage playbook: docs/debug/README.md
npx tsx scripts/debug/<name>.ts --help

# crossTxd ledger → reviewable PNG fixes per owning mod (the /crosstxd-fix skill; installer plan 009)
npx tsx scripts/crosstxd-fix.ts   # → NO_COMMIT/crossTxdFix/<mod>/gta3_img/<txd>/<texture>.png
```

## Repo chores

```bash
npm test / npm run test:coverage     # vitest (+ coverage floors)
npm run test:fixtures                # real-GTA fixtures + viewer e2e assets (+ the CLEO corpus from mods-src/original)
npm run cleo:opcodes                 # regenerate packages/cleo opcode table from the vendored Sanny sa.json (pin: packages/cleo/vendor/README.md)
npm run build:cleo-scripts           # CLEO authoring SDK: compile cleo/scripts/* to cleo/sdk/dist/*.cs (cleo/sdk plan 001: discovery+report; assembly lands with 002-004)
npm run cleo:whitelist               # regenerate the SDK's dual-target whitelist (real CLEO 4 x VM registry; drift test guards staleness)
npx tsx scripts/debug/scm-disasm.ts <file.cs|dir> [--census|--strings|--json] [--out <dir>]   # disassemble compiled CLEO scripts (097/02)
npx tsx scripts/debug/cleo-census.ts [paths…] [--json]                                        # opcode frequency/coverage table over a CLEO corpus (097/02; status column = VM registry join)
npx tsx scripts/debug/cleo-run.ts <file.cs> [--ticks 60] [--fps 60] [--calls 60]              # run a CLEO script headless on the VM, print the host-call trace (097/02+03)
npx tsx scripts/debug/cleo-trace-fixtures.ts                                                  # regenerate the corpus trace snapshots (tests/custom/cleo-traces/, 097/07; review the diff — it IS the change)
npm run e2e / e2e:ui / e2e:update    # playwright
npm run lint / format                # tsc --noEmit + eslint / prettier+eslint --fix
npm run arch / arch:render           # package graph to stdout / regenerate docs/architecture/assets
npm run build:game:original:opensa   # pmb (--exclude sa) + fetch-pack → the opensa game dir + the fetch build (also :gostown :carcer :anderius)
npm run build:game:original:sa       # pmb (--exclude vehicles,peds,opensa) → the real-game sa/ target only
npx tsx tools/fetch-pack/src/cli.ts     # fetch build standalone (chained in build:game:*; --build ./build/<id>; --out ./static/games stages a local fetch test)
                                        #   expands models/*.img into bare-named entries (fetch mode cannot open a container), prunes chunks a re-pack replaced, skips *.bak/.DS_Store
npm run timecyc                      # precompute timecyc data
```
