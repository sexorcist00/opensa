# 201/7 — The operator's map: camera modes and the tools on top

What a map application has that a game does not, beyond the world itself. All of it decided 2026-08-06; none
of it exists today.

The console's camera is `apps/dispatch/src/map/map-camera.ts` — a ground-focus rig over
`@opensa/web/ui/camera/*`, pan / orbit / dolly, north-up by default, perspective only. Everything below
extends that one class rather than introducing a second camera.

## Steps

### 01 — Orthographic mode

A real plan view: buildings stop leaning, distances read honestly, the picture becomes a drawing. The
operator switches it on; perspective stays the default.

This is not only a look. The same projection is what **bakes the 2D tiles** in
[6/02](../6-display-modes/readme.md), so the mode and the generator share one matrix rather than two that
drift.

Watch two things the engine currently assumes are perspective: frustum culling, and the fog cut that
[a restriction](../../../restrictions/architecture.md) already says must be pushed out at city height.

**Owes:** culling correctness under an orthographic frustum (a cell wrongly culled is an empty screen, and
the counters will still look healthy), and the frame cost against perspective at the same coverage.

### 02 — Where the camera may go

- **Pitch is clamped** — below some angle a map stops being a map: near buildings occlude everything and the
  streamer is asked for half the city out to the horizon. The clamp is a rule derived from what is on screen,
  not a constant picked by eye.
- **Continuous zoom, with keys that jump to levels** — city / district / block.
- **`flyTo` with animation** on selecting a call or a unit, because an instant jump loses the operator's
  sense of where they were. It must not stall on streaming: name what is shown while the destination loads.

**Owes:** the clamp rule with the observation behind it, and the flyTo duration measured against the time the
destination district needs to stream.

### 03 — Getting somewhere

Four capabilities, one step because they share a mechanism (a target → a camera pose):

| Capability | Note |
| --- | --- |
| **Follow a unit** | the camera rides the selection. The streaming anchor moves with it — see the [restriction on a camera the streaming does not follow](../../../restrictions/architecture.md) |
| **View bookmarks** | named poses ("my sector"), saved per operator |
| **Fit bounds** | one key puts every active call and unit in frame |
| **Search by place** | `map.zon` / `info.zon` + GXT are already parsed; this is the consumer side of the layer decision in [5/03](../5-symbology-and-picking-as-product/readme.md) |

**Owes:** for follow — that streaming keeps up with a car at speed; for fit bounds — behaviour when the set
spans the whole state.

### 04 — The minimap

An overview inset: where am I relative to the whole city. **Nothing like it exists anywhere in this repo** —
`docs/features/zones-hud-debug.md` lists "no minimap/radar" as a gap of the game HUD too, so whatever is
built here should be built where both can reach it.

Cheapest honest version: the [flat 2D map](../6-display-modes/readme.md) at its lowest zoom, plus a viewport
rectangle. That is one more consumer of a thing 6/02 already bakes, rather than a second renderer in a corner
of the screen.

**Owes:** its cost per frame, and its behaviour under [render-on-demand](../4-a-console-is-not-a-game/readme.md)
— an inset that redraws every frame defeats chain 4 entirely.

### 05 — Measuring and drawing

- **Measure**: distance, radius, an ETA circle around a point.
- **Draw**: a perimeter, a cordon, a search area — annotations laid on the world that stay where they were
  put.

Both need geometry that follows the ground rather than floating over it — the same clamp-to-ground problem
the runtime-recoloured data layers have, and the one
[8/04's unit trails](../8-the-time-axis/readme.md) have. **Solve it once, in the engine, for all three.**

The technique to copy is Cesium's **classification / ground primitives** ([links](../../../links.md)): do not
tessellate the shape to the ground mesh — render a **volume** and classify the fragments it covers. The shape
then needs to know nothing about the terrain under it, which matters here because our ground is welded cell
geometry rather than a heightfield, and fitting a polygon to it would be a per-cell join problem of exactly
the kind [the world-glass idea](../../../ideas/world-glass-material/readme.md) is stuck on.

**Owes:** the ground-following rule (what a shape does over a bridge, a tunnel mouth, water), the cost of
carrying N annotations, and a statement of whether the classification pass fits the frame budget named in
[1/04](../1-the-map-profile/readme.md).

### 06 — Keyboard

A base set — zoom levels, north, fit bounds, next call, Escape — **and remapping**, because the operator
decides what they repeat. In a real CAD this is half the product.

**Owes:** the default map written down where an operator can read it, and the remap stored per operator.

### 07 — Leaving the console

Three ways the map goes somewhere else:

- **A link to a view** — partly there already (`?at=`, `?h=`, `?pitch=`, `?yaw=`); make it complete and
  shareable, including the mode and the moment in time.
- **Embedding in another site (iframe)** — `boot.ts` already carries a `window.__opensaDispatch` escape hatch
  for opaque-origin hosts, which is the hard half; the rest is deciding what a hosted console may do.
- **Exporting the view** — an image of the situation for a report or a chat.

**Owes:** what an embedded console is allowed to do, stated rather than discovered, and an export that
includes the symbology (which lives on a second canvas — a naive `toDataURL` will capture the world without
the units).

## The design rule for all of it

Layout, colour, density and state tiles go through the design skills — `artifact-design` and `dataviz` —
before code, exactly as [3](../3-the-operator-surface-on-a-phone/readme.md) requires, and the tokens land in
`apps/dispatch/src/ui/styles.ts`. Six new controls added by feel is how a dispatcher's screen becomes
unreadable.

## Verification

- Every capability here works in all three [display modes](../6-display-modes/readme.md) or states plainly
  which it does not and why.
- Orthographic and perspective show the same world at the same pose — no cell present in one and missing in
  the other.
- The shared view link, opened cold on another machine, reproduces pose, mode and moment.
