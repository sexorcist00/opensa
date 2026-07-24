# Changelog

## 0.4.0

**Replaced the three.js renderer with our own WebGPU engine.** The `three` dependency is gone entirely
(plan [074](docs/plans/074-opensa-engine/readme.md)). At identical content the app got **both faster and
smaller**: a **~7× runtime speed-up** (city scenes went from 16–24 fps on three.js to a locked 120 fps) and a
**−12.8 % gzip bundle** despite the engine being a large body of added code. Full numbers +
reproduction: [`docs/audit/three-to-own-engine.md`](docs/audit/three-to-own-engine.md).

### Own file formats

The migration is built on a family of native, GPU-shaped formats (`packages/engine-formats`) — the runtime
"codec" is a header parse + `writeBuffer`/`writeTexture`, so all the offline work is done offline instead of
in a runtime costume:

- **`.osm`** — one MODEL, in named sections (`DESC`/`GEOM`/`TEXS`/`COLL`/`HULL`/`SHAT`/`SKEL`). Covers assets
  the runtime resolves BY NAME: vehicles, peds, clutter, breakables, animated objects. Each consumer reads
  only its own byte range (collision without touching geometry; nothing parsed twice).
- **`.oscell`** — one streamed world cell (HD or LOD) in the final GPU vertex layout (interleaved 36 B stride
  with baked day/night prelight, sun-visibility and wind-sway channels). Uploads verbatim.
- **`.ostex`** — one `texture2d_array` with the full mip chain baked offline (premultiplied alpha, 256-byte
  aligned rows) — the runtime never generates mips.
- **`.ospak`** — the archive: a JSON manifest + one 4 KiB-aligned binary pak, read by RANGE only (Cache API /
  HTTP Range, never whole in JS); FNV-1a entry hashes keep converter re-runs and delivery incremental.
- **`.oswire`** — meshopt-compressed transport wrapper for `.oscell` payloads; the pak worker rebuilds the
  exact `.oscell` bytes, so the engine never learns wire encodings exist.
- **`water.bin`** — baked water grid (per-vertex shore-distance + depth field) driving the animated shoreline.

### Engine

- **Own WebGPU renderer** — sky/fog/night/weather, dynamic vehicle + ped lighting, water, godrays, local
  lights, particles, shadows — no three.js, no WebGL fallback path.
- **Runtime-resolved animation** — IFP clips are parsed by name at runtime (`IfpSampler`), never baked into
  the model; adding animations needs no rebuild and does not grow a ped's `.osm`.

## 0.3.0 (2026-07-06)

### Engine (brief, since the Nx migration)

- **Nx monorepo** — the engine split into workspace packages (`renderware`, `game`, `loaders`, `vfs`,
  `viewer`, `web`, `modloader`) + the `tools/` workspace for the pipeline above.
- **Streaming smoothness** — DFF parsing moved to a **worker**, cells are GPU-warmed invisibly and appear
  **atomically** (no more objects assembling on screen); worst frame slices went from ~65–81 ms to ~5–7 ms.
- **World-ready state** — a `streaming` game state freezes the clock/physics behind an opaque loading veil
  (`Loading world… N/M`) on boot and far teleports, revealing only a fully settled world.
- **Fully-open world** — script-gated placement groups are a configured world state (Truth's farm on,
  unlock roadblocks off) instead of leftovers, in parity with the LOD bake.
- **Two-sided world rendering** — honors SA's disable-backface-culling material flag (fixes see-through
  walls/holes on single-sided geometry).
- **Map-baked parked cars** — the binary IPL `CARS` section and CLEO car-generator scripts both feed the
  parked-vehicle spawner.

### Tooling

#### Mod / content installers

- **`mod-installer`** — bakes a numbered Modloader-style mod set into the game copy: file overlays,
  `gta3_img/`/`gta_int_img/` IMG merges, PNG→TXD folders, a **`.merge` data-edit format** (`remove from
"objs":` / `add to "anim":` line edits instead of whole-file overrides), loader-path re-homing, IDE id
  dedupe, and **IPL slot economy** (mod-added instance IPLs fold into a stock host file; internal LOD links
  rebased) so mods never eat SA's 40 IPL slots.
- **`vehicle-installer` / `ped-installer`** — drop-in vehicle packs and ped replacements as pipeline stages.
- **`map-optimizer`** — whole-map **prelight correction**: statistical day/night vertex-colour repair with
  per-neighbourhood verdicts (fixes stock and mod models that are too bright/black at night).

#### Vegetation LOD generators

