// Headless field-check driver: boots the game with a FAKE showDirectoryPicker backed by game-server.js,
// captures console, waits for [bench]/[soak] report lines. See docs/development/benchmarks.md.
// Usage: NODE_PATH=$REPO/node_modules node drive.js <appUrl> <gameServer> <outPrefix> <timeoutMs> <expectReports>
// Env: DPR=2 (retina-equivalent render targets) · TAG='[soak]' (default '[bench]') · DRAG=<dy> (pitch camera)
const { chromium } = require('playwright');

const APP_URL = process.argv[2];
const GAME = process.argv[3] ?? 'http://localhost:8787';
const OUT = process.argv[4] ?? 'shot';
const TIMEOUT_MS = Number(process.argv[5] ?? 300000);
const EXPECT_REPORTS = Number(process.argv[6] ?? 1);
const TAG = process.env.TAG ?? '[bench]';

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
    if (text.includes(TAG) || text.includes('[slow]') || msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`console[${msg.type()}] ${text}`);
    }
    if (text.startsWith(TAG)) benchLines.push(text);
  });
  page.on('pageerror', (err) => console.log(`pageerror ${err.message}`));

  await page.addInitScript(`(() => {
    const GAME = ${JSON.stringify(GAME)};
    async function loadIndex() {
      const res = await fetch(GAME + '/__index');
      return res.json();
    }
    function makeFileHandle(relPath, size) {
      return {
        kind: 'file',
        name: relPath.split('/').pop(),
        async getFile() {
          const url = GAME + '/f/' + relPath.split('/').map(encodeURIComponent).join('/');
          return {
            name: relPath.split('/').pop(),
            size,
            async arrayBuffer() {
              const res = await fetch(url);
              return res.arrayBuffer();
            },
            slice(a, b) {
              return {
                async arrayBuffer() {
                  const res = await fetch(url, { headers: { Range: 'bytes=' + a + '-' + (b - 1) } });
                  return res.arrayBuffer();
                },
              };
            },
          };
        },
      };
    }
    function makeDirHandle(name, tree) {
      return {
        kind: 'directory',
        name,
        async *values() {
          for (const [key, value] of Object.entries(tree)) {
            yield value.__file ? makeFileHandle(value.path, value.size) : makeDirHandle(key, value);
          }
        },
        async getDirectoryHandle(child) {
          if (tree[child] && !tree[child].__file) return makeDirHandle(child, tree[child]);
          throw new DOMException('not found', 'NotFoundError');
        },
        async getFileHandle(child) {
          if (tree[child] && tree[child].__file) return makeFileHandle(tree[child].path, tree[child].size);
          throw new DOMException('not found', 'NotFoundError');
        },
        async queryPermission() { return 'granted'; },
        async requestPermission() { return 'granted'; },
      };
    }
    window.showDirectoryPicker = async () => {
      const index = await loadIndex();
      const tree = {};
      for (const { path, size } of index) {
        const parts = path.split('/');
        let node = tree;
        for (let i = 0; i < parts.length - 1; i += 1) {
          node[parts[i]] = node[parts[i]] || {};
          node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = { __file: true, path, size };
      }
      return makeDirHandle('game', tree);
    };
    const origPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      try {
        return origPut.apply(this, args);
      } catch (err) {
        if (err && err.name === 'DataCloneError') {
          const req = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }
        throw err;
      }
    };
  })();`);

  console.log(`goto ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
  if (await runButton.count()) {
    await runButton.first().click();
  }
  const chooseButton = page.getByText('Choose game folder', { exact: false });
  await chooseButton.first().click({ timeout: 30000 });
  console.log('folder chosen, waiting for canvas...');
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
    if (benchLines.some((line) => line.includes('sweep complete') || line.includes('"verdict"')) ||
        benchLines.filter((line) => line.includes('"key"') || line.includes('"scene"')).length >= EXPECT_REPORTS) {
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
