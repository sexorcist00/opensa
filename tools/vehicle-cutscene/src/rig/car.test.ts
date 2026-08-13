import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { extractCarTemplate, toArrayBuffer } from '../template';
import { convertCar } from './car';
import { type ClumpModel, readClump, writeClump } from './clump-io';
import { IDENTITY_ROTATION } from './matrix';

const CS_BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/csbobcat92.dff'));
const CS_TAXI = new Uint8Array(readFileSync('tests/original/dff/cutscene/cstaxi92.dff'));
const CS_ZR350 = new Uint8Array(readFileSync('tests/original/dff/cutscene/cszr350.dff'));
const BOBCAT = new Uint8Array(readFileSync('tests/original/dff/cutscene/bobcat.dff'));
const TAXI = new Uint8Array(readFileSync('tests/original/dff/cutscene/taxi.dff'));
const ZR350 = new Uint8Array(readFileSync('tests/original/vehicles/zr350.dff'));

function frameByName(model: ClumpModel, name: string): ClumpModel['frames'][number] | undefined {
  return model.frames.find((frame) => frame.name === name);
}

/** A stock-shaped mod with the named frames neutralized (renamed + their meshes detached) — the
 *  negative-case donor. */
function without(donor: Uint8Array, names: string[]): Uint8Array {
  const model = readClump(donor);
  for (const name of names) {
    const index = model.frames.findIndex((frame) => frame.name === name);
    if (index >= 0) {
      model.frames[index].name = `gone_${name}`;
      model.atomics = model.atomics.filter((atomic) => atomic.frameIndex !== index);
    }
  }

  return writeClump(model);
}

