/**
 * A car's engine, as San Andreas actually voices one it is not driving (203/5-02).
 *
 * **This is the DUMMY engine** — `CAEVehicleAudioEntity::ProcessDummyVehicleEngine` and the state machine
 * under it — and it is the right one for both surfaces here: a dispatch console never has a player in the
 * car, and the row a build authors carries a dummy bank precisely for this
 * ([what the columns mean](../../../docs/gta-sa-original/vehicle-audio-settings.md)).
 *
 * **An engine is TWO sounds, not one**, and that is the finding worth reading twice. SA plays an IDLE loop
 * and a REV loop at once and crossfades between them by how fast the car is going; neither is ever
 * restarted. A single sample pitched up and down — which is what anybody would write from scratch — is
 * audibly not this: it has no second voice to hand the sound to, so the whole range is one texture stretched
 * over it.
 *
 * **Every constant below is RECOVERED, not fitted.** The ratios, the frequency and volume ends and the five
 * piecewise tables are read from the reverse at the addresses its comments name (`0x8CBBF0`, `0x8CC0EC`,
 * `0x8CC0C4`, `0x8CC114` …). The one thing deliberately NOT ported is the shape of the fade: SA steps it per
 * FRAME (`step_up_to(x, 1, 0.1)`, which at its own reference time step is 0.1 a frame), and a per-frame
 * constant is meaningless on a clock that ticks ten times a second. The same numbers as DURATIONS are
 * frame-rate independent by construction — see {@link IDLE_FADE_SECONDS}.
 *
 * **What this module does not decide is the ratio.** It takes one, because *how fast is this car going, as a
 * fraction of what it can do* is a question about the world rather than about audio: in SA it is
 * `|speed| / transmission.maxVelocity`, on the dispatch board it will be the speed
 * [PCAD publishes](../../../docs/plans/202-pcad-dispatch/readme.md) over the car's own `handling.cfg` row.
 * Keeping it out means this file can be tested exactly, and neither consumer inherits the other's idea of
 * fast.
 */

/** Which side of the crossfade the car is on. `off` is an engine that is not running. */
export type EngineState = 'crz' | 'id' | 'off';

/** Idle and rev, the two loops one engine is made of. */
export interface EngineVoicing {
  /** Linear gain for the idle loop, 0 when it should not be heard. */
  readonly idleGain: number;
  readonly idlePitch: number;
  /** Linear gain for the rev loop. */
  readonly revGain: number;
  readonly revPitch: number;
  readonly state: EngineState;
}

/** Below this ratio a car is idling — `s_Config.DummyEngine.ID.Ratio` (`0x8CBBF0`). */
export const IDLE_RATIO = 0.2;

/** Above this ratio a cruising car stays cruising — `Rev.Ratio` (`0x8CBBF4`). The gap is hysteresis. */
export const REV_RATIO = 0.15;

/**
 * How long the idle↔idle crossfade takes.
 *
 * SA's own number is a step of **0.1 per frame** at its reference time step, so the fade completes in ten
 * frames — 0.2 s at the 50 fps that time step is one unit of. Written as the DURATION rather than the step
 * because a per-frame constant on a 10 Hz audio clock would fade five times too slowly, and because a
 * duration is the same on every device.
 */
export const IDLE_FADE_SECONDS = 0.2;

/** The same for the cruise↔cruise crossfade: SA steps 0.05 a frame, so twenty frames. */
export const CRZ_FADE_SECONDS = 0.4;

/** Idle frequency ends — `ID.FreqBase` / `ID.FreqMax` (`0x8CBBF8`, `0x8CBBFC`). */
const IDLE_PITCH = { base: 0.85, max: 1.2 };

/** Idle volume ends, dB — `ID.VolumeBase` / `ID.VolumeMax` (`0x8CBC00`, `0xB6B9CC`). */
const IDLE_DB = { base: -3, max: 0 };

/** Rev frequency ends — `Rev.FreqBase` / `Rev.FreqMax` (`0x8CBC0C`, `0x8CBC10`). */
const REV_PITCH = { base: 0.9, max: 1.5 };

