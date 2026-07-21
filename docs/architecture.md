# Architecture

A high-level map of OpenSA. Two levels: the **modules** and how they depend on each other, then a
**detailed** look inside them, plus the **boot** and **build** flows. Details are intentionally trimmed for
readability — see [docs/features/](./features/) and [docs/plans/](./plans/) for specifics.

## Repository layout

OpenSA is an **Nx + npm-workspaces monorepo** (see [plan 057](./plans/057-nx-monorepo-migration.md)). The modules
below map one-to-one to workspace packages; every package keeps only `package.json` (+ `readme`/`docs`) at its
root and **all code lives in `<pkg>/src/`**. Cross-package imports go through the `@opensa/*` package name
(subpath `exports` → `.ts`, no build step), never deep relative paths.

```
apps/
  web/      @opensa/web      React shell + game surface + game-config + controls-harness  (tag type:app)
  viewer/   @opensa/viewer   standalone object/vehicle/character/compare viewers — tabs in /viewer.html  (type:app)
packages/                    (tag type:engine)
  engine/      @opensa/engine       the WebGPU renderer — device/pipelines, frame graph, world cells (074/01)
  engine-formats/ @opensa/engine-formats  native .oscell/.ostex/.ospak layouts, shared with the converter
  math/        @opensa/math         dependency-free 3D math (the three surface we used, three-compatible)
  renderware/  @opensa/renderware   parsers (DFF/TXD/COL, IDE/IPL/DAT/GXT) + archive + map + mesh preparation
  game/        @opensa/game         ECS, systems, adapters — renderer-agnostic
  modloader/   @opensa/modloader    modloader/ overlay over AssetFileSystem
  loaders/     @opensa/loaders      asset-loader (fetch/local/http-dir) — framework-agnostic
  vfs/         @opensa/vfs          unzip → AssetFileSystem
  game-build/  @opensa/game-build   partitioning shared by the loaders + build scripts
tools/                       (tag type:tool — offline; read the engine, never the app)
  rw-codec/ · tool-kit/ · map-optimizer/ · opensa-lod-generator/ · vehicle-optimizer/ · timecyc-builder/
root: game-src/ · static/ · tests/ · e2e/ · scripts/ · deploy/ · nx.json · *.html · configs
```

**Module boundaries** are enforced in lint by `@nx/enforce-module-boundaries` via `package.json` `nx.tags`:
`type:app` → app + engine; `type:engine` → engine only (never app/tools); `type:tool` → engine + tools. This
replaces the old hand-rolled `gameBoundaryConfig` (the `game → renderware` rule still lives in `eslint.config.ts`).

## Level 1 — modules

