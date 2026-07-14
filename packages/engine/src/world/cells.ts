/**
 * Static-world cell store (plan 074/01): one `.oscell` blob → GPU buffers + a recorded `GPURenderBundle`
 * replayed while the cell is frustum-visible. Record happens ONCE at load (we own record time — no version
 * dances); unload destroys everything and the residency ledger must return to its prior line.
 */
import {
  decodeOscell,
  type OscellBreakable,
  OscellChannel,
  type OscellGroup,
  type OscellObject,
} from '@opensa/engine-formats';

import type { Resources } from '../core/resources';
import type { PipelineSet } from '../render/pipelines';
import type { TextureArrays } from './textures';

import { MSAA_SAMPLES, pipelineIdFor } from '../render/pipelines';
import { alignedErase } from './degenerate';

export interface CellHandle {
  /** Blended classes (blend/beam) — executed in the frame's SECOND phase, after every cell's opaque
   *  (blends write no depth; interleaving them per cell let later cells' opaque repaint them — field bug). */
  blendBundle: GPURenderBundle | null;
  /** World-space bounding sphere [x, y, z, r] (cell bounds shifted by origin). */
  bounds: readonly [number, number, number, number];
  /**
   * Smashable placements (B7·a): key hash → the placement's triangles inside THIS cell's index buffer.
   *
   * A prop breaks by having its indices overwritten with degenerate ones — the cell's render bundle is
   * recorded once and never rebuilt, but it only REFERENCES the index buffer, so rewriting the buffer's bytes
   * is legal and costs one `writeBuffer`. Keeping the props inside the merged batch is what keeps the draw
   * count flat (splitting them out per placement measured 4.5x the draws).
   */
  breakables: Map<number, { indexCount: number; indexOffset: number }[]>;
  bundle: GPURenderBundle;
  cellBindGroup: GPUBindGroup;
  draws: number;
  index16: boolean;
  indexBuffer: GPUBuffer;
  /** The cell's index bytes, kept ONLY when it has smashable props: erasing one needs its neighbours' bytes
   *  (see `alignedErase`). Cells with nothing to smash keep nothing. */
  indexData: Uint8Array;
  key: string;
  /** 2dfx corona anchors (074/06 row 13), WORLD-space positions precomputed at load. */
  lights: {
    color: readonly [number, number, number, number];
    farClip: number;
    /** Key hash of the smashable placement that owns this light; 0 when nothing can smash it. */
    owner: number;
    size: number;
    x: number;
    y: number;
    z: number;
  }[];
  /** ObjectTable draws (074/06 row 9) — outside the bundle; the frame gates them (timed by hour). */
  objects: { groups: OscellGroup[]; kind: number; params: number }[];
  /** 2dfx PARTICLE emitters (B6), WORLD-space. The HOST resolves the name against effects.fxp and builds
   *  the instance buffers; the cell only carries the anchors. */
  particles: { effectName: string; x: number; y: number; z: number }[];
  uniform: GPUBuffer;
  vertexBuffer: GPUBuffer;
  visible: boolean;
}

export class CellStore {
  get count(): number {
    return this.cells.size;
  }
  private readonly cells = new Map<string, CellHandle>();
  private readonly colorFormat: GPUTextureFormat;
  private readonly depthFormat: GPUTextureFormat;
  private readonly device: GPUDevice;
  private readonly frameBindGroup: GPUBindGroup;
  private readonly pipelines: PipelineSet;
  private readonly resources: Resources;

  private readonly textures: TextureArrays;

  constructor(options: {
    colorFormat: GPUTextureFormat;
    depthFormat: GPUTextureFormat;
    device: GPUDevice;
    frameBindGroup: GPUBindGroup;
    pipelines: PipelineSet;
    resources: Resources;
    textures: TextureArrays;
  }) {
    this.device = options.device;
    this.resources = options.resources;
    this.pipelines = options.pipelines;
    this.textures = options.textures;
    this.frameBindGroup = options.frameBindGroup;
    this.colorFormat = options.colorFormat;
    this.depthFormat = options.depthFormat;
  }

