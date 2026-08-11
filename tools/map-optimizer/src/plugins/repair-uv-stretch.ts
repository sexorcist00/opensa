import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/** Ships beside the tool, like `crease-overrides.json`, so every entry point gets the same list. */
const DEFAULT_LIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'uv-stretch-models.json');

/**
 * Re-derive the UVs of faces whose mapping is stretched far off square (plan 025).
 *
 * **What is being repaired.** Stock SA carries faces whose UV triangle is collapsed or nearly so: the mapping
 * crushes one axis, so a single row of texels is dragged across the whole face and the texture reads as a
 * directional smear. It is original R\* data — the optimizer moves no UV (025 phase 0) — and the field
 * confirmed it on `road_lawn17`, `road_lawn34` and `road_lawn32`, plus in the untouched original through
 * `sa-map-viewer`. "That is what the original does" is the beginning of an argument, not the end
 * (`docs/project-goals.md`), and a texel drawn 284× longer than it is wide is a 2004 authoring slip.
 *
 * **How, and why it cannot move a shared edge.** A road tiles with its NEIGHBOURING MODELS, and the field
 * verified that joint is correct today, so the repair may not touch a UV that a healthy face also uses. For a
 * broken face it therefore keeps the two corners it shares with a healthy neighbour and re-derives only the
 * third, by extending that neighbour's own affine world→UV map across the shared edge. The corrected corner
 * goes onto a SPLIT copy of the vertex, so every other face keeps the UV it had — the same mechanism
 * `smooth-normals` uses, and the count-changing re-encoder (plan 004) already handles the growth.
 *
 * **A global fit was tried first and failed**: over the model's healthy faces the residual is ~1.8 UV units
 * (nearly two whole tiles), because SA's authored UVs restart per strip rather than running continuously.
 * There is no model-wide map to re-derive from — only a local one.
 *
 * **REFUSALS are the safety, and they are counted.** A face with no healthy edge-neighbour is left alone: with
 * nothing to inherit from, there is nothing derived to write. So is a face whose neighbour's mapping is itself
 * degenerate. The pass never invents a mapping.
 */
export interface RepairUvOptions {
  /** A healthy neighbour must sit at or under this anisotropy to be worth inheriting from. */
  healthy?: number;
  /** σmax/σmin above which a face's mapping counts as broken. Below it, a mapping is a look, not a defect. */
  limit?: number;
  /** Runaway guard on the outward propagation, not a tuning knob — the loop stops when a round is a no-op. */
  maxRounds?: number;
  /** Called once per model the pass actually CHANGED — the report's before/after list. */
  onModel?: (model: string) => void;
}

/**
 * `healthy` is a MEASURED knee, not a taste: at 2 the roads repair 8–20 % of their broken faces, at 4 they
 * reach 16–21 % and `cs_landbit_10` jumps 3 % → 69 %, and at 6 nothing moves at all. A road legitimately
 * carries 2–4× anisotropy (density along it differs from across it), so 4 is also where "healthy" stops
 * meaning "square" and starts meaning "not a defect".
 */
const DEFAULTS: Omit<Required<RepairUvOptions>, 'onModel'> = { healthy: 4, limit: 8, maxRounds: 12 };

export interface RepairStats {
  /** Faces left alone because no healthy neighbour could be found — reported, never silently skipped. */
  refused: number;
  /** Faces re-derived from a neighbour. */
  repaired: number;
  /** Vertices appended to carry a corrected UV without disturbing the faces that shared the original. */
  split: number;
}

/**
 * The pass. `models` gates WHERE it may run — the derived rule still reads each asset's own numbers, so a mod
 * replacing one of these models is judged on its own geometry and not on a stored patch.
 */
export function createRepairUvStretch(
  models: ReadonlySet<string>,
  stats: RepairStats,
  options: RepairUvOptions = {},
): MapPlugin {
  const opts = { ...DEFAULTS, ...options };

  return {
    accepts: (asset): boolean => models.has(asset.name.toLowerCase()),
    name: 'repair-uv-stretch',
    transform(asset, context): void {
      let repaired = 0;
      let refused = 0;
      let split = 0;
      for (const mesh of asset.ir.meshes) {
        const result = repairMesh(mesh, opts);
        repaired += result.repaired;
        refused += result.refused;
        split += result.split;
      }
      stats.repaired += repaired;
      stats.refused += refused;
      stats.split += split;
      if (repaired > 0) {
        asset.dirty = true;
        options.onModel?.(asset.name.toLowerCase());
        context.log(
          asset,
          'repair-uv-stretch',
          `re-derived ${repaired} face(s) from healthy neighbours (+${split} split verts, ${refused} refused)`,
        );
      }
    },
  };
}

