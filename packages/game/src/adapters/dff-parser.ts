import type { PreparedAtomic, RWClump } from '@opensa/renderware';

/**
 * Main-thread client of the streaming parse worker (plan 060 Phase 5). Requests are keyed by id so
 * several cells can be in flight at once; the worker itself serializes the parses (they used to
 * serialize on the main thread — now they serialize off it).
 */

/** One model's raw bytes going TO the worker. */
export interface ModelBuffer {
  buffer: ArrayBuffer;
  name: string;
}

/** One model's parse result coming FROM the worker (empty clump when unparseable, like asset-cache). */
export interface ParsedModel {
  clump: RWClump;
  name: string;
  prepared: PreparedAtomic[];
}

export interface ParseRequest {
  id: number;
  models: ModelBuffer[];
}

export interface ParseResponse {
  id: number;
  models: ParsedModel[];
}

/** The Worker surface the client needs — injectable in tests. */
export interface ParseWorkerLike {
  onmessage: ((event: MessageEvent<ParseResponse>) => void) | null;
  postMessage(message: ParseRequest, options: { transfer: Transferable[] }): void;
}

export class DffParser {
  private nextId = 1;
  private readonly pending = new Map<number, (models: ParsedModel[]) => void>();
  private readonly worker: ParseWorkerLike;

  constructor(worker: ParseWorkerLike) {
    this.worker = worker;
    this.worker.onmessage = (event): void => {
      const { id, models } = event.data;
      const resolve = this.pending.get(id);
      this.pending.delete(id);
      resolve?.(models);
    };
  }

  /** Parse + prepare a batch of models off-thread. Buffers are TRANSFERRED (callers pass fresh copies). */
  parse(models: ModelBuffer[]): Promise<ParsedModel[]> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, models }, { transfer: models.map(({ buffer }) => buffer) });
    });
  }
}

/** The real worker-backed parser, or null where Workers don't exist (node tests, SSR). */
export function createDffParser(): DffParser | null {
  if (typeof Worker === 'undefined') {
    return null;
  }
  try {
    return new DffParser(new Worker(new URL('./dff-parse.worker.ts', import.meta.url), { type: 'module' }));
  } catch {
    return null; // bundler/environment without module-worker support — sync fallback path
  }
}
