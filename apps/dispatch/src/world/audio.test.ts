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
        clock: { maxMs: 0, meanMs: 0, rateHz: 10, ticks: 0 },
        resumesRefused: 0,
        voices: null,
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
