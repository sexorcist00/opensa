import type { AssetFileSystem, IdeObjectDef, MapDefinitions } from '@opensa/renderware';
import type { GridCell } from '@opensa/renderware/map/world-grid';

import { decodeOscell } from '@opensa/engine-formats';
import { buildArchiveBuffer, openArchive } from '@opensa/renderware';
import { frameWorldTransform } from '@opensa/renderware/mesh/frame-transform';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TexturePlanner } from './textures';
import { weldCell } from './weld';

// Real committed fixtures (same case build-region tests use).
const DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff';
const TXD = 'tests/original/dff/trafficlight-backface-culling/dyntraffic.txd';
// The SF fountain (IDE 9833): a stock model with THREE 2dfx type-1 particle anchors (`water_fountain`).
const FOUNTAIN_DFF = 'tests/original/dff/particles/fountain_sfw.dff';
const FOUNTAIN_TXD = 'tests/original/dff/particles/fountain_sfw.txd';

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

/** One fountain at a known spot, so the welded anchors can be checked against the instance. */
function fountainCell(): GridCell {
  return {
    cx: 0,
    cy: 0,
    hd: [
      {
        id: 9833,
        interior: 0,
        lod: -1,
        modelName: 'fountain_sfw',
        position: [-1900, 900, 20],
        rotation: [0, 0, 0, 1],
      },
    ],
    lod: [],
  };
}

