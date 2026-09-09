/**
 * The ambience bed: what a place sounds like when nothing in particular is happening (203/4-02).
 *
 * **This step was BLOCKED on a question, and the reverse answered it** — the recovered design is written
 * down in [`docs/gta-sa-original/audio-ambience.md`](../../../docs/gta-sa-original/audio-ambience.md), read
 * from `CAEAmbienceTrackManager`, `CAEWeatherAudioEntity` and `CAETwinLoopSoundEntity`. Three findings shape
 * everything below:
 *
 * 1. **San Andreas plays no general ambience bed.** A street sounds like a street because cars, peds and
 *    doors are emitting sounds — the ambience is EMERGENT. A dispatch console has no traffic and no
 *    pedestrians, so it inherits nothing, and a bed has to be built rather than taken.
 * 2. **The zone tracks it does play are per-zone specials**, mapped id → stream by a hand-written `switch`.
 *    That mapping is CODE, which [directive 1](../../../docs/project-goals.md) says is not ours to port —
 *    so ours is a TABLE (`AMB_<ZONE>` rows in `audio-events.dat`, [the contract](../../../docs/contracts/audio.md)),
 *    and the streams stay out of v1 ([the card](../../../docs/in-reserve/audio-stream-tracks.md)).
 * 3. **`CAETwinLoopSoundEntity` is how SA hides a short loop**, and it is worth copying by behaviour: two
 *    voices of the SAME sound, started at different points, one audible and one muted, their volumes
 *    exchanged at a RANDOM interval and neither ever restarted. The randomness is the point — a fixed swap
 *    is a rhythm, and a rhythm is what an ear learns and then cannot stop hearing.
 *
 * **Three places where this deliberately does better than the original**, per directive 1's requirement that
 * beating a 2004 compromise is the default and matching it is what needs an argument:
 *
 * - SA exchanges the two volumes INSTANTLY (`std::exchange(curr->m_Volume, -100.f)`). A step in an envelope
 *   is a click, which is the same defect `voices.ts` already ramps away from when it steals a voice. Ours
 *   crossfades over {@link TWIN_SWAP_SECONDS} — long enough to have no transient, short enough that the
 *   3 dB dip of a linear crossfade between two uncorrelated points passes unheard.
 * - SA draws the two start points independently (`GetRandomNumberInRange<int16>(0, 99)` each), so roughly a
 *   tenth of its pairs start close enough together that swapping does nothing. Ours draws the second one a
 *   third to two thirds of the loop away from the first, so a swap always moves.
 * - The bed's level WALKS towards its target rather than jumping, which is SA's own idea taken from the
 *   place it does use it (`notsa::step_to(m_sfRainVolume, targetVolume, 0.5f)`) and applied to the zone
 *   change it does not.
 *
 * **The height rule is not an invention either.** SA's zone 4 falls with camera height, and this console
 * needs the same thing for a different reason: its listener is the camera as it is (decision 2.3), so a flat
 * bed would be at full volume from 900 m up, contradicting the one thing that decision promises.
 */
import type { OsaudioZone } from '@opensa/engine-formats';

import type { Vec3 } from './spatial';
import type { Voice } from './voices';

/** What the bed needs from the world outside this package. */
export interface AmbienceHost {
  /**
   * Whether the build's event table carries this name.
   *
   * **Silent on purpose**: the layer probe asks for `_2`, `_3` and `_4` on every zone change, and a lookup
   * that reported absence would fill the report with names nobody ever authored.
   */
  has(name: string): boolean;
  /** Milliseconds, monotonic. Injected so a test can drive a random swap interval without waiting for it. */
  /**
   * Said once when a bed resolved to no layers at all — the table carries no `AMB_` row for this place.
   *
   * **This is the guard the deferred stream path is named at** (`docs/in-reserve/audio-stream-tracks.md`):
   * an assembled bed that is missing, or judged thin against what SA's own `AMBIENCE` stream carries, is the
   * condition that turns reading `audio/streams/` into work.
   */
  noLayers(bed: string): void;
  nowMs(): number;
  /** 0..1. Injected for the same reason — a random start point is untestable otherwise. */
  random(): number;
  /** Change a live voice's gain over `seconds`. */
  setGain(voice: Voice, gain: number, seconds: number): void;
  /**
   * Start one LOOPING voice of a named event — flat, with no position, because a bed is where you are.
   *
   * `startFraction` is how far through the buffer it begins, 0..1. `null` when this build cannot play it.
   */
  startLoop(name: string, startFraction: number, gain: number): Promise<null | Voice>;
}

