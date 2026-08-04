import type { OspakManifest } from '@opensa/engine-formats';

import { OstexFormat } from '@opensa/engine-formats';
import { describe, expect, it } from 'vitest';

import { requireWorldSupport } from './setup';

/** A device exposing only what the gate asks of it. */
function deviceWith(...features: string[]): { features: { has(name: string): boolean } } {
  const set = new Set(features);

  return { features: { has: (name: string): boolean => set.has(name) } };
}

/** A manifest carrying one texture array in `format` — the only field the world gate reads. */
function manifestWith(format: number): OspakManifest {
  return {
    byteLength: 4096,
    cells: {},
    cellSize: 250,
    textures: { 'array-0': { format, hash: 0, height: 256, layers: 4, length: 8, offset: 0, width: 256 } },
    version: 1,
  };
}

describe('requireWorldSupport', () => {
  describe('negative cases', () => {
    it('rejects a BC world on a mobile GPU, naming the missing feature', () => {
      expect(() => requireWorldSupport(deviceWith('texture-compression-astc'), manifestWith(OstexFormat.BC3))).toThrow(
        /texture-compression-bc/,
      );
    });

    it('says the format was decided at build time, so the message points at the pak', () => {
      expect(() => requireWorldSupport(deviceWith(), manifestWith(OstexFormat.BC1))).toThrow(/opensa-pack --rgba8/);
    });
  });

  describe('positive cases', () => {
    it('passes a BC world on a desktop GPU', () => {
      expect(() =>
        requireWorldSupport(deviceWith('texture-compression-bc'), manifestWith(OstexFormat.BC3)),
      ).not.toThrow();
    });

    it('passes an RGBA8 world on a GPU with no compressed formats at all', () => {
      expect(() => requireWorldSupport(deviceWith(), manifestWith(OstexFormat.RGBA8))).not.toThrow();
    });
  });
});
