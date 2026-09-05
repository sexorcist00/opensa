/**
 * The scene pass's per-pixel working set, read as a BUDGET rather than compiled in as a constant (201/9-04).
 *
 * **The finding this file exists for.** The world pass renders into `rgba16float` at 4× MSAA with a
 * `depth32float` at 4× — **48 bytes per pixel** of tile working set. Arm budgets **16 bytes per pixel** for a
 * 16×16 tile on the Bifrost/Valhall family the console's 2/03 device runs; past that the driver shrinks the
 * tile and every per-tile fixed cost multiplies. That is a frame-time question, and
 * [`msaa-sample-count.md`](../../../../docs/performance/deferred-optimizations/msaa-sample-count.md) only
 * ever priced the memory half.
 *
 * It is a NUMBER a surface reads, never a branch it executes and never a second pipeline set — the
 * [PC/mobile restriction](../../../../docs/restrictions/architecture.md). A map console and the game read
 * the same code with different numbers in it.
 *
 * **Chosen once, before anything is created.** Every pipeline is compiled against the sample count and the
 * colour format, every cell's render bundle is recorded against them, and the env probe allocates against
 * them — so this is a constructor input, not a live knob like {@link Engine.renderScale}. Changing it means
 * a new engine.
 *
 * **What `sampleCount: 1` costs, stated rather than discovered:** alpha-to-coverage is a multisample
 * capability, so the cutout pipelines lose it (WebGPU rejects `alphaToCoverageEnabled` at one sample). That
 * is the third leg of the 074 alpha-edge fix and it is a LOOK change — judged in the engine, on the device,
 * at map zoom, never off a desktop screenshot.
 */

/**
 * Which kernel the chain's DOWNSAMPLE uses — the vendor lever, adapted rather than adopted whole.
 *
 * `box13` is what the engine has always run: the 13-tap kernel from Jimenez's *Next Generation Post
 * Processing in Call of Duty: Advanced Warfare* (4 inner ×0.125 + 8 outer + centre ×0.05556), each tap
 * multiplied by an in-frame test that emulates prod's `clampToBorder`.
 *
 * `dual5` is the downsample half of **dual filtering** — Bjørge, *Bandwidth-Efficient Rendering*
 * (SIGGRAPH 2015), written for exactly the Mali family the console's phone runs and now shipping as URP
 * 17's `Dual` bloom mode ([links](../../../../docs/links.md)). Five taps instead of thirteen: the centre
 * weighted ×4 and the four diagonal half-texel corners ×1, over 8.
 *
 * **What the adaptation keeps, and why it is not the whole technique.** Dual filtering also replaces the
 * upsample with an 8-tap kernel and drops the per-level blend — and that is the half that does NOT transfer,
 * because our chain is already a PYRAMID whose look comes from `mix(support, tent, radius)` at every level.
 * Bjørge's headline speedup is measured against a Gaussian, not against a pyramid. So the downsample kernel
 * comes across, where the argument is arithmetic rather than aesthetic (**8 fewer texture fetches per pixel
 * per level**, on a chain 201/9 measured as bandwidth), and the upsample stays ours.
 *
 * **It is still a LOOK change and it is not shipped by default.** Five taps have a smaller support than
 * thirteen, so each level blurs slightly less and the pyramid's overall falloff tightens. That is an
 * operator's verdict on the device, not a reasoned one — the standing call. `?bloomdown=dual5` is the arm.
 */
export type BloomDownsample = 'box13' | 'dual5';

/** Where the bloom pyramid starts, as a fraction of the render size. Halves only — a mip chain has no thirds. */
export type BloomPrefilterScale = 0.5 | 1;

/**
 * The precision the bloom and post fragment shaders compute COLOUR at.
 *
 * **Arm's own guidance, and the one shader-level lever they price in whole multiples**: their ALUs run
 * `mediump` at roughly twice the rate of `highp`, and half-width registers relieve pressure, so a
 * fragment-heavy chain is the canonical place to spend it.
 *
 * **Only the colour maths moves. Every coordinate stays f32, and that is the load-bearing detail** — an
 * `f16` UV near 0.5 resolves to about 1/2048, while a texel offset on this surface is 1/1440, so tap
 * positions would quantize into each other and the kernel would sample the wrong texels. Positions, UVs and
 * texel offsets are `f32` in both variants; only the sampled colour, the weights and the accumulators
 * change width.
 *
 * **Storage is unaffected, which is what makes it near-free of consequence:** the chain's targets are
 * already 16-bit float (or `rg11b10ufloat`), so an f16 accumulator is rounded to the same result the f32 one
 * is stored as, give or take an ULP. The post pass writes an 8-bit sRGB swapchain, where f16's ~0.05 %
 * relative precision is far finer than the encoding it feeds.
 *
 * Requires `shader-f16`, which the device requests where the adapter offers it (the 2/03 phone does). A
 * budget asking for it on an adapter without it falls back and the capture states which one ran.
 */
