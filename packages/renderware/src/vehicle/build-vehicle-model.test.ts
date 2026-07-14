import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildVehicleModel } from './build-vehicle-model';
import { VehicleTextures } from './textures';
import { PaintSlot } from './types';

const PRIMARY_MARKER: [number, number, number, number] = [60, 255, 0, 255];
const HEAD_LAMP_MARKER: [number, number, number, number] = [0, 255, 200, 255];

function clump(frames: RWFrame[], atomics: { frame: number; geometry: number }[], geometries: RWGeometry[]): RWClump {
  return {
    atomics: atomics.map((atomic) => ({ frameIndex: atomic.frame, geometryIndex: atomic.geometry })),
    frames,
    geometries,
  };
}

function frame(name: string, parentIndex = -1, position: [number, number, number] = [0, 0, 0]): RWFrame {
  return { name, parentIndex, position, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

function geometry(materials: RWMaterial[] = [material()]): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS,
    lights: [],
    materials,
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [200, 200, 200, 255], texture: null, textured: false, ...partial };
}

/** No TXDs: every material resolves to the built-in white layer. */
function textures(): VehicleTextures {
  return new VehicleTextures([]);
}

describe('buildVehicleModel', () => {
  describe('negative cases', () => {
    it('a clump with no wheel atomic and no dummies yields no wheels', () => {
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      expect(built.wheels).toHaveLength(0);
      expect(built.parts).toHaveLength(1);
    });

    it('unchosen `extraN` alternatives never render — SA shows at most one', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('extra1'), frame('extra2'), frame('extra3')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
            { frame: 2, geometry: 0 },
            { frame: 3, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
        { rng: () => 0 }, // pick extra1
      );

      const extras = built.parts.filter((part) => part.name.startsWith('extra'));
      expect(extras).toHaveLength(1);
      expect(extras[0].name).toBe('extra1');
    });
  });

  describe('positive cases', () => {
    it('carcols markers become a per-vertex paint SLOT, not a baked colour (one model, many colours)', () => {
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([material({ color: PRIMARY_MARKER })])]),
        textures(),
      );

      // meta.z carries the slot; the marker colour itself must NOT survive into the vertex colours.
      expect(built.meta[2]).toBe(PaintSlot.primary);
      expect([...built.colors.subarray(0, 3)]).not.toEqual([60, 255, 0]);
    });

    it('lamp materials render white and carry a head/tail tag instead of their marker colour', () => {
      const lamp = material({
        color: HEAD_LAMP_MARKER,
        texture: { name: 'vehiclelights128' } as RWMaterial['texture'],
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([lamp])]),
        textures(),
      );

      expect(built.submeshes[0].lamp).toBe('head');
      expect([...built.colors.subarray(0, 3)]).toEqual([255, 255, 255]);
    });

    it('the shared `wheel` atomic instances at every dummy, right side turned 180°, scaled by wheelScale', () => {
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('wheel'),
            frame('wheel_lf_dummy', -1, [1, 2, 0]),
            frame('wheel_rf_dummy', -1, [-1, 2, 0]),
            frame('wheel_lb_dummy', -1, [1, -2, 0]),
            frame('wheel_rb_dummy', -1, [-1, -2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
        { wheelScale: [0.8, 0.8] },
      );

      expect(built.wheels).toHaveLength(4);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2);
      const right = built.parts[built.wheels[1].part];
      expect(right.name).toBe('wheel_rf_dummy');
      expect(right.localRotation).toEqual([0, 0, 1, 0]); // 180° about Z — mirroring would flip the winding
      expect(right.scale).toBeCloseTo(0.8 * 1.25, 5); // vehicles.ide FRONT-axle scale × the in-engine boost
    });

    it('`_dam` twins ride the same buffers as hidden submeshes, paired to their `_ok` by damage group', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('bonnet_ok'), frame('bonnet_dam')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
            { frame: 2, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      const bonnet = built.submeshes.filter((submesh) => submesh.damageGroup === 'bonnet');
      expect(bonnet.map((submesh) => submesh.kind).sort()).toEqual(['body', 'dam']);
      // Both states hang off ONE part, so damage is a pure visibility flip — no re-parenting, no re-upload.
      expect(new Set(bonnet.map((submesh) => submesh.part)).size).toBe(1);
    });

    it('`_vlo` meshes come through as `lod` submeshes (the extractor used to drop them)', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('chassis_vlo')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      expect(built.submeshes.filter((submesh) => submesh.kind === 'lod')).toHaveLength(1);
      expect(built.submeshes.filter((submesh) => submesh.kind === 'body')).toHaveLength(1);
    });

    it('a door pivots on its HINGE frame, with the door mesh carried as an offset inside it', () => {
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('door_lf_dummy', -1, [1, 0, 0]), frame('door_lf_ok', 1, [0.5, 0, 0])],
          [
            { frame: 0, geometry: 0 },
            { frame: 2, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      expect(built.doors).toEqual([{ name: 'door_lf', part: 1, side: 'lf' }]);
      const door = built.parts[1];
      expect(door.localTranslation).toEqual([1, 0, 0]); // the hinge dummy — NOT the door's own frame
      expect(door.offset?.slice(12, 15)).toEqual([0.5, 0, 0]); // the door, relative to the hinge
    });

    it('carries the DFF reflection settings per vertex (env layer, coefficient, intensity, specular)', () => {
      const reflective = material({
        effects: {
          envMap: { coefficient: 1, texture: 'xvehicleenv128', useFrameBufferAlpha: false },
          reflection: { intensity: 0.09, offset: [1, 1], scale: [1, 1] },
          specular: { level: 0.18, texture: 'vehiclespecdot64' },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([reflective])]),
        textures(),
      );

      expect(built.reflect[0]).toBeGreaterThan(0); // the env map resolved to a real layer
      expect(built.reflect[1]).toBe(255); // coefficient 1
      expect(built.reflect[2]).toBe(Math.round(0.09 * 255));
      expect(built.reflect[3]).toBe(Math.round(0.18 * 255));
    });

    it('a coefficient of 0 means NOT reflective — SA leaves the plugin on wheels and tyres', () => {
      const matte = material({
        effects: {
          envMap: { coefficient: 0, texture: null, useFrameBufferAlpha: false },
          reflection: { intensity: 0, offset: [1, 1], scale: [1, 1] },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([matte])]),
        textures(),
      );

      expect([...built.reflect.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    });

    it('a lone corner wheel with real dummies is a MIS-NAMED shared wheel (the comet case)', () => {
      const built = buildVehicleModel(
        clump(
          [
            frame('chassis'),
            frame('wheel_rf'),
            frame('wheel_lf_dummy', -1, [1, 2, 0]),
            frame('wheel_rf_dummy', -1, [-1, 2, 0]),
          ],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 0 },
          ],
          [geometry()],
        ),
        textures(),
      );

      // Instanced at BOTH dummies rather than rendered once at its own corner.
      expect(built.wheels).toHaveLength(2);
    });
  });
});

