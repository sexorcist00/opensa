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
  AmbienceHost,
  AmbienceLoop,
  AmbienceReport,
  AudioAbsenceReport,
  AudioAvailability,
  AudioBufferLike,
  AudioClockHost,
  AudioClockReport,
  AudioContextLike,
  AudioListener,
  GestureTarget,
  Voice,
  VoicePoolReport,
} from '@opensa/audio';
import type { OsaudioIndex } from '@opensa/engine-formats';
import type { AudioCacheReport } from '@opensa/loaders/audio-cache';
import type { AudioSource } from '@opensa/loaders/audio-source';
import type { AudioEventRow } from '@opensa/renderware/parsers/text/audio-events.parser';
import type { HandlingEntry } from '@opensa/renderware/parsers/text/handling.parser';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';
import type { VehicleDef } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import {
  Ambience,
  AudioAbsence,
  AudioClock,
  AudioEventTable,
  AudioHost,
  audioZoneAt,
  browserClockHost,
  VehicleVoiceTable,
  VoicePool,
} from '@opensa/audio';
import { AudioCache } from '@opensa/loaders/audio-cache';
import { openAudioSource } from '@opensa/loaders/audio-source';

import type { Unit } from '../ops/types';
import type { UnitAudioReport, WarmSound } from './unit-audio';

import { UnitAudio } from './unit-audio';

/** Whether this run makes sound at all. `off` is `?audio=0`, spelled the way a filed row spells it. */
export type AudioArm = 'off' | 'on';

/** What a capture says about sound — the fields 3/04 and 4/03 are filed against. */
export interface DispatchAudioReport {
  /** What could not be heard, and why. Counts stay exact; the first reasons are named. */
  readonly absence: AudioAbsenceReport;
  /** The ambience bed: which one, how far into its crossfade, and how many twins it is made of. */
  readonly ambience: AmbienceReport;
  readonly arm: AudioArm;
  /** What a surface would draw an indicator from. */
  readonly availability: AudioAvailability;
  /** The decoded-buffer cache against its 64 MB ceiling — bytes, entries, evictions, hits, misses. */
  readonly buffers: AudioCacheReport;
  /** The audio tick's own cost — the 2 ms budget's number, beside the rate it was taken at. */
  readonly clock: AudioClockReport;
  /** How many named events resolved against this build's index. Zero with an index present is a table
   *  built for a different game. */
  readonly events: number;
  /** Gestures the browser turned down. Non-zero with `waiting` means the wiring, not the operator. */
  readonly resumesRefused: number;
  /** What the board's own cars sound like — engines running, sirens wailing, models this build cannot voice. */
  readonly units: UnitAudioReport;
  /** How many cars resolved against this build's index and its handling rows. */
  readonly vehicles: number;
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
  private readonly ambience: Ambience;
  private readonly arm: AudioArm;
  private readonly buffers: AudioCache<AudioBufferLike>;
  private readonly clock: AudioClock;
  private readonly host: AudioHost;
  private index: null | OsaudioIndex = null;
  private readonly pending = new Set<number>();
  private readonly pool: null | VoicePool;
  private source: AudioSource | null = null;
  private table: AudioEventTable;
  private readonly units: null | UnitAudio;
  private readonly unreadable = new Set<number>();
  private vehicles: VehicleVoiceTable = VehicleVoiceTable.empty();
  private volume = 1;

  constructor(
    params: URLSearchParams,
    options: {
      clockHost?: AudioClockHost;
      /** How the context is made. Absent, the browser's own — a test hands a fake one. */
      createContext?: () => AudioContextLike;
      log?: (message: string) => void;
      /** Where the ambience's randomness comes from. Absent, `Math.random`. */
      random?: () => number;
    } = {},
  ) {
    this.arm = audioArm(params);
    const log = options.log ?? warn;
    this.absence = new AudioAbsence(log);
    // The arm removes the whole path rather than muting it, the way `?models=0` removes the fleet: a run
    // that still built a context and a pool would measure a silent console, not a console with no audio.
    this.host = new AudioHost(
      this.arm === 'off' ? { createContext: refuseContext, log } : { createContext: options.createContext, log },
    );
    const context = this.host.audioContext;
    this.pool = context ? new VoicePool(context) : null;
    this.clock = new AudioClock(options.clockHost ?? browserClockHost());
    this.buffers = new AudioCache<AudioBufferLike>({ bytesOf: (value): number => value.length * 4 });
    this.table = AudioEventTable.empty(this.absence);
    this.ambience = new Ambience(this.ambienceHost(options.random));
    this.units =
      this.pool === null
        ? null
        : new UnitAudio({
            bufferFor: (soundIndex): null | WarmSound => this.warm(soundIndex),
            events: (): AudioEventTable => this.table,
            pool: this.pool,
            vehicles: (): VehicleVoiceTable => this.vehicles,
          });
  }

  /** Wire the first touch. Anything that reaches the page wakes the context — no gate screen, ever. */
  attach(target: GestureTarget): () => void {
    return this.host.attachGestures(target);
  }

