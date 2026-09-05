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

## A texture array that GROWS invalidates every render bundle recorded against it

`TextureArrays.load(ref, bytes)` returns the EXISTING handle when `ref` is already resident — it never
replaces. To change an array you must `unload(ref)` then `load(ref, …)`, and that mints a new `GPUTexture` +
`GPUBindGroup`. Every cell bundle recorded earlier still holds the OLD bind group, whose texture is destroyed.

So **any design that welds incrementally must re-create the cells that sample a changed array**, not just
re-upload the array. The pak path never meets this (its plan is sealed at build time and arrays are static);
anything welding at runtime does, because `TexturePlanner`'s plan grows as more cells weld.
`apps/sa-map-viewer/src/world/cell-renderer.ts` handles it by tracking each ref's uploaded layer count and
re-creating every resident cell **from cached `.oscell` bytes** when one changed — the upload, not the weld.

**Caught:** NO, and worse than silent — a stale bind group is a use-after-destroy, so the symptom is
whatever the driver does next (garbage texels, a validation error, or nothing at all on one machine).

## A binding added to a BUNDLED layout re-records every bundle; the rigid layout is free

Growing a bind-group layout is not one cost — it is two different ones, and which you pay depends on
whether the draws are recorded:

- **Bundled draws (the world/cell path).** A render bundle holds the bind groups it was recorded with. Grow
  their layout, or mint a new buffer for one of their bindings, and every recorded bundle must be recorded
  again. This is why the FRAME uniform is grown by nobody: its bind group sits in every cell bundle, so a
  spare lane in an existing `vec4` is taken instead (`engine.ts` — the debug view mode rides
  `moonColor.w`). A design that wants a new per-frame value has to fit an existing lane or budget the
  re-record.
- **Pass-encoded draws (the rigid path: vehicles, props, script objects).** Encoded fresh every frame into
  the pass, never into a bundle. Their layout can grow freely — plan 099/02 added `binding 10` to
  `rigidLayout` for the UV-animation transform and no bundle was touched.

**Caught:** a MISSING entry is caught loudly (`createBindGroup` rejects a layout it does not satisfy). A
stale BUNDLE is not the same failure — see the texture-array rule above for what that looks like.

## The one perf knob is `?scale=`

Render scale. There is no quality tier ladder and there will not be one: the 2026-07-21 ladder run proved a
~2 ms resolution-independent pass floor, so a tier below that buys nothing. A plan proposing quality presets
has to beat that measurement first.

**Caught:** n/a — a design decision, recorded so it is not re-proposed.

## A half-precision variant may lower COLOUR and never a COORDINATE

`enable f16` is Arm's own guidance for a fragment-heavy chain — their ALUs run half width at roughly twice
the rate — and 201/9-05b takes it in the bloom and post shaders (`?postprec=f16`, `postPrecision` in the
render budget). **What it may reach is the sampled colour, the weights and the accumulators. What it may
never reach is a UV, a texel offset, or anything a loop accumulates a position into.**

The arithmetic, on the surface the console actually measures at: an `f16` near 0.5 resolves to about
**1/2048**, while one texel of a 720-wide target is **1/1440**. A tap offset is therefore SMALLER than the
representable step around the coordinate it is added to, so neighbouring taps quantize onto the same texel
and the kernel silently samples a different footprint than the one it was written as. The post pass's godray
walk is the worse case of the same thing: twenty accumulated steps compound the error into visible banding
along the rays.

**SILENT, and in the most expensive shape.** It compiles, it validates, every test that asserts behaviour
passes, and the frame is fractionally CHEAPER — so it presents as the optimisation working. The only symptom
is that a blur is subtly the wrong blur, which is invisible without the A/B nobody thinks to shoot when the
change was supposed to be a no-op.

**Caught since 2026-09-05, at the one seam that has variants** (`shaders.test.ts`): the resolved f16 sources
are asserted to keep `uv: vec2f`, `insideFrame(uv: vec2f) -> f32` and the godray walk's `f32` delta, and the
two variants of each module are asserted to be byte-identical apart from their alias preamble — so a variant
cannot drift from the source it wraps. **SILENT anywhere a new half-precision shader is written without
those assertions.**

Detail for all of the above: [`edge-cases/engine-rendering.md`](../edge-cases/engine-rendering.md),
[`architecture/`](../architecture/).
