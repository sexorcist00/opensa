/**
 * The scene pass's attachment set, asked for by a measurement arm (201/9-04).
 *
 * **The finding.** The world pass renders into `rgba16float` at 4× MSAA with a `depth32float` at 4× — **48
 * bytes per pixel** of tile working set, against the **16 bytes** Arm budgets for a 16×16 tile on the
 * Bifrost/Valhall family this console's phone runs. Past that the driver shrinks the tile and every per-tile
 * fixed cost multiplies. The console measures **31–33 fps against a declared 60 on a mostly empty view**
 * ([the pinned circuit](../../../../docs/benchmarks/opensa-engine/2026-08-31-mobile-map-circuit-pinned.json)),
 * and this is the largest unexplained number in that frame.
 *
 * **Three arms, one constant each, and the third one was already built:**
 *
 * | arm | link | working set |
 * | --- | --- | --- |
 * | the tile configuration whole | `?msaa=1` | 12 B/px, and no resolve |
 * | the price of `rgba16float`, anti-aliasing kept | `?scene=rgb10a2unorm` | 32 B/px |
 * | fill-bound against tile-bound | `?scale=0.75` / `0.5` | linear in pixels |
 *
 * `?scale=` is `Engine.renderScale` and has existed since 2026-08-12, so nothing here re-implements it.
 *
 * **A refused value pins NOTHING**, exactly as `capture-surface.ts` refuses a size: an arm that silently ran
 * at the default is a measurement of the default filed under another name, which is the failure the whole
 * circuit was rebuilt to prevent. The report carries what was actually asked for either way.
 *
 * It is a knob a capture RECORDS, never a tier anything picks — the winner of this circuit becomes a number
 * a surface reads ([the PC/mobile restriction](../../../../docs/restrictions/architecture.md)), and until the
 * ladder says which arm won there is nothing to pick.
 */
import { DEFAULT_RENDER_BUDGET, type RenderBudget, type SampleCount, type SceneFormat } from '@opensa/engine';

const SAMPLE_COUNTS: readonly SampleCount[] = [1, 4];
const SCENE_FORMATS: readonly SceneFormat[] = ['rgb10a2unorm', 'rgba16float'];

/**
 * Read `?msaa=` and `?scene=`.
 *
 * Each half falls back to the default INDEPENDENTLY: `?msaa=1&scene=nonsense` is the sample arm with the
 * default format, which is the arm that was asked for. Anything unparseable in either is the default for
 * that half alone.
 */
export function captureBudget(params: URLSearchParams): RenderBudget {
  return {
    sampleCount: parse(params.get('msaa'), SAMPLE_COUNTS, DEFAULT_RENDER_BUDGET.sampleCount, Number),
    sceneFormat: parse(params.get('scene'), SCENE_FORMATS, DEFAULT_RENDER_BUDGET.sceneFormat, (raw) => raw),
  };
}

function parse<T>(
  asked: null | string,
  allowed: readonly T[],
  fallback: T,
  convert: (raw: string) => number | string,
): T {
  if (asked === null) {
    return fallback;
  }
  const value = convert(asked.trim().toLowerCase());
  const match = allowed.find((candidate) => candidate === value);

  return match ?? fallback;
}
