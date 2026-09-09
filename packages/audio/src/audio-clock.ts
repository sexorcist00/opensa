/**
 * The clock audio runs on, which is NOT the frame's (203/3-03).
 *
 * **The console draws on demand.** At rest the render gate takes drawn frames to zero — that is what bought
 * the battery figure 201/4-01 reports — so a world whose sound was updated per frame would fall silent the
 * moment nobody touched the map. A city that goes quiet when you stop panning is not a city, so audio ticks
 * on its own timer (203's decision 3.2) and the render gate never sees it.
 *
 * **It measures itself, because the budget is 2 ms and nobody has ever seen the number.** Every tick is
 * timed, and the report states the mean and the worst alongside the RATE — which is what makes it comparable
 * with a per-frame budget at all: a 10 Hz clock costing 1 ms a tick is 10 ms a second, and at 45 fps that is
 * 0.45 ms a frame. The conversion is arithmetic on numbers this reports rather than a claim it makes.
 *
 * **A hidden tab is throttled and that is fine.** Browsers clamp a background timer to about 1 Hz; the sound
 * keeps playing (the graph runs in the audio thread) and only the position updates go coarse. `visibility`
 * already records when a page was hidden (201/9 §6), so a capture taken across that is not silent about it.
 */

/** What the clock needs of a host: a timer and a stopwatch. Injected so a test drives time itself. */
export interface AudioClockHost {
  cancel(handle: number): void;
  now(): number;
  schedule(callback: () => void, intervalMs: number): number;
}

/** What a capture states about the audio clock — the fields the 2 ms budget is judged on. */
export interface AudioClockReport {
  /** Longest single tick. The one that would blow a frame budget if audio shared the frame. */
  readonly maxMs: number;
  /** Mean tick cost. */
  readonly meanMs: number;
  /** Ticks a second, as configured. Multiply by `meanMs` for the cost of a second of audio upkeep. */
  readonly rateHz: number;
  /** Ticks since the clock started. */
  readonly ticks: number;
}

/**
 * Ten a second.
 *
 * A position update's whole job is to keep distance gain and stereo pan honest, and both change slowly: a car
 * at 30 m/s crosses a tenth of a second in 3 m, which at the falloff's own scale is a gain change no ear
 * resolves as a step. It is a knob rather than a constant — chain 5's engine pitch may want more — and the
 * report states what it ran at, so a row can never be read against the wrong rate.
 */
export const DEFAULT_TICK_HZ = 10;

/** Runs one callback at a fixed rate and times it. */
export class AudioClock {
  get running(): boolean {
    return this.handle !== null;
  }
  private handle: null | number = null;
  private readonly host: AudioClockHost;
  private last = 0;
  private maxMs = 0;
  private readonly rateHz: number;
  private ticks = 0;

  private totalMs = 0;

  constructor(host: AudioClockHost, options: { rateHz?: number } = {}) {
    this.host = host;
    this.rateHz = options.rateHz ?? DEFAULT_TICK_HZ;
  }

  report(): AudioClockReport {
    return {
      maxMs: this.maxMs,
      meanMs: this.ticks === 0 ? 0 : this.totalMs / this.ticks,
      rateHz: this.rateHz,
      ticks: this.ticks,
    };
  }

  /**
   * Start ticking. Starting an already-running clock is a no-op rather than a second timer — two clocks on
   * one pool is a bug whose only symptom is a doubled CPU line nobody can attribute.
   *
   * @param tick receives the seconds since the previous tick, which is the REAL gap and not the nominal
   *   one: a throttled background tab hands it 1 s where the clock asked for 0.1.
   */
  start(tick: (dtSeconds: number) => void): void {
    if (this.handle !== null) {
      return;
    }
    this.last = this.host.now();
    this.handle = this.host.schedule(() => {
      const began = this.host.now();
      const dtSeconds = (began - this.last) / 1000;
      this.last = began;
      tick(dtSeconds);
      const cost = this.host.now() - began;
      this.ticks += 1;
      this.totalMs += cost;
      this.maxMs = Math.max(this.maxMs, cost);
    }, 1000 / this.rateHz);
  }

  /** Stop ticking. Keeps the measurements — a capture is read after the clock is stopped. */
  stop(): void {
    if (this.handle === null) {
      return;
    }
    this.host.cancel(this.handle);
    this.handle = null;
  }
}

/** The browser's own timer and clock — what a surface passes unless it is a test. */
export function browserClockHost(): AudioClockHost {
  return {
    cancel: (handle): void => {
      clearInterval(handle);
    },
    now: (): number => performance.now(),
    schedule: (callback, intervalMs): number => setInterval(callback, intervalMs) as unknown as number,
  };
}
