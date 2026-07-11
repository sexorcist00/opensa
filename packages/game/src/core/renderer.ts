import { type Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';

export interface RenderContext {
  camera: PerspectiveCamera;
  /** WebGPU spike: a fresh per-cell `BundleGroup` factory (record-once) — streaming wraps each cell's objects. */
  cellContainer?: () => Object3D;
  renderer: WebGLRenderer;
  scene: Scene;
  /** Phase-1 WebGPU spike (`?webgpu=1`, docs/concepts/webgpu-migration): the renderer is a `WebGPURenderer`.
   *  Custom GLSL materials/plugins don't apply — game.ts skips plugin installs + the WebGL GPU timer. */
  webgpu: boolean;
}

/** Create the renderer/scene/camera the engine owns, bound to a canvas element. Async: WebGPU needs `init()`. */
export async function createRenderContext(canvas: HTMLCanvasElement): Promise<RenderContext> {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const camera = new PerspectiveCamera(60, width / height, 0.1, 100000);
  camera.position.set(0, 50, 100);
  const scene = new Scene();

  const search = new URLSearchParams(window.location.search);
  if (search.get('webgpu') === '1') {
    // three's WebGPURenderer auto-converts standard materials to nodes, so the world renders with base materials
    // (the onBeforeCompile GLSL just doesn't apply); plugins that author raw GLSL / use `postprocessing` are
    // skipped in game.ts. Typed as WebGLRenderer for the engine's sake — the API surface we use overlaps.
    const { BundleGroup, WebGPURenderer } = await import('three/webgpu');
    const renderer = new WebGPURenderer({ antialias: true, canvas });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    await renderer.init();

    // `?bundle=0` disables the per-cell BundleGroups — the in-engine A/B for the render-bundle win.
    const bundles = search.get('bundle') !== '0';

    return {
      camera,
      ...(bundles ? { cellContainer: (): Object3D => new BundleGroup() } : {}),
      renderer: renderer as unknown as WebGLRenderer,
      scene,
      webgpu: true,
    };
  }

  const renderer = new WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);

  return { camera, renderer, scene, webgpu: false };
}
