import type { AudioBufferLike } from '@opensa/audio';
import type { OsaudioIndex, OsaudioSound } from '@opensa/engine-formats';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';

import { AudioAbsence, AudioEventTable, VehicleVoiceTable, VoicePool } from '@opensa/audio';
import { FakeAudioContext } from '@opensa/audio/test/fake-context';
import { describe, expect, it, vi } from 'vitest';

import type { Unit } from '../ops/types';

import { AUDIBLE_REACH, sirenNameFor, UnitAudio } from './unit-audio';

const SOUND: OsaudioSound = {
  byteLength: 24,
  byteOffset: 0,
  durationSeconds: 1,
  headroom: 0,
  loopOffset: 0,
  sampleRate: 12_000,
};

const INDEX: OsaudioIndex = {
  banks: [{ firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 4 }],
  packages: ['GENRL'],
  sounds: [SOUND, SOUND, SOUND, SOUND],
  zones: [],
};

const CAR: VehicleAudioRow = {
  bassFactor: 0.7,
  bassSetting: 'normal',
  doorType: 'new',
  dummyBank: 0,
  enginePitch: 1,
  engineUpgrade: 0,
  engineVolumeOffset: 0,
  hornPitch: 1,
  hornSound: 7,
  model: 'copcarla',
  playerBank: null,
  radioStation: 8,
  radioType: 'civilian',
  soundType: 'car',
  typeForName: 38,
};

/** A pool over a fake context, plus everything `UnitAudio` needs around it. */
function harness(options: { rows?: string; vehicles?: readonly VehicleAudioRow[] } = {}): {
  audio: UnitAudio;
  context: FakeAudioContext;
  pool: VoicePool;
} {
  const context = new FakeAudioContext();
  const pool = new VoicePool(context);
  const absence = new AudioAbsence(vi.fn());
  const table = AudioEventTable.resolve(
    options.rows === undefined
      ? []
      : [{ bank: 0, gain: 1, loop: true, maxDistance: null, name: options.rows, sound: 3 }],
    INDEX,
    absence,
  );
  const vehicles = VehicleVoiceTable.resolve(options.vehicles ?? [CAR], new Map(), new Map(), INDEX, absence);
  const audio = new UnitAudio({
    bufferFor: (): AudioBufferLike => context.createBuffer(1, 12_000, 12_000),
    events: () => table,
    pool,
    vehicles: () => vehicles,
  });

  return { audio, context, pool };
}

function unit(over: Partial<Unit> = {}): Unit {
  return {
    at: [0, 0],
    callsign: '1-ADAM-12',
    elevation: 0,
    heading: 0,
    id: 'u1',
    incident: null,
    kind: 'patrol',
    model: 'copcarla',
    speed: 0,
    status: 'available',
    target: null,
    ...over,
  };
}

describe('UnitAudio', () => {
  describe('negative cases', () => {
    it('voices nothing for a unit whose model this build has no row for', () => {
      const { audio, pool } = harness({ vehicles: [] });

      audio.update([unit()], [0, 0, 0], 0.1);

      expect(pool.report().live).toBe(0);
      expect(audio.report()).toMatchObject({ engines: 0, unvoiced: 1 });
    });

    it('does not spend a voice on a car too far away to be heard', () => {
      const { audio, pool } = harness();

      audio.update([unit({ at: [0, 0] })], [0, 0, AUDIBLE_REACH + 1], 0.1);

      expect(pool.report().live).toBe(0);
      expect(audio.report().engines).toBe(0);
    });

    it('lets a unit go when it leaves the board', () => {
      const { audio, pool } = harness();
      audio.update([unit()], [0, 0, 0], 0.1);
      expect(pool.report().live).toBeGreaterThan(0);

      audio.update([], [0, 0, 0], 0.1);

      expect(audio.report().engines).toBe(0);
    });

    it('runs no siren for a unit that is not on its way', () => {
      const { audio } = harness({ rows: sirenNameFor('patrol') });

      for (const status of ['available', 'busy', 'onScene'] as const) {
        audio.update([unit({ status })], [0, 0, 0], 0.1);
        expect(audio.report().sirens).toBe(0);
      }
    });

    it('runs no siren when the build has no row for that kind', () => {
      // A table naming only the patrol siren says nothing about the fire units on the same board.
      const { audio } = harness({ rows: sirenNameFor('patrol') });

      audio.update([unit({ kind: 'fire', status: 'enRoute' })], [0, 0, 0], 0.1);

      expect(audio.report().sirens).toBe(0);
    });

    it('drops the rev loop for a parked car rather than holding a silent voice', () => {
      const { audio, pool } = harness();

      for (let tick = 0; tick < 10; tick += 1) {
        audio.update([unit({ speed: 0 })], [0, 0, 0], 0.5);
      }

      // Idle only: the engine model zeroes the rev loop once the handover has finished.
      expect(pool.report().live).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('starts both engine loops for a car that is moving', () => {
      const { audio, pool } = harness();

      // The rev loop fades IN, so it is not there on the tick the car starts moving — it arrives during the
      // crossfade, which is the whole point of the engine being two sounds.
      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);
      expect(pool.report().live).toBe(1);

      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.5);

      expect(pool.report().live).toBe(2);
      expect(audio.report().engines).toBe(1);
    });

    it('runs the siren while a unit is on its way, and stops it when it arrives', () => {
      const { audio } = harness({ rows: sirenNameFor('patrol') });

      audio.update([unit({ speed: 20, status: 'enRoute' })], [0, 0, 0], 0.1);
      expect(audio.report().sirens).toBe(1);

      audio.update([unit({ speed: 0, status: 'onScene' })], [0, 0, 0], 0.1);
      expect(audio.report().sirens).toBe(0);
    });

    it('names a siren after the unit kind, which is the whole convention', () => {
      expect(sirenNameFor('patrol')).toBe('VEH_SIREN_PATROL');
      expect(sirenNameFor('ambulance')).toBe('VEH_SIREN_AMBULANCE');
      expect(sirenNameFor('fire')).toBe('VEH_SIREN_FIRE');
    });

    it('pitches the engine up as a car goes faster, on the same voices', () => {
      const { audio, context } = harness();
      // Settled at a cruising speed first, so BOTH loops are already running and a new source afterwards
      // would mean something was restarted rather than pitched.
      for (let tick = 0; tick < 4; tick += 1) {
        audio.update([unit({ speed: 20 })], [0, 0, 0], 0.5);
      }
      const started = context.sources.length;
      const slow = context.sources.map((source) => source.playbackRate.value);

      for (let tick = 0; tick < 10; tick += 1) {
        audio.update([unit({ speed: 40 })], [0, 0, 0], 0.5);
      }
      const fast = context.sources.map((source) => source.playbackRate.value);

      // The SAME sources — a pitched loop, not a different sample picked per speed.
      expect(context.sources).toHaveLength(started);
      expect(Math.max(...fast)).toBeGreaterThan(Math.max(...slow));
    });

    it('keeps a voice while the car stays audible rather than restarting it every tick', () => {
      const { audio, pool } = harness();

      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);
      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.5);
      const started = pool.report().started;

      audio.update([unit({ at: [5, 5], speed: 20 })], [0, 0, 0], 0.1);
      audio.update([unit({ at: [9, 9], speed: 20 })], [0, 0, 0], 0.1);

      expect(pool.report().started).toBe(started);
    });

    it('reaches exactly as far as the falloff still distinguishes', () => {
      // Not a picked number: past `maxDistance` the inverse model clamps, so one more metre changes nothing
      // a listener could hear.
      expect(AUDIBLE_REACH).toBe(300);
    });
  });
});