```mermaid
flowchart TB
  static[("static/ — built chunks + manifest")]:::data
  ui["UI&nbsp;&middot; React shell + game surface"]:::ui
  loader["asset-loader&nbsp;&middot; download + cache"]:::infra
  vfs["vfs&nbsp;&middot; unzip + serve files"]:::infra
  game["game&nbsp;&middot; ECS, systems, adapters"]:::engine
  eng["engine&nbsp;&middot; WebGPU renderer"]:::engine
  rw["renderware&nbsp;&middot; parsers, world, mesh prep"]:::lib
  ext["Rapier &middot; fflate"]:::ext

  ui --> loader
  ui --> game
  static -->|fetch| loader
  loader -->|raw zip chunks| vfs
  game -->|reads via AssetFileSystem| vfs
  game --> rw
  game --> eng
  game --> ext
  rw --> ext

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef lib fill:#d8f5e0,stroke:#1f9d55,color:#111
  classDef ext fill:#ededed,stroke:#999,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

**Rules of the road**

- **`AssetFileSystem`** (defined in `renderware/archive`) is the seam: the game reads files through it and
  doesn't care that the **vfs** provides them today.
- Only **`game/adapters`** (and `game/mods`) may import **renderware** — it's the leaf layer.
- **asset-loader** and **vfs** are standalone (no React, no game).
- The engine / Rapier load **lazily** with the game surface, so the UI shell paints instantly.

## Level 2 — inside the modules

```mermaid
flowchart LR
  subgraph UI["ui"]
    shell["shell&nbsp;&middot; boot-machine, use-asset-boot,<br/>menu / preloader / disclaimer"]:::ui
    canvas["canvas-host&nbsp;(lazy game surface)"]:::ui
    debug["debug overlay (F2) + viewers"]:::ui
  end

  subgraph LOADER["asset-loader"]
    al["AssetLoader&nbsp;&middot; manifest, Cache Storage,<br/>progress events"]:::infra
  end

  subgraph VFS["vfs"]
    v["Vfs&nbsp;&middot; unzip (fflate) → AssetFileSystem"]:::infra
  end

  subgraph GAME["game"]
    sys["systems&nbsp;&middot; streaming, physics, character,<br/>vehicle, time, weather, zones"]:::engine
    adp["adapters&nbsp;&middot; GtaSaWorldAdapter, environment driver,<br/>DFF parse worker (plan 060)"]:::engine
  end

  subgraph ENG["engine — WebGPU"]
    ecore["core&nbsp;&middot; device, pipelines, frame graph"]:::engine
    ernd["render&nbsp;&middot; sky, fog, post, probe, shadows"]:::engine
    estr["stream + world&nbsp;&middot; cells, bundles, residency"]:::engine
  end

  subgraph RW["renderware"]
    par["parsers&nbsp;&middot; DFF/TXD/COL + IDE/IPL/DAT/GXT"]:::lib
    arc["archive&nbsp;&middot; ImgArchive, AssetFileSystem (iface)"]:::lib
    mp["map&nbsp;&middot; resolve-map, world-grid, build-cell"]:::lib
    th["mesh preparation + collision"]:::lib
  end

  shell --> al
  shell --> canvas
  al -->|chunks| v
  canvas --> sys
  canvas --> adp
  canvas --> ecore
  ecore --> ernd
  ecore --> estr
  adp --> estr
  adp --> par
  adp --> mp
  adp --> th
  adp -->|reads files| v
  v -. implements .-> arc

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef lib fill:#d8f5e0,stroke:#1f9d55,color:#111
```

## Boot flow

The menu is the first screen — **nothing downloads until a game is picked** (no eager pre-menu load). Each
game in `GAME_CONFIG` carries its own loader: a **fetch** game (e.g. Gostown) downloads chunk archives; a
**local** game (San Andreas) reads a user-picked install. A dev-only **http-dir** override
(`?loader=http-dir&src=<url>`, plan 079) reads a _served_ game dir instead — the dev surfaces boot the one
canonical build this way. The disclaimer is remembered per game.

```mermaid
flowchart TB
  a([main → App]):::ui --> m["MENU&nbsp;&middot; lists GAME_CONFIG games<br/>(nothing downloads yet)"]:::ui
  m -->|pick a fetch game| d["disclaimer&nbsp;&middot; once per game"]:::ui
  m -->|pick a local game| f["folder prompt&nbsp;&middot; + that game's disclaimer"]:::ui
  d --> l["loading&nbsp;&middot; all groups in one screen<br/>data → others → models → textures<br/>loader → vfs → verify"]:::infra
  f --> l
  l --> w["warmup&nbsp;&middot; lazy canvas-host,<br/>build Game + adapter, loadGame"]:::engine
  w -->|world-ready| p([PLAYING]):::engine
  p -->|Esc| pa["paused"]:::ui
  pa -->|continue| p

  l -. fail .-> e["error + retry"]:::data
  w -. fail .-> e
  e -->|retry| l
  e -->|&times;3 exhausted| m

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

A fetch game whose disclaimer was already accepted skips straight to **loading**. Cache-Storage chunks are
re-used across visits (keyed by build version); a revoked build — a missing `data` probe or `manifest.json`
— wipes the cache. See [features/ui-shell.md](./features/ui-shell.md) and
[features/asset-loader.md](./features/asset-loader.md).

## Build pipeline (offline)

```mermaid
flowchart LR
  src[("game-src/&lt;game&gt;/<br/>your GTA SA files")]:::data
  build["scripts/build-game.ts<br/>partition + ~50MB hashed chunks"]:::infra
  out[("static/&lt;game&gt;-&lt;version&gt;/<br/>data &middot; others &middot; models &middot; textures &middot; manifest")]:::data

  src -->|npm run build:game:original| build --> out
  out -.->|served at runtime| loader[["asset-loader"]]:::infra

  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

> Runtime in one line: **static chunks → asset-loader (cache) → vfs (unzip) → AssetFileSystem → game ←
> renderware → engine (WebGPU) + Rapier**, all behind an instant React shell.
