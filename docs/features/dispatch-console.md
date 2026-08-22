# Dispatch console (CAD surface over the streamed map)

`apps/dispatch` (`dispatch.html`) — a computer-aided-dispatch operator surface built on the engine and the
streamer alone: a top-down map of the world, live units, a call queue, and click-to-inspect on any map object.

It is the worked answer to "can OpenSA drive a non-game map application?". It uses the renderer and the world
streaming and **nothing from the game layer** except the one shared config→`Environment` driver, so it is also
the smallest complete example of embedding the engine.

## State

Implemented and running. The world half is verified only on real GPU hardware — see [Verification](#verification).

**Under active development as [plan 201](../plans/201-dispatch-console/readme.md)** (opened 2026-08-06), which
declares the console as the engine's second consumer ([project-goals, directive 7](../project-goals.md)) and
carries eight chains: the map profile (trim the engine to what the map draws — and only that: cars and peds
drawn, vegetation swaying, the day turning and the weather colouring the world are all protected, and one
engine serves PC and mobile on a budget rather than a branch), real device truth (the repo's first
real-world mobile benchmark row), the operator surface at 360 CSS px, render-on-demand for a surface that
idles most of a shift, picking taken off its debug flag, **three display modes**, **the operator's map**
(orthographic mode, flyTo, follow, bookmarks, a minimap, measuring, drawing, keys, embedding) and **the time
axis**. The deferred CAD half — a live feed, real routes, cross-shift history, multi-operator,
install/offline — is [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).

**The product it is aimed at** (settled with the user 2026-08-06): the dispatcher is a **player** on the
server and so are the units; the data source is a **native CAD plugin**; the console stays a separate web
application beside the game. Its named budgets are 150 units drawn as models, 60 fps on a phone, ≤3 s to a
working picture and a hard 300–500 MB residency ceiling — see the
[plan's budget table](../plans/201-dispatch-console/readme.md), which also states plainly that those four may
not be satisfiable at once and how that gets decided.

## Three ways to draw the world

Decided 2026-08-06 — one camera, one symbology, one board, three sources for what is beneath them
([201/6](../plans/201-dispatch-console/6-display-modes/readme.md)):

| Mode | What it is | State |
| --- | --- | --- |
| Live render | the streamed pak — the game's own world | shipped, this document |
| Baked 3D city map | the world pre-simplified offline and lit like a map rather than a game | the bake exists (`tools/opensa-lod-generator`), the mode does not |
| Flat 2D | top-down tiles, no 3D at all | the frame exists (`plan-mode.ts`), the content does not |

The operator picks; a device that cannot carry the choice starts in one that works **and says why**. Camera
pose, selection and the moment in time survive a switch. The 2D tiles are baked by our own orthographic pass
so every build — including total conversions, which have no third-party map raster and never will — gets all
three modes.

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

## Embedding it

`src/embed.ts` is the library entry: the map surface without the console's own chrome, for a host that
already HAS a dispatch board and wants the map fed from its own data. `npm run build:embed:dispatch` emits it
to `dist-embed/` as one ES module (337 kB, 104 kB gzipped) **plus a separate `assets/pak-worker-*.js`, which
must be served beside it at the path the entry names** — the same trap the single-file build hit, and the
reason this build does not try to be single-file.

It exports nothing new. `bootDispatch` and `bootPlanMode` are the functions `app.tsx` already calls, so an
embedding host and this repo's own console run identical code and cannot drift. React is absent from the
bundle by construction rather than by configuration — the surface is plain DOM and engine, and only the
chrome is React, so a React import appearing in `dist-embed` means chrome has leaked into the surface.

**A host owns its own URL**, so the surface must not read it: configuration goes through
`window.__opensaDispatch` (see `dispatchParams`). That channel already existed for opaque-origin pages on a
phone; an embedding host is its second, and less exotic, user.

**Worlds are HTTP, and that is the whole point.** `resolvePakBase` probes `manifest.json` over `fetch` and
accepts an absolute URL, so a hosted pak needs no local game files, no folder picker and no File System
Access prompt — a user opens the page and the world streams. The folder picker belongs to `sa-map-viewer`,
which is a different app answering a different question. Two costs are attached and neither is a bug: the
reference pak is **1.27 GB at 1137 cells** (streamed, so a session pays for the cells it visits, cached per
build version), and a stock pak is BC throughout, so **a hosted world is desktop-only** until
[plan 200 / chain 2](../plans/200-platform-reach/2-universal-textures/readme.md) lands — `--rgba8` is the
interim, at 4–8× texture memory.

`MapCamera.applyPose` exists for hosts: every other camera step is relative, which is right for input and
wrong for a host that has a pose in hand — locking a view north-up, or restoring the tilt it left, would
otherwise mean solving through `orbit` and knowing the camera's private step scale. `pitch` is clamped like
any other, so a caller may ask for straight down without knowing how far down this camera goes.

## Clicking

A click resolves against the symbology first (the operator aimed at a chip), then against the world through
`CellStore.pick`, which needs `engine.cells.debugPicking = true` set **before the first cell loads** and a pak
carrying the placement mapper (minor 6). A world hit answers the **model and TXD names** the pak was built from
plus GTA coordinates — the readout a mod author wants, and one no tile-based map stack can produce. Right-click
opens a call at the ground point under the cursor.

## Known gaps

Each now names the step that owns it, so none of them is an open-ended note.

- **Routes are straight lines**, not driven paths. The vehicle path graph is `original`-only
  ([assets-and-data](../restrictions/assets-and-data.md)), so a total conversion has nothing to route on; a
  bearing that is honest about being a bearing beat a route that silently lies on half the games.
  → deferred: [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).
- **The board is a mockup feed.** `stepOperations` stands in for a real one; wiring this to a game server
  replaces that one module and nothing else. → deferred, contract first:
  [roadmap 0.6.0](../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).
- **No unit models** — **decided 2026-08-06: units get real models.** Cars and peds are drawn rather than
  replaced by icons; the symbol keeps the label and the priority and stays 2D on top. The cost is a
  dependency on the build carrying converted `.osm` models, and the fallback when one is absent is part of
  the step. → [201/5-04](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- **Demo mode has no model names.** Synthetic cells carry no placement mapper, so a click on a demo block
  resolves to bare ground. → picked up with the production pick capability,
  [201/5-01](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**Picking stands on a debug flag.**~~ **CLOSED 2026-08-12.** The flag is `engine.cells.picking`, a named
  capability, and its cost is counted (`cells.pickingBytes` → the report's `world.pickingMb`) rather than
  reported as free by every instrument in the repo.
  → [201/5-01](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**The beacon layer silently dropped markers at 96 per set.**~~ **CLOSED 2026-08-21.** The buffers are
  allocated at the declared 150 (`src/ops/budget.ts`) and grow past it, counting each growth into the report:
  a unit the dispatcher cannot see is not an acceptable way to hit a budget. `?units=150&calls=40` loads the
  board to the declared count — until then it could not be loaded past the nine-car demo shift on any device.
  → [201/5-02](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- ~~**Places come from a hardcoded landmark table.**~~ **CLOSED 2026-08-21.** The world's own districts are
  baked beside the pak (`districts.json`, from `info.zon` × `american.gxt` at pack time — a surface streaming
  a pak reaches neither file) and a click answers model, TXD, **district** and coordinates. The twenty Los
  Santos landmarks remain the fallback for `?demo=1`, plan mode, an older pak, and any game shipping no
  `info.zon`. → [201/5-03](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- **The units are not an instanced symbol layer yet.** They are a chevron and a label chip drawn per unit on
  the 2D canvas. The per-symbol canvas cost is down (text measured once per distinct label, font set once a
  frame, instead of both per chip per frame —
  [the counts](../benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json)), and `fillText`
  is still one call per chip. Whether that needs to become an instanced draw is a question the milliseconds
  at 150 units answer first. → [201/5-02](../plans/201-dispatch-console/5-symbology-and-picking-as-product/readme.md).
- **Time is an axis now, but nothing drives it yet.** Every unit's position is recorded as a track
  (`ops/tracks.ts`, 17 B/sample, 17.5 MB for 150 units × a shift) and `at(t)` interpolates between samples
  and holds past the last one rather than extrapolating. What does not exist is the clock that would ask it
  for a T other than "now" — no scrub, no playback, no trails.
  → [201/8-03](../plans/201-dispatch-console/8-the-time-axis/readme.md) and 8/04.
- **The mobile evidence is emulated, not hardware.** The phone runs below are an emulated Pixel 7 and a
  simulated mobile adapter; the one real device in the repo's record (Mali-G51, 360×800 DPR 2) ran the
  synthetic `?demo=1` city, not a streamed world. → the real-district row is
  [201/2-03](../plans/201-dispatch-console/2-real-device-truth/readme.md).

## Verification

- `apps/dispatch/src/ops/sim.test.ts`, `src/map/coords.test.ts` — the board and the coordinate conversion.
- `apps/dispatch/src/ops/budget.test.ts`, `src/ops/seed.test.ts` — the declared count off the query string,
  and a board seeded to it: unique ids, scattered rather than stacked, and the same board on a second run.
- `apps/dispatch/src/map/overlay-2d.test.ts` — the symbology layer against a stub 2d context, so what is
  pinned is the WORK IT ASKS FOR rather than a time this machine happens to take: a label is measured once
  and never again, the font is set a fixed number of times per frame rather than once per chip, and the
  counts it reports match what it drew. Both halves were verified by reintroducing the defect.
- `apps/dispatch/src/ops/tracks.test.ts` — the time axis: that it does not extrapolate past the last sample
  (it holds and says how old the answer is), that it records at the PUBLISH rate rather than the tick rate,
  that a stationary run collapses to two samples, and that a heading crossing north takes the short way
  round. Each of the three policy rules was verified by reintroducing its defect.
- `apps/dispatch/src/world/zones.test.ts` — the baked district table: a missing file, a malformed one and a
  pak that declares none all answer "no districts" rather than throwing into the boot, and a point resolves
  to the smallest containing district rather than the city around it.
- `apps/dispatch/src/map/beacons.test.ts` — the whole declared budget fits in ONE status without growing, a
  board past it grows instead of dropping, and a grown buffer never writes past the set's allocation (which
  on a real device is a WebGPU validation error, not a dropped marker).
- `apps/dispatch/src/map/map-camera.test.ts` — `applyPose`: that it is what the constructor does (so a fresh
  camera and an applied pose agree), that it round-trips a saved pose, and that it answers its own bound to
  anything past it — the test that pinned `TOP_DOWN_PITCH` at a hundredth of a radian short of vertical
  rather than at vertical, which is what a host asking for "straight down" actually receives.
- The embed build, 2026-08-07: `dist-embed/dispatch.js` emits all five exports, carries **no React**, names
  its `pak-worker-*.js` chunk, and imports cleanly in a bare Node runtime — so the module has no top-level
  browser dependency. **Not verified: the embedded surface has never been rendered by a host** — that needs a
  GPU, and the artifact's first real consumer is outside this repo.
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
  **It is single-file only for `?demo=1`.** The pak worker is emitted as a separate `assets/pak-worker-*.js`
  chunk, and `?demo=1` never constructs it — so the gap stayed invisible until a real pak was streamed on a
  phone and the console 404'd on the worker with the manifest already fetched. Serving a real `?src=` from the
  single-file build means shipping that one chunk beside it, at the path its own bundle names.
- In-browser (SwiftShader, 2026-08-04): engine boot, `.oscell`/`.ostex` load (576 recorded draws), the frame
  loop, frustum culling (53/144 cells visible), the projected symbology, the whole console and the
  pak-missing failure path all run. **The rendered world image was NOT verified** — the software WebGPU
  device produces a blank canvas, and the pre-existing `engine-lab` synthetic district renders blank on the
  same device, so the limitation is the rasterizer rather than this app. The world half needs a real GPU.
