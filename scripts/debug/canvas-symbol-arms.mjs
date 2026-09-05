/**
 * What a symbology mark COSTS to draw, both ways, in a real Canvas2D — the desk-side control for 201/9-01.
 *
 *   node scripts/debug/canvas-symbol-arms.mjs [--browser /opt/pw-browsers/chromium]
 *
 * **What it answers.** `apps/dispatch/src/map/symbol-sprites.ts` bakes each mark once and blits it per
 * instance instead of rebuilding its path every frame. The device this console is aimed at has no
 * `timestamp-query`, so on the phone that change is priced by flying `nosprites` against `board` — and
 * that needs a device, a settled window and a thermal bracket. This answers the narrower question at a
 * desk in ten seconds: *is a blit cheaper than the path at all, and by how much*.
 *
 * **What it is NOT.** A phone's number. A desktop GPU and a Bifrost are different machines and the ratio
 * does not carry. Its use is a sanity floor under the device measurement, and — the reason it was written —
 * a SCALE: if 150 marks cost a fraction of a millisecond here while the phone reports several, then the
 * drawing is not what dominates that span on the device and the next place to look is everything else the
 * layer does per unit.
 *
 * Both arms are run TWICE and interleaved, because a delta taken from two blocks run back to back includes
 * whatever the machine was doing between them.
 */
import { chromium } from 'playwright';

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);

  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback);
};
const executablePath = flag('browser', '');
const browser = await chromium.launch(executablePath === '' ? {} : { executablePath });
const page = await browser.newPage();

const result = await page.evaluate(() => {
  const W = 720;
  const H = 640;
  const N = 150;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  // The marks the layer places, fixed so both arms draw the same picture in the same places.
  const units = Array.from({ length: N }, (_, i) => ({
    angle: (i / N) * Math.PI * 2,
    color: ['#4ade80', '#fbbf24', '#60a5fa', '#f87171'][i % 4],
    x: 20 + ((i * 37) % (W - 40)),
    y: 20 + ((i * 61) % (H - 40)),
  }));

  function path(x, y, angle, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(13, 0);
    ctx.lineTo(5, -5);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  const sprites = new Map();
  function spriteFor(color) {
    let held = sprites.get(color);
    if (!held) {
      held = document.createElement('canvas');
      held.width = 64;
      held.height = 64;
      const sctx = held.getContext('2d');
      sctx.setTransform(2, 0, 0, 2, 0, 0);
      sctx.translate(16, 16);
      sctx.beginPath();
      sctx.arc(0, 0, 7, 0, Math.PI * 2);
      sctx.fillStyle = color;
      sctx.fill();
      sctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
      sctx.lineWidth = 1.4;
      sctx.stroke();
      sctx.beginPath();
      sctx.moveTo(13, 0);
      sctx.lineTo(5, -5);
      sctx.lineTo(5, 5);
      sctx.closePath();
      sctx.fillStyle = color;
      sctx.fill();
      sprites.set(color, held);
    }

    return held;
  }

  function blit(x, y, angle, color) {
    const sprite = spriteFor(color);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(sprite, -16, -16, 32, 32);
    ctx.restore();
  }

  /**
   * A sample is a BLOCK of frames, not one frame.
   *
   * `performance.now()` is clamped to ~100 us in a browser, and one frame of 150 marks lands at 0.3-0.4 ms
   * — three or four ticks, so every per-frame sample quantizes onto the same handful of values and the mean
   * of them wobbles by more than the effect. Timing {@link BLOCK} frames at once puts a sample two orders
   * above the clamp; the per-frame number is that divided back down.
   */
  const BLOCK = 40;
  function timeArm(draw, blocks) {
    // Warm: first touch of a backing store and the first sprite raster are not what a steady frame pays.
    for (let f = 0; f < 40; f += 1) {
      ctx.clearRect(0, 0, W, H);
      for (const unit of units) {
        draw(unit.x, unit.y, unit.angle + f * 0.01, unit.color);
      }
    }
    const samples = [];
    for (let block = 0; block < blocks; block += 1) {
      const at = performance.now();
      for (let f = 0; f < BLOCK; f += 1) {
        ctx.clearRect(0, 0, W, H);
        for (const unit of units) {
          draw(unit.x, unit.y, unit.angle + f * 0.01, unit.color);
        }
      }
      samples.push((performance.now() - at) / BLOCK);
    }
    samples.sort((a, b) => a - b);

    return {
      blockFrames: BLOCK,
      mean: Number((samples.reduce((sum, ms) => sum + ms, 0) / samples.length).toFixed(4)),
      p50: Number(samples[Math.floor(samples.length / 2)].toFixed(4)),
      p95: Number(samples[Math.floor(samples.length * 0.95)].toFixed(4)),
      samples: samples.length,
    };
  }

  // Interleaved, twice each: a delta taken from two blocks run back to back is a delta that includes
  // whatever the machine was doing between them.
  const a1 = timeArm(path, 30);
  const b1 = timeArm(blit, 30);
  const a2 = timeArm(path, 30);
  const b2 = timeArm(blit, 30);

  return { blit: [b1, b2], path: [a1, a2], units: N };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));
