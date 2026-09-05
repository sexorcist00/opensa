# Env-probe cadence and resolution

**Status: PULLED 2026-09-05 — the quality-free variant, and only that one — and RE-ARGUED the same day.**
The refresh is gated on a reflective instance EXISTING (`Engine.hasReflectiveInstance`): no car, no faces.
The cadence, the face size and the resolution are untouched, so nothing here trades reflection latency or
sharpness — the two levers this card also offered stay in reserve below. **It buys nothing on the map
console**, for the reason below; it is kept for the game.

**WHAT MADE IT PULL-ABLE WAS THIS CARD'S OWN TRIGGER, AND THE TRIGGER WAS READ OFF A NULL ARM.** The card
asked for *"a frame where the probe is a top-3 line rather than a rounding error"*, and 201/9's ablation
sweep appeared to supply one: `?ablate=probe` measured **1.6 ms of a 21.5 ms frame** on the 2/03 phone. The
paired re-flight this card itself owed was flown on 2026-09-05 and found that number to be nothing at all
([the null arm](../../benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)).

**The sweep was taken on the map console, and the map console never assigns `Engine.probeCenter`** — only
`apps/web` and `apps/engine-lab` do. So `scheduleProbe` was already returning at its FIRST condition on every
console capture ever taken, the probe has never rendered a face on that surface, and `?ablate=probe` there
removes one store into a reused array and one counter tick. Flown five times as the null arm it is, the same
frame spans **18.11–20.58 ms**, with both `noprobe` windows sitting inside the `field` windows' own range.

**So the trigger did not fire, and this card's pull is retained on a different argument.** The gate is right
where the probe actually runs — the game, which feeds a centre every frame and renders a cube face every
other one for a car that may be nowhere on screen — and it costs nothing there that this card has not already
priced. What it is NOT is a console win: it removed nothing on the surface that motivated it, and no row may
cite it as one. The second half of the trigger ("a scene class where cars are rarely on screen") is still
true of the dispatch map; it simply never had a probe running to switch off.

**The debt this card recorded is therefore CLOSED, and the answer is the uncomfortable one.** The line it
owed read: *"the 1.6 ms above is what the ablation says it removes, not what a paired re-flight has
confirmed."* The re-flight confirmed 0.

**Impact: low, medium when the probe is hot — measured.** The probe's own benchmark rows read **0.23–1.94 ms**
and field frames have shown ~5.8 ms on a busy scene; halving the cadence halves that share. So it is a few
tenths of a millisecond in the ordinary case and low single-digit milliseconds in exactly the frame that
needed help. What caps it: on every field case so far the probe sat well behind the WORLD pass, so it can
shave a frame that is already close, not rescue one that is not.

**Effort: very low → low.** `PROBE_FRAME_INTERVAL` and the face size are constants — very low, and revert is
the same line. The variant actually worth taking (refresh only while a reflective vehicle is on screen) needs
a visibility answer in the frame loop, which is low and touches nothing else.

## What we do today

The vehicle reflection probe is a 128²×6 cubemap of the real world around the player, refreshed **one face
every 2 frames** (`PROBE_FRAME_INTERVAL`), so a full cube is 12 frames ≈ 100 ms at 120 Hz — invisible on
blurred paint. It is the reflection SOURCE for the neo car pipe: without it a car reflects an analytic sky
instead of the street it stands in.

## The lever

Spend less on it: a longer interval (one face every 3–4 frames), a smaller face, or refreshing only while a
reflective car is on screen and near.

## What it would win

The probe is its own line in the HUD and in every sweep — benchmark rows recorded **probe 0.23–1.94 ms**, and
field frames have shown it near 5.8 ms on a busy scene. Halving the cadence halves the amortised share, and
it is one constant.

## What it would cost

- Reflection latency: the reflected world lags the car. At 12 frames nobody sees it; at 24+ a car leaving a
  tunnel keeps the tunnel on its paint for a noticeable beat.
- Smaller faces show on chrome first — that path samples a sharper mip than paint does.

## What would have to be true to pull it

- A frame where the probe is a top-3 line rather than a rounding error. The field cases so far were GPU-bound
  on the WORLD pass with the probe well behind it.
- Or a scene class where cars are rarely on screen — which the "refresh only when a reflective car is near"
  variant serves without touching quality at all.

## Cheaper things to try first

- Gate the refresh on "a reflective vehicle is visible": it is free when there is nothing to reflect into.
- Check the probe mix (`params4.w`) is not making us pay for a probe the shader is blending away anyway.
