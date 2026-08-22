# Dispatch console — current limitations

The operator surface's own boundaries: what the map does not do today, and why. Engine-wide limits live in
[engine-rendering.md](./engine-rendering.md) and [streaming-formats.md](./streaming-formats.md); the rules a
new design must satisfy are next door in [`restrictions/`](../restrictions/README.md) — in particular
[view-gated residency](../restrictions/streaming-residency.md), which is the map's and not the game's.

## Measuring and drawing (201/7-05)

- **A sketch does not follow the ground.** A ruler, a cordon or a circle is drawn as symbology — world
  points projected onto the overlay canvas with the frame's own view-projection, exactly like the unit chips
  — so its line runs where the operator put it and not over the hill between. This is a decision rather than
  an omission: an operator's cordon has to be visible THROUGH the buildings it is drawn around, and a shape
  draped on the ground disappears behind the first block it crosses. The alternative is Cesium's
  classification technique (render a volume, classify the fragments it covers), and it stays available for
  the day an annotation must read as paint on the road.
- **Nothing occludes a sketch**, for the same reason. A cordon over a tunnel is drawn over the hill above it.
- **A distance is the straight line between two points, not the drive.** SA's vehicle path graph is
  `original`-only ([assets-and-data](../restrictions/assets-and-data.md)), so a routed distance would be
  right on stock San Andreas and a lie on every total conversion. The ruler says what it measures.
- **An ETA circle is not built.** It needs a speed, and the console has never measured one: the units'
  positions arrive every 4 s from PCAD and nothing in the repo has turned that into a travel speed for a
  road, a district or a unit kind. A radius in metres is honest; a radius in minutes would be a constant
  chosen by eye.

## At rest (201/4-01)

- **The picture freezes, sway included.** When nothing that affects the picture has changed, the console
  draws no frames at all — so the palms stop moving and the UV scrollers stop scrolling until the next
  input, board tick or streaming create. Nothing is cut (the protected list is about what the build and the
  frame carry, not about a still map), and the first input resumes all of it. If a frozen world ever reads
  as a hung one, the lever is an idle RATE rather than an idle stop.
- **The status bar says `idle` instead of a frame rate**, and the numbers beside it are the last drawn
  frame's — a console at rest still has the cells, the residency and the pose it stopped at.
- **A change nobody touched can take up to 100 ms to appear** (the idle poll). An operator's own input never
  waits for it: the pointer, wheel and key handlers re-arm the animation frame in their own handler.

## The radar (201/7-04)

- **One scale, the whole world.** The dial frames what the pak carries (its cell extent), so at block zoom
  the view footprint is a few pixels — legible as a position, useless as a shape. A second scale (the
  district box) is the obvious answer and has not been asked for.
- **No world picture.** The radar draws the world's baked district boxes, not a map image: the flat-2D tile
  bake ([6/02](../plans/201-dispatch-console/6-display-modes/readme.md)) does not exist yet, and a world
  with no `info.zon` — a total conversion may ship none — gets an empty dial with its units on it rather
  than somebody else's city.
- **Absent in plan mode.** The no-GPU fallback has no pak, so it has no world extent to frame and no
  district table to draw; its own 250-unit grid is what locates the view there. Measuring and drawing DO
  work in plan mode.
- **Only real board entities are drawn**, which is the console's rule everywhere: nothing on the radar is
  ever a decoration that could be mistaken for a unit.
