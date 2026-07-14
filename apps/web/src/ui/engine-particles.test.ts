import type { FxBakedEmitter } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { toEngineSpace } from './engine-particles';

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
