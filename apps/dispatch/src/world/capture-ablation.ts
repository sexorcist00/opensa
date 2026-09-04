/**
 * Which passes an ablation arm removes from the frame, asked for in the query (201/9).
 *
 * **The device has no `timestamp-query` and no flag brings it** — it rests on timestamp support in the
 * Vulkan queue family and this Bifrost driver has none, re-tested 2026-09-04 with both WebGPU flags on
 * ([edge-cases](../../../../docs/edge-cases/browser-runtime.md)). So a pass is priced by REMOVING it and
 * re-flying the route: the difference in the window's mean over ~450 moving frames is worth roughly half a
 * millisecond, which prices a group of passes rather than one.
 *
 * | arm | link | what it removes |
 * | --- | --- | --- |
 * | the streamed world | `?ablate=cells` | every resident cell's opaque and blend bundles |
 * | the cumulus bake | `?ablate=cloud` | 256² with two fbm per pixel, run every frame |
 * | the bloom chain | `?ablate=bloom` | 1 prefilter + 8 down + 7 up, all full-screen at some mip |
 * | the chain's tail | `?bloomlevels=4` | the levels that are 12×10, 6×5 and 3×3 pixels here |
 * | the env probe | `?ablate=probe` | what is left after `PROBE_FRAME_INTERVAL` amortizes it |
 * | the sky LUT | `?ablate=skylut` | what is left after its own input key short-circuits it |
 *
 * `?ablate=` takes a comma-separated list, so `?ablate=bloom,cloud` is one arm removing both — subtraction
 * needs groups as often as it needs singles.
 *
 * **A name that is not one of these is IGNORED and the rest of the list still applies**, which is the same
 * rule `capture-budget.ts` and `capture-surface.ts` follow for the same reason: an arm that silently ran as
 * the default is a measurement of the default filed under another name. The report carries
 * {@link ablationLabel}'s reading of what actually ran, so a row cannot claim an arm it did not take.
 *
 * **This is a measurement knob and never a shipping path.** Every one of these changes the picture, and the
 * standing instruction on this project (the user's call, 2026-09-04) is that frame time may not be bought
 * with resolution, sampling or anti-aliasing. What an ablation is FOR is finding waste — a bloom level three
 * pixels across, a bake whose input changes on a scale of minutes — which is a fix that costs no quality at
 * all.
 */
import { type FrameAblation, NOTHING_ABLATED } from '@opensa/engine';

/** What `?ablate=` accepts, and the field each name removes. */
const NAMES: Readonly<Record<string, keyof FrameAblation>> = {
  bloom: 'bloom',
  cells: 'cells',
  cloud: 'cloudField',
  probe: 'probe',
  skylut: 'skyLut',
};

/** The most levels worth asking for: past this the mips are sub-pixel and the chain refuses to build them. */
const MAX_BLOOM_LEVELS = 12;

/** Read `?ablate=` and `?bloomlevels=`. */
export function captureAblation(params: URLSearchParams): FrameAblation {
  const asked = (params.get('ablate') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');

  return {
    ...NOTHING_ABLATED,
    ...Object.fromEntries(asked.filter((name) => name in NAMES).map((name) => [NAMES[name], false])),
    bloomLevels: bloomLevels(params.get('bloomlevels')),
  };
}

/** A level count, or null for the engine's own — anything unreadable or out of range is the engine's own. */
function bloomLevels(asked: null | string): null | number {
  if (asked === null) {
    return null;
  }
  const value = Number(asked.trim());

  return Number.isInteger(value) && value >= 2 && value <= MAX_BLOOM_LEVELS ? value : null;
}
