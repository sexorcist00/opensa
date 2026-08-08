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

## Steps

### 01 — 360 CSS px

What fits, what collapses into the tabbed sheet, and what is simply off. Safe-area insets (the game's touch
overlay already uses `env(safe-area-inset-*)`), and one-handed reach for the actions an operator repeats —
dispatch, clear, centre.

**Owes:** the layout spec, and the same three checks the desk layout gets: nothing clipped, nothing
unreachable, nothing that requires hover.

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