- **`lod-trees-generator`** — billboard impostors as real far-LODs for every placed tree: baked from the HD
  models (aspect-aware textures, stock prelight + night-colour transfer), attached by editing the stock
  streams/IPLs (repoint or append + link), with a per-area row budget that migrates overflow into its own
  streamed areas.
- **`lod-procobj-generator`** — converts procobj scatter species (bushes, rocks) into **static placements
  with decimated-copy LODs**: QEM-decimated meshes, per-species scoped textures, trunk prelight transfer,
  and the runtime scatter stripped for converted species.
- **Vanilla-style binary-stream placement** (shared `@opensa/map-placement`) — generated placements ship as
  per-area text LOD layers + binary `_stream` IPLs inside `gta3.img`, exactly how the stock map ships 35k+
  instances; short species ship fully binary (zero permanent rows), only tall species keep a text LOD row +
  lod-link for close-range suppression (`linkedHeight`).
- **Scoped texture resolution** (`lod-common`) — LOD textures resolve through each model's own TXD and land
  in shared dictionaries under `<txd>_<name>` scoped names (SA reuses texture names across TXDs with
  different pixels — the global index used to paint the wrong species), plus **alpha-weighted mip
  downsampling** (`rw-codec`) so cutout foliage keeps its silhouette colour.
- **Script-gated group parity** (`opensa-lod-generator`) — the cell bake now includes exactly the binary IPL
  groups the engine loads (`OPEN_SCRIPT_IPL`, single source of truth): mission-locked props (bridge
  roadblocks) no longer get painted into the far LODs.

#### LOD generator

**Added**