  /**
   * Let the audio go entirely: the tick, the voices, the cached buffers and the CONTEXT.
   *
   * **Closing the context is the half that matters on a mode switch** (201/6-03). The console is torn down
   * and rebuilt when the surface changes, and a browser allows only a handful of `AudioContext`s per page —
   * so a host that kept its context would leak one per switch and go silent on the fourth or fifth with no
   * error anyone could act on.
   */
  async dispose(): Promise<void> {
    this.stop();
    this.buffers.clear();
    await this.host.dispose();
  }

  /**
   * Give the console something to play: the baked index, the author's event rows, and the game dir the
   * samples are fetched from.
   *
   * Every part is optional and absence is a REPORTED state rather than an error — no index, no game dir, an
   * event table naming banks this build has not got. Called again, it replaces what was loaded.
   */
  load(options: {
    defs?: ReadonlyMap<string, VehicleDef>;
    gameDir: string;
    handling?: ReadonlyMap<string, HandlingEntry>;
    index: null | OsaudioIndex;
    rows: readonly AudioEventRow[];
    vehicles?: readonly VehicleAudioRow[];
  }): void {
    this.table = AudioEventTable.resolve(options.rows, options.index, this.absence);
    this.vehicles = VehicleVoiceTable.resolve(
      options.vehicles ?? [],
      options.defs ?? new Map(),
      options.handling ?? new Map(),
      options.index,
      this.absence,
    );
    this.source = options.index === null ? null : openAudioSource(options.gameDir, options.index);
    this.index = options.index;
    if (options.index !== null && this.source === null) {
      this.absence.sourceAbsent();
    }
  }

  /**
   * Play a named event at a world position, or answer `null` when this build cannot.
   *
   * The fetch is one Range request the first time and a cache hit afterwards; the decode is a copy and a
   * divide. Both happen OFF the audio clock — this returns a promise and the tick never waits for it.
   */
  async play(
    name: string,
    position: [number, number, number] | null = null,
    options: { gainScale?: number; startFraction?: number } = {},
  ): Promise<null | Voice> {
    const event = this.table.find(name);
    const sound = event === null || this.index === null ? null : this.index.sounds[event.soundIndex];
    if (!event || !sound || this.pool === null) {
      return null;
    }
    const buffer = await this.buffer(event.soundIndex, sound.sampleRate);
    if (buffer === null) {
      return null;
    }

    return this.pool.play({
      buffer,
      // Everything reached through the event table is the CITY: the ambience bed, a unit's engine, a horn.
      // The panel's own categories arrive on their own buses (204/2-03), never through here.
      bus: 'world',
      falloff: event.falloff,
      gain: event.gain * (options.gainScale ?? 1),
      loop: event.loop,
      loopStartSeconds: event.loopStartSeconds,
      pitch: sound.sampleRate / Math.max(sound.sampleRate, MIN_BUFFER_RATE),
      position,
      // A fraction of the BUFFER rather than of the source: the two differ only for the one sound below
      // Web Audio's rate floor, and the offset a source takes is in the buffer's own time.
      startOffsetSeconds: (options.startFraction ?? 0) * buffer.duration,
    });
  }

