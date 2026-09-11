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
  AnalyserLike,
  AudioBufferLike,
  AudioBufferSourceLike,
  AudioContextLike,
  DynamicsCompressorLike,
  GainLike,
  StereoPannerLike,
} from './audio-host.interface';
import type { AudioListener, Falloff, Vec3 } from './spatial';

import { audibleGain, DEFAULT_FALLOFF, panFor } from './spatial';

/**
 * Which mixer bus a voice belongs to, and it is also who OWNS the event (204's decision 3.1).
 *
 * - `world` — the city: engines, sirens, the ambience bed. Ours, derived from the pak and from positions.
 * - `map` — what the console SEES on the board: an incident appears, a unit arrives, a unit goes quiet.
 * - `cad` — what only PCAD can know: the panic press, an ALPR hit, the link state.
 *
 * **Three buses exist so that the stealing rule can stay what decision 4.2 made it.** *The quietest voice at
 * the listener is stolen* is the right rule among the WORLD's own sounds, which is what it was written about;
 * applying it across a panel alert and sixty-four car engines is not a harsher version of that rule, it is a
 * different question being asked of it.
 */
export type AudioBus = 'cad' | 'map' | 'world';

/** A playing sound, and the only thing a caller can do to it. */
export interface Voice {
  readonly id: number;
  /** Whether it is still playing — false once it ended, was stopped, or was stolen. */
  readonly live: boolean;
  stop(): void;
}

/** What a capture states about the voice pool — the fields 3/03 and 4/03 file. */
export interface VoicePoolReport {
  /** Each bus's own level, 0..1. */
  readonly busGain: Readonly<Record<AudioBus, number>>;
  /** How many voices the pool may hold at once. */
  readonly ceiling: number;
  /** Whether an alert is currently holding the world down. */
  readonly ducked: boolean;
  /** Buses a floored voice is holding open above the level the operator set. */
  readonly flooring: readonly AudioBus[];
  /** The ceiling, and how hard the mix is pushing against it. */
  readonly limiter: { readonly reduction: number; readonly thresholdDb: number };
  /** Playing right now. */
  readonly live: number;
  /** Playing right now, per bus — what says whether a reserve is doing anything. */
  readonly liveByBus: Readonly<Record<AudioBus, number>>;
  /** The master volume every voice passes through, 0..1. Zero is mute, and a muted world still counts. */
  readonly masterGain: number;
  /** The most that were ever live at once — the number that says whether the ceiling is near. */
  readonly peak: number;
  /**
   * The most that were ever live at once on each bus.
   *
   * `peak` alone cannot say whether a reserve was ever needed: sixty-four voices at once is an ordinary
   * city, and the question 1/01's reserves are judged on is how many of them were ALERTS.
   */
  readonly peakByBus: Readonly<Record<AudioBus, number>>;
  /**
   * The loudest SAMPLE that reached the speakers, 0..1, since the pool started.
   *
   * **Measured rather than predicted** (204/5-01). 1/02 chose the limiter's -6 dBFS threshold on arithmetic
   * — 64 uncorrelated voices sum as about 8x, which lands near -4.8 dBFS after 20:1 — and that is a
   * prediction about a signal nobody had played. This is the number that confirms or refutes it, and the
   * limiter's own `reduction` cannot: reduction is about what went IN.
   *
   * It only moves while {@link sampleOutput} is called, which the console does on its audio clock.
   */
  readonly peakSample: number;
  /** Sounds turned away because every live voice was already louder. */
  readonly refused: number;
  /**
   * The same, per bus.
   *
   * **`refusedByBus.cad` is a BUDGET and its value is zero** (204): an alert that was not played is the one
   * failure this whole chain exists to prevent, and a total that mixes it with a refused car engine cannot
   * say whether it happened.
   */
  readonly refusedByBus: Readonly<Record<AudioBus, number>>;
  /** Sounds started, ever. */
  readonly started: number;
  /** Voices stopped early to make room. A rising count is a world asking for more than 64 things. */
  readonly steals: number;
}

