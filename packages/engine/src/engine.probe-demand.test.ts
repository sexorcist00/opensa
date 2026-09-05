import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState, VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The environment probe refreshes for a CONSUMER, not for a clock (201/9-05).
 *
 * Its only reader is the rigid lane's reflection term, and the sweep priced what the existing amortization
 * leaves at 1.6 ms of a 21.5 ms frame — a cube rendered for nobody on every frame of a map with no car on
 * it. What is asserted here is the rule and its release: no instance, no faces; an instance, and the
 * cadence is the shipped one again.
 */

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const camera = (): CameraState => ({
  aspect: 16 / 9,
  eye: [0, 0, 30],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [100, 0, 30],
  up: [0, 0, 1],
});

/** The smallest thing that reflects: one triangle, one part, one texel. */
function carInit(): VehicleModelInit {
  const vertexCount = 3;
  const positions = new Float32Array([-1, 20, 0, 1, 20, 0, 0, 20, 2]);

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    indexCount: 3,
    indices: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(vertexCount * 4).fill(255),
    normals: new Uint8Array(new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]).buffer),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'body' }],
    positions: new Uint8Array(positions.buffer),
    reflect: new Uint8Array(vertexCount * 4).fill(255),
    submeshes: [{ indexCount: 3, indexOffset: 0, part: 0, translucent: false }],
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array(4).fill(255), width: 1 }],
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

/** Probe FACE passes the recorder has seen — `env-probe-face-N`, the pass this gate is about. */
function faces(): number {
  return gpu.passes.filter((pass) => pass.label.startsWith('env-probe-face')).length;
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('the environment probe', () => {
  describe('negative cases', () => {
    it('renders no face while nothing reflects — a map with no car on it pays nothing', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.probeCenter = [0, 0, 0];
      for (let frame = 0; frame < 24; frame += 1) {
        engine.frame(camera());
      }

      expect(faces()).toBe(0);
    });

    it('renders no face when the environment asks for no reflection at all', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.probeCenter = [0, 0, 0];
      engine.environment.reflectionStrength = 0;
      engine.createVehicle(engine.createVehicleModel(carInit()));
      for (let frame = 0; frame < 24; frame += 1) {
        engine.frame(camera());
      }

      expect(faces()).toBe(0);
    });
  });

  describe('positive cases', () => {
    // Without this the negative cases above are vacuous: a filter that matches nothing also counts zero.
    it('renders faces at the shipped cadence once something reflects', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.probeCenter = [0, 0, 0];
      engine.createVehicle(engine.createVehicleModel(carInit()));
      for (let frame = 0; frame < 24; frame += 1) {
        engine.frame(camera());
      }

      // One face every PROBE_FRAME_INTERVAL (2) frames: half of 24, and never all of them.
      expect(faces()).toBeGreaterThan(0);
      expect(faces()).toBeLessThan(24);
    });
  });
});
