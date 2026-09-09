import type { AudioClockHost, AudioListener } from '@opensa/audio';

import { describe, expect, it, vi } from 'vitest';

import { audioArm, DispatchAudio } from './audio';

/** Timers a test drives by hand. */
function clockHost(): AudioClockHost & { fire(): void } {
  let scheduled: (() => void) | null = null;

  return {
    cancel: () => {
      scheduled = null;
    },
    fire: () => scheduled?.(),
    now: () => 0,
    schedule: (callback) => {
      scheduled = callback;

      return 1;
    },
  };
}

const EAR: AudioListener = { forward: [0, 1, 0], position: [0, 0, 900], right: [1, 0, 0] };

describe('audioArm', () => {
  describe('negative cases', () => {
    it('treats anything but the exact string 0 as ON — a typo may not silently measure a silent run', () => {
      for (const value of ['', '1', 'off', 'false', '00', 'no']) {
        expect(audioArm(new URLSearchParams(`audio=${value}`))).toBe('on');
      }
    });
  });

  describe('positive cases', () => {
    it('loads an index, resolves the event rows against it, and says how many survived', () => {
      const audio = new DispatchAudio(new URLSearchParams(), { clockHost: clockHost(), log: vi.fn() });

      audio.load({
        gameDir: '/game',
        index: {
          banks: [{ firstSound: 0, headerOffset: 0, packageIndex: 0, sizeBytes: 24, soundCount: 1 }],
          packages: ['GENRL'],
          sounds: [
            { byteLength: 24, byteOffset: 0, durationSeconds: 0, headroom: 0, loopOffset: -1, sampleRate: 12_000 },
          ],
          zones: [],
        },
        rows: [
          { bank: 0, gain: 1, loop: false, maxDistance: null, name: 'HORN', sound: 0 },
          { bank: 9, gain: 1, loop: false, maxDistance: null, name: 'GONE', sound: 0 },
        ],
      });

      // One row resolved, one named a bank this build has not got — dropped at LOAD and counted, never at
      // the moment somebody wanted the sound.
      expect(audio.report().events).toBe(1);
      expect(audio.report().absence.names).toBe(1);
    });

    it('plays nothing, and says why, for a build with no index at all', async () => {
      const audio = new DispatchAudio(new URLSearchParams(), { clockHost: clockHost(), log: vi.fn() });
      audio.load({ gameDir: '/game', index: null, rows: [] });

      await expect(audio.play('ANYTHING')).resolves.toBeNull();
      expect(audio.report().absence.noIndex).toBe(true);
    });

    it('is on when absent, and off for `?audio=0`', () => {
      expect(audioArm(new URLSearchParams())).toBe('on');
      expect(audioArm(new URLSearchParams('audio=0'))).toBe('off');
    });
  });
});

describe('DispatchAudio', () => {
  describe('negative cases', () => {
    it('`?audio=0` removes the whole path — no context, no voices, and it SAYS so', () => {
      // The arm removes rather than mutes, the way `?models=0` removes the fleet: a run that still built a
      // context and a pool would measure a silent console instead of a console with no audio.
      const log = vi.fn();

      const audio = new DispatchAudio(new URLSearchParams('audio=0'), { clockHost: clockHost(), log });

      expect(audio.report()).toMatchObject({ arm: 'off', availability: 'unsupported', voices: null });
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('starting the tick on an armed-off run does nothing rather than throwing', () => {
      const host = clockHost();
      const audio = new DispatchAudio(new URLSearchParams('audio=0'), { clockHost: host, log: vi.fn() });

      audio.start(() => EAR);
      host.fire();
      audio.stop();

      expect(audio.report().clock.ticks).toBe(0);
    });

    it('runs without Web Audio at all — a desk browser with it disabled is silence, not a crash', () => {
      const audio = new DispatchAudio(new URLSearchParams(), { clockHost: clockHost(), log: vi.fn() });

      expect(audio.report().availability).toBe('unsupported');
      expect(audio.report().arm).toBe('on');
    });
  });

  describe('positive cases', () => {
    it('reports the arm, the availability, the clock and the absences a capture is read for', () => {
      const audio = new DispatchAudio(new URLSearchParams(), { clockHost: clockHost(), log: vi.fn() });

      expect(audio.report()).toEqual({
        absence: { names: 0, noIndex: false, noSource: false, packages: 0, reasons: [], sounds: 0 },
        arm: 'on',
        availability: 'unsupported',
        buffers: { bytes: 0, ceilingBytes: 67_108_864, entries: 0, evictions: 0, hits: 0, misses: 0, refused: 0 },
        clock: { maxMs: 0, meanMs: 0, rateHz: 10, ticks: 0 },
        events: 0,
        resumesRefused: 0,
        voices: null,
        volume: 1,
      });
    });

    it('hands the gesture wiring back so a remount can take it off again', () => {
      const audio = new DispatchAudio(new URLSearchParams(), { clockHost: clockHost(), log: vi.fn() });
      const listeners: string[] = [];

      const detach = audio.attach({
        addEventListener: (type) => listeners.push(type),
        removeEventListener: (type) => listeners.splice(listeners.indexOf(type), 1),
      });
      detach();

      expect(listeners).toEqual([]);
    });
  });
});
