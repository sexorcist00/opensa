import type { DecodedTexture, Rgba } from './types';

/**
 * A tiny software rasterizer: fills textured triangles into a shared RGBA image with a z-buffer + alpha. Used to
 * bake the impostor card views (orthographic, so UV/colour interpolate **affinely** — exact, no perspective
 * divide). Background stays α=0; the texture's own alpha drives the foliage cutout.
 */
export interface Raster {
  /** The real-SA (gamma) encoding: `tex × prelit/dayAvg` in raw sRGB bytes. */
  color: Uint8Array;
  /** The OpenSA (linear) encoding of the SAME fragments: `lin2srgb(srgb2lin(tex) × prelit/dayAvg)`. */
  colorLinear: Uint8Array;
  depth: Float32Array;
  height: number;
  width: number;
}

/** A triangle already projected to image space: pixel `[x, y, depth]`, UV, and per-vertex colour (×3). */
export interface RasterTri {
  colors: [Rgba, Rgba, Rgba] | null;
  pixels: [Vec3px, Vec3px, Vec3px];
  uvs: [[number, number], [number, number], [number, number]];
}

type Vec3px = [number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];

/** sRGB byte → linear (LUT): the space GPUs decode textures into before any math. */
const SRGB_TO_LINEAR = new Float32Array(256).map((_, byte) => {
  const c = byte / 255;

  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

export function createRaster(width: number, height: number): Raster {
  return {
    color: new Uint8Array(width * height * 4),
    colorLinear: new Uint8Array(width * height * 4),
    depth: new Float32Array(width * height).fill(-Infinity),
    height,
    width,
  };
}

/** Rasterise one triangle. `alphaTest` (0–1) discards fragments below it (binary foliage cutout). */
export function rasterizeTriangle(
  raster: Raster,
  tri: RasterTri,
  texture: DecodedTexture | null,
  alphaTest: number,
  normalize: Rgba = WHITE,
): void {
  const [a, b, c] = tri.pixels;
  let area = edge(a, b, c);
  if (area === 0) {
    return; // degenerate
  }
  const flip = area < 0 ? -1 : 1;
  area *= flip;

  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(raster.width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p: Vec3px = [x + 0.5, y + 0.5, 0];
      const w0 = edge(b, c, p) * flip;
      const w1 = edge(c, a, p) * flip;
      const w2 = edge(a, b, p) * flip;
      if (w0 < 0 || w1 < 0 || w2 < 0) {
        continue; // outside
      }
      const l0 = w0 / area;
      const l1 = w1 / area;
      const l2 = w2 / area;
      const depth = a[2] * l0 + b[2] * l1 + c[2] * l2;
      const di = y * raster.width + x;
      if (depth <= raster.depth[di]) {
        continue; // behind an already-drawn fragment
      }

      const [gamma, linear] = blend(tri, texture, l0, l1, l2, normalize);
      if (gamma[3] < alphaTest * 255) {
        continue; // cutout
      }
      raster.depth[di] = depth;
      const o = di * 4;
      raster.color[o] = gamma[0];
      raster.color[o + 1] = gamma[1];
      raster.color[o + 2] = gamma[2];
      raster.color[o + 3] = gamma[3];
      raster.colorLinear[o] = linear[0];
      raster.colorLinear[o + 1] = linear[1];
      raster.colorLinear[o + 2] = linear[2];
      raster.colorLinear[o + 3] = gamma[3];
    }
  }
}

/**
 * Fragment colour = texture × the NORMALIZED prelit (`prelit / normalize`, where `normalize` is the tree's
 * average day prelit that instead rides the card VERTICES — plan 012). Only the per-texel variation lands
 * in the atlas, so the impostor behaves like a stock prelit model under any renderer multiplier. Emitted in
 * BOTH conventions at once:
 * - gamma (`[0]`): raw sRGB-byte product — what real SA's D3D9-era pipeline shows;
 * - linear (`[1]`): `lin2srgb(srgb2lin(tex) × factor)` — what OpenSA/three.js (linear pipeline) shows.
 * Alpha is coverage, not colour — a plain product, shared by both encodings.
 */
function blend(
  tri: RasterTri,
  texture: DecodedTexture | null,
  l0: number,
  l1: number,
  l2: number,
  normalize: Rgba,
): [Rgba, Rgba] {
  const u = tri.uvs[0][0] * l0 + tri.uvs[1][0] * l1 + tri.uvs[2][0] * l2;
  const v = tri.uvs[0][1] * l0 + tri.uvs[1][1] * l1 + tri.uvs[2][1] * l2;
  const tex = texture ? sample(texture, u, v) : WHITE;
  const vc = tri.colors ? lerpColor(tri.colors, l0, l1, l2) : WHITE;
  const alpha = (tex[3] * vc[3]) / 255;
  const factor = (c: number): number => vc[c] / Math.max(1, normalize[c]);

  return [
    [
      Math.min(255, Math.round(tex[0] * factor(0))),
      Math.min(255, Math.round(tex[1] * factor(1))),
      Math.min(255, Math.round(tex[2] * factor(2))),
      alpha,
    ],
    [
      linearToSrgbByte(srgbToLinear(tex[0]) * factor(0)),
      linearToSrgbByte(srgbToLinear(tex[1]) * factor(1)),
      linearToSrgbByte(srgbToLinear(tex[2]) * factor(2)),
      alpha,
    ],
  ];
}

function edge(p: Vec3px, q: Vec3px, r: Vec3px): number {
  return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(colors: [Rgba, Rgba, Rgba], l0: number, l1: number, l2: number): Rgba {
  return [
    colors[0][0] * l0 + colors[1][0] * l1 + colors[2][0] * l2,
    colors[0][1] * l0 + colors[1][1] * l1 + colors[2][1] * l2,
    colors[0][2] * l0 + colors[1][2] * l1 + colors[2][2] * l2,
    colors[0][3] * l0 + colors[1][3] * l1 + colors[2][3] * l2,
  ];
}

/** Linear 0–1 → sRGB byte — the encoding the atlas is stored (and later sampled) in. */
function linearToSrgbByte(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;

  return Math.round(srgb * 255);
}

/** Bilinear texture sample with wrapping (matches the engine's RepeatWrapping) — softens the impostor. */
function sample(texture: DecodedTexture, u: number, v: number): Rgba {
  const { height, rgba, width } = texture;
  const fx = (u - Math.floor(u)) * width - 0.5;
  const fy = (v - Math.floor(v)) * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % width) + width) % width;
  const xb = (xa + 1) % width;
  const ya = ((y0 % height) + height) % height;
  const yb = (ya + 1) % height;

  const out: Rgba = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const top = lerp(rgba[(ya * width + xa) * 4 + c], rgba[(ya * width + xb) * 4 + c], tx);
    const bottom = lerp(rgba[(yb * width + xa) * 4 + c], rgba[(yb * width + xb) * 4 + c], tx);
    out[c] = lerp(top, bottom, ty);
  }

  return out;
}

/** sRGB byte (possibly fractional, from bilinear sampling) → linear, interpolating the LUT. */
function srgbToLinear(byte: number): number {
  const low = Math.max(0, Math.min(255, Math.floor(byte)));
  const high = Math.min(255, low + 1);

  return lerp(SRGB_TO_LINEAR[low], SRGB_TO_LINEAR[high], byte - low);
}
