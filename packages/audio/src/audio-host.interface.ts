/**
 * The types the audio host is described by — the surface a consumer sees, and the slice of Web Audio this
 * package actually depends on (203/3-01).
 */

/**
 * A tap on the signal, for reading what actually came out.
 *
 * **The only way to measure the OUTPUT peak** (204/5-01). `DynamicsCompressorNode.reduction` says how hard
 * the limiter is working, which is a number about the input; the row 1/02 owes is about the samples that
 * reached the speakers, and the arithmetic there — 64 voices summing to about -4.8 dBFS — is a prediction
 * nobody has checked against a device.
 *
 * `fftSize` is declared because the buffer length follows it, and a smaller window is a cheaper copy: the
 * peak does not care how many bins a transform would have, only how many samples are read per tick.
 */
export interface AnalyserLike extends AudioNodeLike {
  fftSize: number;
  readonly frequencyBinCount: number;
  getFloatTimeDomainData(array: Float32Array): void;
}

/**
 * What a surface may honestly say about sound.
 *
 * **Four states and no more**, because an indicator that cannot be read at a glance is worse than none. The
 * chain's rule is *no gate screen*: a console with `waiting` still works, it simply has nothing to say yet.
 */
export type AudioAvailability =
  /** Disposed. The context is gone and nothing will play again on this host. */
  | 'closed'
  /** Sound is on. */
  | 'running'
  /** It ran and stopped — the tab went to the background, or something called `suspend`. */
  | 'suspended'
  /** Web Audio is not in this environment at all — SSR, a locked-down browser, a bare test runner. Silence. */
  | 'unsupported'
  /** The context exists and is asleep. **A touch anywhere wakes it**, and the chrome should say so. */
  | 'waiting';

/** One channel of samples, as the context holds them. */
export interface AudioBufferLike {
  copyToChannel(source: Float32Array, channelNumber: number): void;
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
}

/** A playing sample. Single-use by the API's own rule: a stopped source is never started again. */
export interface AudioBufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  loopEnd: number;
  loopStart: number;
  /** Typed to the DOM's own shape rather than `() => void`, so a real `AudioBufferSourceNode` satisfies it. */
  onended: ((event: Event) => void) | null;
  readonly playbackRate: AudioParamLike;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

/**
 * The slice of `AudioContext` this package uses, and nothing wider.
 *
 * A structural type rather than the DOM's own is what lets the tests drive a real lifecycle — suspended to
 * running to closed, with `statechange` firing — on an object that is fully under their control. The
 * browser's `AudioContext` satisfies it as it stands.
 */
export interface AudioContextLike {
  addEventListener(type: 'statechange', listener: () => void): void;
  close(): Promise<void>;
  createAnalyser(): AnalyserLike;
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceLike;
  createDynamicsCompressor(): DynamicsCompressorLike;
  createGain(): GainLike;
  createStereoPanner(): StereoPannerLike;
  readonly currentTime: number;
  /** Where a voice's chain ends. */
  readonly destination: AudioNodeLike;
  removeEventListener(type: 'statechange', listener: () => void): void;
  resume(): Promise<void>;
  readonly sampleRate: number;
  /**
   * **`interrupted` is not a typo and not ours** — it is a real `AudioContextState` on Apple's platforms,
   * entered when a phone call or Siri takes the audio hardware away, and the conformance test is what found
   * it missing here. A host that did not know the state would have read an interrupted context as a
   * suspended one by luck rather than by rule.
   */
  readonly state: 'closed' | 'interrupted' | 'running' | 'suspended';
  suspend(): Promise<void>;
}

export interface AudioHostOptions {
  /**
   * How the context is made. Absent, the browser's own is used and an environment without one is
   * {@link AudioAvailability} `unsupported` rather than a throw.
   */
  readonly createContext?: () => AudioContextLike;
  /** Where a refusal or an absent Web Audio is reported. Absent, `console.warn`. */
  readonly log?: (message: string) => void;
}

/** Everything a surface needs to draw its indicator, and everything the report carries. */
export interface AudioHostState {
  readonly availability: AudioAvailability;
  /** How many times a `resume()` was asked for — by a gesture or by a caller. */
  readonly resumeAttempts: number;
  /**
   * How many of those the browser REFUSED. Non-zero with `waiting` means the gesture was not trusted, which
   * is a different bug from *nobody has touched the page yet* and reads identically in the chrome.
   */
  readonly resumesRefused: number;
  /** The context's rate once there is one — the number every decode has to match. */
  readonly sampleRate: number;
}

/** Anything a voice can connect to. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

/**
 * The slice of `AudioParam` this package uses.
 *
 * **The ramp is here because a gain that JUMPS is a click.** Stopping a voice by cutting its gain to zero
 * mid-waveform puts a step in the signal, and a step is a broadband transient — audible, and the first thing
 * an operator would report when the pool starts stealing. Every scheduling method here exists to avoid one.
 */
export interface AudioParamLike {
  /** Drop anything already scheduled — a voice stolen twice must not ramp twice. */
  cancelScheduledValues(startTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
  /** A ramp needs a starting point on the timeline, which is what this pins. */
  setValueAtTime(value: number, startTime: number): unknown;
  value: number;
}

/**
 * The limiter on the master (204/1-02).
 *
 * **Used as a LIMITER rather than as a musical compressor**: a hard knee, the highest ratio the API allows,
 * and a fast attack. Its job is that a busy world plus an alert cannot produce a sample above full scale —
 * clipping is the most recognisable *not-AAA* artefact there is, and nothing else in the chain prevents it.
 *
 * `reduction` is read-only and free, and it is worth reporting: it says how hard the mix is pushing, which
 * is a number about the CONTENT rather than about the limiter.
 */
export interface DynamicsCompressorLike extends AudioNodeLike {
  readonly attack: AudioParamLike;
  readonly knee: AudioParamLike;
  readonly ratio: AudioParamLike;
  /** How many dB the limiter is currently taking off. Zero means it is not working. */
  readonly reduction: number;
  readonly release: AudioParamLike;
  readonly threshold: AudioParamLike;
}

/** A volume control. */
export interface GainLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

/** What a first touch can be wired to — `window`, the console's root element, the game's canvas. */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Left/right placement, -1..1 — the only direction two ears can hear, and the cheap node that gives it. */
export interface StereoPannerLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}
