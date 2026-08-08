# 201/5 — Symbology and picking as product, not debug

The console's central interaction stands on a flag named `debug`, and its units are debug lines. Both work.
Neither is something a product surface should be built on.

## Steps

### 01 — Picking off the debug flag

A click resolves through `CellStore.pick`, which needs `engine.cells.debugPicking = true` set **before the
first cell loads** and a pak carrying the placement mapper (minor 6). A world hit answers with the model and
TXD names the pak was built from plus GTA coordinates — the readout a mod author wants, and one no tile-based
map stack can produce. It is the console's best feature and it is gated behind a switch named for debugging.

Give the engine an honest pick capability with **its cost stated** — what the placement mapper costs in
memory when it is on, measured, not estimated — so that a build which defaults debug off in production does
not silently kill click-to-inspect. This is the restriction recorded in the same change
([architecture](../../../restrictions/architecture.md)).

**Owes:** the memory cost of the mapper on the [2/01](../2-real-device-truth/readme.md) district, and a test
that picking survives a production-shaped build.

### 02 — Units as instanced symbols

Beacons are `engine.createDebugLines(..., { throughDepth: true })` — an engine debug primitive, drawn over the
city regardless of depth. Fine for nine units; it is not a symbology layer.

Name the count the console must carry — how many units and calls visible at once — and draw them as instanced
symbols. The **symbol carries the label and the priority and stays 2D and on top**; the vehicle itself is
drawn as a model by step 04, not replaced by an icon.

**Owes:** draws and frame time at the declared count, desktop and phone.

### 03 — District names in the readout

`map.zon` / `info.zon` and GXT are already parsed and tested —
`packages/renderware/src/parsers/text/zon.parser.ts`, `packages/game/src/zones/*` — but the console
deliberately imports nothing from `packages/game` except the environment driver, which is what makes it the
repo's smallest complete embedding example. Today `Incident.place` comes from a hardcoded landmark table in
`apps/dispatch/src/ops/seed.ts`.

**Take the fork explicitly:** either move the lookup down to a layer both consumers can reach, or accept the
import and record why. Whichever wins updates [`docs/architecture/`](../../../architecture/README.md) and the
boundary restriction in the same change.

**Owes:** the decision, written down with its cost — not a quiet import.

### 04 — Units get real models

**Decided 2026-08-06: cars and peds are drawn**, not replaced by icons. That settles what was previously
recorded as a known gap, and it settles two things upstream:

- vehicle and ped dictionaries are **protected** in
  [1/02](../1-the-map-profile/readme.md) and cannot be cut from the pak;
- ped animation stays in the profile.

The cost is a dependency on the build carrying converted `.osm` models, and it is recorded rather than
assumed: state what the console does when a model is absent — an honest fallback to the symbol, named in the
log, never a hole where a unit should be. A vehicle exists **only** as its converted `.osm`; there is no DFF
fallback ([build-vs-runtime](../../../restrictions/build-vs-runtime.md)).

Whether those units are simulated or kinematic is decided here too, because
[1/03](../1-the-map-profile/readme.md) waits on it: kinematic units read no collision, and only then may the
baked collision leave the map profile's pak.

**Owes:** draws and frame time at the declared visible-unit count, desktop and phone, and the
simulated-vs-kinematic decision handed back to 1/03.

## Verification

- Click-to-inspect still answers model + TXD + GTA coordinates in a build with debug defaults off.
- The declared unit count is drawn without breaking the frame budget named in
  [1/04](../1-the-map-profile/readme.md).
- A build missing a unit's model degrades to a named symbol and says so in the log — verified by removing one
  deliberately.
