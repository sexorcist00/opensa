/**
 * The console's own audio (203/6-01): the context, the ear, and the tick that keeps them honest.
 *
 * **The console hears the WORLD, not just its own alerts** (203's decision 1.4) — which is the proof that
 * the audio layer stayed an engine layer rather than a game one. Everything here is wiring: `@opensa/audio`
 * owns the context, the voices and the spatial model; this file decides where the ear is, when it wakes, and
 * what the capture says about it.
 *
 * **The listener is the CAMERA, as it is** (decision 2.3). Not the ground focus, not a virtual microphone
 * placed politely at street level: at 900 m there is nearly nothing to hear, and the world arrives as the
 * operator zooms in. That is honest attenuation on both surfaces and it is deliberate.
 *
 * **Audio runs on its own clock** (decision 3.2). The render gate takes drawn frames to zero at rest — the
 * battery figure 201/4-01 reports is exactly that — so a world updated per frame would fall silent the
 * moment nobody touched the map.
 *
 * **`?audio=0` is the silent baseline**, and it exists because 4/03 owes a battery figure that cannot be read
 * any other way: a row with audio has to be subtracted from one without it, taken on the same device in the
 * same thermal window. Unrecognised is the DEFAULT, like every arm in this family.
 */
import type {
  AudioAbsenceReport,
  AudioAvailability,
  AudioClockHost,
  AudioClockReport,
  AudioListener,
  GestureTarget,
  VoicePoolReport,
} from '@opensa/audio';

import { AudioAbsence, AudioClock, AudioHost, browserClockHost, VoicePool } from '@opensa/audio';

/** Whether this run makes sound at all. `off` is `?audio=0`, spelled the way a filed row spells it. */
export type AudioArm = 'off' | 'on';

/** What a capture says about sound — the fields 3/04 and 4/03 are filed against. */
export interface DispatchAudioReport {
  /** What could not be heard, and why. Counts stay exact; the first reasons are named. */
  readonly absence: AudioAbsenceReport;
  readonly arm: AudioArm;
  /** What a surface would draw an indicator from. */
  readonly availability: AudioAvailability;
  /** The audio tick's own cost — the 2 ms budget's number, beside the rate it was taken at. */
  readonly clock: AudioClockReport;
  /** Gestures the browser turned down. Non-zero with `waiting` means the wiring, not the operator. */
  readonly resumesRefused: number;
  /** `null` until there is a context to build voices on. */
  readonly voices: null | VoicePoolReport;
  /** The step the operator left the volume on, 0..1 — 0 being mute. Carried whether or not there is a pool. */
  readonly volume: number;
}

/**
 * The volume steps, loudest first, and why there are steps rather than a slider.
 *
 * **One control has to work on a phone and on a desk in the same change** — the cross-platform rule's own
 * words, and it forbids two layouts that drift apart. A `<input type="range">` beside a mute button is two
 * targets and about 120 px of a top bar that already CLIPS at 360 CSS px (measured; see
 * `docs/restrictions/cross-platform-surface.md`), while a stepped button is one target at `TOUCH_TARGET`,
 * needs no hover, no keyboard and no popover, and says its own state.
 *
 * **This is an ASSUMPTION taken 2026-09-09 with the operator away.** The step says *volume and mute*; four
 * steps is the reading that fits the surface rule. A continuous slider is the alternative, and what would
 * settle it is the operator wanting a level between two of these.
 */
export const VOLUME_STEPS = [1, 0.5, 0.2, 0] as const;

/** Holds the console's audio for the life of the page. */
export class DispatchAudio {
  private readonly absence: AudioAbsence;
  private readonly arm: AudioArm;
  private readonly clock: AudioClock;
  private readonly host: AudioHost;
  private readonly pool: null | VoicePool;
  private volume = 1;

  constructor(params: URLSearchParams, options: { clockHost?: AudioClockHost; log?: (message: string) => void } = {}) {
    this.arm = audioArm(params);
    const log = options.log ?? warn;
    this.absence = new AudioAbsence(log);
    // The arm removes the whole path rather than muting it, the way `?models=0` removes the fleet: a run
    // that still built a context and a pool would measure a silent console, not a console with no audio.
    this.host = new AudioHost(this.arm === 'off' ? { createContext: refuseContext, log } : { log });
    const context = this.host.audioContext;
    this.pool = context ? new VoicePool(context) : null;
    this.clock = new AudioClock(options.clockHost ?? browserClockHost());
  }

  /** Wire the first touch. Anything that reaches the page wakes the context — no gate screen, ever. */
  attach(target: GestureTarget): () => void {
    return this.host.attachGestures(target);
  }

  report(): DispatchAudioReport {
    return {
      absence: this.absence.report(),
      arm: this.arm,
      availability: this.host.state.availability,
      clock: this.clock.report(),
      resumesRefused: this.host.state.resumesRefused,
      voices: this.pool?.report() ?? null,
      volume: this.volume,
    };
  }

  /**
   * Set the master volume, 0..1. Zero is mute and nothing else — the pool goes on playing and counting, so
   * unmuting is instant and a capture still says what the world asked for.
   */
  setVolume(value: number): void {
    this.volume = Math.min(1, Math.max(0, value));
    this.pool?.setMasterGain(this.volume);
  }

  /**
   * Start the audio tick. `listenerOf` is read on the clock's schedule rather than the frame's, so a still
   * map keeps its ear where the camera is.
   */
  start(listenerOf: () => AudioListener): void {
    if (this.pool === null) {
      return;
    }
    const pool = this.pool;
    this.clock.start(() => {
      pool.setListener(listenerOf());
    });
  }

  /**
   * The next volume step, wrapping past mute back to full — the whole of what one control does.
   *
   * It also RESUMES, because the operator pressing the sound control is the clearest gesture there is and a
   * button that changed a number while the page stayed silent would be a lie.
   */
  stepVolume(): number {
    const at = VOLUME_STEPS.indexOf(this.volume as (typeof VOLUME_STEPS)[number]);
    const next = VOLUME_STEPS[(at + 1) % VOLUME_STEPS.length] ?? 1;
    this.setVolume(next);
    if (next > 0) {
      void this.host.resume();
    }

    return next;
  }

  /** Stop the tick and every voice. The context stays, so a resume is instant. */
  stop(): void {
    this.clock.stop();
    this.pool?.stopAll();
  }
}

/**
 * Read the arm out of `?audio=`.
 *
 * Absent is `on`: a console an operator opens can make sound. Only the exact string `0` takes it off.
 */
export function audioArm(params: URLSearchParams): AudioArm {
  return params.get('audio') === '0' ? 'off' : 'on';
}

/** What `?audio=0` builds instead of a context: nothing, and the host reports `unsupported`. */
function refuseContext(): never {
  throw new Error('?audio=0 — this run makes no sound by arm, not by fault');
}

/** Where an absent context or a refused gesture is said when the caller names no log. */
function warn(message: string): void {
  // Deliberate field diagnostic: a console that is silent for a REASON has to be able to say so.
  // eslint-disable-next-line no-console -- see above
  console.warn(message);
}