/** The curated gate list the scanner produces — see the JSON's own comment for how it is regenerated. */
export function loadUvStretchModels(path: string = DEFAULT_LIST): ReadonlySet<string> {
  if (!existsSync(path)) {
    return new Set();
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { models?: unknown };
  if (!Array.isArray(raw.models)) {
    throw new Error(`${path}: expected a "models" array`);
  }

  return new Set(raw.models.map((name) => String(name).toLowerCase()));
}

/**
 * Repair one sub-mesh in place, in ROUNDS.
 *
 * A single pass only reaches faces that already touch a healthy one, which on a road is a small minority —
 * measured on `road_lawn17`, 3 of 31. Repairing outward fixes that: a face corrected in round N is healthy
 * evidence in round N+1, so a broken BAND is peeled from its edges inward. The loop stops when a round
 * changes nothing, and `maxRounds` is a runaway guard rather than a tuning knob.
 */
export function repairMesh(mesh: SubMesh, options: RepairUvOptions = {}): RepairStats {
  const opts = { ...DEFAULTS, ...options };
  const total: RepairStats = { refused: 0, repaired: 0, split: 0 };
  for (let round = 0; round < opts.maxRounds; round += 1) {
    const pass = repairRound(mesh, opts);
    total.repaired += pass.repaired;
    total.split += pass.split;
    total.refused = pass.refused; // only the LAST round's refusals are still outstanding
    if (pass.repaired === 0) {
      break;
    }
  }

  return total;
}

/** σmax/σmin of a face's UV→world map; `Infinity` when the UV triangle is degenerate. */
function anisotropyOf(mesh: SubMesh, { a, b, c }: Triangle): number {
  const map = uvMap(mesh, a, b, c);

  return map ? map.big / map.small : Number.POSITIVE_INFINITY;
}

function appendF32(source: Float32Array, sources: readonly number[], stride: number): Float32Array {
  const out = new Float32Array(source.length + sources.length * stride);
  out.set(source);
  sources.forEach((from, i) => {
    for (let k = 0; k < stride; k += 1) {
      out[source.length + i * stride + k] = source[from * stride + k];
    }
  });

  return out;
}

function appendU8(source: Uint8Array, sources: readonly number[], stride: number): Uint8Array {
  const out = new Uint8Array(source.length + sources.length * stride);
  out.set(source);
  sources.forEach((from, i) => {
    for (let k = 0; k < stride; k += 1) {
      out[source.length + i * stride + k] = source[from * stride + k];
    }
  });

  return out;
}

function dist2(a: readonly number[], b: readonly number[]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Position-keyed edge → the faces that use it, so a UV-split vertex still shares its edge. */
function edgeMap(mesh: SubMesh): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const key = (v: number): string =>
    `${mesh.positions[v * 3]},${mesh.positions[v * 3 + 1]},${mesh.positions[v * 3 + 2]}`;
  mesh.triangles.forEach(({ a, b, c }, f) => {
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const edge = [key(x), key(y)].sort().join('|');
      const list = out.get(edge);
      if (list) list.push(f);
      else out.set(edge, [f]);
    }
  });

  return out;
}

/**
 * How the neighbour's UV frame is displaced from this face's, across the edge they share — or `null` when the
 * two are not in one frame at all.
 *
 * Vertices are matched by POSITION, since a UV-split vertex is a different index on each side. The frames
 * must then differ by ONE consistent offset at both shared corners, and that offset must be a whole number
 * of tiles: world textures are sampled with `repeat`, so a difference of exactly (n, m) lands on the same
 * texel and the two mappings are the same mapping written down differently. Anything else is a real seam,
 * and deriving across it is worse than the defect — measured on `las_runsignsx_las`, worst anisotropy 10×
 * to 1324×.
 *
 * Allowing the integer case is not a loosening for its own sake: it is what 4 of 31 refusals on
 * `road_lawn17`, 13 of 80 on `road_lawn34` and 17 of 60 on `road_lawn32` turned out to be.
 */
