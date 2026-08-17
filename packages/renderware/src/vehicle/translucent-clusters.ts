import type { RWTriangle } from '../parsers/binary/types';

interface Cluster {
  max: [number, number, number];
  min: [number, number, number];
  triangles: RWTriangle[];
}

/**
 * Split one material group's triangles into spatially COMPACT clusters — the unit the translucent sort can
 * order honestly. The sort keys a submesh by the eye's distance to its AABB; a group that is one material but
 * several separate pieces (the gostown comet's `dials`: the gauge cluster on the dash AND the two speakers on
 * the rear shelf, one submesh spanning 1.9 m) has no single key: from a front-side angle the box's nearest
 * point is the dash, so the whole submesh sorted NEARER than the rear quarter glass and the speakers drew
 * crisp over it (field, 2026-08-17 — the 2026-08-04 AABB fix could not reach this case). Each cluster
 * becomes its own submesh with its own bounds.
 *
 * Connected components by shared vertex POSITION (a UV seam splits indices, not geometry), then components
 * whose boxes lie within `gap` of each other are merged, and the nearest pairs keep merging until at most
 * `maxClusters` remain — a bound on the draw calls one group can cost. A single connected piece (a
 * windscreen) comes back as it was.
 */
export function clusterTriangles(
  triangles: readonly RWTriangle[],
  positions: Float32Array,
  gap = 0.2,
  maxClusters = 8,
): RWTriangle[][] {
  const parent = new Map<string, string>();
  const keyOf = (corner: number): string =>
    `${positions[corner * 3].toFixed(4)},${positions[corner * 3 + 1].toFixed(4)},${positions[corner * 3 + 2].toFixed(4)}`;
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    parent.set(key, root);

    return root;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const tri of triangles) {
    for (const corner of [tri.a, tri.b, tri.c]) {
      const key = keyOf(corner);
      if (!parent.has(key)) {
        parent.set(key, key);
      }
    }
    union(keyOf(tri.a), keyOf(tri.b));
    union(keyOf(tri.b), keyOf(tri.c));
  }

  const byRoot = new Map<string, Cluster>();
  for (const tri of triangles) {
    const root = find(keyOf(tri.a));
    let cluster = byRoot.get(root);
    if (!cluster) {
      cluster = { max: [-Infinity, -Infinity, -Infinity], min: [Infinity, Infinity, Infinity], triangles: [] };
      byRoot.set(root, cluster);
    }
    cluster.triangles.push(tri);
    for (const corner of [tri.a, tri.b, tri.c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        cluster.min[axis] = Math.min(cluster.min[axis], positions[corner * 3 + axis]);
        cluster.max[axis] = Math.max(cluster.max[axis], positions[corner * 3 + axis]);
      }
    }
  }
  const clusters = [...byRoot.values()];
  // Agglomerate: the closest pair first, while it is within `gap` — then, past the cap, regardless.
  for (;;) {
    if (clusters.length < 2) {
      break;
    }
    const [i, j, distance] = closestPair(clusters);
    if (distance > gap && clusters.length <= maxClusters) {
      break;
    }
    merge(clusters[i], clusters[j]);
    clusters.splice(j, 1);
  }

  return clusters.map((cluster) => cluster.triangles);
}

function boxGap(a: Cluster, b: Cluster): number {
  let sq = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
    sq += d * d;
  }

  return Math.sqrt(sq);
}

/** The two clusters whose boxes are nearest (Euclidean gap between AABBs, 0 when they overlap) — `i < j`. */
function closestPair(clusters: readonly Cluster[]): [number, number, number] {
  let best: [number, number, number] = [0, 1, Infinity];
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const distance = boxGap(clusters[i], clusters[j]);
      if (distance < best[2]) {
        best = [i, j, distance];
      }
    }
  }

  return best;
}

function merge(into: Cluster, from: Cluster): void {
  into.triangles.push(...from.triangles);
  for (let axis = 0; axis < 3; axis += 1) {
    into.min[axis] = Math.min(into.min[axis], from.min[axis]);
    into.max[axis] = Math.max(into.max[axis], from.max[axis]);
  }
}