/** What a caller asks the pool to play. */
export interface VoiceRequest {
  readonly buffer: AudioBufferLike;
  /** Which bus it plays on. Absent, `world` — where the city is, and where most voices live. */
  readonly bus?: AudioBus;
  /** Distance model. Absent, {@link DEFAULT_FALLOFF} — a fitted bridge, see `docs/hacks/`. */
  readonly falloff?: Falloff;
  /**
   * Whether this sound is heard even when its bus is muted.
   *
   * **For the two events this chain exists for** — the panic button and the lost link — and nothing else. A
   * floored voice holds its whole bus open at {@link ALERT_FLOOR} for as long as it plays, which is why it
   * is a property of the SOUND rather than a mode of the mixer: a routine chime beside a panic is quiet
   * because it is routine, not because the mixer was in the wrong state.
   */
  readonly floored?: boolean;
  /** Authored gain, 0..1, before distance. */
  readonly gain?: number;
  readonly loop?: boolean;
  /** Loop start in SECONDS. The index carries samples; the caller divides by the rate it also has. */
  readonly loopStartSeconds?: number;
  /** Playback rate, 1 being the authored pitch. */
  readonly pitch?: number;
  /** World position, or `null` for a sound with no place in the world (an alert in the chrome). */
  readonly position?: null | Vec3;
  /**
   * Where in the buffer to begin, in seconds.
   *
   * **This is what makes a twin loop work**: two voices of the SAME loop started at the same place are one
   * voice, and swapping between them does nothing. SA starts its pair at random percentages of the sound
   * for exactly this reason (`SOUND_START_PERCENTAGE`, `docs/gta-sa-original/audio-ambience.md`).
   */
  readonly startOffsetSeconds?: number;
}

/** The listener every voice is heard from: the camera (203's decision 2.3). */
const ORIGIN_LISTENER: AudioListener = { forward: [0, 1, 0], position: [0, 0, 0], right: [1, 0, 0] };

/** The concurrent-voice budget named before the work (203). */
export const MAX_VOICES = 64;

/**
 * Slots the `cad` bus can always have, whatever the world is doing (204's budget).
 *
 * **This is what makes *an alert is never refused* true rather than likely.** A bus below its reserve may
 * take a slot from a bus above its own; the world's reserve is zero, so sixty-four engines are all fair game
 * for the first four panel alerts. Four rather than one because a panic, a link drop and a call arriving
 * inside the same second is an ordinary bad minute on a busy board.
 */
export const CAD_RESERVE = 4;

/**
 * The same for `map`.
 *
 * **An ASSUMPTION, and it goes beyond the budget the plan named** — 204 states `cad`'s four and is silent on
 * this one. Two, because the map's own events are the board's lifecycle and losing *a unit arrived* is a
 * smaller failure than losing a panic but is still a lost event; and because a reserve mechanism that only
 * one bus uses is a special case pretending to be a rule. What would settle it is a capture where
 * `refusedByBus.map` is non-zero on a real shift.
 */
export const MAP_RESERVE = 2;

/**
 * Where the limiter starts working, in dBFS.
 *
 * **The arithmetic, and its honest limit.** Sixty-four uncorrelated voices sum as roughly `sqrt(64)` = 8x,
 * which is +18 dBFS; at 24 dB over a -6 threshold and a 20:1 ratio that lands at about **-4.8 dBFS**, well
 * under the ceiling. Sixty-four voices IN PHASE at full scale would be +36 dBFS and would still come out
 * over — but that is not a signal, it is an arithmetic worst case, and pretending otherwise would mean
 * squashing every real mix to protect against one that cannot occur. **204/5-01 measures the real peak on
 * the device**, which is what decides this number rather than this comment.
 */
export const LIMITER_THRESHOLD_DB = -6;

/**
 * How many samples one peak read copies.
 *
 * 2048 is Web Audio's own default window and about 43 ms at 48 kHz. Larger would see more of the signal per
 * tick and cost a bigger copy; the peak is a level rather than a waveform, so more samples buy very little.
 */
export const PEAK_WINDOW = 2048;

/** The highest ratio Web Audio allows. A limiter wants a wall, not a slope. */
export const LIMITER_RATIO = 20;

/** Fast enough to catch a transient, slow enough not to distort a bass note. */
const LIMITER_ATTACK_SECONDS = 0.003;

/** Long enough that the ceiling does not pump on every siren cycle. */
const LIMITER_RELEASE_SECONDS = 0.25;

