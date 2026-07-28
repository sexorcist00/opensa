/**
 * Which of a car's vertices are INSIDE its cabin (plan 090/02) — the geometry a dashboard lights when the
 * driver switches the headlights on.
 *
 * Found from what the model itself carries, never from a name or a per-car list: the slot a model sits in
 * changes with the next mod, the model's own glass and wheels do not.
 *
 *   - **The glass** gives the greenhouse. The builder has already classified every material, so the union of
 *     the glass vertices is the volume a passenger sits in: its XY footprint and its ceiling. A model with
 *     no glass at all — a bike, an open boat, a trailer — has no cabin, which is a supported answer.
 *   - **The wheel hubs** give the floor. Everything below them is underbody, wheel well and engine bay:
 *     just as enclosed as a cabin, and none of it may light up.
 *   - **The sky occlusion** ({@link skyOcclusion}) is the "actually enclosed" test that separates the cabin
 *     from the shell around it. Measured on the built previon, the cabin sits at 0.32–0.69 while the roof,
 *     doors and bonnet skins that share the same volume sit at 0.90–1.00.
 *
 * The result is a FLAG, not a gradient: the shader's cabin glow is one term, and the shape that reads as a
 * dashboard comes from the geometry's own normals, textures and occlusion. A per-vertex gradient would need
 * a channel the vertex format does not have to spare (090/02 measured the night-colour set as unusable for
 * it: a car authored at 255 white cannot carry a lift at all).
 */

/** How much sky a vertex may see and still count as cabin. Between the measured bands — cabin 0.32–0.69,
 *  shell 0.90–1.00 (previon, built pak, 2026-07-28) — and nearer the shell, so a dim corner of a cabin is
 *  never dropped while a door SKIN is never picked up. */
const CABIN_SKY_MAX = 0.78;

/**
 * Per-vertex cabin flag (1 = inside the cabin). All zero when the model has no glass, or no vertex passes.
 *
 * `positions` and `occlusion` are the builder's own rest-pose buffers, z up — the same pair the occlusion
 * bake reads, so a wheel is where it stands rather than at the origin. `glass` marks the vertices of GLASS
 * materials; `hubHeight` is the wheel hubs' model-space z, the floor of the cabin; `excluded` marks the
 * vertices that can never be cabin whatever the volume says.
 *
 * That last one is not a fudge, it is the volume test's one blind spot: the TOP HALF of a rear wheel stands
 * above the hub line, inside the greenhouse footprint, and is enclosed by its own arch — every clause passes
 * (measured on the previon: 17 % of each rear wheel's vertices, 2026-07-28). A wheel is a part the builder
 * placed itself, so it says so here rather than inventing a geometric rule for it.
 */
export function cabinVertices(
  positions: readonly number[],
  occlusion: Uint8Array,
  glass: Uint8Array,
  hubHeight: number,
  excluded: Uint8Array,
): Uint8Array {
  const cabin = new Uint8Array(occlusion.length);
  const greenhouse = glassBounds(positions, glass);
  if (greenhouse === null) {
    return cabin;
  }
  for (let vertex = 0; vertex < cabin.length; vertex += 1) {
    if (excluded[vertex] === 1) {
      continue;
    }
    const x = positions[vertex * 3];
    const y = positions[vertex * 3 + 1];
    const z = positions[vertex * 3 + 2];
    const inside =
      x >= greenhouse.minX &&
      x <= greenhouse.maxX &&
      y >= greenhouse.minY &&
      y <= greenhouse.maxY &&
      z >= hubHeight &&
      z <= greenhouse.maxZ;
    if (inside && occlusion[vertex] / 255 <= CABIN_SKY_MAX && glass[vertex] === 0) {
      cabin[vertex] = 1;
    }
  }

  return cabin;
}

/** The greenhouse: the glass vertices' XY footprint and their top. Null when the model has no glass. */
function glassBounds(
  positions: readonly number[],
  glass: Uint8Array,
): null | { maxX: number; maxY: number; maxZ: number; minX: number; minY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let seen = 0;
  for (let vertex = 0; vertex < glass.length; vertex += 1) {
    if (glass[vertex] === 0) {
      continue;
    }
    seen += 1;
    minX = Math.min(minX, positions[vertex * 3]);
    maxX = Math.max(maxX, positions[vertex * 3]);
    minY = Math.min(minY, positions[vertex * 3 + 1]);
    maxY = Math.max(maxY, positions[vertex * 3 + 1]);
    maxZ = Math.max(maxZ, positions[vertex * 3 + 2]);
  }

  return seen === 0 ? null : { maxX, maxY, maxZ, minX, minY };
}
