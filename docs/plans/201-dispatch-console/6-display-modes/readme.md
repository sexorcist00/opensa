# 201/6 — Three ways to draw the world

One console, one camera, one symbology, one board — and **three sources for what is under them**. Decided
2026-08-06.

| Mode | What it is | Where it stands today |
| --- | --- | --- |
| **Live render** | the streamed pak, the game's own world | shipped — this is the console |
| **Baked 3D city map** | the world pre-simplified offline, drawn the way a real 3D city map is drawn | the bake exists (`tools/opensa-lod-generator`), the mode does not |
| **Flat 2D** | a top-down map, no 3D at all | the *frame* exists (`plan-mode.ts`), the map content does not |

This is not a quality ladder and not a degradation path. It is three products of one world, and the operator
picks. What it buys, beyond choice: the console's hardest budget —
[150 units with models at 60 fps inside 300–500 MB](../readme.md#the-budgets-this-chain-is-held-to) — is a
real risk in the live render and close to free in the baked one. A mode the operator *chose* is not the same
thing as a frame that gave up.

## What is already ours

**The baked 3D is mostly built.** `tools/opensa-lod-generator` cuts the world into cells and merges each
cell's HD geometry into one LOD mesh, with **one** shared downscaled texture dictionary (`lods.txd`) — the
modern open-world SLOD scheme. That is a whole simplified city already, generated from whatever game is
being built. What is missing is a build in which that tier is the *only* tier, and a console that opens it.

**The 2D frame is already built.** `apps/dispatch/src/world/plan-mode.ts` runs the same camera, the same
gestures, the same symbology and the same board on a plain 2D canvas. It draws a projected ground grid and
nothing else, because it was written as the no-WebGPU floor. Give it real map content and the floor becomes a
mode.

## Prior art, and why we still generate our own

| Project | What it gives us |
| --- | --- |
| [ikkentim/SanMap](https://github.com/ikkentim/SanMap) (Unlicense) | the **useful** half: a GTA-SA → tile-coordinate projection and a tile cutter, i.e. a proven zoom/tile scheme to copy rather than invent |
| [AmyrAhmady/samap](https://github.com/AmyrAhmady/samap) | a 48000×48000 satellite-style raster of San Andreas (~280 MB as a single JPG), stitched from gtagmodding.com's tiles |

Two reasons the raster is a reference and not a dependency:

- **It covers stock San Andreas only.** This project exists to run total conversions; gostown, carcer and
  anderius have no such raster and never will. A borrowed image gives the 2D mode to one build in four.
- **The imagery is not ours to ship.** The repo carries BSD-3, but the tiles are credited to gtagmodding —
  the licence on the wrapper is not a licence on the picture. For something real users run, that is a
  problem rather than a footnote.

We have the whole world and our own renderer. An orthographic top-down pass, offline, produces our own tiles
for **any** build, licence-clean, and matching the world that actually streams. Same tool as the baked 3D,
same camera the operator gets in [7/01](../7-the-operator-map/readme.md).

An external tile set stays *supported* as an option for stock SA — it is a better picture than we will bake
on day one — but it is not what the mode is built on.

## Steps

### 01 — The baked 3D city map

A build target whose world is the LOD tier alone, and a look that is **a map, not a small game**: the answer
to "what does it look like" is *what real 3D city maps look like* — even light with no time of day, muted
and legible surfaces, roads that read, buildings that carry shape rather than detail. That is a bake-time
recolour pass over geometry we already generate, not a runtime style.

**Owes:** bytes, resident MB and frame time against the live render on the [pinned district](../1-the-map-profile/readme.md) and the same device
— the whole argument for this mode is the gap between those two columns.

### 02 — The flat 2D map

Content for the mode `plan-mode.ts` already frames. Raster tiles baked by an orthographic top-down pass over
01's world, on a zoom/tile scheme taken from SanMap's projection rather than invented.

**Ship the pyramid as one file.** [PMTiles](../../../links.md) puts a whole tile pyramid in a single archive
on static storage, read by HTTP range requests and Hilbert-ordered so neighbouring tiles are near each other
in the file. Our pak is already served as static, range-friendly files, so this fits the delivery we have and
removes tile hosting as a problem — worth contrasting with what PCAD ships today, ~5 MB of loose PNGs in a
`tiles/` directory.

Two things the step must settle rather than assume: what a tile weighs at each zoom (the whole point of this
mode is that it runs where nothing else does), and whether roads and water get extracted as **vector** on top
— which is what the runtime-recoloured layers
([1/02's protected list](../1-the-map-profile/readme.md) is about the world; layers are about data) would
eventually need.

**Owes:** total bytes per zoom level, time to first usable picture, and a run on a device with no WebGPU at
all.

#### What landed, 2026-08-23 — the mode, its content and the baker

The three pieces the step is made of, all in the repository and all tested; what is missing is a bake, and a
bake needs the game files:

| Piece | Where | What it does |
| --- | --- | --- |
| the archive format | `packages/engine-formats/src/pmtiles.ts` | PMTiles v3, written and read: hilbert tile ids, the fixed 127-byte header, directory varint encoding, leaf directories when the root outgrows the format's 16 KB first fetch, and content dedupe so a bake of the sea is ONE blue square |
| the tile scheme | `apps/dispatch/src/map/tiles.ts` | SanMap's scheme — the world as one square, z0 the whole of it, `y` counting from the north edge down. **The square is a parameter and comes out of the archive**, never San Andreas' 6000: a total conversion has its own extent and a map read on the wrong square is silently in the wrong place |
| the reader | `apps/dispatch/src/map/tile-source.ts` | one archive over HTTP range requests, LRU-capped at 256 decoded tiles, request coalescing, and the two silent failures refused by name — a server that ignores `Range` (answers `200` with the whole file, which a trusting reader decodes as pixels) and an archive with no world square in its metadata |
| the layer | `apps/dispatch/src/map/tile-layer.ts` | one `drawImage` per tile under an affine taken from the tile's own projected corners |
| the mode | `apps/dispatch/src/world/plan-mode.ts` | opens the pyramid beside the pak, takes the view to the plan projection, draws tiles under the symbology and keeps the grid where no tile covers |
| the baker | `apps/dispatch/src/world/tile-bake.ts` + `tile-bake-host.ts` | `?bake=tiles` renders the pyramid with the console's own engine — orthographic, straight down, one tile at a time, waiting for the streamer before each capture — and hands over one `tiles.pmtiles` |

**The layer is exact under the plan view and under nothing else, and that is geometry rather than a gap.**
The ground plane maps AFFINELY to the screen under an orthographic projection at any heading and any tilt, so
three projected corners give the canvas the exact transform. Under perspective the same map is a homography,
which a 2D canvas cannot express — an affine per tile would bend every straight road at the tile seams. So
opening the pyramid takes the camera to the plan view, and a perspective view draws no tiles and says so.

**The baker runs in the browser, and that is not a shortcut either.** The development machine is a phone with
no headless Chromium ([termux](../../../development/termux.md)), so a bake that needed Playwright would be a
bake nobody here can run. The console already has the world streamed and the renderer warm.

**The refusals, because a long job that cannot finish is worse than one never started:** a run past
`BAKE_TILE_CAP` (4096 tiles — z8 alone is 65 536) is refused with the count in the message, and the archive
declares the format the browser's encoder ACTUALLY produced rather than the one that was asked for (a browser
that cannot write WebP hands back a PNG with no error, and an archive declaring WebP would then serve
pictures no reader can open).

**What it costs the bundle, measured 2026-08-23** (`npx vite build`, same tree with and without the change):
the dispatch chunk goes **102.64 kB → 112.13 kB raw, 33.95 → 38.38 kB gzipped** — +9.49 kB / +4.43 kB for
the format, the scheme, the reader, the layer and the baker together. [1/06](../1-the-map-profile/readme.md)
counts the shareable artifact rather than this chunk, and the baker is the half of the cost a console that
only READS tiles never needs; splitting it out is a lever, not a decision taken here.

**Still owed, and only a bake can pay it:** total bytes per zoom level, time to first usable picture, and the
run on a device with no WebGPU. The baker reports every one of the first two as a `[tilebake]` line
(`N tiles in Ns → M MB · z0 1×…kB · z1 4×…kB · …`) so the numbers arrive in the shape a benchmark row is
written from.

### 03 — Switching

The operator picks, always. **Plus an automatic floor:** a device that cannot carry the chosen mode starts in
one that works and **says why** — the same honesty `plan-mode` already practises with its banner, never a
silent downgrade.

**Everything survives the switch: camera pose, selection, and the moment in time**
([chain 8](../8-the-time-axis/readme.md)). That is a structural requirement, not a nicety — it means the
camera, the board and the clock live *outside* the mode, which is very nearly true today (`boot.ts` owns the
camera and hands `plan-mode` the same one) and must stay true.

**Owes:** a test that switches modes and asserts the three survive, and a measurement of the switch cost.

## Verification

- The same district, in all three modes, at the same camera pose, with the same units selected.
- The budget table from the 201 readme, filled in three times — one column per mode.
- A device with no WebGPU reaches the 2D mode and is told why.
- A total conversion (not `original`) has all three modes, because all three are generated from its own build.
