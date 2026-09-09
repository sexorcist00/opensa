/**
 * The voices, and what happens when there are more sounds than slots (203/3-02).
 *
 * A voice is three nodes — a buffer source, a gain and a stereo pan — built when a sound starts and let go
 * when it ends. **The gain it is played at IS {@link audibleGain}**, the same function the pool ranks by,
 * which is what makes the stealing rule mean anything: *the quietest voice at the listener is the one
 * stolen* (203's decision 4.2). A rule that ranked by one model while the ear heard another would steal the
 * wrong voice and nobody could tell.
 *
 * **The budget is 64 voices and it is a HARD ceiling, not a target.** Past it the pool does not queue and
 * does not drop the newest by default: it looks at what is playing, finds the least audible, and takes its
 * slot — unless the newcomer is quieter still, in which case starting it would make the mix worse and it is
 * refused. That last clause is an ASSUMPTION taken on 2026-09-09 with the operator away: the decision names
 * which voice is stolen and is silent on the newcomer. It is the consistent extension — the rule is *keep
 * the 64 loudest things* — and it is stated here so it can be challenged rather than discovered.
 *
 * **A voice never outlives its sound.** A one-shot frees its slot from `onended`; a loop holds one until it
 * is stopped or stolen. Nothing polls.
 */
import type {
  AudioBufferLike,
  AudioBufferSourceLike,
  AudioContextLike,
  GainLike,
  StereoPannerLike,
} from './audio-host.interface';
import type { AudioListener, Falloff, Vec3 } from './spatial';

import { audibleGain, DEFAULT_FALLOFF, panFor } from './spatial';

/** A playing sound, and the only thing a caller can do to it. */
export interface Voice {
  readonly id: number;
  /** Whether it is still playing — false once it ended, was stopped, or was stolen. */
  readonly live: boolean;
  stop(): void;
}

/** What a capture states about the voice pool — the fields 3/03 and 4/03 file. */
export interface VoicePoolReport {
  /** How many voices the pool may hold at once. */
  readonly ceiling: number;
  /** Playing right now. */
  readonly live: number;
  /** The master volume every voice passes through, 0..1. Zero is mute, and a muted world still counts. */
  readonly masterGain: number;
  /** The most that were ever live at once — the number that says whether the ceiling is near. */
  readonly peak: number;
  /** Sounds turned away because every live voice was already louder. */
  readonly refused: number;
  /** Sounds started, ever. */
  readonly started: number;
  /** Voices stopped early to make room. A rising count is a world asking for more than 64 things. */
  readonly steals: number;
}

/** What a caller asks the pool to play. */
export interface VoiceRequest {
  readonly buffer: AudioBufferLike;
  /** Distance model. Absent, {@link DEFAULT_FALLOFF} — a fitted bridge, see `docs/hacks/`. */
  readonly falloff?: Falloff;
  /** Authored gain, 0..1, before distance. */
  readonly gain?: number;
  readonly loop?: boolean;
  /** Loop start in SECONDS. The index carries samples; the caller divides by the rate it also has. */
  readonly loopStartSeconds?: number;
  /** Playback rate, 1 being the authored pitch. */
  readonly pitch?: number;
  /** World position, or `null` for a sound with no place in the world (an alert in the chrome). */
  readonly position?: null | Vec3;
}

/** The listener every voice is heard from: the camera (203's decision 2.3). */
const ORIGIN_LISTENER: AudioListener = { forward: [0, 1, 0], position: [0, 0, 0], right: [1, 0, 0] };

/** The concurrent-voice budget named before the work (203). */
export const MAX_VOICES = 64;

/** The bookkeeping behind one {@link Voice}. */
interface LiveVoice {
  falloff: Falloff;
  gain: number;
  gainNode: GainLike;
  handle: MutableVoice;
  id: number;
  panner: StereoPannerLike;
  position: null | Vec3;
  source: AudioBufferSourceLike;
}

/** A {@link Voice} the pool can retire: `live` is a flag it sets rather than a lookup a caller pays for. */
interface MutableVoice {
  id: number;
  live: boolean;
  stop(): void;
}

/** Holds the live voices and decides who keeps a slot. */
export class VoicePool {
  private readonly ceiling: number;
  private readonly context: AudioContextLike;
  private listener: AudioListener = ORIGIN_LISTENER;
  /** Every voice passes through this one node, which is what makes volume and mute a single value. */
  private readonly master: GainLike;
  private nextId = 1;
  private peak = 0;
  private refused = 0;
  private started = 0;
  private steals = 0;
  private readonly voices = new Map<number, LiveVoice>();

  constructor(context: AudioContextLike, options: { maxVoices?: number } = {}) {
    this.context = context;
    this.ceiling = options.maxVoices ?? MAX_VOICES;
    this.master = context.createGain();
    this.master.connect(context.destination);
  }

