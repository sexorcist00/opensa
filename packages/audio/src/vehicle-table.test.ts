import type { OsaudioIndex, OsaudioSound } from '@opensa/engine-formats';
import type { HandlingEntry } from '@opensa/renderware/parsers/text/handling.parser';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';
import type { VehicleDef } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import { describe, expect, it, vi } from 'vitest';

import { AudioAbsence } from './absence';
import { DEFAULT_MAX_VELOCITY_KMH, IDLE_SLOT, REV_SLOT, VehicleVoiceTable } from './vehicle-table';

const SOUND: OsaudioSound = {
  byteLength: 24,
  byteOffset: 0,
  durationSeconds: 0,
  headroom: 0,
  loopOffset: 0,
  sampleRate: 12_000,
};

function absence(): AudioAbsence {
  return new AudioAbsence(vi.fn());
}

function defs(model: string, handlingId: string): ReadonlyMap<string, VehicleDef> {
  return new Map([
    [
      model,
      { gameName: 'POLICE', handlingId, id: 596, model, txd: model, type: 'car', wheelModelId: -1, wheelScale: [1, 1] },
    ],
  ]);
}

function handling(id: string, maxVelocityKmh: string): ReadonlyMap<string, HandlingEntry> {
  const fields = Array.from({ length: 20 }, () => '0');
  fields[11] = maxVelocityKmh;

  return new Map([[id, { fields, id }]]);
}

/** An index whose bank 1 is big enough for both engine slots and whose bank 2 is not. */
function index(): OsaudioIndex {
  return {
    banks: [
      { firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 1 },
      { firstSound: 1, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 4 },
      { firstSound: 5, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 1 },
    ],
    packages: ['GENRL'],
    sounds: Array.from({ length: 6 }, () => SOUND),
    zones: [],
  };
}

function row(over: Partial<VehicleAudioRow> = {}): VehicleAudioRow {
  return {
    bassFactor: 0.7,
    bassSetting: 'normal',
    doorType: 'new',
    dummyBank: 1,
    enginePitch: 1,
    engineUpgrade: 0,
    engineVolumeOffset: 0,
    hornPitch: 1,
    hornSound: 7,
    model: 'copcarla',
    playerBank: 2,
    radioStation: 8,
    radioType: 'civilian',
    soundType: 'car',
    typeForName: 38,
    ...over,
  };
}

describe('VehicleVoiceTable', () => {
  describe('negative cases', () => {
    it('is empty on a build with no audio index', () => {
      const table = VehicleVoiceTable.resolve([row()], new Map(), new Map(), null, absence());

      expect(table.size).toBe(0);
      expect(table.find('copcarla')).toBeNull();
    });

    it('skips a car whose row names no dummy bank — an aircraft authors one bank, not two', () => {
      const table = VehicleVoiceTable.resolve([row({ dummyBank: null })], new Map(), new Map(), index(), absence());

      expect(table.size).toBe(0);
    });

    it('drops a car whose bank cannot hold both engine slots, and says which', () => {
      const said = vi.fn();
      const table = VehicleVoiceTable.resolve(
        [row({ dummyBank: 2 })],
        new Map(),
        new Map(),
        index(),
        new AudioAbsence(said),
      );

      expect(table.size).toBe(0);
      expect(said).toHaveBeenCalledWith(expect.stringContaining('copcarla'));
    });

    it('keeps a car whose handling row is missing, at the game default speed', () => {
      const table = VehicleVoiceTable.resolve([row()], new Map(), new Map(), index(), absence());

      // A wrong denominator revs early; a dropped car is silent, and silent is worse.
      expect(table.find('copcarla')?.maxSpeedMs).toBeCloseTo(DEFAULT_MAX_VELOCITY_KMH / 3.6, 6);
    });

    it('falls back to the default when the handling field is not a usable number', () => {
      const table = VehicleVoiceTable.resolve(
        [row()],
        defs('copcarla', 'COPCARLA'),
        handling('COPCARLA', 'fast'),
        index(),
        absence(),
      );

      expect(table.find('copcarla')?.maxSpeedMs).toBeCloseTo(DEFAULT_MAX_VELOCITY_KMH / 3.6, 6);
    });

    it('answers null for a model nothing was asked about, without saying anything', () => {
      const said = vi.fn();
      const table = VehicleVoiceTable.resolve([row()], new Map(), new Map(), index(), new AudioAbsence(said));

      expect(table.find('admiral')).toBeNull();
      expect(table.find(null)).toBeNull();
      // A board of 150 cars this build cannot voice would otherwise say it 150 times a tick.
      expect(said).not.toHaveBeenCalled();
    });
  });

  describe('positive cases', () => {
    it('joins the three files into one car ready to voice', () => {
      const table = VehicleVoiceTable.resolve(
        [row({ enginePitch: 1.1, engineVolumeOffset: 6 })],
        defs('copcarla', 'COPCARLA'),
        handling('COPCARLA', '200'),
        index(),
        absence(),
      );

      expect(table.find('copcarla')).toEqual({
        enginePitch: 1.1,
        idleSound: 1 + IDLE_SLOT,
        maxSpeedMs: 200 / 3.6,
        model: 'copcarla',
        revSound: 1 + REV_SLOT,
        volumeOffsetDb: 6,
      });
    });

    it('takes the two slots from the bank in the order the game numbers them', () => {
      const table = VehicleVoiceTable.resolve([row()], new Map(), new Map(), index(), absence());
      const car = table.find('copcarla');

      // AE_DUMMY_CRZ is 0 and AE_DUMMY_ID is 1, so the rev loop comes FIRST in the bank.
      expect(car?.revSound).toBeLessThan(car?.idleSound ?? 0);
    });

    it('is case-insensitive on the model, because a unit carries whatever the board wrote', () => {
      const table = VehicleVoiceTable.resolve([row()], new Map(), new Map(), index(), absence());

      expect(table.find('CopCarLA')?.model).toBe('copcarla');
    });
  });
});
