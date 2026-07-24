/** Probe: the true occupied 250-grid extent of a game dir (feeds PACK_RECTS.full). */
import { OPEN_SCRIPT_IPL, resolveMap } from '../../packages/renderware/src/map/resolve-map';
import { buildWorldGrid } from '../../packages/renderware/src/map/world-grid';
import { openGameDir } from '../../tools/opensa-pack/src/game-fs';

const fs = openGameDir(process.argv[2] ?? 'build/gostown/sa');
const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
const grid = buildWorldGrid(defs, 250);
let x0 = Infinity;
let y0 = Infinity;
let x1 = -Infinity;
let y1 = -Infinity;
for (const cell of grid.values()) {
  x0 = Math.min(x0, cell.cx);
  y0 = Math.min(y0, cell.cy);
  x1 = Math.max(x1, cell.cx);
  y1 = Math.max(y1, cell.cy);
}
console.log(`occupied 250-grid extent: [${x0}, ${y0}, ${x1}, ${y1}] (${grid.size} cells with content)`);
