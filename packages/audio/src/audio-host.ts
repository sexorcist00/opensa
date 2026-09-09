/**
 * The audio context and its lifecycle (203/3-01) — whether this page may make a sound at all.
 *
 * **The autoplay gate is a design constraint here, not a detail** ([the concept](../../../docs/plans/203-audio/concept.md) §2).
 * A context built before the document has had a user gesture starts SUSPENDED, and `resume()` only takes
 * effect after a trusted one — on Android too. So the host is built at boot, asks for nothing, and waits:
 * **any first touch wakes it** (decision 3.3), with an honest indicator in the chrome until then and no gate
 * screen on either surface.
 *
 * **Absence is a state, never a throw.** No Web Audio in this environment — SSR, a locked-down browser, a
 * bare test runner — is `unsupported`, one line in the log, and a host every caller can go on using. That is
 * the same shape decision 4.3 fixes for a build with no audio, and the same class of defect that made 150
 * units invisible for three days: the silent path has to be a REPORTED path.
 *
 * **`waiting` and `suspended` are different facts and the chrome may say so.** Nothing has touched the page
 * yet, against it ran and stopped — the second is a backgrounded tab or our own `suspend`, and only the
 * first is waiting on the operator. `resumesRefused` separates them again inside `waiting`: non-zero means
 * the browser turned a gesture down, which is a bug in the wiring rather than in the operator.
 */
import type {
  AudioAvailability,
  AudioContextLike,
  AudioHostOptions,
  AudioHostState,
  GestureTarget,
} from './audio-host.interface';

/**
 * What a first touch can arrive as.
 *
 * `pointerdown` covers touch and mouse in one event; `keydown` is the keyboard half the cross-platform rule
 * asks for ([surface](../../../docs/restrictions/cross-platform-surface.md) — reachable without a pointer).
 * Both are listened to passively: this handler must never be the reason a scroll janks.
 */
const GESTURES = ['keydown', 'pointerdown'] as const;

/** Holds the one `AudioContext` a surface has, and the answer to *may we play*. */
export class AudioHost {
  /**
   * The context, once there is one — what a voice is built on.
   *
   * `null` is the whole of the unsupported case, so a caller that forgets to check gets a type error rather
   * than a stub that silently swallows every sound it is handed.
   */
  get audioContext(): AudioContextLike | null {
    return this.context;
  }

  get state(): AudioHostState {
    return this.last;
  }
  private readonly context: AudioContextLike | null;
  private detachGestures: (() => void) | null = null;
  private disposed = false;
  private everRan = false;
  private last: AudioHostState;
  private readonly listeners = new Set<(state: AudioHostState) => void>();
  private readonly log: (message: string) => void;

  private resumeAttempts = 0;

  private resumesRefused = 0;

  constructor(options: AudioHostOptions = {}) {
    this.log = options.log ?? warn;
    this.context = openContext(options.createContext, this.log);
    this.everRan = this.context?.state === 'running';
    this.context?.addEventListener('statechange', this.onStateChange);
    this.last = this.read();
  }

  /**
   * Wire the first touch. Returns the detach, and calling it twice attaches once — a surface that remounts
   * must not end up with two listeners racing the same `resume`.
   *
   * The listeners stay until sound is RUNNING rather than until the first event: a gesture the browser did
   * not trust leaves the page silent, and a host that had already unsubscribed could never be woken again.
   */
  attachGestures(target: GestureTarget): () => void {
    this.detachGestures?.();
    if (!this.context || this.disposed) {
      return noDetach;
    }
    const onGesture = (): void => {
      void this.resume();
    };
    for (const type of GESTURES) {
      target.addEventListener(type, onGesture, { passive: true });
    }
    const detach = (): void => {
      for (const type of GESTURES) {
        target.removeEventListener(type, onGesture);
      }
      if (this.detachGestures === detach) {
        this.detachGestures = null;
      }
    };
    this.detachGestures = detach;

    return detach;
  }

