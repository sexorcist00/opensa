import { describe, expect, it } from 'vitest';

import type { PanelSurface } from './cad-link';

import { ASSUMED_SOUND, CadLink, cadSound } from './cad-link';

/** A surface that records what it was asked to play. */
function surface(): PanelSurface & { readonly played: string[] } {
  const played: string[] = [];

  return {
    event: (name: string) => {
      played.push(name);
    },
    played,
  };
}

describe('cadSound', () => {
  describe('negative cases', () => {
    it('falls back to notification for a message that names no sound', () => {
      expect(cadSound({ title: 'Assistance Request' })).toEqual({ assumed: true, name: ASSUMED_SOUND });
    });

    it('treats an empty or blank field as absent rather than as a name nothing knows', () => {
      // A CAD that sends `""` has not adopted the field; reporting that as an unknown NAME would put a
      // wiring problem in the vocabulary column, where nobody would look for it.
      expect(cadSound({ sound: '', title: 'x' }).assumed).toBe(true);
      expect(cadSound({ sound: '   ', title: 'x' }).assumed).toBe(true);
    });

    it('never reads the title — the whole point of the field', () => {
      // PCAD picks its sound today by searching this exact string. A console that did the same would make
      // rewording a notification a silent way to lose its sound.
      expect(cadSound({ title: 'Assistance Request' }).name).toBe(ASSUMED_SOUND);
    });
  });

  describe('positive cases', () => {
    it('plays the name the message carries', () => {
      expect(cadSound({ sound: 'panic_button', title: 'Panic Button' })).toEqual({
        assumed: false,
        name: 'panic_button',
      });
    });
  });
});

describe('CadLink', () => {
  describe('negative cases', () => {
    it('says nothing the first time it learns the link is up', () => {
      const panel = surface();
      const link = new CadLink(panel);

      link.setOnline(true);

      expect(panel.played).toEqual([]);
      expect(link.report().online).toBe(true);
    });

    it('says nothing when a console that never had a CAD learns it has none', () => {
      const panel = surface();
      const link = new CadLink(panel);

      link.setOnline(false);

      expect(panel.played).toEqual([]);
    });

    it('does not repeat itself while the state holds', () => {
      const panel = surface();
      const link = new CadLink(panel);
      link.setOnline(true);

      link.setOnline(false);
      link.setOnline(false);
      link.setOnline(false);

      expect(panel.played).toEqual(['link_lost']);
    });
  });

  describe('positive cases', () => {
    it('counts a message that named no sound, so an old CAD is visible in a capture', () => {
      const panel = surface();
      const link = new CadLink(panel);

      link.deliver({ sound: 'panic_button', title: 'Panic Button' });
      link.deliver({ title: 'Assistance Request' });

      expect(panel.played).toEqual(['panic_button', ASSUMED_SOUND]);
      expect(link.report()).toEqual({ assumed: 1, delivered: 2, online: null });
    });

    it('sounds the drop and the recovery', () => {
      const panel = surface();
      const link = new CadLink(panel);
      link.setOnline(true);

      link.setOnline(false);
      link.setOnline(true);

      expect(panel.played).toEqual(['link_lost', 'link_back']);
    });
  });
});
