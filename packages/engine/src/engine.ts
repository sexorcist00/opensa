/**
 * The M0 engine facade (plan 074/01): device + enumerated pipelines + texture arrays + cell bundles + ONE
 * MSAA pass (opaque/cutout world, flat sky clear) with per-pass GPU timestamps. Later milestones grow the
 * fixed frame graph (sky/transparent/water/post) — the facade's API stays.
 */
import { configureCanvas, type EngineDevice, initDevice } from './core/device';
import {
  frustumFromViewProj,
  frustumIntersectsSphere,
  type Mat4,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4PerspectiveZO,
  type Vec3,
} from './core/math';
import { Resources } from './core/resources';
import { GpuTimers } from './debug/gpu-timers';
import { compileAll, MSAA_SAMPLES, type PipelineSet } from './render/pipelines';
import { CellStore } from './world/cells';
import { TextureArrays } from './world/textures';

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export interface CameraState {
  aspect: number;
  eye: Vec3;
  far: number;
  fovYRad: number;
  near: number;
  target: Vec3;
  up: Vec3;
}

export interface EngineStats {
  cellsTotal: number;
  cellsVisible: number;
  drawsRecorded: number;
  gpuPassMs: number;
  residencyBytes: number;
  submitMs: number;
}

export class Engine {
  cells!: CellStore;
  /** Flat sky clear (M0 stand-in for the sky pass). */
  skyColor: GPUColor = { a: 1, b: 0.86, g: 0.71, r: 0.53 };

  textures!: TextureArrays;

  get adapterInfo(): string {
    return this.engineDevice.adapterInfo;
  }
  get device(): GPUDevice {
    return this.engineDevice.device;
  }
  private canvasContext!: GPUCanvasContext;
  private depthView!: GPUTextureView;
  private engineDevice!: EngineDevice;
  private frameBindGroup!: GPUBindGroup;
  private frameUniform!: GPUBuffer;
  private readonly frustumPlanes = new Float32Array(24);
  private msaaView!: GPUTextureView;
  private pipelines!: PipelineSet;
  private readonly proj: Mat4 = mat4Identity();
  private resources!: Resources;
  private readonly statsValue: EngineStats = {
    cellsTotal: 0,
    cellsVisible: 0,
    drawsRecorded: 0,
    gpuPassMs: 0,
    residencyBytes: 0,
    submitMs: 0,
  };
  private targetSize = { height: 0, width: 0 };
  private timers!: GpuTimers;

  private readonly view: Mat4 = mat4Identity();

  private readonly viewProj: Mat4 = mat4Identity();

  /** Render one frame. Returns the stats snapshot (the HUD's input). */
  frame(camera: CameraState): EngineStats {
    const submitStart = performance.now();
    const canvasTexture = this.canvasContext.getCurrentTexture();
    this.ensureTargets(canvasTexture.width, canvasTexture.height);

    mat4PerspectiveZO(this.proj, camera.fovYRad, camera.aspect, camera.near, camera.far);
    mat4LookAt(this.view, camera.eye, camera.target, camera.up);
    mat4Multiply(this.viewProj, this.proj, this.view);
    const frameData = new Float32Array(20);
    frameData.set(this.viewProj, 0);
    frameData.set([...camera.eye, 1], 16);
    this.device.queue.writeBuffer(this.frameUniform, 0, frameData);

    frustumFromViewProj(this.frustumPlanes, this.viewProj);
    const bundles: GPURenderBundle[] = [];
    let draws = 0;
    let total = 0;
    for (const cell of this.cells.all()) {
      total += 1;
      cell.visible = frustumIntersectsSphere(
        this.frustumPlanes,
        cell.bounds[0],
        cell.bounds[1],
        cell.bounds[2],
        cell.bounds[3],
      );
      if (cell.visible) {
        bundles.push(cell.bundle);
        draws += cell.draws;
      }
    }

    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          clearValue: this.skyColor,
          loadOp: 'clear',
          resolveTarget: canvasTexture.createView(),
          storeOp: 'discard',
          view: this.msaaView,
        },
      ],
      depthStencilAttachment: {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        view: this.depthView,
      },
      label: 'world',
      ...this.timers.passTimestampWrites(),
    });
    if (bundles.length > 0) {
      pass.executeBundles(bundles);
    }
    pass.end();
    this.timers.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timers.read();

    this.statsValue.submitMs = performance.now() - submitStart;
    this.statsValue.gpuPassMs = this.timers.lastPassMs;
    this.statsValue.cellsTotal = total;
    this.statsValue.cellsVisible = bundles.length;
    this.statsValue.drawsRecorded = draws;
    this.statsValue.residencyBytes = this.resources.totalBytes();

    return this.statsValue;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.engineDevice = await initDevice();
    this.canvasContext = configureCanvas(canvas, this.engineDevice);
    this.resources = new Resources(this.device);
    this.timers = new GpuTimers(this.device, this.engineDevice.hasTimestamps);
    this.pipelines = compileAll(this.device, this.engineDevice.presentationFormat, DEPTH_FORMAT);
    this.frameUniform = this.resources.createBuffer('uniform', {
      label: 'frame',
      size: 80, // mat4 (64) + camera vec4 (16)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.frameBindGroup = this.device.createBindGroup({
      entries: [{ binding: 0, resource: { buffer: this.frameUniform } }],
      label: 'frame',
      layout: this.pipelines.frameLayout,
    });
    this.textures = new TextureArrays(this.device, this.resources, this.pipelines.materialLayout);
    this.cells = new CellStore({
      colorFormat: this.engineDevice.presentationFormat,
      depthFormat: DEPTH_FORMAT,
      device: this.device,
      frameBindGroup: this.frameBindGroup,
      pipelines: this.pipelines,
      resources: this.resources,
      textures: this.textures,
    });
    this.ensureTargets(canvas.width, canvas.height);
  }

  /** Residency ledger passthrough (HUD + leak assertions). */
  ledger(): ReturnType<Resources['ledger']> {
    return this.resources.ledger();
  }

  private ensureTargets(width: number, height: number): void {
    if (this.targetSize.width === width && this.targetSize.height === height) {
      return;
    }
    this.targetSize = { height, width };
    const bytes = width * height * (4 + 4) * MSAA_SAMPLES; // color + depth estimate
    const msaa = this.resources.createTexture(
      'target',
      {
        format: this.engineDevice.presentationFormat,
        label: 'msaa-color',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    const depth = this.resources.createTexture(
      'target',
      {
        format: DEPTH_FORMAT,
        label: 'msaa-depth',
        sampleCount: MSAA_SAMPLES,
        size: { height, width },
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      },
      bytes / 2,
    );
    this.msaaView = msaa.createView();
    this.depthView = depth.createView();
  }
}