export type PostPrecision = 'f16' | 'f32';

export interface RenderBudget {
  /**
   * Which kernel the chain's downsample passes use — see {@link BloomDownsample}.
   *
   * The downsample is where the chain's fetches are: it runs at every level, and at `box13` each of them
   * costs thirteen bilinear taps plus an in-frame test per tap. `dual5` is Arm's own kernel for this GPU
   * family and takes five.
   */
  readonly bloomDownsample: BloomDownsample;
  /**
   * Colour format of the bloom chain's own targets — read apart from {@link sceneFormat} since 201/9's sweep.
   *
   * The chain is **7.7 ms of a 23.4 ms frame** on the 2/03 phone and its cheap tail is FREE (cutting eight
   * levels to four cost 0.2 ms, inside noise), so the cost is bytes moved by the two or three biggest passes
   * rather than the number of passes. Halving those bytes is therefore the lever, and the chain is the one
   * place it can be taken without touching what the scene itself stores: bloom is a blurred bright-pass that
   * is composited additively, which is the canonical acceptable use of a small float format — 11/11/10 bits
   * keeps the floating-point RANGE (unlike `rgb10a2unorm`, which is UNORM and clips everything above 1.0),
   * and the five mantissa bits of its blue channel band only on high-contrast gradients this pass does not
   * carry.
   *
   * Requires `rg11b10ufloat-renderable`, which the device requests where the adapter offers it. A budget
   * that names a format the device was not granted is refused at boot rather than silently downgraded.
   */
  readonly bloomFormat: SceneFormat;
  /**
   * The smallest bloom level worth building, in pixels of its shorter side.
   *
   * At 720×640 the eighth level is 3×3, and 201/9's sweep measured what those levels cost: **nothing**. They
   * are not a frame-time question, they are six textures, six bind groups and six uniforms that exist for a
   * mip smaller than a chip.
   */
  readonly bloomMinLevelPx: number;
  /**
   * The fraction of the render size the bloom chain's PREFILTER runs at, and therefore where its pyramid
   * starts.
   *
   * The top of the pyramid is the chain: prefilter, the first downsample and the last upsample are 90 % of
   * its output pixels and ~97 % of its texture fetches. Halving this quarters those three.
   *
   * **It is not a render-scale tier and it does not touch the frame's resolution** — the world is still
   * drawn at full size and the post pass still writes every pixel. What changes is the resolution the GLOW
   * is computed at, which is the trade the standing call (frame time may not be bought with resolution,
   * sampling or anti-aliasing) is about the frame rather than about a blur. The known cost is sub-pixel
   * emitters, which is a LOOK verdict owed on the device before this ships as a default anywhere.
   */
  readonly bloomPrefilterScale: BloomPrefilterScale;
  /**
   * The precision the bloom and post fragment shaders compute colour at — see {@link PostPrecision}.
   *
   * EFFECTIVE rather than asked: {@link resolveRenderBudget} drops it to `f32` on an adapter without
   * `shader-f16`, and the capture reports what actually ran.
   */
  readonly postPrecision: PostPrecision;
  /** MSAA samples for the world pass, its depth and every bundle recorded against it. */
  readonly sampleCount: SampleCount;
  /** Colour format of the world pass and the resolve target. */
  readonly sceneFormat: SceneFormat;
}

/** WebGPU allows exactly these two sample counts for a render target. */
export type SampleCount = 1 | 4;

/**
 * The colour formats the scene target and the post chain can carry. All linear; the post pass writes the
 * sRGB swapchain.
 *
 * `rgb10a2unorm` is UNORM and cannot hold a value above 1.0, so it is a LOOK change to the HDR chain and
 * exists as a measurement arm rather than as a candidate. `rg11b10ufloat` is the honest small format: the
 * same four bytes with the float range kept.
 */
export type SceneFormat = 'rg11b10ufloat' | 'rgb10a2unorm' | 'rgba16float';

