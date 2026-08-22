# 201 — The dispatch console: a CAD map, trimmed to what it draws, on a phone

> **This chain is subordinate to [202 — PCAD Dispatch](../202-pcad-dispatch/readme.md)**, the final plan.
> That document is the product — a web dispatch application for a SA-MP server, paired with a client-side CAD
> plugin — and OpenSA's role in it is exactly one component: **the 3D map**. Everything below is the engine
> and map work that component needs. Read 202 first for why any of it is being done.

**The engine's second consumer, declared** (priority set 2026-08-06). `apps/dispatch` is a computer-aided-
dispatch operator surface over the streamed world — a top-down 3D map, live units, a call queue, and
click-to-inspect that answers with the model and TXD names the pak was built from. It arrived in a single
commit (`d57c92d`) with one write-up ([features/dispatch-console.md](../../features/dispatch-console.md))
and **nothing else**: no plan chain, no roadmap row, and not a word in
[project-goals](../../project-goals.md), every line of which was written for one consumer — the game.

Two facts make that gap expensive right now.

**This is the surface that reaches a phone.** It is the only one in the repo that does. The game cannot: a
pak built from SA assets is BC throughout and no mobile GPU has BC, which is the whole reason
[200](../200-platform-reach/readme.md) exists. The console already opens an `--rgba8` world today — no gate,
no pending concept. Meanwhile the project's entire mobile evidence base is **one synthetic row**, and 200
says so itself: *"nothing here has been run on the phone"*. Its step
[1/04](../200-platform-reach/1-device-truth/readme.md) deliberately refused to write a residency ceiling
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
| BC pak reference | 1,272,901,632 B at 1137 cells | [universal-texture concept](../../postmortem/universal-texture-transcode.md) |

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
| 2 | [Real device truth](2-real-device-truth/readme.md) | The first real mobile row in this repo, and it should be a row of what we intend to ship. Hands 200 the ceiling it refused to invent |
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
| 1/02 | [The protected list](1-the-map-profile/protected-list.md) | what may never be cut: cars, peds, sway, the day cycle, weather, one engine PC+mobile — each against what carries it, and whether losing it is silent |
| 1/03 | The pak profile | a build omitting only what 01 proved unread; bytes and resident MB before/after |
| 1/04 | The frame profile | every pass judged *kept / cheaper / removed*, with its ground |
| 1/05 | The streaming profile | rings anchored to the map focus — **and the per-cell geometric error the pak lacks** |
| 1/06 | The bundle | dead code only; kB before/after on the single-file artifact |
| **2** | **[Real device truth](2-real-device-truth/readme.md)** — the trimmed console on real hardware | |
| 2/01 | A phone-sized district pak | `--rgba8` over the pinned district, profiled vs unprofiled |
| 2/02 | Serve it from the shareable build | close the pak-worker chunk gap so a real `?src=` streams |
| 2/03 | The field run | **the repo's first real-world mobile benchmark row** |
| 2/04 | The residency ceiling, derived | the number 200/1-04 refused to invent, handed back |
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

Above all of it sits [202](../202-pcad-dispatch/readme.md)'s phase order: **0** measure (1–2), **1** the three
modes (6), **2** speak PCAD's protocol (+8), **3** the map becomes vibecode's module 10, **4** what PCAD owes
back (publish rate, positions on foot).

## What this chain does NOT own

[200](../200-platform-reach/readme.md) keeps all of it, and 201 duplicates none of it: universal texture
transcode and its concept gate, workers and `crossOriginIsolated` transport, the runtime read of the baked
collision, the WebGL2 fallback backend and its concept gate, and the game shell's touch controls. Where this
chain needs one of those, it says so and waits rather than building a second version.

