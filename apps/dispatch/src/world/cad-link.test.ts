/* eslint-disable camelcase -- the WIRE's own field names, matching PCAD's payload verbatim. */
import { describe, expect, it } from 'vitest';

import { ASSUMED_SOUND, CadLink, cadSound } from './cad-link';

/** A link with one sink on it, recording what it was asked to raise. */
function linked(): { readonly link: CadLink; readonly played: string[] } {
  const link = new CadLink();
  const played: string[] = [];
  link.listen((name) => {
    played.push(name);
  });

  return { link, played };
}

describe('cadSound', () => {
  describe('negative cases', () => {
    it('falls back to notification for a message that names no sound', () => {
      expect(cadSound({ title: 'Assistance Request' })).toEqual({ assumed: true, name: ASSUMED_SOUND });
    });

    it('treats an empty or blank field as absent rather than as a name nothing knows', () => {
      // A CAD that sends `""` has not adopted the field; reporting that as an unknown NAME would put a
      // wiring problem in the vocabulary column, where nobody would look for it.
      expect(cadSound({ sound_trigger: '', title: 'x' }).assumed).toBe(true);
      expect(cadSound({ sound_trigger: '   ', title: 'x' }).assumed).toBe(true);
    });

    it('never reads the title — the whole point of the field', () => {
      // PCAD picks its sound today by searching this exact string. A console that did the same would make
      // rewording a notification a silent way to lose its sound.
      expect(cadSound({ title: 'Assistance Request' }).name).toBe(ASSUMED_SOUND);
    });
  });

  describe('positive cases', () => {
    it('plays the name the message carries', () => {
      expect(cadSound({ sound_trigger: 'panic_button', title: 'Panic Button' })).toEqual({
        assumed: false,
        name: 'panic_button',
      });
    });
  });
});

describe('CadLink', () => {
  describe('negative cases', () => {
    it('says nothing the first time it learns the link is up', () => {
      const { link, played } = linked();

      link.setOnline(true);

      expect(played).toEqual([]);
      expect(link.report().online).toBe(true);
    });

    it('says nothing when a console that never had a CAD learns it has none', () => {
      const { link, played } = linked();

      link.setOnline(false);

      expect(played).toEqual([]);
    });

    it('does not repeat itself while the state holds', () => {
      const { link, played } = linked();
      link.setOnline(true);

      link.setOnline(false);
      link.setOnline(false);
      link.setOnline(false);

      expect(played).toEqual(['link_lost']);
    });
  });

  describe('positive cases', () => {
    it('carries an event to every other sink when one of them throws, and counts the one that did', () => {
      // The sinks are independent channels and one of them is a speaker. A dead AudioContext may not take
      // the notice off the screen with it — which is DESIGN.md's redundancy rule applied to the wiring.
      const link = new CadLink();
      const drawn: string[] = [];
      link.listen(() => {
        throw new Error('the context is gone');
      });
      link.listen((name) => {
        drawn.push(name);
      });

      link.deliver({ sound_trigger: 'panic_button', title: 'Panic Button' });

      expect(drawn).toEqual(['panic_button']);
      expect(link.report().failed).toBe(1);
    });

    it('counts a message that named no sound, so an old CAD is visible in a capture', () => {
      const { link, played } = linked();

      link.deliver({ sound_trigger: 'panic_button', title: 'Panic Button' });
      link.deliver({ title: 'Assistance Request' });

      expect(played).toEqual(['panic_button', ASSUMED_SOUND]);
      expect(link.report()).toEqual({ assumed: 1, delivered: 2, failed: 0, online: null });
    });

    it('sounds the drop and the recovery', () => {
      const { link, played } = linked();
      link.setOnline(true);

      link.setOnline(false);
      link.setOnline(true);

      expect(played).toEqual(['link_lost', 'link_back']);
    });
  });
});
