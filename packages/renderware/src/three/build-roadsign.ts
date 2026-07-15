import type { Texture } from 'three';

import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial } from 'three';

import type { RWRoadsign } from '../parsers/binary/types';
import type { RenderPart } from './build-clump';

import { roadsignGlyphQuads } from '../roadsign/glyph-quads';

/** Text colour palette (flags bits 4–5): white, black, grey, red — three hex (sRGB, no colour-management
 *  round-trip). The shared module's ROADSIGN_PALETTE is the same colours as [r,g,b] for the converter. */
const PALETTE: readonly number[] = [0xffffff, 0x000000, 0x808080, 0xb01010];

/**
 * 2dfx ROADSIGN text rendering (plan 042 item 5) for the three path. The glyph geometry itself is built by the
 * shared, three-free {@link roadsignGlyphQuads} (so the opensa-pack converter — plan 076 — bakes IDENTICAL
 * quads); here it is batched by text colour into alpha-tested font meshes.
 *
 * NB: roadsign positions are WORLD-space (see the shared module) — add the parts with an IDENTITY transform,
 * NOT through the instanced path.
 */

/** The shared `roadsignfont` texture (particle.txd) — set once by the game shell at startup; while unset,
 *  sign text simply doesn't build (boards render bare, nothing crashes). */
let roadsignFont: null | Texture = null;

/**
 * Build the text quads for a model's road signs as render parts, batched by text colour (one geometry + one
 * alpha-tested font material per colour). Quads are world-space (identity transform at the call site).
 */
export function buildRoadsignParts(roadsigns: readonly RWRoadsign[], font: Texture): RenderPart[] {
  const byColour = new Map<number, { positions: number[]; uvs: number[] }>();

  for (const sign of roadsigns) {
    const quads = roadsignGlyphQuads(sign);
    if (!quads) {
      continue;
    }
    let batch = byColour.get(quads.colour);
    if (!batch) {
      batch = { positions: [], uvs: [] };
      byColour.set(quads.colour, batch);
    }
    batch.positions.push(...quads.positions);
    batch.uvs.push(...quads.uvs);
  }

  const parts: RenderPart[] = [];
  for (const [colour, batch] of byColour) {
    if (batch.positions.length === 0) {
      continue;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(batch.positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(batch.uvs), 2));
    const index: number[] = [];
    for (let quad = 0; quad < batch.positions.length / 12; quad += 1) {
      const base = quad * 4;
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geometry.setIndex(index);
    geometry.computeVertexNormals(); // flat plate normals — kept for SSAO's normal prepass
    geometry.computeBoundingSphere();

    // DoubleSide on purpose: winding-vs-camera proved fragile across the rotation families (FrontSide culled
    // everything); the duplicated quads carry identical UVs, so they overlap into one letterform.
    const material = new MeshBasicMaterial({
      alphaTest: 0.3,
      color: PALETTE[colour] ?? PALETTE[0],
      map: font,
      side: DoubleSide,
      transparent: true,
    });
    material.name = 'roadsignfont';
    parts.push({ geometry, material });
  }

  return parts;
}

/** The installed glyph texture, or null when unavailable. */
export function getRoadsignFont(): null | Texture {
  return roadsignFont;
}

/** Install the `roadsignfont` glyph texture (call when particle.txd is loaded). */
export function setRoadsignFont(font: null | Texture): void {
  roadsignFont = font;
}

export { roadsignGlyphIndex } from '../roadsign/glyph-quads';