function edgeOffset(mesh: SubMesh, neighbour: Triangle, x: number, y: number): [number, number] | null {
  const uvs = mesh.uvs!;
  const same = (u: number, v: number): boolean =>
    Math.abs(mesh.positions[u * 3] - mesh.positions[v * 3]) < 1e-6 &&
    Math.abs(mesh.positions[u * 3 + 1] - mesh.positions[v * 3 + 1]) < 1e-6 &&
    Math.abs(mesh.positions[u * 3 + 2] - mesh.positions[v * 3 + 2]) < 1e-6;

  let offset: [number, number] | null = null;
  for (const mine of [x, y]) {
    const theirs = [neighbour.a, neighbour.b, neighbour.c].find((v) => same(v, mine));
    if (theirs === undefined) {
      return null;
    }
    const du = uvs[theirs * 2] - uvs[mine * 2];
    const dv = uvs[theirs * 2 + 1] - uvs[mine * 2 + 1];
    if (Math.abs(du - Math.round(du)) > 1e-4 || Math.abs(dv - Math.round(dv)) > 1e-4) {
      return null; // a fractional shift is a genuine seam, not the same mapping re-based
    }
    const rounded: [number, number] = [Math.round(du), Math.round(dv)];
    if (offset && (offset[0] !== rounded[0] || offset[1] !== rounded[1])) {
      return null; // the two corners disagree about the shift — not one frame
    }
    offset = rounded;
  }

  return offset;
}

/** Append the split copies to every per-vertex array, writing the corrected UVs into the new slots. */
function growArrays(mesh: SubMesh, sources: readonly number[], uvs: readonly number[]): void {
  mesh.positions = appendF32(mesh.positions, sources, 3);
  if (mesh.normals) {
    mesh.normals = appendF32(mesh.normals, sources, 3);
  }
  if (mesh.prelitColors) {
    mesh.prelitColors = appendU8(mesh.prelitColors, sources, 4);
  }
  if (mesh.nightColors) {
    mesh.nightColors = appendU8(mesh.nightColors, sources, 4);
  }
  if (mesh.extraUvs?.length) {
    mesh.extraUvs = mesh.extraUvs.map((layer) => appendF32(layer, sources, 2));
  }
  const grown = new Float32Array(mesh.uvs!.length + sources.length * 2);
  grown.set(mesh.uvs!);
  grown.set(uvs, mesh.uvs!.length);
  mesh.uvs = grown;
}

/**
 * Which corner to re-derive and what UV to give it: find a healthy face across one of this face's edges, and
 * extend ITS affine world→UV map onto the corner the two do not share. `null` when no such neighbour exists —
 * the refusal that keeps the pass from inventing a mapping.
 */
function planRepair(
  mesh: SubMesh,
  triangle: Triangle,
  face: number,
  edges: Map<string, number[]>,
  aniso: readonly number[],
  healthy: number,
  limit: number,
): null | { corner: number; uv: [number, number] } {
  const { a, b, c } = triangle;
  const key = (v: number): string =>
    `${mesh.positions[v * 3]},${mesh.positions[v * 3 + 1]},${mesh.positions[v * 3 + 2]}`;
  for (const [x, y, odd] of [
    [a, b, c],
    [b, c, a],
    [c, a, b],
  ]) {
    const edge = [key(x), key(y)].sort().join('|');
    for (const other of edges.get(edge) ?? []) {
      if (other === face || aniso[other] > healthy) {
        continue;
      }
      const neighbour = mesh.triangles[other];
      // The neighbour must AGREE with this face about the shared edge's UVs. Without that check the repair
      // mixes two frames — the face keeps its own two corners while the third is derived in the neighbour's
      // — and across a UV SEAM, where the same positions carry different UVs on each side, the result is
      // worse than the defect: measured on `las_runsignsx_las`, worst anisotropy went 10× to 1324×.
      const offset = edgeOffset(mesh, neighbour, x, y);
      if (!offset) {
        continue;
      }
      const uv = projectUv(mesh, neighbour, unfold(mesh, neighbour, odd, x, y), offset);
      // THE PASS CHECKS ITS OWN WORK. A face can be broken in the edge it KEEPS — both retained corners
      // carrying the same UV — and then no value for the third corner rescues it. Without this the repair
      // "succeeded", the face stayed broken, and the next round tried again: 1 027 repairs on a mesh with
      // 246 broken faces, appending a vertex every time. Accept only a correction that demonstrably lands
      // the face under the limit.
      if (uv && wouldFix(mesh, triangle, odd, uv, limit)) {
        return { corner: odd, uv };
      }
    }
  }

  return null;
}

