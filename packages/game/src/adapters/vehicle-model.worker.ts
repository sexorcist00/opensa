import { buildVehicleModel, parseDff, VehicleTextures } from '@opensa/renderware';

import type { VehicleBuildRequest, VehicleBuildResponse } from './vehicle-model-builder';

import { collectTransferables } from './transferables';

/**
 * Vehicle-model build worker (074/21 field fix, the dff-parse.worker pattern): the whole
 * parse + TXD-decode + weld unit runs off the main thread; the result's typed-array buffers transfer
 * back zero-copy. Builds serialize here instead of freezing frames — a new car type streaming in costs
 * the main thread only the GPU upload.
 */
self.onmessage = (event: MessageEvent<VehicleBuildRequest>): void => {
  const { dff, id, txds, wheelScale } = event.data;
  try {
    const model = buildVehicleModel(parseDff(dff), new VehicleTextures(txds), {
      ...(wheelScale !== undefined ? { wheelScale } : {}),
    });
    const response: VehicleBuildResponse = { id, model };
    self.postMessage(response, { transfer: collectTransferables(model) });
  } catch (error) {
    self.postMessage({ error: String(error), id } satisfies VehicleBuildResponse);
  }
};
