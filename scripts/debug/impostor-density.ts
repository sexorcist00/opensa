/**
 * How much of the sky a tree's impostor covers against how much its HD does — the measurement plan 013 step 03
 * picks the card rule with. Renders BOTH from the same poses with the same software rasteriser (8 azimuths ×
 * the sizes a tree really has on screen at the LOD switch), so the only difference is the geometry:
 *
 *   npx tsx scripts/debug/impostor-density.ts sm_veg_tree5 [--cards 4,2] [--px 64,32] [--azimuths 8]
 *                                              [--tex 512] [--ss 2] [--blend] [--windings 2] [--png <dir>]
 *
 * `--px` is a tree's HEIGHT in pixels, which is what a distance means once the projection is fixed: at SA's
 * ~70° fov on a 900 px viewport a 15 m tree is ~64 px tall at the 150 u HD draw distance and ~32 px at twice
 * that. The default cutout test is what BOTH engines do once the impostor row carries the vegetation bits
 * (plan 013 step 02), so the numbers are the crossed cards' UNION. `--blend` measures the other class the
 * same way — each card rendered alone and composited back-to-front with no depth write, which is what the
 * impostor was welded as BEFORE step 02 — and the pair of runs is what prices cause 1 against cause 3.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  DecodedTexture,
  HdTree,
  Impostor,
  Rgba,
  TreeLodConfig,
  Vec2,
  Vec3,
} from '../../tools/lod-trees-generator/src/core';
import type { Raster } from '../../tools/lod-trees-generator/src/core/raster';

import { config as defaultConfig } from '../../tools/lod-trees-generator/src/config';
import { buildCardGeometry, encodePng, renderImpostor } from '../../tools/lod-trees-generator/src/core';
import {
  createRaster,
  rasterizeTriangle,
  resolveRaster,
  withMipChain,
} from '../../tools/lod-trees-generator/src/core/raster';
import { loadHdTree } from '../lib/vegetation';

/** The foliage cutout the bake and both engines use. */
const ALPHA_TEST = 0.5;
/** Sub-samples per measured pixel: the metric is a coverage, so the render that produces it is antialiased. */
const VIEW_SUPERSAMPLE = 4;
/** The canopy is the upper share of the tree's projected box — below it the trunk dominates. */
const CANOPY_TOP_SHARE = 0.6;

/** What one rendered view says about the canopy. */
interface ViewStats {
  /** Share of the canopy box whose alpha survives the cutout. */
  covered: number;
  /** Mean luminance over the covered pixels: how DARK the canopy reads. */
  luma: number;
  /** Mean alpha over the canopy box (0-1) — the coverage as rendered, antialiasing included. */
  mass: number;
}

