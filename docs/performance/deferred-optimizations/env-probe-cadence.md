# Env-probe cadence and resolution

**Status:** in reserve — already amortised once (074/16 step 2), can be cut further if the frame needs it.

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
