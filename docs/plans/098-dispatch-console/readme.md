# 098 — The dispatch console: a CAD map, trimmed to what it draws, on a phone

> **This chain is subordinate to [099 — PCAD Dispatch](../099-pcad-dispatch/readme.md)**, the final plan.
> That document is the product — a web dispatch application for a SA-MP server, paired with a client-side CAD
> plugin — and OpenSA's role in it is exactly one component: **the 3D map**. Everything below is the engine
> and map work that component needs. Read 099 first for why any of it is being done.

**The engine's second consumer, declared** (priority set 2026-08-06). `apps/dispatch` is a computer-aided-
dispatch operator surface over the streamed world — a top-down 3D map, live units, a call queue, and
click-to-inspect that answers with the model and TXD names the pak was built from. It arrived in a single
commit (`d57c92d`) with one write-up ([features/dispatch-console.md](../../features/dispatch-console.md))
and **nothing else**: no plan chain, no roadmap row, and not a word in
[project-goals](../../project-goals.md), every line of which was written for one consumer — the game.

Two facts make that gap expensive right now.

**This is the surface that reaches a phone.** It is the only one in the repo that does. The game cannot: a
pak built from SA assets is BC throughout and no mobile GPU has BC, which is the whole reason
[097](../097-platform-reach/readme.md) exists. The console already opens an `--rgba8` world today — no gate,
no pending concept. Meanwhile the project's entire mobile evidence base is **one synthetic row**, and 097
says so itself: *"nothing here has been run on the phone"*. Its step
[1/04](../097-platform-reach/1-device-truth/readme.md) deliberately refused to write a residency ceiling
rather than fit a constant before a device was measured. This chain is how that measurement gets taken.