/** Apply a healthy face's affine world→UV map to an arbitrary position; `null` if its map is unusable. */
function projectUv(
  mesh: SubMesh,
  { a, b, c }: Triangle,
  point: readonly number[],
  offset: readonly [number, number],
): [number, number] | null {
  const map = uvMap(mesh, a, b, c);
  if (!map) {
    return null;
  }
  // Solve the position offset in the face's own (e1, e2) basis, then read the UV off the same coefficients.
  const { e1p, e1t, e2p, e2t } = map;
  const d = [0, 1, 2].map((k) => point[k] - mesh.positions[a * 3 + k]);
  const g11 = dot(e1p, e1p);
  const g12 = dot(e1p, e2p);
  const g22 = dot(e2p, e2p);
  const det = g11 * g22 - g12 * g12;
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const d1 = dot(d, e1p);
  const d2 = dot(d, e2p);
  const s = (d1 * g22 - d2 * g12) / det;
  const t = (d2 * g11 - d1 * g12) / det;

  // Back out of the neighbour's frame into this face's. The two differ by whole tiles when the shared edge
  // is an integer-offset seam, and the corners this face keeps are written in its OWN frame — mixing the two
  // would stretch the mapping across a tile, which is the defect this pass exists to remove.
  return [
    mesh.uvs![a * 2] + e1t[0] * s + e2t[0] * t - offset[0],
    mesh.uvs![a * 2 + 1] + e1t[1] * s + e2t[1] * t - offset[1],
  ];
}

/** One round: every currently-broken face that can inherit from a currently-healthy neighbour. */
function repairRound(mesh: SubMesh, opts: Omit<Required<RepairUvOptions>, 'onModel'>): RepairStats {
  const stats: RepairStats = { refused: 0, repaired: 0, split: 0 };
  if (!mesh.uvs || mesh.triangles.length === 0) {
    return stats;
  }
  // The anisotropy of every face is taken BEFORE anything is written, so a repaired face cannot become the
  // evidence its neighbour is then repaired from — the pass reads one consistent picture of the mesh.
  const aniso = mesh.triangles.map((triangle) => anisotropyOf(mesh, triangle));
  const edges = edgeMap(mesh);
  const sources: number[] = []; // appended vertex → the original it copies
  const uvs: number[] = []; // its corrected UV, in the same order

  mesh.triangles.forEach((triangle, f) => {
    if (aniso[f] <= opts.limit) {
      return;
    }
    const plan = planRepair(mesh, triangle, f, edges, aniso, opts.healthy, opts.limit);
    if (!plan) {
      stats.refused += 1;

      return;
    }
    // The corrected corner lands on a COPY, so every other face that shared the original keeps its own UV —
    // which is what stops the repair from moving a joint the neighbouring models tile against.
    const index = mesh.positions.length / 3 + sources.length;
    sources.push(plan.corner);
    uvs.push(plan.uv[0], plan.uv[1]);
    replaceCorner(triangle, plan.corner, index);
    stats.repaired += 1;
    stats.split += 1;
  });

  if (sources.length > 0) {
    growArrays(mesh, sources, uvs);
  }

  return stats;
}

/** Point the face's `from` corner at `to`, leaving the other two alone. */
function replaceCorner(triangle: Triangle, from: number, to: number): void {
  if (triangle.a === from) {
    triangle.a = to;
  } else if (triangle.b === from) {
    triangle.b = to;
  } else {
    triangle.c = to;
  }
}

