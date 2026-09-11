import { PANEL_CATEGORY } from '@opensa/audio';
import { describe, expect, it } from 'vitest';

import { cadArm } from '../world/cad-mock';
import { noticeText } from './panel-notices';

describe('noticeText', () => {
  describe('negative cases', () => {
    it('shows a name it has no sentence for rather than swallowing it', () => {
      // A vocabulary the console has not caught up with is exactly the case an operator should be able to
      // see and report. A blank line would make the newer repository's event indistinguishable from none.
      expect(noticeText('some_event_from_a_newer_pcad')).toBe('some_event_from_a_newer_pcad');
    });
  });

  describe('positive cases', () => {
    it('has words for every event the CAD owns, so no cad event is sound-only', () => {
      // DESIGN.md: any one channel read alone is enough. An event with a tone and no words is an event a
      // muted, deaf or headphone-less dispatcher never receives.
      for (const [name, bus] of Object.entries(PANEL_CATEGORY)) {
        if (bus === 'cad') {
          expect(noticeText(name)).not.toBe(name);
        }
      }
    });
  });
});

describe('the visual path does not depend on the audio path', () => {
  describe('positive cases', () => {
    it('arms the CAD feed independently of the sound', () => {
      // `?audio=0` is the SILENT baseline, and it must still be a console that receives its events — only
      // one that does not voice them. Two arms, read from two parameters, so neither can remove the other.
      expect(cadArm(new URLSearchParams('audio=0'))).toBe('on');
      expect(cadArm(new URLSearchParams('audio=0&cad=0'))).toBe('off');
    });
  });
});
