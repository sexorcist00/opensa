import { describe, expect, it } from 'vitest';

import { cabinVertices } from './cabin';

/**
 * A toy car, model space with z up: two glass vertices marking a greenhouse from y −1…1, x −1…1, up to
 * z 1.2, and then one candidate vertex per case. The hubs sit at z −0.3.
 */
const GLASS: [number, number, number][] = [
  [-1, 1, 1.2],
  [1, -1, 0.6],
];
const HUB = -0.3;

function cabinOf(
  rows: readonly { glass?: boolean; position: [number, number, number]; sky: number }[],
  excludedIndex: null | number = null,
): number[] {
  const { excluded, glass, occlusion, positions } = model(rows, excludedIndex);

  return [...cabinVertices(positions, occlusion, glass, HUB, excluded)].slice(GLASS.length);
}

/** Build the three buffers `cabinVertices` reads from a list of [position, sky 0..1, glass?] rows. */
function model(
  rows: readonly { glass?: boolean; position: [number, number, number]; sky: number }[],
  excludedIndex: null | number = null,
): { excluded: Uint8Array; glass: Uint8Array; occlusion: Uint8Array; positions: number[] } {
  const all = [
    ...GLASS.map((position) => ({ glass: true, position, sky: 0.95 })),
    ...rows.map((row) => ({ glass: false, ...row })),
  ];
  const excluded = new Uint8Array(all.length);
  if (excludedIndex !== null) {
    excluded[GLASS.length + excludedIndex] = 1;
  }

  return {
    excluded,
    glass: Uint8Array.from(all, (row) => (row.glass ? 1 : 0)),
    occlusion: Uint8Array.from(all, (row) => Math.round(row.sky * 255)),
    positions: all.flatMap((row) => row.position),
  };
}

describe('cabinVertices', () => {
  describe('negative cases', () => {
    it('finds no cabin in a model with no glass at all (a bike, an open boat)', () => {
      const inside: [number, number, number] = [0, 0, 0.2];
      const positions = [...inside];
      const cabin = cabinVertices(positions, Uint8Array.of(120), Uint8Array.of(0), HUB, Uint8Array.of(0));

      expect([...cabin]).toEqual([0]);
    });

    it('leaves the SHELL around the cabin alone — a roof skin shares the volume but sees the sky', () => {
      // The one clause that separates an interior from the panel enclosing it: measured on the previon,
      // cabin vertices sit at 0.32-0.69 and the skins at 0.90-1.00.
      expect(cabinOf([{ position: [0, 0, 1.1], sky: 0.95 }])).toEqual([0]);
    });

    it('leaves everything BELOW the wheel hubs alone — underbody, wheel well and engine bay are enclosed too', () => {
      expect(cabinOf([{ position: [0, 0, -0.6], sky: 0.4 }])).toEqual([0]);
    });

    it('leaves what stands OUTSIDE the greenhouse alone — the engine bay ahead of the windscreen', () => {
      expect(cabinOf([{ position: [0, 1.9, 0.2], sky: 0.4 }])).toEqual([0]);
    });

    it('never claims a vertex the builder excluded (a wheel top stands inside the volume)', () => {
      expect(cabinOf([{ position: [0.9, -0.9, 0.1], sky: 0.4 }], 0)).toEqual([0]);
    });

    it('never claims the GLASS itself', () => {
      expect(cabinOf([{ glass: true, position: [0, 0, 0.2], sky: 0.4 }])).toEqual([0]);
    });
  });

  describe('positive cases', () => {
    it('claims an enclosed vertex inside the greenhouse and above the hubs (a dashboard)', () => {
      expect(cabinOf([{ position: [0, 0.5, 0.2], sky: 0.45 }])).toEqual([1]);
    });

    it('claims a dim cabin corner and the seat beside it in one pass', () => {
      expect(
        cabinOf([
          { position: [-0.6, -0.4, 0.0], sky: 0.32 },
          { position: [0.6, -0.4, 0.4], sky: 0.7 },
        ]),
      ).toEqual([1, 1]);
    });
  });
});
