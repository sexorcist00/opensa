import { describe, expect, it } from 'vitest';

import { MIXES } from '../world/audio';
import { audioKeyFace } from './audio-key';

describe('audioKeyFace', () => {
  describe('negative cases', () => {
    it('says a surface with no Web Audio is unavailable rather than showing a knob that does nothing', () => {
      expect(audioKeyFace('unsupported', 'full')).toEqual({
        glyph: '⊘',
        label: 'Sound is not available on this surface',
      });
    });

    it('reads muted as muted, and SAYS what a mute does not silence', () => {
      // An operator who mutes and is then reached by a panic tone should have been told, once, by the
      // control that did it — a floor is a promise rather than a surprise (204's decision 3.4).
      const label = audioKeyFace('running', 'muted').label;

      expect(label).toContain('Muted');
      expect(label).toContain('panic');
      expect(label).toContain('lost link');
    });
  });

  describe('positive cases', () => {
    it('offers to turn sound ON for every state that is one press away from playing', () => {
      // Waiting for a first touch, or stopped after running — two reasons, one action, and no operator
      // needs two words for it. Apple's `interrupted` (a phone call took the hardware) never reaches this
      // control: the HOST maps it to `suspended`, which is what it is to anyone drawing an indicator.
      for (const state of ['waiting', 'suspended'] as const) {
        expect(audioKeyFace(state, 'full')).toEqual({ glyph: '♪', label: 'Turn sound on' });
      }
    });

    it('names the MIX it is on AND what pressing does — the label is where the meaning lives', () => {
      // A `title` is hover-only and a phone has no hover, so the accessible name carries both halves. And a
      // mix is named for what it is FOR: nobody working a board wants "everything quieter".
      expect(audioKeyFace('running', 'full').label).toBe('Sound: the full mix — press to put the city under the work');
      expect(audioKeyFace('running', 'work').label).toBe('Sound: the city under the work — press for alerts only');
      expect(audioKeyFace('running', 'alerts').label).toBe('Sound: alerts only — press to mute');
    });

    it('draws every level with a MONOCHROME glyph, like every other key in the cluster', () => {
      const glyphs = MIXES.map((mix) => audioKeyFace('running', mix.label).glyph);

      expect(glyphs).toEqual(['█', '▄', '▁', '⊘']);
      // No emoji: a coloured pictogram would be the one coloured thing on a console whose palette is a
      // decision. Every glyph here is below the emoji range.
      for (const glyph of glyphs) {
        expect((glyph.codePointAt(0) ?? 0) < 0x1_f000).toBe(true);
      }
    });
  });
});
