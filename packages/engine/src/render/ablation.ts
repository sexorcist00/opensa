/**
 * Which of the frame's passes actually run — the instrument that stands in for `timestamp-query` (201/9).
 *
 * **Why this exists, and it is a device fact rather than a preference.** The 2/03 phone's adapter does not
 * offer `timestamp-query` and no browser flag brings it: the feature rests on timestamp support in the
 * Vulkan queue family and this Bifrost driver has none
 * ([edge-cases](../../../../docs/edge-cases/browser-runtime.md), re-tested 2026-09-04 with both WebGPU
 * flags on). So GPU time is not measurable on the one device this console is aimed at, `report.passes`
 * reports `gpuPassMs` / `gpuPostMs` / `gpuProbeMs` as unavailable, and the only reading of the whole
 * frame's cost is the vsync ladder — quantized at 16.7 ms, which cannot see a 2 ms pass.
 *
 * **Ablation is what is left, and it is a real instrument rather than a consolation.** Remove a pass, fly
 * the same route, and read the difference in the window's MEAN
 * ([the ladder](../../../../docs/benchmarks/opensa-engine/2026-09-04-mobile-map-attachment-ladder.json)
 * priced its five arms exactly this way). What it prices is a GROUP of passes, never one pass in isolation,
 * and the group is what each field below names.
 *
 * **ITS RESOLUTION IS ~2.5 ms ON THE 2/03 DEVICE, NOT THE HALF-MILLISECOND THIS FILE USED TO CLAIM**
 * ([the null arm](../../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)).
 * That number was never measured; it was assumed from the frame count. It was measured on 2026-09-05 the
 * only way a noise floor can be — by flying an arm that removes NOTHING and reading how far apart the
 * windows land. Five windows of one identical frame spanned **18.11–20.58 ms**, and the first three of them
 * looked exactly like a clean, thermally-bracketed 2 ms effect. **So an arm worth less than ~2.5 ms here has
 * not been measured, it has been sampled**, and the number to read alongside the mean is the vsync ladder —
 * the levers that survived moved rung 1 by whole steps (67 → 80 → 91 %) where the null arm wandered inside
 * 74–86 %.
 *
 * **AND AN ARM MUST BE PROVEN NON-NULL BEFORE ITS NUMBER IS READ.** `probe` was priced at 1.6 ms on a
 * surface where the probe has never rendered a face: `apps/dispatch` never assigns {@link Engine.probeCenter},
 * so `scheduleProbe` returns at its FIRST condition and `?ablate=probe` skips one array store and a counter
 * tick. Nothing in a report said so — which is the trap, because a null arm produces a perfectly ordinary
 * capture with a plausible number in it. Read what the pass is gated on in the HOST before believing the
 * arm that removes it.
 *
 * **An arm is a page load**, the same rule {@link RenderBudget} is a constructor input for: the bloom
 * chain's level count decides how many textures and bind groups exist, and the rest are read per frame but
 * must not move under a running measurement. A capture that changed arm halfway is a capture of neither.
 *
 * **This is a measurement knob and never a quality tier.** Turning a pass off changes the picture — that is
 * the point — so nothing here may be reached by a production surface, and the winner of an ablation is
 * never "ship it off". It says where the time is; what to do about it is a plan, and on this project's
 * standing instruction (the user's call, 2026-09-04) the answer may not be a cut to resolution, sampling or
 * anti-aliasing. Removing WASTE — a bloom level 3 pixels across, a bake whose input changes on a scale of
 * minutes — is the shape a fix is allowed to take.
 */

export interface FrameAblation {
  /**
   * Run the bloom chain at all.
   *
   * `false` prices the whole chain: 1 prefilter + N down + (N−1) up, every one of them full-screen at some
   * mip. Distinct from `bloomLevels`, which prices the TAIL of it — the last levels are 12×10, 6×5 and 3×3
   * pixels at this console's surface, and on a tiler each still costs a whole tile flush and reload.
   */
  readonly bloom: boolean;
  /**
   * How many mip levels the chain carries, or `null` for the engine's built-in count.
   *
   * Read where the chain is BUILT, so it is fixed for the life of an engine. This is also 201/9-05's actual
   * lever rather than only a measurement: the count is a constant today and the standard shape derives it
   * from the render size, stopping at ~16 px.
   */
  readonly bloomLevels: null | number;
  /**
   * Draw the STREAMED WORLD — every resident cell's opaque and blend bundles.
   *
   * The world pass itself still runs and still clears, so what this removes is the geometry and nothing of
   * the attachment set 201/9-04 priced: the two are separate questions and the 09-04 ladder found they
   * answer differently (the high, emptier pose cost MORE, at 112 draws against 96).
   */
  readonly cells: boolean;
  /**
   * Bake the cumulus field — 256² with two fbm evaluations per pixel, every frame, unconditionally.
   *
   * The field scrolls at `t * 0.004` and is visually identical for minutes, and both patterns that would
   * fix it sit within twenty lines of the call (201/9-06). The world still SAMPLES the texture with this
   * off, so what is priced is producing it rather than reading it.
   */
  readonly cloudField: boolean;
  /**
   * Schedule the environment probe.
   *
   * **NULL on any surface that leaves {@link Engine.probeCenter} at `null`, and the map console is one** —
   * `scheduleProbe` returns at that first condition, so this arm removes one store into a reused array and
   * one counter tick. It prices the probe only where the host actually feeds a centre (`apps/web`,
   * `apps/engine-lab`); on the console it is the instrument's own control, and the 2.47 ms it read there is
   * this instrument's noise floor rather than a pass
   * ([the null arm](../../../../docs/benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json)).
   */
  readonly probe: boolean;
  /** Refresh the sky LUT — already keyed on its input and usually an early return, so this bounds it too. */
  readonly skyLut: boolean;
}

/** The frame as it ships. Every capture that is not an ablation arm is taken at this. */
export const NOTHING_ABLATED: FrameAblation = {
  bloom: true,
  bloomLevels: null,
  cells: true,
  cloudField: true,
  probe: true,
  skyLut: true,
};

/**
 * What a report says an arm actually ran, so a row cannot claim an ablation it did not take.
 *
 * The same rule as `surface.pinned` and the budget's `sampleCount`: a refused parameter falls back to the
 * default, and a default that reads as a default is only safe when the capture states it.
 */
export function ablationLabel(ablation: FrameAblation): string {
  const off = [
    ablation.cells ? '' : 'cells',
    ablation.cloudField ? '' : 'cloud-field',
    ablation.bloom ? '' : 'bloom',
    ablation.probe ? '' : 'probe',
    ablation.skyLut ? '' : 'sky-lut',
    ablation.bloomLevels === null ? '' : `bloom-levels=${ablation.bloomLevels}`,
  ].filter((name) => name !== '');

  return off.length === 0 ? 'none' : off.join(' ');
}
