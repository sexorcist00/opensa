/**
 * Static-world cell store (plan 074/01): one `.oscell` blob → GPU buffers + a recorded `GPURenderBundle`
 * replayed while the cell is frustum-visible. Record happens ONCE at load (we own record time — no version
 * dances); unload destroys everything and the residency ledger must return to its prior line.
 */
import { decodeOscell, OscellChannel, type OscellGroup, type OscellObject } from '@opensa/engine-formats';

import type { Resources } from '../core/resources';
import type { PipelineSet } from '../render/pipelines';
import type { TextureArrays } from './textures';

import { MSAA_SAMPLES, pipelineIdFor } from '../render/pipelines';

export interface CellHandle {
  /** World-space bounding sphere [x, y, z, r] (cell bounds shifted by origin). */
  bounds: readonly [number, number, number, number];
  bundle: GPURenderBundle;
  cellBindGroup: GPUBindGroup;
  draws: number;
  index16: boolean;
  indexBuffer: GPUBuffer;
  key: string;
  /** ObjectTable draws (074/06 row 9) — outside the bundle; the frame gates them (timed by hour). */
  objects: { groups: OscellGroup[]; kind: number; params: number }[];
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
    const bundle = this.record(key, bundleGroups, cell.index16, vertexBuffer, indexBuffer, cellBindGroup);
    const handle: CellHandle = {
      bounds: [
        cell.bounds[0] + cell.origin[0],
        cell.bounds[1] + cell.origin[1],
        cell.bounds[2] + cell.origin[2],
        cell.bounds[3],
      ],
      bundle,
      cellBindGroup,
      draws: bundleGroups.length,
      index16: cell.index16,
      indexBuffer,
      key,
      objects: cell.objects.map((object: OscellObject) => ({
        groups: cell.groups.slice(object.groupStart, object.groupStart + object.groupCount),
        kind: object.kind,
        params: object.params,
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

/** `writeBuffer` requires a multiple-of-4 byte length — odd uint16 index counts need a padded copy. */
function pad4(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength % 4 === 0) {
    return bytes;
  }
  const padded = new Uint8Array(align4(bytes.byteLength));
  padded.set(bytes);

  return padded;
}
