/**
 * A Web Audio context under the test's control (203/3).
 *
 * Test infrastructure, not product code — the same shape `packages/engine/src/test/` takes for the fake
 * `GPUDevice`, and excluded from coverage for the same reason. It exists because everything this package
 * does is *what did you build, and what did you set on it*: a real context answers that only in a browser,
 * and only by ear.
 *
 * It drives the REAL lifecycle — suspended to running to closed, with `statechange` firing — and records
 * every node it made, so a test can ask what a voice was connected to and what its gain ended up at.
 */
import type {
  AudioBufferLike,
  AudioBufferSourceLike,
  AudioContextLike,
  AudioNodeLike,
  GainLike,
  StereoPannerLike,
} from '../audio-host.interface';

/** A buffer that keeps what was copied into it, so a test can check WHICH samples were played. */
export class FakeAudioBuffer implements AudioBufferLike {
  readonly channels: Float32Array[];

  get duration(): number {
    return this.length / this.sampleRate;
  }

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    this.channels[channelNumber]?.set(source.subarray(0, this.length));
  }
}

/** What every fake node shares: where it was connected, and whether it was let go. */
export class FakeNode implements AudioNodeLike {
  readonly connectedTo: AudioNodeLike[] = [];
  disconnected = false;

  connect(destination: AudioNodeLike): unknown {
    this.connectedTo.push(destination);

    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

/** A source that records its whole life: started, stopped, and what it was told to loop. */
export class FakeBufferSource extends FakeNode implements AudioBufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopEnd = 0;
  loopStart = 0;
  onended: ((event: Event) => void) | null = null;
  readonly playbackRate = { value: 1 };
  startedAt: null | number = null;
  startOffset = 0;
  stoppedAt: null | number = null;

  /** Fire what a real source fires when it runs out — the only way a one-shot frees its slot. */
  finish(): void {
    this.onended?.(new Event('ended'));
  }

  start(when = 0, offset = 0): void {
    this.startedAt = when;
    this.startOffset = offset;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

export class FakeGain extends FakeNode implements GainLike {
  readonly gain = { value: 1 };
}

export class FakeStereoPanner extends FakeNode implements StereoPannerLike {
  readonly pan = { value: 0 };
}

/** The context itself. `refuseResume` is how a test plays the browser turning a gesture down. */
export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  readonly destination: AudioNodeLike = { connect: () => undefined, disconnect: () => undefined };
  readonly gains: FakeGain[] = [];
  readonly panners: FakeStereoPanner[] = [];
  refuseResume = false;
  sampleRate = 48_000;
  readonly sources: FakeBufferSource[] = [];
  state: 'closed' | 'interrupted' | 'running' | 'suspended' = 'suspended';
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.add(listener);
  }

  close(): Promise<void> {
    this.moveTo('closed');

    return Promise.resolve();
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): AudioBufferSourceLike {
    const source = new FakeBufferSource();
    this.sources.push(source);

    return source;
  }

  createGain(): GainLike {
    const gain = new FakeGain();
    this.gains.push(gain);

    return gain;
  }

  createStereoPanner(): StereoPannerLike {
    const panner = new FakeStereoPanner();
    this.panners.push(panner);

    return panner;
  }

  removeEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  resume(): Promise<void> {
    if (this.refuseResume) {
      return Promise.reject(new Error('play() failed because the user did not interact with the document first'));
    }
    this.moveTo('running');

    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.moveTo('suspended');

    return Promise.resolve();
  }

  private moveTo(state: 'closed' | 'interrupted' | 'running' | 'suspended'): void {
    this.state = state;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
