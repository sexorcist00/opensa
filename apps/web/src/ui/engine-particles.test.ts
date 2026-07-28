import type { DynamicParticleLibrary, Engine } from '@opensa/engine';
import type { AssetFileSystem, FxBakedEmitter } from '@opensa/renderware';

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { setupEngineParticles, toEngineSpace } from './engine-particles';

/** A fountain: SA authors "up" as +Z, and buoyant force the same way. */
function fountain(): FxBakedEmitter {
  return {
    additive: false,
    colors: [
      [1, 1, 1, 1],
      [1, 1, 1, 0.5],
      [1, 1, 1, 0],
    ],
    cone: { angle: 0.2, direction: [0, 0, 1] },
    force: [0, 0, -9.81],
    life: { bias: 0, seconds: 2 },
    perEmitter: 8,
    rate: 4,
    sizes: [0.2, 0.4, 0.6],
    speed: { bias: 0, magnitude: 5 },
    texture: 'wjet2',
  };
}

describe('engine particles', () => {
  describe('negative cases', () => {
    it('does not touch anything but the direction and the force', () => {
      const source = fountain();

      const converted = toEngineSpace(source);

      expect(converted.sizes).toEqual(source.sizes);
      expect(converted.colors).toEqual(source.colors);
      expect(converted.speed).toEqual(source.speed);
      expect(converted.cone.angle).toBe(source.cone.angle);
    });
  });

  describe('positive cases', () => {
    it('sprays UP in engine space: the FX tracks are GTA Z-up, the engine is Y-up', () => {
      // The converter already puts the emitter POSITIONS through e = (x, z, −y). Leave the direction and the
      // force behind and a fountain sprays sideways along the ground — which is exactly what it did.
      const converted = toEngineSpace(fountain());

      expect(converted.cone.direction).toEqual([0, 1, -0]); // +Z (GTA up) → +Y (engine up)
      expect(converted.force[1]).toBeCloseTo(-9.81); // gravity still pulls DOWN
    });
  });
});

// The synthetic half above pins the basis change; only the REAL library proves the dynamic lane's boot-time
// list resolves against what SA actually ships (system names, textures, the tint/size overrides).
const EFFECTS_FXP = 'tests/original/models/effects.fxp';
const EFFECTS_TXD = 'tests/original/models/effectsPC.txd';

interface RecordedSpawn {
  alpha: number;
  life: number;
  system: number;
}

/** A recording Engine stand-in: the two calls setupEngineParticles makes for the dynamic lane. */
function fakeEngine(): {
  engine: Engine;
  library: () => DynamicParticleLibrary | null;
  spawns: RecordedSpawn[];
} {
  let library: DynamicParticleLibrary | null = null;
  const spawns: RecordedSpawn[] = [];
  const engine = {
    initDynamicParticles: (upload: DynamicParticleLibrary): void => {
      library = upload;
    },
    spawnParticle: (
      system: number,
      x: number,
      y: number,
      z: number,
      vx: number,
      vy: number,
      vz: number,
      life: number,
      alpha = 1,
    ): boolean => {
      spawns.push({ alpha, life, system });

      return true;
    },
  } as unknown as Engine;

  return { engine, library: () => library, spawns };
}

/** The two fixture files behind the AssetFileSystem surface setupEngineParticles reads. */
function fixtureFs(): AssetFileSystem {
  const files = new Map<string, Buffer>([
    ['models/effects.fxp', readFileSync(EFFECTS_FXP)],
    ['models/effectspc.txd', readFileSync(EFFECTS_TXD)],
  ]);

  return {
    get: (name: string): ArrayBuffer | null => {
      const file = files.get(name.toLowerCase());
      if (!file) {
        return null;
      }
      const copy = new ArrayBuffer(file.byteLength);
      new Uint8Array(copy).set(file);

      return copy;
    },
    getText: (name: string): null | string => files.get(name.toLowerCase())?.toString('utf8') ?? null,
  } as unknown as AssetFileSystem;
}

describe.skipIf(!existsSync(EFFECTS_FXP) || !existsSync(EFFECTS_TXD))('dynamic lane library (real fixtures)', () => {
  describe('negative cases', () => {
    it('returns null for a system outside the boot-time list', () => {
      const { engine } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs());

      expect(particles?.createEmitter('prt_blood')).toBeNull();
    });

    it('ships no lane at all when the profile has no FX library', () => {
      const { engine, library } = fakeEngine();
      const empty = { get: (): null => null, getText: (): null => null } as unknown as AssetFileSystem;

      expect(setupEngineParticles(engine, empty)).toBeNull();
      expect(library()).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('every boot-time system resolves against the real library, aliases included', () => {
      const { engine } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs());

      for (const name of [
        'prt_collisionsmoke',
        'prt_smokeII_3_expand', // createEmitter lowercases — the caller may use SA's own casing
        'wheeldirt-dust',
        'wheeldirt-grass',
        'wheeldirt-mud',
        'prt_sand',
      ]) {
        expect(particles?.createEmitter(name), name).not.toBeNull();
      }
    });

    it('a burst spawns count particles with the emitter look applied', () => {
      const { engine, spawns } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs());
      const emitter = particles!.createEmitter('wheeldirt-grass')!;
      emitter.lifeScale = 0.5;
      emitter.alphaScale = 0.25;

      emitter.burst(3);

      expect(spawns.length).toBe(3); // prt_wheeldirt is a single-layer system
      for (const spawn of spawns) {
        expect(spawn.alpha).toBe(0.25);
        expect(spawn.life).toBeGreaterThan(0);
        expect(spawn.life).toBeLessThan(5); // authored 5 s × 0.5, ± the authored bias
      }
    });

    it('the grass alias carries its earthy tint and prt_sand its size cut in the baked records', () => {
      const { engine, library, spawns } = fakeEngine();
      const particles = setupEngineParticles(engine, fixtureFs());

      particles!.createEmitter('wheeldirt-grass')!.burst(1);
      const grassIndex = spawns[0].system;
      particles!.createEmitter('prt_sand')!.burst(1);
      const sandIndex = spawns[1].system;

      const systems = library()!.systems;
      // prt_wheeldirt is authored pure white, so the record's age-0 rgb IS the tint.
      expect(systems[grassIndex * 20 + 8]).toBeCloseTo(0.45, 3);
      expect(systems[grassIndex * 20 + 9]).toBeCloseTo(0.5, 3);
      expect(systems[grassIndex * 20 + 10]).toBeCloseTo(0.3, 3);
      // prt_sand's authored size-at-0 is 8 m (a bullet plume); the lane cuts it 0.35×.
      expect(systems[sandIndex * 20 + 4]).toBeCloseTo(8 * 0.35, 3);
    });
  });
});
