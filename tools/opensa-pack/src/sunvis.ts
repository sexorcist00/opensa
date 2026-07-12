/**
 * Baked sun visibility, scalar v1 (plan 074/07, spec 066/03): per HD vertex, raycast towards the sun at the
 * day arc's sample elevations and store the elevation-weighted average visibility in the scratch rows
 * (→ `.oscell` normal.w). Kills the double-lit direct term in permanently shadowed places (under bridges,
 * canyons, north faces of courtyards) — the moving-sun directional bake is the 066/03 v2 follow-up.
 *
 * Decisions (v1):
 * - The arc MIRRORS the lab environment drivers: azimuth fixed (0.35, e, 0.25), e = sin((hour−6)/12·π).
 *   Elevations are sampled once per unique value (the parametric arc is symmetric around noon). When the arc
 *   gains real azimuth traversal, this table AND a reconvert must follow.
 * - Each elevation shoots a small jittered pair (sun disc → baked-in penumbra, 066/03 decision 2).
 * - Arc samples facing AWAY from the vertex normal are excluded (they contribute no direct light — N·L
 *   clamps them at runtime); a vertex the sun never faces keeps sunVis = 1 (irrelevant) and costs no rays.
 * - Occluders / HD-only / dedup: same rules as the AO bake (shared BVH + quantKey).
 */
import type { Bvh } from './bvh';

import { quantKey } from './ao';
import { occluded } from './bvh';
import { WELD_ROW, WELD_SUNVIS, type WeldedCell } from './weld';

export interface BakeSunVisOptions {
  /** Sun-disc jitter half-width applied to the elevation (baked penumbra softness). */
  discJitter?: number;
  /** Sun-ray reach: occluders farther than this cast no baked shadow. */
  maxDistance?: number;
}

export interface BakeSunVisReport {
  rays: number;
  uniqueVertices: number;
  vertices: number;
}

/** Unique day-arc elevations (hours 7/8/9/10/12 of e = sin((h−6)/12·π); afternoon mirrors them). */
const ARC_ELEVATIONS = [0.259, 0.5, 0.707, 0.866, 1];
const ARC_AZIMUTH_X = 0.35;
const ARC_AZIMUTH_Z = 0.25;

const RAY_OFFSET = 0.08; // same surface push-off as the AO bake

interface ArcSample {
  /** Jittered unit directions (the sun disc pair), 3 floats each. */
  dirs: Float32Array;
  /** Elevation weight — the high sun dominates the day's light budget. */
  weight: number;
  /** Base unit direction (the N·L facing test). */
  x: number;
  y: number;
  z: number;
}

/** Mutates the HD cells' scratch rows in place; returns the bake counters for the report. */
export function bakeSunVis(cells: WeldedCell[], bvh: Bvh, options: BakeSunVisOptions = {}): BakeSunVisReport {
  const maxDistance = options.maxDistance ?? 400;
  const discJitter = options.discJitter ?? 0.03;
  const arc = buildArc(discJitter);
  const cache = new Map<string, number>();
  const report: BakeSunVisReport = { rays: 0, uniqueVertices: 0, vertices: 0 };

  for (const cell of cells) {
    if (cell.lod) {
      continue;
    }
    for (const bucket of cell.buckets) {
      const rows = bucket.vertices;
      for (let row = 0; row < rows.length; row += WELD_ROW) {
        const wx = rows[row] + cell.origin[0];
        const wy = rows[row + 1] + cell.origin[1];
        const wz = rows[row + 2] + cell.origin[2];
        const key = quantKey(wx, wy, wz, rows[row + 3], rows[row + 4], rows[row + 5]);
        let sunVis = cache.get(key);
        if (sunVis === undefined) {
          const result = arcVisibility(bvh, wx, wy, wz, rows[row + 3], rows[row + 4], rows[row + 5], arc, maxDistance);
          sunVis = result.sunVis;
          cache.set(key, sunVis);
          report.uniqueVertices += 1;
          report.rays += result.rays;
        }
        rows[row + WELD_SUNVIS] = sunVis;
        report.vertices += 1;
      }
    }
    cell.hasSunVis = true;
  }

  return report;
}

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
): { rays: number; sunVis: number } {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const ox = x + (nx / nLen) * RAY_OFFSET;
  const oy = y + (ny / nLen) * RAY_OFFSET;
  const oz = z + (nz / nLen) * RAY_OFFSET;

  let rays = 0;
  let visibleWeight = 0;
  let totalWeight = 0;
  for (const sample of arc) {
    // The sun behind the face contributes nothing at runtime (N·L clamps) — skip its rays entirely.
    if (nx * sample.x + ny * sample.y + nz * sample.z <= 0) {
      continue;
    }
    totalWeight += sample.weight;
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
    visibleWeight += sample.weight * (visible / 2);
  }

  // The sun never faces this vertex → the direct term is already zero; keep the byte neutral.
  return { rays, sunVis: totalWeight === 0 ? 1 : visibleWeight / totalWeight };
}

function buildArc(discJitter: number): ArcSample[] {
  return ARC_ELEVATIONS.map((elevation) => {
    const base = normalize(ARC_AZIMUTH_X, elevation, ARC_AZIMUTH_Z);
    const low = normalize(ARC_AZIMUTH_X, elevation - discJitter, ARC_AZIMUTH_Z);
    const high = normalize(ARC_AZIMUTH_X, elevation + discJitter, ARC_AZIMUTH_Z);

    return {
      dirs: new Float32Array([...low, ...high]),
      weight: elevation,
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