/** What a capture says about the bed. */
export interface AmbienceReport {
  /** The bed being played, or `null` before the first update. */
  readonly bed: null | string;
  /** Zone changes, ever — the number that says whether a boundary is being crossed repeatedly. */
  readonly changes: number;
  /** Beds still fading out. Above 1 for long means zones are being crossed faster than the crossfade. */
  readonly fading: number;
  /**
   * Layers the current bed resolved to. Zero with a bed named is a table with no `AMB_` rows — and a bed
   * that resolves but reads THIN is the other half of the same trigger
   * ([the card](../../../docs/in-reserve/audio-stream-tracks.md)).
   */
  readonly layers: number;
  /** Where the current bed's crossfade is, 0..1, before the height rule. */
  readonly level: number;
  /** Voices asked for and not yet answered. Stuck above zero is a fetch that never returns. */
  readonly pending: number;
  /** Loop voices actually started. */
  readonly starts: number;
  /** Twin-loop exchanges, ever. */
  readonly swaps: number;
}

/** The prefix an ambience row carries. See `docs/contracts/audio.md`. */
export const AMBIENCE_PREFIX = 'AMB_';

/**
 * The bed for the open world, and the fallback for any zone that does not name one of its own.
 *
 * **A zone made SILENT is expressible**: author `AMB_<ZONE>` with a gain of 0 and it wins the lookup while
 * being inaudible. Without that, an interior with no bed of its own would inherit the outdoor one.
 */
export const DEFAULT_BED = `${AMBIENCE_PREFIX}DEFAULT`;

/** How many layers one bed may stack: `AMB_X`, `AMB_X_2`, `AMB_X_3`, `AMB_X_4`. */
export const MAX_BED_LAYERS = 4;

/** How long one bed takes to replace another, in seconds. */
export const CROSSFADE_SECONDS = 2;

/**
 * The twin-loop exchange, in seconds — the one number the original does not have.
 *
 * A linear crossfade between two uncorrelated points of the same recording dips about 3 dB at its midpoint.
 * 25 ms is short enough for that dip to pass as texture and long enough that there is no transient, which is
 * the whole reason not to do what SA does and switch instantly.
 */
export const TWIN_SWAP_SECONDS = 0.025;

/**
 * The window a swap is drawn from, in milliseconds — a fitted bridge, filed as
 * [a hack](../../../docs/hacks/audio-twin-loop-swap.md).
 *
 * SA keeps its swap windows at each call site in the executable (rain is 65–350 ms), so there is nothing in
 * any data file to read. These are ours, chosen against the census's loop lengths — 172 loops of at least a
 * second, the longest 5.25 s — so that a swap lands neither inside every cycle nor once a minute.
 */
export const TWIN_SWAP_MIN_MS = 1_500;

/** @see TWIN_SWAP_MIN_MS */
export const TWIN_SWAP_MAX_MS = 6_000;

/** Below this height the bed is at full volume, in GTA units. */
export const BED_FULL_HEIGHT = 60;

/** At and above this height the bed is silent. */
export const BED_SILENT_HEIGHT = 400;

/** How far apart the two start points of a twin are drawn, as a fraction of the loop. */
const TWIN_OFFSET_MIN = 1 / 3;

/** @see TWIN_OFFSET_MIN */
const TWIN_OFFSET_MAX = 2 / 3;

/** One bed, playing or on its way out. */
interface Bed {
  /** False once retired: a voice whose fetch returns afterwards stops itself instead of joining a corpse. */
  alive: boolean;
  /** Where its crossfade is, 0..1. */
  level: number;
  readonly name: string;
  readonly twins: Twin[];
}

/** One layer: two voices of one sound, one of them audible. */
interface Twin {
  readonly name: string;
  playingFirst: boolean;
  /** When the current exchange finishes — until then the tick leaves this twin's gains alone. */
  rampEndsAtMs: number;
  swapAtMs: number;
  readonly voices: [null | Voice, null | Voice];
}

