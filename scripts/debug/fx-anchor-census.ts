import { decodeOscell } from '@opensa/engine-formats/oscell';
import { decodeOswire, OSWIRE_MAGIC, rebuildOscell } from '@opensa/engine-formats/oswire';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * The 2dfx PARTICLE anchors a built pak carries: how many of each `effects.fxp` system, and — the half a
 * count cannot give you — WHERE to stand to see one. Plan 100's field check spent two rounds failing to frame
 * an emitter it had no coordinate for; this answers "where is the nearest `insects`" in one call.
 *
 * Run: `npx tsx scripts/debug/fx-anchor-census.ts [--pak <dir>] [--level hd|lod] [--system <name>]
 *       [--near <x,y>] [--limit <n>]`
 *
 * Positions are printed in GTA coordinates (the ones `?spawn=`/`?look=` take). The pak stores each anchor in
 * ENGINE space RELATIVE TO ITS CELL ORIGIN — the host adds the origin at load, which is why `Oscell.particles`
 * reads as world-space downstream — so the conversion is `gtaX = ox + lx`, `gtaY = −(oz + lz)`, `gtaZ = ly`,
 * the same one `dump-cell.ts` applies to placements. The self-check below exists because reading them as
 * already-world prints perfectly plausible coordinates for the wrong place on the map.
 *
 * Counting is per LEVEL — since plan 100/03 a LOD bundle carries its cell's anchors too, so summing both
 * levels double-counts the map.
 */
const args = process.argv.slice(2);
const argValue = (flag: string): string | undefined => {
  const at = args.indexOf(flag);

  return at < 0 ? undefined : args[at + 1];
};

const pakDir =
  argValue('--pak') ??
  ['build/original/opensa/pak', 'build/original/opensa-pack', 'build/original/opensa/opensa'].find((dir) =>
    existsSync(dir),
  ) ??
  'build/original/opensa/pak';
const level = argValue('--level') ?? 'hd';
const system = argValue('--system')?.toLowerCase();
const near = argValue('--near')
  ?.split(',')
  .map((value) => Number(value));
const limit = Number(argValue('--limit') ?? 20);

interface PakEntry {
  enc?: string;
  length: number;
  offset: number;
}
const manifest = JSON.parse(readFileSync(join(pakDir, 'manifest.json'), 'utf8')) as {
  cells: Record<string, PakEntry | undefined>;
  cellSize?: number;
};
const cellSize = manifest.cellSize ?? 250;
const pak = readFileSync(join(pakDir, 'world.ospak'));

interface Anchor {
  cell: string;
  name: string;
  x: number;
  y: number;
  z: number;
}
const anchors: Anchor[] = [];
const counts = new Map<string, number>();
let cellsRead = 0;
/** Self-check: an anchor read out of cell `cx,cy` must LAND in that cell, or at most spill a metre or two over
 *  its edge (the cell owns the PLACEMENT, and an emitter can hang off the far side of the model). A wrong
 *  space or a swapped axis puts it kilometres away, so the OVERSHOOT is the number that separates the two —
 *  reading these anchors as already-world scored 934 of 943 outside, at up to 3 km. */
let misplaced = 0;
let worstOvershoot = 0;

for (const [key, entry] of Object.entries(manifest.cells)) {
  if (!entry || !key.endsWith(`,${level}`)) {
    continue;
  }
  let bytes: Uint8Array = pak.subarray(entry.offset, entry.offset + entry.length);
  if (entry.enc === 'deflate-raw' || entry.enc === 'oswire-deflate-raw') {
    bytes = inflateRawSync(bytes);
  }
  if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === OSWIRE_MAGIC) {
    // The particle table travels verbatim in the container head; the geometry payloads stay undecoded.
    const skipDecode = (): void => undefined;
    bytes = rebuildOscell(decodeOswire(bytes), { decodeIndexBuffer: skipDecode, decodeVertexBuffer: skipDecode });
  }
  const cell = decodeOscell(bytes);
  cellsRead += 1;
  const [cx, cy] = key.split(',').map((part) => Number(part));
  const [ox, , oz] = cell.origin;
  for (const particle of cell.particles) {
    const name = particle.effectName.toLowerCase();
    const anchor = {
      cell: key,
      name,
      x: ox + particle.position[0],
      y: -(oz + particle.position[2]),
      z: particle.position[1],
    };
    if (Math.floor(anchor.x / cellSize) !== cx || Math.floor(anchor.y / cellSize) !== cy) {
      misplaced += 1;
      const overshoot = Math.max(
        cx * cellSize - anchor.x,
        anchor.x - (cx + 1) * cellSize,
        cy * cellSize - anchor.y,
        anchor.y - (cy + 1) * cellSize,
      );
      worstOvershoot = Math.max(worstOvershoot, overshoot);
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
    anchors.push(anchor);
  }
}

const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
console.log(`pak ${pakDir} — ${cellsRead} ${level} cells, ${total} anchors across ${counts.size} systems`);
console.log(
  `self-check: ${misplaced} anchors outside their own cell, worst overshoot ${worstOvershoot.toFixed(1)} u ` +
    `(a handful of metres = a model straddling the edge; hundreds = the wrong space)`,
);
for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(20)} ${count}`);
}

if (!system) {
  process.exit(0);
}

let listed = anchors.filter((anchor) => anchor.name === system);
if (near && near.length === 2 && near.every((value) => Number.isFinite(value))) {
  const distance = (anchor: Anchor): number => Math.hypot(anchor.x - near[0], anchor.y - near[1]);
  listed = listed.sort((a, b) => distance(a) - distance(b));
}
console.log(`\n== ${system}: ${listed.length} anchors${near ? `, nearest ${near.join(',')}` : ''} ==`);
for (const anchor of listed.slice(0, limit)) {
  console.log(`  ${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}, ${anchor.z.toFixed(1)}  (cell ${anchor.cell})`);
}
