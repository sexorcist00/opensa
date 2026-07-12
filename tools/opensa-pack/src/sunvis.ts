/**
 * Baked sun visibility — SCALAR v1 (plan 074/07, spec 066/03 v1): per HD/LOD vertex, the elevation-weighted
 * average visibility over the day arc. Kills the double-lit direct term where the sun rarely/never reaches
 * (under bridges, canyons); the shadow does NOT track the moving sun.
 *
 * v2 DIRECTIONAL (threshold elevation + penumbra, smoothstep at the current elevation) was built and
 * field-REVERTED 2026-07-12: per-vertex receivers on SA's metre-sparse meshes lose narrow-occluder shadows
 * entirely (bridges "fall between" road verts), punch hole-shaped artifacts and darken LODs. It returns
 * when the converter can SUBDIVIDE large receiver polys (pmb-grade task) — full design in plan 07.
 *
 * The arc converges to zenith as the sun climbs (mirrored by the lab drivers — change one, change both).
 */
import type { Bvh } from './bvh';

import { quantKey } from './ao';
import { occluded } from './bvh';
import { WELD_ROW, WELD_SUNSOFT, WELD_SUNVIS, type WeldedCell } from './weld';

export interface BakeSunVisOptions {
  /** Sun-disc jitter half-width applied to the elevation (penumbra sampling). */
  discJitter?: number;
  /** Sun-ray reach: occluders farther than this cast no baked shadow. */
  maxDistance?: number;
}

export interface BakeSunVisReport {
  rays: number;
  uniqueVertices: number;
  vertices: number;
}

/** Ascending day-arc elevations sampled for the threshold scan (azimuth fixed — mirrors the lab drivers). */
const ARC_ELEVATIONS = [0.13, 0.25, 0.38, 0.5, 0.63, 0.75, 0.88, 1];
const ARC_AZIMUTH_X = 0.35;
const ARC_AZIMUTH_Z = 0.25;

const RAY_OFFSET = 0.08; // same surface push-off as the AO bake
const LOD_RAY_OFFSET = 1.0; // LOD verts sit near-but-not-on the HD surfaces — push well clear of them
/** LOD visibility floor: LOD meshes self-shadow noisily against the HD BVH — cap the damage (field). */
const LOD_VIS_FLOOR = 0.4;

interface ArcSample {
  /** Jittered unit directions (the sun disc pair), 3 floats each. */
  dirs: Float32Array;
  /** The elevation parameter this sample represents. */
  elevation: number;
  /** Base unit direction (the N·L facing test). */
  x: number;
  y: number;
  z: number;
}

/** 1 at the horizon → 0.25 at noon: the sun pitches toward the zenith as it climbs. */
export function azimuthScale(elevation: number): number {
  return 1 - 0.75 * Math.max(0, Math.min(1, elevation));
}

/** Mutates the HD cells' scratch rows in place; returns the bake counters for the report. */
export function bakeSunVis(cells: WeldedCell[], bvh: Bvh, options: BakeSunVisOptions = {}): BakeSunVisReport {
  const maxDistance = options.maxDistance ?? 400;
  const discJitter = options.discJitter ?? 0.03;
  const arc = buildArc(discJitter);
  const cache = new Map<string, number>();
  const report: BakeSunVisReport = { rays: 0, uniqueVertices: 0, vertices: 0 };

  for (const cell of cells) {
    // LOD cells bake TOO (field fix: unbaked LOD = visible HD/LOD shadow seams — "sidewalk shadowed, road
    // not"). Their verts sit NEAR but not ON the HD surfaces, so the ray origin pushes off much further.
    const offset = cell.lod ? LOD_RAY_OFFSET : RAY_OFFSET;
    for (const bucket of cell.buckets) {
      const rows = bucket.vertices;
      for (let row = 0; row < rows.length; row += WELD_ROW) {
        const wx = rows[row] + cell.origin[0];
        const wy = rows[row + 1] + cell.origin[1];
        const wz = rows[row + 2] + cell.origin[2];
        const key = quantKey(wx, wy, wz, rows[row + 3], rows[row + 4], rows[row + 5]);
        let visibility = cache.get(key);
        if (visibility === undefined) {
          const scan = arcVisibility(
            bvh,
            wx,
            wy,
            wz,
            rows[row + 3],
            rows[row + 4],
            rows[row + 5],
            arc,
            maxDistance,
            offset,
          );
          visibility = scan.visibility;
          cache.set(key, visibility);
          report.uniqueVertices += 1;
          report.rays += scan.rays;
        }
        rows[row + WELD_SUNVIS] = cell.lod ? Math.max(visibility, LOD_VIS_FLOOR) : visibility;
        rows[row + WELD_SUNSOFT] = 0.05; // unused by the scalar consumer (kept for the parked v2)
        report.vertices += 1;
      }
    }
    cell.hasSunVis = true;
  }

  return report;
}

/** Elevation-weighted average visibility over the arc (the v1 scalar — the accepted look). */
function arcVisibility(
  bvh: Bvh,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  arc: ArcSample[],
  maxDistance: number,
  rayOffset: number,
): { rays: number; visibility: number } {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const ox = x + (nx / nLen) * rayOffset;
  const oy = y + (ny / nLen) * rayOffset;
  const oz = z + (nz / nLen) * rayOffset;

  let rays = 0;
  let visibleWeight = 0;
  let totalWeight = 0;
  for (const sample of arc) {
    // The sun behind the face contributes nothing at runtime (N·L clamps) — skip its rays entirely.
    if (nx * sample.x + ny * sample.y + nz * sample.z <= 0) {
      continue;
    }
    totalWeight += sample.elevation;
    let visible = 0;
    for (let jitter = 0; jitter < 2; jitter += 1) {
      rays += 1;
      if (
        !occluded(
          bvh,
          ox,
          oy,
          oz,
          sample.dirs[jitter * 3],
          sample.dirs[jitter * 3 + 1],
          sample.dirs[jitter * 3 + 2],
          maxDistance,
        )
      ) {
        visible += 1;
      }
    }
    visibleWeight += sample.elevation * (visible / 2);
  }

  // The sun never faces this vertex → the direct term is already zero; keep the byte neutral.
  return { rays, visibility: totalWeight === 0 ? 1 : visibleWeight / totalWeight };
}

function buildArc(discJitter: number): ArcSample[] {
  return ARC_ELEVATIONS.map((elevation) => {
    // Azimuth CONVERGES to zenith as the sun climbs (field fix: with a fixed azimuth the noon sun sits
    // ~19° off vertical and bridge shadows land BESIDE the bridge). Mirrored in the lab drivers.
    const s = azimuthScale(elevation);
    const base = normalize(ARC_AZIMUTH_X * s, elevation, ARC_AZIMUTH_Z * s);
    const low = normalize(ARC_AZIMUTH_X * s, elevation - discJitter, ARC_AZIMUTH_Z * s);
    const high = normalize(ARC_AZIMUTH_X * s, elevation + discJitter, ARC_AZIMUTH_Z * s);

    return {
      dirs: new Float32Array([...low, ...high]),
      elevation,
      x: base[0],
      y: base[1],
      z: base[2],
    };
  });
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;

  return [x / length, y / length, z / length];
}