/** One triangle to draw, in world space, with the texture its material names. */
interface ViewTri {
  colors: [Rgba, Rgba, Rgba] | null;
  positions: [Vec3, Vec3, Vec3];
  texture: DecodedTexture | null;
  uvs: [Vec2, Vec2, Vec2];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Coverage, mass and luminance over the upper share of the frame. */
function canopyStats(color: Uint8Array, raster: Pick<Raster, 'height' | 'width'>): ViewStats {
  const rows = Math.max(1, Math.round(raster.height * CANOPY_TOP_SHARE));
  const texels = rows * raster.width;
  let alphaSum = 0;
  let covered = 0;
  let luma = 0;
  for (let i = 0; i < texels; i += 1) {
    const alpha = color[i * 4 + 3];
    alphaSum += alpha;
    if (alpha >= 128) {
      covered += 1;
      luma += 0.2126 * color[i * 4] + 0.7152 * color[i * 4 + 1] + 0.0722 * color[i * 4 + 2];
    }
  }

  return { covered: covered / texels, luma: covered === 0 ? 0 : luma / covered, mass: alphaSum / (texels * 255) };
}

/** The card cage of a baked impostor, one triangle list PER CARD (the blend pass composites them in order). */
function cardTris(impostor: Impostor): ViewTri[][] {
  const geometry = buildCardGeometry(impostor);
  const atlas = withMipChain({
    hasAlpha: true,
    height: impostor.height,
    rgba: impostor.image,
    width: impostor.width,
  });
  const at = (i: number): Vec3 => [
    geometry.positions[i * 3],
    geometry.positions[i * 3 + 1],
    geometry.positions[i * 3 + 2],
  ];
  const uvAt = (i: number): Vec2 => [geometry.uvs[i * 2], geometry.uvs[i * 2 + 1]];
  const colour: Rgba = impostor.dayColor;

  const tris = geometry.triangles.map((triangle) => ({
    colors: [colour, colour, colour] as [Rgba, Rgba, Rgba],
    positions: [at(triangle.a), at(triangle.b), at(triangle.c)] as [Vec3, Vec3, Vec3],
    texture: atlas,
    uvs: [uvAt(triangle.a), uvAt(triangle.b), uvAt(triangle.c)] as [Vec2, Vec2, Vec2],
  }));
  const perCard = tris.length / impostor.cards.length;

  return impostor.cards.map((_, i) => tris.slice(i * perCard, (i + 1) * perCard));
}

/** Composite `layers` back-to-front with no depth write: `over` per pixel, exactly a sorted alpha pass. */
function compositeLayers(layers: readonly { color: Uint8Array; stats: ViewStats }[]): Uint8Array {
  const out = new Uint8Array(layers[0].color.length);
  for (const layer of layers) {
    for (let i = 0; i < out.length; i += 4) {
      const src = layer.color[i + 3] / 255;
      const dst = out[i + 3] / 255;
      const alpha = src + dst * (1 - src);
      if (alpha === 0) {
        continue;
      }
      for (let c = 0; c < 3; c += 1) {
        out[i + c] = Math.round((layer.color[i + c] * src + out[i + c] * dst * (1 - src)) / alpha);
      }
      out[i + 3] = Math.round(alpha * 255);
    }
  }

  return out;
}

/** The HD mesh as world triangles, textures mipped once for the whole run. */
function hdTris(tree: HdTree): ViewTri[] {
  const textures = new Map([...tree.textures].map(([name, texture]) => [name, withMipChain(texture)]));

  return tree.triangles.map((triangle) => ({
    colors: triangle.colors,
    positions: triangle.positions,
    texture: triangle.texture ? (textures.get(triangle.texture) ?? null) : null,
    uvs: triangle.uvs,
  }));
}

function main(): void {
  const models = process.argv.slice(2).filter((arg, i, all) => !arg.startsWith('--') && !all[i - 1]?.startsWith('--'));
  if (models.length === 0) {
    console.error(
      'usage: npx tsx scripts/debug/impostor-density.ts <model...> [--cards 4,2] [--px 64,32] [--azimuths 8] [--tex 512] [--ss 2] [--png <dir>]',
    );
    process.exit(1);
  }
  const base: TreeLodConfig = {
    ...defaultConfig,
    superSample: Number(argValue('--ss') ?? defaultConfig.superSample),
    textureSize: Number(argValue('--tex') ?? 512),
  };
  const candidates = numbers('--cards', [defaultConfig.cards, 2]);
  const sizes = numbers('--px', [64, 32]);
  const azimuths = Number(argValue('--azimuths') ?? 8);
  const blend = process.argv.includes('--blend');
  // `--windings 2` composites each card twice: what the pre-step-02 geometry did in the blend class, since a
  // mirrored copy of a card is the same face drawn again.
  const windings = Number(argValue('--windings') ?? 1);
  const pngDir = argValue('--png');
  if (pngDir) {
    mkdirSync(pngDir, { recursive: true });
  }

  for (const model of models) {
    const tree = loadHdTree(model);
    const hd = hdTris(tree);
    console.log(
      `${model}: ${tree.triangles.length} HD tris · ${azimuths} azimuths · ${blend ? 'sorted BLEND, no depth write' : `cutout ${ALPHA_TEST}`}` +
        `${windings > 1 ? ` · ${windings} windings per card` : ''}`,
    );
    for (const px of sizes) {
      const shot = (kind: string, i: number): string | undefined =>
        pngDir && i === 0 ? join(pngDir, `${model}-${px}px-${kind}.png`) : undefined;
      const views = [...Array(azimuths).keys()].map((i) => (2 * Math.PI * i) / azimuths);
      const hdStats = views.map((a, i) => renderView(hd, tree.bbox, a, px, shot('hd', i)).stats);
      console.log(
        `  ${px} px tall — HD: covered ${pct(mean(hdStats, (s) => s.covered))} · mass ${pct(mean(hdStats, (s) => s.mass))} (${spread(hdStats, (s) => s.mass)}) · luma ${mean(hdStats, (s) => s.luma).toFixed(0)}`,
      );
      for (const cards of candidates) {
        const impostor = renderImpostor(tree, { ...base, cards });
        const lod = cardTris(impostor);
        const drawn = windings > 1 ? lod.flatMap((card) => Array.from({ length: windings }, () => card)) : lod;
        const stats = views.map((a, i) => renderCards(drawn, tree.bbox, a, px, blend, shot(`lod${cards}`, i)));
        console.log(
          `  ${px} px tall — LOD ${cards} cards: covered ${pct(mean(stats, (s) => s.covered))} ${ratio(
            mean(stats, (s) => s.covered),
            mean(hdStats, (s) => s.covered),
          )} · mass ${pct(mean(stats, (s) => s.mass))} ${ratio(
            mean(stats, (s) => s.mass),
            mean(hdStats, (s) => s.mass),
          )} (${spread(stats, (s) => s.mass)}) · luma ${mean(stats, (s) => s.luma).toFixed(0)} ${ratio(
            mean(stats, (s) => s.luma),
            mean(hdStats, (s) => s.luma),
          )}`,
        );
      }
    }
  }
}

/** Mean of a metric over every azimuth. */
function mean(stats: readonly ViewStats[], pick: (s: ViewStats) => number): number {
  return stats.reduce((sum, s) => sum + pick(s), 0) / stats.length;
}

function numbers(flag: string, fallback: number[]): number[] {
  const raw = argValue(flag);

  return raw === undefined ? fallback : raw.split(',').map(Number);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ratio(lod: number, hd: number): string {
  return hd === 0 ? 'n/a' : `×${(lod / hd).toFixed(2)}`;
}

/** One view of the card cage: cutout union (the default), or each card composited as a sorted blend. */
function renderCards(
  cards: readonly ViewTri[][],
  bbox: { max: Vec3; min: Vec3 },
  azimuth: number,
  pxHeight: number,
  blend: boolean,
  png?: string,
): ViewStats {
  if (!blend) {
    return renderView(cards.flat(), bbox, azimuth, pxHeight, png).stats;
  }
  const layers = cards.map((card) => renderView(card, bbox, azimuth, pxHeight));
  const color = compositeLayers(layers);
  const width = layers[0].color.length / 4 / pxHeight;
  if (png) {
    writeFileSync(png, encodePng(color, width, pxHeight));
  }

  return canopyStats(color, { height: pxHeight, width });
}

/** Render `tris` from one azimuth at a given tree height in pixels, and read the canopy off the result. */
function renderView(
  tris: readonly ViewTri[],
  bbox: { max: Vec3; min: Vec3 },
  azimuth: number,
  pxHeight: number,
  png?: string,
): { color: Uint8Array; stats: ViewStats } {
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const zSpan = Math.max(1e-3, bbox.max[2] - bbox.min[2]);
  // Half-diagonal, so the tree fits the frame identically from EVERY azimuth (a per-azimuth fit would
  // rescale the picture and make the coverages incomparable, which is the whole measurement).
  const radius = Math.max(1e-3, 0.5 * Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1]));
  const width = Math.max(1, Math.round(((2 * radius) / zSpan) * pxHeight));
  const raster = createRaster(width, pxHeight, VIEW_SUPERSAMPLE);
  const tx = -Math.sin(azimuth);
  const ty = Math.cos(azimuth);
  const nx = Math.cos(azimuth);
  const ny = Math.sin(azimuth);
  const toPx = (p: Vec3): [number, number, number] => [
    (((p[0] - cx) * tx + (p[1] - cy) * ty + radius) / (2 * radius)) * (raster.sampleWidth - 1),
    ((bbox.max[2] - p[2]) / zSpan) * (raster.sampleHeight - 1),
    (p[0] - cx) * nx + (p[1] - cy) * ny,
  ];

  for (const tri of tris) {
    rasterizeTriangle(
      raster,
      {
        colors: tri.colors,
        pixels: [toPx(tri.positions[0]), toPx(tri.positions[1]), toPx(tri.positions[2])],
        uvs: tri.uvs,
      },
      tri.texture,
      ALPHA_TEST,
    );
  }
  const { color } = resolveRaster(raster);
  if (png) {
    writeFileSync(png, encodePng(color, raster.width, raster.height));
  }

  return { color, stats: canopyStats(color, raster) };
}

/**
 * Spread of a metric across the azimuths, as `min..max` of the per-view values over their mean.
 *
 * The MEAN is not the whole question a card rule has to answer: a crossed cage is at its thickest looking
 * down a card and at its thinnest between two, and that swing is what a view-weighted impostor (plan 013
 * phase B) exists to remove. A rule can sit at parity on average and still pump.
 */
function spread(stats: readonly ViewStats[], pick: (s: ViewStats) => number): string {
  const values = stats.map(pick);
  const average = mean(stats, pick);
  if (average === 0) {
    return 'n/a';
  }

  return `${(Math.min(...values) / average).toFixed(2)}..${(Math.max(...values) / average).toFixed(2)}`;
}

main();
