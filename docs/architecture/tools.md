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
  `carcols.dat` / `carmods.dat`.
- **ped-installer** — ped mod folders → `gta3.img` + merged `peds.ide`.
- **map-optimizer** — lossless DFF/TXD conditioning (smooth-group normals, prelit sync, dedupe, mips) that
  yields a drop-in game dir; refuses geometry it can't provably remap. Lib `src/run.ts`.
- **lod-trees-generator** — tree LOD impostors: crossed billboard cards + a baked DXT5 alpha atlas, placed
  via the IPL lod-index.
- **lod-procobj-generator** — converts procobj scatter species into static IPL instances with decimated
  LODs (own IDE ids, `plo*` aliases to dodge SA's big-building path).
- **sa-lod-generator** — regenerates per-object LODs as HD clones (geometry clone + empty COL + halved
  textures) for the **real game** target.
- **opensa-lod-generator** — the OpenSA cell-LOD bake: merge per 256-cell → budgeted QEM decimate →
  per-cell TXD; output is not tuned for the real-SA streamer (uncapped).
- **opensa-pack** — game-ready dir → native build (`.osm` per model inside the IMGs + the `opensa/` pak);
  see [perfect-map-builder.md](./perfect-map-builder.md#opensa-pack-the-pack-stage-also-standalone).

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
  mips) used by every tool that rewrites DFF/TXD bytes.
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

- **perfect-map** — the in-game (real SA) limit-adjuster ASI lifting the int16 building-pool ceiling; C++
  sidecar, not part of the web build.
