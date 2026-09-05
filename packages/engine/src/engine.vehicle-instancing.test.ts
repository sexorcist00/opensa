/**
 * One draw per submesh for a whole model's worth of cars (201/9-08).
 *
 * The console's declared board drew **11 698 rigid calls a frame** — ~80 per car for 150 of them, because a
 * vehicle is a part hierarchy rather than a mesh and every part was its own draw, per car. Opaque order is
 * decided by depth, so a run of consecutive slots that want the same submeshes drawn is one draw per
 * submesh however many cars are in it.
 *
 * **What makes that expressible is the addressing, and it is the part worth guarding.** The per-instance
 * buffers stay slot-major because the write side needs them to be — `setRoot` sends a whole car's matrices
 * in one `writeBuffer` — so an instanced draw cannot read a row straight off `instance_index`. Instead the
 * draw passes the SLOT through `firstInstance` and names its PART in a dynamic-offset uniform, and the
 * shader computes `slot × partCount + part`. Every assertion here is about that pair: how many cars a draw
 * covered, which slot it started at, and which part it named.
 *
 * **The failure this guards against is silent.** A wrong run length draws some cars at another car's
 * matrix; a wrong part offset paints every panel with one part's transform. Neither throws, both render.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState, VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { UV_ANIM_STRIDE } from './render/uv-anim';
import { installFakeWebGpu } from './test/fake-device';

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

const camera: CameraState = {
  aspect: 16 / 9,
  eye: [0, 0, 5],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [0, 20, 5],
  up: [0, 0, 1],
};

async function fleet(count: number): Promise<{ cars: ReturnType<Engine['createVehicle']>[]; engine: Engine }> {
  const engine = new Engine();
  await engine.init(harness.canvas);
  const model = engine.createVehicleModel(modelInit());

  return { cars: Array.from({ length: count }, () => engine.createVehicle(model)), engine };
}

/** Three opaque submeshes over TWO parts, so a part offset that never moved would be visible. */
function modelInit(): VehicleModelInit {
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
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'body' },
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'wheel' },
    ],
    positions: new Uint8Array(positions.buffer),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes: [
      { indexCount: 3, indexOffset: 0, part: 0, translucent: false },
      { indexCount: 3, indexOffset: 3, part: 1, translucent: false },
      { indexCount: 3, indexOffset: 6, part: 0, translucent: false },
    ],
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array(4).fill(255), width: 1 }],
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

