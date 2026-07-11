/**
 * Throwaway on-screen frame profiler for the WebGPU spike (docs/concepts/webgpu-migration, plan 073/08 field
 * debugging). Splits the game loop into its segments — fixed-step physics catch-up, per-frame systems, the
 * synchronous render call — next to the REAL frame interval (rAF-to-rAF): render CPU can be low while frames are
 * long, and the missing milliseconds are either in a loop segment (visible here) or on the GPU (no segment grows
 * — the rAF itself is paced by GPU backpressure). Only created under `?webgpu=1`.
 */
export interface WebgpuHudSample {
  bundled: boolean;
  /** Bundle-level culling result: hidden/total cell containers (verifies the culling actually engages). */
  culled: { hidden: number; total: number };
  drawCalls: number;
  /** Fixed-step catch-up: total ms this frame + how many steps ran (death-spiral indicator). */
  fixedMs: number;
  fixedSteps: number;
  renderMs: number;
  /** systems.update + camera + plugin updates. */
  updateMs: number;
}

export function createWebgpuHud(): (sample: WebgpuHudSample) => void {
  // GC-vs-GPU discriminator (073/08): long main-thread tasks BETWEEN our rAF callbacks (GC, worker sync,
  // browser work) land in "unaccounted" exactly like GPU time — count them separately via PerformanceObserver,
  // and watch the JS heap: a steep sawtooth = an allocation storm (our legacy), a flat heap + no long tasks
  // while unaccounted stays large = the time is GPU/present (three's WebGPU backend).
  let longTaskMs = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskMs += entry.duration;
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskMs = -1; // longtask API unavailable
  }
  const heap = (): number =>
    ((performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / (1024 * 1024);
  let lastHeap = heap();
  let heapDelta = 0;
  let lastLongTaskWindow = 0;

  const element = document.createElement('pre');
  element.style.cssText =
    'position:fixed;top:12px;right:12px;margin:0;padding:8px 10px;background:rgba(0,0,0,.7);color:#0f0;' +
    'font:12px monospace;border-radius:6px;white-space:pre;z-index:10000;pointer-events:none';
  document.body.append(element);

  const render: number[] = [];
  const fixed: number[] = [];
  const update: number[] = [];
  const frames: number[] = [];
  let steps = 0;
  let previous = performance.now();

  const avg = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

  return (sample) => {
    const now = performance.now();
    frames.push(now - previous);
    previous = now;
    render.push(sample.renderMs);
    fixed.push(sample.fixedMs);
    update.push(sample.updateMs);
    steps = Math.max(steps, sample.fixedSteps);
    if (render.length > 120) {
      render.shift();
      fixed.shift();
      update.shift();
      frames.shift();
      steps = sample.fixedSteps;
    }
    const frameAvg = avg(frames);
    // Refresh the heap/longtask window ~once a second (cheap; readable numbers).
    if (frames.length % 60 === 0) {
      const current = heap();
      heapDelta = current - lastHeap;
      lastHeap = current;
      lastLongTaskWindow = longTaskMs;
      longTaskMs = 0;
    }
    element.textContent =
      `WebGPU ${sample.bundled ? '(per-cell bundles)' : '(no bundle)'}\n` +
      `frame       ${frameAvg.toFixed(1)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps), max ${Math.max(...frames).toFixed(0)}\n` +
      `render CPU  ${avg(render).toFixed(2)} ms\n` +
      `fixed       ${avg(fixed).toFixed(1)} ms (steps ≤ ${steps})\n` +
      `update      ${avg(update).toFixed(1)} ms\n` +
      `unaccounted ${Math.max(0, frameAvg - avg(render) - avg(fixed) - avg(update)).toFixed(1)} ms ← GPU/compositor if large\n` +
      `draws       ${sample.drawCalls}\n` +
      `cells       ${sample.culled.total - sample.culled.hidden}/${sample.culled.total} visible\n` +
      `long tasks  ${lastLongTaskWindow < 0 ? 'n/a' : `${lastLongTaskWindow.toFixed(0)} ms/s`} ← GC/main-thread stalls\n` +
      `js heap     ${lastHeap.toFixed(0)} MB (${heapDelta >= 0 ? '+' : ''}${heapDelta.toFixed(0)} MB/s)`;
  };
}