  /** All loaded cells (culling + HUD iterate this). */
  all(): IterableIterator<CellHandle> {
    return this.cells.values();
  }

  /**
   * Smash the placement with this key: overwrite its triangles with degenerate ones (every index → 0, so each
   * triangle collapses to a point and rasterizes nothing). The render bundle is untouched — it references the
   * index BUFFER, and we are only rewriting its bytes. Returns false when no loaded cell owns the key (the
   * prop streamed out, or it was already broken and its cell has not reloaded).
   *
   * There is no explicit restore: a cell reload rebuilds the index buffer straight from the pak, which is
   * exactly SA's behaviour — streaming out and back in respawns the prop.
   */
  breakPlacement(keyHash: number): boolean {
    for (const cell of this.cells.values()) {
      const ranges = cell.breakables.get(keyHash);
      if (!ranges) {
        continue;
      }
      const stride = cell.index16 ? 2 : 4;
      for (const range of ranges) {
        // 4-byte alignment is not a detail here: an unaligned writeBuffer is REJECTED (the browser only warns),
        // so with u16 indices a prop whose range started on an odd index simply refused to break.
        const erase = alignedErase(cell.indexData, range.indexOffset, range.indexCount, stride);
        this.device.queue.writeBuffer(cell.indexBuffer, erase.byteOffset, erase.bytes);
      }
      cell.breakables.delete(keyHash);
      // The prop's own 2dfx lights go with it: a smashed traffic light left its coronas hanging in the sky.
      const lights = cell.lights.filter((light) => light.owner !== keyHash);
      if (lights.length !== cell.lights.length) {
        cell.lights.length = 0;
        cell.lights.push(...lights);
      }

      return true;
    }

    return false;
  }

  has(key: string): boolean {
    return this.cells.has(key);
  }

