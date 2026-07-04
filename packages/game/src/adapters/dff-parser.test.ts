import { describe, expect, it } from 'vitest';

import type { ParsedModel, ParseRequest, ParseResponse, ParseWorkerLike } from './dff-parser';

import { DffParser } from './dff-parser';

/** A worker double that records requests and lets the test answer them out of order. */
function fakeWorker(): ParseWorkerLike & {
  requests: ParseRequest[];
  respond(id: number, models: ParsedModel[]): void;
  transfers: Transferable[][];
} {
  const worker = {
    onmessage: null as ((event: MessageEvent<ParseResponse>) => void) | null,
    postMessage(message: ParseRequest, options: { transfer: Transferable[] }): void {
      worker.requests.push(message);
      worker.transfers.push(options.transfer);
    },
    requests: [] as ParseRequest[],
    respond(id: number, models: ParsedModel[]): void {
      worker.onmessage?.({ data: { id, models } } as MessageEvent<ParseResponse>);
    },
    transfers: [] as Transferable[][],
  };

  return worker;
}

function model(name: string): ParsedModel {
  return { clump: { atomics: [], frames: [], geometries: [] }, name, prepared: [] };
}

describe('DffParser', () => {
  describe('negative cases', () => {
    it('ignores a response for an unknown request id', () => {
      const worker = fakeWorker();
      new DffParser(worker);
      expect(() => worker.respond(99, [model('stray')])).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('transfers the model buffers with the request', async () => {
      const worker = fakeWorker();
      const parser = new DffParser(worker);
      const buffer = new ArrayBuffer(4);
      const pending = parser.parse([{ buffer, name: 'lod_a' }]);
      expect(worker.requests[0].id).toBe(1);
      expect(worker.transfers[0]).toEqual([buffer]);
      worker.respond(1, [model('lod_a')]);
      await expect(pending).resolves.toEqual([model('lod_a')]);
    });

    it('resolves concurrent requests by id, even out of order', async () => {
      const worker = fakeWorker();
      const parser = new DffParser(worker);
      const first = parser.parse([{ buffer: new ArrayBuffer(1), name: 'a' }]);
      const second = parser.parse([{ buffer: new ArrayBuffer(1), name: 'b' }]);
      worker.respond(2, [model('b')]);
      worker.respond(1, [model('a')]);
      await expect(first).resolves.toEqual([model('a')]);
      await expect(second).resolves.toEqual([model('b')]);
    });
  });
});