/** What the engine has always done, and what every capture before 2026-09-01 was taken at. */
export const DEFAULT_RENDER_BUDGET: RenderBudget = {
  bloomDownsample: 'box13',
  bloomFormat: 'rgba16float',
  bloomMinLevelPx: 1,
  bloomPrefilterScale: 1,
  postPrecision: 'f32',
  sampleCount: 4,
  sceneFormat: 'rgba16float',
};

/**
 * The budget this DEVICE can actually honour, given the one a surface asked for.
 *
 * **This is what "adaptive" is allowed to mean here.** The
 * [restriction](../../../../docs/restrictions/architecture.md) is that the PC/mobile difference is a BUDGET
 * rather than a branch, and the cheapest way to keep that true is to have a surface ask for the option with
 * the best value on any device and let the DEVICE answer — rather than have the app sniff a platform and
 * decide on its behalf. `rg11b10ufloat` is exactly that shape: half the bytes of `rgba16float` with the
 * float range kept, and every adapter that offers `rg11b10ufloat-renderable` gets it, phone or desk.
 *
 * **A format the device was not granted falls back, and the fallback is REPORTED rather than silent** — the
 * capture states the effective budget, so a row can never claim an arm the device refused. That is the same
 * rule `capture-surface.ts` and `capture-ablation.ts` already follow, moved to the one place that knows what
 * the device answered: `init()`, before a single pipeline is compiled against it.
 *
 * What this deliberately does NOT do is pick a look. `bloomPrefilterScale` is untouched here: it changes the
 * resolution the glow is computed at, which is a LOOK verdict owed on the device, and a function that
 * quietly halved it on hardware it decided was slow would be the silent quality ladder
 * [201's decisions](../../../../docs/plans/201-dispatch-console/readme.md) rule out by name.
 */
export function resolveRenderBudget(asked: RenderBudget, granted: Iterable<string>): RenderBudget {
  const features = new Set(granted);
  const format = (wanted: SceneFormat): SceneFormat =>
    wanted === 'rg11b10ufloat' && !features.has('rg11b10ufloat-renderable') ? 'rgba16float' : wanted;

  return {
    ...asked,
    bloomFormat: format(asked.bloomFormat),
    // Arm prices mediump at roughly 2x on their ALUs, so a surface asks for it and the DEVICE answers —
    // the same shape as the format above, and for the same reason: nothing here reads a vendor name.
    postPrecision: asked.postPrecision === 'f16' && features.has('shader-f16') ? 'f16' : 'f32',
    sceneFormat: format(asked.sceneFormat),
  };
}

/** Bytes one pixel of a scene colour target costs — the residency accounting reads this, not a literal 8. */
export function sceneBytesPerPixel(format: SceneFormat): number {
  return format === 'rgba16float' ? 8 : 4;
}

/**
 * The world pass's colour attachment, in the ONE place that knows both shapes.
 *
 * At 4× the pass draws into a multisample view and RESOLVES into the sampled one, discarding the samples
 * (the resolve is free on a tiler only because the samples never leave tile memory). At one sample there is
 * no second texture to resolve from and the pass writes the sampled view directly — a `resolveTarget` with a
 * one-sample view is a validation error, and a `storeOp: 'discard'` there throws the frame away.
 *
 * Two passes need this (the world and the env probe's faces) and they must agree, because they share the
 * pipelines: a helper rather than two descriptors that drift.
 */
export function sceneColorAttachment(options: {
  readonly clearValue: GPUColor;
  /** The multisample view, or `null` when the budget is one sample. */
  readonly multisampled: GPUTextureView | null;
  /** Where the pass's result is readable from afterwards. */
  readonly resolved: GPUTextureView;
}): GPURenderPassColorAttachment {
  if (options.multisampled === null) {
    return { clearValue: options.clearValue, loadOp: 'clear', storeOp: 'store', view: options.resolved };
  }

  return {
    clearValue: options.clearValue,
    loadOp: 'clear',
    resolveTarget: options.resolved,
    storeOp: 'discard',
    view: options.multisampled,
  };
}

/**
 * The tile working set the scene pass asks the GPU for, per pixel: colour plus `depth32float`, multiplied by
 * the sample count. 48 at the default, 32 with the format arm, 12 with the sample arm — the three rows of
 * 9/04's table, computed rather than restated.
 */
export function sceneWorkingSetBytes(budget: RenderBudget): number {
  return (sceneBytesPerPixel(budget.sceneFormat) + 4) * budget.sampleCount;
}