function fountainDefs(): MapDefinitions {
  const catalog = new Map<number, IdeObjectDef>();
  catalog.set(9833, {
    drawDistance: 40,
    flags: 0,
    id: 9833,
    modelName: 'fountain_sfw',
    txdName: 'fountain_sfw',
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

function fountainFs(): AssetFileSystem {
  const archive = openArchive(
    buildArchiveBuffer([
      { data: readFileSync(FOUNTAIN_DFF), name: 'fountain_sfw.dff' },
      { data: readFileSync(FOUNTAIN_TXD), name: 'fountain_sfw.txd' },
    ]),
  );

  return {
    get: (name: string) => archive.get(name.split('/').pop() ?? name),
    getText: () => null,
    has: (name: string) => archive.get(name.split('/').pop() ?? name) !== null,
  } as unknown as AssetFileSystem;
}

describe('weldCell 2dfx particles', () => {
  describe('negative cases', () => {
    it('welds NO particles into a LOD cell — the anchors would double every emitter', () => {
      const fs = fountainFs();
      const cell: GridCell = { ...fountainCell(), hd: [], lod: fountainCell().hd };

      const welded = weldCell(fs, fountainDefs(), cell, true, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect(welded!.stats.particles).toBe(0);
      expect(decodeOscell(welded!.bytes).particles).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('welds the DFF 2dfx anchors into the cell, in ENGINE space, relative to the cell origin', () => {
      const fs = fountainFs();
      const origin: [number, number, number] = [-1900, 0, -900];

      const welded = weldCell(fs, fountainDefs(), fountainCell(), false, new TexturePlanner(fs, new Map()), origin);

      const particles = decodeOscell(welded!.bytes).particles;
      expect(welded!.stats.particles).toBe(3);
      expect(particles).toHaveLength(3);
      expect(new Set(particles.map((particle) => particle.effectName))).toEqual(new Set(['water_fountain']));
      // GTA (-1900, 900, 20) → engine (-1900, 20, -900), minus the origin ⇒ the anchors sit near the cell's
      // local zero, the Y (engine up) a few metres above the instance. A left-behind basis change lands them
      // hundreds of metres out, which is how the fountain sprayed sideways in the first place.
      for (const particle of particles) {
        expect(Math.abs(particle.position[0])).toBeLessThan(10);
        expect(Math.abs(particle.position[2])).toBeLessThan(10);
        expect(particle.position[1]).toBeGreaterThan(15); // 20 m up (engine Y), give or take the anchor height
        expect(particle.position[1]).toBeLessThan(30);
      }
    });
  });
});

describe('weldCell breakables', () => {
  describe('negative cases', () => {
    it('records NO smashable ranges for a LOD cell — a far prop is never hit', () => {
      const fs = fixtureFs();
      const cell: GridCell = { ...fixtureCell(2), hd: [], lod: fixtureCell(2).hd };

      const welded = weldCell(fs, fixtureDefs(), cell, true, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      expect(decodeOscell(welded!.bytes).breakables).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('records each smashable placement’s index ranges, keyed so a physics hit resolves to one prop', () => {
      // trafficlight1 ships an RW Breakable shatter mesh. The prop stays INSIDE the merged bundle (splitting
      // it out per placement measured 4.5x the draw calls) — the engine shatters it by degenerating exactly
      // these index ranges.
      const fs = fixtureFs();

      const welded = weldCell(fs, fixtureDefs(), fixtureCell(3), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      expect(cell.breakables.length).toBeGreaterThan(0);
      expect(new Set(cell.breakables.map((breakable) => breakable.keyHash)).size).toBe(3); // 3 placements
      for (const breakable of cell.breakables) {
        expect(breakable.indexCount).toBeGreaterThan(0);
        expect(breakable.indexOffset + breakable.indexCount).toBeLessThanOrEqual(cell.indexCount);
      }
    });

    it('tags a smashable prop’s 2dfx lights with its placement — a smashed traffic light takes its coronas', () => {
      // Without the owner tag the coronas stayed lit in mid-air after the pole itself was gone.
      const fs = fixtureFs();

      const welded = weldCell(fs, fixtureDefs(), fixtureCell(2), false, new TexturePlanner(fs, new Map()), [0, 0, 0]);

      const cell = decodeOscell(welded!.bytes);
      expect(cell.lights.length).toBeGreaterThan(0);
      expect(cell.lights.every((light) => light.owner !== 0)).toBe(true);
      const placements = new Set(cell.breakables.map((breakable) => breakable.keyHash));
      for (const light of cell.lights) {
        expect(placements.has(light.owner)).toBe(true);
      }
    });
  });
});

describe('weldCell', () => {
  describe('negative cases', () => {
    it('returns null for an empty cell', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());

      expect(weldCell(fs, fixtureDefs(), { cx: 0, cy: 0, hd: [], lod: [] }, false, planner, [0, 0, 0])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('welds animated defs statically and counts them (field fix: anim skip left building-sized holes)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const welded = weldCell(fs, fixtureDefs({ anim: 'trafficlight' }), fixtureCell(2), false, planner, [0, 0, 0]);

      expect(welded).not.toBeNull();
      expect(welded!.stats.animatedStatic).toBe(2);
      expect(decodeOscell(welded!.bytes).vertexCount).toBeGreaterThan(0);
    });

    it('welds timed defs into trailing objectTable entries (074/06 row 9)', () => {
      const fs = fixtureFs();
      const planner = new TexturePlanner(fs, new Map());
      const welded = weldCell(fs, fixtureDefs({ time: { off: 6, on: 20 } }), fixtureCell(2), false, planner, [0, 0, 0]);

      expect(welded).not.toBeNull();
      const cell = decodeOscell(welded!.bytes);
      expect(cell.objects.length).toBeGreaterThan(0);
      for (const object of cell.objects) {
        expect(object.kind).toBe(0);
        expect(object.params & 0xff).toBe(20); // on hour
        expect((object.params >> 8) & 0xff).toBe(6); // off hour
        expect(object.groupStart + object.groupCount).toBeLessThanOrEqual(cell.groups.length);
      }
      // Every group is owned by an object here (the whole cell is timed).
      const owned = cell.objects.reduce((sum, object) => sum + object.groupCount, 0);
      expect(owned).toBe(cell.groups.length);
      expect(welded!.stats.timedObjects).toBe(cell.objects.length);
    });
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

describe('frameWorldTransform', () => {
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  describe('negative cases', () => {
    it('returns null for an identity chain (the static-world fast path)', () => {
      const frames = [
        { name: 'root', parentIndex: -1, position: [0, 0, 0] as [number, number, number], rotation: IDENTITY },
        { name: 'mesh', parentIndex: 0, position: [0, 0, 0] as [number, number, number], rotation: IDENTITY },
      ];

      expect(frameWorldTransform(frames, 1)).toBeNull();
      expect(frameWorldTransform(frames, -1)).toBeNull();
      expect(frameWorldTransform([], 5)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('composes the parent chain root→leaf (translation + RW column-basis rotation)', () => {
      // Child rotates 90° about Z (RW columns: right=(0,1,0), up=(−1,0,0), at=(0,0,1)), root lifts by 5.
      const frames = [
        { name: 'root', parentIndex: -1, position: [0, 0, 5] as [number, number, number], rotation: IDENTITY },
        {
          name: 'part',
          parentIndex: 0,
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 1, 0, -1, 0, 0, 0, 0, 1],
        },
      ];
      const transform = frameWorldTransform(frames, 1);

      expect(transform).not.toBeNull();
      const { pos, rot } = transform!;
      // v = (1, 0, 0) → rotated (0, 1, 0) → lifted (0, 1, 5).
      const v = [1, 0, 0];
      const world = [
        rot[0] * v[0] + rot[1] * v[1] + rot[2] * v[2] + pos[0],
        rot[3] * v[0] + rot[4] * v[1] + rot[5] * v[2] + pos[1],
        rot[6] * v[0] + rot[7] * v[1] + rot[8] * v[2] + pos[2],
      ];
      expect(world[0]).toBeCloseTo(0);
      expect(world[1]).toBeCloseTo(1);
      expect(world[2]).toBeCloseTo(5);
    });
  });
});