/**
 * How far the world is pulled down while an alert is playing — a linear gain, about **-12 dB**.
 *
 * **Ducking is what makes an alert INTELLIGIBLE**, and it is the difference between an alert that is louder
 * than the city and one that is heard instead of it. Twelve decibels is where broadcast and two-way radio
 * put it: enough that speech and a tone read cleanly over a bed, little enough that the bed is still there
 * and the operator is not startled by a silence.
 *
 * **It is derived from the state of the `cad` bus rather than called for.** A duck a caller has to remember
 * is a duck somebody eventually forgets, and the alert it was forgotten on is the one that mattered.
 */
export const DUCK_DEPTH = 0.25;

/**
 * The lowest a bus goes while a FLOORED voice is playing on it, whatever the operator set.
 *
 * **A floor, not an exemption** (204's decision 3.4). A dispatcher who mutes the panel gets silence for the
 * routine chimes and something quiet for the two events this whole chain exists to deliver — the panic
 * button and the lost link. An alert that ignored a mute outright would be the other failure: an operator
 * turns sound off for a reason, sometimes because somebody is asleep in the room.
 *
 * **And it is stated in the interface rather than sprung on anybody**: the control says which events stay
 * audible, so a muted console is a promise rather than a surprise.
 */
export const ALERT_FLOOR = 0.25;

/** Down quickly — the alert has already started, and a slow duck is a first syllable lost under traffic. */
const DUCK_ATTACK_SECONDS = 0.08;

/** Up slowly, so the city returns rather than reappearing. */
const DUCK_RELEASE_SECONDS = 0.4;

/** Which buses an alert pulls down. Not `cad` itself: an alert that quietened itself would be quite a bug. */
const DUCKED: readonly AudioBus[] = ['map', 'world'];

/** The world takes what is left: it is the loudest, the most numerous, and the most replaceable. */
const RESERVE: Readonly<Record<AudioBus, number>> = { cad: CAD_RESERVE, map: MAP_RESERVE, world: 0 };

/** Every bus, in one place, so a report and a loop cannot disagree about how many there are. */
const BUSES: readonly AudioBus[] = ['cad', 'map', 'world'];

/**
 * How long a voice takes to get out of the way, in seconds.
 *
 * **A gain that jumps to zero is a click** — a step in the waveform is a broadband transient, and it is
 * exactly what an operator would report the first time the pool steals. Eight milliseconds is under a frame
 * at 60 Hz and far under anything an ear hears as a fade, so a stolen voice leaves without being noticed
 * either way.
 */
const FADE_SECONDS = 0.008;

/** The bookkeeping behind one {@link Voice}. */
interface LiveVoice {
  bus: AudioBus;
  falloff: Falloff;
  floored: boolean;
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
  /** The output tap, after the limiter — see {@link sampleOutput}. */
  private readonly analyser: AnalyserLike;
  /** One gain a bus, between every voice on it and the master. */
  private readonly buses: Readonly<Record<AudioBus, GainLike>>;
  /** What the OPERATOR set each bus to, before any duck. The node carries `level x duck`. */
  private readonly busLevel: Record<AudioBus, number> = { cad: 1, map: 1, world: 1 };
  private readonly ceiling: number;
  private readonly context: AudioContextLike;
  private ducked = false;
  /** The ceiling, between the master and the speakers. */
  private readonly limiter: DynamicsCompressorLike;
  private listener: AudioListener = ORIGIN_LISTENER;
  /** Every voice passes through this one node, which is what makes volume and mute a single value. */
  private readonly master: GainLike;
  private nextId = 1;
  private peak = 0;
  private readonly peakPerBus: Record<AudioBus, number> = { cad: 0, map: 0, world: 0 };
  private peakSample = 0;
  private refused = 0;
  private readonly refusedPerBus: Record<AudioBus, number> = { cad: 0, map: 0, world: 0 };
  /** Reused across reads so a 10 Hz tap allocates nothing. */
  private readonly samples: Float32Array;
  private started = 0;
  private steals = 0;
  private readonly voices = new Map<number, LiveVoice>();