  /**
   * Start a sound, or `null` when the pool is full of louder ones.
   *
   * The gain is computed once, at start, from the listener the pool was last told about. Moving sources
   * follow it through {@link update}; a one-shot fired at a point never needs to.
   */
  play(request: VoiceRequest): null | Voice {
    const position = request.position ?? null;
    const gain = request.gain ?? 1;
    const falloff = request.falloff ?? DEFAULT_FALLOFF;
    const heard = audibleGain(this.listener, position, gain, falloff);

    if (this.voices.size >= this.ceiling && !this.steal(heard)) {
      this.refused += 1;

      return null;
    }

    const id = this.nextId;
    this.nextId += 1;
    const live = this.build(id, request, heard, position, gain, falloff);
    this.voices.set(id, live);
    this.started += 1;
    this.peak = Math.max(this.peak, this.voices.size);

    return live.handle;
  }

  report(): VoicePoolReport {
    return {
      ceiling: this.ceiling,
      live: this.voices.size,
      masterGain: this.master.gain.value,
      peak: this.peak,
      refused: this.refused,
      started: this.started,
      steals: this.steals,
    };
  }

  /** Move the ear. Every live positional voice is re-gained and re-panned from where it stands. */
  setListener(listener: AudioListener): void {
    this.listener = listener;
    for (const voice of this.voices.values()) {
      this.place(voice);
    }
  }

  /**
   * The master volume, 0..1. Mute is 0 and nothing else: a muted pool goes on playing and stealing, so
   * unmuting is instant and a capture still says how many voices a world asked for.
   */
  setMasterGain(value: number): void {
    this.master.gain.value = Math.min(1, Math.max(0, value));
  }

  /** Move one sound. A car is a moving source; a siren that stayed where it was fired is a bug people hear. */
  setPosition(voice: Voice, position: null | Vec3): void {
    const live = this.voices.get(voice.id);
    if (!live) {
      return;
    }
    live.position = position;
    this.place(live);
  }

  stopAll(): void {
    for (const id of [...this.voices.keys()]) {
      this.release(id, 'stopped');
    }
  }

  private build(
    id: number,
    request: VoiceRequest,
    heard: number,
    position: null | Vec3,
    gain: number,
    falloff: Falloff,
  ): LiveVoice {
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = request.buffer;
    source.playbackRate.value = request.pitch ?? 1;
    if (request.loop) {
      source.loop = true;
      source.loopStart = request.loopStartSeconds ?? 0;
      source.loopEnd = request.buffer.duration;
    }
    gainNode.gain.value = heard;
    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(this.master);

    const handle: MutableVoice = {
      id,
      live: true,
      stop: (): void => {
        this.release(id, 'stopped');
      },
    };

    const live: LiveVoice = { falloff, gain, gainNode, handle, id, panner, position, source };
    // A one-shot frees its own slot. Nothing polls, and a loop simply never fires this.
    source.onended = (): void => {
      this.release(id, 'ended');
    };
    this.place(live);
    source.start();

    return live;
  }

  /** Set a voice's gain and pan from where it and the listener now are. */
  private place(voice: LiveVoice): void {
    voice.gainNode.gain.value = audibleGain(this.listener, voice.position, voice.gain, voice.falloff);
    voice.panner.pan.value = voice.position === null ? 0 : panFor(this.listener, voice.position);
  }

  /**
   * Stop a voice and let its nodes go. Safe to call twice — `onended` fires after a `stop` as well.
   *
   * **A stolen voice stops ABRUPTLY, and that is a click somebody will hear.** The honest fix is a few
   * milliseconds of gain ramp before the stop, which needs `AudioParam`'s scheduling methods — deliberately
   * not in this package's surface yet, because 4/02's crossfade is what brings them and one ramp API is
   * better than two. Recorded rather than left to be discovered at the first steal.
   */
  private release(id: number, reason: 'ended' | 'stolen' | 'stopped'): void {
    const voice = this.voices.get(id);
    if (!voice) {
      return;
    }
    this.voices.delete(id);
    voice.handle.live = false;
    voice.source.onended = null;
    if (reason !== 'ended') {
      voice.source.stop();
    }
    voice.source.disconnect();
    voice.gainNode.disconnect();
    voice.panner.disconnect();
  }

  /**
   * Make room for a sound worth `heard`, or answer false.
   *
   * The victim is the quietest live voice AT THE LISTENER, which is the decision's own words. A newcomer
   * that is quieter than every one of them takes nobody's slot: see the module note.
   */
  private steal(heard: number): boolean {
    let quietest: LiveVoice | null = null;
    let quietestLevel = Number.POSITIVE_INFINITY;
    for (const voice of this.voices.values()) {
      const level = audibleGain(this.listener, voice.position, voice.gain, voice.falloff);
      if (level < quietestLevel) {
        quietest = voice;
        quietestLevel = level;
      }
    }
    if (quietest === null) {
      return true;
    }
    if (quietestLevel >= heard) {
      return false;
    }
    this.release(quietest.id, 'stolen');
    this.steals += 1;

    return true;
  }
}
