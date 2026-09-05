/**
 * How STEADY the frame is, which is not the same question as how fast it is.
 *
 * The budget table asks for a frame RATE and every capture in this repo answers it — a mean, a p50, a
 * histogram. None of them answers the operator's actual complaint, because **a flat 30 fps is smooth and a
 * 60/30 alternation is not, and the two can report the same mean.** 45 fps on a 60 Hz panel is precisely
 * that alternation: the frame is pinned to the display interval, so a 22.2 ms mean is two frames on the
 * interval and one at double
 * ([the restriction](../../../../docs/restrictions/gpu-and-shaders.md)). A number that cannot tell those
 * apart cannot be used to judge smoothness, and until now the ladder was read BY HAND out of
 * `dtHistogramMs` in each row's prose.
 *
 * **So this measures TRANSITIONS, which a histogram structurally cannot.** A distribution has no order in
 * it: the same bins describe a steady 30 and a 60/30 stutter. The order has to be counted as the frames
 * arrive, and that is all this does — two scalars and the previous `dt`, no allocation and no growth with
 * the run, which is the same rule {@link FrameHistogram} exists to keep.
 *
 * **The test is a RATIO, so it needs no refresh rate and holds on a 144 Hz desk as well as this phone.**
 * Consecutive frames on one display rung differ by jitter — a few per cent. A frame that drops to the next
 * rung differs by the rung ratio: 2.0 from the first to the second, 1.5 from the second to the third.
 * {@link PACE_RATIO} sits between the jitter and the smallest of those.
 *
 * **What it costs, stated rather than hidden:** the gap between rungs narrows as they climb (4/3, 5/4, …),
 * so past the third rung a transition falls under the threshold and is not counted. That is deliberate and
 * not a defect to fix — by then `dtHistogramMs`'s own occupancy already says the frame is nowhere near the
 * display, and a "smoothness" figure for a console running at 15 fps is not the number anybody needs.
 */

/**
 * How far apart two consecutive frames must be, as a ratio, before the pace is judged to have CHANGED.
 *
 * 1.4 rather than 1.5: the second-to-third rung transition is exactly 1.5 and a threshold sitting on it
 * would count that pair or not depending on a tenth of a millisecond of jitter.
 */
export const PACE_RATIO = 1.4;

export class FramePacing {
  /**
   * Stutters per consecutive pair, 0..1. **0 is a perfectly even frame at ANY rate**; a 60/30 alternation
   * approaches 1. This is the number a smoothness claim is made on.
   */
  get changeRate(): number {
    return this.pairs === 0 ? 0 : this.changed / this.pairs;
  }
  /** Consecutive pairs whose ratio cleared {@link PACE_RATIO} — the stutters, counted rather than binned. */
  get changes(): number {
    return this.changed;
  }
  /** Consecutive pairs seen — one less than the frames, and the denominator of {@link changeRate}. */
  get pairCount(): number {
    return this.pairs;
  }
  /** The largest ratio between two consecutive frames. Separates "it doubled once" from "it is doing this". */
  get worstRatio(): number {
    return this.worst;
  }
  private changed = 0;
  private pairs = 0;
  private previous: null | number = null;
  private worst = 0;

  add(ms: number): void {
    const last = this.previous;
    // A non-positive dt has no ratio and is not a frame anyone waited through: it neither opens a pair nor
    // closes one, so the series continues across it rather than being silently joined around it.
    if (ms <= 0) {
      this.previous = null;

      return;
    }
    this.previous = ms;
    if (last === null) {
      return;
    }
    const ratio = Math.max(last, ms) / Math.min(last, ms);
    this.pairs += 1;
    this.worst = Math.max(this.worst, ratio);
    if (ratio >= PACE_RATIO) {
      this.changed += 1;
    }
  }
}