/** Holds the bed the listener is standing in, and the one it is replacing. */
export class Ambience {
  private changes = 0;
  private current: Bed | null = null;
  private readonly fading: Bed[] = [];
  private readonly host: AmbienceHost;
  private pending = 0;
  private starts = 0;
  private swaps = 0;

  constructor(host: AmbienceHost) {
    this.host = host;
  }

  report(): AmbienceReport {
    return {
      bed: this.current?.name ?? null,
      changes: this.changes,
      fading: this.fading.length,
      layers: this.current?.twins.length ?? 0,
      level: this.current?.level ?? 0,
      pending: this.pending,
      starts: this.starts,
      swaps: this.swaps,
    };
  }

  /** Let every voice go. The pool ramps each one out, so this is silent rather than abrupt. */
  stop(): void {
    for (const bed of [this.current, ...this.fading]) {
      if (bed) {
        this.retire(bed);
      }
    }
    this.fading.length = 0;
    this.current = null;
  }

  /**
   * One tick: where the ear is, and how long since the last one.
   *
   * @param gapSeconds the REAL gap the clock measured, not the nominal one — a throttled tab crossfades in
   *   the same wall-clock time rather than at whatever rate the browser felt like running at.
   */
  update(zone: null | OsaudioZone, ear: Vec3, gapSeconds: number): void {
    const wanted = this.bedFor(zone);
    if (this.current === null || this.current.name !== wanted) {
      this.changeTo(wanted);
    }
    const height = bedGainForHeight(ear[2]);
    if (this.current) {
      this.advance(this.current, 1, gapSeconds, height);
    }
    for (const bed of [...this.fading]) {
      this.advance(bed, 0, gapSeconds, height);
      if (bed.level <= 0) {
        this.retire(bed);
        this.fading.splice(this.fading.indexOf(bed), 1);
      }
    }
  }

  /** Walk one bed's level towards its target and apply it to every twin. */
  private advance(bed: Bed, target: number, gapSeconds: number, height: number): void {
    const step = Math.max(0, gapSeconds) / CROSSFADE_SECONDS;
    bed.level = bed.level < target ? Math.min(target, bed.level + step) : Math.max(target, bed.level - step);
    const gain = bed.level * height;
    const now = this.host.nowMs();
    for (const twin of bed.twins) {
      if (now >= twin.swapAtMs) {
        this.swap(twin, gain, now);
      }
      // The swap is checked FIRST and the hold still runs, because a swap that could not happen — a twin
      // whose other half never started — leaves nothing scheduled. Written as two ifs rather than a chain
      // for that reason: as an `else if` such a twin's gain freezes at whatever it last was, so it neither
      // crossfades out nor follows the height rule, and it is silent.
      if (now >= twin.rampEndsAtMs) {
        // Ramped over the tick's own gap so the level is continuous between ticks rather than stepped ten
        // times a second, which would be its own click track.
        const voice = playingVoice(twin);
        if (voice) {
          this.host.setGain(voice, gain, gapSeconds);
        }
      }
    }
  }

  /** The name of the bed for a zone: its own if the table carries one, the default otherwise. */
  private bedFor(zone: null | OsaudioZone): string {
    const named = bedNameFor(zone);

    return named !== DEFAULT_BED && this.host.has(named) ? named : DEFAULT_BED;
  }

  /** Put a new bed on and start the old one fading. Both play through the crossfade. */
  private changeTo(name: string): void {
    if (this.current) {
      this.fading.push(this.current);
    }
    this.changes += 1;
    const bed: Bed = { alive: true, level: 0, name, twins: [] };
    this.current = bed;
    const layers = bedLayerNames(name, (probe) => this.host.has(probe));
    if (layers.length === 0) {
      this.host.noLayers(name);
    }
    for (const layer of layers) {
      this.startTwin(bed, layer);
    }
  }

  /** When the next exchange lands. */
  private nextSwapAt(now: number): number {
    return now + TWIN_SWAP_MIN_MS + this.host.random() * (TWIN_SWAP_MAX_MS - TWIN_SWAP_MIN_MS);
  }

