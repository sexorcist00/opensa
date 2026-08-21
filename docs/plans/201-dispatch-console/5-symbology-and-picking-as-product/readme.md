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

**DONE IN THE ENGINE 2026-08-12; the district number is owed by the next field run.** `debugPicking` is
`CellStore.picking` — a named capability, no `debug` in it — and the three hosts that arm it (the console,
the map viewer, the game shell's debug overlay) now name the capability rather than the mode. The
[restriction](../../../restrictions/architecture.md) is marked resolved in the same change.

The rename alone would have been cosmetic. What the step really owed was the price, and there was none to
read: what picking retains is **CPU-side** — the mapper rows plus the cell index bytes a cell would otherwise
drop after upload — while `Engine.ledger()` counts GPU residency, so every instrument in this repo reported
this capability as free. `CellStore.pickingBytes` counts both halves; `?inventory=1` carries it as
`world.pickingMb`, so **the next capture on the pinned district hands over the number this step owes without
anyone having to remember to measure it**. Two tests pin it — the cost is zero with the capability off, and
each half is verified separately by reintroducing a half-count.

Still open here, and it needs a device: `PLACEMENT_ROW_BYTES` is an ACCOUNTING figure derived from the shapes
allocated, not a heap reading. `performance.measureUserAgentSpecificMemory()` is how it gets checked.

### 02 — Units as instanced symbols

Beacons are `engine.createDebugLines(..., { throughDepth: true })` — an engine debug primitive, drawn over the
city regardless of depth. Fine for nine units; it is not a symbology layer.

Name the count the console must carry — how many units and calls visible at once — and draw them as instanced
symbols. The **symbol carries the label and the priority and stays 2D and on top**; the vehicle itself is
drawn as a model by step 04, not replaced by an icon.

**Owes:** draws and frame time at the declared count, desktop and phone.

**THE COUNT IS DECLARED AND THE BOARD CAN REACH IT, 2026-08-21. The milliseconds are owed by
[2/03](../2-real-device-truth/readme.md).**

Three things were true when the step opened, and the expensive one is that none of them was visible:

- **The 150 existed in no line of code.** It was a row in a budget table and nothing read it.
- **The beacon buffers were `MARKER_CAPACITY = 96`, and a full set RETURNED without drawing the rest.** Every
  marker in a set shares a colour, so the worst case for any one set is the whole board in a single status —
  at 150 available units, a fifth of the shift would not have been on the map. No throw, no warning, no
  missing pixel: the map just stops showing units, and the operator has no way to know which ones.
- **The board could not be loaded past nine units on any device**, so the number this step owes could not
  have been taken even with a phone in hand.

What is in now. `UNITS_ON_SCREEN = 150` lives in one place (`apps/dispatch/src/ops/budget.ts`) and is cited
to the budget table rather than restated. The beacon buffers are allocated at it and **grow** past it,
counting each growth into the report — a declared budget is an ALLOCATION, never a ceiling
([directive 2](../../../project-goals.md#2-legacy-limits-are-not-our-limits)), and the alternative is a unit
the dispatcher cannot see. `?units=150&calls=40` seeds the board at the declared count, deterministically:
past the nine named cars the roster is generated and scattered around the landmark table by a hash of its
index, so two runs of the same size are the same board.

The desk half is [counted](../../../benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json),
and it is a call count rather than a timing. At 150 units + 40 calls the overlay was asking the canvas for
**190 `measureText` calls and 190 `ctx.font` assignments every frame** — a text measurement and a font
re-parse per chip, per frame, for labels that do not change between frames. It now asks for **151 measures
once** (150 distinct callsigns plus the one label the forty calls share) **and 0 thereafter**, with one font
assignment a frame. `fillText` is unchanged at one per chip, and deliberately: this step does not reduce the
symbol count, and it should not — decluttering is [3/03](../3-the-operator-surface-on-a-phone/readme.md)'s
rule, and taking it here would spend the budget before anyone has measured what it buys.

The report gained a `symbology` block — units, calls, symbols, chips, chips dropped, `measureText` calls,
beacon capacity and growths — for the same reason [5/01](#01--picking-off-the-debug-flag) gave `pickingMb`
one: **1/01's `overlay-2d` at 2.44 ms cannot be read against a symbol count that was never recorded**, and
the next capture should hand the number over rather than rely on someone remembering the load.

**Still open, and named rather than quietly dropped:** the units are the chevron-and-chip pair on the 2D
canvas, not an instanced draw. Whether an instanced layer is needed at all is a question the milliseconds at
150 answer first — building it now would be tuning before the measurement, which is the order
[the chain's own evidence table](../readme.md) rejects.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** nothing.

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