/** The rigid draws of the last frame as (instances, firstInstance, partOffset) triples. */
function rigid(): { first: number; instances: number; part: number | undefined }[] {
  return gpu.draws
    .filter((draw) => draw.pipeline?.includes('rigid') ?? false)
    .map((draw) => ({
      first: draw.firstInstance,
      instances: draw.instanceCount,
      part: draw.bindGroupOffsets[1]?.[1],
    }));
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('rigid instancing', () => {
  describe('negative cases', () => {
    it('does not instance a car that has lost a part — it is drawn on its own', async () => {
      // A run covers slots that want the SAME submeshes drawn. A damaged car does not, so it breaks the run
      // and is drawn alone, exactly as every car was before this existed.
      const { cars, engine } = await fleet(4);
      cars[2].setSubmeshVisible(1, false);
      engine.frame(camera);

      const runs = rigid();
      // Slots 0-1 together, slot 2 alone (and short one submesh), slot 3 alone.
      expect(runs.filter((run) => run.first === 0).every((run) => run.instances === 2)).toBe(true);
      expect(runs.filter((run) => run.first === 2).every((run) => run.instances === 1)).toBe(true);
      expect(runs.filter((run) => run.first === 3).every((run) => run.instances === 1)).toBe(true);
      // The hidden submesh is gone from slot 2's draws and from nobody else's.
      expect(runs.filter((run) => run.first === 2)).toHaveLength(2);
      expect(runs.filter((run) => run.first === 3)).toHaveLength(3);
    });

    it('does not span a freed slot, which would draw a car at a dead matrix', async () => {
      const { cars, engine } = await fleet(4);
      engine.destroyVehicle(cars[1]);
      engine.frame(camera);

      const runs = rigid();

      expect(runs.filter((run) => run.first === 0).every((run) => run.instances === 1)).toBe(true);
      expect(runs.filter((run) => run.first === 2).every((run) => run.instances === 2)).toBe(true);
      expect(runs.some((run) => run.first === 1)).toBe(false);
    });

    it('does not instance the TRANSLUCENT phase, whose order is a function of the eye', async () => {
      // 074/16 round 6: glass is sorted back-to-front PER CAR, so one draw cannot serve two of them.
      const engine = new Engine();
      await engine.init(harness.canvas);
      const init = modelInit();
      const model = engine.createVehicleModel({
        ...init,
        submeshes: init.submeshes.map((submesh) => ({ ...submesh, translucent: true })),
      });
      for (let i = 0; i < 3; i += 1) {
        engine.createVehicle(model);
      }
      engine.frame(camera);

      expect(rigid().every((run) => run.instances === 1)).toBe(true);
      expect(rigid()).toHaveLength(9);
    });
  });

  describe('positive cases', () => {
    it('draws a whole fleet of one model in one call per submesh', async () => {
      const { engine } = await fleet(6);
      engine.frame(camera);

      const runs = rigid();

      // Three submeshes, six cars, three draws — not eighteen.
      expect(runs).toHaveLength(3);
      expect(runs.every((run) => run.instances === 6)).toBe(true);
      expect(runs.every((run) => run.first === 0)).toBe(true);
    });

    it('instances cars that HIDE the same submeshes — which is what every real caller does', async () => {
      // The regression that made the first version of this inert, and it was invisible in every test: the
      // run key asked "is nothing hidden", and nothing ever is. `apps/dispatch` hides every submesh and
      // re-shows the body set, because the _dam twins, the _vlo LOD and the unchosen extras ride in the same
      // buffers; the game's handle does the same for extras, variants and damage. The draw count on the
      // device came back completely unchanged, and only the device said so.
      const { cars, engine } = await fleet(5);
      for (const car of cars) {
        car.setSubmeshVisible(0, false);
        car.setSubmeshVisible(1, false);
        car.setSubmeshVisible(2, false);
        car.setSubmeshVisible(0, true);
        car.setSubmeshVisible(2, true);
      }
      engine.frame(camera);

      const runs = rigid();

      // Two submeshes shown, five cars, two draws — the set is what groups, not the absence of hiding.
      expect(runs).toHaveLength(2);
      expect(runs.every((run) => run.instances === 5)).toBe(true);
    });

    it('names each submesh its own PART, so a row is the slot plus the part', async () => {
      const { engine } = await fleet(2);
      engine.frame(camera);

      // Submeshes 0 and 2 are part 0, submesh 1 is part 1 — one dynamic-offset stride apart.
      expect(
        rigid()
          .map((run) => run.part)
          .sort(),
      ).toEqual([0, 0, UV_ANIM_STRIDE]);
    });

    it('reports the two phases apart, so a fleet\u2019s remaining draws have an owner', async () => {
      // After instancing took the board from 11 810 draws to 3 571, WHICH of the two phases the remainder
      // was could only be inferred from arithmetic. The opaque phase collapses to one draw per submesh per
      // run; the blend phase cannot and stays one per car per submesh — so the split is the number that says
      // where a fleet's draw count actually lives.
      const engine = new Engine();
      await engine.init(harness.canvas);
      const init = modelInit();
      const model = engine.createVehicleModel({
        ...init,
        submeshes: [
          { indexCount: 3, indexOffset: 0, part: 0, translucent: false },
          { indexCount: 3, indexOffset: 3, part: 1, translucent: true },
          { indexCount: 3, indexOffset: 6, part: 0, translucent: true },
        ],
      });
      for (let i = 0; i < 6; i += 1) {
        engine.createVehicle(model);
      }
      const stats = engine.frame(camera);

      // One opaque submesh over a run of six; two translucent ones, per car.
      expect(stats.vehicleDrawsOpaque).toBe(1);
      expect(stats.vehicleDrawsBlend).toBe(12);
    });

    it('still counts every car\u2019s triangles, though one draw carried them all', async () => {
      // The count a capture reads must not fall with the draw count: a frame that draws eight cars in three
      // calls is submitting eight cars' geometry, and `trianglesRecorded` says so explicitly for instanced
      // draws. Read as a RATIO against one car, so nothing else in the frame has to be subtracted.
      const one = await fleet(1);
      const alone = one.engine.frame(camera).trianglesRecorded;
      harness.restore();
      harness = installFakeWebGpu();
      gpu = harness.gpu;
      const many = await fleet(8);

      expect(many.engine.frame(camera).trianglesRecorded).toBe(alone * 8);
    });
  });
});
