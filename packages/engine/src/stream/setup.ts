import type { OspakManifest } from '@opensa/engine-formats';

import { validateOspakManifest } from '@opensa/engine-formats';

/**
 * Streaming-mode bootstrap (plan 074/05): manifest → worker (pak lives worker-side) → texture arrays
 * (eagerly for a pre-`textures` pak; PER RING otherwise, driven by the streamer) → a ready StreamingDriver.
 */
import type { Engine } from '../engine';
import type { PakWorkerRequest, PakWorkerResponse } from './pak-worker';

import { StreamingDriver, type StreamingRadii } from './streaming';

export interface StreamSetup {
  center: [number, number, number];
  driver: StreamingDriver;
  radius: number;
  /** Baked water mesh pointer (074/06 row 12 v2) — a loose binary next to the manifest. */
  water?: OspakManifest['water'];
}

export async function setupStreaming(
  engine: Engine,
  baseUrl = '/pak',
  radii: StreamingRadii = {},
): Promise<StreamSetup> {
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  if (!manifestResponse.ok) {
    throw new Error(`no pak at ${baseUrl}/manifest.json — run opensa-pack and copy its output there`);
  }
  const manifest = (await manifestResponse.json()) as OspakManifest;
  validateOspakManifest(manifest);
  // UV-scroll animations (B7·c / plan 074/18): global by dict name, advanced engine-side; kind-4 draws slot in.
  engine.setUvAnimations(manifest.uvAnimations ?? []);

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

  // Texture arrays up-front — ONLY for a pak that does not say which cell needs which array (003 phase 4).
  // When every cell entry carries `textures`, the streaming driver loads an array with the first cell that
  // draws it and releases it with the last: the district's whole texture set (~1.7 GB on a full map) never
  // has to be resident, and boot stops paying for the far side of the world.
  const lazyTextures = Object.values(manifest.cells).every((entry) => entry.textures !== undefined);
  const textureEntries = lazyTextures ? [] : Object.entries(manifest.textures);
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
      worker.postMessage({
        ...(entry.enc !== undefined ? { enc: entry.enc } : {}),
        key,
        length: entry.length,
        offset: entry.offset,
        type: 'fetch',
      } satisfies PakWorkerRequest);
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
    ...(manifest.water !== undefined ? { water: manifest.water } : {}),
    driver: new StreamingDriver(engine, manifest, worker, radii),
    radius: Math.max((maxX - minX) / 2, (maxZ - minZ) / 2, 400),
  };
}
