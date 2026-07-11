/**
 * Per-pass GPU timestamps (plan 074/01 — instrumentation is core, not afterthought). Double-buffered readback:
 * never blocks the frame; the HUD shows the last resolved value. Degrades to `available = false` when the
 * adapter lacks `timestamp-query` (HUD then shows CPU timings only).
 */
export class GpuTimers {
  readonly available: boolean;
  /** Last resolved pass duration, milliseconds. */
  lastPassMs = 0;

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
    this.querySet = device.createQuerySet({ count: 2, label: 'pass', type: 'timestamp' });
    this.resolveBuffer = device.createBuffer({
      label: 'ts-resolve',
      size: 16,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.readBuffer = device.createBuffer({
      label: 'ts-read',
      size: 16,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** Attach to a render pass descriptor (no-op object when unavailable). */
  passTimestampWrites(): { timestampWrites?: GPURenderPassTimestampWrites } {
    if (!this.querySet) {
      return {};
    }

    return {
      timestampWrites: { beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1, querySet: this.querySet },
    };
  }

  /** After submit: map (async) and update `lastPassMs`. Fire-and-forget. */
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
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolveBuffer, 0);
    encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, 16);
  }
}
