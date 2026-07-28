/**
 * A car's dash light, baked per vertex (plan 090/02) — how brightly each vertex is lit by ONE soft source
 * sitting under the steering wheel, which is what a real instrument panel spills into a cabin at night.
 *
 * It is a BAKE rather than a live light on purpose. A real point light in the pool would have to carry its
 * model-space anchor to the shader per instance (a uniform the vehicle path does not have), it would leak
 * onto the road under the car because nothing shadows it, and the vehicle pool diffuse is evaluated per
 * VERTEX — on a low-poly seat that reads as blotches. Baked, the falloff is per vertex and interpolates, the
 * light cannot escape the car, and the runtime cost is one multiply.
 *
 * Everything is read off the model, never off a name or a per-car list:
 *
 *   - **The glass** gives the greenhouse. Every material is already classified, so the union of the glass
 *     vertices is the volume a passenger sits in — its XY footprint and its ceiling. A model with no glass
 *     (a bike, an open boat, a trailer) has no cabin and gets nothing, which is a supported answer.
 *   - **The wheel hubs** give the floor: below them a car is underbody, wheel well and engine bay, all just
 *     as enclosed as a cabin and none of it lit by a dashboard.
 *   - **The sky occlusion** ({@link skyOcclusion}) is the "actually enclosed" test that tells an interior
 *     from the panel around it — measured on the built previon, cabin 0.32–0.69 against shell 0.90–1.00.
 *   - **`ped_frontseat`** (SA authors it on every drivable model) says where the driver sits — mirrored to
 *     −X, the same rule the game seats the player by — so the lamp hangs on the wheel's own side.
 */

/** How much sky a vertex may see and still count as cabin. Between the measured bands — cabin 0.32–0.69,
 *  shell 0.90–1.00 (previon, built pak, 2026-07-28) — and nearer the shell, so a dim corner of a cabin is
 *  never dropped while a door SKIN is never picked up. */
const CABIN_SKY_MAX = 0.78;

/**
 * Passes of the neighbour fill, and how far a vertex's neighbours must disagree before it follows them.
 *
 * The membership test is a THRESHOLD on a bake that is noisy over organic geometry: measured on the previon's
 * seats, 23 % of their vertices come out at sky 0.8–1.0 while the rest sit at 0.2–0.5, scattered rather than
 * in regions. Thresholded, that noise becomes speckle — and speckle is what painted hard polygonal patches
 * across those seats in the field (2026-07-28). A vertex therefore follows its triangle neighbours when they
 * clearly disagree with it, and keeps its own verdict otherwise: holes inside a cabin close, lone cabin
 * vertices stranded on a shell panel clear, and a real boundary is left alone. Same idiom, and the same
 * reason, as `despeckle` in `sky-occlusion.ts`. Measured: 1 261 → 572 speckled vertices on the previon.
 */
const FILL_PASSES = 2;
const FILL_TO_CABIN = 0.66;
const FILL_TO_SHELL = 0.34;

/**
 * Where the lamp hangs, as fractions of the CABIN's own box — a bus hangs it further apart than a coupé
 * without either of them knowing what it is. `INSET` is how far back from the front of the cabin (the dash
 * is at the front, the source just under the wheel behind it), `HEIGHT` how far up from the cabin floor
 * (steering-wheel height, well below the driver's eyes). Look constants, both.
 */
const DASH_INSET = 0.18;
const DASH_HEIGHT = 0.45;

/**
 * What the baked value MEANS: the distance from the lamp, as a fraction of the cabin's depth, quantized over
 * this span. Beyond it a vertex saturates at the last level and is simply "far".
 *
 * The DISTANCE is baked and the falloff CURVE is not, deliberately: the reach and the shape are the two
 * things a look round wants to try, and a shader constant costs a reload where a baked one costs a re-pack
 * of every car. The engine's `CABIN_SPAN` must match this number.
 */
export const CABIN_SPAN = 0.75;

/** Levels the distance is quantized into. The value rides in `meta.w`'s LOW nibble beside the lamp tags,
 *  which leaves 3…15 — 13 steps, ~6 cm apart on a 2 m cabin, smoothed further by interpolation. */
export const CABIN_LEVELS = 13;

/**
 * Per-vertex distance from the dash lamp, quantized: 0 = not cabin at all, 1 = at the lamp, {@link
 * CABIN_LEVELS} = {@link CABIN_SPAN} of the cabin's depth away or further. The shader turns it into light.
 *
 * `positions` and `occlusion` are the builder's own REST-POSE buffers, z up — the same pair the occlusion
 * bake reads, so a wheel is where it stands rather than at the origin. `glass` marks the vertices of glass
 * materials, `hubHeight` is the wheel hubs' z, `excluded` the vertices that can never be cabin whatever the
 * volume says, `indices` the triangles the fill reads, and `driverX` the driver dummy's x (null centres the
 * lamp).
 *
 * `excluded` is not a fudge, it is the volume test's one blind spot: the TOP HALF of a rear wheel stands
 * above the hub line, inside the greenhouse footprint, and is enclosed by its own arch — every clause passes
 * (measured: 17 % of each of the previon's rear wheels). A wheel is a part the builder placed itself, so it
 * says so here rather than having a geometric rule invented for it.
 */