- **Visibility-first simplification** (`@opensa/lod-common` shared core, used by `opensa-lod-generator` cell
  bakes and `sa-lod-generator` per-object clones): screen-size / degenerate / transparent-group culls, sampled
  **visibility culling** (deterministic camera raycasts; per-face sidedness, windings never flipped,
  see-through textures don't occlude rays), coplanar remesh with byte-exact boundaries, and **budget-checked
  QEM decimation** — every cell/model proves its own reduction with a render diff or stays verbatim.
- **Measurement harness** — a deterministic CPU rasterizer + pixel diff renders every simplification stage
  against the HD reference from independent cameras: every knob is tuned by number, not by eye; the same
  self-check gates the decimation.
- **LOD texture packaging** — one shared `lods.txd` for all OpenSA cell LODs; SA clone TXDs at 0.25 scale
  (32 px floor) partitioned into a native `txdp` **parent dictionary** (`salodpar.txd` + slim children).
- **Distant night city** — cell LODs carry the source models' 2dfx corona lights (street lamps, casino glow),
  and hour-gated `tobj` objects render correctly at LOD range (lit windows no longer glow at noon).

**Changed**

- **Ground-truth LOD classification** — the cell resolver and the old-LOD strip use the IPL `lod` index
  (per instance) instead of name matching, eliminating coplanar double surfaces (map-wide z-fighting) from
  renamed/underscored LOD twins.
- Engine streaming cell size aligned to the generator grid (250 → 256).

**Effect** (vs the previous verbatim LOD builds, measured on an unmodified map)

- Geometry: **−23 % triangles / −43 % encoded indices** at ≈ 0.2 % mean visual diff.
- Textures: **−82 %** for OpenSA cells (~88 MB → 16 MB) and **−91 %** for SA clones (114.8 MB → 10.4 MB).
- Plus distant corona lights the stock far view never had, correct day/night `tobj` windows, and LOD
  z-fighting cleaned up at its source.

#### Perfect-map builder (new)

- **`perfect-map-builder`** — one command turns a clean game copy + a curated `mods-src/` into two complete
  builds: **`sa/`** (drop-in for the real game) and **`opensa/`** (engine target with baked cell LODs). It
  chains every map tool as pipeline stages (mods → vehicles → peds → optimize → trees → procobj → sa/opensa),
  each stage producing a full bootable game dir (`--until <stage>` keeps intermediates for in-game bisection).
- **SA-limit guards baked into the build** — the pipeline fails loudly (instead of corrupting the game
  silently) when the output exceeds stock SA 1.0 placement limits: ≤ 4096 rows per area at boot, ≤ 39 text
  IPLs with instances, **≤ 30,000 permanent text instances map-wide** (SA stores building-pool indexes as
  `int16` — the "ghost barriers" corruption, bisected in-game to exactly 32,768; see
  `docs/open-issues/ghost-barriers.md` for the full post-mortem).

## 0.2.0 (2026-06-23)

### Added

- **Multi-game runtime catalogue** — `GAME_CONFIG` (`src/game-config.tsx`) replaces the single-game `.env`
  setup: the menu lists every game and you pick one at runtime, each with its own loader, world/player setup,
  parked vehicles, teleports, and a disclaimer remembered per game.
- **Pluggable asset loaders** — a `fetch` loader (download content-hashed chunk archives) and a new **local
  raw-install loader**: point the app at your own GTA install folder via the File System Access API; nothing
  is uploaded, files are read locally in the browser (bring-your-own-files).
- **Locked / anti-rip model support** — recover protected (encrypted) DFF/TXD so community mod models load.
- **Mobile / touch controls** — on-screen move & look joysticks, jump, and pinch-zoom.
- **Branding** — new OpenSA logo, a full favicon set + web manifest, and a social-share (`og.jpg`) image.

### Changed

- **Repositioned as a RenderWare-compatible game engine** — README, blog, docs, package metadata and the
  in-app tagline now lead with the engine (compatible with RenderWare; runs GTA San Andreas and its mods)
  rather than "GTA San Andreas in the browser".
- **Boot flow is menu-first** — nothing downloads until a game is picked; a single loading screen pulls all
  groups; removed the eager pre-menu core download and the first-visit intro animation.
- **Cache management reworked** — per-build-version Cache Storage with a fallback strategy; a revoked build
  (a missing `data` probe **or** `manifest.json`) wipes the client cache.
- **Unified player spawn** — a single `playerSpawn` per game seeds both the capsule and the initial collision
  zone.
- **Input refactored** into pluggable sources (keyboard / pointer / touch).
- **Debugger** — the Position tab (live coords + city) is always available; teleport lists are per-game.

### Fixed

- Custom-ped **root-bone offset** — peds whose `Root` frame is authored off-origin (some mods) no longer
  render off-centre or orbit the pivot when turning.
- Character **material issues** and animation retargeting on custom / renamed-skeleton models.

### Removed

- **All bundled game assets** — dropped the committed player model and other assets; the project ships **no
  game files**, you supply your own copy. Test fixtures use local, gitignored real assets.

### Legal & safety

- Added a **Legal & takedowns** section (README) and an in-app disclaimer with a rights-holder contact.

## 0.1.0 (2026-06-18)

### Added

- **Engine / renderer** — from-scratch RenderWare pipeline: DFF (models) and TXD (textures) parsers, COL
  collision, IMG archive reader, and IPL/IDE world streaming with LOD swap, frustum culling, and fog-tied
  draw distance.
- **Physics & player** — Rapier-backed player controller (walk / run / jump, grounded state), follow camera
  with mouse look, and a K+M free-fly screenshot camera.
- **Character** — skinned ped with `ped.ifp` animations driven by a movement state machine.
- **Vehicles** — loader with embedded collision, full dummy framework (doors / headlights / seats), enter &
  exit with door animation, physics + basic controls, damage (ramming + struck), VLO, and car2/car4 carcols.
- **World content** — water surface + shader, game time and timecyc (sunny, normalized to 24h), weather
  manager with `map.zon` zone detection, districts via `info.zon` + GXT, teleports, animated map objects
  (UV + DFF), procedural ground clutter (procobj), road-sign text (2dfx), basic world effects, particles,
  and breakable objects, night-time objects (tobj), and vehicle headlights + reflections.
- **Graphics** — lighting, shadows, sky/skybox with volumetric clouds, fog, god rays, bloom, SSAO, and ACES
  tone mapping.
- **Build & delivery** — game-build archives split into priority / models / textures, repacked into ~50 MB
  content-hashed chunks; an asset **loader** (on-demand download, Cache Storage caching, invalidation,
  progress events) and a **Virtual File System** (unzip + serve) that the game reads everything through.
- **UI shell** — instant-loading React shell with a branded intro animation, menu, disclaimer, error/retry,
  Esc pause menu, lazy-loaded game, an in-game F2 tip, fullscreen + mouse capture (pointer lock), and opt-in
  analytics.
- **Tooling** — F2 in-game debugger (map viewer, spawn / flip / teleport, live tuning), standalone
  object/vehicle/character viewers, a logger, and offline debug scripts.
- **Project** — docs (getting-started, dev docs, per-feature reference), a repo blog, and contribution guide.

### Changed

- Renamed the project to **OpenSA**.
- Assets are sourced from `game-src/<game>/` and shipped as built archives under `static/`; at runtime the
  game reads from the VFS instead of fetching loose files.

### Fixed

- Truth's Farm (Countryside) rendering.
- Vehicle windscreen alpha-channel bug.
- Water flooding tunnels across the map.
- Shadow acne on small objects.
- Streaming "blinking" during LOD <-> HD swaps.