The relationship runs the other way too: 200's phone-side steps are blocked on a device measurement nobody
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
| [1/01 The inventory](1-the-map-profile/readme.md) | **DONE 2026-08-09 — all three tables, on the pinned ground.** [The before-table](../../benchmarks/opensa-engine/2026-08-09-mobile-pinned-district-inventory.json): 414 frames / 153.9 s on `los-santos-centre`, 4/4 cells, `warnings` EMPTY — the first capture that is both clean and on the district this chain pinned. It supersedes the 08-07 Ganton row as the baseline (that row stays a valid measurement of Ganton, and is not its before/after partner). **33 fps · p50 30.3 ms · 110 draws · 265 k triangles · 148 MB resident**, and the two things the collector was extended to answer: **the frame is WAITING, not working** — the main thread runs 5.83 ms of a 27.56 ms frame (21.2 %), idle for 21.7 — and **it is not a half-rate vsync lock** either, because dt spreads over thirty bins with humps at 8–15 ms (25.6 % of frames) and 30–39 ms (41.8 %); a world that produces a 10 ms frame is not locked out of one. So the 94 % that had no owner on 08-07 is now four fifths **downstream of the CPU**, and no amount of loop tuning reaches it. Inside the body the largest item is **`overlay-2d` at 2.44 ms — more than `engine-frame`'s 2.10** — while drawing nine units, which is a finding for [5/02](5-symbology-and-picking-as-product/readme.md) rather than for the profile. The pak's texture ceiling for the same district is filed beside it ([99.7 MB as built, 23.4 MB if ASTC](../../benchmarks/opensa-engine/2026-08-09-district-texture-budget-los-santos-centre.json)). **BUNDLE HALF DONE the same day** ([the table](../../benchmarks/opensa-engine/2026-08-09-dispatch-bundle-inventory.json)): `dispatch.html` ships **501.5 kB raw / 166.5 kB gzipped** over six chunks, and the surprise is what dominates it — **react-dom at 44.1 %**, more than the whole engine (35.5 %) and four times the console's own code (11.0 %). The largest engine file after `engine.ts` is `hosek-wilkie-data.ts` at 33.4 kB, a tabulated sky model in a surface whose sky is a backdrop — the one line item [1/06](1-the-map-profile/readme.md) should price first. Dead code: one unused export, and the tool had to be repaired to say even that (`apps/dispatch` was missing from `knip.json`, so knip had never checked this app and called its whole tree unused). Two things the map ships from elsewhere, both small and both worth knowing: `apps/engine-lab`'s synthetic city (2.4 kB, what `?demo=1` builds) and **`apps/web`'s camera maths** (1.8 kB — `map-camera.ts` imports `cursorRay`/`forwardFrom`/`dollyStep`/`panStep` from the GAME app; permitted by the boundary lint, and still the map leaning on the game shell). **The BYTES table's instrument landed the same day**: every pak read now goes through one counted call (`postPakFetch`, `packages/engine/src/stream/pak-traffic.ts`) — the eager texture load, the streamer's cells and arrays, the collision source, and the loose `water.bin` the worker never sees — so the report carries `bytes` by entry kind, in WIRE bytes and request counts. A kind absent from that list is one no frame of this surface ever asked for, which is the gap the whole chain is written against. **AND THE BYTES TABLE CAME BACK THE SAME DAY** ([the capture](../../benchmarks/opensa-engine/2026-08-09-mobile-pinned-district-bytes.json), 799 frames with the camera worked down to street level): **36.4 MB read in 28 requests** — texture arrays **20 of 20, 99.9 % of the pak's whole texture payload**, water 2.66 MB in one read, 4 hd + 3 lod cell entries of the 8 the pak holds, and **collision: ZERO requests against a 49 870-triangle bake**. So the profile's hunt for unread entry KINDS finds exactly one, and it is the one [1/03](1-the-map-profile/readme.md) already suspected: the map runs no physics and never touches the baked collision — confirmed in code as well as in the capture (`bootDispatch` never reads `setup.collision`). Everything else the build contains, this surface reads in full: on textures the lever is the FORMAT and the cap, never selection. **THE STEP IS CLOSED** — frame, bytes and bundle, all three on the pinned ground, all filed before they were read. What the second capture also showed and the collector cannot yet answer: a **1068 ms body** on one frame (against 185.9 on the baseline), which is a cell build or upload landing inside `engine.frame`; the collector keeps per-segment means and only a whole-body maximum, so per-segment maxima are the next thing it owes. **Both were answered by reading the ENGINE instead of the console** ([the audit](../../audit/dispatch-engine-api-usage.md)): `StreamingDriver.update()` has always returned `StreamStats` — blob-handler and upload milliseconds, worst-call maxima, creates, evictions — and the console kept `pendingCells` and dropped the rest; `Engine.ledger()` has broken residency down by category since 074/01 and the console never called it. Both are in the report now, along with the worst body's own segment breakdown. The audit also lists ten capabilities the console does not use yet, each against the step that will want it — `setManualCells` (a capture with a PINNED cell set is an A/B without camera variance, which both 08-09 captures lacked), `listCells`, `unloadAll`, the debug line sets, `setMissingHighlight`, the frustum tests, and the whole vehicle-model path 5/04 will need. |
| [1/02 The protected list](1-the-map-profile/protected-list.md) | **DONE 2026-08-09.** Six rows, written before the first cut and each anchored to what carries it in code or data — the vehicle/ped model path, the baked sway amplitudes plus `windStrength`, the timecyc hour the console already drives, the weather mood and the lit world, `reflectionStrength` + `EnvProbe`, and one engine across PC and mobile. **Four of the six are SILENT if lost** (a still world, a duller reflection and a flat mood all render fine and pass every test in this repo), which is what makes the chain's closing field verdict an instrument rather than ceremony. The list also records what is NOT protected and why that is a decision: baked collision, which 1/01 measured at **zero requests**, is 1/03's candidate — conditionally on [5/04](5-symbology-and-picking-as-product/readme.md), because the day units are simulated rather than kinematic it comes back. Every later step now closes with a line naming what it touched from the list, normally `nothing`, and a step that does touch one owes the cheaper version it built instead — never a removal |
| the ASTC baseline | **TAKEN 2026-08-12** — [the capture](../../benchmarks/opensa-engine/2026-08-12-mobile-pinned-district-astc.json), 685 frames on the pinned district, `warnings` AND `errors` both empty. **Residency 74.9 MB against 148 on the rgba8 side of the same A/B**, with the texture category at **25.81 MB** — a quarter of the same texels, and within 0.4 MB of what [the texture budget](../../benchmarks/opensa-engine/2026-08-09-district-texture-budget-los-santos-centre.json) predicted for ASTC4x4. That is 200/2-02 paying off, measured. **The second reading of the same ledger is the one 1/03 should act on: `target` at 36.54 MB is now the LARGEST resident category, larger than every texture in the district** — render targets are a cost of RESOLUTION, and no trimming of the world touches them. The capture was only possible after a fix in the engine: `requireFormatSupport` computed its demand as `format !== RGBA8 ⇒ BC`, so an ASTC pak passed the manifest gate and was then refused per array on a GPU that carries ASTC — 20 of 20 arrays, `cellsTotal` 0, and a capture that VOIDed itself. `OSTEX_FORMAT_FEATURE` was already the rule; the second copy of it is gone, with both directions tested and the defect reintroduced to prove they catch it. **BOTH OF ITS OPEN QUESTIONS WERE CLOSED 2026-08-12, and neither answer was in the world.** `cellsCreated` 2454 was never churn: `StreamStats.created/evicted/lateCreates` are running totals the driver never resets, and the collector SUMMED them — four creates counted once per frame for the rest of a 685-frame window. Read, never summed, now; pinned by a test that fails at 400-for-4 on the reintroduced defect, and filed as [a restriction](../../restrictions/architecture.md) because the wrong number is plausible, self-consistent and *grows with the window*, so a longer capture makes it more convincing. And `target` 36.54 MB is now attributed [to the byte](../../benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json) — 23 textures summing to exactly the measured figure, **MSAA 4× being 23.99 MB of it (65.7 %), more than the whole district's textures cost after ASTC**. The reading that changes 1/03: **the category is FIXED COST** — resolution and sample count, nothing from the world — so it is the largest item only because the district is four cells, and it will be the same 36.54 MB on a full map while everything else grows. Largest, not first. The MSAA lever is [priced and not pulled](../../performance/deferred-optimizations/msaa-sample-count.md); the console gained `?scale=` and a `surface` block in the report, so the next capture states what it was drawn at instead of being annotated by hand. |
| [1/06 The bundle](1-the-map-profile/readme.md) | **DONE 2026-08-12 — and it CORRECTS 1/01.** [The table](../../benchmarks/opensa-engine/2026-08-12-dispatch-bundle-inventory.json): **506.5 kB raw / 167.6 kB gzip** over six chunks, against 501.5 / 166.5 on 08-09 — so 161 merged upstream commits reached this surface as **1 kB of gzip**, which is what the layer boundaries are for. Taken with an instrument that is now committed ([`bundle-inventory.ts`](../../debug/README.md)), because the 08-09 row was a one-off script and a before/after produced by two different scripts is not an A/B — and that is exactly how the hole was found: **the 08-09 table attributed 394.2 kB of a 501.5 kB bundle and lost `shaders.ts` (394.2 + 107.3 = 501.5 exactly)**. So the reading this chain has been carrying is wrong: `packages/engine` is **247.1 kB (48.8 %)** against **185.1 kB (36.5 %)** for react + react-dom + scheduler — the engine is the LARGER half of what a map downloads. What survives from 08-09 is narrower: `react-dom-client` at 170.4 kB is still the largest single FILE. **The step's own verdict: there is no dead code to cut.** knip's two unused exports are used inside their own files — the `export` keyword is what was dead, and un-exporting it saves zero bytes. What the bundle carries is live, and its one lever is [WGSL shipped as written](../../performance/deferred-optimizations/wgsl-source-text.md): comments and indentation are **22.1 kB gzip, 13.2 % of the download**, for a build-time transform that changes no shader — priced and NOT taken, because it moves every shader-error line number and cannot be verified without a GPU. |
| [5/01 Picking off the debug flag](5-symbology-and-picking-as-product/readme.md) | **DONE IN THE ENGINE 2026-08-12; the district number owed by the next field run.** `CellStore.debugPicking` is `CellStore.picking` — a named capability, no `debug` in it — and the three hosts that arm it (the console, the map viewer, the game shell's overlay) name the capability rather than the mode they think they are in. The [restriction](../../restrictions/architecture.md) is marked resolved in the same change. The half that made it more than a rename: **the capability had no price anywhere**, because what picking retains is CPU-side (the placement mapper's rows plus the cell index bytes a cell would otherwise drop after upload) while `Engine.ledger()` counts GPU residency — so every instrument in this repo reported it as free. `CellStore.pickingBytes` counts both halves and `?inventory=1` carries it as `world.pickingMb`, kept apart from `residencyMb` because they are different memories. Three tests, each half pinned separately and each verified by reintroducing a half-count. Still open and needing a device: `PLACEMENT_ROW_BYTES` is an accounting figure derived from the shapes allocated, not a heap reading |
| [5/02 Units as instanced symbols](5-symbology-and-picking-as-product/readme.md) | **THE COUNT IS DECLARED AND THE BOARD CAN REACH IT, 2026-08-21; the milliseconds are owed by [2/03](2-real-device-truth/readme.md).** Three things were true when this step opened and none of them was visible: the budget table's **150** existed in no line of code, the beacon buffers were a bare `MARKER_CAPACITY = 96` that **silently returned without drawing** past it (at 150 units a fifth of the shift would simply not have been on the map — no throw, no warning, no missing pixel), and **the board could not be loaded past nine units on any device**, so the number this step owes could not be taken at all. Now: `UNITS_ON_SCREEN = 150` in one place (`apps/dispatch/src/ops/budget.ts`, cited to the budget table above), the beacon buffers are allocated at it and **GROW** rather than drop — an allocation, never a ceiling ([directive 2](../../project-goals.md#2-legacy-limits-are-not-our-limits)) — with the growth counted into the report, and `?units=150&calls=40` seeds the board there. The desk half is [counted](../../benchmarks/opensa-engine/2026-08-21-dispatch-symbology-call-counts.json): at 150 units + 40 calls the overlay asked the canvas for **190 `measureText` and 190 `ctx.font` assignments EVERY frame** — a font-shorthand re-parse and a text measurement per chip per frame, for labels that never change — and now asks for **151 measures once and 0 thereafter**, one font assignment a frame. `fillText` is unchanged at one per chip: this step did not reduce the symbol count, and it should not — that is [3/03](3-the-operator-surface-on-a-phone/readme.md)'s decluttering rule. The report gained a `symbology` block (units, calls, symbols, chips, chips dropped, `measureText` calls, beacon capacity and growths) so the next capture **states the load it was drawn under** instead of leaving 2.44 ms to be read against an unknown symbol count. What is NOT done here and is named rather than quietly dropped: the units are still the chevron-and-chip pair on the 2D canvas, not an instanced draw, and whether that is needed at all is a question the ms at 150 answers first. Touched from [the protected list](1-the-map-profile/protected-list.md): nothing |
| [5/03 District names in the readout](5-symbology-and-picking-as-product/readme.md) | **DONE 2026-08-21 — and the answer was NEITHER option the step offered, because the question was posed wrong.** The console does not need the game layer's zone code: what `packages/game` owns is `ZoneNameSystem`, an ECS system tracking a PLAYER across frames, and this surface has no player. What it needs is one pure question — *what is at this point* — which is a property of `info.zon`'s FORMAT (the boxes nest; the SMALLEST containing one wins). So the rule moved to `zoneAt` beside the parser in `@opensa/renderware`, and three consumers read that one function: the game's HUD, the console's readout, and the pack that bakes the table. The game reaches it through a new `adapters/named-zones` — [the boundary lint](../../restrictions/architecture.md) caught the first attempt, which imported renderware straight into `zones/` — so `ZoneNameSystem` lost its private copy of the containment rule and this change **removes an owner rather than adding one**. **The fork question also hid the real obstacle, which was not layering:** `info.zon` holds GXT KEYS and the text is in `text/american.gxt`, two files of the game dir, and a surface streaming a pak over HTTP **has no game dir** — no import would have produced one name. So `opensa-pack` resolves them at build time into `districts.json` beside the pak (`manifest.districts`), the way the water bake rides beside it, and the general form is now [a restriction](../../restrictions/build-vs-runtime.md): a name taking two `data/` files to compute cannot be computed by a pak-only consumer. A click now answers **model, TXD, district and coordinates**; a call takes the world's own name for its spot; the hardcoded twenty-landmark table stays as the fallback and is labelled one. Cost: one small fetch at boot, a few tens of kB per build, and no districts at all on `?demo=1`, plan mode, an older pak or a game with no `info.zon` — a supported state, not a failure. `docs/contracts/mods.md` §7 records what a mod replacing either file changes, and that a misspelled GXT key ships the district under its own key, silently. Touched from [the protected list](1-the-map-profile/protected-list.md): nothing |
| [8/01 A position is a function of time](8-the-time-axis/readme.md) | **DONE 2026-08-22.** `UnitTracks` — a ring of samples per unit, column-wise (`t` u32 ms, `x`/`y`/`heading` f32, `status` u8), so a sample costs exactly **17 bytes** and the figure is a fact rather than an estimate of what an array of objects weighs. **A store beside the board rather than a field on `Unit`, and that deviation from the chain's own sketch has a reason**: `Operations` is an immutable snapshot and `stepOperations` a pure reducer, and a ring buffer cannot be immutable at a per-tick cost — so `Unit.at` stays the state at `ops.now` and the store answers every other T. Recording happens OUTSIDE the React state updater, because a side effect inside one runs twice under StrictMode and a track written twice cannot be scrubbed. The sampling policy is three rules, all from the feed rather than from taste: one sample per **4 s** (PCAD's own publish rate, read out of its source — the mock ticks at 20 Hz and recording at tick rate would make its tracks five times denser than the live feed's), a status change always samples, and a stationary run collapses to its two ends. **The number it owed** ([measured](../../benchmarks/opensa-engine/2026-08-22-dispatch-track-memory.json)): **17.51 MB for 150 units × 8 h, and the accounting is EXACT** — `arrayBuffers` moves by 17.51 against an accounted 17.51, which is the check 5/01 could not run on its own figure. Two readings matter more than the number: **it is HOST memory and may not be charged against the 300–500 MB ceiling** (that is `Engine.ledger()`, GPU bytes — the report keeps `tracks` apart from `residencyMb` exactly as it keeps `pickingMb` apart), and **`heapUsed` alone reports 0.2 MB for it**, because a typed array's backing store lives outside the V8 heap — the first version of the measurement watched only `heapUsed`, which is plausible, self-consistent and wrong, the same family as the 2454 cell creates. **The collapse turned out to buy history rather than bytes**: the ring is pre-allocated, so every scenario pays 17.51 MB and what differs is what it HOLDS — 8.0 h when all 150 move all shift, **24.0 h at a plausible 25 % duty cycle**. `SHIFT_HOURS = 8` is [a recorded hack](../../hacks/dispatch-shift-length.md), not a decision: the rate either side of it is measured and the unit count is the user's; this one nobody named. Touched from [the protected list](1-the-map-profile/protected-list.md): nothing |
| 1/03 … 8/04 (less 1/06, 5/01–5/03, 8/01) | not started. Execution order confirmed with the user: **the engine first** — the map profile and the phone, then everything above them. 1/03's first look is redirected by the ASTC capture's second answer: `target` is FIXED cost, so the pak — not the render targets — is where scale lives |

