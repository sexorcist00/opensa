import type { OspakManifest } from '@opensa/engine-formats';

import { validateOspakManifest } from '@opensa/engine-formats';

/**
 * Streaming-mode bootstrap (plan 074/05): manifest → worker (pak lives worker-side) → texture arrays up-front
 * (district-shared; cells can't record without them) → a ready StreamingDriver.
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

import { StreamingDriver } from './streaming';

export interface StreamSetup {
  center: [number, number, number];
  driver: StreamingDriver;
  radius: number;
  /** Raw timecyc.dat from the manifest (row 14), when the converter embedded it. */
  timecyc?: string;
  timecyc24: boolean;
}

export async function setupStreaming(engine: Engine, baseUrl = '/pak'): Promise<StreamSetup> {
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  if (!manifestResponse.ok) {
    throw new Error(`no pak at ${baseUrl}/manifest.json — run opensa-pack and copy its output there`);
  }
  const manifest = (await manifestResponse.json()) as OspakManifest;
  validateOspakManifest(manifest);

  const worker = new Worker(new URL('./pak-worker.ts', import.meta.url), { type: 'module' });
  await new Promise<void>((resolve, reject) => {
    worker.addEventListener(
      'message',
      (event: MessageEvent<PakWorkerResponse>): void => {
        if (event.data.type === 'ready') {
          if (event.data.error) {
            reject(new Error(event.data.error));
          } else {
            resolve();
          }
        }
      },
      { once: true },
    );
    worker.postMessage({ type: 'init', url: `${baseUrl}/world.ospak` } satisfies PakWorkerRequest);
  });

  // Texture arrays up-front: request all, await all, upload (order-independent).
  const textureEntries = Object.entries(manifest.textures);
  await new Promise<void>((resolve) => {
    let remaining = textureEntries.length;
    if (remaining === 0) {
      resolve();

      return;
    }
    const listener = (event: MessageEvent<PakWorkerResponse>): void => {
      const message = event.data;
      if (message.type !== 'blob' || !message.key.startsWith('array-') || !message.buffer) {
        return;
      }
      engine.textures.load(Number(message.key.replace('array-', '')), new Uint8Array(message.buffer));
      remaining -= 1;
      if (remaining === 0) {
        worker.removeEventListener('message', listener);
        resolve();
      }
    };
    worker.addEventListener('message', listener);
    for (const [key, entry] of textureEntries) {
      worker.postMessage({ key, length: entry.length, offset: entry.offset, type: 'fetch' } satisfies PakWorkerRequest);
    }
  });

  // District centre/extent from the cell keys (engine coords).
  const cellSize = manifest.cellSize ?? 250;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const key of Object.keys(manifest.cells)) {
    const [cx, cy] = key.split(',').map(Number);
    const x = (cx + 0.5) * cellSize;
    const z = -(cy + 0.5) * cellSize;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  return {
    center: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
    driver: new StreamingDriver(engine, manifest, worker),
    radius: Math.max((maxX - minX) / 2, (maxZ - minZ) / 2, 400),
    ...(manifest.timecyc !== undefined ? { timecyc: manifest.timecyc } : {}),
    timecyc24: manifest.timecyc24 ?? false,
  };
}
