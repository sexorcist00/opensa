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

**DONE 2026-08-22 on the desk half; the frame cost is owed by a device run.** One field on the camera state
(`CameraState.orthoHalfHeight`) and one matrix (`mat4OrthographicZO`) rather than a second camera — the view,
the culling, every pass and the symbology are the same code, and the map camera carries the projection in its
POSE so a shared or restored view opens as it was left. `?proj=ortho`, or the `PLAN` button in the top bar.

What the step actually had to settle, none of which is the matrix:

| Question | The answer taken, and why it is derived rather than picked |
| --- | --- |
| How big is the box? | `distance × tan(fov/2)` — it frames exactly what perspective frames AT THE FOCUS PLANE, so switching is a projection change and not a jump, and pan / dolly / pinch keep their meaning |
| Where is the front plane? | as far in front of the focus as the far plane is behind it. An orthographic box has no apex, so the plane may sit ABOVE the camera — which is what stops a tower taller than the eye being sliced off at block zoom, and a perspective near plane cannot express it. Depth stays ≤ 24 km, which `depth32float` carries at ~1.5 mm |
| Is the culling correct? | `frustumFromViewProj` is Gribb–Hartmann over any view-projection, so it needs nothing new — the ortho planes come out PARALLEL rather than converging, which is pinned by a test, together with the case that reads the two apart: a sphere 60 units off-axis and 500 deep is inside the perspective frustum and outside the box |
| Where does a pick go? | the variation swaps halves: perspective fans the DIRECTION out of one eye, orthographic slides the ORIGIN across the image plane. Getting this backwards is SILENT — every pick lands under the middle of the screen |
| And the labels? | the overlay's "behind me" test was clip `w`, which is **1 for the whole world** under an orthographic projection, so a unit behind the operator would keep its callsign on screen. It reads the view matrix now, in both projections (`depth` is unchanged for perspective: `w = −z_view`) |

**What it does NOT change, stated rather than discovered:** fog, specular and the sky all read the eye POINT
(`frame.camera.xyz`), which is exact under perspective and an approximation under parallel rays. Fog is
invisible in normal use because the console pushes the cut to the far plane — it shows only under `?fog=1`
with `?proj=ortho`. The sky is the one place the approximation is the better picture and is kept on purpose:
a truly parallel view has ONE view direction, so an honest orthographic sky is a flat single colour. No
shader branch either way — [one engine, one frame](../../../restrictions/architecture.md).

**Owed by the next field run:** the frame cost against perspective at the same coverage, and the eye
verdict that both projections show the same world at the same pose (no cell present in one and missing in
the other) — the desk has the parallel-plane test, the screen has the picture.

### 02 — Where the camera may go

- **Pitch is clamped** — below some angle a map stops being a map: near buildings occlude everything and the
  streamer is asked for half the city out to the horizon. The clamp is a rule derived from what is on screen,
  not a constant picked by eye.
- **Continuous zoom, with keys that jump to levels** — city / district / block.
- **`flyTo` with animation** on selecting a call or a unit, because an instant jump loses the operator's
  sense of where they were. It must not stall on streaming: name what is shown while the destination loads.

**Owes:** the clamp rule with the observation behind it, and the flyTo duration measured against the time the
destination district needs to stream.

**DONE 2026-08-22 on the desk half; the flyTo-vs-stream number is owed by a device run.** All three parts are
rules read off the world rather than constants, and the two they replaced show what that is worth: the pitch
floor was `-0.35 rad` and the zoom-out cap `7000` units of distance, against a **2200-unit** LOD ring — one
drag and one wheel turn put the top of the frame over ground nobody had loaded, which renders as a world that
simply ends.

