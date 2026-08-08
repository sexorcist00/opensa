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
neither touches the other's directory (the builder only clears `<out>/.work`). Standalone:

```bash
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src --exclude sa
```

Params: `--out <dir>` (default `./build/original`) · `--until <mods|vehicles|peds|optimize|trees|procobj|sa|opensa|pack|lod>`
(inclusive, keeps `.work/`) · **`--exclude <stage,stage>`** · `--keep-work` · `--no-weld-seams` ·
`--no-textures` · `--allow-text-row-overflow` · **`--bake-collision`** (write every cell's collision into the
pak — plan 200/3-01; off by default, and the same tree built with and without it is the A/B the claim is read
on: the runtime reads a bake when the pak has one and parses COL when it does not).

`--exclude` is the TARGET directive where `--until` is the stop point: it drops the named stages and keeps
everything after them (repeatable, comma-separated, same names as `--until` minus the `lod` alias; an unknown
name is an error, never a silent skip). Excluding `opensa` drops `pack` with it; excluding `pack` alone leaves
`opensa/` in GAME format; excluding `sa` also drops its `checkImgIdBudgets` guard, which reads the `sa/` tree.
**`:sa` builds no mod vehicles or peds** — that is what `--exclude vehicles,peds` means.

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
`all` converts the roster — hours on a phone), `DISTRICT=` picks the measurement district — its rect, its
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

# Procobj → static IPL + LODs
npx tsx tools/lod-procobj-generator/src/cli.ts --in ./mods-src/procobj --game <dir> --out <dir> --prelight --tex 128

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
