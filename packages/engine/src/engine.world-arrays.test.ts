/**
 * A rigid model that points into the SHARED world texture plan (opensa-pack 003 phase 5g).
 *
 * A map object's `.osm` carries no dictionary: its submeshes name GLOBAL array refs, and the engine binds
 * the arrays the cells already stream. That is worth 3 674 MB of per-model dictionaries against 400 MB of
 * geometry — and it is a path the bench scenes never reach, because nothing in them draws a map object BY
 * NAME. So it is asserted through the recording device instead: the model must bind the world array, and
 * must simply not draw a submesh whose array has not streamed in yet rather than throwing mid-frame.
 */
import { encodeOstex, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState, VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const WORLD_ARRAY = 7;

const camera: CameraState = {
  aspect: 16 / 9,
  eye: [0, 0, 5],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [0, 20, 5],
  up: [0, 0, 1],
};

async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);

  return engine;
}

/** One triangle in front of the camera, its submesh pointing at a WORLD array — no textures of its own. */
function mapObjectInit(): VehicleModelInit {
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
    reflect: new Uint8Array(vertexCount * 4),
    submeshes: [{ array: WORLD_ARRAY, indexCount: 3, indexOffset: 0, part: 0, translucent: false }],
    textures: [], // the point: the dictionary is the world's
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

function textureArrayBytes(): Uint8Array {
  const size = 4;

  return encodeOstex({
    format: OstexFormat.RGBA8,
    height: size,
    layers: [{ alphaClass: 0, cutoutRef: 0, nameHash: 1, wrap: 0 }],
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(OstexFormat.RGBA8, size, size, 1)),
    premultiplied: false,
    width: size,
  });
}

/** Draws issued by the rigid pipelines this frame. */
const rigidDraws = (): number => gpu.draws.filter((draw) => draw.pipeline?.includes('rigid') ?? false).length;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('a rigid model bound to the world texture plan', () => {
  describe('negative cases', () => {
    it('uploads NO texture of its own — that is the whole saving', async () => {
      const engine = await bootedEngine();
      const before = gpu.liveTextures().length;
      engine.createVehicleModel(mapObjectInit());

      expect(gpu.liveTextures().length).toBe(before);
    });

    it('skips a submesh whose array has not streamed in, instead of throwing mid-frame', async () => {
      const engine = await bootedEngine();
      const model = engine.createVehicleModel(mapObjectInit());
      engine.createVehicle(model);

      expect(() => engine.frame(camera)).not.toThrow();
      expect(rigidDraws()).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('draws once the world array it names has streamed in', async () => {
      const engine = await bootedEngine();
      engine.textures.load(WORLD_ARRAY, textureArrayBytes());
      const model = engine.createVehicleModel(mapObjectInit());
      engine.createVehicle(model);
      engine.frame(camera);

      expect(rigidDraws()).toBeGreaterThan(0);
    });

    it('appears the frame its array lands, with no re-upload of the model', async () => {
      const engine = await bootedEngine();
      const model = engine.createVehicleModel(mapObjectInit());
      engine.createVehicle(model);
      engine.frame(camera);
      const beforeTextures = gpu.liveTextures().length;

      engine.textures.load(WORLD_ARRAY, textureArrayBytes());
      gpu.draws.length = 0;
      engine.frame(camera);

      expect(rigidDraws()).toBeGreaterThan(0);
      expect(gpu.liveTextures().length).toBe(beforeTextures + 1); // the ARRAY, not a per-model copy
    });
  });
});
