# 201/3 — The operator surface on a phone

"It loads" is not "an operator can work it". The compact layout flips at ≤860 CSS px
(`apps/dispatch/src/ui/use-compact.ts` — a media query, because a phone in landscape, a narrow window and a
split screen all need the same treatment and none is reliably identifiable any other way) and it was verified
on an **emulated** Pixel 7 at 412×839 DPR 3. The only real phone in the record is 360×800, and
[200/4-04](../../200-platform-reach/4-mobile-runtime/readme.md)'s "360 CSS px" target has never been verified
for any surface.

## UI here is designed, not eyeballed

Before writing layout, choosing colour, or laying out state tiles, load the design skills — `artifact-design`
for composition, type, density and both themes, and `dataviz` for palette, stat tiles, legends and
readability. The shapes are exactly the ones those cover: the status bar is literally a KPI row (fps, cells
visible/total, draws, resident MB, pak build stamp, view position) and the call queue is a dense list carrying
priority and state.

What that has to produce:

- **one token set** — colour, type scale, spacing, priority states — in the app's existing
  `apps/dispatch/src/ui/styles.ts` (`styles`, `COLORS`), per the app's convention, not scattered per
  component;
- a palette that **passes contrast in both themes**, with call priority readable by more than colour alone;
- a **360 CSS px layout fixed before the code**, so 01 below checks against a specification rather than
  against a feeling.

## What already landed against this chain's rules, and what it changes here

**2026-08-22.** Chain 7 put an operator cluster, a nav cluster and a key sheet on the map before this chain's
360-px spec existed, and three of its controls were desk-shaped: 24-px map controls, 19-px list rows, and
zoom levels that lived only on keys `1`/`2`/`3` — which on a phone is a capability that does not exist. All
three are fixed, and the rule they broke is now
[a restriction](../../../restrictions/cross-platform-surface.md) plus a standing rule in `CLAUDE.md`: a
feature ships on a phone and on a desk in the SAME change.

What that leaves for **01** below is narrower and sharper than it was: the controls now take a
finger-sized target where the pointer is coarse (`useCoarsePointer()`, ≥ 44 CSS px) and the clusters cap
their width on a compact layout, but **nothing has been checked at 360 CSS px on the real phone** — the
clusters sit top-left and top-right of the same map, the sheet under it, and whether all of that leaves a
usable picture is exactly what this chain measures rather than assumes.

## Steps

### 01 — 360 CSS px

**DONE 2026-08-25.** The step's own premise held: the surface loaded on the phone for weeks and the user's
verdict was *"impossible to control"*.

**What the render at 360x800 found, and none of it was visible on a desk.**

| | Before | After |
| --- | --- | --- |
| Layout width in a 360-px screen | **403 px** | 360 |
| Elements past the right edge | 33 (the map, both bars, the sheet, 4 nav keys) | 0 |
| Controls under 44 in either axis | 9 | 0 |
| Map height at 360x800 | ~350 px | ~500 px |
| Map height at 740x360 (landscape) | **98 px** | ~210 px |

**The width was one root cause, and it is the reason the controls were unreachable rather than merely
small.** A `1fr` grid track keeps `min-width: auto`, so it cannot shrink below the widest row in its column
— the top bar's content came to 403 px, the single column took that width, and the map cell took it too.
Everything anchored to the map's RIGHT edge then sat past the screen: `⟳`, `▼`, `BLK` and `−`, with no
scroll to reach them, plus the `Auto` switch and the `ASSIGNED` state on every call row. `minmax(0, 1fr)` on
every flexible track fixes it; the three full-width bars take `minWidth: 0` + `overflow: hidden` so they
give way instead of pushing.

**The target sizes failed in the axis nobody checks.** The `Touch` tokens carried `minHeight` and no
`minWidth`, so `Fit` was 40 wide and the rate keys 33 — passing every review that measures height. The
compass was 42x42 (its padding fit a mouse), the two sliders **16 px tall**, and `Auto-dispatch` was a
native `<input type="checkbox">` at **13x13** — which no inline style can reach, so it is a button with
`aria-pressed` now.

**The map had no room left.** The tool cluster was ~380x390 permanently open over a ~350-px-tall map:
nothing in it is used every few seconds, so it opens from one `TOOLS` handle. The nav cluster keeps north
and zoom out and folds turn, tilt and the three levels behind one key — folded, never removed, since a
capability that lives only on a desk is what this chain exists to prevent. The sheet is capped
(`maxHeight: 44vh`) on an `auto` track rather than given a fixed 44 % of the screen, which had left ~200 px
of black under two calls.

**Landscape needed a third question.** Width said 740 px is roomy; the viewport was 360 px TALL, and the
sheet at its cap left the map 98 px. `useShortViewport()` sits beside `useCompactLayout()` and
`useCoarsePointer()` for exactly the reason the restriction gives for the other two — they vary
independently — and the sheet opens collapsed there, both counts still on screen.

