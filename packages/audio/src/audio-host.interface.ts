/**
 * The types the audio host is described by — the surface a consumer sees, and the slice of Web Audio this
 * package actually depends on (203/3-01).
 */

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
  readonly currentTime: number;
  removeEventListener(type: 'statechange', listener: () => void): void;
  resume(): Promise<void>;
  readonly sampleRate: number;
  readonly state: 'closed' | 'running' | 'suspended';
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

/** What a first touch can be wired to — `window`, the console's root element, the game's canvas. */
export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}
