import { describe, expect, it } from 'vitest';

import { audioKeyFace } from './audio-key';

describe('audioKeyFace', () => {
  describe('negative cases', () => {
    it('says a surface with no Web Audio is unavailable rather than showing a knob that does nothing', () => {
      expect(audioKeyFace('unsupported', 1)).toEqual({
        glyph: '⊘',
        label: 'Sound is not available on this surface',
      });
    });

    it('reads muted as muted whatever the browser state says, and offers full sound back', () => {
      expect(audioKeyFace('running', 0).label).toBe('Muted — press for full sound');
    });
  });

  describe('positive cases', () => {
    it('offers to turn sound ON for every state that is one press away from playing', () => {
      // Waiting for a first touch, or stopped after running — two reasons, one action, and no operator
      // needs two words for it. Apple's `interrupted` (a phone call took the hardware) never reaches this
      // control: the HOST maps it to `suspended`, which is what it is to anyone drawing an indicator.
      for (const state of ['waiting', 'suspended'] as const) {
        expect(audioKeyFace(state, 1)).toEqual({ glyph: '♪', label: 'Turn sound on' });
      }
    });

    it('names the level it is on AND what pressing does — the label is where the meaning lives', () => {
      // A `title` is hover-only and a phone has no hover, so the accessible name carries both halves.
      expect(audioKeyFace('running', 1).label).toBe('Sound: full — press for half');
      expect(audioKeyFace('running', 0.5).label).toBe('Sound: half — press for quiet');
      expect(audioKeyFace('running', 0.2).label).toBe('Sound: quiet — press to mute');
    });

    it('draws every level with a MONOCHROME glyph, like every other key in the cluster', () => {
      const glyphs = [1, 0.5, 0.2, 0].map((volume) => audioKeyFace('running', volume).glyph);

      expect(glyphs).toEqual(['█', '▄', '▁', '⊘']);
      // No emoji: a coloured pictogram would be the one coloured thing on a console whose palette is a
      // decision. Every glyph here is below the emoji range.
      for (const glyph of glyphs) {
        expect((glyph.codePointAt(0) ?? 0) < 0x1_f000).toBe(true);
      }
    });
  });
});
