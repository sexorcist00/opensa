import { describe, expect, it, vi } from 'vitest';

import { AudioAbsence } from './absence';

describe('AudioAbsence', () => {
  describe('negative cases', () => {
    it('says each distinct thing ONCE, however often it is asked', () => {
      // A missing footstep asked for sixty times a second would otherwise fill a console with one fact.
      const log = vi.fn();
      const absence = new AudioAbsence(log);

      for (let at = 0; at < 100; at += 1) {
        absence.unknownName('FOOT_GRAVEL');
        absence.missingSound(7);
        absence.missingPackage('SCRIPT');
        absence.indexAbsent();
        absence.sourceAbsent();
      }

      expect(log).toHaveBeenCalledTimes(5);
      expect(absence.report()).toMatchObject({ names: 1, noIndex: true, noSource: true, packages: 1, sounds: 1 });
    });

    it('caps the LISTED reasons while keeping the counts exact', () => {
      // A total conversion could name thousands; a capture must stay readable and must not lie about how
      // many there were.
      const absence = new AudioAbsence(() => undefined);

      for (let at = 0; at < 100; at += 1) {
        absence.unknownName(`SOUND_${at}`);
      }

      expect(absence.report().names).toBe(100);
      expect(absence.report().reasons).toHaveLength(32);
    });

    it('is not silent-for-a-reason before anything has gone missing', () => {
      expect(new AudioAbsence(() => undefined).silentForAReason).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('tells the four absences apart, because they are four different bugs', () => {
      const absence = new AudioAbsence(() => undefined);

      absence.indexAbsent();

      expect(absence.report()).toMatchObject({ names: 0, noIndex: true, noSource: false, packages: 0, sounds: 0 });
      expect(absence.silentForAReason).toBe(true);
    });

    it('names what was missing, not only how many', () => {
      const absence = new AudioAbsence(() => undefined);

      absence.unknownName('SIREN_WAIL');
      absence.missingPackage('GENRL');

      expect(absence.report().reasons).toEqual([
        "[audio] nothing carries a sound named 'SIREN_WAIL'",
        "[audio] package 'GENRL' is not readable — every sound in it is silent",
      ]);
    });

    it('says a build with no index is silent BY CONSTRUCTION — the question a report must answer', () => {
      const log = vi.fn();

      new AudioAbsence(log).indexAbsent();

      expect(log.mock.calls[0]?.[0]).toMatch(/silent by construction, not by fault/u);
    });
  });
});
