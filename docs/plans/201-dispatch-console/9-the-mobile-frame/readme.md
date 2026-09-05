# 201/9 — The mobile frame, audited: the urgent optimization fixes

**Opened 2026-08-31, out of chain order, and it is URGENT rather than next.** Chains 1–8 are ordered by what
unblocks what. This one is ordered by what the device already measured and nobody has spent yet: it is a read
of the console's own captures against the code that produced them, and every step below is a fix whose win is
either already in a benchmark row or reachable by changing one constant.

The chain exists because the two most recent phone captures disagree with the story the repo has been telling
itself about where the frame goes.

| What the record says | What the captures say |
| --- | --- |
| *"a frame on this console is mostly its symbology"* — the 08-30 field round, quoted in [3/05](../3-the-operator-surface-on-a-phone/readme.md) and in `world/boot.ts` | The symbology's **CPU** is 3.09 ms. Turning it off moved the frame **48 → 24 ms**. The other ~21 ms is not in any span this repo records |
| MSAA is a **memory** lever worth 22 MB, and residency does not press ([msaa-sample-count](../../../performance/deferred-optimizations/msaa-sample-count.md)) | `target` is **59.87 MB of 96.45** — 62 % of residency and 2.3× every texture in the district — and the sample count also decides the **tile size** on the GPU this console runs on, which is a frame-time question nobody has asked |
| Render-on-demand rests a still console ([4/01](../4-a-console-is-not-a-game/readme.md)) | The mock board replaces itself **20 times a second**, and the gate compares it by identity — so it can never rest longer than 50 ms while the feed it stands in for publishes every **4 s** |

**The evidence, and it is ours.** Two rows, same device (MGA-LX3 / ARM Bifrost, DPR 2), same district, both
at the declared 150 units:
[2026-08-30 overlay A/B](../../../benchmarks/opensa-engine/2026-08-30-mobile-overlay-ab-150u.json) and
[2026-08-31 honest frame counter](../../../benchmarks/opensa-engine/2026-08-31-mobile-honest-frame-counter-150u.json).
Moving p50 **48 ms — 21 fps — against a declared 60**, with a CPU body of 10.3 ms. Nothing below is a guess
about a device; it is arithmetic on those two files plus a reading of the code that produced them.

**The instrument this chain is read by, and it was already in the captures.** There is no `timestamp-query`
on this adapter, so GPU time is not measurable — but the 08-31 row's **vsync ladder** (24 / 32 / 47 / 23 / 2
moving frames at 1 / 2 / 3 / 4 / 5 display intervals) is a quantized reading of the whole frame's cost, and
every step below moves it by a whole rung or it did nothing. With the CPU body at 10.3 ms and 36 % of frames
landing on the third interval, **~38 ms of a 48 ms frame belongs to something no span in this repo names.**
That sentence is the chain.

## The instrument the rest of this chain is measured with

**There is no `timestamp-query` on the 2/03 device and no browser flag brings it.** Both WebGPU flags were
enabled in Yandex Browser 26.6.2.117 and the browser cold-restarted on 2026-09-04: the adapter's feature list
came back byte-identical and the feature is still missing. It rests on timestamp support in the Vulkan queue
family, which this Bifrost driver does not offer, so the ceiling is below the browser
([edge-cases](../../../edge-cases/browser-runtime.md)). `report.passes` says `gpuPassMs` / `gpuPostMs` /
`gpuProbeMs` are unavailable and means it.