/** Rev volume ends, dB — `Rev.VolumeBase` / `Rev.VolumeMax` (`0xB6BA2C`, `0xB6B9D0`). */
const REV_DB = { base: -4.5, max: 0 };

/** A piecewise-linear curve, as SA stores them: `[x, y]` pairs walked in order. */
type Curve = readonly (readonly [number, number])[];

/** Idle frequency while cruising — `0x8CC0EC`. The idle loop drops a sixth in pitch as it hands over. */
const IDLE_PITCH_WHILE_CRZ: Curve = [
  [0, 1],
  [0.3, 1],
  [0.5, 0.85],
  [0.7, 0.85],
  [1.0001, 0.85],
];

/** Idle GAIN while cruising — `0x8CC0C4`. It is a multiplier, which SA then writes as dB. */
const IDLE_GAIN_WHILE_CRZ: Curve = [
  [0, 1],
  [0.3, 1],
  [0.5, 1],
  [0.7, 0.707],
  [1.0001, 0],
];

/** Rev frequency while cruising — the little flare at 0.7 is SA's, and it is what a gear change sounds like. */
const REV_PITCH_WHILE_CRZ: Curve = [
  [0, 1],
  [0.5, 1],
  [0.7, 1.2],
  [0.85, 1],
  [1.0001, 1],
];

/** Rev gain while cruising — `0x8CC114`, the mirror of {@link IDLE_GAIN_WHILE_CRZ}. */
const REV_GAIN_WHILE_CRZ: Curve = [
  [0, 0],
  [0.3, 0],
  [0.5, 0.707],
  [0.7, 1],
  [1.0001, 1],
];

/** One car's engine, held across ticks because the crossfade has a position. */
export class VehicleEngine {
  /**
   * Where the crossfade is, 0..1.
   *
   * **SA holds TWO of these, `m_FadeIn` and `m_FadeOut`, and here they would always be equal**: they are
   * reset together on a state change and stepped by the same amount every tick, because the shipped config
   * gives the in and out steps the same value in both transitions it defines (0.1/0.1 idle, 0.05/0.05
   * cruise). Two fields that can never disagree read as two things that vary independently, which is a
   * false promise to whoever changes this next — so it is one, and this note is where the original's second
   * one went.
   */
  private fade = 0;
  private state: EngineState = 'off';

  /**
   * Advance the engine and say how its two loops should sound.
   *
   * @param ratio how fast the car is going, 0..1 of what it can do. See the module note — this is not a
   *   speed and it is deliberately not computed here.
   * @param dtSeconds the real gap since the last call.
   * @param running whether the engine is on at all. `false` silences both loops, the way `CAR_OFF` does.
   */
  update(ratio: number, dtSeconds: number, running = true): EngineVoicing {
    if (!running) {
      this.state = 'off';
      this.fade = 0;

      return { idleGain: 0, idlePitch: IDLE_PITCH.base, revGain: 0, revPitch: REV_PITCH.base, state: 'off' };
    }
    const clamped = Math.min(1, Math.max(0, ratio));
    const wanted = this.stateFor(clamped);
    if (wanted !== this.state) {
      // A state CHANGE restarts both fades, exactly as SA does when it crosses between DUMMY_ID and
      // DUMMY_CRZ — the crossfade is the transition, so carrying its old position over would make the
      // handover start halfway through.
      this.fade = 0;
      this.state = wanted;
    } else {
      const seconds = wanted === 'crz' ? CRZ_FADE_SECONDS : IDLE_FADE_SECONDS;
      const step = seconds <= 0 ? 1 : Math.max(0, dtSeconds) / seconds;
      this.fade = Math.min(1, this.fade + step);
    }

    return this.state === 'crz' ? this.cruising(clamped) : this.idling(clamped);
  }

