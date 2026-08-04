/**
 * WebGPU boot gate (plan 074/10, WebGPU-first): the own engine IS the game, with no WebGL fallback.
 *
 * The probe asks ONE question — can this browser give us a device at all — and deliberately not a second.
 * It used to also demand `texture-compression-bc`, which conflated the DEVICE with the CONTENT: a phone
 * whose browser runs WebGPU perfectly well was told its browser does not support WebGPU, because the world
 * we happened to ship was BC. Whether a given world can be displayed is read from that world's manifest
 * instead (`requireWorldSupport`, at stream setup), where the answer is true and specific.
 */

type GpuLike = Pick<GPU, 'requestAdapter'>;

export async function probeWebGpuSupport(gpu: GpuLike | null | undefined = navigator.gpu): Promise<boolean> {
  // The VALUE, not just the key: a browser that ships the accessor while returning undefined would otherwise
  // fall through to `.requestAdapter` and throw a bare TypeError (the same trap `initDevice` guards).
  if (!gpu) {
    return false;
  }
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });

    return adapter !== null;
  } catch {
    return false;
  }
}
