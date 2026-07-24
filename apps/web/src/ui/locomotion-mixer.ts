/**
 * Locomotion clip mixing bookkeeping (plan 088/02): which clip plays, the crossfade on every switch,
 * the walk↔run normalized-phase carry, and the pop-free retarget when a fade is interrupted. Pure
 * state — the caller drives `IfpSampler` with the returned pose — so all of it is testable without
 * a GPU. `captureHold` tells the caller to freeze the sampler's on-screen pose (`holdPose()`) BEFORE
 * sampling this frame: an interrupted fade (or a scripted-clip handback) fades from that frozen pose
 * instead of popping to the new source.
 */

export interface MixerFrame {
  /** Call `sampler.holdPose()` before sampling — a hold-fade starts from the on-screen pose. */
  captureHold: boolean;
  pose: MixerPose;
}

/** How the caller should sample this frame. */
export type MixerPose =
  | { alpha: number; from: number; fromTime: number; kind: 'blend'; to: number; toTime: number }
  | { alpha: number; kind: 'hold'; to: number; toTime: number }
  | { clip: number; kind: 'single'; time: number };

/** Crossfade length between locomotion clips; phase 04 adds per-transition overrides (landing ~0.12). */
export const DEFAULT_FADE_SECONDS = 0.2;

export class LocomotionMixer {
  private active: number;
  private fade: null | { duration: number; elapsed: number; from: number; fromTime: number; hold: boolean } = null;
  private pendingHold = false;
  private time = 0;

  constructor(
    /** Clip durations by index (0 = unresolved clip — never phase-carried). */
    private readonly durations: readonly number[],
    /** Cyclic gait clips (walk/run/…) that carry normalized phase across a switch — legs stay in step. */
    private readonly cyclic: ReadonlySet<number>,
    initial: number,
  ) {
    this.active = initial;
  }

  /** Hand control back after a scripted clip: fade from the sampler's held pose into `clip`. */
  restartFromHold(clip: number): void {
    this.active = clip;
    this.time = 0;
    this.fade = { duration: DEFAULT_FADE_SECONDS, elapsed: 0, from: clip, fromTime: 0, hold: true };
    this.pendingHold = true;
  }

  /** Advance one frame toward `wanted` and describe what to sample. */
  update(wanted: number, dt: number): MixerFrame {
    if (wanted !== this.active) {
      this.beginFade(wanted);
    }
    this.time += dt;
    const captureHold = this.pendingHold;
    this.pendingHold = false;
    const { fade } = this;
    if (!fade) {
      return { captureHold, pose: { clip: this.active, kind: 'single', time: this.time } };
    }
    fade.elapsed += dt;
    fade.fromTime += dt; // the outgoing cycle keeps advancing under the fade — a frozen leg reads as a hitch
    const alpha = fade.elapsed / fade.duration;
    if (alpha >= 1) {
      this.fade = null;

      return { captureHold, pose: { clip: this.active, kind: 'single', time: this.time } };
    }
    const pose: MixerPose = fade.hold
      ? { alpha, kind: 'hold', to: this.active, toTime: this.time }
      : { alpha, from: fade.from, fromTime: fade.fromTime, kind: 'blend', to: this.active, toTime: this.time };

    return { captureHold, pose };
  }

  private beginFade(wanted: number): void {
    // A switch mid-fade retargets from the CURRENT blended (on-screen) pose, frozen via holdPose —
    // fading from either original clip alone would pop by the other's residual contribution.
    const interrupted = this.fade !== null;
    const fromDuration = this.durations[this.active] ?? 0;
    const toDuration = this.durations[wanted] ?? 0;
    const carryPhase = this.cyclic.has(this.active) && this.cyclic.has(wanted) && fromDuration > 0 && toDuration > 0;
    const startTime = carryPhase ? ((this.time % fromDuration) / fromDuration) * toDuration : 0;
    this.fade = {
      duration: DEFAULT_FADE_SECONDS,
      elapsed: 0,
      from: this.active,
      fromTime: this.time,
      hold: interrupted,
    };
    this.pendingHold ||= interrupted;
    this.active = wanted;
    this.time = startTime;
  }
}
