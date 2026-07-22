/**
 * Per-vertex SKY OCCLUSION for a built vehicle model (plan 084): how much of the sky a vertex can see past
 * the car's OWN body. The dynamic indirect term had none — a cabin floor, an underbody and an exhaust were
 * lit as if they hung in open sky, which is why a 0.2-albedo exhaust reads light grey.
 *
 * It is computed HERE, in the shared builder, and never authored offline: opensa-pack and the spawn-time
 * worker both call `buildVehicleModel`, so a converted car and a modloader car get the same numbers by
 * construction. Baking it in the converter instead would make the two paths disagree the moment someone
 * drops a DFF into modloader.
 *
 * The method is HORIZON MAPPING over a height field, not ray casting against the mesh. SA cars are closed
 * shells and everything the flat term got wrong is under a roof or under a floor pan, which a "highest
 * surface over this cell" grid answers in one pass over the vertices and a handful of lookups each. It also
 * behaves correctly where a mesh test would need care: a convertible has no roof, so its cabin stays open.
 */

/** Azimuths sampled around each vertex — 8 is enough for a shell this coarse and keeps the cost flat. */
const AZIMUTHS = 8;

/** How far a ray marches, in cells. Beyond ~8 cells the car is behind you and the horizon stops rising. */
const MARCH_CELLS = 8;

/** Height-field resolution across the model's footprint. ~32 cells over a 5 m car ≈ 15 cm — a roof, a floor
 *  pan and a sill land in different cells, which is all the term needs to separate inside from outside. */
const GRID = 32;

/** An occluder must clear the vertex by this much (metres) to count — coplanar twins are not occluders. */
const CLEARANCE = 0.02;

/** Fully enclosed geometry keeps this much indirect. Zero would render a cabin pitch black at noon; the
 *  world's own AO floor is the same idea. */
const FLOOR = 0.15;

/** The car's own shell as "highest surface over this cell", plus the frame it is addressed in. */
interface HeightField {
  readonly cellX: number;
  readonly cellY: number;
  readonly height: Float32Array;
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}

/**
 * Sky visibility per vertex, unorm8 (255 = open sky). `positions` and `normals` are the builder's own
 * model-space buffers, z up — the rest pose, which is what the car spends its life in.
 *
 * The NORMAL is what keeps a door skin bright: the roof sits above it and a plain height test would call it
 * occluded, but the roof is BEHIND the surface — an occluder only counts for the share of it that lies in
 * the hemisphere the surface faces.
 *
 * `occluders` marks which vertices form the shell that CASTS the occlusion (1) and which merely receive it
 * (0). Every vertex still gets a value; the flag only keeps hidden geometry out of the height field. It
 * matters for a CONVERTIBLE: its `_vlo` LOD is a closed blob over the cabin, and letting that cast would
 * roof over an open car.
 */
export function skyOcclusion(
  positions: readonly number[],
  normals: readonly number[],
  vertexCount: number,
  occluders?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(vertexCount).fill(255);
  const field = heightField(positions, vertexCount, occluders);
  if (field === null) {
    return out; // nothing, or a degenerate model (one point / a flat line) — nothing occludes anything
  }

  for (let v = 0; v < vertexCount; v += 1) {
    const sky = vertexSky(positions, normals, v, field);

    out[v] = Math.round((FLOOR + (1 - FLOOR) * sky) * 255);
  }

  return out;
}

function cellIndex(x: number, y: number, field: HeightField): number {
  const gx = Math.min(GRID - 1, Math.max(0, Math.floor((x - field.minX) / field.cellX)));
  const gy = Math.min(GRID - 1, Math.max(0, Math.floor((y - field.minY) / field.cellY)));

  return gy * GRID + gx;
}

function heightField(
  positions: readonly number[],
  vertexCount: number,
  occluders: Uint8Array | undefined,
): HeightField | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let v = 0; v < vertexCount; v += 1) {
    minX = Math.min(minX, positions[v * 3]);
    maxX = Math.max(maxX, positions[v * 3]);
    minY = Math.min(minY, positions[v * 3 + 1]);
    maxY = Math.max(maxY, positions[v * 3 + 1]);
  }
  if (maxX - minX <= 0 || maxY - minY <= 0) {
    return null;
  }
  // Splatting VERTICES (not rasterized triangles) is deliberate — a car is dense enough that its roof and
  // its floor pan already cover every cell they span.
  const field: HeightField = {
    cellX: (maxX - minX) / GRID,
    cellY: (maxY - minY) / GRID,
    height: new Float32Array(GRID * GRID).fill(-Infinity),
    maxX,
    maxY,
    minX,
    minY,
  };
  for (let v = 0; v < vertexCount; v += 1) {
    if (occluders && occluders[v] === 0) {
      continue; // not part of the shell the car actually shows (see `occluders`)
    }
    const cell = cellIndex(positions[v * 3], positions[v * 3 + 1], field);
    field.height[cell] = Math.max(field.height[cell], positions[v * 3 + 2]);
  }

  return field;
}

/** The horizon slope this azimuth reaches from (x, y, z) — 0 when nothing along it rises above the vertex. */
function horizonSlope(field: HeightField, x: number, y: number, z: number, stepX: number, stepY: number): number {
  const stepLength = Math.hypot(stepX, stepY);
  let slope = 0;
  for (let step = 1; step <= MARCH_CELLS; step += 1) {
    const sampleX = x + stepX * step;
    const sampleY = y + stepY * step;
    if (sampleX < field.minX || sampleX > field.maxX || sampleY < field.minY || sampleY > field.maxY) {
      break; // off the car — the rest of this azimuth is open sky
    }
    const top = field.height[cellIndex(sampleX, sampleY, field)];
    const rise = top - z - CLEARANCE;
    if (rise > 0) {
      slope = Math.max(slope, rise / (stepLength * step));
    }
  }

  return slope;
}

/** Sky left over after the car's own horizon, weighted by how much of it the vertex actually faces. */
function vertexSky(
  positions: readonly number[],
  normals: readonly number[],
  vertex: number,
  field: HeightField,
): number {
  const x = positions[vertex * 3];
  const y = positions[vertex * 3 + 1];
  const z = positions[vertex * 3 + 2];
  let occluded = 0;
  let weightSum = 0;
  for (let a = 0; a < AZIMUTHS; a += 1) {
    const angle = (a / AZIMUTHS) * Math.PI * 2;
    const stepX = Math.cos(angle) * field.cellX;
    const stepY = Math.sin(angle) * field.cellY;
    const slope = horizonSlope(field, x, y, z, stepX, stepY);
    // sin(horizon) is the share of that azimuth's sky a wall of this height covers. It only counts for the
    // part of the occluder the surface FACES — the direction to the horizon, dotted with the normal — or a
    // roof would darken the door skin below it, which sees the sky perfectly well.
    const riseZ = slope * Math.hypot(stepX, stepY);
    const length = Math.hypot(stepX, stepY, riseZ) || 1;
    const facing =
      (stepX * normals[vertex * 3] + stepY * normals[vertex * 3 + 1] + riseZ * normals[vertex * 3 + 2]) / length;
    const weight = Math.max(0, facing);
    occluded += weight * (slope / Math.hypot(1, slope));
    weightSum += weight;
  }

  return weightSum > 0 ? 1 - occluded / weightSum : 1;
}