  constructor(context: AudioContextLike, options: { maxVoices?: number } = {}) {
    this.context = context;
    this.ceiling = options.maxVoices ?? MAX_VOICES;
    this.master = context.createGain();
    // AFTER the master, not before: the volume an operator sets should make the limiter work LESS, and a
    // limiter upstream of a gain is a ceiling the gain can lift the signal straight back through.
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER_THRESHOLD_DB;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = LIMITER_RATIO;
    this.limiter.attack.value = LIMITER_ATTACK_SECONDS;
    this.limiter.release.value = LIMITER_RELEASE_SECONDS;
    this.master.connect(this.limiter);
    this.limiter.connect(context.destination);
    // The tap is AFTER the limiter, because the question is what actually left the graph. It is a second
    // destination for the same signal rather than a link in the chain, so nothing downstream changes.
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = PEAK_WINDOW;
    this.limiter.connect(this.analyser);
    this.samples = new Float32Array(PEAK_WINDOW);
    // Built here rather than on demand so a bus always exists to be ducked or levelled, even before anything
    // has ever played on it — 1/03 and 1/04 both reach for one that may still be empty.
    const buses = {} as Record<AudioBus, GainLike>;
    for (const bus of BUSES) {
      const gain = context.createGain();
      gain.connect(this.master);
      buses[bus] = gain;
    }
    this.buses = buses;
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
    const bus = request.bus ?? 'world';
    const heard = audibleGain(this.listener, position, gain, falloff);

    if (this.voices.size >= this.ceiling && !this.makeRoom(bus, heard)) {
      this.refused += 1;
      this.refusedPerBus[bus] += 1;

      return null;
    }

    const id = this.nextId;
    this.nextId += 1;
    const live = this.build(id, request, heard, position, gain, falloff, bus);
    this.voices.set(id, live);
    this.started += 1;
    this.peak = Math.max(this.peak, this.voices.size);
    this.peakPerBus[bus] = Math.max(this.peakPerBus[bus], this.countOn(bus));
    this.applyDuck();

    return live.handle;
  }

  report(): VoicePoolReport {
    return {
      // The LEVEL the operator asked for, not the node's momentary value — a duck is the mixer's business
      // and a control that read back its own ducking would jump about while an alert played.
      busGain: { ...this.busLevel },
      ceiling: this.ceiling,
      ducked: this.ducked,
      flooring: BUSES.filter((bus) => this.flooring(bus)),
      limiter: { reduction: this.limiter.reduction, thresholdDb: LIMITER_THRESHOLD_DB },
      live: this.voices.size,
      liveByBus: { cad: this.countOn('cad'), map: this.countOn('map'), world: this.countOn('world') },
      masterGain: this.master.gain.value,
      peak: this.peak,
      peakByBus: { ...this.peakPerBus },
      peakSample: this.peakSample,
      refused: this.refused,
      refusedByBus: { ...this.refusedPerBus },
      started: this.started,
      steals: this.steals,
    };
  }

  /** Move the ear. Every live positional voice is re-gained and re-panned from where it stands. */
  /**
   * Read the output and remember the loudest sample seen.
   *
   * **Called by whoever owns a clock, not by the pool** — a pool that scheduled its own timer would be a
   * second clock in a package that has exactly one, and the console already ticks ten times a second. A
   * window of {@link PEAK_WINDOW} samples at 10 Hz sees about 4 % of the signal at 48 kHz, which is the
   * honest limit of this number: it finds the level a mix sits at, and it can miss a single transient.
   */
  sampleOutput(): void {
    this.analyser.getFloatTimeDomainData(this.samples);
    for (const sample of this.samples) {
      const level = Math.abs(sample);
      if (level > this.peakSample) {
        this.peakSample = level;
      }
    }
  }

  /**
   * One bus's own level, 0..1 — the city quieter than the alerts, which is the whole reason for three.
   *
   * Set outright rather than ramped: a level is a preference an operator sets, not a move made during a
   * sound. 1/03's ducking ramps this same node and does its own scheduling.
   */
  setBusGain(bus: AudioBus, value: number): void {
    this.busLevel[bus] = Math.min(1, Math.max(0, value));
    const node = this.buses[bus].gain;
    // Cancel first: a duck ramp may be in flight, and an operator moving a level outranks it.
    node.cancelScheduledValues(this.context.currentTime);
    node.value = this.nodeGain(bus);
  }

