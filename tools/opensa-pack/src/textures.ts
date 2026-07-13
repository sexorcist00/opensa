/**
 * Texture planner (plan 074/03): resolves every material's texture through the `txdp` chain, classifies and
 * processes the ALPHA subset (dilate/premult/mips/coverage → RGBA8 in M0), passes OPAQUE DXT payloads through
 * untouched (BC1/BC2/BC3), and buckets everything into `texture_2d_array`s by exact (format, W, H, mips).
 * Assignment is EAGER and deterministic: first use appends the layer; overflow opens the next array.
 */
import type { AssetFileSystem, RWTexture } from '@opensa/renderware';

import {
  encodeOstex,
  fnv1a,
  type Ostex,
  OstexAlphaClass,
  OstexFormat,
  type OstexFormatId,
  ostexLayerBytes,
  ostexMaxMips,
  ostexMipLayout,
} from '@opensa/engine-formats';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/renderware/textures/dxt';

import { type AlphaClass, classifyAlpha, effectiveAlphaClass, processAlphaTexture, resampleToPow2 } from './alpha';

const MAX_LAYERS = 256;
const CUTOUT_REF = 128;

export interface ResolvedTexture {
  alphaClass: AlphaClass;
  arrayRef: number;
  layer: number;
  /** De-tiling candidate (074/12): the welder sets bit 15 of the layer u16 for these. */
  stochastic: boolean;
}

interface Bucket {
  format: OstexFormatId;
  height: number;
  layers: PlannedLayer[];
  mipCount: number;
  refs: number[]; // arrayRef per MAX_LAYERS chunk
  width: number;
}

interface PlannedLayer {
  alphaClass: AlphaClass;
  /** Mip payloads, level 0 first — pass-through DXT rows or processed RGBA8 rows (both tight). */
  mips: { data: Uint8Array; height: number; width: number }[];
  name: string;
}

const DXT_TO_FORMAT: Record<string, OstexFormatId> = {
  dxt1: OstexFormat.BC1,
  dxt3: OstexFormat.BC2,
  dxt5: OstexFormat.BC3,
};

export class TexturePlanner {
  /** Ledger: how many textures took each path. */
  readonly report = { colors: 0, dedup: 0, opaquePass: 0, processed: 0 };
  private readonly buckets = new Map<string, Bucket>();
  private readonly byContent = new Map<number, ResolvedTexture>();
  /** Global fallback TXDs (074/06 row 10): overlay mods ship one shared TXD (e.g. `vegetation.txd`) that the
   *  installed game wires via txdp; offline we search it when the def's own chain misses. */
  private readonly fallbackTxds: readonly string[];
  private readonly fs: AssetFileSystem;
  private nextArrayRef = 0;

  private readonly rawCache = new Map<string, Map<string, RWTexture>>();

  /** Curated de-tiling texture names (074/12) — lowercased. */
  private readonly stochasticNames: ReadonlySet<string>;

  private readonly txdParents: Map<string, string>;

  constructor(
    fs: AssetFileSystem,
    txdParents: Map<string, string>,
    fallbackTxds: readonly string[] = [],
    stochasticNames: ReadonlySet<string> = new Set(),
  ) {
    this.fs = fs;
    this.txdParents = txdParents;
    this.fallbackTxds = fallbackTxds;
    this.stochasticNames = stochasticNames;
  }

  /** Assemble every planned array into `.ostex` blobs (deterministic ref order). */
  build(): {
    bytes: Uint8Array;
    meta: { format: number; height: number; layers: number; width: number };
    ref: number;
  }[] {
    const out: {
      bytes: Uint8Array;
      meta: { format: number; height: number; layers: number; width: number };
      ref: number;
    }[] = [];
    for (const bucket of this.buckets.values()) {
      for (let chunk = 0; chunk < bucket.refs.length; chunk += 1) {
        const layers = bucket.layers.slice(chunk * MAX_LAYERS, (chunk + 1) * MAX_LAYERS);
        out.push({
          bytes: encodeArray(bucket, layers),
          meta: { format: bucket.format, height: bucket.height, layers: layers.length, width: bucket.width },
          ref: bucket.refs[chunk],
        });
      }
    }

    return out.sort((a, b) => a.ref - b.ref);
  }

