/**
 * The optimized/unoptimized contract, end to end on REAL assets (plan opensa-pack/003 phase 5b).
 *
 * A converted build is 100 % optimized until a user drops something into `modloader/`, and then the two
 * paths must coexist: the mod wins, it loads UNOPTIMIZED, a half-modded asset resolves to the optimized side
 * with the ignored file named, and a `txdp` child still inherits from its parent. That is the whole
 * "optimized vs unoptimized is a property of the ASSET" claim, and until it is exercised it is a diagram.
 *
 * It lives in opensa-pack because it needs the WRITER as well as the runtime, and the nx boundary forbids
 * `type:engine` depending on `type:tool` — correctly: the runtime must never reach for the converter.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { withModloader } from '@opensa/modloader';
import { getTxdChain, setTxdParents } from '@opensa/renderware/archive/asset-cache';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { buildVehicleOsm } from './vehicle-osm';

const FIXTURES = join(process.cwd(), 'tests', 'original');

function fileOf(relative: string): ArrayBuffer {
  const data = readFileSync(join(FIXTURES, relative));

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

/** Path-keyed, with the basename fallback the real VFS has (an img member resolves by bare name). */
function fsFrom(files: Map<string, ArrayBuffer>): AssetFileSystem {
  const byBase = new Map<string, ArrayBuffer>();
  for (const [path, bytes] of files) {
    const base = path.split('/').pop() ?? path;
    if (!byBase.has(base)) {
      byBase.set(base, bytes);
    }
  }
  const find = (name: string): ArrayBuffer | null =>
    files.get(name.toLowerCase()) ?? byBase.get(name.toLowerCase()) ?? null;

  return {
    get: find,
    getText: (name): null | string => {
      const bytes = find(name);

      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    has: (name) => find(name) !== null,
    get names(): string[] {
      return [...files.keys()];
    },
  };
}

/** The game's own data, without any car assets — every case below adds those itself. */
function gameData(): Map<string, ArrayBuffer> {
  return new Map<string, ArrayBuffer>([
    ['data/carcols.dat', fileOf('data/carcols.dat')],
    ['data/handling.cfg', fileOf('data/handling.cfg')],
    ['data/vehicles.ide', fileOf('data/vehicles.ide')],
    ['models/generic/vehicle.txd', fileOf('models/generic/vehicle.txd')],
  ]);
}

/** Built once — a real car through the writer costs seconds under coverage. */
let converted: null | ReturnType<typeof buildVehicleOsm> = null;
function admiralOsm(): ReturnType<typeof buildVehicleOsm> {
  const source = fsFrom(
    new Map<string, ArrayBuffer>([
      ...gameData(),
      ['admiral.dff', fileOf('vehicles/admiral.dff')],
      ['admiral.txd', fileOf('vehicles/admiral.txd')],
    ]),
  );

  return (converted ??= buildVehicleOsm(source, 'admiral', { wheelScale: [0.7, 0.7] }));
}

/**
 * A CONVERTED build: the `.osm` in place of the car's `.dff`/`.txd`. `keepTxd` reproduces what a real
 * convert leaves behind — a dictionary held back because some unconverted model still needs it.
 */
function convertedBuild(keepTxd = false): Map<string, ArrayBuffer> {
  const files = gameData();
  files.set('admiral.osm', admiralOsm().bytes.slice().buffer);
  if (keepTxd) {
    files.set('admiral.txd', fileOf('vehicles/admiral.txd'));
  }

  return files;
}

async function loadAdmiral(files: Map<string, ArrayBuffer>): Promise<{
  vehicle: Awaited<ReturnType<GtaSaWorldAdapter['loadVehicleData']>>;
  warnings: string[];
}> {
  const warnings: string[] = [];
  const vehicle = await new GtaSaWorldAdapter({
    cellSize: 250,
    fs: withModloader(fsFrom(files)),
    onAssetWarning: (message): void => {
      warnings.push(message);
    },
  }).loadVehicleData('admiral');

  return { vehicle, warnings };
}

beforeEach(() => {
  setTxdParents(new Map<string, string>());
});

describe('a converted build with a modloader overlay', () => {
  describe('negative cases', () => {
    it('does NOT call a KEPT stock dictionary a mod (the field check, 2026-07-19)', async () => {
      // A convert deletes a `.txd` only when no unconverted model still needs it, so stock dictionaries
      // legitimately survive. Asking the merged VFS "is there a txd?" called every one of those a mod and
      // warned about cars nobody had touched — the rule has to ask the OVERLAY.
      const { vehicle, warnings } = await loadAdmiral(convertedBuild(true));

      expect(warnings).toEqual([]);
      expect(vehicle.model.textures[0].kind).toBe('ostex');
    });

    it('still refuses to honour a retexture-only mod, and names the file it ignored', async () => {
      const files = convertedBuild();
      files.set('modloader/retexture/admiral.txd', fileOf('vehicles/admiral.txd'));
      const { vehicle, warnings } = await loadAdmiral(files);

      // `.osm` indexes its baked atlas by LAYER, not by texture name, so a loose TXD has nothing to attach
      // to. The optimized side wins; the user is told which file did nothing.
      expect(vehicle.model.textures[0].kind).toBe('ostex');
      expect(warnings).toEqual(["ignoring modded admiral.txd — 'admiral' is an optimized model"]);
    });
  });

  describe('positive cases', () => {
    it('lets a modloader car beat the converted one, GEOMETRY and all', async () => {
      // The mod is a different car under the admiral's name — so "the mod won" is provable by the mesh,
      // not merely by which texture path ran.
      const files = convertedBuild();
      files.set('modloader/swap/admiral.dff', fileOf('vehicles/cheetah.dff'));
      files.set('modloader/swap/admiral.txd', fileOf('vehicles/cheetah.txd'));
      const { vehicle, warnings } = await loadAdmiral(files);

      expect(vehicle.model.textures[0].kind).toBe('rgba'); // parsed at runtime, not our baked atlas
      expect(vehicle.model.vertexCount).not.toBe(admiralOsm().fixture.vertexCount);
      expect(warnings).toEqual([]); // a COMPLETE mod is not a mixing-rule case
    });

    it('walks a modded dictionary into its txdp PARENT for the textures it does not ship', () => {
      // Constraint 4: the unoptimized path's texture resolution. A child TXD inherits what it lacks, and
      // dropping the walk silently strips textures from any modded dictionary with a parent.
      const files = convertedBuild();
      files.set('modloader/swap/admiral.dff', fileOf('vehicles/cheetah.dff'));
      files.set('modloader/swap/admiral.txd', fileOf('vehicles/cheetah.txd'));
      const fs = withModloader(fsFrom(files));
      setTxdParents(new Map([['admiral', 'vehicle']]));

      const chain = getTxdChain(fs, 'admiral');
      const own = new Set(parseTxd(chain[0]).textures.map((texture) => texture.name.toLowerCase()));
      const inherited = parseTxd(chain[1]).textures.map((texture) => texture.name.toLowerCase());

      expect(chain).toHaveLength(2); // the mod's own dictionary FIRST, then the shared parent
      expect(inherited.some((name) => !own.has(name))).toBe(true); // the parent really adds something
    });
  });
});
