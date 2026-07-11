import type { AssetFileSystem, IdeObjectDef, MapDefinitions } from '@opensa/renderware';
import type { GridCell } from '@opensa/renderware/map/world-grid';

import { decodeOscell } from '@opensa/engine-formats';
import { buildArchiveBuffer, openArchive } from '@opensa/renderware';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';
import { weldCell } from './weld';

// Real committed fixtures (same case build-region tests use).
const DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff';
const TXD = 'tests/original/dff/trafficlight-backface-culling/dyntraffic.txd';

function fixtureCell(count: number): GridCell {
  const hd = Array.from({ length: count }, (_, index) => ({
    id: 1315,
    interior: 0,
    lod: -1,
    modelName: 'trafficlight1',
    position: [2350 + index * 10, -1650, 15] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
  }));

  return { cx: 9, cy: -7, hd, lod: [] };
}

function fixtureDefs(def: Partial<IdeObjectDef> = {}): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(1315, {
    drawDistance: 80,
    flags: 0,
    id: 1315,
    modelName: 'trafficlight1',
    txdName: 'dyntraffic',
    ...def,
  });

  return {
    carGenerators: [],
    catalog,
    imgDirs: [],
    instances: [],
    timedCatalog: new Map<number, IdeObjectDef>(),
    txdParents: new Map<string, string>(),
  };
}

function fixtureFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(DFF), name: 'trafficlight1.dff' },
      { data: readFileSync(TXD), name: 'dyntraffic.txd' },
    ]),
  );

  return {
    ...archive,
    get: (name) => archive.get(name),
    getText: () => null,
    has: (name) => archive.get(name) !== null,
  };
}

describe('weldCell', () => {
  describe('negative cases', () => {
    it('returns null for an empty cell', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      expect(weldCell(fs, fixtureDefs(), { cx: 0, cy: 0, hd: [], lod: [] }, false, planner, [0, 0, 0])).toBeNull();
    });

    it('skips timed defs and counts them', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const welded = weldCell(fs, fixtureDefs({ time: { off: 6, on: 20 } }), fixtureCell(2), false, planner, [0, 0, 0]);

      expect(welded).toBeNull(); // nothing mergeable remained
    });
  });

  describe('positive cases', () => {
    it('bakes multiple instances into merged groups (few draws, correct totals)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const instances = 5;
      const welded = weldCell(fs, fixtureDefs(), fixtureCell(instances), false, planner, [2350, 0, 1650]);

      expect(welded).not.toBeNull();
      const cell = decodeOscell(welded!.bytes);
      // Groups are per (array, class, side) — NOT per instance: 5 traffic lights share the same few groups.
      expect(cell.groups.length).toBeLessThanOrEqual(6);
      expect(cell.groups.length).toBeGreaterThan(0);
      expect(cell.vertexCount).toBeGreaterThan(0);
      expect(cell.indexCount % 3).toBe(0);
      // Index payload references valid vertices.
      const indices = cell.index16
        ? new Uint16Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount)
        : new Uint32Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount);
      for (const index of indices) {
        expect(index).toBeLessThan(cell.vertexCount);
      }
      // 5 instances ⇒ 5× the single-instance geometry.
      const single = weldCell(
        fs,
        fixtureDefs(),
        fixtureCell(1),
        false,
        new TexturePlanner(fs, new Map()),
        [2350, 0, 1650],
      );
      expect(cell.vertexCount).toBe(decodeOscell(single!.bytes).vertexCount * instances);
    });

    it('is deterministic (same input ⇒ identical bytes)', () => {
      const fs = fixtureFs();
      const a = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);
      const b = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect([...a!.bytes]).toEqual([...b!.bytes]);
    });
  });
});
