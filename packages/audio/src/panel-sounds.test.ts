import { describe, expect, it } from 'vitest';

import { PanelSounds, TONE_RATE } from './panel-sounds';
import { FakeAudioContext } from './test/fake-context';
import { PANEL_TONES } from './tones';

describe('PanelSounds', () => {
  describe('negative cases', () => {
    it('has a sound for every name in the vocabulary, with no files at all', () => {
      const sounds = PanelSounds.resolve(new FakeAudioContext());

      // The whole reliability argument in one assertion: a build that shipped nothing still alerts.
      for (const name of Object.keys(PANEL_TONES)) {
        expect(sounds.find(name), name).not.toBeNull();
      }
      expect(sounds.report().tones).toBe(Object.keys(PANEL_TONES).length);
    });

    it('answers null for a name nothing has ever heard of, rather than inventing one', () => {
      const sounds = PanelSounds.resolve(new FakeAudioContext());

      expect(sounds.find('trombone')).toBeNull();
      expect(sounds.sourceOf('trombone')).toBeNull();
    });

    it('is empty and harmless on a surface with no context to build buffers on', () => {
      const sounds = PanelSounds.empty();

      expect(sounds.find('panic_button')).toBeNull();
      expect(sounds.report()).toEqual({ files: 0, tones: 0 });
    });
  });

  describe('positive cases', () => {
    it('prefers an authored file and SAYS which layer answered', () => {
      const context = new FakeAudioContext();
      const file = context.createBuffer(1, 100, 44_100);

      const sounds = PanelSounds.resolve(context, new Map([['panic_button', file]]));

      expect(sounds.find('panic_button')).toBe(file);
      expect(sounds.sourceOf('panic_button')).toBe('file');
      expect(sounds.sourceOf('link_lost')).toBe('tone');
      expect(sounds.report()).toMatchObject({ files: 1 });
    });

    it('serves a bundled file for a name the tone table has not got', () => {
      const context = new FakeAudioContext();
      const file = context.createBuffer(1, 100, 44_100);

      // A deployment may know about an event this build's vocabulary does not.
      const sounds = PanelSounds.resolve(context, new Map([['shift_change', file]]));

      expect(sounds.find('shift_change')).toBe(file);
      expect(sounds.report().files).toBe(1);
    });

    it('builds the tones at a rate a sine actually needs', () => {
      const context = new FakeAudioContext();

      PanelSounds.resolve(context);

      // Far above twice the 1 174 Hz the vocabulary tops out at, and small enough that the whole set is a
      // few hundred kilobytes rather than a few megabytes.
      expect(TONE_RATE).toBeGreaterThan(2 * 1_174);
      expect(context.buffers.every((one) => one.sampleRate === TONE_RATE)).toBe(true);
    });
  });
});
