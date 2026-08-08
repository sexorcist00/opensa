import type { ClumpEffect } from '@opensa/lod-common/clump-effects';
import type { MergedMesh } from '@opensa/lod-common/mesh';
import type { ModelSource } from '@opensa/lod-common/model-source';
import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { encodeLodDff } from '@opensa/lod-common/encode-dff';
import { keepTypesFor } from '@opensa/lod-common/two-dfx-policy';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { describe, expect, it } from 'vitest';

import type { Cell } from '../../core/types';

import { collectCellLightEffects, mergeCell } from './merge';

/** A clump of one atomic → one geometry. */
function clump(geom: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geom],
  };
}

/** A one-triangle geometry with the given texture, at the given local positions. */
function geometry(texture: string, positions: number[]): RWGeometry {
  return {
    flags: 0,
    lights: [],
    materials: [{ color: [255, 255, 255, 255], texture: { maskName: '', name: texture }, textured: true }],
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** A real DFF: one triangle plus a type-0 light entry at model-local (1, 0, 0) — vertex 1's position. */
function lampDff(): Uint8Array {
  const entry = new Uint8Array(20 + 4);
  const view = new DataView(entry.buffer);
  view.setFloat32(0, 1, true); // position x = 1 (y, z stay 0)
  view.setUint32(12, 0, true); // type 0 — light
  view.setUint32(16, 4, true);
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'pole' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, 'lamp', { effects: build2dfxSection([{ bytes: entry, position: [1, 0, 0] }])! });
}

/** A real DFF carrying a type-7 roadsign entry — a type the cell policy drops. */
function signDff(): Uint8Array {
  const entry = new Uint8Array(20 + 88);
  const view = new DataView(entry.buffer);
  view.setUint32(12, 7, true);
  view.setUint32(16, 88, true);
  const mesh: MergedMesh = {
    colors: new Uint8Array(12).fill(255),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture: 'board' }],
    normals: new Float32Array(9),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    uvs: new Float32Array(6),
  };

  return encodeLodDff(mesh, 'board', { effects: build2dfxSection([{ bytes: entry, position: [0, 0, 0] }])! });
}

function source(models: Record<string, RWClump>): ModelSource {
  return { load: (model) => models[model.toLowerCase()] ?? null };
}

const IDENTITY = [0, 0, 0, 1] as const; // no rotation

