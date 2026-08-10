# Tools

One-paragraph architecture of everything under `tools/` and `tools-debug/`. All tools are offline Node CLIs
(`src/cli.ts` unless noted) exposing a library entry the pipeline calls; they may read engine packages but
never the app. The dependency picture is the tools cluster of
[assets/packages.svg](./assets/packages.svg).

## Pipeline stages (chained by [perfect-map-builder](./perfect-map-builder.md))

- **perfect-map-builder** — the orchestrator; `buildPerfectMap` in `src/pipeline.ts` chains every stage,
  guards SA runtime ceilings, and splits into the `sa/` (RenderWare) + `opensa/` (native pak) targets.
- **mod-installer** — layers GTA-SA mod folders onto a base game: plain file overlays plus a Modloader
  `loader.txt` bake into `gta.dat`/`gta3.img`; cumulative, alphabetical. Lib `src/install.ts`.
- **vehicle-installer** — vehicle mod folders → `gta3.img` + merged `handling.cfg` / `vehicles.ide` /
  `carcols.dat` / `carmods.dat`. A mod's settings file is decoded by its own encoding (UTF-16 is what most
  authors ship) and every block it cannot classify is reported. A mod's `features.txt` (Modloader/IVF) is
  copied into `data/vehicle-features.txt`, which opensa-pack reads while baking that car. It also writes
  `data/vehicle-mods.txt`, the mod-car ledger (096/06): once the rows are merged, a mod car is
  indistinguishable from a stock one anywhere downstream, so the set the installer knows while it works is
  written down — the ONE vehicle data file read at runtime, and a SWITCH: name one drivable slot and every video-mode
  scene drives a mod car, name none and every scene takes a stock one. A
  `--rebake` merges into it rather than rewriting it from its own selection.
  **`--rebake <game>`** runs the same work against a game that is ALREADY BUILT, in place — merging settings
  into the built `data/*` and re-converting each model into the archive's `<model>.osm` through opensa-pack's
  own `buildVehicleOsm`. It is the one place a tool reaches ACROSS the pipeline (installer → converter) and it
  exists because a vehicle round is otherwise a full build to see one row: one car 3.6 s, twelve 26 s. It can
  add a car too, on the id the mod declares for itself
  ([plan 006](../../tools/vehicle-installer/docs/plans/006-rebake.md)).
- **ped-installer** — ped mod folders → `gta3.img` + merged `peds.ide`.
- **map-optimizer** — lossless DFF/TXD conditioning (smooth-group normals, prelit sync, dedupe, mips) that
  yields a drop-in game dir; refuses geometry it can't provably remap. Lib `src/run.ts`.
- **lod-trees-generator** — tree LOD impostors: crossed billboard cards + a baked DXT5 alpha atlas, placed
  via the IPL lod-index.
- **sa-procobj-placement** — converts procobj scatter species into static IPL instances with decimated
  LODs (own IDE ids, `plo*` aliases to dodge SA's big-building path).
- **sa-lod-generator** — regenerates per-object LODs as HD clones (geometry clone + empty COL + halved
  textures) for the **real game** target.
- **opensa-lod-generator** — the OpenSA cell-LOD bake: merge per 250-cell (= the render grid, plan 087) → budgeted QEM decimate →
  per-cell TXD; output is not tuned for the real-SA streamer (uncapped).
- **opensa-pack** — game-ready dir → native build (`.osm` per model inside the IMGs + the `opensa/` pak);
  see [perfect-map-builder.md](./perfect-map-builder.md#opensa-pack-the-pack-stage-also-standalone).
- **fetch-pack** — the build finisher (plan 086): re-homes a build into the fetch-serveable
  `build/<id>/opensa-pack/<game>-<version>/` layout the fetch-mode loader streams by range. Chained after the
  pack in every `build:game:<id>:opensa`; see
  [perfect-map-builder.md](./perfect-map-builder.md).
  **It EXPANDS `models/*.img` into their entries under bare names** rather than packing the archives as
  files — the fetch loader pushes chunk bytes into the VFS verbatim and has no archive step, so a packed
  container is one opaque key and every name inside it is unreachable (`expand-img.ts`). Entry precedence is
  the local loader's: `gta3.img`, then `gta_int.img`, then the rest alphabetically, first owner winning.
  **Every packed name is LOWERCASED** (the read keeps the on-disk spelling), matching the local loader — a
  TC is free to ship `data/maps/Gostown6/Gp_City.IPL` and the runtime asks for it lowercased.
  A parity test (`loader-parity.test.ts`) pins both rules against the local loader's own selection.
  It also **prunes the chunks a re-pack replaced** — chunk names carry a content hash, so old files would
  otherwise pile up in the deploy dir — and skips `*.bak` / `.DS_Store`.

## Standalone tools

- **vehicle-optimizer** — loose-DFF vehicle conditioning: uniform scale (+ ground lift) and
  reflection-strength transfer from a prototype.
- **timecyc-builder** — precomputes the time-of-day colour cycle data consumed by the engine (entry
  `src/index.ts`; `npm run timecyc`).

## Libraries (no CLI)

- **lod-common** — the shared HD→LOD mesh pipeline: `MeshBuilder`, budgeted QEM decimation with UV-drift
  guards, smooth-normal rebuild, RW DFF/TXD/COL encoders, prelight transfer.
- **map-placement** — shared SA map-placement workflows: object-id allocation inside the stock id gap,
  IDE/`gta.dat` editing, streamed-area budgeting, procobj scatter conversion, the tree-model roster.
- **rw-codec** — pure byte-level RenderWare codec (chunk walker, geometry struct, DXT, texture natives,
  mips, typed 2dfx payloads) used by every tool that rewrites DFF/TXD bytes.
- **tool-kit** — shared building blocks: CLI arg helpers, smooth-group normals, QEM simplify, editable IMG
  archive, `copyGameDir`/`guardOut`.

## tools-debug/ (investigation harnesses, not shipped)

- **bench-harness** — the headless field-check rig: boots the real game via
  `?loader=http-dir&src=<served build>` under Playwright WebGPU; bench sweeps (`?bench=all`), soak runs,
  boot-gate screenshots. Guide: [docs/development/benchmarks.md](../development/benchmarks.md).
- **sa-int16-repro** — the ghost-barriers dial: inflates a built game dir's permanent text-IPL rows across
  2^15 to reproduce SA's int16 building-pool truncation; the pass/fail oracle for the `asi/perfect-map`
  limit-adjuster.

## asi/

The root category for `.asi` plugins that patch the real SA exe: an SDK plus its consumers, mirroring
`cleo/`'s sdk-plus-scripts split. C++ sidecars, not part of the web build.

- **sdk** (`@opensa/asi-sdk`) — the common base every plugin builds on: the `asi::` C++ framework (exe
  fingerprint gate read from disk, byte-verify, adjuster coexistence, hook shapes, logging, the
  reopen-append runtime logger, `VerifySitesOrDefer`), the catalogue codegen library (`gen/`, emitting a
  plugin's generated header) and the MinGW-w64 build rules (`mk/asi-plugin.mk`). A plugin supplies only its
  catalogue, its payloads, its config knobs and a thin Makefile.
  [`asi/sdk/docs/`](../../asi/sdk/docs/architecture.md) — chain 001–005.
- **perfect-map** — the first consumer: the limit-adjuster ASI lifting the int16 building-pool ceiling and
  guarding the 2dfx fx-system use-after-free.
