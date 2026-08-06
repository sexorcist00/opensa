import { renderHeader } from '@opensa/asi-sdk/render';
import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { describe, expect, it } from 'vitest';

import { CATALOGUE } from './catalogue';

describe('perfect-map catalogue', () => {
  describe('positive cases', () => {
    it('pins the shared fingerprint to the one accepted exe', () => {
      expect(SA_FINGERPRINT.exeSize).toBe(14383616);
      expect(SA_FINGERPRINT.sha1).toBe('8c23ceffafa9fd88ea567be7926a33413b8e3c00');
    });

    it('renders the real catalogue with one anchor per site', () => {
      const hpp = renderHeader(CATALOGUE, SA_FINGERPRINT, { namespace: 'pm' });
      const siteCount = CATALOGUE.reduce((sum, entry) => sum + entry.sites.length, 0);

      expect(hpp).toContain(`inline constexpr uint32_t kPatchSiteCount = ${siteCount}u;`);
      expect(hpp).toContain('{0x66, 0x8b, 0x43, 0x2a}'); // LoadIplBoundingBox.staticIdx
      expect(hpp).toContain('namespace pm::gen {');
    });

    it('names a gta-reversed-modern source in every provenance line', () => {
      for (const entry of CATALOGUE) {
        expect(entry.provenance).toMatch(/gta-reversed-modern source\/game_sa\//);
      }
    });
  });
});
