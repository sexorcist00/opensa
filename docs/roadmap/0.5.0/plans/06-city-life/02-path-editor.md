# 06·02 — Path editor (a viewer-family app)

[← chain](readme.md) · prev: [01 format](01-path-format.md)

A separate app (like `viewer.html` — same shell conventions) for seeing and editing the city's nervous
system. The map renders under the graph; the graph is the subject.

## Features (in build order)

1. **Viewer first**: load `.ospath` (or import SA files directly), draw nodes/links over the streamed map
   (074 engine render or the existing viewer path — whichever is cheaper to embed); colour by kind
   (car/ped/rail), lane count, speed class, flags; hover inspector.
2. **Selection & edit**: move nodes (snap to ground via the map's collision/BVH), add/delete nodes and
   links, edit lane counts/flags/speed class; bezier handles for curve smoothing on links.
3. **Intersection editing**: group nodes into an intersection, author the light phase table (phase →
   which links get green), bind rail barriers to track segments.
4. **Density painting**: brush per-zone car flow / ped density overrides on top of the popcycle import.
5. **Validation & simulation preview**: connectivity check, unreachable-lane detection, THE killer
   feature — a toy sim preview (ring-2 flow dots animating along the graph right in the editor) so route
   and light edits are visually verifiable before export.
6. **Export**: `.ospath` (+ the ASI-consumable variant if plan 08 needs a trimmed layout).

## Implementation notes

- Reuse the viewer app's camera/pick infrastructure; graph rendering = one instanced line/point pass
  (this is exactly the corona/billboard instancing pattern from 074 — cheap).
- Undo/redo from day one (command list) — editors without undo don't get used.
- File handling like the game: File System Access API against the game dir for SA imports.

## Tasks

- [ ] Viewer skeleton (app entry, map under graph, camera+pick reuse) + `.ospath`/SA-import loading.
- [ ] Graph render pass (instanced points/lines, kind/flag colouring, hover inspect).
- [ ] Node/link editing + ground snap + undo/redo + save.
- [ ] Intersection/light-phase editor UI; rail barrier binding.
- [ ] Density brush.
- [ ] Toy flow preview (ring-2 dots on the graph).
- [ ] Round-trip: SA import → edit → export → engine loads it (the integration test of the whole chain).