  /** Decode + upload + record. Idempotent per key. */
  load(key: string, bytes: Uint8Array): CellHandle {
    const existing = this.cells.get(key);
    if (existing) {
      return existing;
    }
    const cell = decodeOscell(bytes);
    const vertexBuffer = this.resources.createBuffer('cellVertex', {
      label: `${key}:vb`,
      size: align4(cell.vertexData.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, pad4(cell.vertexData));
    const indexBuffer = this.resources.createBuffer('cellIndex', {
      label: `${key}:ib`,
      size: align4(cell.indexData.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, pad4(cell.indexData));
    const uniform = this.resources.createBuffer('uniform', {
      label: `${key}:cell`,
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // origin.w = per-cell channel FLAG BITS (small ints are exact in f32): bit 0 = baked sunVis, bit 1 =
    // baked emissive mask (074/07) — the shader gates on them, so a channel-less pak never misreads the
    // reserved bytes (no in-data sentinels needed).
    const cellFlags =
      ((cell.channelMask & OscellChannel.SUN_VIS) !== 0 ? 1 : 0) |
      ((cell.channelMask & OscellChannel.EMISSIVE) !== 0 ? 2 : 0);
    this.device.queue.writeBuffer(uniform, 0, new Float32Array([...cell.origin, cellFlags]));
    const cellBindGroup = this.device.createBindGroup({
      entries: [{ binding: 0, resource: { buffer: uniform } }],
      label: `${key}:cell`,
      layout: this.pipelines.cellLayout,
    });

    // ObjectTable groups render OUTSIDE the bundle (hour-gated); the bundle records the rest.
    const objectOwned = new Set<number>();
    for (const object of cell.objects) {
      for (let own = object.groupStart; own < object.groupStart + object.groupCount; own += 1) {
        objectOwned.add(own);
      }
    }
    const bundleGroups = cell.groups.filter((_, index) => !objectOwned.has(index));
    const opaqueGroups = bundleGroups.filter((group) => group.pipelineClass <= 1);
    const blendGroups = bundleGroups.filter((group) => group.pipelineClass >= 2);
    const bundle = this.record(key, opaqueGroups, cell.index16, vertexBuffer, indexBuffer, cellBindGroup);
    const blendBundle =
      blendGroups.length > 0
        ? this.record(`${key}:blend`, blendGroups, cell.index16, vertexBuffer, indexBuffer, cellBindGroup)
        : null;
    const handle: CellHandle = {
      blendBundle,
      bounds: [
        cell.bounds[0] + cell.origin[0],
        cell.bounds[1] + cell.origin[1],
        cell.bounds[2] + cell.origin[2],
        cell.bounds[3],
      ],
      breakables: groupBreakables(cell.breakables),
      bundle,
      cellBindGroup,
      draws: bundleGroups.length,
      index16: cell.index16,
      indexBuffer,
      indexData: cell.breakables.length > 0 ? cell.indexData : new Uint8Array(0),
      key,
      lights: cell.lights.map((light) => ({
        color: light.color,
        farClip: light.farClip,
        owner: light.owner,
        size: light.size,
        x: light.position[0] + cell.origin[0],
        y: light.position[1] + cell.origin[1],
        z: light.position[2] + cell.origin[2],
      })),
      objects: cell.objects.map((object: OscellObject) => ({
        groups: cell.groups.slice(object.groupStart, object.groupStart + object.groupCount),
        kind: object.kind,
        params: object.params,
      })),
      particles: cell.particles.map((particle) => ({
        effectName: particle.effectName,
        x: particle.position[0] + cell.origin[0],
        y: particle.position[1] + cell.origin[1],
        z: particle.position[2] + cell.origin[2],
      })),
      uniform,
      vertexBuffer,
      visible: true,
    };
    this.cells.set(key, handle);

    return handle;
  }

  unload(key: string): void {
    const handle = this.cells.get(key);
    if (!handle) {
      return;
    }
    this.cells.delete(key);
    this.resources.destroyBuffer('cellVertex', handle.vertexBuffer);
    this.resources.destroyBuffer('cellIndex', handle.indexBuffer);
    this.resources.destroyBuffer('uniform', handle.uniform);
    // The recorded bundle holds no destroyable GPU objects of its own; it dies with GC.
  }

  private record(
    key: string,
    groups: readonly OscellGroup[],
    index16: boolean,
    vertexBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    cellBindGroup: GPUBindGroup,
  ): GPURenderBundle {
    const encoder = this.device.createRenderBundleEncoder({
      colorFormats: [this.colorFormat],
      depthStencilFormat: this.depthFormat,
      label: key,
      sampleCount: MSAA_SAMPLES,
    });
    encoder.setBindGroup(0, this.frameBindGroup);
    encoder.setBindGroup(1, cellBindGroup);
    encoder.setVertexBuffer(0, vertexBuffer);
    encoder.setIndexBuffer(indexBuffer, index16 ? 'uint16' : 'uint32');
    // Deterministic order: opaque first, then cutout (within the bundle; cross-cell order is submit-side).
    const ordered = [...groups].sort((a, b) => a.pipelineClass - b.pipelineClass);
    for (const group of ordered) {
      encoder.setPipeline(this.pipelines.get(pipelineIdFor(group.pipelineClass, group.side)));
      encoder.setBindGroup(2, this.textures.get(group.textureArrayRef).bindGroup);
      encoder.drawIndexed(group.indexCount, 1, group.indexOffset, 0, 0);
    }

    return encoder.finish({ label: key });
  }
}

function align4(bytes: number): number {
  return Math.ceil(bytes / 4) * 4;
}

/** One row per RANGE in the pak (a prop split across materials owns several) — group them by placement. */
function groupBreakables(rows: readonly OscellBreakable[]): CellHandle['breakables'] {
  const breakables: CellHandle['breakables'] = new Map();
  for (const row of rows) {
    const ranges = breakables.get(row.keyHash) ?? [];
    ranges.push({ indexCount: row.indexCount, indexOffset: row.indexOffset });
    breakables.set(row.keyHash, ranges);
  }

  return breakables;
}

/** `writeBuffer` requires a multiple-of-4 byte length — odd uint16 index counts need a padded copy. */
function pad4(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 4 === 0) {
    return bytes;
  }
  const padded = new Uint8Array(align4(bytes.byteLength));
  padded.set(bytes);

  return padded;
}
