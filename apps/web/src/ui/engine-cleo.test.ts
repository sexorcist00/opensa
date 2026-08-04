import { ScriptRunner } from '@opensa/cleo';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { CleoHostDeps, CleoObjectInstance } from './engine-cleo';

import { createCleoEngineHost, discoverAndSpawn } from './engine-cleo';

const FERRIS = 'tests/original/cleo/ferris.cs';

interface FakeInstance extends CleoObjectInstance {
  destroyed: boolean;
  roots: Float32Array[];
  visible: boolean[];
}

function fakeInstance(): FakeInstance {
  const instance: FakeInstance = {
    destroy: (): void => {
      instance.destroyed = true;
    },
    destroyed: false,
    roots: [],
    setRoot: (root): void => {
      instance.roots.push(Float32Array.from(root));
    },
    setVisible: (visible): void => {
      instance.visible.push(visible);
    },
    visible: [],
  };

  return instance;
}

/** Ferris's four models under their real ids; everything else resolves to nothing. */
const FERRIS_IDS: Readonly<Record<number, { drawDistance: number; modelName: string; txdName: string }>> = {
  14644: { drawDistance: 299, modelName: 'ferriswheel_wheel', txdName: 'ferriswheel_wheel' },
  14645: { drawDistance: 299, modelName: 'ferriswheel_seat', txdName: 'ferriswheel_seat' },
  14646: { drawDistance: 299, modelName: 'ferriswheel_lights', txdName: 'ferriswheel_lights' },
  14647: { drawDistance: 299, modelName: 'ferriswheel_base', txdName: 'ferriswheel_base' },
};

function makeDeps(overrides: Partial<CleoHostDeps> = {}): CleoHostDeps & { spawned: FakeInstance[] } {
  const spawned: FakeInstance[] = [];

  return {
    cameraGta: () => [389.773, -2028.55, 25],
    ensureModel: () => true,
    flush: () => undefined,
    hour: () => 12,
    nativeWorld: {
      doorAngleRatio: () => null,
      lodDistMultiplier: () => 1,
      nextSiblingPart: () => null,
      partForward: () => [0, 1, 0],
      partIndex: () => null,
      partTranslation: () => [0, 0, 0],
      setPartRotation: () => undefined,
      setPartTranslationComponent: () => undefined,
      vehicleHandles: () => [],
      wind: () => 0,
    },
    playerGta: () => [389, -2028, 14],
    print: () => undefined,
    resolveById: (id) => FERRIS_IDS[id] ?? null,
    resolveByName: () => null,
    ridingCar: () => false,
    spawn: (): FakeInstance => {
      const instance = fakeInstance();
      spawned.push(instance);

      return instance;
    },
    spawned,
    ...overrides,
  };
}

describe('createCleoEngineHost', () => {
  describe('negative cases', () => {
    it('a deleted handle no-ops with a once-log (detach-safe)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(14644, 0, 0, 0);
      host.objects.delete(handle);
      host.objects.setRotation(handle, 0, 0, 90);
      host.objects.setCoordinates(handle, 1, 2, 3);
      expect(deps.spawned[0].destroyed).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('an unresolvable model id creates nothing and the handle reads as non-existent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(99999, 0, 0, 0);
      expect(handle).toBe(-1);
      expect(host.objects.exists(handle)).toBe(false);
      expect(host.models.isAvailable(99999)).toBe(false);
      warn.mockRestore();
    });
  });

  describe('positive cases', () => {
    it('create places the instance at the converted engine position', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      host.objects.create(14644, 10, 20, 30);
      const root = deps.spawned[0].roots[0];
      // gtaPositionToEngine: engine = (x, z, -y).
      expect([root[12], root[13], root[14]]).toEqual([10, 30, -20]);
    });

    it('setRotation writes a new root (the wheel visibly turns), translation intact', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(14644, 10, 20, 30);
      host.objects.setRotation(handle, 0, 45, 90);
      const [first, second] = deps.spawned[0].roots;
      expect(second).not.toEqual(first);
      expect([second[12], second[13], second[14]]).toEqual([10, 30, -20]);
    });

    it('CONNECT_LODS hides the far half until the camera leaves the near draw distance', () => {
      const deps = makeDeps({ cameraGta: () => [0, 0, 0] });
      const host = createCleoEngineHost(deps);
      const near = host.objects.create(14644, 0, 100, 0); // 100 m away, drawDistance 299
      const far = host.objects.create(14644, 0, 100, 0);
      host.objects.connectLods(near, far);
      expect(deps.spawned[1].visible).toEqual([false]);
      host.update();
      // Still within 299 m — nothing swaps.
      expect(deps.spawned[0].visible).toEqual([]);
      // Move the OBJECT out of range instead of the camera (same distance test).
      host.objects.setCoordinates(near, 0, 400, 0);
      host.update();
      expect(deps.spawned[0].visible).toEqual([false]);
      expect(deps.spawned[1].visible).toEqual([false, true]);
    });

    it('world.cameraWithin measures against the injected camera', () => {
      const host = createCleoEngineHost(makeDeps({ cameraGta: () => [0, 0, 0] }));
      expect(host.world.cameraWithin(0, 500, 0, 600)).toBe(true);
      expect(host.world.cameraWithin(0, 500, 0, 400)).toBe(false);
    });
  });
});

describe.skipIf(!existsSync(FERRIS))('ferris on the REAL host facets (headless integration)', () => {
  describe('positive cases', () => {
    it('builds the wheel and turns it: 21 instances, LOD pairs, an advancing wheel root', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const runner = new ScriptRunner({ host });
      const spawned = discoverAndSpawn(['cleo/ferris.cs'], () => new Uint8Array(readFileSync(FERRIS)), runner, 32);
      expect(spawned).toEqual(['cleo/ferris.cs']);
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
        host.update();
      }
      expect(runner.faults).toEqual([]);
      expect(host.objectCount()).toBe(21);
      // The wheel is the SECOND spawn (base first) — its root keeps changing while its translation
      // holds still: the exact transform sequence the field checkpoint will show as a turning wheel.
      const wheel = deps.spawned[1];
      expect(wheel.roots.length).toBeGreaterThan(60);
      const [first, last] = [wheel.roots[0], wheel.roots[wheel.roots.length - 1]];
      expect(last).not.toEqual(first);
      expect([last[12], last[13], last[14]]).toEqual([first[12], first[13], first[14]]);
      // A seat (spawn index 5+) RIDES the rim: its translation moves between ticks.
      const seat = deps.spawned[6];
      const seatFirst = seat.roots[0];
      const seatLast = seat.roots[seat.roots.length - 1];
      expect([seatFirst[12], seatFirst[13], seatFirst[14]]).not.toEqual([seatLast[12], seatLast[13], seatLast[14]]);
    });
  });
});
