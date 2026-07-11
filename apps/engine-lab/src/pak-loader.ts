/**
 * M0 pak loader (plan 074/04): fetches `/pak/manifest.json` + `/pak/world.ospak` (vite serves the converter
 * output from `apps/engine-lab/public/pak/`) and feeds the engine. LAB SHORTCUT: the whole pak is fetched once
 * and sliced — real range-reads in a worker are plan 05's work, not the P0 gate's.
 */
import type { Engine } from '@opensa/engine';
import type { OspakManifest } from '@opensa/engine-formats';

import { validateOspakManifest } from '@opensa/engine-formats';

export interface LoadedDistrict {
  cellCount: number;
  /** Camera focus: the centroid of the loaded cells' engine-space origins. */
  center: [number, number, number];
  drawsRecorded: number;
  radius: number;
}

export async function loadPak(engine: Engine, baseUrl = '/pak'): Promise<LoadedDistrict> {
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  if (!manifestResponse.ok) {
    throw new Error(`no pak at ${baseUrl}/manifest.json — run opensa-pack and copy its output there`);
  }
  const manifest = (await manifestResponse.json()) as OspakManifest;
  validateOspakManifest(manifest);
  const pak = new Uint8Array(await (await fetch(`${baseUrl}/world.ospak`)).arrayBuffer());

  for (const [key, entry] of Object.entries(manifest.textures)) {
    const ref = Number(key.replace('array-', ''));
    engine.textures.load(ref, pak.subarray(entry.offset, entry.offset + entry.length));
  }

  let drawsRecorded = 0;
  let cellCount = 0;
  const centroid = [0, 0, 0];
  let radius = 0;
  for (const [key, entry] of Object.entries(manifest.cells)) {
    const handle = engine.cells.load(key, pak.subarray(entry.offset, entry.offset + entry.length));
    drawsRecorded += handle.draws;
    cellCount += 1;
    centroid[0] += handle.bounds[0];
    centroid[1] += handle.bounds[1];
    centroid[2] += handle.bounds[2];
    radius = Math.max(radius, handle.bounds[3]);
  }
  if (cellCount === 0) {
    throw new Error('pak contains no cells');
  }

  return {
    cellCount,
    center: [centroid[0] / cellCount, centroid[1] / cellCount, centroid[2] / cellCount],
    drawsRecorded,
    radius,
  };
}