**A map view never reads part of what it ships — and only that part may be cut.** The direction is to
optimise the engine for the 3D map without the extra, and the second half of that sentence is the load-
bearing one: **cars and peds are drawn, the palm sways, the day turns, the weather colours the world.** That
is what makes a 3D map a 3D map instead of a tile stack, and it is what
[directive 6](../../project-goals.md#6-the-target-is-a-aaa-grade-game-and-that-is-a-measurable-claim) calls a
world that is alive. What may be cut is the dead half: pak entries no frame of this surface ever requests,
passes with no consumer on screen, and bundle code that never executes.

## The decisions this chain is built on

Taken 2026-08-06 with the user; every step below inherits them.

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **The SA world only** | the console reads the same pak and the same authored data the game does | geo import (OSM / tiles / CityGML), a CRS layer, CAD over a real city |
| **The console leads the mobile work** | phone work is ordered by the operator surface, because it is the one that runs there | the game shell's touch chrome setting the order |
| **The dispatcher is a player** | the operator is a player on the server, on one or two monitors plus a phone; the units are players too, and there is no decorative population on the map | a desk product for staff outside the game |
| **The data comes from a native CAD plugin** | that plugin is the source of calls and the channel to units; the console stays a separate web application beside the game | the console inventing calls, or owning voice/chat |
| **The board stays a mock for now** | `stepOperations` remains the feed; the seam stays a seam until the plugin is there | a backend or a socket protocol in this chain |
| **Three ways to draw the world** | live render, a baked 3D city map, a flat 2D map — the operator picks, with an automatic floor | a silent quality ladder |
| **Time is an axis, not a field** | positions interpolate, the shift can be scrubbed, units leave trails | extrapolating past what the feed sent |
| **Cut only what is dead** | one declared map profile, over the build and the frame, removing what this surface **provably never reads** | cutting whatever looks "game-ish": cars and peds are drawn, vegetation sways, the day turns |
| **One engine, PC and mobile** | shared code and a shared frame; the platform difference is a **budget**, not a feature set | a forked renderer, a "mobile shader path", a second codebase |
| **UI is designed, not eyeballed** | the design skills are loaded before layout and colour; tokens live in `apps/dispatch/src/ui/styles.ts` | picking colour and density by feel, styles scattered per component |

## The evidence this chain is answering

Every number is already in the record.

| What | Measured | Where |
| --- | --- | --- |
| Phone, synthetic world | 41 fps, 162 draws, 37 MB resident — Mali-G51, 360×800 @ DPR 2, `?demo=1` (no streaming, no LODs, no water) | [benchmarks, mobile row](../../benchmarks/index.md#mobile) |
| Phone, emulated | Pixel 7 412×839 @ DPR 3, 38–46 fps under SwiftShader, 576 recorded draws, 44/144 cells visible | [features/dispatch-console.md](../../features/dispatch-console.md#verification) |
| Phone, real world | never run — the console is what makes it runnable today | this chain, [2/03](2-real-device-truth/readme.md) |
| Desktop, populated drive | 1004 slow frames, p50 21.3 ms · **GPU pass mean 15.64 ms against a CPU render of 0.1–0.6 ms** | [091](../091-frame-time-attribution/readme.md) |
| Cold entry into a district | first frame `cell-collision-read` **235 ms**, then ~20 frames of 110–170 ms | 093 sweep |
| Boot frame | **576.1 ms** | 091 |
| The shareable console | ~490 kB of ASCII-escaped JS, single-file **for `?demo=1` only** — the pak worker is a separate `assets/pak-worker-*.js` chunk | [features/dispatch-console.md](../../features/dispatch-console.md#verification) |
| BC pak reference | 1,272,901,632 B at 1137 cells | [universal-texture concept](../../concepts/universal-texture-transcode.md) |

Read together: the desktop engine is GPU-bound in steady state and main-thread-bound in transients, and the
phone has never been measured against real content at all. So the order is **cut the dead weight, then
measure the thing we intend to ship, then tune against that measurement** — never the other way round.

## The budgets this chain is held to

Named by the user on 2026-08-06, before the work. Every one of them is a specification, not a hope
([directive 5](../../project-goals.md#5-performance-is-a-requirement-not-an-outcome)).

| Budget | Value | Where it bites |
| --- | --- | --- |
| Units on screen, worst case | **150**, each drawn as a **model with a symbol over it** | 1/04, 5/02, 5/04 |
| Frame rate on a phone | **60 fps** | the whole of 1 and 2 |
| Time to a working picture | **≤ 3 s** | 2/01, 6/02 |
| Resident memory on a phone | **hard ceiling 300–500 MB** | 1/03, 2/04, 8/01 |
| First download | as large as needed **if it caches** | 2/01, and the offline cache deferred to 0.6.0 |

**These may not all be satisfiable at once, and the chain says so up front.** 150 textured vehicle models at
60 fps inside 300 MB is not implied by anything measured: the only mobile row in the repo is 41 fps and 37 MB
on a *synthetic* city with no streaming. Two honest outcomes exist — a screen-size threshold where a distant
unit drops to its symbol, or a mode ([chain 6](6-display-modes/readme.md)) in which the world is cheap enough
that the budget is comfortable — and [chain 2](2-real-device-truth/readme.md) decides between them with a
measurement rather than an argument.

## The chains, in execution order

| # | Chain | Why here |
| --- | --- | --- |
| 1 | [The map profile](1-the-map-profile/readme.md) | Dropping bytes nothing reads needs no device to justify it, and it changes every number the rest of the chain is tuned against |
| 2 | [Real device truth](2-real-device-truth/readme.md) | The first real mobile row in this repo, and it should be a row of what we intend to ship. Hands 097 the ceiling it refused to invent |
| 3 | [The operator surface on a phone](3-the-operator-surface-on-a-phone/readme.md) | "It loads" is not "an operator can work it" — 360 CSS px, touch, legibility, and the no-GPU floor |
| 4 | [A console is not a game](4-a-console-is-not-a-game/readme.md) | A game is always moving; a dispatch map idles most of a shift on a device that runs hot and flat |
| 5 | [Symbology and picking as product](5-symbology-and-picking-as-product/readme.md) | The console's central interaction stands on a flag named `debug`, and its units are debug lines |
| 6 | [Three ways to draw the world](6-display-modes/readme.md) | Live, baked-3D and flat-2D. Two thirds of it already exists unrecognised, and it is what makes the budget above reachable by choice rather than by giving up |
| 7 | [The operator's map](7-the-operator-map/readme.md) | Orthographic mode, pitch clamp, flyTo, follow, bookmarks, fit bounds, a minimap, measuring, drawing, search, keys, embedding — what a map application has that a game does not |
| 8 | [The time axis](8-the-time-axis/readme.md) | Where time lives in the data model is cheap now and a rewrite later. Moved forward from 0.6.0 for that reason alone |

## The steps, at a glance

32 steps, 8 chains. Execution order is chain order; inside a chain, step order. The one-line form — each
step's own section carries the budget it must fit and the number it owes.

| # | Step | What it produces |
| --- | --- | --- |
| **1** | **[The map profile](1-the-map-profile/readme.md)** — cut only what is provably never read | |
| 1/01 | The inventory | the before-table (passes × ms, entry kinds × bytes, modules × kB) + **the pinned district** |
| 1/02 | The protected list | what may never be cut: cars, peds, sway, the day cycle, weather, one engine PC+mobile |
| 1/03 | The pak profile | a build omitting only what 01 proved unread; bytes and resident MB before/after |
| 1/04 | The frame profile | every pass judged *kept / cheaper / removed*, with its ground |
| 1/05 | The streaming profile | rings anchored to the map focus — **and the per-cell geometric error the pak lacks** |
| 1/06 | The bundle | dead code only; kB before/after on the single-file artifact |
| **2** | **[Real device truth](2-real-device-truth/readme.md)** — the trimmed console on real hardware | |
| 2/01 | A phone-sized district pak | `--rgba8` over the pinned district, profiled vs unprofiled |
| 2/02 | Serve it from the shareable build | close the pak-worker chunk gap so a real `?src=` streams |
| 2/03 | The field run | **the repo's first real-world mobile benchmark row** |
| 2/04 | The residency ceiling, derived | the number 097/1-04 refused to invent, handed back |
| **3** | **[The operator surface on a phone](3-the-operator-surface-on-a-phone/readme.md)** | |
| 3/01 | 360 CSS px | the layout spec, fixed before code |
| 3/02 | Gestures on real touch hardware | the three re-cast desk gestures, verified where a mouse cannot fail |
| 3/03 | Legibility at city zoom | a labels-per-frame budget and a collision rule |
| 3/04 | The floor, measured | plan mode (no GPU) on the same real phone |
| **4** | **[A console is not a game](4-a-console-is-not-a-game/readme.md)** — session and battery | |
| 4/01 | Render on demand | idle draws → 0, a named wake-latency budget, a battery delta |
| 4/02 | The long session | resident MB at 0 / 30 min / 2 h; bundle re-records |
| **5** | **[Symbology and picking as product](5-symbology-and-picking-as-product/readme.md)** | |
| 5/01 | Picking off the debug flag | an honest pick capability with its memory cost stated |
| 5/02 | Units as instanced symbols | draws and frame time at the declared count |
| 5/03 | District names in the readout | the layer fork taken explicitly, and written down |
| 5/04 | Units get real models | cars and peds drawn; the fallback when a model is absent |
| **6** | **[Three ways to draw the world](6-display-modes/readme.md)** | |
| 6/01 | The baked 3D city map | the LOD tier as the only tier, lit like a map — against the live render |
| 6/02 | The flat 2D map | tiles from our own orthographic pass, shipped as one PMTiles archive |
| 6/03 | Switching | camera, selection and the moment survive; an automatic floor that says why |
| **7** | **[The operator's map](7-the-operator-map/readme.md)** | |
| 7/01 | Orthographic mode | the same matrix that bakes 6/02's tiles; culling correct under it |
| 7/02 | Where the camera may go | pitch clamp, zoom levels, `flyTo` that does not stall on streaming |
| 7/03 | Getting somewhere | follow a unit, bookmarks, fit bounds, search by place |
| 7/04 | The minimap | the 2D map at lowest zoom + a viewport rect — nothing like it exists in the repo |
| 7/05 | Measuring and drawing | distance, radius, perimeter — on **classification**, not tessellation |
| 7/06 | Keyboard | a base set plus remapping |
| 7/07 | Leaving the console | a link to a view, iframe embedding, image export |
| **8** | **[The time axis](8-the-time-axis/readme.md)** | |
| 8/01 | A position is a function of time | the track type, its sampling policy, its memory cost |
| 8/02 | Interpolation, honestly | between packets only — never past them |
| 8/03 | The clock and the timeline | scrub, ×2/×8, live; game hour vs wall time kept apart on screen |
| 8/04 | Trails | the last N minutes, on the same ground-following work as 7/05 |

Above all of it sits [099](../099-pcad-dispatch/readme.md)'s phase order: **0** measure (1–2), **1** the three
modes (6), **2** speak PCAD's protocol (+8), **3** the map becomes vibecode's module 10, **4** what PCAD owes
back (publish rate, positions on foot).

## What this chain does NOT own

[097](../097-platform-reach/readme.md) keeps all of it, and 098 duplicates none of it: universal texture
transcode and its concept gate, workers and `crossOriginIsolated` transport, the runtime read of the baked
collision, the WebGL2 fallback backend and its concept gate, and the game shell's touch controls. Where this
chain needs one of those, it says so and waits rather than building a second version.

The relationship runs the other way too: 097's phone-side steps are blocked on a device measurement nobody
has taken, and [2/03](2-real-device-truth/readme.md) is the cheapest way to take it.

## Ruled out, 2026-08-06

Recorded so they are not re-litigated, not because they are bad:

- **Real-world geography — the door is closed** (2026-08-06, asked twice). No OSM/tile/CityGML import, no CRS
  layer, and no "world source" abstraction kept open for one. GTA coordinates stay the coordinate system, and
  the one conversion that exists (`apps/dispatch/src/map/coords.ts`) stays the one place it lives.
- **Interiors and floors** — the map is the street. A unit that goes inside keeps its symbol at the door.
- **Roles beyond the dispatcher** — one role, everyone sees everything. No observer mode, no field-unit
  screen; the field unit's app is the native plugin's business, not this console's.
- **Decorative population** — only real players are drawn, so nothing on the map is ever mistaken for data.
- **A live operations feed, multi-operator, install + offline cache** — deferred to
  [roadmap 0.6.0](../../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md). The feed's source is now known
  (the native CAD plugin), which is why the contract is worth writing before the transport.
- **Extrapolating unit positions** — see [8/02](8-the-time-axis/readme.md). A map that invents a position is
  worse than one a second behind.

## Status

| Step | State |
| --- | --- |
| the chain itself | **OPENED 2026-08-06** — declared, ordered, and the decisions above taken with the user |
| the requirements round | **CLOSED 2026-08-06** — the product, the budgets, the display modes, the camera and the time axis settled in one questioning pass; chains 6–8 exist because of it |
| [1/01 The inventory](1-the-map-profile/readme.md) | **IN PROGRESS** — the instrument is merged (`?inventory=1`, commit `112d70b`) and the before-table is being collected ON THE DEVICE. **First capture (2026-08-07) was VOID** — the world had not streamed (`cellsTotal 0`; its triangles were the pak's water mesh), taken 1.6 s after the collector started; recorded at [benchmarks/2026-08-07-mobile-inventory-void.json](../../benchmarks/opensa-engine/2026-08-07-mobile-inventory-void.json) and NOT citable. The collector now discards the first delta (it carried page load into `dtMax`) and every report states its own warnings, so a void capture says so on the phone instead of downstream. **A clean capture followed** — 2482 frames / 209 s, 4/4 cells, `warnings` empty: [benchmarks/2026-08-07-mobile-district-inventory.json](../../benchmarks/opensa-engine/2026-08-07-mobile-district-inventory.json). **It is on the WRONG GROUND for this chain**: taken on Ganton (the rect `phone.sh` converts by default), while the district pinned below is `los-santos-centre` at 1480,-1720, which this pak does not cover. So the step is NOT closed — either a pak covering the pinned district is built and the capture re-taken, or the pin moves with a recorded decision. Two findings from it stand either way: the frame is **not submit-bound** (submit 1.78 ms of a 31.8 ms frame, 5.6 %) and the other 94 % is **unattributable on this device** — no `timestamp-query`, and `spans` came back empty — so a CPU-side proxy is a prerequisite for chains 1 and 2, not an optimisation. The field workflow behind it is now two commands (`npm run phone:setup` once, then `npm run phone`), and a pak records the rect and flags it was built from, so the district a number cites is a fact rather than a memory. Not closed until its passes × ms, entry kinds × bytes and modules × kB are recorded here and in [`docs/benchmarks/`](../../benchmarks/index.md), together with the pinned district they were read on and the pak build that served them |
| 1/02 … 8/04 | not started. Execution order confirmed with the user: **the engine first** — the map profile and the phone, then everything above them |

**Owed, and not yet paid:** every number quoted above is somebody else's measurement. This chain has not run
anything yet, and its headline claim — a real district, on a real phone, in an operator's hands — stays
unproven until [2/03](2-real-device-truth/readme.md) records its row.
