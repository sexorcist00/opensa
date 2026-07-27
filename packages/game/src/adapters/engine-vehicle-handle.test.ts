import type { VehicleInstance } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { EngineVehicleHandle } from './engine-vehicle-handle';

/** How far a posed wheel's AXLE (its local +X) tips out of the horizontal — the camber, seen from outside
 *  the composition. Steering rotates the axle within the ground plane and spin turns about it, so neither
 *  may move this number. */
function axleTilt(quat: readonly number[]): number {
  const [x, y, z, w] = quat;

  return 2 * (x * z - y * w); // the z component of the rotated +X axis
}

/** A recording engine instance: the handle's whole job is to poke exactly these. */
function instance(): {
  matrices: Float32Array;
  probe: VehicleInstance;
  rotations: Map<number, readonly number[]>;
  visible: Map<number, boolean>;
} {
  const matrices = new Float32Array(4 * 16);
  const visible = new Map<number, boolean>();
  const rotations = new Map<number, readonly number[]>();
  const entity = {
    matrices,
    setPartRotation: (part: number, quat: readonly number[]): void => {
      rotations.set(part, [...quat]);
    },
    setPartTranslation: (): undefined => undefined,
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
    rotations,
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

/** The same model plus two mutually-exclusive optional parts, which only a SPAWN may choose between. */
function modelWithExtras(): VehicleModelData {
  const base = model();

  return {
    ...base,
    parts: [...base.parts, { localRotation: [0, 0, 0, 1], localTranslation: [0, -2, 0.5], name: 'extra1' }],
    submeshes: [
      ...base.submeshes,
      {
        damageGroup: null,
        extra: 'extra1',
        indexCount: 3,
        indexOffset: 12,
        kind: 'body',
        lamp: null,
        part: 3,
        translucent: false,
      },
      {
        damageGroup: null,
        extra: 'extra2',
        indexCount: 3,
        indexOffset: 15,
        kind: 'body',
        lamp: null,
        part: 3,
        translucent: false,
      },
    ],
  } as unknown as VehicleModelData;
}

const BONNET_OK = 1;
const BONNET_DAM = 2;
const LOD = 3;
const EXTRA_1 = 4;
const EXTRA_2 = 5;

describe('EngineVehicleHandle', () => {
  describe('negative cases', () => {
    it("the damaged twin and the `_vlo` mesh start HIDDEN (they share the car's buffers)", () => {
      const { probe, visible } = instance();

      new EngineVehicleHandle(probe, model(), () => undefined);

      expect(visible.get(BONNET_OK)).toBe(true);
      expect(visible.get(BONNET_DAM)).toBe(false);
      expect(visible.get(LOD)).toBe(false);
    });

    it('never draws two `extraN` alternatives at once — they occupy the same spot', () => {
      // Twenty spawns, because the pick is random: any of them showing both (or neither) is the jumble the
      // rule exists to prevent.
      for (let spawn = 0; spawn < 20; spawn += 1) {
        const { probe, visible } = instance();

        new EngineVehicleHandle(probe, modelWithExtras(), () => undefined);

        expect([visible.get(EXTRA_1), visible.get(EXTRA_2)].filter(Boolean)).toHaveLength(1);
      }
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

    it('keeps the SAME extra across an LOD swap and a damage change (one decision owns visibility)', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, modelWithExtras(), () => undefined);
      const chosen = visible.get(EXTRA_1) === true ? EXTRA_1 : EXTRA_2;
      const other = chosen === EXTRA_1 ? EXTRA_2 : EXTRA_1;

      handle.setPartDamaged('bonnet', true);
      handle.setLodBand('vlo');
      handle.setLodBand('hd');

      expect(visible.get(chosen)).toBe(true);
      expect(visible.get(other)).toBe(false);
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

describe('EngineVehicleHandle model surface', () => {
  describe('negative cases', () => {
    it('a model with no `_vlo` submesh reports no LOD (the LOD system must not band it)', () => {
      const { probe } = instance();
      const data = model();
      data.submeshes = data.submeshes.filter((submesh) => submesh.kind !== 'lod');

      expect(new EngineVehicleHandle(probe, data, () => undefined).hasLod).toBe(false);
    });

    it('a model with no damageable part exposes no parts', () => {
      const { probe } = instance();
      const data = model();
      data.submeshes = data.submeshes.map((submesh) => ({ ...submesh, damageGroup: null }));

      expect(new EngineVehicleHandle(probe, data, () => undefined).parts).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists each damage group ONCE, at the pivot of the part it was paired under', () => {
      const { probe } = instance();

      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      // `bonnet` has both a body and a `_dam` submesh — it must still appear as a single part.
      expect(handle.parts).toEqual([{ name: 'bonnet', position: [0, 1.5, 0.4] }]);
      expect(handle.hasLod).toBe(true);
    });

    it('mirrors the wheel roster the vehicle physics needs (front flag + radius)', () => {
      const { probe } = instance();

      expect(new EngineVehicleHandle(probe, model(), () => undefined).wheels).toEqual([{ front: true, radius: 0.35 }]);
    });
  });
});

describe('EngineVehicleHandle detached parts', () => {
  describe('negative cases', () => {
    it('poses and removals for an unknown part are silently ignored (no stray matrix writes)', () => {
      const { matrices, probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      visible.clear();

      handle.setDetachedPose('spoiler', { position: [5, 5, 5], rotation: [0, 0, 0, 1] });
      handle.removeDetached('spoiler');

      expect([...matrices].every((value) => value === 0)).toBe(true);
      expect(visible.size).toBe(0);
    });

    it('an out-of-range wheel index is ignored rather than throwing mid-frame', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(() => handle.setWheel(7, { camber: 0, lift: 0, spin: 1, steer: 0.2 })).not.toThrow();
    });

    it('a door side the model does not have is ignored', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(() => handle.setDoorAngle('rr', 1)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('cambers a STEERED wheel about its own forward axis, not the body’s (081/06 §3.3)', () => {
      const { probe, rotations } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      const camber = 0.2;

      // Full lock one way, then the other: the axle must tip out of the horizontal by the SAME camber both
      // times. Compose the camber outside the steer instead and the tilt swings with the steering angle.
      const tilts = [0.9, -0.9].map((steer) => {
        handle.setWheel(0, { camber, lift: 0, spin: 0, steer });

        return axleTilt(rotations.get(0) ?? [0, 0, 0, 1]);
      });

      expect(tilts[0]).toBeCloseTo(-Math.sin(camber), 6);
      expect(tilts[1]).toBeCloseTo(-Math.sin(camber), 6);
    });

    it('keeps the spin INNERMOST, so a rolling wheel does not drag its lean round with it', () => {
      const { probe, rotations } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setWheel(0, { camber: 0.2, lift: 0, spin: 0, steer: 0.4 });
      const still = axleTilt(rotations.get(0) ?? [0, 0, 0, 1]);
      handle.setWheel(0, { camber: 0.2, lift: 0, spin: 12.5, steer: 0.4 });

      expect(axleTilt(rotations.get(0) ?? [0, 0, 0, 1])).toBeCloseTo(still, 6);
    });

    it('a detached panel reads its position off its CURRENT part matrix, converted back to GTA space', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      // Part 1 (bonnet) sits where the engine last flattened it: engine (x, y, z) = (1, 2, -3).
      matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, -3, 1], 1 * 16);

      const pose = handle.detachPart('bonnet');

      expect(pose?.position).toEqual([1, 3, 2]); // engine → GTA: (x, −z, y)
    });

    it('setDetachedPose writes a WORLD matrix that bypasses the car root', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setDetachedPose('bonnet', { position: [10, 20, 3], rotation: [0, 0, 0, 1] });

      // GTA (10, 20, 3) → engine (10, 3, −20), written into the bonnet part's own slot.
      expect([...matrices.subarray(1 * 16 + 12, 1 * 16 + 15)]).toEqual([10, 3, -20]);
    });

    it('a detached pose survives a round trip through detachPart (the panel does not jump)', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setDetachedPose('bonnet', { position: [10, 20, 3], rotation: [0, 0, 0, 1] });

      expect(handle.detachPart('bonnet')?.position).toEqual([10, 20, 3]);
    });

    it('removeDetached hides EVERY submesh of the part, not just the body one', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.removeDetached('bonnet');

      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(false); // the `_dam` twin shares the part
    });

    it('clearing damage restores the undamaged panel', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setPartDamaged('bonnet', true);
      expect(visible.get(BONNET_DAM)).toBe(true);

      handle.setPartDamaged('bonnet', false);

      expect(visible.get(BONNET_OK)).toBe(true);
      expect(visible.get(BONNET_DAM)).toBe(false);
    });

    it('dispose runs the owner callback exactly once per call (the instance is pooled)', () => {
      const { probe } = instance();
      let released = 0;
      const handle = new EngineVehicleHandle(probe, model(), () => {
        released += 1;
      });

      handle.dispose();

      expect(released).toBe(1);
    });

    it('forwards the lamp state to the engine instance verbatim', () => {
      const { probe } = instance();
      const calls: [boolean, boolean, number][] = [];
      const lamped = {
        ...probe,
        setLamps: (headlights: boolean, brakes: boolean, intensity: number): void => {
          calls.push([headlights, brakes, intensity]);
        },
      };
      const handle = new EngineVehicleHandle(lamped, model(), () => undefined);

      handle.setLamps({ brakes: true, headlights: false, intensity: 0.75 });

      expect(calls).toEqual([[false, true, 0.75]]);
    });
  });
});