// The engine-side builder must agree with its three twin (`three/build-vehicle.test.ts`, which already runs on
// these files) — a synthetic clump only ever re-states this module's own assumptions about SA's conventions.
const ADMIRAL = 'tests/original/dff/vehicle/admiral.dff';
const ADMIRAL_TXD = 'tests/original/vehicles/admiral.txd';
const GENERIC_TXD = 'tests/original/models/generic/vehicle.txd';

describe.skipIf(!existsSync(ADMIRAL) || !existsSync(GENERIC_TXD))('buildVehicleModel (real admiral.dff)', () => {
  const built = buildVehicleModel(
    parseDff(toArrayBuffer(readFileSync(ADMIRAL))),
    new VehicleTextures([toArrayBuffer(readFileSync(ADMIRAL_TXD)), toArrayBuffer(readFileSync(GENERIC_TXD))]),
    { wheelScale: [0.7, 0.7] },
  );

  describe('positive cases', () => {
    it('builds the full stock rig: 4 wheels, 4 doors, and the lamp dummies', () => {
      expect(built.wheels).toHaveLength(4);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2);
      // SA names the REAR doors `lr`/`rr` but the rear WHEELS `lb`/`rb` — two conventions in one file.
      expect(built.doors.map((door) => door.side).sort()).toEqual(['lf', 'lr', 'rf', 'rr']);
      const dummies = built.dummies.map((dummy) => dummy.name);
      expect(dummies).toContain('headlights');
      expect(dummies).toContain('taillights');
    });

    it('tags BOTH lamp ends — head at the front, tail at the rear', () => {
      const lamps = new Set(built.submeshes.map((submesh) => submesh.lamp).filter(Boolean));

      expect(lamps).toEqual(new Set(['head', 'tail']));
    });

    it('carries a real paint slot: the carcols markers are per-vertex, not baked colours', () => {
      const slots = new Set<number>();
      for (let at = 2; at < built.meta.length; at += 4) {
        slots.add(built.meta[at]);
      }

      // The stock admiral marks its PRIMARY colour only — a 2-colour entry in carcols.dat does NOT imply a
      // secondary marker in the DFF. The rest of the body is unpainted (slot 0) and keeps its own texture.
      expect(slots).toEqual(new Set([PaintSlot.none, PaintSlot.primary]));
    });

    it('the DFF ships env-map settings on the paint — the reflect channel is populated from the file', () => {
      let reflective = 0;
      for (let at = 0; at < built.reflect.length; at += 4) {
        if (built.reflect[at] > 0) {
          reflective += 1;
        }
      }

      expect(reflective).toBeGreaterThan(0);
    });

    it('pairs every `_dam` twin with its `_ok` body on ONE part (damage = a visibility flip)', () => {
      const damaged = built.submeshes.filter((submesh) => submesh.kind === 'dam');
      expect(damaged.length).toBeGreaterThan(0);
      for (const submesh of damaged) {
        const body = built.submeshes.find(
          (other) => other.kind === 'body' && other.damageGroup === submesh.damageGroup,
        );
        expect(body).toBeDefined();
        expect(body!.part).toBe(submesh.part);
      }
    });

    it('every index addresses a real vertex and no position is NaN (the upload invariant)', () => {
      const vertices = built.positions.length / 3;
      expect(vertices).toBeGreaterThan(0);
      for (const index of built.indices) {
        expect(index).toBeLessThan(vertices);
      }
      expect([...built.positions].every(Number.isFinite)).toBe(true);
    });
  });
});
