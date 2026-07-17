import type { VehicleModelData } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import type { VehicleBuildRequest, VehicleBuildResponse, VehicleBuildWorkerLike } from './vehicle-model-builder';

import { VehicleModelBuilder } from './vehicle-model-builder';

/** A worker double that records requests and lets the test answer them out of order. */
function fakeWorker(): VehicleBuildWorkerLike & {
  requests: VehicleBuildRequest[];
  respond(response: VehicleBuildResponse): void;
  transfers: Transferable[][];
} {
  const worker = {
    onmessage: null as ((event: MessageEvent<VehicleBuildResponse>) => void) | null,
    postMessage(message: VehicleBuildRequest, options: { transfer: Transferable[] }): void {
      worker.requests.push(message);
      worker.transfers.push(options.transfer);
    },
    requests: [] as VehicleBuildRequest[],
    respond(response: VehicleBuildResponse): void {
      worker.onmessage?.({ data: response } as MessageEvent<VehicleBuildResponse>);
    },
    transfers: [] as Transferable[][],
  };

  return worker;
}

function model(): VehicleModelData {
  return {
    colors: new Uint8Array(0),
    doors: [],
    dummies: [],
    indices: new Uint16Array(0),
    meta: new Uint8Array(0),
    normals: new Float32Array(0),
    parts: [],
    positions: new Float32Array(0),
    reflect: new Uint8Array(0),
    submeshes: [],
    texture: { height: 1, layers: 1, names: [], rgba: new Uint8Array(4), width: 1 },
    uvs: new Float32Array(0),
    wheels: [],
  };
}

describe('VehicleModelBuilder', () => {
  describe('negative cases', () => {
    it('ignores a response for an unknown request id', () => {
      const worker = fakeWorker();
      new VehicleModelBuilder(worker);
      expect(() => worker.respond({ id: 99, model: model() })).not.toThrow();
    });

    it('rejects when the worker reports a build error', async () => {
      const worker = fakeWorker();
      const builder = new VehicleModelBuilder(worker);
      const pending = builder.build(new ArrayBuffer(4), []);
      worker.respond({ error: 'bad dff', id: 1 });
      await expect(pending).rejects.toThrow('bad dff');
    });
  });

  describe('positive cases', () => {
    it('transfers the dff and txd buffers with the request', async () => {
      const worker = fakeWorker();
      const builder = new VehicleModelBuilder(worker);
      const dff = new ArrayBuffer(4);
      const txd = new ArrayBuffer(8);
      const pending = builder.build(dff, [txd], [1, 1]);
      expect(worker.requests[0].id).toBe(1);
      expect(worker.requests[0].wheelScale).toEqual([1, 1]);
      expect(worker.transfers[0]).toEqual([dff, txd]);
      const built = model();
      worker.respond({ id: 1, model: built });
      await expect(pending).resolves.toBe(built);
    });

    it('resolves concurrent builds by id, even out of order', async () => {
      const worker = fakeWorker();
      const builder = new VehicleModelBuilder(worker);
      const first = builder.build(new ArrayBuffer(1), []);
      const second = builder.build(new ArrayBuffer(1), []);
      const modelA = model();
      const modelB = model();
      worker.respond({ id: 2, model: modelB });
      worker.respond({ id: 1, model: modelA });
      await expect(first).resolves.toBe(modelA);
      await expect(second).resolves.toBe(modelB);
    });
  });
});
