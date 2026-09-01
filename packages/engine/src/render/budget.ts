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

export interface RenderBudget {
  /** MSAA samples for the world pass, its depth and every bundle recorded against it. */
  readonly sampleCount: SampleCount;
  /** Colour format of the world pass, the resolve target and the whole bloom chain. */
  readonly sceneFormat: SceneFormat;
}

/** WebGPU allows exactly these two sample counts for a render target. */
export type SampleCount = 1 | 4;

/** The scene colour formats the post chain can carry. Both are linear; the post pass writes the sRGB swapchain. */
export type SceneFormat = 'rgb10a2unorm' | 'rgba16float';

/** What the engine has always done, and what every capture before 2026-09-01 was taken at. */
export const DEFAULT_RENDER_BUDGET: RenderBudget = { sampleCount: 4, sceneFormat: 'rgba16float' };

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
