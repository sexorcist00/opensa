/**
 * The synthesised floor under every panel sound (204/2-02).
 *
 * **A computed tone is the one sound in this chain with no failure mode to inherit.** Every other path can
 * be missing — no index, no game dir, a 404 on a package, a table built for another build — and
 * [203's decision 4.3](../../../docs/plans/203-audio/concept.md) accepts silence as the normal case for all
 * of them. **A panic button may not inherit that**, so the floor is arithmetic: no bytes, no fetch, no
 * decode, nothing to 404, and it is audible within one audio quantum of being asked for.
 *
 * **It is a floor rather than the product.** A deployment that ships the authored set sounds like PCAD, which
 * is the point of a shared vocabulary; one that cannot still alerts, and says so in its report.
 *
 * **The vocabulary is pitch and repetition, not timbre**, because that is what a dispatch console's alert
 * language has always been and because it is what survives a phone speaker. A sine cuts through a room
 * without being harsh, three pulses read as more urgent than one without being louder, and a falling pair
 * means *gone* to anybody who has ever used a two-way radio.
 */

/** One pulse: a frequency held for a time, at a level. */
export interface TonePulse {
  readonly gain: number;
  readonly hz: number;
  readonly seconds: number;
}

/** A named tone: pulses in order, separated by {@link GAP_SECONDS}. */
export type ToneSpec = readonly TonePulse[];

/** Silence between pulses. Long enough to read as separate, short enough to read as one sound. */
export const GAP_SECONDS = 0.06;

/** How long a pulse takes to reach full — short, but never a step, because a step is a click. */
const ATTACK_SECONDS = 0.004;

/** How long it takes to fall away. Longer than the attack so a pulse ends rather than stops. */
const RELEASE_SECONDS = 0.03;

/** A5 — the alert pitch: high enough to cut a room, low enough not to be shrill on a phone. */
const HI = 880;

/** D6 above it. The pair is a musical fourth, which is the two-tone every emergency service uses. */
const HIGHER = 1_174;

/** E5 below. A fall to it reads as *gone*. */
const LO = 660;

/**
 * The tones, by the name the [contract](../../../docs/contracts/panel-audio.md) gives the event.
 *
 * Only the shapes that carry MEANING are distinct: urgency is repetition, direction is pitch, and everything
 * routine is one soft tone. A vocabulary where every event sounds different is a vocabulary nobody learns.
 */
/* eslint-disable camelcase -- these are CONTRACT names, shared verbatim with PCAD's own trigger table
   (docs/contracts/panel-audio.md). Renaming one here would silently stop matching the other repository,
   which is the exact failure the contract exists to prevent. */
