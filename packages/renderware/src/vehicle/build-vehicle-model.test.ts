import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildVehicleModel } from './build-vehicle-model';
import { VehicleTextures } from './textures';
import { MaterialClass, PaintSlot } from './types';

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
    it('indexes a model past 65 536 vertices as uint32 instead of wrapping it', () => {
      // This used to THROW, and the throw landed in the fixed step — two hi-poly mod cars (86 511 and
      // 82 991 verts) took the whole vehicle system down with them, so NOTHING spawned.
      const huge = geometry();
      const vertexCount = 65_540;
      huge.positions = new Float32Array(vertexCount * 3);
      huge.triangles = [];
      for (let at = 0; at + 2 < vertexCount; at += 3) {
        huge.triangles.push({ a: at, b: at + 1, c: at + 2, materialIndex: 0 });
      }

      const model = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [huge]), textures());

      expect(model.indices.BYTES_PER_ELEMENT).toBe(4);
      // The whole point: the last vertex must still address itself, not wrap to a low index. A plain loop,
      // because `Math.max(...indices)` blows the call stack on tens of thousands of them and `.reduce` is
      // not callable on the `Uint16Array | Uint32Array` union (its overloads do not unify).
      let highest = 0;
      for (const index of model.indices) {
        highest = Math.max(highest, index);
      }

      expect(highest).toBeGreaterThan(65_535);
    });

    it('keeps uint16 indices for an ordinary model', () => {
      const model = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      expect(model.indices.BYTES_PER_ELEMENT).toBe(2);
    });

    it('carcols markers become a per-vertex paint SLOT, not a baked colour (one model, many colours)', () => {
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([material({ color: PRIMARY_MARKER })])]),
        textures(),
      );

      // meta.z carries the slot; the marker colour itself must NOT survive into the vertex colours.
      expect(built.meta[2]).toBe(PaintSlot.primary);
      expect([...built.colors.subarray(0, 3)]).not.toEqual([60, 255, 0]);
    });

    it('leaves a model with no prelit set undarkened at night — a car is lit by the world, not by vertices', () => {
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry()]), textures());

      // Not one of the game's 198 cars carries a prelit set, so synthesizing an ambient night here would
      // dim every vehicle at midnight on top of the world light that already does it.
      expect(built.night).toEqual(built.colors);
    });

    it('modulates the material colour by the PRELIT set, and carries the authored night set', () => {
      const lit = geometry([material({ color: [200, 200, 200, 255] })]);
      lit.prelitColors = new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]);
      lit.nightColors = new Uint8Array([64, 64, 64, 255, 64, 64, 64, 255, 64, 64, 64, 255]);
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [lit]), textures());

      expect([...built.colors.subarray(0, 4)]).toEqual([100, 100, 100, 255]); // 200 × 128/255
      expect([...built.night.subarray(0, 4)]).toEqual([50, 50, 50, 255]); // 200 × 64/255
    });

    it('synthesizes night = day × ambient for PRELIT geometry with no authored night set', () => {
      const lit = geometry([material({ color: [255, 255, 255, 255] })]);
      lit.prelitColors = new Uint8Array([200, 200, 200, 255, 200, 200, 200, 255, 200, 200, 200, 255]);
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [lit]), textures());

      // The welded cell path's formula, shared as NIGHT_AMBIENT — a prop must not disagree with its cell.
      expect([...built.night.subarray(0, 3)]).toEqual([60, 64, 80]); // 200 × [0.3, 0.32, 0.4]
    });

    it('gives each material its OWN copy of a vertex the two share (opensa-pack 003 phase 5g)', () => {
      // Two triangles over four vertices, sharing the 1—2 edge, one material each. With a single vertex
      // table the shared corners took whichever material came last — the wrong texture layer and the wrong
      // colour on 6.9 % of the map's models, and an unbindable submesh once layers span several arrays.
      const shared = geometry([material({ color: [10, 20, 30, 255] }), material({ color: [200, 100, 50, 255] })]);
      shared.positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      shared.triangles = [
        { a: 0, b: 1, c: 2, materialIndex: 0 },
        { a: 1, b: 3, c: 2, materialIndex: 1 },
      ];
      const built = buildVehicleModel(clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [shared]), textures());

      expect(built.positions.length / 3).toBe(6); // 3 + 3, not 4 — the shared edge is emitted twice
      for (const submesh of built.submeshes) {
        const expected = submesh.indexOffset === 0 ? [10, 20, 30] : [200, 100, 50];
        for (let at = submesh.indexOffset; at < submesh.indexOffset + submesh.indexCount; at += 1) {
          const vertex = built.indices[at];

          expect([...built.colors.subarray(vertex * 4, vertex * 4 + 3)]).toEqual(expected);
        }
      }
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

    it('materials classify into meta.w high nibble: paint / chrome / glass / matte (074/16)', () => {
      const envMap = (texture: string): RWMaterial['effects'] => ({
        envMap: { coefficient: 0.5, texture, useFrameBufferAlpha: false },
      });
      const paint = material({ color: PRIMARY_MARKER, effects: envMap('xvehicleenv128') });
      // Chrome is a DATA signal, never a name: untextured neutral grey + an env map (the ./1 mod convention).
      const chrome = material({ color: [153, 153, 153, 255], effects: envMap('vehicleenvmap128') });
      const glass = material({ color: [200, 200, 200, 120], effects: envMap('vehicleenvmap128') });
      const tyre = material(); // no env plugin — SA's "not reflective" marker
      const built = buildVehicleModel(
        clump(
          [frame('chassis')],
          [{ frame: 0, geometry: 0 }],
          [
            {
              ...geometry([paint, chrome, glass, tyre]),
              positions: new Float32Array(Array.from({ length: 12 * 3 }, () => 0)),
              triangles: [
                { a: 0, b: 1, c: 2, materialIndex: 0 },
                { a: 3, b: 4, c: 5, materialIndex: 1 },
                { a: 6, b: 7, c: 8, materialIndex: 2 },
                { a: 9, b: 10, c: 11, materialIndex: 3 },
              ],
            },
          ],
        ),
        textures(),
      );

      const classOf = (vertex: number): number => built.meta[vertex * 4 + 3] >> 4;
      expect(classOf(0)).toBe(MaterialClass.paint);
      expect(classOf(3)).toBe(MaterialClass.chrome);
      expect(classOf(6)).toBe(MaterialClass.glass);
      expect(classOf(9)).toBe(MaterialClass.matte);
    });

    it('chrome never comes from NAMES: bare grey trim is chrome, textured chrome sheets stay paint', () => {
      const envMap = (texture: string): RWMaterial['effects'] => ({
        envMap: { coefficient: 0.5, texture, useFrameBufferAlpha: false },
      });
      // Round-4 user directive: mods combine arbitrary names — only DATA signals classify. Untextured
      // grey trim → chrome; a chrome-NAMED sheet with a base texture → paint (the neo model reads its grey
      // texture as metal through the same formula); a carcols panel on a chrome-named env map → paint.
      const modChrome = material({ effects: envMap('vehicle_generic_chromeprts2') });
      const chromeSheet = material({
        effects: envMap('env_chrome128'),
        texture: { name: 'ch75_chrmap' } as RWMaterial['texture'],
      });
      const paintedBody = material({ color: PRIMARY_MARKER, effects: envMap('chrom_body') });
      const built = buildVehicleModel(
        clump(
          [frame('chassis')],
          [{ frame: 0, geometry: 0 }],
          [
            {
              ...geometry([modChrome, chromeSheet, paintedBody]),
              positions: new Float32Array(Array.from({ length: 9 * 3 }, () => 0)),
              triangles: [
                { a: 0, b: 1, c: 2, materialIndex: 0 },
                { a: 3, b: 4, c: 5, materialIndex: 1 },
                { a: 6, b: 7, c: 8, materialIndex: 2 },
              ],
            },
          ],
        ),
        textures(),
      );

      const classOf = (vertex: number): number => built.meta[vertex * 4 + 3] >> 4;
      expect(classOf(0)).toBe(MaterialClass.chrome);
      expect(classOf(3)).toBe(MaterialClass.paint);
      expect(classOf(6)).toBe(MaterialClass.paint);
    });

    it('`_vlo` LOD meshes and lamps classify MATTE, and the lamp tag survives in the low nibble', () => {
      const env: RWMaterial['effects'] = {
        envMap: { coefficient: 0.6, texture: 'xvehicleenv128', useFrameBufferAlpha: false },
      };
      const lamp = material({
        color: HEAD_LAMP_MARKER,
        effects: env,
        texture: { name: 'vehiclelights128' } as RWMaterial['texture'],
      });
      const built = buildVehicleModel(
        clump(
          [frame('chassis'), frame('chassis_vlo')],
          [
            { frame: 0, geometry: 0 },
            { frame: 1, geometry: 1 },
          ],
          [geometry([lamp]), geometry([material({ effects: env })])],
        ),
        textures(),
      );

      expect(built.meta[3] >> 4).toBe(MaterialClass.matte); // lamp
      expect(built.meta[3] & 0xf).toBe(1); // LampTag.head survives the packing
      const lodVertex = built.submeshes.find((submesh) => submesh.kind === 'lod')!.indexOffset;
      expect(built.meta[built.indices[lodVertex] * 4 + 3] >> 4).toBe(MaterialClass.matte);
    });

    it('the shared `wheel` atomic instances at every dummy, LEFT side turned 180°, scaled by wheelScale', () => {
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
      // The mesh is authored on the RIGHT (the fallback — this clump parents `wheel` to no dummy), so the
      // right copies mount as-modelled and the LEFT ones take the 180° spin.
      const right = built.parts[built.wheels[1].part];
      expect(right.name).toBe('wheel_rf_dummy');
      expect(right.localRotation).toEqual([0, 0, 0, 1]);
      // The synthetic wheel geometry has radius 1 (diameter 2), so fitting it to the requested 0.8 m FRONT
      // diameter is 0.8 / 2 — the field is a diameter in metres, not a multiplier.
      expect(right.scale).toBeCloseTo(0.4, 5);
      const left = built.parts[built.wheels[0].part];
      expect(left.name).toBe('wheel_lf_dummy');
      expect(left.localRotation).toEqual([0, 0, 1, 0]); // 180° about Z — a mirror would flip the winding
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

    it('an env map zeroed to 0 wins over a strong reflection plugin — it IS the tyre marker', () => {
      const tyre = material({
        effects: {
          envMap: { coefficient: 0, texture: 'vehicleenvmap128', useFrameBufferAlpha: false },
          reflection: { intensity: 0.5, offset: [1, 1], scale: [1, 1] },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([tyre])]),
        textures(),
      );

      expect([...built.reflect.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    });

    it('SA reflection + specular with NO env map is reflective — the exhaust / bare-trim shape', () => {
      const exhaust = material({
        color: [51, 51, 51, 255],
        effects: {
          reflection: { intensity: 0.5, offset: [1, 1], scale: [1, 1] },
          specular: { level: 0.17, texture: 'vehiclespecdot64' },
        },
      });
      const built = buildVehicleModel(
        clump([frame('chassis')], [{ frame: 0, geometry: 0 }], [geometry([exhaust])]),
        textures(),
      );

      expect(built.reflect[0]).toBe(0); // no env map named, and the shader reflects the live probe anyway
      expect(built.reflect[1]).toBe(Math.round(0.5 * 255)); // the plugin's intensity becomes the coefficient
      expect(built.reflect[3]).toBe(Math.round(0.17 * 255));
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

/**
 * The wheel-side conventions, on real models — the four shapes SA and its mods actually ship. Each was
 * rendering its far-side wheels facing INWARD: the shared-atomic path spun the wrong side, and the per-corner
 * path never spun at all (the field pair was admiral with both axles wrong and comet with the driver side).
 * The invariant every one of them pins: the copies on the side the mesh was NOT authored on carry the flip,
 * and the copies on the authored side mount exactly as modelled.
 */
const CONVENTIONS: { atomics: string; file: string; name: string; wheels: number }[] = [
  { atomics: 'a shared `wheel` atomic', file: ADMIRAL, name: 'admiral (stock)', wheels: 4 },
  {
    atomics: 'a LONE `wheel_rf` corner atomic',
    file: 'tests/custom/dff/vehicle/comet.dff',
    name: 'comet',
    wheels: 4,
  },
  {
    atomics: '4 per-corner atomics',
    file: 'tests/custom/dff/vehicle/petro-4wheels.dff',
    name: 'petro 4',
    wheels: 4,
  },
  {
    atomics: '6 per-corner atomics + a shared `wheel`',
    file: 'tests/custom/dff/vehicle/petro-6wheels.dff',
    name: 'petro 6',
    wheels: 6,
  },
];

describe('buildVehicleModel (wheel side, real models)', () => {
  describe('positive cases', () => {
    for (const convention of CONVENTIONS) {
      it.skipIf(!existsSync(convention.file))(`${convention.name} — ${convention.atomics}`, () => {
        const built = buildVehicleModel(
          parseDff(toArrayBuffer(readFileSync(convention.file))),
          new VehicleTextures([]),
          { wheelScale: [0.7, 0.7] },
        );

        expect(built.wheels).toHaveLength(convention.wheels);
        // `vehicles.ide`'s wheel field (or the modloader `.settings.txt` line, same field) is the ONLY
        // truth for wheel size, and it is a DIAMETER IN METRES: every stock mesh is already authored at its
        // target, so fitting lands near 1. Multiplying by it instead shrank every wheel by a third.
        for (const wheel of built.wheels) {
          expect(wheel.radius * 2).toBeCloseTo(0.7, 3); // fitted to the requested diameter, whatever the mesh
          expect(built.parts[wheel.part].scale ?? 1).toBeGreaterThan(0.5);
          expect(built.parts[wheel.part].scale ?? 1).toBeLessThan(1.5);
        }
        // Every model measured authors its wheel on the RIGHT, so the left copies — and only they — flip.
        for (const wheel of built.wheels) {
          const part = built.parts[wheel.part];
          const left = part.name.startsWith('wheel_l');

          expect({ name: part.name, rotation: part.localRotation }).toEqual({
            name: part.name,
            rotation: left ? [0, 0, 1, 0] : [0, 0, 0, 1],
          });
        }
      });
    }

    it.skipIf(!existsSync('tests/custom/dff/vehicle/petro-6wheels.dff'))('covers the middle axle too', () => {
      const built = buildVehicleModel(
        parseDff(toArrayBuffer(readFileSync('tests/custom/dff/vehicle/petro-6wheels.dff'))),
        new VehicleTextures([]),
        { wheelScale: [1, 1] },
      );
      const names = built.wheels.map((wheel) => built.parts[wheel.part].name).sort();

      expect(names.filter((name) => /_[lr]m/.test(name))).toHaveLength(2);
      expect(built.wheels.filter((wheel) => wheel.front)).toHaveLength(2); // `m` and `b` are not front axles
    });
  });
});