**Owed, and not yet paid:** the evidence table above is still somebody else's measurement, but this chain has
now taken one of its own — [the first real-world mobile row on a streamed SA
district](../../benchmarks/opensa-engine/2026-08-07-mobile-district-inventory.json) (31 fps, 239 MB resident
over 4 cells, Mali-G51). Two things it did NOT settle, and both gate work above: it was taken on the wrong
ground (Ganton, not the pinned district), and **94 % of its frame has no owner** — no `timestamp-query` on
this adapter and empty `spans`. The headline claim — a real district, on a real phone, in an operator's hands
— stays unproven until [2/03](2-real-device-truth/readme.md) records its row on the pinned district.

**The next action is a field run, and it is the user's**, because every measurement here reads
`build/<game>/opensa` and no container has one.

**The blocker that used to sit here is GONE, and the row said otherwise for eleven days.** On 2026-08-09 the
phone's `game-src/original` and its `build/phone*` output were symlinks into ONE folder, so the converter
rewrote the archives it was reading (`gta3.img` 1073 `.osm` bundles, `gta_int.img` 155 — measured with
[`img-census.ts`](../../debug/README.md)), and this table said 1/03 waits until they are restored. **They were
restored the next day**: both archives re-extracted from `Download/GTA CORP.rar` and verified `clean`, which is
recorded in [the 08-10 texture budget](../../benchmarks/opensa-engine/2026-08-10-district-texture-budget-los-santos-centre-astc.json)
— the first pak built from a restored source, 281 map objects converted where the damaged one gave 0 — and the
[08-12 ASTC baseline](../../benchmarks/opensa-engine/2026-08-12-mobile-pinned-district-astc.json) was taken on
it. `guardOut` refuses that configuration now and `npm run phone` checks it before deleting anything. So
**1/03 is not blocked on the game files; it is waiting its turn**, and the row is corrected here rather than
left to cost a session (`CLAUDE.md`: if the reading and the code disagree, the code is the truth and the doc
is the bug).

**Two variables moved between that capture and the 08-07 row, and the row must say so.** The ground changed
(Ganton → the pinned district) and, since [200/2-02](../200-platform-reach/2-universal-textures/readme.md)
landed, the phone workflow writes **ASTC** rather than RGBA8 by default — a quarter of the texture memory on
the same texels. So the pinned-district capture is the chain's **new baseline**, not a comparison against
239 MB / 31 fps: the old row was already off-series. What it must not do is claim a delta against it. The pak
records its own format now (`report.json` → `build.textures`), so the row can state which. `TEXTURES=rgba8`
takes the other side when the format itself is the question.
