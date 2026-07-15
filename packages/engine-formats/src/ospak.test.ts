import { describe, expect, it } from 'vitest';

import { buildOspak, OSPAK_ALIGN, type OspakInput, validateOspakManifest } from './ospak';

function inputs(): OspakInput[] {
  return [
    { bytes: new Uint8Array([1, 2, 3]), key: '54,-32,hd', kind: 'cell' },
    { bytes: new Uint8Array(5000).fill(9), key: '54,-32,lod', kind: 'cell' },
    {
      bytes: new Uint8Array([7, 7]),
      key: 'array-0',
      kind: 'texture',
      meta: { format: 1, height: 256, layers: 12, width: 256 },
    },
  ];
}

describe('ospak', () => {
  describe('negative cases', () => {
    it('throws on duplicate keys', () => {
      const doubled = [...inputs(), { bytes: new Uint8Array([4]), key: '54,-32,hd', kind: 'cell' as const }];

      expect(() => buildOspak(doubled)).toThrow(/duplicate cell key/);
    });

    it('throws on a texture entry without meta', () => {
      expect(() => buildOspak([{ bytes: new Uint8Array([1]), key: 'array-1', kind: 'texture' }])).toThrow(
        /missing meta/,
      );
    });

    it('validate rejects a version mismatch and an overrunning range', () => {
      const { manifest } = buildOspak(inputs());

      expect(() => validateOspakManifest({ ...manifest, version: 99 })).toThrow(/unsupported/);
      const broken = structuredClone(manifest);
      broken.cells['54,-32,hd'] = { ...broken.cells['54,-32,hd'], length: broken.byteLength + 1 };
      expect(() => validateOspakManifest(broken)).toThrow(/overruns/);
    });
  });

  describe('positive cases', () => {
    it('aligns every entry to 4 KiB and preserves payload bytes at the recorded offsets', () => {
      const { manifest, pak } = buildOspak(inputs());

      validateOspakManifest(manifest);
      for (const entry of [...Object.values(manifest.cells), ...Object.values(manifest.textures)]) {
        expect(entry.offset % OSPAK_ALIGN).toBe(0);
      }
      const hd = manifest.cells['54,-32,hd'];
      expect([...pak.subarray(hd.offset, hd.offset + hd.length)]).toEqual([1, 2, 3]);
      const lod = manifest.cells['54,-32,lod'];
      expect(pak[lod.offset]).toBe(9);
      expect(lod.length).toBe(5000);
    });

    it('is deterministic regardless of input order (sorted by key)', () => {
      const a = buildOspak(inputs());
      const b = buildOspak([...inputs()].reverse());

      expect([...a.pak]).toEqual([...b.pak]);
      expect(a.manifest).toEqual(b.manifest);
    });

    it('carries texture meta into the manifest for the scheduler', () => {
      const { manifest } = buildOspak(inputs());

      expect(manifest.textures['array-0']).toMatchObject({ format: 1, height: 256, layers: 12, width: 256 });
    });

    it('carries UV-scroll animations into the manifest, and omits the key when there are none (B7·c)', () => {
      const animations = [{ duration: 3, keyframes: [{ time: 0, uv: [0, 1, 1, 0, 0, 0] }], name: 'DolSign' }];

      expect(buildOspak(inputs(), { uvAnimations: animations }).manifest.uvAnimations).toEqual(animations);
      expect(buildOspak(inputs(), { uvAnimations: [] }).manifest).not.toHaveProperty('uvAnimations');
      expect(buildOspak(inputs()).manifest).not.toHaveProperty('uvAnimations');
    });
  });
});
