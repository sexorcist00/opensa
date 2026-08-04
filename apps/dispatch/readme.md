# @opensa/dispatch

A computer-aided-dispatch (CAD) operator console over the streamed San Andreas map: top-down 3D view, live
units, a call queue, and click-to-inspect on any map object.

```bash
npm run dev
# with a built game (default ?src=build/original):
open http://localhost:5173/dispatch.html
# without one — a synthetic block city:
open http://localhost:5173/dispatch.html?demo=1
```

## Controls

| Gesture            | Does                                             |
| ------------------ | ------------------------------------------------ |
| left-drag          | pan the map                                      |
| right-drag         | orbit / tilt around the point you are looking at |
| wheel              | zoom                                             |
| click              | select a unit, a call, or a map object           |
| right-click        | open a new call at that spot                     |
| double-click a row | centre the map on that unit or call              |

The time slider drives the world's lighting; "Auto-dispatch" makes the desk assign the nearest free unit to
every pending call by itself.

## What it uses from OpenSA

`@opensa/engine` (renderer + streaming) and `@opensa/engine-formats`. **Nothing from `packages/game`** except
the shared config→`Environment` driver, so no ECS, no Rapier, no peds, no vehicle physics, no weather sim.
Camera rig steps come from `@opensa/web/ui/camera/*`, the demo city's fixture from
`@opensa/engine-lab/synthetic`.

## Design notes

Two things are worth knowing before changing anything here:

- **All text is 2D, on a canvas stacked over the WebGPU one**, positioned by projecting world points with the
  frame's own view-projection. The renderer has no font, and operator text should not be in a 3D scene anyway.
- **Fog is pushed to the far plane on purpose.** The engine culls cells past `fogCutDistance`; leave it at the
  game's value and a city-wide view renders nothing. `?fog=1` puts it back.

Full write-up, including the known gaps and what was and was not verified:
[docs/features/dispatch-console.md](../../docs/features/dispatch-console.md).
