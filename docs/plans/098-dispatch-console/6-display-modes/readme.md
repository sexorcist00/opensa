# 098/6 — Three ways to draw the world

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

**Owes:** bytes, resident MB and frame time against the live render on the same district and the same device
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
- The budget table from the 098 readme, filled in three times — one column per mode.
- A device with no WebGPU reaches the 2D mode and is told why.
- A total conversion (not `original`) has all three modes, because all three are generated from its own build.
