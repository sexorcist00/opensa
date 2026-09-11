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
  AnalyserLike,
  AudioBufferLike,
  AudioBufferSourceLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  DynamicsCompressorLike,
  GainLike,
  StereoPannerLike,
} from '../audio-host.interface';

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

/**
 * The output tap. `samples` is what the next read returns, so a test plays a signal by setting it.
 *
 * Defaults to silence rather than to noise: a peak that appeared without anything having been played would
 * be a number nobody could trace.
 */
export class FakeAnalyser extends FakeNode implements AnalyserLike {
  fftSize = 2048;
  samples: Float32Array = new Float32Array(0);
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }

  getFloatTimeDomainData(array: Float32Array): void {
    // Fill the WHOLE array, as a real analyser does. A partial write would leave the caller's reused buffer
    // carrying the previous read's samples, so a quiet read would report the loud one before it.
    array.fill(0);
    array.set(this.samples.subarray(0, array.length));
  }
}

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

/** A param that records what was scheduled on it, so a test can assert a RAMP rather than a jump. */
export class FakeParam implements AudioParamLike {
  cancelledAt: null | number = null;
  readonly ramps: { time: number; value: number }[] = [];
  readonly setAt: { time: number; value: number }[] = [];
  value = 1;

  cancelScheduledValues(startTime: number): unknown {
    this.cancelledAt = startTime;

    return this;
  }

  linearRampToValueAtTime(value: number, endTime: number): unknown {
    this.ramps.push({ time: endTime, value });

    return this;
  }

  setValueAtTime(value: number, startTime: number): unknown {
    this.setAt.push({ time: startTime, value });

    return this;
  }
}

/** A source that records its whole life: started, stopped, and what it was told to loop. */
export class FakeBufferSource extends FakeNode implements AudioBufferSourceLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopEnd = 0;
  loopStart = 0;
  onended: ((event: Event) => void) | null = null;
  readonly playbackRate = new FakeParam();
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

/** The limiter. `reduction` is settable here so a test can play a mix that is pushing hard. */
export class FakeCompressor extends FakeNode implements DynamicsCompressorLike {
  readonly attack = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  reduction = 0;
  readonly release = new FakeParam();
  readonly threshold = new FakeParam();
}

export class FakeGain extends FakeNode implements GainLike {
  readonly gain = new FakeParam();
}

export class FakeStereoPanner extends FakeNode implements StereoPannerLike {
  readonly pan = new FakeParam();
}

/** The context itself. `refuseResume` is how a test plays the browser turning a gesture down. */
export class FakeAudioContext implements AudioContextLike {
  /** Every output tap ever made. The pool makes one. */
  readonly analysers: FakeAnalyser[] = [];
  /** Every buffer ever built. The tone floor builds one a name. */
  readonly buffers: FakeAudioBuffer[] = [];
  /** Every limiter ever built. The pool builds exactly one. */
  readonly compressors: FakeCompressor[] = [];
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

  createAnalyser(): AnalyserLike {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);

    return analyser;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);

    return buffer;
  }

  createBufferSource(): AudioBufferSourceLike {
    const source = new FakeBufferSource();
    this.sources.push(source);

    return source;
  }

  createDynamicsCompressor(): DynamicsCompressorLike {
    const compressor = new FakeCompressor();
    this.compressors.push(compressor);

    return compressor;
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