**How it was measured, and what it does not prove.** A headless Chromium in the agent container at 360x800
DPR 2 with `(pointer: coarse)`, probing every element for a box past the viewport and every control for a
box under 44. That is a real 360-px render rather than a feeling, and the user's own screenshot shows the
same clipping — but it is not the phone, and **feel, thumb reach and safe-area insets are still owed to a
device**. Safe-area insets and one-handed reach for the repeated actions (dispatch, clear, centre) are what
remains of this step.

**Guard:** `apps/dispatch/src/ui/styles.test.ts` — the bare-`1fr` rule and the 44-in-both-axes rule over the
style table. The restriction closed by saying nothing here was caught by a test and that a lint over these
literals could be written "when this bites a second time"; this was the second time.

### 02 — Gestures on real touch hardware

Touch has no wheel, no second button and no hover, so three of the five desk gestures were re-cast rather than
mapped (`apps/dispatch/src/map/gestures.ts`): one finger pans, two fingers pinch to zoom and drag to orbit, a
long press opens a call. The canvas carries `touch-action: none`, without which the browser claims the drag
before a single `pointermove` arrives.

Verify on real hardware, and specifically the failures a mouse never produces: the browser claiming the drag,
a long press racing a pan, a two-finger orbit read as a pinch.

**Owes:** a scripted check in the shape of `scripts/debug/touch-controls-check.ts` — which drives real pixels
and is the only check that covers wiring rather than the overlay alone — or a stated reason it cannot be
scripted for this surface. **Expect the second answer**: that script drives Playwright, which is
effectively unavailable on the development machine ([development/termux.md](../../../development/termux.md)),
so the realistic form here is the real phone's own browser against `npm run dev` and a human reading the
result. Add its row to [`docs/debug/`](../../../debug/README.md) if something scriptable does land.

### 03 — Legibility at city zoom

Chips clamp to the canvas today and calls drop their title below 620 px, but **nothing declutters**: at a
city-wide view the symbology collides with itself. This is a density and label-conflict problem, so it is
solved by the `dataviz` rules, not by adjustment until it looks acceptable.

**Owes:** a labels-per-frame budget and a stated rule for which label wins a collision — plus what happens to
the loser (dropped, deferred, collapsed into a count).

**DONE 2026-08-22 — and the budget turned out not to be a number.** All three answers, in the order the step
asks for them:

- **The budget is the screen.** A viewport holds `floor(area / chipArea)` labels and the collision index
  cannot place past it however many are asked for — **1371 on a 1920×1080 desk, 152 on a 360×640 phone**. So
  there is no constant to choose and none to retune when the chip font changes, which is the same shape of
  answer [8/04](../8-the-time-axis/readme.md) reached for trails.
- **Which label wins:** the operator's own priority, derived from the job. The selection first (they asked
  for it), then open calls **worst priority first**, then units **committed to a call** before free ones,
  and distance from the eye breaking every remaining tie. Colour carries none of it — the rank decides an
  ORDER and the colour already means a status.
- **What happens to the loser:** its **symbol still draws** — an icon is the datum and is never dropped —
  and only its name goes. The count reaches the operator (`namesHidden` in the readout, *"104 names hidden"*
  in the status bar), because a crowded map with no count is one an operator reads as complete.

The mechanism is [MapLibre's](../../../links.md), including **variable placement**: a chip that cannot go
above its symbol tries below, then either side, before it is dropped. The index is grid-bucketed for the
reason theirs is — at 150 units an all-pairs test is ~11 000 comparisons a frame.

**The measurement** ([the census](../../../benchmarks/opensa-engine/2026-08-22-dispatch-overlay-census.json),
150 units + 40 calls spread over the viewport):

| Viewport | Labels placed | Dropped | Ceiling |
| --- | --- | --- | --- |
| 1920×1080 desk | **179** of 190 | 11 | 1371 |
| 360×640 phone | **86** of 190 | 104 | 152 |

One rule, and the screen decides — which is what makes it work at both ends without a phone branch. Whether
86 of 150 names reads as *enough* in an operator's hand is a field verdict, and the lever if it does not is
collapsing a cluster into a count rather than dropping its members.

### 04 — The floor, measured

`apps/dispatch/src/world/plan-mode.ts` already runs the same camera, gestures, symbology and board on a 2D
canvas with a projected ground grid when WebGPU is missing entirely, with a banner saying what is gone. Verify
it **on the same real phone**, so "the world is gone; the dispatcher's job is not" is a measurement rather
than a claim.

**Owes:** the plan-mode run recorded beside the 2/03 row.

## Verification

- Every check in this chain runs on the device from [2/03](../2-real-device-truth/readme.md), not on an
  emulator. The emulated Pixel 7 run stays in the record as what it is.
- The layout spec and the shipped layout agree.
- Contrast checked in both themes; priority never carried by colour alone.
