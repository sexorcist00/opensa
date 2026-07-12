/**
 * Adapter/device init + the feature matrix the engine relies on (plan 074/01). Fails LOUDLY with a specific
 * message — the prod app keeps the three-WebGL path for unsupported browsers; the engine never soft-degrades.
 */

export interface EngineDevice {
  adapterInfo: string;
  /** The RENDER color format: the sRGB view of the swapchain — lighting is computed in linear space and the
   *  sRGB view encodes on write (without it the frame displays gamma-crushed / too dark). */
  colorFormat: GPUTextureFormat;
  device: GPUDevice;
  /** BC (DXT/BC7) compressed textures — required (the world's textures ship BC). */
  hasBc: boolean;
  /** GPU timestamps for the per-pass HUD (optional — HUD falls back to CPU-only timings). */
  hasTimestamps: boolean;
  presentationFormat: GPUTextureFormat;
}

/** Configure a canvas for the device (opaque, device pixel ratio capped like the prod renderer). */
export function configureCanvas(canvas: HTMLCanvasElement, engineDevice: EngineDevice, dprCap = 2): GPUCanvasContext {
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('canvas.getContext("webgpu") returned null');
  }
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  context.configure({
    alphaMode: 'opaque',
    device: engineDevice.device,
    format: engineDevice.presentationFormat,
    viewFormats: [engineDevice.colorFormat], // resolve into the sRGB view (linear→sRGB encode on write)
  });

  return context;
}

export async function initDevice(): Promise<EngineDevice> {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU is not available in this browser (the prod app serves the WebGL path instead)');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('WebGPU adapter request failed (blocklisted GPU or disabled flag?)');
  }
  const hasBc = adapter.features.has('texture-compression-bc');
  if (!hasBc) {
    throw new Error('texture-compression-bc is unsupported — the native world textures require BC');
  }
  const hasTimestamps = adapter.features.has('timestamp-query');
  const required: GPUFeatureName[] = ['texture-compression-bc'];
  if (hasTimestamps) {
    required.push('timestamp-query');
  }
  const device = await adapter.requestDevice({ requiredFeatures: required });
  const info = adapter.info;

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  return {
    adapterInfo: `${info?.vendor ?? '?'} ${info?.architecture ?? ''}`.trim(),
    colorFormat: `${presentationFormat}-srgb` as GPUTextureFormat,
    device,
    hasBc,
    hasTimestamps,
    presentationFormat,
  };
}
