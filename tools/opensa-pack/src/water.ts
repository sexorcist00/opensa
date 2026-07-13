/**
 * Water bake (074/06 row 12 v2, user directive: water WITHOUT the shadow bakes — no rays, no BVH):
 * tessellate the water.dat polygons (+ the ocean frame) into a ~16 u grid and bake a per-vertex
 * SHORE-DISTANCE field from pure 2D geometry — the shoreline is the set of water-quad boundary edges
 * (edges not shared with a neighbouring quad, map-border edges excluded). The runtime uses the field for
 * Gerstner DISPLACEMENT damping (calm at the beach, swell offshore), the waterwake foam band and the
 * shallow tint. Output = a loose `water.bin` next to the manifest (the clouds convention):
 * [u32 vertexCount][u32 indexCount][f32×4 × V: x,y,z,shoreDist (GTA coords)][u32 × I].
 */
import { parseWater, type WaterQuad } from '@opensa/renderware/parsers/text/water.parser';
import { oceanFrame } from '@opensa/renderware/three/build-water';

/** Manifest section for the loose water mesh. */
export interface WaterManifest {
  file: string;
  indexCount: number;
  vertexCount: number;
}

/** Tessellation cell size (world units) — samples the two displaced (longest) wave trains adequately. */
const GRID = 16;
/** Ocean-frame cell size — far offshore only the long swell matters. */
const FRAME_GRID = 96;
/** Shore distances beyond this clamp to "deep" (the field only matters near the beach). */
const SHORE_CLAMP = 120;
/** Depth field clamp (metres) — anything deeper is just "open sea". */
const DEPTH_CLAMP = 30;
/** Pseudo-depth slope for areas without height data (~15 cm per metre from the quad edge). */
const PSEUDO_DEPTH_SLOPE = 0.15;
/** The SA map half-extent; boundary edges on the outer border are NOT shorelines. */
const MAP_EDGE = 2990;
/** Ocean-frame half extent (matches the runtime oceanFrame the flat v1 used). */
const OCEAN_HALF = 6000;

type Edge = readonly [number, number, number, number];

export function bakeWater(
  datText: string,
  heightAt?: (x: number, y: number) => null | number,
): { bin: Uint8Array; manifest: Omit<WaterManifest, 'file'> } {
  const quads = parseWater(datText);
  const shoreEdges = boundaryEdges(quads);
  const buckets = bucketEdges(shoreEdges);
  const positions: number[] = [];
  const indices: number[] = [];
  // The 4th component is DEPTH in metres (v3): true water−ground where the weld's sea-band height grid
  // has data (the visual waterline = depth 0 — the quad edge hides under the beach, the round-3 lesson);
  // a shore-distance pseudo-depth elsewhere (elevated reservoirs, pre-height paks).
  const fieldAt = (x: number, y: number, waterZ: number): number => {
    const ground = heightAt?.(x, y) ?? null;
    if (ground !== null && ground <= waterZ + 2) {
      return Math.min(DEPTH_CLAMP, Math.max(0, waterZ - ground));
    }

    return Math.min(DEPTH_CLAMP, shoreDistance(x, y, buckets) * PSEUDO_DEPTH_SLOPE);
  };
  for (const quad of quads) {
    tessellate(quad, positions, indices, GRID, fieldAt);
  }
  // The ocean frame lives beyond the map: coarse grid (displacement only needs vertices every few
  // wavelengths) and a constant "deep" field — no shoreline out there.
  for (const quad of oceanFrame(quads, OCEAN_HALF, 0)) {
    tessellate(quad, positions, indices, FRAME_GRID, () => DEPTH_CLAMP);
  }

  const vertexCount = positions.length / 4;
  const bin = new Uint8Array(8 + positions.length * 4 + indices.length * 4);
  const view = new DataView(bin.buffer);
  view.setUint32(0, vertexCount, true);
  view.setUint32(4, indices.length, true);
  new Float32Array(bin.buffer, 8, positions.length).set(positions);
  new Uint32Array(bin.buffer, 8 + positions.length * 4, indices.length).set(indices);

  return { bin, manifest: { indexCount: indices.length, vertexCount } };
}

/** Water-coverage boundary edges (shorelines): quad edges NOT shared with another quad, excluding the
 *  map border. Shared-edge detection keys on rounded endpoint pairs (order-independent). */
function boundaryEdges(quads: readonly WaterQuad[]): Edge[] {
  const counts = new Map<string, { count: number; edge: Edge }>();
  const key = (x: number, y: number): string => `${Math.round(x * 4)},${Math.round(y * 4)}`;
  for (const quad of quads) {
    // Grid-ordered quad corners (v0, +X, +Y, +X+Y): the perimeter is 0→1→3→2; triangles are 0→1→2.
    const order = quad.vertices.length >= 4 ? [0, 1, 3, 2] : [0, 1, 2];
    for (let i = 0; i < order.length; i += 1) {
      const a = quad.vertices[order[i]];
      const b = quad.vertices[order[(i + 1) % order.length]];
      const [ka, kb] = [key(a[0], a[1]), key(b[0], b[1])];
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = counts.get(edgeKey);
      if (entry) {
        entry.count += 1;
      } else {
        counts.set(edgeKey, { count: 1, edge: [a[0], a[1], b[0], b[1]] });
      }
    }
  }

  return [...counts.values()]
    .filter((entry) => entry.count === 1)
    .map((entry) => entry.edge)
    .filter(
      (edge) =>
        !(Math.abs(edge[0]) >= MAP_EDGE && Math.abs(edge[2]) >= MAP_EDGE) &&
        !(Math.abs(edge[1]) >= MAP_EDGE && Math.abs(edge[3]) >= MAP_EDGE),
    );
}

