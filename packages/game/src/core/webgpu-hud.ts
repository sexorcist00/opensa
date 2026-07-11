/**
 * Throwaway on-screen render-CPU meter for the WebGPU spike (Phase 1, docs/concepts/webgpu-migration). Shows the
 * rolling average of the synchronous `pipeline.render()` CPU time — the number to compare against the WebGL
 * baseline (~65 ms `ls-noon`). Only created under `?webgpu=1`.
 */
export function createWebgpuHud(): (renderMs: number, drawCalls: number, bundled: boolean) => void {
  const element = document.createElement('pre');
  element.style.cssText =
    'position:fixed;top:12px;right:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
    'font:12px monospace;border-radius:6px;white-space:pre;z-index:10000;pointer-events:none';
  document.body.append(element);

  const samples: number[] = [];

  return (renderMs, drawCalls, bundled) => {
    samples.push(renderMs);
    if (samples.length > 120) {
      samples.shift();
    }
    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    element.textContent =
      `WebGPU ${bundled ? '(per-cell bundles)' : '(no bundle)'}\n` +
      `render CPU  ${avg.toFixed(2)} ms\n` +
      `draws       ${drawCalls}\n` +
      `baseline    ~65 ms (WebGL)`;
  };
}
