import type { VehicleModelData } from '@opensa/renderware';

/**
 * Main-thread client of the vehicle-model build worker (074/21 field fix, the dff-parser pattern):
 * `parseDff + VehicleTextures (TXD parse + DXT decode) + buildVehicleModel` is a single indivisible
 * ~100–200 ms unit per car TYPE — run on the main thread it froze the frame every time a new type first
 * streamed in near the player ("chassis_vlo → HD" field report). The worker owns the whole build; the
 * main thread only uploads the returned GPU-ready arrays.
 */

export interface VehicleBuildRequest {
  dff: ArrayBuffer;
  id: number;
  txds: ArrayBuffer[];
  wheelScale?: readonly [number, number];
}

export interface VehicleBuildResponse {
  /** Set when the build threw (unparseable DFF) — the client rejects, same as the sync path throwing. */
  error?: string;
  id: number;
  model?: VehicleModelData;
}

/** The Worker surface the client needs — injectable in tests. */
export interface VehicleBuildWorkerLike {
  onmessage: ((event: MessageEvent<VehicleBuildResponse>) => void) | null;
  postMessage(message: VehicleBuildRequest, options: { transfer: Transferable[] }): void;
}

export class VehicleModelBuilder {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (model: VehicleModelData) => void }
  >();
  private readonly worker: VehicleBuildWorkerLike;

  constructor(worker: VehicleBuildWorkerLike) {
    this.worker = worker;
    this.worker.onmessage = (event): void => {
      const { error, id, model } = event.data;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      if (!entry) {
        return;
      }
      if (model) {
        entry.resolve(model);
      } else {
        entry.reject(new Error(error ?? 'vehicle model build failed'));
      }
    };
  }

  /** Build one car type off-thread. Buffers are TRANSFERRED — callers pass fresh copies (the VFS keeps
   *  the originals; a detached source buffer was the dff-parser lesson). */
  build(dff: ArrayBuffer, txds: ArrayBuffer[], wheelScale?: readonly [number, number]): Promise<VehicleModelData> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.worker.postMessage(
        { dff, id, txds, ...(wheelScale !== undefined ? { wheelScale } : {}) },
        { transfer: [dff, ...txds] },
      );
    });
  }
}

/** The real worker-backed builder, or null where Workers don't exist (node tests, SSR) → sync fallback. */
export function createVehicleModelBuilder(): null | VehicleModelBuilder {
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    return new VehicleModelBuilder(
      new Worker(new URL('./vehicle-model.worker.ts', import.meta.url), { type: 'module' }),
    );
  } catch {
    return null; // bundler/environment without module-worker support — sync fallback path
  }
}
