import { describe, expect, it } from 'vitest';

import { CATALOGUE, type CatalogueEntry, type Fingerprint, FINGERPRINT } from './catalogue';
import { renderHeader } from './generate';

const FP: Fingerprint = {
  anchors: [{ bytes: [0xe9, 0x9b], fileOffset: 0x4090, name: 'a.entry' }],
  exeSize: 14383616,
  sha1: '8c23ceffafa9fd88ea567be7926a33413b8e3c00',
};

const ENTRY: CatalogueEntry = {
  id: 'ipldef-range',
  sites: [{ address: 0x404b20, bytes: [0xa1, 0xb0], name: 'RemoveIpl.entry' }],
  strategy: 'hook',
  summary: 's',
};

describe('renderHeader', () => {
  describe('negative cases', () => {
    it('throws when the fingerprint sha1 is not 40 hex chars', () => {
      expect(() => renderHeader([ENTRY], { ...FP, sha1: 'abc' })).toThrow(/sha1/);
    });

    it('throws when a fingerprint fileOffset is outside the exe', () => {
      expect(() =>
        renderHeader([ENTRY], { ...FP, anchors: [{ bytes: [1], fileOffset: 0x9000000, name: 'x' }] }),
      ).toThrow(/fileOffset/);
    });

    it('throws when a patch-site address is outside the 1.0 US range', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x10, bytes: [1], name: 'x' }] };
      expect(() => renderHeader([bad], FP)).toThrow(/range/);
    });

    it('throws when an anchor has empty bytes', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x404b20, bytes: [], name: 'x' }] };
      expect(() => renderHeader([bad], FP)).toThrow(/empty/);
    });

    it('throws on a byte outside 0..255', () => {
      const bad = { ...ENTRY, sites: [{ address: 0x404b20, bytes: [0x100], name: 'x' }] };
      expect(() => renderHeader([bad], FP)).toThrow(/0\.\.255/);
    });

    it('throws on duplicate catalogue ids', () => {
      expect(() => renderHeader([ENTRY, ENTRY], FP)).toThrow(/duplicate/);
    });
  });

  describe('positive cases', () => {
    it('emits the fingerprint (file anchors) and a site byte array', () => {
      const hpp = renderHeader([ENTRY], FP);

      expect(hpp).toContain('inline constexpr uint32_t kExeSize = 14383616u;');
      expect(hpp).toContain('"8c23ceffafa9fd88ea567be7926a33413b8e3c00"');
      expect(hpp).toContain('struct FileAnchor');
      expect(hpp).toContain('{0xa1, 0xb0}');
      expect(hpp).toContain('inline constexpr uint32_t kFingerprintCount = 1u;');
    });

    it('renders the real catalogue with one anchor per site', () => {
      const hpp = renderHeader(CATALOGUE, FINGERPRINT);
      const siteCount = CATALOGUE.reduce((sum, entry) => sum + entry.sites.length, 0);

      expect(hpp).toContain(`inline constexpr uint32_t kPatchSiteCount = ${siteCount}u;`);
      expect(hpp).toContain('{0x66, 0x8b, 0x43, 0x2a}'); // LoadIplBoundingBox.staticIdx
    });
  });
});