| Part | The rule, and where its number comes from |
| --- | --- |
| **Pitch clamp** | the shallowest tilt whose TOP EDGE lands inside the world around the focus. Perspective: the top edge is a ray `fovY/2` above the axis, landing at `d·sin t / tan(t − f)`; orthographic: it is parallel and offset by the box half-height, landing at `half / sin t`. Solved by bisection (32 fixed halvings — the reach is monotonic in the tilt) and **re-taken on every step that moves the frame**, because zooming out widens the frame and invalidates a tilt that was legal a notch ago ([the restriction this produced](../../../restrictions/architecture.md)) |
| **Zoom cap** | at the top-down limit the frame's half-span is `d·tan f`, so the widest honest view is `reach / tan f` of distance. Past it the picture has ground outside the ring at ANY tilt |
| **`reach`** | the world's own number, not the camera's: the LOD ring for a streamed world, its extent for the synthetic demo, nothing for plan mode (which draws no world and keeps the flat bounds) |
| **Zoom levels** | `block` = one render cell (`CELL_SIZE`, the grid the pak is welded on) · `district` = the baked zone box under the view (201/5-03's table) · `city` = everything the world has around the focus. A world with no zone table falls back to the GEOMETRIC mean of the other two, because zoom levels are logarithmic and a missing level should land between its neighbours. Keys `1` / `2` / `3`, widest to tightest |
| **`flyTo`** | Van Wijk & Nuij's path ([links](../../../links.md)), the one MapLibre's `flyTo` follows: the camera pulls up, crosses and settles, and **the duration is the path length in zoom space over a speed in screenfuls per second** — derived, not picked. ρ = 1.42 is the paper's own user-study value, not one we fitted |

**What is shown while the destination loads, which this step had to answer rather than discover:** the arc
zooms OUT for a long trip, so the crossing happens over far-LOD content that is already resident, and the
destination's cells begin streaming as the focus approaches rather than on arrival — the ring follows the
focus along the path. The frame never outruns the ring because the zoom cap above applies to the arc too:
the flight's own widest point is clamped by the same rule as a wheel turn. What an operator sees on arrival
is LOD geometry sharpening to HD, never a hole.

**Any input cancels a flight** — pan, orbit, dolly, pinch, a pose applied by the host. A camera that keeps
flying under the operator's hand is the bug every map application has shipped at least once.

**The bound NARROWS the operator's tilt, it does not overwrite it.** The camera keeps the tilt that was
asked for beside the one it is drawing with, and re-derives the second from the first whenever the frame
moves. Without that the rule is one-way and quietly expensive: zooming out tilts the view down, zooming back
in leaves it there, and a flight's own climb costs the operator their viewing angle for good. A drag still
measures from what is on SCREEN rather than from the older request, so dragging up out of a clamped view
fights the bound immediately instead of running through invisible slack.

**Owed by the next field run:** the flyTo duration against the time a destination district actually needs to
stream (the desk can state the rule and not the milliseconds), and the eye verdict on the clamp at city
height — the rule says the frame stays inside the ring, and only a screen says whether that is also a view a
dispatcher wants to work in.

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

**DONE 2026-08-22 on the desk half; the streaming-at-speed verdict is owed by a device run.** All four share
the mechanism the step predicted — a target becomes a camera pose — and every one of them flies rather than
jumps, because [7/02](#02--where-the-camera-may-go) already built the path.

| Capability | How it works, and the number it is derived from |
| --- | --- |
| **Follow a unit** | the view rides the selection and the streaming anchor comes with it, because on this surface the anchor IS the focus. **The damper is re-based on the subject**, per [the restriction](../../../restrictions/architecture.md): the offset is read against where the unit stood LAST frame and written against where it stands now, so a unit at constant speed leaves the damper nothing to do instead of towing the camera at a fixed lag. Its time constant is **one publish interval over three** (`SAMPLE_INTERVAL_MS / 3`, PCAD's own 4 s) — 95 % of any gap closed before the next fix can land, so the view is at most one fix behind by construction |
| **View bookmarks** | named poses in `localStorage`, per operator and honestly scoped to *this browser* until the console is a module of the CAD app. Shape-checked on read, because a half-pose written by an older version does not read as corrupt data — it puts the operator somewhere nobody asked for. The store never throws: private mode, a locked profile and a full quota all fail on the plain call, and a console that will not boot for want of a bookmark is worse than one with none |
| **Fit bounds** | the box of every unit and every OPEN call, with **one render cell of air** around it — the smallest unit of world the pak is built from, so a set inside one cell still gets context instead of a view zoomed to a millimetre. A set wider than the world is capped by 7/02's zoom bound, which is the answer to *what happens when it spans the whole state*: the fit frames as much as there IS, rather than a picture of emptiness |
| **Search by place** | the consumer side of [5/03](../5-symbology-and-picking-as-product/readme.md)'s decision. The world's own baked district table is what gets searched, so a total conversion's places are the ones an operator finds and a world with no `info.zon` finds nothing rather than answering with stock San Andreas. Case- and accent-folded, prefix matches first, and **boxes of one name are unioned** — `info.zon` cuts a place into several, and flying to a third of Vinewood is not flying to Vinewood |

**Keys:** `f` fits the board, `c` rides the selected unit (again to stop), `Escape` stops a follow — and only
when one is running, because Escape belongs to the selection everywhere else. The cluster that carries the
same four things on screen is `ui/map-tools.tsx`, top-left, on the existing tokens.

**Two defects the review pass caught before this landed.** A flight did not end a follow, so a fit or a
bookmark left the ride writing the focus in the same frame as the flight — the flight won and the follow
fought it silently until something else cancelled it. And the degraded-map banner ran across the top of the
map, which is where the cluster now sits: in plan mode, the one mode where an operator has least else to work
with, it covered the search box. The banner is bottom-right now.

**What cancels a follow, and what does not:** a pan, a locate, a bookmark and an applied pose end it — they
are the operator saying where to look, which is the one thing a follow owns. Orbit, dolly and pinch do not:
turning and zooming while riding a car is not a change of subject.

**Owed by the next field run:** that the streamer keeps up with a car at speed (the ring moves with the
followed unit, and only a device says whether the cells arrive before the car does), and the eye verdict on
the follow damper at the real 4-second publish rate rather than the mock's 20 Hz.

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

**DONE 2026-08-22.** Both halves, plus the on-screen controls that are the same commands for an operator who
has no keyboard at all — which on this surface is the phone, so they are not a nicety.

**The map is written down in ONE table** (`map/keymap.ts`) and everything reads it: the input layer resolves
events against it, the sheet prints it, the rebinder writes to it. A key handled inline where it happened to
be convenient — which is what 7/02 and 7/03 left behind, and this step swept up — is a key that exists
nowhere an operator can read, cannot be rebound, and collides silently with the next one somebody adds.

| | Default | Why there |
| --- | --- | --- |
| Pan | `W` `A` `S` `D`, arrows | under the hand that is not on the mouse |
| Turn | `Q` `E` | beside the pan keys, same hand |
| Tilt | `Shift`+`↑` / `↓` | one modifier rather than two more letters |
| Zoom | `+` `-` | what every map has had since the first tile server |
| Zoom levels | `1` `2` `3` | widest to tightest, left to right |
| North | `N` · Fit | `F` · Follow `C` | the first letter of what it does |
| Calls | `[` `]` | previous / next open call, in the queue's own order |
| Stop following | `Escape` | and ONLY that, since Escape belongs to the selection everywhere else |
| The sheet | `?` | where the whole table above is readable at runtime |

**Held is not pressed, and they cannot share a path.** Movement runs in the frame loop while the key is down,
because acting on the operating system's key REPEAT moves the map in the OS's stutter — a long first gap,
then a burst, at a rate the operator set for typing. Rates: pan is **screenfuls per second** (the frame's own
unit, so a key crosses the same share of the picture at every zoom), turn a quarter lap per second, tilt half
that, zoom a factor per second. Opposite keys cancel and a diagonal is normalised, so it is not faster than a
straight line.

**Rebinding is a press, not a text field** — click a row in the sheet, press the key. Asking an operator to
type `Shift+ArrowUp` is asking them to know how this repository spells things. Only what DIFFERS from the
defaults is stored, so a later change to the base map still reaches an operator who never touched that
command; and binding a key that is taken takes it from the other command rather than leaving two rows
claiming it.

**The on-screen controls** (`ui/map-nav.tsx`, top-right) are the same commands through the same handle: a
compass that says which way north is and puts it back, turn, tilt and zoom. The compass is the only thing on
screen that answers *which way am I facing* at all, and it is drawn from the readout — so it updates at the
readout's four times a second rather than on the frame path.

**Two defects the tests caught while they were being written.** A key released while the window is not
focused never sends `keyup`, so alt-tabbing mid-pan left the map panning by itself — the blur clears the held
set. And a modifier pressed IN THE MIDDLE of a hold changes what the release resolves to: hold `↑`, then
press Shift, and the release reads as `Shift+↑`, which is a different command — so `panNorth` stayed held with
no key down. A release now clears every command that key could have started, shifted or not.

**Owed by nobody:** this step is desk work end to end. What a field run adds is a verdict on the RATES, which
are the one thing here that is a claim about hands rather than about the world.

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
