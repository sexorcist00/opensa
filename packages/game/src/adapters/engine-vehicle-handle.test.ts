import type { VehicleInstance } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { EngineVehicleHandle } from './engine-vehicle-handle';

/** A recording engine instance: the handle's whole job is to poke exactly these. */
function instance(): { matrices: Float32Array; probe: VehicleInstance; visible: Map<number, boolean> } {
  const matrices = new Float32Array(4 * 16);
  const visible = new Map<number, boolean>();
  const entity = {
    matrices,
    setPartRotation: (): undefined => undefined,
    setPartWorldMatrix: (part: number, matrix: Float32Array | null): void => {
      if (matrix) {
        matrices.set(matrix, part * 16);
      }
    },
    setRoot: (matrix: Float32Array): void => {
      matrices.set(matrix, 0); // the test reads the root back out of part 0's slot
    },
  };

  return {
    matrices,
    probe: {
      entity,
      model: 0,
      setLamps: (): undefined => undefined,
      setPaint: (): undefined => undefined,
      setSubmeshVisible: (submesh: number, on: boolean): void => {
        visible.set(submesh, on);
      },
    } as unknown as VehicleInstance,
    visible,
  };
}

/**
 * A model with one damageable part (bonnet: body + dam submeshes) and one `_vlo` submesh — enough to
 * exercise the visibility composition, which is the handle's trickiest job.
 */
function model(): VehicleModelData {
  return {
    doors: [{ name: 'door_lf', part: 2, side: 'lf' }],
    dummies: [
      { name: 'headlights', position: [0.8, 1.8, 0], rotation: [0, 0, 0, 1] },
      { name: 'taillights', position: [0.6, -2.4, 0], rotation: [0, 0, 0, 1] },
    ],
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'chassis' },
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 1.5, 0.4], name: 'bonnet' },
      { localRotation: [0, 0, 0, 1], localTranslation: [-0.9, 0.5, 0], name: 'door_lf' },
    ],
    submeshes: [
      { damageGroup: null, indexCount: 3, indexOffset: 0, kind: 'body', lamp: null, part: 0, translucent: false },
      { damageGroup: 'bonnet', indexCount: 3, indexOffset: 3, kind: 'body', lamp: null, part: 1, translucent: false },
      { damageGroup: 'bonnet', indexCount: 3, indexOffset: 6, kind: 'dam', lamp: null, part: 1, translucent: false },
      { damageGroup: null, indexCount: 3, indexOffset: 9, kind: 'lod', lamp: null, part: 0, translucent: false },
    ],
    wheels: [{ front: true, part: 0, radius: 0.35 }],
  } as unknown as VehicleModelData;
}

const BONNET_OK = 1;
const BONNET_DAM = 2;
const LOD = 3;

describe('EngineVehicleHandle', () => {
  describe('negative cases', () => {
    it("the damaged twin and the `_vlo` mesh start HIDDEN (they share the car's buffers)", () => {
      const { probe, visible } = instance();

      new EngineVehicleHandle(probe, model(), () => undefined);

      expect(visible.get(BONNET_OK)).toBe(true);
      expect(visible.get(BONNET_DAM)).toBe(false);
      expect(visible.get(LOD)).toBe(false);
    });

    it('an unknown part cannot be detached', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.detachPart('spoiler')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('an LOD swap does NOT resurrect a damaged panel (damage and LOD compose through ONE decision)', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      handle.setPartDamaged('bonnet', true);

      handle.setLodBand('vlo'); // far away: only the `_vlo` mesh shows
      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(false);
      expect(visible.get(LOD)).toBe(true);

      handle.setLodBand('hd'); // back in close: the panel must still be the DAMAGED one
      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(true);
      expect(visible.get(LOD)).toBe(false);
    });

    it('a culled car draws nothing at all', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setLodBand('culled');

      expect([...visible.values()].some(Boolean)).toBe(false);
    });

    it('the chassis pose carries the GTA Z-up → engine Y-up change: e = (x, z, −y)', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setTransform([10, 20, 3], [0, 0, 0, 1]);

      expect([...matrices.subarray(12, 15)]).toEqual([10, 3, -20]);
    });

    it('a detached panel inherits the BODY rotation, not identity (it would snap flat mid-drive)', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      const half = Math.SQRT1_2;
      handle.setTransform([0, 0, 0], [0, 0, half, half]); // car turned 90°

      const pose = handle.detachPart('bonnet');

      expect(pose?.rotation).toEqual([0, 0, half, half]);
    });

    it('exposes the lamp anchors the shared lamp logic reads', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.lampAnchor('head')).toEqual([0.8, 1.8, 0]);
      expect(handle.lampAnchor('tail')).toEqual([0.6, -2.4, 0]);
    });

    it('a door hinge reports the PIVOT (the builder put the hinge frame there), not the door mesh', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.doorHinge('lf')).toEqual([-0.9, 0.5, 0]);
      expect(handle.doorHinge('rf')).toBeNull();
    });
  });
});
