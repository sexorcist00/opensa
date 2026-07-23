# 086 — one build, consistent names, pak-based fetch

**Goal (user, 2026-07-23):** the pmb build is THE build for every surface. Consistent naming across the
three roots — `game-src/<id>` · `mods-src/<id>` · `build/<id>` — with `<id>` doubling as the fetch game
id. The legacy `build-game.ts` chunker (raw-game partitioning) dies; a thin FINISHING tool packs the
pmb output into content-hashed chunks for the fetch loader, so both modes ship from one build:

```
game-src/<id> + mods-src/<id>  →  pmb  →  build/<id>/{sa,opensa}  →  fetch-pack  →  static/games/…
                                              ↑ local play (http-dir / folder)        ↑ hosted fetch
```

Game ids: `original` (stock SA; renamed from `non-modified`) · `gostown` (demo) · `carcer` · `anderius`
(test TCs). `original-extend` is deleted (npm script only — never in the UI's `GameId`).

## Facts established before this plan (2026-07-23 audit)

- The fetch loader is LIVE and must stay: `use-asset-boot.ts` fetches
  `games/<game>-<APP_VERSION>/manifest.json`, `asset-fetch-loader` downloads content-hashed zip chunks
  with cache-store + invalidation. Its chunk CONTENT is the raw game — which the own engine no longer
  consumes; repacking the PAK OUTPUT into the same chunk shape keeps the client mostly intact.
- No model-name hardcode blocks TC games: pmb/map-optimizer/opensa-pack/opensa-lod-generator are
  data-driven (gta.dat/IDE/IPL of the actual build; sway by IDE flags; `peds.ide` missing → stage
  skips; `vehicles.ide` missing → loud throw, but every TC has one). The ONE curated list is
  `sa-lod-generator/src/lod.config.ts` `holeFillModels` (~30 SA names) — harmless elsewhere
  (skip-with-warning) but belongs in per-game data.
- `mods-src/` is already restructured by the user: `mods-src/{non-modified→original,gostown,carcer,anderius}`,
  each the pmb `--in` root (`mods/`, `vehicles/`, `peds/`, `vegetation/`, `lod-exclude.json`,
  `broken-prelight.json`); the TC folders are near-empty and that is a valid pmb input.
- `scripts/lib/game.ts` `gameArg()` already DEFAULTS to `original` — broken today (no such folder); the
  rename fixes every dev script's default.
- `timecyc` stays as-is (own command, out of scope by user decision).

## Phase 0 — the rename + the full audit (DONE 2026-07-23, `cd14e4b`)

Filesystem (both roots are gitignored user data): `mv game-src/non-modified game-src/original`,
`mv build/perfect build/original`, `mv mods-src/non-modified mods-src/original`.

Repo sweep — every reference goes, none survive (user's explicit bar: "ПОЛНЫЙ аудит кода, тестов, всей
документации"), historical plan texts included (git history remains the true record):

- code/test defaults: `scripts/test-fixtures.ts`, `scripts/build-viewer-assets.ts`, debug scripts'
  `--game` docs, `dump-cell.ts`/`crosstxd-fix.ts` pak defaults, pmb default `--out` (→
  `./build/original`), tools' readmes/tests that spell either path, `apps/engine-lab` +
  `packages/loaders` test paths, `serve-static` docs;
- docs: `commands.md`, `debug/README.md`, `development/`, `benchmarks/` (schema + rows keep saying
  WHICH pak build a run read — reword to the new name with an "(ex build/perfect)" note in the
  benchmarks README so old rows stay interpretable), `architecture/`, `features/`, `plans/`;
- skills: `/crosstxd-fix` (modsDir default → `mods-src/original/mods`), `/renumber-mods` (path →
  `mods-src/original/mods`);
- memory: canonical-build-folders + roadmap + harness notes (AFTER=`./build/original/opensa`,
  BEFORE=`./game-src/original`).

Verify: repo-wide grep for `non-modified` and `build/perfect` returns nothing (outside git history);
lint + unit tests green; one smoke boot via `?loader=http-dir&src=…/build/original/opensa`.

## Phase 1 — opensa-pack manifest identity (DONE 2026-07-23)

`manifest.json` (the pak one) gains `game` (= the `--game` folder's basename — after phase 0 the
folder name IS the id, no mapping table) and `appVersion` (root `package.json` version, read
module-relative so cwd never matters; omitted outside the repo). Stamped in `packGameDir` beside
`buildTime` (the deterministic `buildOspak` core untouched). pmb passes `gameId =
basename(--game)` explicitly — its own `gameDir` at the pack stage is a work intermediate;
standalone runs take `--game-id` (default: basename of `--game`). Old readers ignore the fields.

## Phase 2 — the finishing tool (fetch-pack)

New `scripts/fetch-pack.ts` (or `tools/fetch-pack` if it grows): input = a pmb `--out`'s `opensa/`
dir, output = `static/games/<game>-<version>/` with content-hashed chunks + the fetch manifest.
Reuses `scripts/game-build/chunk.ts` (`chunkByHash`); ALL raw-game partitioning (IDE/IPL parsing,
exterior/interior split, gta3.img reading) is deleted with `build-game.ts`. Open question resolved
here: the chunk GROUPS for a pak build (e.g. `world` = world.ospak+cells manifest, `models` = .osm/.ostex
archives, `rest` = data/anim/text) — pick what makes the boot progress bar honest and a dropped
download cheap.

## Phase 3 — the fetch client boots the pak

`use-asset-boot.ts` + `asset-fetch-loader`: after chunks unpack into the VFS, boot through the pak
path (the folder-mode reader of 079) instead of the dead raw-game path. Version/invalidation: keep
the `<game>-<version>` URL scheme for now (matches `__APP_VERSION__`), entry-hash-level reuse is a
later refinement. First task of the phase: establish whether fetch boot works AT ALL today post-flip
(suspected broken since the three removal) — that decides how much is rewrite vs repair.

## Phase 4 — npm aliases + TC trial runs

```
build:game:original  = pmb --game ./game-src/original  --in ./mods-src/original  --out ./build/original
build:game:gostown   = pmb --game ./game-src/gostown   --in ./mods-src/gostown   --out ./build/gostown
build:game:carcer    = pmb --game ./game-src/carcer    --in ./mods-src/carcer    --out ./build/carcer
build:game:anderius  = pmb --game ./game-src/anderius  --in ./mods-src/anderius  --out ./build/anderius
(+ NODE_OPTIONS=--max-old-space-size=12288; original-extend deleted; each then runs fetch-pack)
```

Trial runs for the three TCs go `--until pack` first (the `lod` stage waits until the base passes).
Failures are triaged loudly per the 085 rule — a swallowed error is a hole in the world.

## Phase 5 — per-game LOD hole list (DONE 2026-07-23)

`sa-lod-generator` `holeFillModels` moved from `lod.config.ts` (default now empty — a TC must not
inherit SA's list) to `mods-src/<id>/lod-holes.json`, loaded by pmb like `lod-exclude.json`
(`loadLodHoles`, `--in` root or its `mods/`); standalone runs pass `--holes <json>`. `original`
carries the 28 curated names; the TC folders none.

## Phase 6 — viewer fixtures rename (DONE 2026-07-23)

`scripts/build-viewer-assets.ts` → `scripts/test-viewer-fixtures.ts` (it only builds e2e fixtures;
the name says so now). `test:fixtures` chain + every reference updated; paths point at
`game-src/original` since phase 0.

## Order & risk

0 → 1 → 2 → 3 → 4 → 5/6 (5 and 6 are independent). Phase 0 is wide but mechanical and unblocks
everything; phase 3 carries the unknown (state of the current fetch boot); phase 4 carries the TC
risk (unproven pipelines — but loud).