  /** The cruising half: rev fades IN, idle fades out under it. */
  private cruising(ratio: number): EngineVoicing {
    const idle = idleProgress(ratio);
    const rev = revProgress(ratio);

    return {
      idleGain: gainOf(lerp(IDLE_DB.base, IDLE_DB.max, idle) + dbOf(curveAt(IDLE_GAIN_WHILE_CRZ, this.fade), 20)),
      idlePitch: lerp(IDLE_PITCH.base, IDLE_PITCH.max, idle) * curveAt(IDLE_PITCH_WHILE_CRZ, this.fade),
      revGain: gainOf(lerp(REV_DB.base, REV_DB.max, rev) + dbOf(curveAt(REV_GAIN_WHILE_CRZ, this.fade), 20)),
      revPitch:
        lerp(REV_PITCH.base, REV_PITCH.max, rev) * (this.fade < 0.99 ? curveAt(REV_PITCH_WHILE_CRZ, this.fade) : 1),
      state: 'crz',
    };
  }

  /** The idling half: idle fades IN, rev fades out and is dropped once it is gone. */
  private idling(ratio: number): EngineVoicing {
    const idle = idleProgress(ratio);
    const rev = revProgress(ratio);
    // SA stops the rev sound outright past 0.99 rather than leaving it at -inf dB, which is one fewer voice
    // against the pool's 64 for every idling car in the world.
    const revGone = this.fade >= 0.99;

    return {
      idleGain: gainOf(lerp(IDLE_DB.base, IDLE_DB.max, idle) + (this.fade <= 0.99 ? dbOf(this.fade, 10) : 0)),
      idlePitch: lerp(IDLE_PITCH.base, IDLE_PITCH.max, idle),
      revGain: revGone ? 0 : gainOf(lerp(REV_DB.base, REV_DB.max, rev) + dbOf(1 - this.fade, 10)),
      revPitch: lerp(REV_PITCH.base, REV_PITCH.max, rev),
      state: 'id',
    };
  }

  /**
   * Which side of the crossfade this ratio puts the car on.
   *
   * **The two thresholds are not the same number and that is deliberate in the original**: a car already
   * cruising stays cruising down to 0.15 while a car idling only starts cruising past 0.2, so a driver
   * holding a steady 0.17 does not sit on a switch flipping every tick.
   */
  private stateFor(ratio: number): EngineState {
    return this.state === 'crz' ? (ratio < REV_RATIO ? 'id' : 'crz') : ratio < IDLE_RATIO ? 'id' : 'crz';
  }
}

/**
 * A dB figure turned into the linear gain a voice takes.
 *
 * Not clamped to 1: the row's own `EngineVolumeOffset` is positive on trucks (+5 and +6 dB), and that is the
 * author saying a rig is louder than a sedan. A caller that cannot take a gain above 1 scales it itself.
 */
export function gainOf(db: number): number {
  return db <= SILENT_DB ? 0 : 10 ** (db / 20);
}

/** How far into its range the idle loop is: `ratio / 0.2`, clamped. */
export function idleProgress(ratio: number): number {
  return Math.min(1, Math.max(0, ratio / IDLE_RATIO));
}

/** How far into its range the rev loop is: `ratio` mapped from 0.15..1 onto 0..1. */
export function revProgress(ratio: number): number {
  return Math.min(1, Math.max(0, (ratio - REV_RATIO) / (1 - REV_RATIO)));
}

/** Read a piecewise-linear curve, the way `GetPiecewiseLinearT` does. */
function curveAt(curve: Curve, at: number): number {
  const first = curve[0];
  if (!first) {
    return 1;
  }
  if (at <= first[0]) {
    return first[1];
  }
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1];
    const point = curve[index];
    if (!previous || !point) {
      break;
    }
    if (at <= point[0]) {
      const span = point[0] - previous[0];

      return span <= 0 ? point[1] : lerp(previous[1], point[1], (at - previous[0]) / span);
    }
  }

  return curve[curve.length - 1]?.[1] ?? 1;
}

/** A gain multiplier as dB, which is how SA writes one into a volume. Zero is silence, not -infinity. */
function dbOf(gain: number, scale: number): number {
  return gain <= 0 ? SILENT_DB : scale * Math.log10(gain);
}

function lerp(from: number, to: number, at: number): number {
  return from + (to - from) * at;
}

/** Quiet enough to be nothing. SA's own floor is -100 dB, and it uses it for exactly this. */
const SILENT_DB = -100;