export const PANEL_TONES: Readonly<Record<string, ToneSpec>> = {
  // Hi-lo, three times: the sound every emergency service in the world uses for *now*.
  alpr_hit: [{ gain: 0.5, hz: HIGHER, seconds: 0.1 }],
  assist_request: [
    { gain: 0.8, hz: HIGHER, seconds: 0.12 },
    { gain: 0.8, hz: HI, seconds: 0.12 },
  ],
  bolo_new: [{ gain: 0.5, hz: HI, seconds: 0.14 }],
  call_closed: [{ gain: 0.4, hz: LO, seconds: 0.12 }],
  // Three pulses, two, one: urgency without volume, which is what a priority is.
  call_created_p1: [
    { gain: 0.8, hz: HIGHER, seconds: 0.09 },
    { gain: 0.8, hz: HIGHER, seconds: 0.09 },
    { gain: 0.8, hz: HIGHER, seconds: 0.09 },
  ],
  call_created_p2: [
    { gain: 0.7, hz: HI, seconds: 0.1 },
    { gain: 0.7, hz: HI, seconds: 0.1 },
  ],
  call_created_p3: [{ gain: 0.6, hz: HI, seconds: 0.12 }],
  incident_created: [
    { gain: 0.6, hz: HI, seconds: 0.09 },
    { gain: 0.6, hz: HIGHER, seconds: 0.12 },
  ],
  // Rising: it came back.
  link_back: [
    { gain: 0.7, hz: LO, seconds: 0.1 },
    { gain: 0.7, hz: HI, seconds: 0.14 },
  ],
  // Falling, twice: something went away, and you are being told twice because it matters.
  link_lost: [
    { gain: 0.9, hz: HI, seconds: 0.12 },
    { gain: 0.9, hz: LO, seconds: 0.18 },
    { gain: 0.9, hz: HI, seconds: 0.12 },
    { gain: 0.9, hz: LO, seconds: 0.18 },
  ],
  notification: [{ gain: 0.45, hz: HI, seconds: 0.09 }],
  panic_button: [
    { gain: 1, hz: HIGHER, seconds: 0.1 },
    { gain: 1, hz: HI, seconds: 0.1 },
    { gain: 1, hz: HIGHER, seconds: 0.1 },
    { gain: 1, hz: HI, seconds: 0.1 },
    { gain: 1, hz: HIGHER, seconds: 0.1 },
    { gain: 1, hz: HI, seconds: 0.1 },
  ],
  simplex_accepted: [
    { gain: 0.5, hz: HI, seconds: 0.08 },
    { gain: 0.5, hz: HIGHER, seconds: 0.1 },
  ],
  simplex_declined: [
    { gain: 0.5, hz: HI, seconds: 0.08 },
    { gain: 0.5, hz: LO, seconds: 0.1 },
  ],
  simplex_request: [{ gain: 0.5, hz: HIGHER, seconds: 0.08 }],
  unit_arrived: [{ gain: 0.4, hz: HIGHER, seconds: 0.08 }],
  unit_assigned: [{ gain: 0.4, hz: HI, seconds: 0.08 }],
  unit_stale: [
    { gain: 0.55, hz: LO, seconds: 0.16 },
    { gain: 0.55, hz: LO, seconds: 0.16 },
  ],
};

/**
 * Render one tone to mono samples.
 *
 * **Pure, and deterministic to the sample** — no oscillator nodes, no scheduling, no context. That is what
 * makes a tone testable at all, and it is also why the floor cannot fail: there is nothing here to be
 * absent.
 *
 * The phase runs continuously across a pulse rather than restarting per sample block, and each pulse is
 * enveloped — a bare sine switched on and off is two clicks with a note between them.
 */
export function renderTone(spec: ToneSpec, sampleRate: number): Float32Array {
  const total = Math.max(1, Math.round(toneSeconds(spec) * sampleRate));
  const samples = new Float32Array(total);
  let at = 0;
  for (const [index, pulse] of spec.entries()) {
    const length = Math.round(pulse.seconds * sampleRate);
    const step = (2 * Math.PI * pulse.hz) / sampleRate;
    for (let sample = 0; sample < length && at + sample < total; sample += 1) {
      const seconds = sample / sampleRate;
      samples[at + sample] = Math.sin(step * sample) * pulse.gain * envelope(seconds, pulse.seconds);
    }
    at += length + (index < spec.length - 1 ? Math.round(GAP_SECONDS * sampleRate) : 0);
  }

  return samples;
}

/* eslint-enable camelcase */

/** How long a spec runs, in seconds — the pulses plus the gaps between them. */
export function toneSeconds(spec: ToneSpec): number {
  if (spec.length === 0) {
    return 0;
  }

  return spec.reduce((total, pulse) => total + pulse.seconds, 0) + GAP_SECONDS * (spec.length - 1);
}

/** Attack in, release out, flat between. Zero at both ends, which is the whole job. */
function envelope(at: number, seconds: number): number {
  if (at < ATTACK_SECONDS) {
    return at / ATTACK_SECONDS;
  }
  const left = seconds - at;
  if (left < RELEASE_SECONDS) {
    return Math.max(0, left / RELEASE_SECONDS);
  }

  return 1;
}