  /**
   * Change a live voice's authored gain, ramped rather than stepped.
   *
   * The twin-loop bed is the caller this exists for: its whole mechanism is moving volume between two
   * voices of one sound, and a step there is the click every other path in this file avoids.
   *
   * @param seconds how long the ramp takes. Zero sets it outright, which is what a placement does.
   */
  setGain(voice: Voice, gain: number, seconds = 0): void {
    const live = this.voices.get(voice.id);
    if (!live) {
      return;
    }
    live.gain = gain;
    const target = audibleGain(this.listener, live.position, live.gain, live.falloff);
    if (seconds <= 0) {
      live.gainNode.gain.value = target;

      return;
    }
    const now = this.context.currentTime;
    const param = live.gainNode.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + seconds);
  }

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

  /**
   * Change a live voice's playback rate.
   *
   * **This is what pitching an engine IS**: one loop played faster, not a different sample chosen per speed
   * ([the engine model](./vehicle-engine.ts)). Set outright rather than ramped — the caller moves it a
   * little every tick, and a ramp under a ramp is a value nobody can predict.
   */
  setPitch(voice: Voice, pitch: number): void {
    const live = this.voices.get(voice.id);
    if (live) {
      live.source.playbackRate.value = pitch;
    }
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

  /**
   * Hold the world down while any alert is live, and let it up when none is.
   *
   * Called from the two places a bus's population can change — a voice starting and a voice leaving — rather
   * than by whoever plays the alert. **A duck somebody has to ask for is one they eventually forget**, and
   * the alert it is forgotten on is the one that mattered.
   */
  private applyDuck(): void {
    const wanted = this.countOn('cad') > 0;
    const now = this.context.currentTime;
    if (wanted !== this.ducked) {
      this.ducked = wanted;
      const seconds = wanted ? DUCK_ATTACK_SECONDS : DUCK_RELEASE_SECONDS;
      for (const bus of DUCKED) {
        const node = this.buses[bus].gain;
        node.cancelScheduledValues(now);
        node.setValueAtTime(node.value, now);
        node.linearRampToValueAtTime(this.nodeGain(bus), now + seconds);
      }
    }
    // The floor is stepped rather than ramped, and deliberately: it opens on the first sample of an alert
    // that a muted console would otherwise have swallowed, and a ramp there is a late alert.
    for (const bus of BUSES) {
      if (!DUCKED.includes(bus) || !this.ducked) {
        this.buses[bus].gain.value = this.nodeGain(bus);
      }
    }
  }

  private build(
    id: number,
    request: VoiceRequest,
    heard: number,
    position: null | Vec3,
    gain: number,
    falloff: Falloff,
    bus: AudioBus,
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
    panner.connect(this.buses[bus]);

    const handle: MutableVoice = {
      id,
      live: true,
      stop: (): void => {
        this.release(id, 'stopped');
      },
    };

    const live: LiveVoice = {
      bus,
      falloff,
      floored: request.floored === true,
      gain,
      gainNode,
      handle,
      id,
      panner,
      position,
      source,
    };
    // A one-shot frees its own slot. Nothing polls, and a loop simply never fires this.
    source.onended = (): void => {
      this.release(id, 'ended');
    };
    this.place(live);
    source.start(0, request.startOffsetSeconds ?? 0);

    return live;
  }

  /** How many voices one bus is holding. */
  private countOn(bus: AudioBus): number {
    let count = 0;
    for (const voice of this.voices.values()) {
      if (voice.bus === bus) {
        count += 1;
      }
    }

    return count;
  }

  /** Let one voice's three nodes go. */
  private disconnect(voice: LiveVoice): void {
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gainNode.disconnect();
    voice.panner.disconnect();
  }

  /** What a bus is multiplied by right now: the duck, or nothing if it is not one of the ducked. */
  private duckFactor(bus: AudioBus): number {
    return this.ducked && DUCKED.includes(bus) ? DUCK_DEPTH : 1;
  }

  /** Whether a floored voice is currently playing on a bus. */
  private flooring(bus: AudioBus): boolean {
    for (const voice of this.voices.values()) {
      if (voice.bus === bus && voice.floored) {
        return true;
      }
    }

    return false;
  }

  /**
   * Make room for a sound worth `heard` on `bus`, or answer false. **Two ranks, and the order is the point.**
   *
   * 1. **Within the bus**, by the quietest at the listener — [decision 4.2](../../../docs/plans/203-audio/concept.md)
   *    unchanged, because that is the question it was written about: which of the world's own sounds gives way.
   *    A bus tidies its own house before it knocks on anybody else's.
   * 2. **Across buses, only for a bus below its RESERVE**, and only from one above its own. This is the whole
   *    of *an alert is never refused*: the world reserves nothing, so sixty-four engines are all fair game
   *    for the first {@link CAD_RESERVE} panel alerts, however quiet those alerts are.
   *
   * A bus at or above its reserve that cannot find a victim of its own is simply refused, which is what keeps
   * step 2 a floor rather than a licence.
   */
  private makeRoom(bus: AudioBus, heard: number): boolean {
    if (this.stealFrom((voice) => voice.bus === bus, heard)) {
      return true;
    }
    if (this.countOn(bus) >= RESERVE[bus]) {
      return false;
    }

    // Under its reserve: it may take from a bus that is over its own, and the newcomer's loudness stops
    // mattering — a panic at 0.01 still outranks an engine, because the reserve is about WHAT it is rather
    // than how loud it is.
    return this.stealFrom((voice) => this.countOn(voice.bus) > RESERVE[voice.bus], Number.POSITIVE_INFINITY);
  }

  /**
   * What a bus's node should be set to right now: the operator's level, ducked, and never below the floor
   * while a floored voice is on it.
   *
   * `max` rather than a replacement, so the floor can only ever RAISE a muted bus and never pull down one
   * the operator wanted louder.
   */
  private nodeGain(bus: AudioBus): number {
    const wanted = this.busLevel[bus] * this.duckFactor(bus);

    return this.flooring(bus) ? Math.max(wanted, ALERT_FLOOR) : wanted;
  }

  /** Set a voice's gain and pan from where it and the listener now are. */
  private place(voice: LiveVoice): void {
    voice.gainNode.gain.value = audibleGain(this.listener, voice.position, voice.gain, voice.falloff);
    voice.panner.pan.value = voice.position === null ? 0 : panFor(this.listener, voice.position);
  }

  /**
   * Stop a voice and let its nodes go. Safe to call twice — `onended` fires after a `stop` as well.
   *
   * **A voice that is cut leaves through a ramp, not a step.** Zeroing a gain mid-waveform is a click, and
   * it is what an operator would report the first time the pool steals. So the SLOT is freed immediately —
   * the budget is about slots — while the nodes live eight more milliseconds and disconnect when the source
   * actually ends. A handful of fading voices can therefore outlive the count for an instant, which is the
   * price of not clicking.
   */
  private release(id: number, reason: 'ended' | 'stolen' | 'stopped'): void {
    const voice = this.voices.get(id);
    if (!voice) {
      return;
    }
    this.voices.delete(id);
    voice.handle.live = false;
    // Every path out of a voice comes through here — ended, stopped, stolen — so the duck cannot be left
    // holding the world down for an alert that is no longer playing.
    this.applyDuck();
    if (reason === 'ended') {
      voice.source.onended = null;
      this.disconnect(voice);

      return;
    }
    const now = this.context.currentTime;
    const gain = voice.gainNode.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
    voice.source.onended = (): void => {
      this.disconnect(voice);
    };
    voice.source.stop(now + FADE_SECONDS);
  }

  /**
   * Retire the quietest voice matching `from`, if it is quieter than `heard`.
   *
   * `heard` of `Infinity` means *take the quietest whatever it costs*, which is what a bus under its reserve
   * is entitled to and nothing else is.
   */
  private stealFrom(from: (voice: LiveVoice) => boolean, heard: number): boolean {
    let quietest: LiveVoice | null = null;
    let quietestLevel = Number.POSITIVE_INFINITY;
    for (const voice of this.voices.values()) {
      if (!from(voice)) {
        continue;
      }
      const level = audibleGain(this.listener, voice.position, voice.gain, voice.falloff);
      if (level < quietestLevel) {
        quietest = voice;
        quietestLevel = level;
      }
    }
    if (quietest === null || quietestLevel >= heard) {
      return false;
    }
    this.release(quietest.id, 'stolen');
    this.steals += 1;

    return true;
  }
}