/** Spatial hash of shore edges (SHORE_CLAMP-sized cells) — the distance query only visits nearby edges. */
function bucketEdges(edges: readonly Edge[]): Map<string, Edge[]> {
  const buckets = new Map<string, Edge[]>();
  for (const edge of edges) {
    const minX = Math.floor(Math.min(edge[0], edge[2]) / SHORE_CLAMP);
    const maxX = Math.floor(Math.max(edge[0], edge[2]) / SHORE_CLAMP);
    const minY = Math.floor(Math.min(edge[1], edge[3]) / SHORE_CLAMP);
    const maxY = Math.floor(Math.max(edge[1], edge[3]) / SHORE_CLAMP);
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cy = minY; cy <= maxY; cy += 1) {
        const k = `${cx},${cy}`;
        const bucket = buckets.get(k);
        if (bucket) {
          bucket.push(edge);
        } else {
          buckets.set(k, [edge]);
        }
      }
    }
  }

  return buckets;
}

/** World-lattice split points across [a, b]: the endpoints + every multiple of `step` strictly inside.
 *  Both neighbours of a shared edge produce the same interior points — seams weld by construction. */
function lattice(a: number, b: number, step: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const points: number[] = [lo];
  for (let x = Math.ceil(lo / step) * step; x < hi - 1e-6; x += step) {
    if (x > lo + 1e-6) {
      points.push(x);
    }
  }
  points.push(hi);

  return a <= b ? points : points.reverse();
}

function pointToSegment(x: number, y: number, [ax, ay, bx, by]: Edge): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq > 0 ? Math.min(1, Math.max(0, ((x - ax) * abx + (y - ay) * aby) / lengthSq)) : 0;
  const px = ax + abx * t;
  const py = ay + aby * t;

  return Math.hypot(x - px, y - py);
}

/** Min distance from (x, y) to the shore edges in the 3×3 bucket neighbourhood (SHORE_CLAMP when none). */
function shoreDistance(x: number, y: number, buckets: Map<string, Edge[]>): number {
  const cx = Math.floor(x / SHORE_CLAMP);
  const cy = Math.floor(y / SHORE_CLAMP);
  let best = SHORE_CLAMP;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const edge of buckets.get(`${cx + dx},${cy + dy}`) ?? []) {
        best = Math.min(best, pointToSegment(x, y, edge));
      }
    }
  }

  return best;
}

/** Subdivide one polygon into a GRID-sized mesh with the baked shore field. Quads bilinear-interpolate
 *  (v0, +X, +Y, +X+Y grid order); triangles stay whole (they are tiny shoreline slivers in the data). */
function tessellate(
  quad: WaterQuad,
  positions: number[],
  indices: number[],
  grid: number,
  fieldAt: (x: number, y: number, waterZ: number) => number,
): void {
  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z, fieldAt(x, y, z));

    return positions.length / 4 - 1;
  };
  if (quad.vertices.length < 4) {
    const [a, b, c] = quad.vertices;
    indices.push(push(a[0], a[1], a[2]), push(b[0], b[1], b[2]), push(c[0], c[1], c[2]));

    return;
  }
  const [v0, v1, v2, v3] = quad.vertices; // grid order: v0, +X, +Y, +X+Y
  const lerp = (a: readonly number[], b: readonly number[], t: number): number[] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  // Axis-aligned quads (virtually all of water.dat) split on the GLOBAL world lattice (multiples of
  // `grid`): neighbouring quads then produce IDENTICAL seam vertices — no T-junctions, no cracks when
  // the runtime displaces the surface (the field's "torn sea polygon"). Skewed quads keep the local grid.
  const aligned = v0[1] === v1[1] && v2[1] === v3[1] && v0[0] === v2[0] && v1[0] === v3[0];
  const xs = aligned ? lattice(v0[0], v1[0], grid) : null;
  const ys = aligned ? lattice(v0[1], v2[1], grid) : null;
  const spanX = Math.max(Math.hypot(v1[0] - v0[0], v1[1] - v0[1]), Math.hypot(v3[0] - v2[0], v3[1] - v2[1]));
  const spanY = Math.max(Math.hypot(v2[0] - v0[0], v2[1] - v0[1]), Math.hypot(v3[0] - v1[0], v3[1] - v1[1]));
  const nx = xs ? xs.length - 1 : Math.max(1, Math.min(512, Math.ceil(spanX / grid)));
  const ny = ys ? ys.length - 1 : Math.max(1, Math.min(512, Math.ceil(spanY / grid)));
  const row: number[][] = [];
  for (let iy = 0; iy <= ny; iy += 1) {
    row.push([]);
    for (let ix = 0; ix <= nx; ix += 1) {
      const tx = xs ? (xs[ix] - v0[0]) / Math.max(1e-6, v1[0] - v0[0]) : ix / nx;
      const ty = ys ? (ys[iy] - v0[1]) / Math.max(1e-6, v2[1] - v0[1]) : iy / ny;
      const bottom = lerp(v0, v1, tx);
      const top = lerp(v2, v3, tx);
      const point = lerp(bottom, top, ty);
      row[iy].push(push(point[0], point[1], point[2]));
    }
  }
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = row[iy][ix];
      const b = row[iy][ix + 1];
      const c = row[iy + 1][ix];
      const d = row[iy + 1][ix + 1];
      indices.push(a, b, c, c, b, d);
    }
  }
}
