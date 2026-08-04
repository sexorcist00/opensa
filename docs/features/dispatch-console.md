# Dispatch console (CAD surface over the streamed map)

`apps/dispatch` (`dispatch.html`) — a computer-aided-dispatch operator surface built on the engine and the
streamer alone: a top-down map of the world, live units, a call queue, and click-to-inspect on any map object.

It is the worked answer to "can OpenSA drive a non-game map application?". It uses the renderer and the world
streaming and **nothing from the game layer** except the one shared config→`Environment` driver, so it is also
the smallest complete example of embedding the engine.

## State

Implemented and running. The world half is verified only on real GPU hardware — see [Verification](#verification).

## What it is made of

| Concern                | Where                                    | Notes                                                                                       |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| Engine host, frame loop | `src/world/boot.ts`                     | boots the engine, picks a world, owns input; React never enters the loop                     |
| World (real)           | `src/world/pak-source.ts` + `water.ts`   | `?src=` → `setupStreaming` + the baked `water.bin`                                           |
| World (demo)           | `src/world/demo-city.ts`                 | `?demo=1` — a synthetic block grid, no pak needed; reuses `@opensa/engine-lab/synthetic`      |
| Camera                 | `src/map/map-camera.ts`                  | ground-focus map rig over `@opensa/web/ui/camera/*` — pan / orbit / dolly, north-up default  |
| 3D symbology           | `src/map/beacons.ts`                     | through-depth `createDebugLines` pillars, routes, selection ring                             |
| 2D symbology           | `src/map/overlay-2d.ts`                  | icons, chips, leader lines, scale bar — on a plain 2D canvas, and it owns hit-testing        |
| World→screen           | `src/map/projection.ts`                  | `mat4LookAt`/`mat4PerspectiveZO`/`mat4Multiply` rebuilt per frame from the frame's camera     |
| Board (domain)         | `src/ops/*`                              | units, calls, assignment, a pure `stepOperations` tick — renderer-free and unit-tested       |
| Chrome                 | `src/ui/*`, `src/app.tsx`                | call queue, roster, selection panel, status bar                                              |

## The two decisions worth reading

**Labels are not in the scene.** The engine has no font — its only text is baked road-sign glyph quads and
license-plate rasters. Everything an operator reads must stay upright, legible at any zoom and never occluded,
which is 2D by nature, so the symbology is drawn on a second canvas stacked over the WebGPU one and positioned
by projecting world points with the same view-projection the frame was rendered with. Nothing in the renderer
has to know it exists. Only the beacons — which must read as being *in* the world — are 3D.

**Fog is pushed to the far plane, and that is not a look preference.** The engine culls a cell that lies
entirely past `fogCutDistance` (2400 by default), so from the kilometre-high eye a city view needs, every cell
is culled and the map comes back empty. `pushFogOut` ties the cut to `CAMERA_FAR`, and re-applies after every
hour change because the environment driver rewrites both distances. `?fog=1` restores the game's own fog.
(`sa-map-viewer` learned this the same way; the note there is the other half of this one.)

## Clicking

A click resolves against the symbology first (the operator aimed at a chip), then against the world through
`CellStore.pick`, which needs `engine.cells.debugPicking = true` set **before the first cell loads** and a pak
carrying the placement mapper (minor 6). A world hit answers the **model and TXD names** the pak was built from
plus GTA coordinates — the readout a mod author wants, and one no tile-based map stack can produce. Right-click
opens a call at the ground point under the cursor.

## Known gaps

- **Routes are straight lines**, not driven paths. The vehicle path graph is `original`-only
  ([assets-and-data](../restrictions/assets-and-data.md)), so a total conversion has nothing to route on; a
  bearing that is honest about being a bearing beat a route that silently lies on half the games.
- **The board is a mockup feed.** `stepOperations` stands in for a real one; wiring this to a game server
  replaces that one module and nothing else.
- **No unit models.** Units are beacons plus 2D symbols. `createVehicle` would give them real cars at the cost
  of depending on converted vehicle models being present in the build.
- **Demo mode has no model names.** Synthetic cells carry no placement mapper, so a click on a demo block
  resolves to bare ground.

## Verification

- `apps/dispatch/src/ops/sim.test.ts`, `src/map/coords.test.ts` — the board and the coordinate conversion.
- In-browser (SwiftShader, 2026-08-04): engine boot, `.oscell`/`.ostex` load (576 recorded draws), the frame
  loop, frustum culling (53/144 cells visible), the projected symbology, the whole console and the
  pak-missing failure path all run. **The rendered world image was NOT verified** — the software WebGPU
  device produces a blank canvas, and the pre-existing `engine-lab` synthetic district renders blank on the
  same device, so the limitation is the rasterizer rather than this app. The world half needs a real GPU.
