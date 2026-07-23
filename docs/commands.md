# Commands cheat sheet

The everyday commands with all their params, in one place. Canonical folders:
**source game** `./game-src/original` · **mods** `./mods-src` · **canonical build** `./build/original`
(see [architecture/perfect-map-builder.md](./architecture/perfect-map-builder.md)).
Rule (also in `CLAUDE.md`): when a command or param is added/changed, update this file.

## The one build

```bash
# Full perfect-map build → ./build/original (sa/ + opensa/ targets)
NODE_OPTIONS=--max-old-space-size=12288 npx tsx tools/perfect-map-builder/src/cli.ts \
  --game ./game-src/original --in ./mods-src
```

Params: `--out <dir>` (default `./build/original`) · `--until <mods|vehicles|peds|optimize|trees|procobj|sa|opensa|pack|lod>`
(inclusive, keeps `.work/`) · `--keep-work` · `--no-weld-seams` · `--no-textures` · `--allow-text-row-overflow`.

## Serving & running

```bash
npm run dev                 # Vite dev server → http://localhost:5173
npm run serve:static        # static origin :3001 — mounts /build (Range + /__index), static/ archives
```

| Surface                  | URL                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Game on the served build | `http://localhost:5173/?loader=http-dir&src=http://localhost:3001/build/original/opensa`                            |
| Bench sweep (8 scenes)   | `http://localhost:5173/?bench=all` (one scene: `?bench=country-dusk`)                                              |
| Soak (minutes)           | `http://localhost:5173/?soak=30`                                                                                   |
| Lab                      | `npx vite --config apps/engine-lab/vite.config.ts` → `http://localhost:4300/`                                      |
| Lab: streaming LS        | `http://localhost:4300/?pak=1&src=http://localhost:3001/build/original/opensa&at=2495,-1687,13&orbit=300&draw=1500` |
| Lab: vehicle probe       | `http://localhost:4300/?pak=1&stream=1&src=…&vehicle=1&vmodel=vehicle-comet&at=2495,-1675,13.3&orbit=26&hour=12`   |
| Viewers                  | `npm run dev` → `http://localhost:5173/viewer.html?tab=<object,vehicle,character,compare>`                         |

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

# OpenSA cell LODs
npx tsx tools/opensa-lod-generator/src/cli.ts --game <dir> --out <dir> --cell 256

# Real-SA per-object LOD clones
NODE_OPTIONS=--max-old-space-size=8192 npx tsx tools/sa-lod-generator/src/cli.ts --game <dir> --out <dir>

# Game dir → native pak (the pack stage standalone)
NODE_OPTIONS=--max-old-space-size=12288 \
  npx tsx tools/opensa-pack/src/cli.ts --game <dir> --out <dir> --rect x0,y0,x1,y1 --in ./mods-src
#   [--no-ao] [--bakes --clouds mods-src/clouds] [--no-models] [--bake-workers N] [--stochastic <file…>]
```

## Viewers' compare server

```bash
# BEFORE = any game dir (.dff), AFTER = a converted build (.osm); port 3002 (--port)
npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/opensa
```

## Headless field checks (tools-debug/bench-harness)

```bash
SRC=http://localhost:3001/build/original/opensa
# Boot + bench/soak, screenshots on exit. Env: DPR=2 · TAG='[soak]' · DRAG=<dy>
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/drive.js \
  "http://localhost:5173/?loader=http-dir&src=$SRC&bench=all" <outPrefix> <timeoutMs> <expectReports>
# WebGPU boot gate: 'canvas' reports the context type, 'sorry' expects the no-WebGPU screen
NODE_PATH=$PWD/node_modules node tools-debug/bench-harness/gate-check.js canvas \
  "http://localhost:5173/?loader=http-dir&src=$SRC" <outPrefix>
```

Guide: [development/benchmarks.md](./development/benchmarks.md).

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
npm run test:fixtures                # real-GTA fixtures + viewer e2e assets
npm run e2e / e2e:ui / e2e:update    # playwright
npm run lint / format                # tsc --noEmit + eslint / prettier+eslint --fix
npm run arch / arch:render           # package graph to stdout / regenerate docs/architecture/assets
npm run build:game:original          # static chunk archives for the fetch loader (also :gostown …)
npm run timecyc                      # precompute timecyc data
```
