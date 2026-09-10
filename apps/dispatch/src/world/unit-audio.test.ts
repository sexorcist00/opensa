import type { OsaudioIndex, OsaudioSound } from '@opensa/engine-formats';
import type { VehicleAudioRow } from '@opensa/renderware/parsers/text/vehicle-audio.parser';

import { AudioAbsence, AudioEventTable, VehicleVoiceTable, VoicePool } from '@opensa/audio';
import { FakeAudioContext } from '@opensa/audio/test/fake-context';
import { describe, expect, it, vi } from 'vitest';

import type { Unit } from '../ops/types';
import type { WarmSound } from './unit-audio';

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
function harness(
  options: {
    maxDistance?: number;
    pitchScale?: number;
    rows?: string;
    vehicles?: readonly VehicleAudioRow[];
  } = {},
): {
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
      : [{ bank: 0, gain: 1, loop: true, maxDistance: options.maxDistance ?? null, name: options.rows, sound: 3 }],
    INDEX,
    absence,
  );
  const vehicles = VehicleVoiceTable.resolve(options.vehicles ?? [CAR], new Map(), new Map(), INDEX, absence);
  const audio = new UnitAudio({
    bufferFor: (): WarmSound => ({
      buffer: context.createBuffer(1, 12_000, 12_000),
      pitchScale: options.pitchScale ?? 1,
    }),
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

    it('reaches as far as the SIREN row was authored to, not just as far as an engine', () => {
      // A `VEH_SIREN_PATROL … 900` row means an operator hears it from 900 m; culling at the engine's 300
      // would silence the row with nothing reported.
      const { audio } = harness({ maxDistance: 900, rows: sirenNameFor('patrol') });

      audio.update([unit({ speed: 20, status: 'enRoute' })], [0, 0, AUDIBLE_REACH + 100], 0.1);

      expect(audio.report().sirens).toBe(1);
    });

    it('folds the buffer-floor correction into an engine it pitched itself', () => {
      // The one stock sound below Web Audio's 3 000 Hz floor: its buffer is made at 3 000 and must be played
      // back slower, and a caller that builds its own pitch has to fold that in or it wails half again fast.
      const plain = harness();
      const corrected = harness({ pitchScale: 0.5 });
      plain.audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);
      corrected.audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);

      const one = plain.context.sources[0]?.playbackRate.value ?? 0;
      const half = corrected.context.sources[0]?.playbackRate.value ?? 0;

      expect(half).toBeCloseTo(one * 0.5, 9);
    });

    it('keeps the correction across ticks, so an evicted buffer cannot jump the pitch', () => {
      const { audio, context } = harness({ pitchScale: 0.5 });
      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);
      const started = context.sources[0]?.playbackRate.value ?? 0;

      audio.update([unit({ speed: 20 })], [0, 0, 0], 0.1);

      expect(context.sources[0]?.playbackRate.value).toBeCloseTo(started, 6);
    });

    it('reaches exactly as far as the falloff still distinguishes', () => {
      // Not a picked number: past `maxDistance` the inverse model clamps, so one more metre changes nothing
      // a listener could hear.
      expect(AUDIBLE_REACH).toBe(300);
    });
  });
});