  /** Resolve a material's texture (or its flat colour) to an array layer, planning it on first use.
   *  `preferCutout` (vegetation callers) upgrades a soft-blend classification to cutout — vanilla SA
   *  alpha-tests foliage; blend-classed canopies wrote no depth (trees showed through trees). */
  resolve(
    txdName: string,
    textureName: null | string,
    color: readonly number[],
    preferCutout = false,
  ): ResolvedTexture {
    if (!textureName) {
      return this.resolveColor(color);
    }
    let rw = this.rawTexture(txdName.toLowerCase(), textureName.toLowerCase());
    for (const fallback of this.fallbackTxds) {
      if (rw) {
        break;
      }
      rw = this.rawTexture(fallback, textureName.toLowerCase());
    }
    if (!rw) {
      return this.resolveColor([255, 0, 255, 255]); // loud missing-texture magenta
    }
    const contentKey = fnv1a(rw.mipmaps[0]?.data ?? new Uint8Array()) ^ (rw.width << 8) ^ rw.height;
    const existing = this.byContent.get(contentKey);
    if (existing) {
      this.report.dedup += 1;

      return existing;
    }
    const planned = {
      ...this.plan(rw, textureName.toLowerCase(), preferCutout),
      stochastic: this.stochasticNames.has(textureName.toLowerCase()),
    };
    this.byContent.set(contentKey, planned);

    return planned;
  }