  private retire(bed: Bed): void {
    bed.alive = false;
    for (const twin of bed.twins) {
      for (const voice of twin.voices) {
        voice?.stop();
      }
    }
  }

  /** Start one layer's pair. Both fetches are in flight at once; neither blocks the tick. */
  private startTwin(bed: Bed, name: string): void {
    const first = this.host.random();
    const second = (first + TWIN_OFFSET_MIN + this.host.random() * (TWIN_OFFSET_MAX - TWIN_OFFSET_MIN)) % 1;
    const twin: Twin = {
      name,
      playingFirst: true,
      rampEndsAtMs: 0,
      swapAtMs: this.nextSwapAt(this.host.nowMs()),
      voices: [null, null],
    };
    bed.twins.push(twin);
    // The audible one starts at the bed's CURRENT level, which is 0 on a fresh bed — so a bed fades in
    // through the same path a crossfade uses, rather than having a second one for its first moment.
    void this.take(bed, twin, 0, first, bed.level);
    void this.take(bed, twin, 1, second, 0);
  }

  /** Exchange the two volumes, the way SA does — with a ramp, which is the way it does not. */
  private swap(twin: Twin, gain: number, now: number): void {
    const [a, b] = twin.voices;
    if (a && b) {
      const rising = twin.playingFirst ? b : a;
      const falling = twin.playingFirst ? a : b;
      this.host.setGain(rising, gain, TWIN_SWAP_SECONDS);
      this.host.setGain(falling, 0, TWIN_SWAP_SECONDS);
      twin.playingFirst = !twin.playingFirst;
      this.swaps += 1;
      twin.rampEndsAtMs = now + TWIN_SWAP_SECONDS * 1_000;
    }
    twin.swapAtMs = this.nextSwapAt(now);
  }

  /** Await one voice and put it in its slot — unless its bed is already gone. */
  private async take(bed: Bed, twin: Twin, slot: 0 | 1, fraction: number, gain: number): Promise<void> {
    this.pending += 1;
    const voice = await this.host.startLoop(twin.name, fraction, gain);
    this.pending -= 1;
    if (voice === null) {
      return;
    }
    if (!bed.alive) {
      voice.stop();

      return;
    }
    twin.voices[slot] = voice;
    this.starts += 1;
  }
}

/**
 * How loud a bed is at this height.
 *
 * Linear between the two bounds, which is enough: the ear is judging *is the city there*, not reading a
 * curve, and a shape with a name would be a constant nobody could defend either.
 */
export function bedGainForHeight(height: number): number {
  if (height <= BED_FULL_HEIGHT) {
    return 1;
  }
  if (height >= BED_SILENT_HEIGHT) {
    return 0;
  }

  return (BED_SILENT_HEIGHT - height) / (BED_SILENT_HEIGHT - BED_FULL_HEIGHT);
}

/**
 * The layers one bed resolves to, in order.
 *
 * Every slot is probed rather than stopping at the first gap: a table with `AMB_X` and `AMB_X_3` and no
 * `AMB_X_2` is a typo, and silently dropping the third layer is exactly the kind of silent loss this chain
 * keeps finding.
 */
export function bedLayerNames(bed: string, has: (name: string) => boolean): readonly string[] {
  const names: string[] = [];
  for (let layer = 1; layer <= MAX_BED_LAYERS; layer += 1) {
    const name = layer === 1 ? bed : `${bed}_${layer}`;
    if (has(name)) {
      names.push(name);
    }
  }

  return names;
}

/** The event name a zone's bed is authored under. */
export function bedNameFor(zone: null | OsaudioZone): string {
  if (zone === null) {
    return DEFAULT_BED;
  }

  return AMBIENCE_PREFIX + zone.name.toUpperCase().replace(/[^A-Z0-9]+/gu, '_');
}

/**
 * The voice a twin is currently hearing.
 *
 * A pair whose other half never started (a fetch that failed, a pool that was full) degenerates to a single
 * loop rather than going silent: it is a worse bed, and it is a bed.
 */
function playingVoice(twin: Twin): null | Voice {
  const [a, b] = twin.voices;

  return (twin.playingFirst ? a : b) ?? a ?? b;
}
