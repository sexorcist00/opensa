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
is read as a predicate now ([the issue](../../../open-issues/dispatch-map-void-no-cells-created.md)), and
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
is still unknown ([the open issue](../../../open-issues/dispatch-map-void-no-cells-created.md)), and both
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

**THE FREE HALF IS BUILT 2026-09-02; the number is the device's.** `BLOOM_LEVELS = 8` is gone and the count
is derived by [`bloomLevelsFor`](../../../../packages/engine/src/render/bloom-levels.ts) — halve until the
SHORTER edge falls under 16 px. At the pinned 720x640 that is **5 levels and 10 passes against 16**, six
full-screen passes removed; 6 levels at 1920x1080 and 7 at 3840x2160, which is the PC/mobile restriction's
shape exactly — a number the frame reads, from one line of code, never a branch it executes.

Three things the build settled:

- **The floor is structural, not taste.** The composite binds `upViews[0]` and there are `levels - 1` up
  views, so a one-level chain binds nothing. `BLOOM_MIN_LEVELS = 2`, and a pinned count is CLAMPED to it
  rather than trusted — an out-of-range arm would otherwise build a chain that cannot be bound.
- **The arm reports what was BUILT, not what was asked for.** `Engine.bloomChainLevels` reads the chain back
  and the report carries `surface.bloomLevels`, `bloomPasses` and `bloomPinned`, for the same reason
  `workingSetBytes` is computed rather than restated in 9/04.
- **The step's own arithmetic was one pixel out.** The dropped levels at 720x640 are **11x10, 6x5 and 3x3**,
  not 12x10 — 720 halves to 45 and then to 22, not 23. It changes nothing about the finding.

**The half-resolution prefilter was NOT built, and that is the step's own split holding.** It is the look
question, it was rejected once for sub-pixel emitters, and it is not touched until the derived count has a
number on the ladder.

**Owed:** `field` against `?bloomlevels=8` on the device — and note the arm runs BACKWARDS from 9/04's ladder,
because the default now carries the change: `field` minus `bloom8` is what the step bought. The panel serves
it as `bloom8`.

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

**BUILT 2026-09-02 at 10 Hz; the number and the look verdict are the device's.** The rule is
[`shouldBakeCloudField`](../../../../packages/engine/src/render/cloud-field-bake.ts), and the reason it is a
file rather than an early return is that **it needs BOTH of the patterns sitting beside it, and neither is a
fallback for the other.** The bake has two inputs of different kinds: `cloudScale` (`frame.cloudTop.w`) is a
STEP — the weather changes it and the field must change that frame, so it is KEYED like `refreshSkyLut`;
time is a SCROLL at `t * 0.004`, invisible frame to frame, so it is AMORTIZED like `scheduleProbe`. Keying
alone would freeze the drift; amortizing alone would hold a wrong field across a weather change for up to a
period.

`CLOUD_FIELD_HZ = 10` is the one number here that is chosen rather than derived, so it is named in one place
and it is an ARM — `?cloudhz=0` bakes every frame, which is the pre-9/06 behaviour and the side the default is
priced against. The report carries `surface.cloudFieldHz`.

**Owed:** `field` against `?cloudhz=0` on the device, and the look verdict this step named — that the clouds
still move at 10 Hz — taken on `field` rather than on the arm. The panel serves the arm as `clouds0`.

**Both arms were renamed before either flew, and the reason is worth keeping.** They were `?bloom=` and
`?clouds=` when they were built on 2026-09-02 — and both of those names have belonged to the GAME HOST since
074/09: `bloom` is bloom INTENSITY and `clouds` is cloud OPACITY
([the parameter table](../../../development/query-parameters.md)). Nothing would have collided at runtime,
because the console and the game are different pages and no test compares them — which is exactly what makes
it the chain's own kind of defect. What breaks is the RECORD: `?bloom=8` reads as "intensity 8" to anyone who
knows the engine, and a capture filed under that name could not be re-read a month later. They are
`?bloomlevels=` and `?cloudhz=` now, and `links.test.mjs` fails if a console arm is ever spelled with either
of the host's two names.

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
