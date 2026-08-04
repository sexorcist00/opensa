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
| Chrome                 | `src/ui/*`, `src/app.tsx`                | call queue, roster, selection panel, status bar; desk and phone layouts                      |
| Gestures               | `src/map/gestures.ts`                    | mouse and touch through one set of Pointer Events                                            |
| No-WebGPU fallback     | `src/world/plan-mode.ts`                 | the same camera and symbology, 2D only — no engine, no GPU                                   |

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

## On a phone

The console runs on a phone, and this is the one surface in the repo that does — the game needs a BC-capable
GPU, which no phone has.

- **Layout** flips below 860 px (`use-compact.ts`, a media query — a phone in landscape, a narrow window and a
  split screen all need the same treatment and none is reliably identifiable any other way): the map fills the
  screen, the two lists move into a tabbed sheet under it, and the top and status bars drop what does not fit.
- **Gestures** (`gestures.ts`): one finger pans, two fingers pinch to zoom and drag to orbit, a long press
  opens a call — touch has no wheel, no second button and no hover, so three of the five desk gestures had to
  be re-cast rather than mapped. The canvas carries `touch-action: none`, without which the browser claims the
  drag for scrolling before a single `pointermove` arrives.
- **Chips clamp to the canvas** and calls drop their title below 620 px — on a phone most icons sit near an
  edge, and an unclamped chip hangs half off screen.
- **The worlds it can show** are `?demo=1` (synthetic, RGBA8) and any pak built with `opensa-pack --rgba8`.
  A stock pak is BC-compressed and mobile GPUs ship ETC2/ASTC, so it will not load; the engine boots without
  BC and fails on the first BC texture instead, by name. See
  [edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md) for the cost of `--rgba8` and what a
  cheaper encoding would take, and [restrictions/assets-and-data.md](../restrictions/assets-and-data.md) for
  why it is a build-time decision.
- **Plan mode is the floor.** If WebGPU is missing entirely — an older phone, a locked-down browser, a
  blocklisted GPU — the console does not die: `plan-mode.ts` runs the same camera, gestures, symbology and
  board on a 2D canvas with a projected ground grid, and a banner says what is missing. The world is gone;
  the dispatcher's job is not.

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
- `packages/engine/src/core/ostex-upload.test.ts` — both directions of the BC rule: a BC payload is refused by
  name on a GPU without BC (and no texture is created), an RGBA8 one uploads.
- `packages/cell-weld/src/textures.rgba8.test.ts` — both directions of `--rgba8`, on a SYNTHETIC DXT1
  dictionary so it runs without a game tree (the planner's other tests need `npm run test:fixtures`).
- Phone, emulated (Pixel 7, 412×839 CSS px, DPR 3, touch, 2026-08-04): the compact layout, the tabbed sheet,
  the clamped chips and the demo world (576 recorded draws, 44/144 cells visible, 38-46 fps under SwiftShader).
  Re-run with `texture-compression-bc` filtered out of the adapter — **the console boots and builds its world
  on a simulated mobile GPU**, which is the change's whole point. Re-run again with `navigator.gpu` returning
  undefined — **plan mode takes over**, banner and all.
- Single-file build (the shareable artifact): the whole console inlines to ~490 kB of ASCII-escaped JS, adds
  its own `<meta name=viewport>` at runtime (without it a phone lays out at ~980 px and the DESK layout wins
  on a 412 px screen — found by publishing it), and opens on `?demo=1`.
- In-browser (SwiftShader, 2026-08-04): engine boot, `.oscell`/`.ostex` load (576 recorded draws), the frame
  loop, frustum culling (53/144 cells visible), the projected symbology, the whole console and the
  pak-missing failure path all run. **The rendered world image was NOT verified** — the software WebGPU
  device produces a blank canvas, and the pre-existing `engine-lab` synthetic district renders blank on the
  same device, so the limitation is the rasterizer rather than this app. The world half needs a real GPU.