  report(): DispatchAudioReport {
    return {
      absence: this.absence.report(),
      ambience: this.ambience.report(),
      arm: this.arm,
      availability: this.host.state.availability,
      buffers: this.buffers.report(),
      clock: this.clock.report(),
      events: this.table.size,
      resumesRefused: this.host.state.resumesRefused,
      units: this.units?.report() ?? { engines: 0, sirens: 0, unvoiced: 0 },
      vehicles: this.vehicles.size,
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
  start(listenerOf: () => AudioListener, unitsOf: () => readonly Unit[] = (): readonly Unit[] => []): void {
    if (this.pool === null) {
      return;
    }
    const pool = this.pool;
    this.clock.start((gapSeconds) => {
      const listener = listenerOf();
      pool.setListener(listener);
      // The zone lookup is 155 point tests (203/4-01) and it runs on the AUDIO clock, ten a second — not on
      // the frame, which the render gate takes to zero at rest.
      this.ambience.update(audioZoneAt(this.index?.zones ?? [], listener.position), listener.position, gapSeconds);
      this.units?.update(unitsOf(), listener.position, gapSeconds);
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

  /** Stop the tick and every voice. The context STAYS, so a resume is instant — see `dispose`. */
  stop(): void {
    this.clock.stop();
    this.ambience.stop();
    this.units?.stop();
    this.pool?.stopAll();
  }

  /**
   * What the ambience bed reaches the rest of this file through (203/4-02).
   *
   * Everything about HOW a bed behaves — the twin loop, the crossfade, the height rule — lives in
   * `@opensa/audio`; this is only the four things it cannot know: what the table carries, what time it is,
   * where the randomness comes from, and how to start a voice.
   *
   * @param random injected so a capture can be replayed. Absent, the platform's own.
   */
  private ambienceHost(random?: () => number): AmbienceHost {
    return {
      has: (name): boolean => this.table.has(name),
      // A place with no `AMB_` row is the same absence as any other unknown name, said once. It is also the
      // TRIGGER on `docs/in-reserve/audio-stream-tracks.md`: a bed that is missing — or one an ear calls
      // thin against SA's own 44.4 MB `AMBIENCE` stream — is what turns that deferred path into work.
      noLayers: (bed): void => {
        this.absence.unknownName(bed);
      },
      // Monotonic on purpose: a wall clock that steps backwards over a swap deadline would fire a burst of
      // exchanges, which is audible where a slightly-late swap is not.
      nowMs: (): number => performance.now(),
      random: random ?? ((): number => Math.random()),
      setGain: (voice, gain, seconds): void => {
        this.pool?.setGain(voice, gain, seconds);
      },
      startLoop: async (name, startFraction, level): Promise<AmbienceLoop | null> => {
        const voice = await this.play(name, null, { gainScale: level, startFraction });
        // The row's own gain goes back to the bed, which multiplies its envelope by it every tick. Without
        // that the first `setGain` would overwrite the table's layer balance with a bare envelope.

        return voice === null ? null : { gain: this.table.find(name)?.gain ?? 1, voice };
      },
    };
  }

  /**
   * The decoded buffer for one sound, fetched once and kept until the 64 MB ceiling wants the room.
   *
   * The cache holds what is PLAYED — float buffers — rather than the PCM behind them, because the
   * conversion would otherwise run on every play and a 64-voice world would pay it 64 times a second.
   */
  private async buffer(soundIndex: number, sampleRate: number): Promise<AudioBufferLike | null> {
    const kept = this.buffers.get(soundIndex);
    if (kept) {
      return kept;
    }
    // Two plays of the same sound before the first fetch returns each pay for a range request. It is one
    // wasted request on a cold sound and never more, so an in-flight map is not worth the state — recorded
    // because a reader looking for it should find this line rather than assume it was missed.

    const context = this.host.audioContext;
    const samples = await this.source?.read(soundIndex);
    if (!context || !samples || samples.length === 0) {
      if (this.source === null) {
        this.absence.sourceAbsent();
      } else {
        this.absence.missingSound(soundIndex);
      }

      return null;
    }
    const floats = new Float32Array(samples.length);
    for (let at = 0; at < samples.length; at += 1) {
      floats[at] = (samples[at] ?? 0) / INT16_SCALE;
    }
    const buffer = context.createBuffer(1, floats.length, Math.max(sampleRate, MIN_BUFFER_RATE));
    buffer.copyToChannel(floats, 0);
    this.buffers.set(soundIndex, buffer);

    return buffer;
  }

  /**
   * The buffer for a sound if it is already decoded, and a fetch started if it is not.
   *
   * **The audio tick may not await.** A looping voice is wanted ten times a second and the first answer for
   * a cold sound is `null`; the tick after the fetch lands starts it. `pending` is what stops those ten
   * calls a second from each paying for a range request — the one place in this file where an in-flight
   * guard earns its state, because unlike a one-shot the ask repeats until it is answered.
   *
   * **A read that FAILED is not tried again**, which `pending` alone does not give: it clears the moment the
   * promise settles, so a 404 on the package — a pak served without its game dir, a mod that ships a short
   * one — would be re-asked ten times a second for the life of the page, and against a host that ignores
   * `Range:` each of those pulls the whole 304.9 MB package. The absence report already names such a sound
   * once; this makes the request match. The cost is that a sound lost to one bad moment stays lost until
   * the page is reloaded, which is the cheaper of the two failures by a wide margin.
   */
  private warm(soundIndex: number): null | WarmSound {
    const kept = this.buffers.get(soundIndex);
    const sound = this.index?.sounds[soundIndex];
    if (!sound) {
      return null;
    }
    // The same arithmetic `play` uses: a buffer below Web Audio's floor is made at 3 000 Hz and played
    // slower, and a caller that builds its own pitch has to fold that in.
    const pitchScale = sound.sampleRate / Math.max(sound.sampleRate, MIN_BUFFER_RATE);
    if (kept) {
      return { buffer: kept, pitchScale };
    }
    if (this.pending.has(soundIndex) || this.unreadable.has(soundIndex)) {
      return null;
    }
    this.pending.add(soundIndex);
    void this.buffer(soundIndex, sound.sampleRate)
      .then((buffer) => {
        if (buffer === null) {
          this.unreadable.add(soundIndex);
        }
      })
      .finally(() => this.pending.delete(soundIndex));

    return null;
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

/**
 * The lowest rate a `createBuffer` will take.
 *
 * Web Audio's nominal range starts at 3 000 Hz, and **the stock game has a sound below it** — exactly one,
 * authored at 2 021 Hz ([the census](../../../../docs/benchmarks/opensa-engine/2026-09-09-phone-audio-census.json)).
 * A buffer made at its own rate would throw. So every buffer is made at `max(rate, 3000)` and played back at
 * `rate / bufferRate`, which is 1 for every normal sound and 0.674 for that one — the same pitch and the
 * same duration, by arithmetic rather than by resampling.
 */
const MIN_BUFFER_RATE = 3_000;

/** Signed 16-bit full scale — what a sample is divided by to become a float in -1..1. */
const INT16_SCALE = 32_768;

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
