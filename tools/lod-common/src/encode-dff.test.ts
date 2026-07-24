import type { Raw2dfxEntry } from '@opensa/rw-codec/dff';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { build2dfxSection, extract2dfxEntries } from '@opensa/rw-codec/dff';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { encodeLodDff } from './encode-dff';

/** A raw 2dfx light entry (type 0): header pos+type+size, then the parser-known 49-byte light payload. */
function lightEntry(): Uint8Array {
  const bytes = new Uint8Array(20 + 49);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, 0, true); // type — light
  view.setUint32(16, 49, true); // data size
  bytes.set([255, 0, 0, 255], 20); // RGBA
  view.setFloat32(24, 300, true); // corona far clip
  view.setFloat32(32, 2, true); // corona size
  bytes.set(new TextEncoder().encode('coronastar'), 45); // 24-char texture field

  return bytes;
}

/** A unit quad (4 verts, 2 tris) split across two texture groups. */
function sampleMesh(): MergedMesh {
  return {
    colors: Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]),
    groups: [
      { indices: Uint32Array.of(0, 1, 2), texture: 'road' },
      { indices: Uint32Array.of(0, 2, 3), texture: 'grass' },
    ],
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/** A mesh of `n` disconnected triangles (3n vertices) in one group — used to exceed the u16 vertex limit. */
function triangleSoup(n: number): MergedMesh {
  const positions = new Float32Array(n * 9);
  const indices = new Uint32Array(n * 3);
  for (let t = 0; t < n; t += 1) {
    positions[t * 9] = t;
    positions[t * 9 + 3] = t + 1;
    positions[t * 9 + 6] = t;
    positions[t * 9 + 7] = 1;
    indices[t * 3] = t * 3;
    indices[t * 3 + 1] = t * 3 + 1;
    indices[t * 3 + 2] = t * 3 + 2;
  }

  return {
    colors: new Uint8Array(n * 12).fill(255),
    groups: [{ indices, texture: 'soup' }],
    normals: new Float32Array(n * 9),
    positions,
    uvs: new Float32Array(n * 6),
  };
}