describe('mergeCell', () => {
  describe('negative cases', () => {
    it('carries no type the shared policy drops from cells — the fate is decided in one place', () => {
      const dff = signDff();
      const models = { board: parseDff(toArrayBuffer(dff)) };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'board', position: [128, 128, 0], rotation: IDENTITY, txd: '' }],
      };

      expect(collectCellLightEffects(cell, 256, () => dff, source(models), new Map())).toEqual([]);
      expect([...keepTypesFor('cell')]).toEqual([0]); // and this is the set it read
    });

    it('skips instances whose model is missing', () => {
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'absent', position: [0, 0, 0], rotation: IDENTITY, txd: '' }],
      };
      const mesh = mergeCell(cell, 256, source({}));
      expect(mesh.positions).toHaveLength(0);
      expect(mesh.groups).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('offsets vertices to the cell centre and applies the instance position', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      // cell (0,0) @256 → centre (128,128,0); instance at (130,128,5) → first vertex relative = (2,0,5).
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'box', position: [130, 128, 5], rotation: IDENTITY, txd: '' }],
      };
      const mesh = mergeCell(cell, 256, source(models));
      expect([...mesh.positions.slice(0, 3)]).toEqual([2, 0, 5]);
      expect(mesh.groups).toEqual([{ indices: Uint32Array.of(0, 1, 2), texture: 'wall' }]);
    });

    it('buckets same-named textures from different def TXDs into separate scoped groups (plan 004)', () => {
      const models = {
        bush: clump(geometry('leaves', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
        tree: clump(geometry('leaves', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
      };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [
          { model: 'bush', position: [0, 128, 0], rotation: IDENTITY, txd: 'badlands' },
          { model: 'tree', position: [4, 128, 0], rotation: IDENTITY, txd: 'gta_proc_bush' },
        ],
      };
      const registry = new Map();
      const mesh = mergeCell(cell, 256, source(models), registry);

      // Without the registry these merge into ONE 'leaves' bucket; scoped, each variant keeps its group.
      expect(mesh.groups.map((g) => g.texture).sort()).toEqual(['badlands_leaves', 'gta_proc_bush_leaves']);
      expect(registry.get('badlands_leaves')).toEqual({ name: 'leaves', txd: 'badlands' });
      expect(registry.get('gta_proc_bush_leaves')).toEqual({ name: 'leaves', txd: 'gta_proc_bush' });
    });

    it('merges two instances of one model and re-bases triangle indices', () => {
      const models = { box: clump(geometry('wall', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const at = (x: number): Cell['instances'][number] => ({
        model: 'box',
        position: [x, 128, 0],
        rotation: IDENTITY,
        txd: '',
      });
      const cell: Cell = { cx: 0, cy: 0, instances: [at(128), at(138)] };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.positions).toHaveLength(18); // 2 × 3 verts × 3
      expect([...mesh.groups[0].indices]).toEqual([0, 1, 2, 3, 4, 5]); // second instance re-based
    });

    it('collects cell light effects with the same instance transform as the vertices', () => {
      // The model carries one light at model-local (1, 0, 0); the cache is pre-seeded (raw bytes unused).
      const models = { lamp: clump(geometry('pole', [0, 0, 0, 1, 0, 0, 0, 1, 0])) };
      const cache = new Map<string, ClumpEffect[]>([
        ['lamp', [{ bytes: Uint8Array.of(9, 9, 9), position: [1, 0, 0], type: 0 }]],
      ]);
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [{ model: 'lamp', position: [130, 128, 5], rotation: IDENTITY, txd: '' }],
      };

      const effects = collectCellLightEffects(cell, 256, () => null, source(models), cache);

      expect(effects).toHaveLength(1);
      // Instance (130,128,5) + local (1,0,0) − cell centre (128,128,0) = (3, 0, 5) — same maths as mergeCell.
      expect(effects[0].position).toEqual([3, 0, 5]);
      expect([...effects[0].bytes]).toEqual([9, 9, 9]); // raw entry bytes untouched
    });

    it('puts a corona on a ROTATED instance exactly where the vertex it sits on lands', () => {
      // The strongest form of "a corona is in the same place on every representation": the light entry sits
      // at the same model-local point as vertex 1, so the carried effect must land on the merged vertex —
      // asserted against the mesh itself, not against a second copy of the transform maths (lod-common/001).
      const dff = lampDff();
      const models = { lamp: parseDff(toArrayBuffer(dff)) };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        // 90° about Z (the IPL quaternion is the inverse; merge conjugates it) at an off-centre position.
        instances: [{ model: 'lamp', position: [130, 140, 5], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2], txd: '' }],
      };

      const mesh: MergedMesh = mergeCell(cell, 256, source(models));
      const effects = collectCellLightEffects(cell, 256, () => dff, source(models), new Map());

      expect(effects).toHaveLength(1);
      const vertex = [mesh.positions[3], mesh.positions[4], mesh.positions[5]]; // vertex 1 = local (1,0,0)
      effects[0].position.forEach((axis, component) => {
        expect(axis).toBeCloseTo(vertex[component], 5);
      });
    });

    it('groups triangles by texture across materials', () => {
      const models = {
        a: clump(geometry('road', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
        b: clump(geometry('grass', [0, 0, 0, 1, 0, 0, 0, 1, 0])),
      };
      const cell: Cell = {
        cx: 0,
        cy: 0,
        instances: [
          { model: 'a', position: [128, 128, 0], rotation: IDENTITY, txd: '' },
          { model: 'b', position: [128, 128, 0], rotation: IDENTITY, txd: '' },
        ],
      };
      const mesh = mergeCell(cell, 256, source(models));
      expect(mesh.groups.map((g) => g.texture).sort()).toEqual(['grass', 'road']);
    });
  });
});
