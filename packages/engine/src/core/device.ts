/**
 * Adapter/device init + the feature matrix the engine relies on (plan 074/01). Fails LOUDLY with a specific
 * message — the prod app keeps the three-WebGL path for unsupported browsers; the engine never soft-degrades.
 *
 * **BC is taken when offered, not demanded.** A pak built from SA assets carries BC textures and cannot be
 * displayed without it — but that is a property of THAT WORLD, not of the engine, and refusing the device up
 * front made every mobile GPU (which ship ETC2/ASTC, never BC) unbootable even for content that needs no BC
 * at all. The demand moved to where it can actually be judged: `beginOstexUpload` rejects a BC payload on a
 * device without BC, naming the texture. Hosts that know their world is BC keep gating before boot — the
 * game's shell does exactly that (`apps/web/src/ui/shell/webgpu-gate.ts`).
 */

export interface EngineDevice {
  /** Everything the ADAPTER offered, sorted — not what the device was granted. A mobile capture is read by
   *  this list and by what is missing from it (`docs/benchmarks/readme.md`, mobile schema). */
  adapterFeatures: string[];
  adapterInfo: string;
  /** The RENDER color format: the sRGB view of the swapchain — lighting is computed in linear space and the
   *  sRGB view encodes on write (without it the frame displays gamma-crushed / too dark). */
  colorFormat: GPUTextureFormat;
  device: GPUDevice;
  /** Whether CORE limits apply, read from the adapter's own `core-features-and-limits`. A compatibility
   *  adapter carries a REDUCED set, so a run taken on one is not comparable to a core one. */
  featureLevel: 'compatibility' | 'core';
  /** BC (DXT/BC7) compressed textures. False on mobile GPUs — only BC *content* is then unusable. */
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

/**
 * The `device` block a MOBILE benchmark row is required to carry
 * ([`docs/benchmarks/readme.md`](../../../../docs/benchmarks/readme.md)).
 *
 * `missing` is not decoration: on the 2026-08-04 Mali row the absence of `timestamp-query` removes the
 * `gpuMs` column the whole desktop series is read by, so what the adapter LACKS is what decides whether two
 * rows may be compared at all. A capture that states only what it has cannot be read six months later.
 */
export function describeDevice(
  engineDevice: EngineDevice,
  canvas: { clientHeight: number; clientWidth: number },
  dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio,
): {
  adapter: string;
  css: string;
  dpr: number;
  featureLevel: string;
  features: string[];
  missing: string[];
} {
  // Named rather than "everything WebGPU defines": the point is the features THIS project's rows turn on.
  const watched = ['texture-compression-astc', 'texture-compression-bc', 'texture-compression-etc2', 'timestamp-query'];

  return {
    adapter: engineDevice.adapterInfo,
    css: `${canvas.clientWidth}x${canvas.clientHeight}`,
    dpr,
    featureLevel: engineDevice.featureLevel,
    features: engineDevice.adapterFeatures,
    missing: watched.filter((feature) => !engineDevice.adapterFeatures.includes(feature)),
  };
}

export async function initDevice(): Promise<EngineDevice> {
  // The VALUE, not just the key: `'gpu' in navigator` is true whenever the property exists on the prototype,
  // and a browser that ships the accessor while returning undefined (policy-disabled builds, some mobile
  // browsers) then fell straight through to `.requestAdapter` and threw a bare TypeError instead of this.
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser (WebGPU is required — there is no fallback renderer)');
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('WebGPU adapter request failed (blocklisted GPU or disabled flag?)');
  }
  const hasBc = adapter.features.has('texture-compression-bc');
  const hasTimestamps = adapter.features.has('timestamp-query');
  // Every feature is requested only when the adapter offers it: `requestDevice` REJECTS a required feature
  // the adapter does not carry, so listing one unconditionally is the same as refusing the device.
  const required: GPUFeatureName[] = [];
  if (hasBc) {
    required.push('texture-compression-bc');
  }
  if (hasTimestamps) {
    required.push('timestamp-query');
  }
  const device = await adapter.requestDevice({ requiredFeatures: required });
  const info = adapter.info;

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  const adapterFeatures = [...adapter.features].sort();

  return {
    adapterFeatures,
    adapterInfo: `${info?.vendor ?? '?'} ${info?.architecture ?? ''}`.trim(),
    colorFormat: `${presentationFormat}-srgb` as GPUTextureFormat,
    device,
    featureLevel: adapterFeatures.includes('core-features-and-limits') ? 'core' : 'compatibility',
    hasBc,
    hasTimestamps,
    presentationFormat,
  };
}