export function cabinLight(
  positions: readonly number[],
  occlusion: Uint8Array,
  glass: Uint8Array,
  hubHeight: number,
  excluded: Uint8Array,
  indices: ArrayLike<number>,
  driverX: null | number = null,
): Uint8Array {
  const inside = cabinMembers(positions, occlusion, glass, hubHeight, excluded);
  fillFromNeighbours(inside, indices, excluded);
  const box = boundsOf(positions, inside);
  if (box === null) {
    return inside; // all zero — no cabin, nothing to light
  }
  const depth = box.maxY - box.minY;
  const lamp: [number, number, number] = [
    driverX ?? (box.minX + box.maxX) / 2,
    box.maxY - depth * DASH_INSET,
    box.minZ + (box.maxZ - box.minZ) * DASH_HEIGHT,
  ];
  const span = Math.max(depth * CABIN_SPAN, 1e-3);
  const level = new Uint8Array(inside.length);
  for (let vertex = 0; vertex < inside.length; vertex += 1) {
    if (inside[vertex] === 0) {
      continue;
    }
    const distance = Math.hypot(
      positions[vertex * 3] - lamp[0],
      positions[vertex * 3 + 1] - lamp[1],
      positions[vertex * 3 + 2] - lamp[2],
    );
    level[vertex] = 1 + Math.round(Math.min(1, distance / span) * (CABIN_LEVELS - 1));
  }

  return level;
}

/** The box of everything flagged — the CABIN's own extent, which places and sizes the lamp. */
function boundsOf(
  positions: readonly number[],
  flags: Uint8Array,
): null | { maxX: number; maxY: number; maxZ: number; minX: number; minY: number; minZ: number } {
  const box = {
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
  };
  let seen = 0;
  for (let vertex = 0; vertex < flags.length; vertex += 1) {
    if (flags[vertex] === 0) {
      continue;
    }
    seen += 1;
    box.minX = Math.min(box.minX, positions[vertex * 3]);
    box.maxX = Math.max(box.maxX, positions[vertex * 3]);
    box.minY = Math.min(box.minY, positions[vertex * 3 + 1]);
    box.maxY = Math.max(box.maxY, positions[vertex * 3 + 1]);
    box.minZ = Math.min(box.minZ, positions[vertex * 3 + 2]);
    box.maxZ = Math.max(box.maxZ, positions[vertex * 3 + 2]);
  }

  return seen === 0 ? null : box;
}

/** Which vertices are inside the cabin at all — the volume test, before the fill and the falloff. */
function cabinMembers(
  positions: readonly number[],
  occlusion: Uint8Array,
  glass: Uint8Array,
  hubHeight: number,
  excluded: Uint8Array,
): Uint8Array {
  const cabin = new Uint8Array(occlusion.length);
  const greenhouse = boundsOf(positions, glass);
  if (greenhouse === null) {
    return cabin;
  }
  for (let vertex = 0; vertex < cabin.length; vertex += 1) {
    if (excluded[vertex] === 1 || glass[vertex] === 1) {
      continue;
    }
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const inVolume =
      x >= greenhouse.minX &&
      x <= greenhouse.maxX &&
      y >= greenhouse.minY &&
      y <= greenhouse.maxY &&
      z >= hubHeight &&
      z <= greenhouse.maxZ;
    if (inVolume && occlusion[vertex] / 255 <= CABIN_SKY_MAX) {
      cabin[vertex] = 1;
    }
  }

  return cabin;
}

/** Let each vertex follow its triangle neighbours where they CLEARLY disagree with it — see
 *  {@link FILL_PASSES}. An excluded vertex never joins, however enclosed its neighbourhood looks. */
function fillFromNeighbours(cabin: Uint8Array, indices: ArrayLike<number>, excluded: Uint8Array): void {
  const neighbours: number[][] = Array.from({ length: cabin.length }, () => []);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = indices[at];
    const b = indices[at + 1];
    const c = indices[at + 2];
    neighbours[a]?.push(b, c);
    neighbours[b]?.push(a, c);
    neighbours[c]?.push(a, b);
  }
  for (let pass = 0; pass < FILL_PASSES; pass += 1) {
    const before = new Uint8Array(cabin); // each pass reads the previous one — order-independent
    for (let vertex = 0; vertex < cabin.length; vertex += 1) {
      const around = neighbours[vertex];
      if (around.length === 0 || excluded[vertex] === 1) {
        continue;
      }
      const share = around.reduce((sum, other) => sum + before[other], 0) / around.length;
      if (share >= FILL_TO_CABIN) {
        cabin[vertex] = 1;
      } else if (share <= FILL_TO_SHELL) {
        cabin[vertex] = 0;
      }
    }
  }
}
