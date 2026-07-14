import { describe, expect, it } from 'vitest';

import {
  decodeOscell,
  encodeOscell,
  type Oscell,
  OSCELL_VERSION_MAJOR,
  OSCELL_VERTEX_STRIDE,
  OscellChannel,
} from './oscell';

function sampleCell(overrides: Partial<Oscell> = {}): Oscell {
  const vertexCount = 3;
  const vertexData = new Uint8Array(vertexCount * OSCELL_VERTEX_STRIDE);
  // Distinct bytes so round-trip corruption would show.
  for (let index = 0; index < vertexData.length; index += 1) {
    vertexData[index] = index % 251;
  }
  const indexData = new Uint8Array(new Uint32Array([0, 1, 2]).buffer);

  return {
    bounds: [1, 2, 3, 40],
    channelMask: OscellChannel.NIGHT_PRELIT | OscellChannel.SWAY,
    groups: [
      {
        bounds: [1, 2, 3, 10],
        indexCount: 3,
        indexOffset: 0,
        pipelineClass: 1,
        side: 1,
        textureArrayRef: 7,
      },
    ],
    index16: false,
    indexCount: 3,
    indexData,
    lights: [{ color: [255, 200, 100, 255], farClip: 120, position: [10, 20, 30], size: 1.5 }],
    objects: [
      {
        groupCount: 1,
        groupStart: 0,
        kind: 0,
        params: (20 << 8) | 6,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 5],
      },
    ],
    origin: [2500, -1600, 0],
    particles: [
      { effectName: 'ws_factorysmoke', position: [12, 3, -4] },
      { effectName: 'fire', position: [-1, 0, 2] },
    ],
    vertexCount,
    vertexData,
    ...overrides,
  };
}

describe('oscell codec', () => {
  describe('negative cases', () => {
    it('throws when vertexData does not match vertexCount × stride', () => {
      const cell = sampleCell({ vertexData: new Uint8Array(10) });

      expect(() => encodeOscell(cell)).toThrow(/vertexData/);
    });

    it('throws when indexData does not match indexCount and width', () => {
      const cell = sampleCell({ indexData: new Uint8Array(5) });

      expect(() => encodeOscell(cell)).toThrow(/indexData/);
    });

    it('throws on an object transform that is not 3×4', () => {
      const cell = sampleCell();
      cell.objects[0] = { ...cell.objects[0], transform: [1, 2, 3] };

      expect(() => encodeOscell(cell)).toThrow(/12 floats/);
    });

    it('rejects a wrong magic', () => {
      const bytes = encodeOscell(sampleCell());
      bytes[0] = 0x00;

      expect(() => decodeOscell(bytes)).toThrow(/not an .oscell/);
    });

    it('rejects an unknown major version', () => {
      const bytes = encodeOscell(sampleCell());
      new DataView(bytes.buffer, bytes.byteOffset).setUint16(4, OSCELL_VERSION_MAJOR + 1, true);

      expect(() => decodeOscell(bytes)).toThrow(/unsupported .oscell major/);
    });
  });

  describe('positive cases', () => {
    it('round-trips a cell byte-exactly (payloads, groups, objects, lights, particles)', () => {
      const cell = sampleCell();

      const decoded = decodeOscell(encodeOscell(cell));

      expect([...decoded.vertexData]).toEqual([...cell.vertexData]);
      expect([...decoded.indexData]).toEqual([...cell.indexData]);
      expect(decoded.groups).toEqual(cell.groups);
      expect(decoded.objects).toEqual(cell.objects);
      // B6: the 2dfx emitter anchors, names and all (the host resolves the name against effects.fxp).
      expect(decoded.particles).toEqual(cell.particles);
      expect(decoded.lights).toEqual(cell.lights);
      expect(decoded.bounds).toEqual(cell.bounds);
      expect(decoded.origin).toEqual(cell.origin);
      expect(decoded.channelMask).toBe(cell.channelMask);
      expect(decoded.index16).toBe(false);
    });

    it('round-trips a uint16-index cell and preserves the flag', () => {
      const cell = sampleCell({
        index16: true,
        indexData: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
      });

      const decoded = decodeOscell(encodeOscell(cell));

      expect(decoded.index16).toBe(true);
      expect([...new Uint16Array(decoded.indexData.buffer, decoded.indexData.byteOffset, 3)]).toEqual([0, 1, 2]);
    });

    it('encodes deterministically (same input ⇒ identical bytes)', () => {
      const a = encodeOscell(sampleCell());
      const b = encodeOscell(sampleCell());

      expect([...a]).toEqual([...b]);
    });
  });
});
