import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { vehiclePathNodes } from './paths';

const NODES0 = 'game-src/non-modified/data/Paths/NODES0.DAT';

/** One synthetic area file: `vehicleNodes` vehicle nodes (28 B), no ped/navi nodes, then the link table. */
function areaFile(
  nodes: { boats?: boolean; linkTo?: [number, number]; position: [number, number, number] }[],
  area = 0,
): ArrayBuffer {
  const links: [number, number][] = [];
  const buffer = new ArrayBuffer(20 + nodes.length * 28 + nodes.length * 4);
  const view = new DataView(buffer);
  view.setUint32(0, nodes.length, true);
  view.setUint32(4, nodes.length, true);
  nodes.forEach((node, index) => {
    const at = 20 + index * 28;
    view.setInt16(at + 8, node.position[0] * 8, true);
    view.setInt16(at + 10, node.position[1] * 8, true);
    view.setInt16(at + 12, node.position[2] * 8, true);
    view.setUint16(at + 16, links.length, true); // baseLink
    view.setUint16(at + 18, area, true);
    view.setUint16(at + 20, index, true);
    const linkCount = node.linkTo ? 1 : 0;
    view.setUint32(at + 24, linkCount | (node.boats ? 0x80 : 0), true);
    if (node.linkTo) {
      links.push(node.linkTo);
    }
  });
  view.setUint32(16, links.length, true);
  links.forEach((link, index) => {
    const at = 20 + nodes.length * 28 + index * 4;
    view.setUint16(at, link[0], true);
    view.setUint16(at + 2, link[1], true);
  });

  return buffer;
}

describe('vehiclePathNodes', () => {
  describe('negative cases', () => {
    it('a link into an absent area leaves heading 0 instead of throwing', () => {
      const areas = new Map([[0, areaFile([{ linkTo: [7, 3], position: [10, 10, 1] }])]]);

      expect(vehiclePathNodes(areas)[0].heading).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('decodes positions (÷8 fixed point), the boats flag and link counts', () => {
      const areas = new Map([[0, areaFile([{ position: [100, -200, 4] }, { boats: true, position: [8, 8, 0] }])]]);
      const nodes = vehiclePathNodes(areas);

      expect(nodes[0].position).toEqual([100, -200, 4]);
      expect(nodes[0].boats).toBe(false);
      expect(nodes[1].boats).toBe(true);
    });

    it('heading points toward the first linked node (0 = +Y, GTA convention)', () => {
      const areas = new Map([
        [
          0,
          areaFile([
            { linkTo: [0, 1], position: [0, 0, 0] },
            { position: [0, 10, 0] }, // due north of node 0
          ]),
        ],
      ]);

      expect(vehiclePathNodes(areas)[0].heading).toBeCloseTo(0, 5);
    });
  });
});

describe.skipIf(!existsSync(NODES0))('vehiclePathNodes (real NODES0.DAT)', () => {
  it('parses the pinned profile area 0: plausible coordinates, land nodes present', () => {
    const nodes = vehiclePathNodes(new Map([[0, toArrayBuffer(readFileSync(NODES0))]]));

    expect(nodes.length).toBeGreaterThan(100);
    // Area 0 is the map's south-west corner: every node inside the world bounds.
    for (const node of nodes) {
      expect(Math.abs(node.position[0])).toBeLessThanOrEqual(3000);
      expect(Math.abs(node.position[1])).toBeLessThanOrEqual(3000);
    }
    expect(nodes.some((node) => !node.boats)).toBe(true);
  });
});
