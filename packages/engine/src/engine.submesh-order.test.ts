/**
 * The opaque submesh order is CACHED on the instance, and the cache has exactly one input that moves
 * (201/9-07).
 *
 * The order is a function of `submesh.array` — a constant of the model — and `submeshVisible`, so rebuilding
 * it per instance per frame cost an array of objects, a sort and a `map()` for an answer that was the same
 * every time; at the console's declared 150 units that is ~150 of each, every frame. What makes caching it
 * risky is not the sort, it is the invalidation: a stale order draws a car's wreck through itself, or hides
 * a body panel, and nothing throws. So the guard is a draw-level one — what the fake device actually
 * recorded — rather than a test of the cache's shape.
 */
import { encodeOstex, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState, VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const ARRAY_A = 3;
const ARRAY_B = 4;

const camera: CameraState = {
  aspect: 16 / 9,
  eye: [0, 0, 5],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [0, 20, 5],
  up: [0, 0, 1],
};

async function drawnModel(): Promise<{ engine: Engine; instance: ReturnType<Engine['createVehicle']> }> {
  const engine = new Engine();
  await engine.init(harness.canvas);
  engine.textures.load(ARRAY_A, textureArrayBytes());
  engine.textures.load(ARRAY_B, textureArrayBytes());
  const model = engine.createVehicleModel(twoSubmeshInit());

  return { engine, instance: engine.createVehicle(model) };
}

/** The rigid draws this frame, by index count, in the order they were issued — 6 is `A`, 3 is `B`. */
function rigidDraws(): number[] {
  return gpu.draws.filter((draw) => draw.pipeline?.includes('rigid') ?? false).map((draw) => draw.indexCount ?? 0);
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

/**
 * Two opaque submeshes on two different world arrays, and DIFFERENT SIZES so the recorder can tell them
 * apart: the fake device records `indexCount` but not the offset, and both submeshes bind the same
 * `vehicle` group label, so the size is the only discriminator a draw carries.
 *
 * `A` is declared SECOND and carries the lower array, which is the whole point — the opaque order groups by
 * array, so a correct frame draws the six-index submesh before the three-index one.
 */
function twoSubmeshInit(): VehicleModelInit {
  const vertexCount = 9;
  const positions = new Float32Array([
    -1, 20, 0, 1, 20, 0, 0, 20, 2, -1, 21, 0, 1, 21, 0, 0, 21, 2, -1, 22, 0, 1, 22, 0, 0, 22, 2,
  ]);

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    indexCount: 9,
    indices: new Uint8Array(new Uint16Array([0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(vertexCount * 4).fill(255),
    normals: new Uint8Array(new Float32Array(Array.from({ length: 27 }, (_, i) => (i % 3 === 1 ? -1 : 0))).buffer),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'body' }],
    positions: new Uint8Array(positions.buffer),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes: [
      { array: ARRAY_B, indexCount: 3, indexOffset: 6, part: 0, translucent: false },
      { array: ARRAY_A, indexCount: 6, indexOffset: 0, part: 0, translucent: false },
    ],
    textures: [],
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('the opaque submesh order', () => {
  describe('negative cases', () => {
    it('does not keep drawing a submesh that was hidden after the order was cached', async () => {
      // The stale-cache failure, and the reason this is a draw test: nothing throws when it happens.
      const { engine, instance } = await drawnModel();
      engine.frame(camera);

      expect(rigidDraws()).toHaveLength(2);

      instance.setSubmeshVisible(0, false);
      gpu.draws.length = 0;
      engine.frame(camera);

      expect(rigidDraws()).toEqual([6]);
    });

    it('does not lose a submesh that was hidden and shown again', async () => {
      const { engine, instance } = await drawnModel();
      instance.setSubmeshVisible(1, false);
      engine.frame(camera);

      expect(rigidDraws()).toEqual([3]);

      instance.setSubmeshVisible(1, true);
      gpu.draws.length = 0;
      engine.frame(camera);

      expect(rigidDraws()).toEqual([6, 3]);
    });
  });

  describe('positive cases', () => {
    it('groups by texture array, and the second frame draws exactly what the first did', async () => {
      // The order is grouped by `array` rather than by declaration: the model declares B then A, so the
      // draws come back A first. The cached frame must reproduce it, not merely draw the same count.
      const { engine } = await drawnModel();
      engine.frame(camera);
      const first = rigidDraws();
      gpu.draws.length = 0;
      engine.frame(camera);

      expect(first).toEqual([6, 3]);
      expect(rigidDraws()).toEqual(first);
    });

    it('survives a camera move — the opaque order does not depend on the eye', async () => {
      const { engine } = await drawnModel();
      engine.frame(camera);
      gpu.draws.length = 0;
      engine.frame({ ...camera, eye: [40, -60, 120], target: [0, 20, 5] });

      expect(rigidDraws()).toEqual([6, 3]);
    });
  });
});