  /** Close the context and let go of everything. Idempotent, and a closed host stays closed. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.detachGestures?.();
    this.context?.removeEventListener('statechange', this.onStateChange);
    try {
      await this.context?.close();
    } catch {
      // A context the browser has already torn down refuses to close, and there is nothing left to do about
      // it: the host is disposed either way, and reporting it would be noise rather than news.
    }
    this.publish();
  }

  /**
   * Ask for sound. Safe to call at any time and from anywhere — the gesture handler, a settings toggle, a
   * retry — and a refusal is COUNTED rather than thrown.
   */
  async resume(): Promise<void> {
    if (!this.context || this.disposed) {
      return;
    }
    this.resumeAttempts += 1;
    try {
      await this.context.resume();
    } catch {
      this.resumesRefused += 1;
      this.log(
        `[audio] the browser refused to start sound (attempt ${this.resumeAttempts}) — waiting for a real gesture`,
      );
    }
    this.publish();
  }

  /** Watch the state. Returns the unsubscribe; a listener is called only when something actually moved. */
  subscribe(listener: (state: AudioHostState) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stop the world's sound without giving up the context — a mute that keeps the wake-up cost at zero. */
  async suspend(): Promise<void> {
    if (!this.context || this.disposed) {
      return;
    }
    try {
      await this.context.suspend();
    } catch {
      // Suspending a context the browser has already suspended is not an error worth a line.
    }
    this.publish();
  }

  private availability(): AudioAvailability {
    if (!this.context) {
      return 'unsupported';
    }
    if (this.disposed || this.context.state === 'closed') {
      return 'closed';
    }
    if (this.context.state === 'running') {
      return 'running';
    }
    // `interrupted` (Apple only) is a context the hardware was taken from mid-play — a phone call, Siri. It
    // ran and stopped, which is exactly `suspended` to a surface drawing an indicator, and the resume that
    // fixes it is the same one.
    if (this.context.state === 'interrupted') {
      return 'suspended';
    }

    return this.everRan ? 'suspended' : 'waiting';
  }

  private readonly onStateChange = (): void => {
    if (this.context?.state === 'running') {
      this.everRan = true;
      // Sound is on: the gesture listeners have done their job and every further touch would re-enter
      // `resume` for nothing.
      this.detachGestures?.();
    }
    this.publish();
  };

  private publish(): void {
    const next = this.read();
    if (same(next, this.last)) {
      return;
    }
    this.last = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  private read(): AudioHostState {
    return {
      availability: this.availability(),
      resumeAttempts: this.resumeAttempts,
      resumesRefused: this.resumesRefused,
      sampleRate: this.context?.sampleRate ?? 0,
    };
  }
}

/** The browser's own `AudioContext`, where there is one. */
function browserContext(): AudioContextLike {
  const constructor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
  if (!constructor) {
    throw new Error('this environment has no AudioContext');
  }

  return new constructor();
}

/**
 * Nothing was ever attached, so nothing has to come off — the unsupported host's detach.
 *
 * A function rather than `null`, so no caller has to branch on a host that has no context.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function -- see above: doing nothing IS the answer
function noDetach(): void {}

/**
 * The context, or `null` and one line saying why.
 *
 * A browser can also THROW here — too many contexts on the page, a permissions policy — and that is the same
 * answer as not having Web Audio at all: silence this surface can report.
 */
function openContext(
  make: (() => AudioContextLike) | undefined,
  log: (message: string) => void,
): AudioContextLike | null {
  const factory = make ?? browserContext;
  try {
    return factory();
  } catch (error) {
    log(`[audio] no audio on this surface: the context could not be created (${String(error)})`);

    return null;
  }
}

/** Whether two readings say the same thing — the guard that keeps `subscribe` from firing on every tick. */
function same(a: AudioHostState, b: AudioHostState): boolean {
  return (
    a.availability === b.availability &&
    a.resumeAttempts === b.resumeAttempts &&
    a.resumesRefused === b.resumesRefused &&
    a.sampleRate === b.sampleRate
  );
}

/**
 * Where an absent context or a refused resume is said when the caller names no log.
 *
 * **Silence that nobody can tell from a broken build is the defect decision 4.3 exists to prevent** — the
 * same class as the units that were invisible for three days with the roster still saying 150.
 */
function warn(message: string): void {
  // A deliberate field diagnostic, the same class as the stream and pak-cache warnings: a fallback nobody
  // can see is a fallback nobody fixes.
  // eslint-disable-next-line no-console -- see above
  console.warn(message);
}
