/**
 * Per-pass GPU timestamps (plan 074/01 — instrumentation is core, not afterthought). Double-buffered readback:
 * never blocks the frame; the HUD shows the last resolved value. Degrades to `available = false` when the
 * adapter lacks `timestamp-query` (HUD then shows CPU timings only).
 *
 * Two measured spans (074/09): the WORLD pass (slots 0/1) and the POST CHAIN (slots 2/3 — bloom passes +
 * the composite; the ≤3 ms post budget is measured, not guessed). The first post-chain pass writes the
 * begin slot, the composite writes the end slot.
 */
export class GpuTimers {
  readonly available: boolean;
  /** Last resolved world-pass duration, milliseconds. */
  lastPassMs = 0;
  /** Last resolved post-chain duration (bloom + composite), milliseconds. */
  lastPostMs = 0;

  private readonly device: GPUDevice;
  private mapInFlight = false;
  private readonly querySet: GPUQuerySet | null = null;
  private readonly readBuffer: GPUBuffer | null = null;
  private readonly resolveBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice, available: boolean) {
    this.device = device;
    this.available = available;
    if (!available) {
      return;
    }
    this.querySet = device.createQuerySet({ count: 4, label: 'pass', type: 'timestamp' });
    this.resolveBuffer = device.createBuffer({
      label: 'ts-resolve',
      size: 32,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      label: 'ts-read',
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** Attach to the WORLD render pass descriptor (no-op object when unavailable). */
  passTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return {
      timestampWrites: { beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1, querySet: this.querySet },
    };
  }

  /** Attach to the FIRST pass of the post chain (begin slot only). */
  postBeginTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return { timestampWrites: { beginningOfPassWriteIndex: 2, querySet: this.querySet } };
  }

  /** Attach to the LAST pass of the post chain (end slot only; the composite). */
  postEndTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return { timestampWrites: { endOfPassWriteIndex: 3, querySet: this.querySet } };
  }

  /** Attach to a SINGLE-pass post chain (bloom off — the composite is the whole chain). */
  postOnlyTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return {
      timestampWrites: { beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3, querySet: this.querySet },
    };
  }

  /** After submit: map (async) and update the last durations. Fire-and-forget. */
  read(): void {
    const readBuffer = this.readBuffer;
    if (!readBuffer || this.mapInFlight) {
      return;
    }
    this.mapInFlight = true;
    readBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigUint64Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();
        this.lastPassMs = Number(values[1] - values[0]) / 1e6;
        // Post = END of the post chain − END of the world pass, NOT the chain's own begin slot: on
        // Apple/Metal a pass's begin timestamp fires when its VERTEX stage starts, and TBDR overlaps
        // that with the previous pass's fragments — a begin→end span swallows most of the frame
        // (field-measured: `?bloom=0` "post" ≈ the whole world pass). The post fragments serialize
        // behind the scene resolve, so end−end IS the chain's added tail.
        this.lastPostMs = Math.max(0, Number(values[3] - values[1]) / 1e6);
        this.mapInFlight = false;
      })
      .catch(() => {
        this.mapInFlight = false;
      });
  }

  /** Resolve + kick an async readback (skipped while a previous map is in flight). Call after pass end. */
  resolve(encoder: GPUCommandEncoder): void {
    if (!this.querySet || !this.resolveBuffer || !this.readBuffer || this.mapInFlight) {
      return;
    }
    encoder.resolveQuerySet(this.querySet, 0, 4, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 32);
  }
}
