# GPU & shader restrictions

**Nothing in this file is visible to the test suite.** The fake GPUDevice (plan 077) records what the engine
asks for; it does not validate WGSL, inter-stage limits or uniformity. Every restriction here is enforced by
the browser at pipeline-creation time, i.e. by a black screen on the first real boot.

## A branch on a per-fragment value bans implicit-derivative sampling for the rest of the function

WGSL uniformity analysis: once control flow depends on a non-uniform value, `textureSample` is illegal for
the **remainder of the function** — not just inside the branch. The fix is to take `dpdx`/`dpdy` at the top
and sample every path with `textureSampleGrad`.

This closed plan 082 (`rigidTexel`): the first real boot failed on it, after a green test suite. **No test in
this repo can see this class of bug.**

**Caught:** no — by the browser, at boot.

## 16 inter-stage locations, and the rigid path stands at 15

The vehicle/ped vertex output uses 15 of the 16 available. There is room for **one** more varying; a plan
that wants two must pack or drop one first.

**Caught:** no — the fake device does not validate the limit.

## `@interpolate(flat)` switches whole triangles

See [`engine-lighting.md`](engine-lighting.md) — it is stated there because the case that produced it was a
lighting one, but it applies to any flat varying.

## `sampleCount` is 1 or 4 only

WebGPU offers no arbitrary MSAA ladder, and alpha-to-coverage needs 4.

**Caught:** no — by the browser.

## The one perf knob is `?scale=`

Render scale. There is no quality tier ladder and there will not be one: the 2026-07-21 ladder run proved a
~2 ms resolution-independent pass floor, so a tier below that buys nothing. A plan proposing quality presets
has to beat that measurement first.

**Caught:** n/a — a design decision, recorded so it is not re-proposed.

Detail for all of the above: [`edge-cases/engine-rendering.md`](../edge-cases/engine-rendering.md),
[`architecture/`](../architecture/).
