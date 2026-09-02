/**
 * How many mip levels the bloom chain builds, DERIVED from the render size (201/9-05).
 *
 * **The finding.** `BLOOM_LEVELS` was the constant `8`, so the chain was always `1 + 8 + 7 = 16` full-screen
 * render passes whatever it was drawing into. At the 720×640 the 08-31 captures were taken at, the last
 * three levels are **11×10, 6×5 and 3×3 pixels** — on a tile-based GPU each of them still costs a whole
 * pass's tile flush and reload, for a mip smaller than a chip in the corner of the screen.
 *
 * The standard shape is the one this engine's own tent upsample came from (Jimenez, *Next Generation Post
 * Processing in Call of Duty: Advanced Warfare*): derive the level count from the render size and stop when
 * the level stops carrying anything. That is the half of 9/05 which needs no argument — **the half-resolution
 * prefilter is a look question and stays one**, because it was rejected once for sub-pixel emitters
 * ([the render-target attribution](../../../../docs/benchmarks/opensa-engine/2026-08-12-dispatch-render-target-attribution.json));
 * the level COUNT was never argued at all.
 *
 * It is a number the frame reads, never a branch it executes — the
 * [PC/mobile restriction](../../../../docs/restrictions/architecture.md). A 4K desktop derives more levels
 * than a 720-pixel phone from the same line of code.
 */

/**
 * The shortest edge a bloom level may have and still be built, in pixels.
 *
 * Below this a level is a handful of texels stretched over the whole screen: it contributes a flat tint the
 * next level up already carries, and it costs a full pass to produce. Sixteen is the knee of that trade in
 * the reference implementation, and it is the one number here that is chosen rather than computed — so it is
 * named, in one place, and the arm below can pin the old behaviour to measure against it.
 */
export const BLOOM_MIN_EDGE = 16;

/**
 * The most levels the chain will ever build.
 *
 * The old constant, kept as the ceiling: a very large surface should not grow the pass count without bound,
 * and every capture taken before 2026-09-01 was taken at exactly this many.
 */
export const BLOOM_MAX_LEVELS = 8;

/**
 * The fewest the chain can be built with, and it is a structural floor rather than a taste one: the composite
 * binds `upViews[0]`, and there are `levels - 1` up views, so one level would leave it binding nothing.
 */
export const BLOOM_MIN_LEVELS = 2;

/**
 * Levels for a render target of this size — each level halves, and the last one kept is the last whose
 * SHORTER edge is still at least {@link BLOOM_MIN_EDGE}.
 *
 * At 720×640 that is 5 (360×320 down to 22×20, stopping before 11×10), which makes the chain 10 passes
 * instead of 16. At 1920×1080 it is 6.
 *
 * @param pinned when set, the count to use instead of deriving one — 9/05's arm, so a capture can put the
 *   old 8 back and the difference is the thing being priced. Clamped like a derived count rather than
 *   trusted, because an out-of-range pin would build a chain the composite cannot bind.
 */
export function bloomLevelsFor(width: number, height: number, pinned?: number): number {
  if (pinned !== undefined && Number.isFinite(pinned)) {
    return clamp(Math.round(pinned));
  }
  let levels = 0;
  let w = width;
  let h = height;
  while (levels < BLOOM_MAX_LEVELS) {
    w = Math.max(1, Math.round(w * 0.5));
    h = Math.max(1, Math.round(h * 0.5));
    if (Math.min(w, h) < BLOOM_MIN_EDGE) {
      break;
    }
    levels += 1;
  }

  return clamp(levels);
}

/** Full-screen render passes the chain costs at this many levels: the prefilter, the downs, and the ups. */
export function bloomPassCount(levels: number): number {
  return 1 + levels + (levels - 1);
}

function clamp(levels: number): number {
  return Math.min(BLOOM_MAX_LEVELS, Math.max(BLOOM_MIN_LEVELS, levels));
}