  private appendLayer(
    format: OstexFormatId,
    width: number,
    height: number,
    mipCount: number,
    layer: PlannedLayer,
  ): ResolvedTexture {
    const key = `${format}|${width}|${height}|${mipCount}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { format, height, layers: [], mipCount, refs: [], width };
      this.buckets.set(key, bucket);
    }
    const layerIndex = bucket.layers.length;
    bucket.layers.push(layer);
    const chunk = Math.floor(layerIndex / MAX_LAYERS);
    if (bucket.refs.length <= chunk) {
      bucket.refs.push(this.nextArrayRef);
      this.nextArrayRef += 1;
    }

    return {
      alphaClass: layer.alphaClass,
      arrayRef: bucket.refs[chunk],
      layer: layerIndex % MAX_LAYERS,
      stochastic: false,
    };
  }

  private plan(rw: RWTexture, name: string, preferCutout = false): ResolvedTexture {
    const blockAligned = rw.width % 4 === 0 && rw.height % 4 === 0;
    const pow2 = Number.isInteger(Math.log2(rw.width)) && Number.isInteger(Math.log2(rw.height));
    const dxtFormat = DXT_TO_FORMAT[rw.format];
    // Opaque, well-formed DXT: pass through untouched (no recompress, no quality loss).
    if (dxtFormat !== undefined && !rw.hasAlpha && blockAligned && pow2 && rw.mipmaps.length > 0) {
      this.report.opaquePass += 1;
      const mipCount = Math.min(rw.mipmaps.length, ostexMaxMips(dxtFormat, rw.width, rw.height));

      return this.appendLayer(dxtFormat, rw.width, rw.height, mipCount, {
        alphaClass: 'opaque',
        mips: rw.mipmaps.slice(0, mipCount).map((mip) => ({ data: mip.data, height: mip.height, width: mip.width })),
        name,
      });
    }
    // Everything else (alpha, odd sizes, rgba8888): decode → pow2 → classify → full alpha pipeline → RGBA8.
    this.report.processed += 1;
    const base = rw.mipmaps[0];
    const decoded =
      rw.format === 'rgba8888' ? new Uint8Array(base.data) : decodeDxt(rw.format, base.data, base.width, base.height);
    const sized = resampleToPow2(decoded, base.width, base.height);
    // Foliage scans carry a soft alpha skirt that mis-classes them softBlend; the caller knows better.
    const alphaClass = effectiveAlphaClass(classifyAlpha(sized.rgba, rw.hasAlpha), preferCutout);
    const mipCount = ostexMaxMips(OstexFormat.RGBA8, sized.width, sized.height);
    const mips = processAlphaTexture(sized.rgba, sized.width, sized.height, alphaClass, CUTOUT_REF, mipCount);
    let width = sized.width;
    let height = sized.height;
    const levels = mips.map((data) => {
      const level = { data, height, width };
      width = Math.max(1, width >> 1);
      height = Math.max(1, height >> 1);

      return level;
    });

    return this.appendLayer(OstexFormat.RGBA8, sized.width, sized.height, mipCount, { alphaClass, mips: levels, name });
  }

  private rawTexture(txdName: string, textureName: string, seen = new Set<string>()): null | RWTexture {
    if (seen.has(txdName)) {
      return null; // cycle guard
    }
    seen.add(txdName);
    let dictionary = this.rawCache.get(txdName);
    if (!dictionary) {
      dictionary = new Map();
      const bytes = this.fs.get(`${txdName}.txd`);
      if (bytes) {
        try {
          for (const texture of parseTxd(bytes).textures) {
            dictionary.set(texture.name.toLowerCase(), texture);
          }
        } catch {
          // unparseable TXD → empty dictionary (parity with asset-cache's parseOrEmpty)
        }
      }
      this.rawCache.set(txdName, dictionary);
    }
    const own = dictionary.get(textureName);
    if (own) {
      return own;
    }
    const parent = this.txdParents.get(txdName);

    return parent && parent !== txdName ? this.rawTexture(parent, textureName, seen) : null;
  }

  private resolveColor(color: readonly number[]): ResolvedTexture {
    this.report.colors += 1;
    const [r, g, b, a] = color;
    const key = fnv1a(`color:${r},${g},${b},${a}`);
    const existing = this.byContent.get(key);
    if (existing) {
      return existing;
    }
    const alphaClass: AlphaClass = a < 250 ? 'softBlend' : 'opaque';
    const texel = a < 250 ? [(r * a) / 255, (g * a) / 255, (b * a) / 255, a] : [r, g, b, 255];
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) {
      rgba.set(texel.map(Math.round), index * 4);
    }
    const planned = this.appendLayer(OstexFormat.RGBA8, 4, 4, 1, {
      alphaClass,
      mips: [{ data: rgba, height: 4, width: 4 }],
      name: `color:${r},${g},${b},${a}`,
    });
    this.byContent.set(key, planned);

    return planned;
  }
}

/** Repack tight mip rows into the 256-aligned `.ostex` payload and encode the array file. */
function encodeArray(bucket: Bucket, layers: PlannedLayer[]): Uint8Array {
  const { format, height, mipCount, width } = bucket;
  const layerBytes = ostexLayerBytes(format, width, height, mipCount);
  const payload = new Uint8Array(layerBytes * layers.length);
  let offset = 0;
  for (const layer of layers) {
    for (let level = 0; level < mipCount; level += 1) {
      const layout = ostexMipLayout(format, width, height, level);
      const mip = layer.mips[level];
      const compressed = format !== OstexFormat.RGBA8;
      const tightRow = compressed
        ? Math.ceil(layout.mipWidth / 4) * (format === OstexFormat.BC1 ? 8 : 16)
        : layout.mipWidth * 4;
      for (let row = 0; row < layout.rows; row += 1) {
        payload.set(mip.data.subarray(row * tightRow, (row + 1) * tightRow), offset + row * layout.bytesPerRow);
      }
      offset += layout.totalBytes;
    }
  }
  const alphaToOstex: Record<AlphaClass, number> = {
    cutout: OstexAlphaClass.CUTOUT,
    opaque: OstexAlphaClass.OPAQUE,
    softBlend: OstexAlphaClass.SOFT_BLEND,
  };
  const tex: Ostex = {
    format,
    height,
    layers: layers.map((layer) => ({
      alphaClass: alphaToOstex[layer.alphaClass],
      cutoutRef: layer.alphaClass === 'cutout' ? CUTOUT_REF : 0,
      nameHash: fnv1a(layer.name),
      wrap: 0,
    })),
    mipCount,
    payload,
    premultiplied: true,
    width,
  };

  return encodeOstex(tex);
}
