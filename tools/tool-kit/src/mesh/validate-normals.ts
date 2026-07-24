/**
 * Sanity-gate for AUTHORED vertex normals (map-optimizer plan 020): decide, per vertex, whether a stored
 * normal can be trusted — so the optimizer preserves authored intent and recomputes only actual garbage.
 * Pure geometry, no curated lists: a normal fails when it is not unit-ish (zeroed blocks from dirty
 * re-exports, NaN/Inf) or when it disagrees with the winding of its incident faces (points INTO the
 * surface). Vertices whose incident faces cancel to ~zero (SA's two-sided coplanar pairs) or that have no
 * faces at all carry no geometric evidence — they count as unverifiable and the authored value is kept.
 */

const UNIT_MIN_SQ = 0.9 * 0.9;
const UNIT_MAX_SQ = 1.1 * 1.1;
/** |area-weighted face-normal sum|² below this = the faces cancel — no winding evidence. */
const EVIDENCE_MIN_SQ = 1e-8;

export interface ValidateNormalsResult {
  /** Vertex indices whose stored normal failed a check (unit or winding). */
  failing: number[];
  stats: {
    /** Vertices with a broken length (zero / NaN / far from unit). */
    badUnit: number;
    /** Vertices whose normal points against their incident faces' winding. */
    badWinding: number;
    /** Vertices with no usable face evidence (no faces, or two-sided cancellation) — kept as authored. */
    unverifiable: number;
    vertexCount: number;
  };
}

/** Validate stored per-vertex normals against the mesh geometry. `indices` is flat triangle triples. */
export function validateNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  normals: Float32Array,
): ValidateNormalsResult {
  const vertexCount = Math.min(positions.length, normals.length) / 3;
  // Area-weighted face-normal sum per vertex (raw indices — an authored split vertex is judged by its own side).
  const evidence = new Float64Array(vertexCount * 3);
  const hasFace = new Uint8Array(vertexCount);
  const triangleCount = Math.floor(indices.length / 3);
  for (let f = 0; f < triangleCount; f += 1) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const abx = positions[b * 3] - positions[a * 3];
    const aby = positions[b * 3 + 1] - positions[a * 3 + 1];
    const abz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const acx = positions[c * 3] - positions[a * 3];
    const acy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const acz = positions[c * 3 + 2] - positions[a * 3 + 2];
    // Cross product magnitude = 2×area — using it unnormalized IS the area weighting.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      if (v < vertexCount) {
        evidence[v * 3] += nx;
        evidence[v * 3 + 1] += ny;
        evidence[v * 3 + 2] += nz;
        hasFace[v] = 1;
      }
    }
  }

  const failing: number[] = [];
  let badUnit = 0;
  let badWinding = 0;
  let unverifiable = 0;
  for (let v = 0; v < vertexCount; v += 1) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const lengthSq = x * x + y * y + z * z;
    if (!Number.isFinite(lengthSq) || lengthSq < UNIT_MIN_SQ || lengthSq > UNIT_MAX_SQ) {
      badUnit += 1;
      failing.push(v);
      continue;
    }
    const ex = evidence[v * 3];
    const ey = evidence[v * 3 + 1];
    const ez = evidence[v * 3 + 2];
    if (!hasFace[v] || ex * ex + ey * ey + ez * ez < EVIDENCE_MIN_SQ) {
      unverifiable += 1; // no geometric evidence — trust the author
      continue;
    }
    if (x * ex + y * ey + z * ez < 0) {
      badWinding += 1;
      failing.push(v);
    }
  }

  return { failing, stats: { badUnit, badWinding, unverifiable, vertexCount } };
}
