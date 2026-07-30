// Headless field-check driver: boots the game through the REAL load path — the http-dir loader
// (?loader=http-dir&src=<served build>) — with NO fake picker. Captures console, waits for [bench]/[soak]
// report lines, screenshots on exit. See docs/development/benchmarks.md.
// Usage: NODE_PATH=$REPO/node_modules node drive.js <appUrl> <outPrefix> <timeoutMs> <expectReports>
//   appUrl MUST carry ?loader=http-dir&src=<serve-static build URL> (+ ?bench=/?soak=).
// Env: DPR=2 (retina-equivalent render targets) · TAG='[soak]' (default '[bench]') · DRAG=<dy> (pitch camera)
//   ALSO='[cam]' echoes a SECOND protocol without counting it as a report — a run whose acceptance depends
//   on another subsystem's diagnostics (096/03 reads the `[cam] jump` watchdog while collecting `[video]`).
const { chromium } = require('playwright');

const APP_URL = process.argv[2];
const OUT = process.argv[3] ?? 'shot';
const TIMEOUT_MS = Number(process.argv[4] ?? 300000);
const EXPECT_REPORTS = Number(process.argv[5] ?? 1);
const TAG = process.env.TAG ?? '[bench]';
const ALSO = process.env.ALSO ?? '';

(async () => {
  const browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'],
    headless: true,
  });
  const dpr = Number(process.env.DPR ?? 1);
  const page = await browser.newPage({ deviceScaleFactor: dpr, viewport: { height: 900, width: 1440 } });
  console.log(`deviceScaleFactor=${dpr}`);
  const benchLines = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (
      text.includes(TAG) ||
      (ALSO && text.includes(ALSO)) ||
      text.includes('[slow]') ||
      msg.type() === 'error' ||
      msg.type() === 'warning'
    ) {
      console.log(`console[${msg.type()}] ${text}`);
    }
    if (text.startsWith(TAG)) benchLines.push(text);
  });
  page.on('pageerror', (err) => console.log(`pageerror ${err.message}`));

  console.log(`goto ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  // http-dir loads straight from ?src — click the game and wait; no "Choose game folder" step.
  // WAIT for the button first: `domcontentloaded` fires before React has rendered the menu, so an
  // immediate `count()` reads 0, the click is silently skipped and the run then times out on a canvas
  // that was never asked for.
  const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
  await runButton
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .catch(() => console.log('run button never appeared'));
  if (await runButton.count()) {
    await runButton.first().click();
  }
  console.log('game selected, waiting for canvas...');
  await page.waitForSelector('canvas', { timeout: 240000 });
  console.log('canvas up, waiting for bench sweep...');
  // DRAG=dy pitches the camera via the host's no-pointer-lock drag fallback (positive dy = drag down).
  const drag = Number(process.env.DRAG ?? 0);
  if (drag) {
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(720, 450 + drag, { steps: 25 });
    await page.mouse.up();
    console.log(`dragged dy=${drag}`);
  }

  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (
      benchLines.some((line) => line.includes('sweep complete') || line.includes('"verdict"')) ||
      benchLines.filter((line) => line.includes('"key"') || line.includes('"scene"')).length >= EXPECT_REPORTS
    ) {
      break;
    }
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${OUT}.png` });
  console.log(`screenshot ${OUT}.png`);
  console.log('--- bench lines ---');
  for (const line of benchLines) console.log(line);
  await browser.close();
})().catch((err) => {
  console.error('drive failed:', err);
  process.exit(1);
});
