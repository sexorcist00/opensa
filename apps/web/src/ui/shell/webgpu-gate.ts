/**
 * WebGPU boot gate (plan 074/10, WebGPU-first): the own engine IS the game, with no WebGL fallback.
 * The probe mirrors the engine's `initDevice` hard requirements — an adapter must exist AND carry
 * `texture-compression-bc` (the native world textures are BC-encoded) — so a browser that passes the
 * gate can actually boot the engine instead of failing later behind the load veil.
 */

type GpuLike = Pick<GPU, 'requestAdapter'>;

export async function probeWebGpuSupport(gpu: GpuLike | null | undefined = navigator.gpu): Promise<boolean> {
  if (!gpu) {
    return false;
  }
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });

    return adapter !== null && adapter.features.has('texture-compression-bc');
  } catch {
    return false;
  }
}
