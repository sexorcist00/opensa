import type * as Renderware from '@opensa/renderware';

import { withModloader } from '@opensa/modloader';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { GtaSaWorldAdapter } from './gta-sa-world.adapter';

/** Read a committed fixture as a fresh ArrayBuffer. */
function buffer(path: string): ArrayBuffer {
  const data = readFileSync(path);

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Real pipeline end-to-end: keep every builder/parser real; only the map resolution is stubbed (one
// washer placement). Everything else is read from a fixture-backed AssetFileSystem passed in config.
vi.mock('@opensa/renderware', async (importActual) => {
  const actual = await importActual<typeof Renderware>();

  return {
    ...actual,
    resolveMap: (): Renderware.MapDefinitions => ({
      catalog: new Map([[1, { drawDistance: 300, flags: 0, id: 1, modelName: 'washer', txdName: 'junk' }]]),
      imgDirs: [],
      instances: [{ id: 1, interior: 0, lod: -1, modelName: 'washer', position: [10, 10, 0], rotation: [0, 0, 0, 1] }],
    }),
  };
});

/** The fixture-backed file map: bare model/txd names + loose data paths, as the build packs them. */
function baseFiles(): Map<string, ArrayBuffer | string> {
  return new Map<string, ArrayBuffer | string>([
    // Vehicle assets keyed by their BARE names only (no loose `vehicles/` folder) — exactly how the build packs
    // them and how `loadVehicle` reads them (`requireBuffer('<model>.dff'|'<txd>.txd')`).
    ['admiral.dff', buffer('tests/original/vehicles/admiral.dff')],
    ['admiral.txd', buffer('tests/original/vehicles/admiral.txd')],
    ['anim/ped.ifp', buffer('tests/original/dff/anim-clump/counxref.ifp')],
    ['bmypol1.dff', buffer('tests/original/character/bmypol1.dff')],
    ['bmypol1.txd', buffer('tests/original/character/bmypol1.txd')],
    ['data/carcols.dat', readFileSync('tests/original/data/carcols.dat', 'utf8')],
    ['data/handling.cfg', readFileSync('tests/original/data/handling.cfg', 'utf8')],
    ['data/peds.ide', readFileSync('tests/original/data/peds.ide', 'utf8')],
    ['data/timecyc.dat', readFileSync('tests/original/data/timecyc.dat', 'utf8')],
    ['data/vehicles.ide', readFileSync('tests/original/data/vehicles.ide', 'utf8')],
    ['junk.txd', buffer('tests/original/txd/junk.txd')],
    ['models/generic/vehicle.txd', buffer('tests/original/models/generic/vehicle.txd')],
    ['washer.dff', buffer('tests/original/dff/building/washer.dff')],
  ]);
}

function cfg(): ConstructorParameters<typeof GtaSaWorldAdapter>[0] {
  return { cellSize: 250, fs: fakeFs() };
}

function fakeFs(): Renderware.AssetFileSystem {
  return fsFrom(baseFiles());
}

/** Wrap a fixture file map as an AssetFileSystem (case-insensitive keys). */
function fsFrom(files: Map<string, ArrayBuffer | string>): Renderware.AssetFileSystem {
  return {
    get(name: string): ArrayBuffer | null {
      const file = files.get(name.toLowerCase());
      if (file === undefined) {
        return null;
      }

      return typeof file === 'string' ? new TextEncoder().encode(file).buffer : file;
    },
    getText(name: string): null | string {
      const file = files.get(name.toLowerCase());

      return typeof file === 'string' ? file : null;
    },
    has: (name: string): boolean => files.has(name.toLowerCase()),
    names: [...files.keys()],
  };
}

describe('GtaSaWorldAdapter integration', () => {
  describe('positive cases', () => {
    // First in the file on purpose: the renderware parse caches are module-level, and this test
    // needs the cell's model to be UNCACHED so the preparse path actually sends it to the parser.

    it('loads the timecyc as 24h weather table from the real timecyc.dat', async () => {
      const result = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      expect(result.weathers).toHaveLength(21);
      expect(result.weathers[0].name).toBe('EXTRASUNNY_LA');
      expect(result.weathers[0].hours).toHaveLength(24);
    });

    it('loads from an authored timecyc_24h.dat with NO vanilla timecyc.dat present', async () => {
      // Dropping the mandatory file proves the 24h branch is taken (it throws otherwise), and the
      // result matches the conversion of the vanilla file — the shipped 24h fixture IS that conversion.
      const files = baseFiles();
      files.set('data/timecyc_24h.dat', readFileSync('tests/original/data/timecyc_24h.dat', 'utf8'));
      const converted = await new GtaSaWorldAdapter(cfg()).loadTimecyc();
      files.delete('data/timecyc.dat');

      const authored = await new GtaSaWorldAdapter({ cellSize: 250, fs: fsFrom(files) }).loadTimecyc();

      expect(authored.weathers[0].hours).toHaveLength(24);
      expect(authored.weathers[0].hours).toEqual(converted.weathers[0].hours);
    });

    it('loads a vehicle end-to-end by its bare gta3.img name (admiral via vehicles.ide)', async () => {
      // fakeFs holds only bare keys (admiral.dff/.txd) — a pass proves the loader reads them directly,
      // with no loose `vehicles/` path. Resolved through vehicles.ide (model + txd both `admiral`).
      const vehicle = await new GtaSaWorldAdapter(cfg()).loadVehicleData('admiral');
      expect(vehicle.model.positions.length).toBeGreaterThan(0);
      expect(vehicle.colliders).not.toBeNull(); // embedded COL parsed from the same DFF
      expect(vehicle.handling).toBeDefined(); // from handling.cfg
    });

    it('loadVehicleData reads a modloader override end-to-end (overridden dff + merged handling)', async () => {
      // Drop the stock admiral.dff entirely: the load can ONLY succeed if `withModloader` serves the
      // mod's `admiral.dff` under its bare name. The mod's settings.txt bumps ADMIRAL's mass (1109 → 9999),
      // proving the merged handling.cfg reaches the loader through the same decorator.
      const moddedHandling =
        'ADMIRAL 9999.0 2550.7 1.41 0.0 0.1 -0.15 77 0.65 0.74 0.52 4 198.0 17.2 12.9 R P 5 0.558 0 30.0 ' +
        '0.917 0.783 0.0 0.195 -0.045 0.50 0.10 0.45 0.43 35000 242000 1000002 1 1 0';
      const files = baseFiles();
      files.delete('admiral.dff'); // no stock model — only the override can satisfy the load
      // The loader lowercases every VFS key, so the descriptive folder name is lowercased here too.
      const dir = 'modloader/admiral - 1976 mercedes-benz 230 - k1real24';
      files.set(`${dir}/admiral.dff`, buffer('tests/original/vehicles/admiral.dff'));
      files.set(`${dir}/admiral.settings.txt`, moddedHandling);

      const fs = withModloader(fsFrom(files));
      const vehicle = await new GtaSaWorldAdapter({ cellSize: 250, fs }).loadVehicleData('admiral');

      // built from the overridden dff (stock admiral.dff is absent)
      expect(vehicle.model.positions.length).toBeGreaterThan(0);
      expect(vehicle.colliders).not.toBeNull();
      expect(vehicle.handling.mass).toBe(9999); // merged ADMIRAL handling line, not the stock 1109
      // …and the same row's `modelFlags` 242000 names both axles: McPherson front, solid rear (081/06 §3).
      expect(vehicle.handling.axleFront).toEqual({ reverse: false, type: 'mcpherson' });
      expect(vehicle.handling.axleRear).toEqual({ reverse: false, type: 'solid' });
    });

    it('maps the WHOLE handling row, not the five columns it used to (081/02)', async () => {
      // Pinned against the stock fixture's real ADMIRAL line — the column order is verified by the DATA,
      // because the file's own legend lists a "(not used)" column the shipped rows do not carry. Every
      // value here is as authored: converting one into a force or a spring is the consuming plan's job.
      //
      // Three of these are what 081/01 blamed by name for the fleet driving alike: the authored
      // `centreOfMass` (the flip), `turnMass` (a 6.5 t truck answering the wheel faster than a supercar)
      // and `drive` — this car is FRONT-wheel drive and the engine drives all four of its wheels today.
      const { handling } = await new GtaSaWorldAdapter(cfg()).loadVehicleData('admiral');

      expect(handling).toEqual({
        abs: false,
        // The stock ADMIRAL authors no axle bits at all (`modelFlags` 0) — 26 of the 210 rows do, and this
        // is not one of them, so both ends read as the default independent build (081/06 §3).
        axleFront: { reverse: false, type: 'independent' },
        axleRear: { reverse: false, type: 'independent' },
        brakeBias: 0.52,
        brakeDecel: 8.5,
        centreOfMass: [0, 0, -0.05],
        collisionDamageMult: 0.56,
        dragMult: 2,
        drive: 'F',
        engineAccel: 22,
        engineInertia: 8,
        engineType: 'P',
        gears: 5,
        mass: 1650,
        maxVelocity: 165,
        steeringLock: 30,
        suspAntiDive: 0.55,
        suspBias: 0.5,
        suspDamping: 0.15,
        suspForce: 1,
        suspHighSpeedDamp: 0,
        suspLower: -0.19,
        suspUpper: 0.27,
        tractionBias: 0.51,
        tractionLoss: 0.9,
        tractionMult: 0.65,
        turnMass: 3851.4,
      });
    });
  });
});