describe('encodeLodDff', () => {
  describe('positive cases', () => {
    it('splits a mesh exceeding the u16 vertex limit across multiple atomics', () => {
      const n = 30000; // 90 000 verts > 65 535 → must split
      const clump = parseDff(toArrayBuffer(encodeLodDff(triangleSoup(n), 'lod_big')));
      expect(clump.atomics.length).toBeGreaterThan(1);
      expect(clump.geometries.length).toBe(clump.atomics.length);
      expect(clump.geometries.every((g) => g.positions.length / 3 <= 0xffff)).toBe(true);
      const tris = clump.geometries.reduce((s, g) => s + g.triangles.length, 0);
      expect(tris).toBe(n); // single-sided by default — every source triangle once, across all chunks
    });

    it('round-trips through the engine parser, single-sided by default, geometry/materials/prelit intact', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_3_-7')));
      expect(clump.atomics).toHaveLength(1);
      expect(clump.frames).toHaveLength(1);
      expect(clump.frames[0].name).toBe('lod_3_-7');

      const geometry = clump.geometries[0];
      expect(geometry.positions).toHaveLength(12);
      expect(geometry.triangles).toHaveLength(2); // single-sided default — each of the 2 source tris emitted once
      expect(geometry.prelitColors).not.toBeNull();
      expect(geometry.uvLayers[0]).toHaveLength(8);
      expect(geometry.materials.map((m) => m.texture?.name)).toEqual(['road', 'grass']);
    });

    it('assigns each triangle to its texture group via the BinMesh split', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_cell')));
      const materials = clump.geometries[0].triangles.map((t) => t.materialIndex).sort();
      expect(materials).toEqual([0, 1]); // one triangle per group, single-sided
    });

    it('emits geometry two-sided when doubleSided — each source triangle plus its reversed copy', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_cell', { doubleSided: true })));
      expect(clump.geometries[0].triangles).toHaveLength(4); // 2 source tris, both windings
      const tris = clump.geometries[0].triangles.filter((t) => t.materialIndex === 0);
      // source (0,1,2) and its reverse (0,2,1) — same vertices, opposite winding.
      expect(tris.map((t) => [t.a, t.b, t.c])).toEqual([
        [0, 1, 2],
        [0, 2, 1],
      ]);
    });

    it('doubles only the masked faces when groups carry per-face twoSided masks (plan 003, Phase 2)', () => {
      const masked = sampleMesh();
      masked.groups[0].twoSided = Uint8Array.of(1); // road face genuinely two-sided
      masked.groups[1].twoSided = Uint8Array.of(0); // grass face oriented to its one visible side
      // The blanket flag is on (OpenSA target), but the masks override it per face.
      const clump = parseDff(toArrayBuffer(encodeLodDff(masked, 'lod_cell', { doubleSided: true })));

      expect(clump.geometries[0].triangles).toHaveLength(3); // road ×2 windings + grass ×1
      const road = clump.geometries[0].triangles.filter((t) => t.materialIndex === 0);
      expect(road.map((t) => [t.a, t.b, t.c])).toEqual([
        [0, 1, 2],
        [0, 2, 1],
      ]);
    });

    it('carries a transplanted 2dfx light section (round-trips through the engine parser + re-extraction)', () => {
      const effects = build2dfxSection([{ bytes: lightEntry(), position: [1, 2, 3] }]);
      const encoded = encodeLodDff(sampleMesh(), 'lod_cell', { effects: effects! });

      const clump = parseDff(toArrayBuffer(encoded));
      expect(clump.geometries[0].lights).toHaveLength(1);
      expect(clump.geometries[0].lights[0].position).toEqual([1, 2, 3]);
      expect(clump.geometries[0].lights[0].color).toEqual([255, 0, 0, 255]);
      expect(clump.geometries[0].lights[0].coronaTexture).toBe('coronastar');

      // And the raw entries can be lifted back out (the sa-clone transplant path).
      const lifted = extract2dfxEntries(encoded);
      expect(lifted).toHaveLength(1);
      expect(lifted[0].type).toBe(0);
      expect(lifted[0].position).toEqual([1, 2, 3]);
    });

    it('round-trips a group material tint (plan 003, Phase 5)', () => {
      const tinted = sampleMesh();
      tinted.groups[0].color = [64, 128, 255, 200];
      const clump = parseDff(toArrayBuffer(encodeLodDff(tinted, 'lod_cell')));

      expect(clump.geometries[0].materials[0].color).toEqual([64, 128, 255, 200]);
      expect(clump.geometries[0].materials[1].color).toEqual([255, 255, 255, 255]);
    });

    it('writes the night-colour plugin (round-trips) when the mesh carries night colours', () => {
      const night = Uint8Array.from([200, 210, 220, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
      const clump = parseDff(toArrayBuffer(encodeLodDff({ ...sampleMesh(), nightColors: night }, 'lod_3_-7')));
      expect([...(clump.geometries[0].nightColors ?? [])]).toEqual([...night]);
    });

    it('omits the night plugin when the mesh has no night colours', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_3_-7')));
      expect(clump.geometries[0].nightColors).toBeNull();
    });
  });
});

// The hand-written `lightEntry()` above tests the transplant against a payload this file invented. A stock
// chimney carries the real thing: 3 corona entries AND a particle emitter, so it also proves the extractor's
// default — particles (type 1) are deliberately dropped from far LODs, where their emitters never unload.
const CHIMNEY = 'tests/original/dff/particle/refchimny01.dff';

describe.skipIf(!existsSync(CHIMNEY))('encodeLodDff (real 2dfx payload — refchimny01.dff)', () => {
  const source = (): Raw2dfxEntry[] => extract2dfxEntries(new Uint8Array(readFileSync(CHIMNEY)));

  describe('negative cases', () => {
    it("leaves the chimney's PARTICLE emitter behind — only the coronas are transplanted", () => {
      const raw = new Uint8Array(readFileSync(CHIMNEY));

      expect(parseDff(toArrayBuffer(raw)).geometries.some((geometry) => (geometry.particles?.length ?? 0) > 0)).toBe(
        true,
      );
      expect(source().map((entry) => entry.type)).toEqual([0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('carries a stock DFF 2dfx section through byte-for-byte', () => {
      const entries = source();

      const encoded = encodeLodDff(sampleMesh(), 'lod_cell', {
        effects: build2dfxSection(entries.map((entry) => ({ bytes: entry.bytes, position: entry.position })))!,
      });

      const lifted = extract2dfxEntries(encoded);
      expect(lifted).toHaveLength(entries.length);
      lifted.forEach((entry, index) => {
        expect(entry.position).toEqual(entries[index].position);
        expect([...entry.bytes]).toEqual([...entries[index].bytes]); // fields our parser cannot read survive
      });
      // And the engine parser still reads the coronas out of the result.
      expect(parseDff(toArrayBuffer(encoded)).geometries[0].lights).toHaveLength(entries.length);
    });
  });
});