describe('convertCar', () => {
  describe('negative cases', () => {
    it('throws when the mod has no chassis mesh', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['chassis']), template)).toThrow('no chassis mesh');
    });

    it('throws when a wheel dummy the template needs is missing', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['wheel_lb_dummy']), template)).toThrow('no wheel_lb_dummy');
    });

    it('throws when no wheel mesh hangs under the wheel dummies', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      expect(() => convertCar(without(BOBCAT, ['wheel']), template)).toThrow('no wheel mesh');
    });
  });

  describe('positive cases (the golden pairs: stock donor must reproduce the vanilla cutscene rig)', () => {
    it('bobcat: full part set, vanilla hierarchy verbatim, vanilla positions, 0.900 shift', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      const vanilla = readClump(CS_BOBCAT);
      const { dff, report } = convertCar(BOBCAT, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      expect(report.shiftZ).toBeCloseTo(0.9, 2);
      expect(report.parts).toHaveLength(9);
      expect(report.droppedFromMod).toEqual(expect.arrayContaining(['chassis_vlo', 'door_lf_dam']));
      // The donor's windscreen has no template slot ('92 bodies bake glass into the chassis) — ADOPTED,
      // not dropped: a car without glass was gate 4's field finding.
      expect(report.adoptedFromMod).toEqual(['windscreen_ok']);

      // Vanilla ids survive as an ordered subsequence (shims for the repositioned extras + the adopted
      // windscreen add fresh ids in between).
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);
      expect(converted.frames.find((frame) => frame.name === 'windscreen_ok')?.boneId).toBeGreaterThanOrEqual(19);
      expect(report.shimmed).toEqual(expect.arrayContaining(['extra1', 'extra2']));
      expect(report.shimmed).not.toContain('door_lf_ok'); // identity delta needs no shim
      expect(converted.frames[1].name).toBe('bobcat_dummy');

      // Bone ids per frame name match vanilla for every SHARED frame (adopted ones are ours alone).
      const vanillaBones = new Map(vanilla.frames.filter((f) => f.name).map((f) => [f.name, f.boneId]));
      for (const frame of converted.frames.filter((f) => f.name && vanillaBones.has(f.name))) {
        expect(frame.boneId, frame.name).toBe(vanillaBones.get(frame.name));
      }

      // Every template frame carries the VANILLA local — the anims' bind pose (gate-4 lesson). The
      // donor's differing placement is baked into vertices instead; on this body-reusing pair only the
      // repositioned extras and the exhaust need it.
      for (const name of ['bonnet_ok', 'boot_ok', 'bump_front_ok', 'bump_rear_ok', 'door_lf_ok', 'extra1']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 3);
        }
      }
      expect(frameByName(converted, 'chassis')?.position[2]).toBeCloseTo(0.9, 3);
      expect(frameByName(converted, 'Box01')?.position[2]).toBeCloseTo(0.35, 3);
      expect(frameByName(converted, 'wheel03')?.rotation[0]).toBeCloseTo(-1, 4); // left mesh z-180

      // All four wheel atomics SHARE one geometry (vanilla duplicates it — ours is the smaller emission).
      const wheelFrames = new Set(
        converted.frames
          .map((frame, index) => ({ frame, index }))
          .filter(({ frame }) => frame.name.startsWith('wheel'))
          .map(({ index }) => index),
      );
      const wheelGeometries = new Set(
        converted.atomics.filter((atomic) => wheelFrames.has(atomic.frameIndex)).map((atomic) => atomic.geometryIndex),
      );
      expect(wheelGeometries.size).toBe(1);
      expect(converted.geometries).toHaveLength(12); // 1 wheel + chassis + 9 parts + adopted windscreen

      // The converted DFF parses as a well-formed clump and keeps the mod's chassis geometry intact.
      const parsed = parseDff(toArrayBuffer(dff));
      const chassisGeometry = parsed.atomics.find(
        (atomic) => parsed.frames[atomic.frameIndex].name.trim() === 'chassis',
      );
      expect(parsed.geometries[chassisGeometry!.geometryIndex].positions.length / 3).toBe(1750);
    });

    it('taxi: _hi frame names emitted, vanilla ids kept, template-less exhaust + glass adopted', () => {
      const template = extractCarTemplate(CS_TAXI);
      const vanilla = readClump(CS_TAXI);
      const { dff, report } = convertCar(TAXI, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);
      expect(frameByName(converted, 'door_lr_hi_ok')?.boneId).toBe(15);
      expect(report.adoptedFromMod.sort()).toEqual(['exhaust_ok', 'windscreen_ok']);
      expect(report.droppedFromMod).not.toContain('exhaust_ok');
    });

    it('zr350: template parts the mod lacks drop out of the hierarchy, mod-only parts are dropped', () => {
      const template = extractCarTemplate(CS_ZR350);
      const { dff, report } = convertCar(ZR350, template);
      const converted = readClump(dff);

      expect(report.missingInMod.sort()).toEqual(['extra2', 'steering_wheel']);
      expect(report.droppedFromMod).toContain('chassis_vlo');
      expect(report.adoptedFromMod.sort()).toEqual(['extra1', 'misc_a']); // visible pods stay on the car
      expect(frameByName(converted, 'windscreen_ok')?.boneId).toBe(17);

      // Holes in the id sequence, contiguous indexes — the hand-made pack's precedent.
      const hierarchy = converted.frames[1].hierarchy!;
      expect(hierarchy.map((node) => node.index)).toEqual(hierarchy.map((_, at) => at));
      expect(hierarchy.some((node) => node.id === 15)).toBe(false); // extra2's bone is gone
      expect(hierarchy.some((node) => node.id === 16)).toBe(false); // steering_wheel's bone is gone
      expect(new Set(hierarchy.map((node) => node.id)).size).toBe(hierarchy.length);
    });

    it('glendale (single-frame wheels): one frame per corner, vanilla hierarchy verbatim', () => {
      const csGlendale = new Uint8Array(readFileSync('tests/original/dff/cutscene/csglendale92.dff'));
      const glendale = new Uint8Array(readFileSync('tests/original/dff/cutscene/glendale.dff'));
      const template = extractCarTemplate(csGlendale);
      const vanilla = readClump(csGlendale);
      const { dff, report } = convertCar(glendale, template);
      const converted = readClump(dff);

      expect(report.missingInMod).toEqual([]);
      // Vanilla ids survive as an ordered subsequence (adopted bones land inside the chassis subtree,
      // BEFORE glendale's trailing wheel bones — DFS order, ids bind the anims, order is free).
      const vanillaIds = vanilla.frames[1].hierarchy!.map((node) => node.id);
      const convertedIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let matched = 0;
      for (const id of convertedIds) {
        if (id === vanillaIds[matched]) {
          matched += 1;
        }
      }
      expect(matched).toBe(vanillaIds.length);
      // Single-style wheels: the mesh frame IS the corner frame, no node in between.
      const wheel = frameByName(converted, 'wheel03')!;
      expect(converted.frames[wheel.parentIndex].name).toBe('glendale');
      expect(wheel.rotation[0]).toBeCloseTo(-1, 4); // left mesh z-180 baked on the single frame
      expect(wheel.position[2]).toBeCloseTo(frameByName(vanilla, 'wheel03')!.position[2], 2);
    });

    it('monster (intermediate COG): the body frame is kept at its vanilla transform', () => {
      const csMonster = new Uint8Array(readFileSync('tests/original/dff/cutscene/csmonster.dff'));
      const monster = new Uint8Array(readFileSync('tests/original/dff/cutscene/monster.dff'));
      const template = extractCarTemplate(csMonster);
      const vanilla = readClump(csMonster);
      const { dff, report } = convertCar(monster, template);
      const converted = readClump(dff);

      const vanillaKept = vanilla.frames[1]
        .hierarchy!.map((node) => node.id)
        .filter((id) => converted.frames.some((frame) => frame.boneId === id));
      const monsterIds = converted.frames[1].hierarchy!.map((node) => node.id);
      let keptMatched = 0;
      for (const id of monsterIds) {
        if (id === vanillaKept[keptMatched]) {
          keptMatched += 1;
        }
      }
      expect(keptMatched).toBe(vanillaKept.length);
      const cog = frameByName(converted, 'COG')!;
      expect(cog.position[2]).toBeCloseTo(1.2, 3);
      // The chassis may hang under a shim absorbing the donor delta — the chain still ends at COG.
      let chassisParent = converted.frames[frameByName(converted, 'chassis')!.parentIndex];
      if (chassisParent.name.endsWith('_pv')) {
        chassisParent = converted.frames[chassisParent.parentIndex];
      }
      expect(chassisParent.name).toBe('COG');
      // The mod's wheels sit under the COG (possibly through a shim) — ground contact preserved.
      const axis = frameByName(converted, 'axis_rf')!;
      let axisParent = converted.frames[axis.parentIndex];
      if (axisParent.name.endsWith('_pv')) {
        axisParent = converted.frames[axisParent.parentIndex];
      }
      expect(axisParent.name).toBe('COG');
      expect(report.parts).toContain('door_lf_ok');
    });

    it('copcarla (junk chassis transform): the mesh frame junk is destroyed, like the game does', () => {
      // Stock copcarla's `chassis` frame carries [0, 1.637, -0.35] under chassis_dummy — the gate-4
      // field regression: trusting it shifted the whole body and every part.
      const csCopcarla = new Uint8Array(readFileSync('tests/original/dff/cutscene/cscopcarla92.dff'));
      const copcarla = new Uint8Array(readFileSync('tests/original/dff/cutscene/copcarla.dff'));
      const template = extractCarTemplate(csCopcarla);
      const vanilla = readClump(csCopcarla);
      const { dff } = convertCar(copcarla, template);
      const converted = readClump(dff);

      const chassis = frameByName(converted, 'chassis')!;
      expect(chassis.position[0]).toBeCloseTo(0, 3);
      expect(chassis.position[1]).toBeCloseTo(0, 3); // the junk 1.637 never reaches the frame local
      for (const name of ['door_rf_ok', 'bump_front_ok', 'bonnet_ok']) {
        const expected = frameByName(vanilla, name)!.position;
        const actual = frameByName(converted, name)!.position;
        for (const axis of [0, 1, 2]) {
          expect(actual[axis], `${name}[${axis}]`).toBeCloseTo(expected[axis], 2);
        }
      }

      // The donor's chassis GEOMETRY is authored in the junk frame's space (the game keeps non-ok/dam
      // transforms) — the SHIM frame carries that junk, so the body lands where vanilla's body sits
      // while the bone keeps the vanilla local for the anims (gate-4 round 3 + gate-7 regression).
      const shim = frameByName(converted, 'chassis_pv')!;
      expect(shim.position[1]).toBeCloseTo(1.637, 2);
      expect(shim.position[2]).toBeCloseTo(-0.35, 1);
      expect(converted.frames[shim.parentIndex].name).toBe('copcarla');
    });

    it('keeps identity rotations identity through the emit path', () => {
      const template = extractCarTemplate(CS_BOBCAT);
      const { dff } = convertCar(BOBCAT, template);
      const converted = readClump(dff);
      expect(frameByName(converted, 'Box01')?.rotation).toEqual([...IDENTITY_ROTATION]);
    });

    it('RENAMES an adopted mesh that duplicates an emitted frame name — a duplicate still binds its channel', () => {
      // DESERT9 (plan 004 round 1): the GMC Sierra ships door glass as a SECOND `door_lf_ok` nested
      // under the first; anim binding is not first-match-only, so the duplicate was driven to the
      // vanilla door local under the door bone — a double transform, glass floating midair.
      // Synthesized here on the stock donor: the windscreen mesh renamed to the door's exact name.
      const model = readClump(BOBCAT);
      const windscreen = model.frames.findIndex((frame) => frame.name === 'windscreen_ok');
      model.frames[windscreen].name = 'door_lf_ok';
      const template = extractCarTemplate(CS_BOBCAT);
      const { dff, report } = convertCar(writeClump(model), template);
      const converted = readClump(dff);

      const doorFrames = converted.frames.filter((frame) => frame.name === 'door_lf_ok');
      expect(doorFrames).toHaveLength(1); // the template bone alone keeps the channel name
      expect(doorFrames[0].boneId).toBe(14); // vanilla id
      expect(frameByName(converted, 'door_lf_ok_ad')).toBeDefined(); // the adopted mesh, unbindable
      expect(report.adoptedFromMod).toContain('door_lf_ok');
    });
  });
});