function sub(a: readonly number[], b: readonly number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Where the broken face's odd corner LANDS once the face is rotated about the shared edge into its
 * neighbour's plane.
 *
 * Without this the corner is simply projected onto that plane, which throws away however far it stood out of
 * it — and a road slab bent against its neighbour then gets a UV that does not reproduce the neighbour's
 * mapping at all. That was the dominant refusal: the correction was computed, failed its own `wouldFix`
 * check, and the face stayed as authored. Unfolding preserves distance ALONG the surface, which is what a
 * texture mapping is supposed to follow, and it puts the corner exactly in the plane where the neighbour's
 * affine solve is exact.
 *
 * The unfolded corner goes on the far side of the edge from the neighbour's own third corner, because that
 * is the side the face is on.
 */
function unfold(mesh: SubMesh, neighbour: Triangle, odd: number, x: number, y: number): number[] {
  const at = (v: number): number[] => [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
  const p = at(x);
  const edge = sub(at(y), p);
  const edgeLength = Math.hypot(edge[0], edge[1], edge[2]);
  if (edgeLength < 1e-9) {
    return at(odd);
  }
  const unit = edge.map((k) => k / edgeLength);
  // The neighbour's own corner off this edge gives the in-plane perpendicular direction.
  const theirs = [neighbour.a, neighbour.b, neighbour.c].find(
    (v) => dist2(at(v), p) > 1e-12 && dist2(at(v), at(y)) > 1e-12,
  );
  if (theirs === undefined) {
    return at(odd);
  }
  const across = sub(at(theirs), p);
  const perp = sub(
    across,
    unit.map((k) => k * dot(across, unit)),
  );
  const perpLength = Math.hypot(perp[0], perp[1], perp[2]);
  if (perpLength < 1e-9) {
    return at(odd);
  }
  const normal = perp.map((k) => k / perpLength);

  const mine = sub(at(odd), p);
  const along = dot(mine, unit);
  const height = Math.hypot(
    ...sub(
      mine,
      unit.map((k) => k * along),
    ),
  );

  return [0, 1, 2].map((k) => p[k] + unit[k] * along - normal[k] * height);
}

/** A face's edge vectors in world and UV, plus the singular values of the map between them. */
function uvMap(
  mesh: SubMesh,
  a: number,
  b: number,
  c: number,
): null | { big: number; e1p: number[]; e1t: number[]; e2p: number[]; e2t: number[]; small: number } {
  const uvs = mesh.uvs!;
  const e1p = [0, 1, 2].map((k) => mesh.positions[b * 3 + k] - mesh.positions[a * 3 + k]);
  const e2p = [0, 1, 2].map((k) => mesh.positions[c * 3 + k] - mesh.positions[a * 3 + k]);
  const e1t = [uvs[b * 2] - uvs[a * 2], uvs[b * 2 + 1] - uvs[a * 2 + 1]];
  const e2t = [uvs[c * 2] - uvs[a * 2], uvs[c * 2 + 1] - uvs[a * 2 + 1]];
  const det = e1t[0] * e2t[1] - e1t[1] * e2t[0];
  if (Math.abs(det) < 1e-14) {
    return null;
  }
  const dPdu = [0, 1, 2].map((k) => (e1p[k] * e2t[1] - e2p[k] * e1t[1]) / det);
  const dPdv = [0, 1, 2].map((k) => (e2p[k] * e1t[0] - e1p[k] * e2t[0]) / det);
  const guu = dot(dPdu, dPdu);
  const gvv = dot(dPdv, dPdv);
  const guv = dot(dPdu, dPdv);
  const mean = (guu + gvv) / 2;
  const spread = Math.sqrt(Math.max(0, ((guu - gvv) / 2) ** 2 + guv * guv));

  return {
    big: Math.sqrt(Math.max(0, mean + spread)),
    e1p,
    e1t,
    e2p,
    e2t,
    small: Math.sqrt(Math.max(0, mean - spread)),
  };
}

/** Would this corner's new UV actually bring the face under the limit? Measured, not assumed. */
function wouldFix(mesh: SubMesh, triangle: Triangle, corner: number, uv: readonly number[], limit: number): boolean {
  const uvs = mesh.uvs!;
  const oldU = uvs[corner * 2];
  const oldV = uvs[corner * 2 + 1];
  uvs[corner * 2] = uv[0];
  uvs[corner * 2 + 1] = uv[1];
  const after = anisotropyOf(mesh, triangle);
  uvs[corner * 2] = oldU;
  uvs[corner * 2 + 1] = oldV;

  return after <= limit;
}
