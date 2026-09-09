/**
 * How far away a sound is, and which ear it is in (203/3-02).
 *
 * **One model, used for both hearing and stealing.** The pool's rule is *the quietest voice AT THE LISTENER
 * is the one stolen* (203's decision 4.2), which needs a number for how loud each live voice actually is —
 * and if the browser's panner computed the gain we hear while we computed a different one to rank by, the
 * rule would steal a voice that is not the quietest. So the attenuation lives here, in one function, and the
 * graph applies exactly what this returns.
 *
 * **That is also why a voice is a gain plus a stereo pan rather than a `PannerNode`** (an assumption taken
 * 2026-09-09 with the operator away, and stated here so the next reader can challenge it): the panner would
 * own a second distance model, it is the heavier node on the phone this console is aimed at, and the plan
 * already flags *64 voices each with a `PannerNode`* as a number nobody has measured. What would retire the
 * choice is a field verdict that the stereo image reads flat — `PannerNode` with these same parameters is
 * the upgrade, and the formula below is the Web Audio `inverse` distance model precisely so the numbers
 * carry over unchanged.
 *
 * The DEFAULT distances are a fitted bridge and are recorded as one:
 * [docs/hacks/audio-distance-defaults.md](../../../docs/hacks/audio-distance-defaults.md).
 */

/** Where the ear is and which way it faces. GTA world coordinates, native Z-up. */
export interface AudioListener {
  /** Unit vector the listener looks along. */
  readonly forward: Vec3;
  readonly position: Vec3;
  /** Unit vector to the listener's right — the axis a stereo pan is taken on. */
  readonly right: Vec3;
}

/** How a sound fades with distance. The Web Audio `inverse` model's three parameters, by the same names. */
export interface Falloff {
  /** Past this, the distance stops growing for the purposes of the curve — the sound goes quiet, not silent. */
  readonly maxDistance: number;
  /** Inside this radius a sound is at full gain. */
  readonly refDistance: number;
  /** How fast it falls outside `refDistance`. 1 is the physical inverse law. */
  readonly rolloffFactor: number;
}

export type Vec3 = readonly [number, number, number];

/**
 * The default falloff, in GTA units (metres).
 *
 * **Fitted, not recovered** — SA keeps a per-sound maximum distance in the executable's own audio tables
 * rather than in any data file this project parses, so there is nothing to read yet. Stated here as one
 * number so every consumer inherits the same bridge and it can be replaced in one place.
 */
export const DEFAULT_FALLOFF: Falloff = { maxDistance: 300, refDistance: 5, rolloffFactor: 1 };

/**
 * The Web Audio `inverse` distance model, written out.
 *
 * ```text
 * refDistance / (refDistance + rolloffFactor × (clamp(d, ref, max) − refDistance))
 * ```
 *
 * Clamping at `maxDistance` rather than cutting to zero is the spec's own behaviour and the one this
 * console wants: a city heard from 900 m up is faint, not switched off (203's decision 2.3).
 */
export function attenuation(distance: number, falloff = DEFAULT_FALLOFF): number {
  const { maxDistance, refDistance, rolloffFactor } = falloff;
  if (refDistance <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(distance, refDistance), Math.max(maxDistance, refDistance));

  return refDistance / (refDistance + rolloffFactor * (clamped - refDistance));
}

/**
 * What a sound is worth AT THE LISTENER — its authored gain times its distance attenuation.
 *
 * This is the number the pool ranks by, and the number the graph applies. A non-positional sound (an alert
 * in the chrome) has no position and is worth its gain everywhere.
 */
export function audibleGain(
  listener: AudioListener,
  source: null | Vec3,
  gain: number,
  falloff = DEFAULT_FALLOFF,
): number {
  if (source === null) {
    return gain;
  }

  return gain * attenuation(distanceBetween(listener.position, source), falloff);
}

/** Straight-line distance between two world points. */
export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Where the sound sits between the ears: -1 hard left, 0 centre, +1 hard right.
 *
 * The projection of the direction-to-source onto the listener's RIGHT vector, which is the whole of it: a
 * source directly ahead, directly behind or directly overhead is centred, because two ears cannot tell those
 * apart either. A source at the listener's own position is centred rather than undefined.
 */
export function panFor(listener: AudioListener, source: Vec3): number {
  const dx = source[0] - listener.position[0];
  const dy = source[1] - listener.position[1];
  const dz = source[2] - listener.position[2];
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) {
    return 0;
  }
  const { right } = listener;
  const projection = (dx * right[0] + dy * right[1] + dz * right[2]) / length;

  return Math.min(1, Math.max(-1, projection));
}