**So a pass is priced by its ABSENCE.** `?ablate=` removes one group from the frame and the same ten-leg
route is flown again; the difference in the window's MEAN is what that group costs. Read the mean rather than
p50 — p50 saturates on the 16.7 ms vsync floor, which is how
[04](#04--what-the-frames-attachment-set-costs-on-a-tiler)'s `scale75` arm nearly read as nothing.

**AND THE INSTRUMENT'S RESOLUTION IS ~2.5 ms, NOT THE HALF-MILLISECOND THIS CHAIN ASSUMED**
([the null arm](../../../benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json), 2026-09-05).
The half-millisecond was never measured; it was inferred from the frame count. It was measured the only way a
noise floor can be — by flying an arm that removes nothing — and the same frame came back five times at
18.11 / 18.40 / 20.17 / 20.58 / 18.13 ms. **So every arm in the sweep below under ~2.5 ms is a sample rather
than a measurement**, and this chain may not cite it as a cost: `noprobe` 1.6, `nocloud` 1.8, `noskylut` 1.0,
`bloom4` 0.2. What clears the floor, and what every conclusion this chain acted on rests on: **`nobloom` 7.7,
`nocells` 3.8, and 9/05's two levers at −2.4 and −4.4** — each of which also moved the vsync ladder by whole
rungs, which is the column to read when the mean is inside the band.

| arm | link | what it removes |
| --- | --- | --- |
| the streamed world | `?ablate=cells` | every resident cell's opaque and blend bundles — the cull still runs, so `draws` and `triangles` still report what WOULD have drawn |
| the cumulus bake | `?ablate=cloud` | [06](#06--the-per-frame-bakes-that-are-already-cached-one-line-above)'s 256² two-fbm pass. The world still SAMPLES the texture, so this prices producing it |
| the bloom chain | `?ablate=bloom` | [05](#05--the-post-chains-pass-count)'s 1 + 8 + 7 full-screen passes, whole |
| the chain's tail | `?bloomlevels=4` | the levels that are 12×10, 6×5 and 3×3 pixels at this surface — 05's actual lever rather than only a measurement |
| the env probe | `?ablate=probe` | **NOTHING on this surface** — the console never sets `probeCenter`, so the probe has never run here and this arm is the instrument's own control |
| the sky LUT | `?ablate=skylut` | what is left after its own input key short-circuits it |

`?ablate=` takes a list (`?ablate=bloom,cloud` is one arm removing both), an unknown name is ignored while
the rest of the list still applies, and **the report says what actually ran** in `surface.ablated` — the same
rule `surface.pinned` and `surface.sampleCount` exist for, and it matters more here because an ablated run
is otherwise indistinguishable from a fast one. Every arm is a `map_open` view (`nocells`, `nocloud`,
`nobloom`, `bloom4`, `noprobe`, `noskylut`), and since 2026-09-04 an attached console navigates ITSELF
between them, so a sweep costs no hands on the phone.

**What an ablation may and may not conclude.** It says where the time is. It does NOT say the answer is to
ship that pass off: the user's standing call (2026-09-04) is that frame time may not be bought with
resolution, sampling or anti-aliasing, and a picture that got worse is not an optimisation. What this chain
is allowed to remove is WASTE — a bloom level three pixels across, a bake whose input changes on a scale of
minutes, a sort of a static order repeated per instance per frame — and a change that alters the picture at
all goes to the operator as an A/B on the device before it is kept.

**THE SWEEP'S OWN HEADLINE, 2026-09-05** ([the row](../../../benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json)):
seven arms over one route, and the frame does not divide the way this chain assumed. **The bloom chain is
7.7 ms of a 23.4 ms frame** and its TAIL is free; **the whole streamed world — 96 draws, 242 k triangles — is
3.8 ms**, half of it. The per-pixel work of the post chain outweighs the per-triangle work of the city two to
one at map zoom, which is the sentence every step below should be read against: the frame is not expensive
because of how much world is in it.

## The rule this chain does not get to break

Every step here is a **budget the frame reads**, never a branch it executes, and never a second renderer —
[the PC/mobile restriction](../../../restrictions/architecture.md). A step that can only be expressed as
"on mobile, do something else" is the wrong step and gets rewritten. The
[protected list](../1-the-map-profile/protected-list.md) stands unchanged: nothing here cuts a living world,
it changes what a pass costs to produce the same one.

## Steps

### 01 — The overlay's missing arm, and the surface it draws on

**The finding.** `?overlay=0` halves the frame (48 → 24 ms p50) while the CPU it removes is 3.09 ms. The
remaining ~21 ms is unattributed, and the A/B cannot say what it is, because `?overlay=0` skips the
`clearRect` too (`world/boot.ts`, the `overlayOn` early return): the layer is never dirtied, so the browser's
compositor is free to skip it entirely. **The experiment conflates "we drew symbols" with "the second
full-screen layer changed this frame", and those are different costs with different fixes.**

Two suspects, and the step's whole job is to separate them before anything is built:

- **the layer** — a 720×1218 RGBA canvas cleared and re-composited over the WebGPU canvas every frame;
- **the content** — ~167 symbol paths and 32–153 chips rasterized every frame.

**The missing arm.** A third run of the same circuit: the overlay canvas cleared every frame, nothing drawn.
It costs a two-line branch and it is decisive — if that arm alone carries most of the 21 ms, the content is
innocent and the answer is the surface.

**What is already known to be waste in the content half**, whichever way the arm falls:

- the label plate is built by `roundRect` from four `arcTo` calls for a corner radius of **1 px**
  (`map/overlay-2d.ts`) — 153 chips × 4 arcs a frame for a rounding nobody can resolve. `fillRect` +
  `strokeRect`.
- every unit symbol is a fresh path — `save / translate / arc / fill / stroke / rotate / path / fill /
  restore` — at 150 of them a frame. The standard answer for a moving-map symbol layer is a **sprite cache**:
  render each `(colour × selected × stale)` disc-and-chevron once into an `OffscreenCanvas` and `drawImage`
  it thereafter, exactly the argument this file already makes one level down for `measureText` in `widths`.
  Chips take the same treatment keyed on `text|colour|selected` — a callsign is a callsign for a whole shift.

**And the cheapest lever of all, if the arm says "the surface":** the overlay is sized at DPR 2
(`world/boot.ts`, `overlay.width = clientWidth * dpr`). The symbols are vector shapes and the 44-px touch
target does not move — **drawing it at DPR 1 quarters the pixels rastered AND composited**, at a legibility
cost that is a look question for the device rather than a reasoning one.

**Budget:** the overlay's share of the frame, stated as a number, before any of it is rewritten.
**Owes:** the three-arm circuit (overlay on / cleared-only / off) on the 2/03 device with the vsync ladder for
each; then the DPR-1 arm; then, only if the content half is guilty, the sprite cache with a before/after.

**FLOWN 2026-08-31, AND IT CAME BACK HALF-ANSWERED** —
[the row](../../../benchmarks/opensa-engine/2026-08-31-mobile-map-circuit-arms.json), app `4ce659b` over the
pinned district, all three arms on the same six-pose route through the panel's MCP channel. Neither
subtraction can be taken from it, and the reason is a prerequisite this step did not know it had: **the
drawing buffer moved under the circuit.** The browser's viewport changes as its chrome collapses and returns
— 720x1218, 720x864, 720x746 and 720x640 inside one session, a 1.9x spread in pixels — so `cleared` and
`engine` priced two different surfaces and their difference is not the layer. **A capture has to state the
size it was taken at and HOLD it**, which `overlay.width = clientWidth * dpr` (`world/boot.ts`) cannot; the
same prerequisite belongs to [04](#04--what-the-frames-attachment-set-costs-on-a-tiler)'s `?scale=` arm and to
[05](#05--the-post-chains-pass-count)'s derived pass count, both of which are read off a pixel count.

What the two arms that reached a world do say, and it is not nothing: the empty-board map runs a moving
**p50 of 32 ms (31 fps)** on both, at viewport sizes 1.9x apart — so **the frame does not track pixels over
this range** (`engine` at 720x864 was p50 50 ms while `cleared` at 720x1218, 1.9x the pixels PLUS the second
layer cleared every frame, was 32), the `overlay:clear` span itself costs **0.0016 ms** of CPU, and **`target`
is a function of the viewport rather than a constant** — 59.87 MB at 1218 tall, 43.01 at 864, 32.35 at 640,
which is exactly where this chain's quoted 59.87 comes from.

**And the third arm — `field`, THE FIELD RUN itself — is VOID, twice.** The console fetched cell bytes (8
requests / 5.29 MB, then 4 / 2.64 MB on a fresh load) and created **no cell**: `cellsCreated` 0, `pendingCells`
0 and then stuck at 4, `errors` empty, the screen black. A `map_goto` — a wake, a flight and drawn frames, so
`world.follow()` ran — did not clear it, which rules out the render gate sleeping through an arrival; the same
three links streamed 12 and 28 cells on the other two arms minutes earlier, which rules out the pak and the
district. The only thing that reports it at all is the collector's own `VOID: no cells streamed` warning.
**Diagnosing that void comes before re-flying the circuit**, because the arm it kills is the one every other
number in this chain is meant to be subtracted from. **DONE the same day, and it was not the streamer:
[4/01](../4-a-console-is-not-a-game/readme.md)'s render gate was resting on an unfinished world.** Texture
uploads drain only inside a drawn frame (`drainUploads`, 1.5 ms, called from `world.follow()`), `has(ref)`
stays false until the last write lands, so the cell is not created, `pendingCells` does not move, no other
signal moves either — and the frame the gate skips is the one that would have finished the upload. `pending`
is read as a predicate now ([the issue](../../../open-issues/fixed/dispatch-map-void-no-cells-created.md)), and
the field arm's confirmation is the first thing the re-flight owes.

**THE CIRCUIT IS TAKEN, 2026-08-31, and both subtractions are ZERO** —
[the row](../../../benchmarks/opensa-engine/2026-08-31-mobile-map-circuit-pinned.json). Three fresh pages,
one six-pose route each, `?surface=720x640` holding the drawing buffer while the CSS box moved 550 → 491 →
609 → 320, windows taken as the delta of two histogram readings so boot sits outside them:

| arm | moving p50 | p90 | p95 | p99 |
| --- | --- | --- | --- | --- |
| `engine` — no overlay at all | 32 ms | 52 | 54 | 64 |
| `cleared` — the canvas dirtied, nothing drawn | 32 ms | 52 | 56 | 66 |
| `field` — the overlay's pass, empty board | 30 ms | 50 | 54 | 66 |

**`cleared` − `engine` = 0 ms: the LAYER is free.** A second full-screen RGBA canvas cleared and
re-composited over the WebGPU canvas every frame costs nothing measurable on this device, and the
`overlay:clear` CPU span reads **0.0006 ms**. **`field` − `cleared` = −2 ms**, inside noise and against an
arm that ended on a lighter view (48 draws / 124 k triangles against 112 / 278 k), so it is not claimed as a
win either. **So the ~21 ms this step opened on — what `?overlay=0` removed in the 08-30 A/B — is neither
the surface nor the empty pass. It is the CONTENT**, which is `board` − `field` and
[5/02](../5-symbology-and-picking-as-product/readme.md)'s turn, and the exit this step was told not to take
(symbology into the 3D pass) is now worth pricing rather than guessing at.

**And the number nobody asked for is the one that matters most.** With nothing drawn over it, the map runs
**p50 30–32 ms — 31–33 fps against a declared 60** — and it does so on a view that is MOSTLY EMPTY: the pak
carries four cells (500x500 units) and the route flew at 450–900 m, where the frustum reaches far past
them (the operator's correction, and it is recorded in the row). A loaded district can only be worse. So
half the budget is gone before a single unit is on screen and before the world is really there, which puts
the remaining time exactly where the rest of this chain says it is — [04](#04--what-the-frames-attachment-set-costs-on-a-tiler)'s
attachment set, [05](#05--the-post-chains-pass-count)'s sixteen full-screen bloom passes and
[06](#06--the-per-frame-bakes-that-are-already-cached-one-line-above)'s per-frame cloud bake, every one of
them paid per pixel and per pass whether or not there is anything to draw. **The next circuit needs ground
that is actually loaded**: a camera kept low enough to stay inside the rect, or the 16-cell
`los-santos-wide` pak this chain already added for the purpose.

**Both prerequisites were built the same day, and neither is a frame fix.** `?surface=WxH` pins the drawing
buffer at that many device pixels whatever the viewport does (`world/capture-surface.ts`), the report says
`surface.pinned` so a capture states which way it was taken, and the panel's four measurement links carry
`surface=720x1218` — this phone's full-screen buffer, the largest of the four sizes seen, so no arm comes out
cheap for having been measured in a smaller window. Beside it the VOID now names its cause: `StreamStats`
carries `blockedOnBlob` and `blockedOnArrays`, so the next occurrence reads *"4 cells want a level, 1 waiting
on their geometry blob, 3 on a texture array"* — the RING, the fetch path and the upload path being three
different failures the report could not tell apart. **That is an instrument, not a repair**; the void's cause
is still unknown ([the open issue](../../../open-issues/fixed/dispatch-map-void-no-cells-created.md)), and both
reach the device with the next `prebuilt/opensa-webapp.tar.gz`.

**And the circuit carries NO BOARD since 2026-08-31** (the user's call — THE FIELD RUN is the map, and the
map is optimised first). That changes which subtraction answers which half, and it is a better split than the
one this step was written with: all three arms open at `units=0&calls=0`, so **`cleared` − `engine` is the
LAYER** exactly as before, while **the CONTENT moves to `board` − `field`** — measured against a run that
carried none of it rather than inferred out of one that carried both. The sprite cache and the DPR-1 arm are
questions for the content half, which means they are questions for `board`'s turn rather than for this one.
**The exit this step must not take:** moving the symbology into the 3D pass as instanced quads plus a glyph
atlas — MapLibre's model, and the honest end state — is a **plan**, not this step. It is what 5/02 is for, and
it is only worth opening once this arm says the content is the cost.

### 02 — The mock publishes at the protocol's rate

**The finding.** `ops/use-operations.ts` ticks at `TICK_MS = 50`, and `stepOperations` returns a freshly
spread object every tick (`ops/sim.ts`). `RenderGate` compares the board by IDENTITY (`a.ops === b.ops`), so
**the board forces a draw 20 times a second** and render-on-demand cannot rest longer than 50 ms on a console
whose feed publishes every **4 s** ([202 §4](../../202-pcad-dispatch/readme.md), read out of PCAD rather than
chosen). The mock runs at **80× the rate of the interface it is a stand-in for**, and every 150-unit number
this chain has taken was taken under that churn.

This is not the mock being generous. [8/02](../8-the-time-axis/readme.md) already decided a track **steps**
rather than slides; a 4-second step of ~110 m is what the real feed does and what the map is required to show.
Publishing at 20 Hz is the console rehearsing a behaviour it has ruled out.

**Priced beside it, on the same clock:** `ops/history.ts` rebuilds `trails()` — a `Map` plus **one
`Float32Array` per unit** — and `fixAges()` — a `Map` of 150 — on every tick, both `useMemo`d on `ops`. At
150 units that is ~3 000 typed-array allocations a second on the phone's main thread, for data that changes
once every four seconds.

**Budget:** the board's tick is the feed's rate, from `PUBLISH_INTERVAL_MS`, with a query override for a
capture that wants the old churn back.
**Owes:** the circuit re-taken at the protocol's rate — `framesSkipped`, the vsync ladder, and the battery
half [4/01](../4-a-console-is-not-a-game/readme.md) still owes. **On the MAP run, not the 150-unit one**
(2026-08-31): the rate is the board's and the board is empty there, so what this step buys the map is the
whole of the rest — a still map wakes only for the camera. The 150-unit re-take is `board`'s, and it is the
one that answers what the churn was costing the symbology. **Every earlier 150-unit row becomes a
measurement of the mock rather than of the product, and this step says so in each of their notes rather than
retiring them.**

### 03 — Board work runs on the board's clock, not the camera's

**The finding.** `world/boot.ts` calls `beacons.update()` and `unitModels.update()` inside every DRAWN frame.
Neither reads the camera. `beacons` refills twelve line buffers and issues twelve `updateDebugLines`;
`unitModels` writes 150 root matrices, allocates a `Set` and an array over the roster, and calls
`engine.updateVehicles()`. All of it depends on `ops`, `selection` and `trails` alone — **and the dirty flag
is already computed one block above, by the gate that decided to draw.**

So panning an unchanged board repeats the whole board layer at the display's rate. Measured share today:
`board` 0.60 ms of a 5.11 ms body (08-30), 0.42 ms diluted (08-31). Small in absolute terms and **entirely
avoidable**, and after 9/02 it is the difference between running four times a second and 20.

**Budget:** the board layer runs when the board changes, and the camera never causes it.
**Owes:** `board` → ~0 on a frame that only moved the camera, in the same capture as 9/02's.

### 04 — What the frame's attachment set costs on a tiler

**The finding, and it is the one with the largest unexplained number behind it.** The scene pass renders into
`rgba16float` at `MSAA_SAMPLES = 4` (`render/pipelines.ts`) with a `depth32float` at 4× (`engine.ts`). That is
a **per-pixel working set of 48 bytes** — 32 for colour, 16 for depth.

Arm's published guidance for the GPU family this console runs on (Bifrost/Valhall) puts the tile buffer at
**128 bits — 16 bytes — per pixel for a 16×16 tile**; a pass that needs more makes the driver shrink the tile,
and the per-tile fixed costs multiply. **48 bytes is three of those budgets.** The MSAA resolve itself is
already done correctly (`resolveTarget` with `storeOp: 'discard'`, depth discarded too), which is exactly why
this has stayed invisible: the cheap half was taken and the expensive half was never priced.

[`msaa-sample-count.md`](../../../performance/deferred-optimizations/msaa-sample-count.md) weighed this as
**memory** and closed with *"whether Mali's driver elides it is unknown"*. The frame-time half is missing from
it, and that is the half that matters at 21 fps. Two facts have also moved since it was written: `target` is
now **59.87 MB of 96.45** (62 % of residency, 2.3× all the district's textures), and the console has a
measured frame rate to be judged against.

**Three arms, each one constant, each read off the vsync ladder:**

| arm | working set | what it separates |
| --- | --- | --- |
| `MSAA_SAMPLES = 1` | 12 B/px, and no resolve | the tile configuration whole |
| 4× MSAA, `SCENE_FORMAT = rgb10a2unorm` | 32 B/px | the price of `rgba16float`, with the anti-aliasing kept |
| `?scale=0.75` / `0.5` | linear in pixels | fill-bound against tile-bound |

**And the correction this step owes to a neighbour.**
[`render-scale-tier.md`](../../../performance/deferred-optimizations/render-scale-tier.md) refused the
resolution axis on a measurement taken on an **M3 Pro** — an immediate-mode GPU, where the pass floor is
vertex/draw and resolution buys 0.4–1.4 ms. That conclusion does not transfer to a tiler, where the same knob
changes the tile COUNT linearly. Its own reopening condition — *"a genuinely slower GPU class becomes a
target; then re-run the ladder there first"* — is met, and this step is that re-run.

**Budget:** stated in [1/04](../1-the-map-profile/readme.md)'s terms — each arm is *kept / cheaper / removed*
with its ground, and the winner is a NUMBER the frame reads per surface, never a mobile branch.
**Owes:** the ladder for each arm on the 2/03 device, a look verdict on the aliasing from the phone at map
zoom (`CLAUDE.md`: a look change is judged in the engine, not on a desk), and — **if the tile-size hypothesis
is confirmed** — a new row in [`restrictions/gpu-and-shaders.md`](../../../restrictions/gpu-and-shaders.md)
in the same change, because it is structural, it is SILENT (the frame is correct, every test passes, and it is
invisible on every desktop GPU in this project's benchmark series), and nothing in the repo currently states
it. It does not go there before the measurement: an unmeasured vendor rule is not our restriction.

**THE LADDER IS BUILT 2026-09-01; the numbers are the device's.** The sample count and the scene format left
`render/pipelines.ts` and became a [`RenderBudget`](../../../../packages/engine/src/render/budget.ts) — a
CONSTRUCTOR input, because every pipeline is compiled against them, every cell's render bundle is recorded
against them and the env probe allocates against them, so an arm is a page load rather than a key press.
`?msaa=1` and `?scene=rgb10a2unorm` on the console; **the third arm needed nothing built** — `?scale=` is
`Engine.renderScale` and has existed since 2026-08-12, which is what the deferral file already said.

Three things the build settled that the step had left implicit:

- **One sample removes a TEXTURE, not just a resolve.** `ensureTargets` skips `msaa-color` whole and the
  world pass writes `scene-color` directly (`sceneColorAttachment`, the one owner both the world pass and the
  probe's faces read — a `resolveTarget` on a one-sample view is a validation error, and a `storeOp:
  'discard'` there throws the frame away). That is where the ~22 MB and the resolve bandwidth actually go.
- **The residency figure follows the FORMAT.** The target accounting multiplied a literal `8` bytes per
  pixel; `rgb10a2unorm` is 4, so the format arm would have come out looking free on the memory axis while
  halving it. `sceneBytesPerPixel` is read by the scene targets, the bloom chain and the probe alike.
- **`msaa=1` loses alpha-to-coverage**, because WebGPU has no such thing at one sample — the third leg of the
  074 alpha-edge fix, on every cutout pipeline. It lives in `multisample()` beside the count rather than
  restated at fourteen pipelines. It is not a reason to skip the arm; it is why the arm owes a LOOK verdict
  from the phone at map zoom as well as a number.

**A refused value falls back to the DEFAULT, per half** (`capture-budget.ts`, 10 tests): `?msaa=2` is not a
neighbouring sample count, it is the default, and the report says so. The report's `surface` block carries
`sampleCount`, `sceneFormat` and `workingSetBytes` — 48 by default, computed rather than restated — so a row
cannot claim an arm it did not run, which is the same rule `surface.pinned` exists for.

**The panel carries four new links** — `msaa1`, `rgb10a2`, `scale75`, `scale50` — each of which is `field`
plus exactly one parameter, and `links.test.mjs` fails if an arm differs from the field run by anything else
(it strips the added parameter and compares the whole URL). tsc clean, eslint 0 errors, 683 tests across the
console, the engine and the panel.

**Owed, and it is the whole of the next device session:** the ladder itself — `field` (the baseline the
2026-08-31 pinned circuit already filed at moving p50 30 ms) against the four arms, each on its own fresh
page over one route, with the vsync ladder for each; **over LOADED ground**, which the 08-31 circuit was not
(four cells, flown at 450-900 m where the frustum reaches far past them). Then the look verdict on `msaa1`,
and - only if the tile-size hypothesis is confirmed - the row in `restrictions/gpu-and-shaders.md`.

**The device half was attempted the same day and did not happen, for a reason worth writing down rather than
retrying blind.** The phone pulled `main` at `0fa9cf9`, the `webapp` job unpacked the archive stamped
`32b2f64`, and the static server came up on :3001 — and then the ngrok tunnel died between `map_open`
launching the console and the console reporting back. Every call after that answered *"the phone is not
answering"*, and **a running agent session cannot take a new tunnel address**, so the ladder is owed by a new
session with `npm run panel:tunnel` restarted first. Two things learned on the way that the next attempt
should not re-discover: the pak on the device is `rect 5,-7,6,-6` — **four render cells**, which is exactly
the empty-sky problem this step inherited from 9/01 — and `npm run phone` refuses to serve it unless asked
with `VEHICLES=admiral,comet,infernus`, because the job's default names three cars the pak does not carry.

**THE LADDER IS FLOWN, 2026-09-04, AND THE HYPOTHESIS IT WAS BUILT ON IS THE ONE THING IT DID NOT FIND** —
[the row](../../../benchmarks/opensa-engine/2026-09-04-mobile-map-attachment-ladder.json), app `60e290f`,
five fresh pages one parameter apart, each flown the same ten-leg route inside the loaded rect with
`?surface=720x640` pinned, each window the delta of two histogram readings taken after a four-corner warm-up:

| arm | B/px | scene px | moving p50 | mean | p90 | p95 | on rung 1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `field` | 48 | 460 800 | 20 ms | 24.5 ms | 38 | 48 | 54 % |
| `msaa1` | 12 | 460 800 | 18 ms | 21.6 ms | 36 | 36 | 66 % |
| `rgb10a2` | 32 | 460 800 | 16 ms | 20.2 ms | 34 | 36 | 73 % |
| `scale75` | 48 | 259 200 | 18 ms | 21.0 ms | 34 | 36 | 72 % |
| `scale50` | 48 | 115 200 | 16 ms | **16.5 ms** | **18** | **24** | **95 %** |

**The tile-size hypothesis is NOT confirmed, so the row this step owed
[`restrictions/gpu-and-shaders.md`](../../../restrictions/gpu-and-shaders.md) is NOT written** — the step
said it goes there only if the measurement confirms it, and an unmeasured vendor rule is not our restriction.
If 48 B/px against Bifrost's 16 B/px tile budget were the frame, `msaa1` — one tile budget, and no resolve —
would have won the most. It won the least of the three arms that moved bytes. **`rgb10a2unorm` at 32 B/px
beat `msaa1` at 12 B/px while KEEPING 4x MSAA**, and the pair is what names the cost: one sample re-tiles the
scene pass and changes nothing downstream (`scene-color` stays `rgba16float`), while the format halves the
bytes of every full-screen pass that READS that texture. **The frame is the post chain's BANDWIDTH, not the
scene pass's tile configuration** — which is [05](#05--the-post-chains-pass-count)'s sixteen bloom levels
plus the post pass, now promoted from an argument to a measurement.

**And the resolution axis is the only one that moves a whole rung.** `scale50` is the sole arm that reaches
the declared 60: 95 % of its frames on ONE display interval, p90 18 ms against the baseline's 38. **Read the
MEAN rather than p50** — p50 saturates on the 16.7 ms vsync floor and hides the shape — 24.5 -> 21.0 -> 16.5
across 100 % -> 56 % -> 25 % of the pixels, so **at least 8 ms of the baseline's mean scales with pixel
count**, and that is a lower bound because `scale50` is already sitting on the floor. `scale75` ALONE would
have been filed as a weak lever (-3.5 ms of mean, no rung moved): the response is strongly non-linear against
a quantized display, and one arm of a ladder is not a ladder.
[`render-scale-tier.md`](../../../performance/deferred-optimizations/render-scale-tier.md)'s refusal was
taken on an M3 Pro at 0.4-1.4 ms; its own reopening condition is met and this is the re-run it asked for.

**What this step does NOT decide, and must not be read as deciding.** `rgb10a2unorm` is UNORM — it cannot
hold a scene value above 1.0, so adopting it is a change to the HDR chain and this ladder does not claim it
is free. **The honest next arm is `rg11b10ufloat`**: the same 4 bytes, the float range kept, and this adapter
reports it renderable (`rg11b10ufloat-renderable` is in the device's own feature list in every snapshot of
this run). It is not in the ladder because it was not built.

**The look verdict is VOID, and finding out why is the best thing this session did.** The operator judged
`msaa1` on the phone at map zoom — *"noticeably worse: low resolution and no anti-aliasing"* — and then, an
hour later, said the map had not looked right from the very first link. It had not. **The camera framed for
the drawing BUFFER while the browser stretched that buffer into the CSS box**, so `?surface=720x640` inside a
360x550 box rendered a world for an aspect of 1.125 and displayed it at 0.655: **the whole map ~1.7x too
tall**, circles as ellipses, on every pinned page all evening. Picking rode the same number, so a thumb
landed where nobody aimed it.

**Every NUMBER in this chain survives it** — the GPU did identical work whatever the canvas was stretched to,
and all five arms carried the same pin — and **every look verdict taken through a measurement link does not**,
`msaa1`'s included. Fixed the same day (`canvasAspect`, `world/capture-surface.ts`, 5 tests): the camera reads
the displayed box, which is a no-op on any surface that does not pin, and under a pin renders anamorphically
so the stretch restores the geometry. **SILENT in the full sense** — it typechecks, it lints, every test
passes (this is geometry, not behaviour), and it cannot be seen on any shipping surface. It was found by an
operator's eye and by nothing else.

What remains true after the fix: a pin costs vertical RESOLUTION (640 stretched into ~1100), so **a look arm
is flown UNPINNED and a number arm is flown pinned — two different flights**, and `map` is the unpinned link.
And the pin STAYS at `720x640` rather than going to the full-screen `720x1218` (re-decided with the operator,
2026-09-04): 1218 was tried on 2026-08-31 and **Android killed the tab part-way through the circuit** —
`target` residency 59.87 MB against 32.35, ~27 MB added to a ~98 MB total — and 640 also lands this series on
the existing 150-unit row, which was taken at `canvasPixels` 460 800. The aliasing half of the verdict stands
on its own (one sample loses MSAA and alpha-to-coverage on every cutout pipeline) and is moot anyway, since
`msaa1` is not the arm the numbers point at.

**Method notes the next ladder should not re-discover.** A leg is measured in SCREENFULS (`fly.ts` travels
1.2 of them a second), so 150 m legs at ~310 m of span last under half a second: a first six-leg attempt
yielded **58 moving frames**, against ~400-475 for ten ~300 m legs at 180-220 m. Every arm is warmed over the
rect's four corners before its first reading, so the ~29 cell creates inside each window are re-creates
rather than a cold stream. **The panel could not switch arms by itself** — `map_open` would not cover an attached
console (`opener.mjs`) and the `open` job cannot run while the `phone` job holds the server, so this
five-arm ladder cost four human touches, one per switch. **FIXED the same day**: an attached console now
navigates ITSELF when `map_open` asks for a different view (a `navigate` command over the bus it is already
answering on), so the next ladder is a sequence of tool calls in one tab. And **a backgrounded tab keeps answering the bus while
`requestAnimationFrame` stops**: `scale50` recorded a 32 s `dtMax` from exactly that, outside its moving
window, and the tell is `frames` and `framesSkipped` both standing still between two snapshots.

### 05 — The post chain's pass count

**The finding.** `BLOOM_LEVELS = 8` is a constant, and the prefilter runs at FULL resolution, so the chain is
**1 + 8 + 7 = 16 full-screen render passes**, plus the world pass, the cloud-field bake and the post pass —
**19 render passes a frame**. At the 720×640 the captures were taken at, the last three bloom levels are
12×10, 6×5 and 3×3 pixels: on a tiler each of them still costs a whole pass's tile flush and reload, for a
mip smaller than a chip.

The standard shape is the one this chain's own tent-upsample came from (Jimenez, *Next Generation Post
Processing in Call of Duty: Advanced Warfare*): prefilter at half resolution, and derive the level count from
the render size, stopping at ~16 px. That is 16 passes → ~9 without touching the look of the levels that
matter.

Half-resolution prefilter was rejected once —
[the render-target attribution](../../../benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json),
for sub-pixel emitters. That argument is strong for a street camera and much weaker for a map camera at
400–900 m, and it is a per-surface budget number rather than a branch. **The level COUNT was never argued at
all**, and it is the free half.

**Budget:** the pass count is derived from the render size, not written down.
**Owes:** the ladder with the derived count, then with the half-res prefilter, and a look verdict on the
emitters at map zoom before the second one is kept.

**MEASURED 2026-09-05, AND THE FINDING ABOVE IS WRONG ABOUT WHERE THE TIME IS**
([the sweep](../../../benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json)). Two arms, one
route, same rect and pin as the 09-04 ladder:

- **`nobloom` — the whole chain off — is 15.75 ms against the baseline's 23.44.** The chain is **7.7 ms of a
  23.4 ms frame**, and without it **607 of 614 frames sit on ONE display interval**: the only change measured
  on this device that reaches the declared 60 fps.
- **`bloom4` — the chain cut from 8 levels to 4 — is 23.21 ms, which IS the baseline.** The four levels that
  arm removes are exactly the ones this step called waste (12×10, 6×5, 3×3 px here). They cost **nothing
  measurable**.

So the tile-flush argument does not survive its own measurement: on this device a pass over a 3×3 mip is
free, and the 7.7 ms belongs to the FIRST levels — the full-resolution prefilter and the first one or two
downsamples, every one of them reading `scene-color` at or near full size. That is the same conclusion
09-04's `rgb10a2` arm reached from the other direction (halving the bytes of every full-screen pass that
READS the scene texture won more than removing 4× MSAA from the pass that WRITES it): **the frame is the post
chain's bandwidth**.

**What this step becomes.** Deriving the level count is not the lever and building it would buy ~0. The lever
is the SIZE the chain starts at and how many full-resolution reads of `scene-color` exist at all — which is
the half-resolution prefilter this step listed second and the 2026-08-12 attribution rejected for sub-pixel
emitters at street level. That rejection is now the thing to re-price, at map zoom, with a look verdict; the
level count is a tidy-up with no frame time in it.

**BOTH LEVERS BUILT AND FLOWN 2026-09-05**
([the row](../../../benchmarks/opensa-engine/2026-09-05-mobile-bloom-levers.json)), against a `field`
baseline re-flown BETWEEN them at **21.52 ms** — the same baseline read 23.44 and 23.66 earlier the same day,
so the arms are subtracted from the one in their own thermal window and not from the sweep's:

| arm | what it changes | mean | Δ | rung 1 | target MB |
| --- | --- | --- | --- | --- | --- |
| `field` | nothing | 21.52 ms | — | 67 % | 32.35 |
| `bloomrg11` | the chain's targets → `rg11b10ufloat` | **19.16 ms** | −2.4 | 80 % | 29.42 |
| `bloomhalf` | the pyramid starts at half size | **17.16 ms** | −4.4 | **91 %** | 27.95 |
| `bloomboth` | both | 17.38 ms | −4.1 | 90 % | 27.22 |

**`bloomhalf` is the first change measured on this device to put roughly nine frames in ten on ONE display
interval** (p90 22 ms against 36), and neither arm buys that with resolution, sampling or anti-aliasing: the
world is still drawn at full size into a 4× MSAA `rgba16float` scene and the post pass still writes every
pixel. ~~**They do NOT stack**: the combined arm reads 17.38 ms against half-res alone at 17.16 — the same
number.~~ **RETRACTED 2026-09-05 by the null arm.** That sentence rested on a **0.22 ms** difference, and this
device's ablation floor is **2.47 ms**
([the row](../../../benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)) — the two arms are
indistinguishable, which is not the same claim as "they are the same number". Whether the format stacks on
top of half-res is **unmeasured**, and on the code argument it should: `rg11b10ufloat` halves the bytes of
every pass in the chain whatever resolution the chain starts at. And the ladder says why that is a floor rather
than a disappointment: 90–91 % of frames already sit on ONE display interval in both, and a mean cannot go
far under 16.7 ms while the display is what it is. **Further bloom work on this device buys nothing** — the
next millisecond has to come from somewhere else.

**What is NOT settled is the look, and it is what decides whether either ships.** The daylight A/B at hour 10
is indistinguishable, and that proves nothing: the cost `bloomhalf` is known to carry is sub-pixel EMITTERS,
because at half resolution the bright-pass threshold runs on a 2×2 average and a street light one pixel
across is diluted below it. That is a night question, so the night pair was built and shot the same day (`night` / `nighthalf`, hour 22,
differing by the arm alone — a test pins it) and is with the operator.

**THE VERDICT CAME THE SAME DAY AND THE STEP IS DONE.** The operator looked at the night pair on the device
and chose the half-res arm, so **the console's default is `bloomPrefilterScale: 0.5`** — 17.16 ms against
21.52, and **91 % of frames on one display interval** where the shipped default had 67 %. `rg11b10ufloat` is
NOT shipped with it: it adds nothing measurable on top (17.38 against 17.16) and stays an arm and the
fallback for a surface that cannot take the look change.

**What that overturns, and how.** The
[2026-08-12 attribution](../../../benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json)
kept the prefilter full-res *"on purpose (074/09) so sub-pixel emitters survive thresholding; at night that
is every street lamp and every headlight, and dimmer emissives are a protected-list item"* — and that
reasoning is exactly right about the cost. It was not argued away: it was **looked at**, at hour 22, on the
device, in a pair differing by this one field. **A protected-list item is released by a field verdict and by
nothing else** ([1/02](../1-the-map-profile/protected-list.md)).

**Scoped to the console.** The verdict was taken at map zoom, 180–220 m, looking down; the refusal it
overturns was written for a street camera, and the GAME still reads `DEFAULT_RENDER_BUDGET` untouched. The
previous default stays reachable as `?bloomscale=1` (panel link `bloomfull`), because a default that moved
without leaving its predecessor re-flyable would make every earlier row unrepeatable.

**AN EARLIER BUILD OF THIS STEP EXISTS AND IS SUPERSEDED — do not resurrect it (recorded 2026-09-05).**
A branch (`claude/chain9-desk-work`, built 2026-09-02) carried a `bloomLevelsFor` that halved until the
shorter edge fell under 16 px and made that the DEFAULT, plus a `?bloom=8` arm to put the constant back. It
was never merged, and the sweep flown three days later refuted the hypothesis it was built on: the tail it
cuts measured **0.2 ms — noise**. What shipped instead is the ceiling-and-floor above, where the floor
defaults to 1 px and therefore cuts nothing until a caller asks — because the levels are textures and bind
groups, not frame time. **The branch's version would ship a look change to buy a number the device says is
not there.** Its arm names were `?bloom=` / `?clouds=` before a rename, which is its one lasting
contribution: both belong to the GAME HOST and have since 074/09
([the parameter table](../../../development/query-parameters.md)), so a capture filed under `?bloom=8` could
not be re-read a month later. The stale-table restriction that came out of the same branch is
[kept](../../../restrictions/architecture.md).

### 05b — The vendor levers, adapted (Arm and Bjørge)

**Built 2026-09-05, both as ARMS, neither as a default.** 201/9 was argued from vendor material recorded in
[`docs/links.md`](../../../links.md), and two of its recommendations had been read but not implemented. They
are now in the budget, reachable from the panel, and pinned by tests that assert they reach the FRAME rather
than merely the report — the lesson of the null arm one step above.

| lever | what it is | link | what it changes |
| --- | --- | --- | --- |
| `bloomDownsample: 'dual5'` | the downsample half of **dual filtering** — Bjørge, *Bandwidth-Efficient Rendering* (SIGGRAPH 2015), Arm's own kernel for this Mali family, URP 17's `Dual` mode | `bloomdual` | **13 taps → 5** at every level of the chain |
| `postPrecision: 'f16'` | Arm's `mediump` guidance — their ALUs run half width at roughly 2× | `bloomf16` | the bloom and post COLOUR maths; every coordinate stays `f32` |
| both | — | `bloomvendor` | the only arm with a chance of clearing the floor |

**The adaptation is the point, and it is where the honesty is.** Dual filtering also replaces the UPSAMPLE
with an 8-tap kernel and drops the per-level blend — and that half does not transfer, because our chain is
already a pyramid whose look comes from `mix(support, tent, radius)` at every level, while Bjørge's headline
speedup is measured against a Gaussian. So the downsample kernel comes across, where the argument is
arithmetic (**eight fewer texture fetches per pixel per level**, on a chain this chain measured as
bandwidth), and the upsample stays ours. That caveat was already written into `links.md` when the material
was recorded; this step is what it looks like honoured.

**The f16 half is scoped by the same discipline.** Colour is half width; **every coordinate is not**, and a
test fails if one ever becomes so: an `f16` UV resolves to ~1/2048 near 0.5 against a texel offset of 1/1440
here, so tap positions would collapse into each other and the kernel would sample the wrong texels. The
godray walk — twenty accumulated steps — is `f32` for the same reason. Storage is untouched (the targets are
already 16-bit float), so an f16 accumulator rounds to what the f32 one was stored as.

**Neither ships as a default, and the reason is this session's own measurement rather than caution.** The
device's ablation floor is **2.47 ms**. `dual5`'s saving is texture fetches on a chain that, after
`bloomhalf`, is a few milliseconds whole; `f16`'s is ALU on a pass this chain established is *bandwidth*.
Neither is expected to clear the floor alone, which is why `bloomvendor` exists — and if the combined arm
does not read above the noise either, **the honest conclusion is that they are unmeasurable on this device,
not that they are zero.** `dual5` additionally owes a LOOK verdict: five taps blur less than thirteen, so
each level's support tightens, and the standing call sends that to the operator on the device.

**FLOWN THE SAME DAY, AND THE PREDICTION ABOVE HELD**
([the row](../../../benchmarks/opensa-engine/2026-09-05-mobile-vendor-levers.json)). Four windows, bracketed,
each arm sampled twice, in ONE browser tab navigated between arms — which closes the tab-count confound the
null arm left open that morning:

| order | arm | mean | moving | rung 1 | p90 |
| --- | --- | --- | --- | --- | --- |
| 1 | `field` | 17.42 ms | 558 | 89.6 % | 26 |
| 2 | `bloomvendor` | 16.83 ms | 578 | 93.1 % | 20 |
| 3 | `field` | **16.89 ms** | 576 | 92.2 % | 20 |
| 4 | `bloomvendor` | 17.86 ms | 546 | 87.2 % | 30 |

**INDISTINGUISHABLE.** field spans 16.89–17.42, `bloomvendor` 16.83–17.86 — the ranges overlap and the
slowest of the four windows is a vendor window. Nothing ships: both stay arms, and `DEFAULT_RENDER_BUDGET`
and the console budget are untouched.

**AND THE FIRST PAIRING WOULD HAVE LIED, WHICH IS THE PART WORTH KEEPING.** Windows 1 and 2 alone read
**−0.59 ms** with the vsync ladder moving 89.6 → 93.1 % and p90 26 → 20 — the exact shape of a real win, and
on the ladder rather than only on the mean, which is the column this chain trusts most. Window 3 is the
baseline re-flown: **16.89 ms, 92.2 %, p90 20.** The ladder had moved with the WARM-UP, not with the arm.
That is the second time in one day that three windows agreed on a false story, and the discipline that caught
it both times is the same one: bracket the arm with its own baseline and sample both twice.

**The noise floor here is ~1.0 ms, against the null arm's 2.47 ms that morning** — so **the floor is a
property of the SESSION, not a constant of the device**, and it is measured per session rather than carried
over. Both numbers are larger than either lever.

**What this does NOT say.** It does not say the levers do nothing. `dual5` provably issues eight fewer
texture fetches per pixel per level and `f16` provably halves the colour ALU; the frame does not notice,
because after 9/05's half-res prefilter 90 % of frames already sit on ONE 16.7 ms display interval and a
lever worth tenths cannot be seen from under a vsync floor. **No look verdict was sought for `dual5`**: a
change that buys no measurable frame time does not get to spend one.

**Why they are kept rather than deleted.** One extra pipeline compiled at boot and one module chosen at
init. They are the record that the vendor guidance was implemented and tried, and a device with
`timestamp-query` — or a surface not already pinned to the vsync floor — could still price them.

**What was checked and found ALREADY DONE**, so no work was spent on it: the tiler's attachment rules, which
are Arm's first recommendation and the cheapest to get wrong. The world pass clears rather than loads
(`loadOp: 'clear'` on every attachment in the engine), its 4× MSAA colour resolves and **discards** the
samples, and `depth32float` is `depthStoreOp: 'discard'` — so nothing writes a multisample attachment back
to memory. A compute-shader bloom was ruled out before it was written, and stays ruled out: AFBC cannot
compress storage images, so a compute chain surrenders framebuffer compression exactly where a tiler is
bandwidth-bound.

### 06 — The per-frame bakes that are already cached one line above

**The finding.** `engine.frame()` opens a `cloud-field` render pass **every frame, unconditionally**
(`engine.ts`): 256² with two fbm evaluations per pixel, for a field that scrolls at `t * 0.004` and is
visually identical for minutes.

Both patterns it needs are in the same function, within twenty lines: `refreshSkyLut()` keys its input and
returns early when nothing moved, and `scheduleProbe()` amortizes over `PROBE_FRAME_INTERVAL`. The cloud
field uses neither. It is the clearest case in this chain of a solved problem sitting beside an unsolved copy
of itself.

**Budget:** a bake whose input changes on a scale of minutes is not paid at the display's rate. Name the
rebake rate (a few Hz) before building it.
**Owes:** the ladder with the bake amortized, and a look verdict that the clouds still move.

**BUILT AND VERIFIED 2026-09-05.** The bake now runs when the field has MOVED, at a rate that is DERIVED
rather than picked: the 256² texture covers `12 × 0.45 × clump` units of field space, so one texel is that
over 256 and the scroll is `‖(0.004, 0.002)‖` per second — **one texel every ~4.7 s**, and half a texel of
travel is the threshold. That bound is not "it looks the same" but "the difference cannot be stored". The
clump scale is part of the KEY rather than the timer (a weather change invalidates however recent the last
bake was, exactly as `refreshSkyLut` keys its own input), and the test is on absolute travel rather than a
deadline because the console scrubs its clock and time may run backwards.

**The verification is a PAIR, and the pair is the lesson.** Re-flown minutes apart on the fixed app,
`field` − `nocloud` is **0.34 ms** where it was **1.83 ms** before: the pass is gone. The absolute mean did
NOT improve (23.44 → 23.66) — the two absolutes are forty minutes apart in one session and the device
drifted by about the size of the win, which is now a rule in
[the benchmarks readme](../../../benchmarks/readme.md): an arm is subtracted from a baseline flown in the
same thermal window, and a fix is never judged by comparing today's absolute with an earlier one.

**PRICED 2026-09-05: the bake was 1.8 ms** — `nocloud` reads 21.61 ms against the baseline's 23.44
([the sweep](../../../benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json)), and it moves 8 %
of the window's frames onto the vsync floor (rung 1: 67 % against 59 %). **It is the cheapest honest fix in
this chain**: unlike the bloom result it changes no pixel anybody can see, because the field it re-bakes is
identical for minutes. The amortized version still owes its own arm and a verdict that the clouds move.

**AND THE TWO PASSES THIS STEP HOLDS UP AS THE SOLVED EXAMPLES ARE NOT THE SAME CASE — the code read settles
which is which, 2026-09-05.** The sweep priced what is LEFT of each after its own amortization at `noprobe`
**1.6 ms** and `noskylut` **1.0 ms**, and the first thing to say is that those two arms were flown ~40 minutes
after their baseline, inside the same session whose `field` drifted 2.1 ms across the day. So the numbers are
a band, not a reading — which is exactly why the next move was to READ THE CODE rather than to fix anything.

- **The probe is real IN THE GAME and has never run here — and that took a paired re-flight to find out
  (2026-09-05, [the null arm](../../../benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)).**
  `PROBE_FRAME_INTERVAL` is **2**: a cube face renders every OTHER frame, in its own submit, and on a map
  with no car on it the whole cube would be rendered for nobody — so it was fixed by demand rather than by
  cadence (`Engine.hasReflectiveInstance`, 3 tests), which is the variant
  [the lever's own card](../../../performance/applied/env-probe-cadence.md) called the free one.
  **The gate is correct and it bought nothing here**, because a condition ahead of it was already true:
  `apps/dispatch` never assigns `Engine.probeCenter` — only `apps/web` and `apps/engine-lab` do — so
  `scheduleProbe` has returned at `!probeCenter` on every console capture ever taken. `?ablate=probe` on this
  surface skips one store into a reused array and one counter tick. **It is a NULL ARM, and its 1.6 ms was
  the instrument.** Flown five times, the same frame reads 20.17 / 18.40 / 20.58 / 18.13 / **18.11** — a
  2.47 ms spread whose first three windows look exactly like a clean, thermally-bracketed 2 ms effect.
- **The sky LUT cannot be what its arm says.** Its key is QUANTIZED (`skyLutKey`: elevation × 200, the
  colours × 100) and this console's hour is static unless an operator moves it, so `refreshSkyLut` builds a
  string and returns early on every frame after the first — microseconds, not a millisecond. Its 1.0 ms is
  the drift band, and there is nothing there to fix. **It is left alone deliberately**: a "fix" for a pass
  that is already an early return would have been a change with no defect behind it.

**AND THE SKY LUT'S CASE IS NOW THE GENERAL ONE.** That paragraph reasoned its way to "this arm cannot be
what it says" from the code, and declined to fix a pass that was already an early return. The probe turned
out to be the same shape and was NOT caught the same way, because a plausible fix existed for it. The rule
that falls out, and it is the chain's most useful product: **an ablation arm must be proven non-null before
its number is read** — check what the pass is gated on in the HOST, not only in the engine. A null arm
produces a perfectly ordinary capture with a believable number in it, and nothing anywhere complains.

**AN EARLIER BUILD OF THIS STEP EXISTS AND IS SUPERSEDED — do not resurrect it (recorded 2026-09-05).**
The same unmerged branch (`claude/chain9-desk-work`, 2026-09-02) carried a `shouldBakeCloudField` keyed on
the clump scale and amortized at a `CLOUD_FIELD_HZ = 10` it called *"the one number here that is chosen
rather than derived"*. It had the two-input insight right — a STEP that invalidates and a SCROLL that
amortizes are different questions, and neither is a fallback for the other — and `cloudFieldDue` above keeps
exactly that. What it did not have is the derivation: the field scrolls one texel every ~4.7·w seconds, so
rebaking at half a texel of travel bounds the error by **what the texture can represent at all** rather than
by a rate somebody liked. A chosen 10 Hz is a hack owing `docs/hacks/` a file; the travel bound owes nothing.
The derived rule also survives the console scrubbing its clock backwards (201/8-03), which a deadline does
not.

### 07 — The per-frame allocations, and one capability that retains what it never reads

Small, individually boring, and all of them on the phone's main thread every frame.

- **`submeshDrawOrder` re-sorts a static order per instance per frame** (`engine.ts`). For the OPAQUE phase
  the key is `submesh.array` — a constant of the model — and `submeshVisible`, which changes only when
  `setSubmeshVisible` is called. At 150 units × two phases that is ~300 arrays of objects, 300 sorts and 300
  `.map()`s a frame, for an order that is the same every time. Cache it on the instance and invalidate it in
  `setSubmeshVisible`. **This is NOT
  [the batching lever](../../../performance/deferred-optimizations/vehicle-submesh-draw-batching.md)** — that
  one is about draw COUNT, is high-effort and stays parked; this is CPU and GC, and it is a small change.
  It is the most likely owner of `engine-frame`'s body at the declared count.
- **`new Float32Array(104)` per frame** for the frame uniform (`engine.ts`), plus the `bundles` / `blendCells`
  arrays with their `.sort().map()`. All three are fields.
- **`unitModels.update` allocates a `Set` and an array over the roster every call** — which after 9/03 is
  every board tick rather than every frame, but is free to remove either way.
- **`cells.picking` retains `indexData` that this console never reads.** `pick()` resolves against placement
  bounds alone; the index bytes exist for `hidePlacement` / `breakPlacement`, which only the map viewer calls.
  `pickingMb` is 1.18 at four resident cells and grows with the district. Split the capability so a host that
  only picks does not pay for hiding.

**Budget:** none of these changes a pixel, so each is judged on the body alone.
**Owes:** `engine-frame`'s body before and after, in the same capture as the rest of the chain.

## What this chain does NOT own

- **Moving the symbology into the 3D pass** (instanced quads, glyph atlas). That is
  [5/02](../5-symbology-and-picking-as-product/readme.md)'s end state and a plan of its own; 9/01 only decides
  whether it is worth opening.
- **The vehicle draw-batching lever** — parked, priced, and left parked
  ([the deferral](../../../performance/deferred-optimizations/vehicle-submesh-draw-batching.md)).
- **A quality-tier ladder that picks for the operator** — refused
  ([render-scale-tier](../../../performance/deferred-optimizations/render-scale-tier.md)); 9/04 re-runs its
  MEASUREMENT on a tiler, and does not reopen its policy.
- **Anything 200 owns** — universal textures, workers, the WebGL2 backend.

## The order, and why it is this one

0. **THE FIELD RUN IS THE MAP** (the user's call, 2026-08-31), which is a reordering rather than a step: the
   circuit below is flown with `units=0&calls=0`, and the declared 150 units are their own link and their
   own turn. Every window this chain reads is a window with nothing over the map but its own layer — which
   is what 9/04, 9/05 and 9/06 were always about, and what 9/01's two subtractions get cleaner for.
1. **9/01's third arm** and **9/02** first: both are one constant, both are free, and both can rewrite what
   every later number means. Measuring anything else before them is measuring the mock.
2. **9/03**, because it is small and it is the other half of 9/02.
3. **9/04**, then **9/05**, then **9/06** — the GPU side, one arm at a time, each read off the ladder. In this
   order because 9/04 is the largest unexplained number and the cheapest to test.
4. **9/07** last: it is the only group whose win is certain and small, so it must not be allowed to absorb the
   session that the uncertain, large ones need.

### The symbology layer, priced — and the sprite that could not be seen (2026-09-05)

**The operator's report opened this**, not a plan: 150 label plates, too large, growing when the call drawer
was hidden. The size was a canvas bug ([architecture.md](../../../restrictions/architecture.md)); the density
was [3/03](../3-the-operator-surface-on-a-phone/readme.md)'s. What is 9/01's is the third finding underneath
them — **`overlay-2d` at 6.17 ms of an 11.65 ms CPU body was an UNATTRIBUTED REMAINDER**, because the split
inside it counted down after three frames and had been silent about the steady state since it was written.

Made permanent, it says the span is `overlay:symbols` and almost nothing else (`overlay-2d` 0.19,
`overlay:clear` 0.16, `overlay:sketches` 0.07). So the layer's own draw is the frame's largest CPU line, and
it now has a name.

**The sprite change, and the honest result.** 9/01 already listed "a fresh path per unit symbol per frame
where a sprite cache is the standard answer" as known waste, and that is what was built: each mark
rasterized once by variant and blitted per instance, which is MapLibre's icon atlas and deck.gl's
`IconLayer`. Two measurements, in this order:

| | 150 marks |
| --- | --- |
| [desk control](../../../benchmarks/opensa-engine/2026-09-05-desk-canvas-symbol-arms.json), headless Chromium | blit **~0.275 ms** against path **~0.32** — cheaper in all three paired invocations |
| [the device arm](../../../benchmarks/opensa-engine/2026-09-05-mobile-symbol-sprite-arm.json), six windows | **INDISTINGUISHABLE** — board 7.014 / 6.162 / 5.971, nosprites 6.429 / 6.103 / 6.542 |

**The desk number predicted the device's null**: 0.03–0.06 ms of effect against a ~1 ms session spread was
always going to be invisible. The device sequence is the more useful half — the first four windows fall
monotonically while the arm alternates, so windows 1–2 alone read a confident **−0.58 ms** that the bracket
then refuted. Third time in this chain.

**And the finding that outlives both is what they rule OUT.** 150 marks cost ~0.3 ms of canvas work at a
desk. Even at a large device penalty that is one or two of these six milliseconds, so **the drawing is a
minority of the span and no drawing-side lever can move it.** The rest is what the layer does per unit
*around* the drawing — two projections and their allocations, `gtaToEngine` twice, `aheadOf`, a colour string
built per unit per frame, a cache key built per unit per frame, a hit-area object, a rank object — 190 times
a frame at ~50 fps.

**Next here is not an optimisation, it is a split**: `symbology.render` gets the same treatment
`overlay-2d` just got, and the 6 ms is attributed before any part of it is touched. Making that split
permanent is the whole reason this line stopped being a remainder, and the same move is owed one level down.

**And that split was taken, and it named the cost.** `sym:units` **4.07 / 4.18** (two windows), `sym:labels`
1.57, `sym:calls` 0.77, `sym:scale` 0.25 — summing to 6.66, inside the range the six sprite windows had
measured for the whole span, so the split reports the cost rather than adding one. A unit came to **27 µs**
and a call to **19** while a unit does roughly twice the drawing, which is the same conclusion from a third
direction: nearly flat per entity where the drawing per entity is not.

### 08 — The load, removed: instancing and the per-unit path (2026-09-05)

Two changes, both aimed at what the split had just named, and both measured against an empty map re-flown
three times across the session (**20.03 / 20.43 / 20.25 ms** — a 0.4 ms spread).

**[Instancing the unit models](../../../benchmarks/opensa-engine/2026-09-05-mobile-vehicle-instancing.json)**
— the [frame audit](../../../audit/frame-path-vs-aaa.md)'s top item. A vehicle is a part hierarchy, so every
part was its own draw per car; opaque order is decided by depth, so a run of consecutive slots drawing the
same submeshes is one draw per submesh however many cars are in it. **11 810 → 3 571 draws, triangles
identical at 1 488 514.** `multi-draw indirect` and `bindless` are WebGPU proposals, so this is plain
instanced `drawIndexed` — which is what the audit named as the honest first move.

**It shipped INERT the first time and that is the more useful half of the step.** The run key asked whether
every submesh of a car was visible, and nothing ever is: `apps/dispatch` hides all of them and re-shows the
body set, the game's handle does the same for extras and damage. Every car failed the key, every car was
drawn alone, and the device returned **11 810 — unchanged to the unit** while seven new tests passed. They
exercised the mechanism rather than the configuration every caller produces. The fix was smaller than the
mistake: `opaqueOrder` already IS the set an instance draws, so interning it per model makes the comparison
one integer.

**[The per-unit allocations](../../../benchmarks/opensa-engine/2026-09-05-mobile-per-unit-allocation.json)** —
three objects per entity per frame (`gtaToEngine`'s array, `project`'s point, the hit rect), ~190 times a
frame at ~50 fps. `projectInto(x, y, z, out)` writes into a point the layer owns, the hit rects are pooled
and reused, and the concatenation that copied every rect every frame went with them.

| | before | after |
| --- | --- | --- |
| `sym:units` | 4.04 ms | **1.62** (−60 %, same mark count) |
| CPU body at the board | 11.04 | **7.86** |
| frame at the board | 26.30 ms | **23.81** |
| board over the empty map | +6.1 ms | **+3.6** |

**p50 did not move** — 18 ms both sides. Half the frames were already landing on one display interval and
still are; what this bought is the other half, and p95 says so (50 → 38): a tail losing collector pauses
rather than a floor moving.

**So the board is no longer where the frame goes**, and the 20.2 ms empty map is the whole remaining budget.
The post chain is the biggest thing in it — see [the handoff](../handoff.md), whose first instruction is to
re-fly `nobloom`, because the 7.7 ms that makes it the largest item prices a chain the console stopped
running when the half-resolution prefilter became its default.
