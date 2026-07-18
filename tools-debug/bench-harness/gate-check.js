// WebGPU boot-gate verification (plan 074/10): three modes over the same fake-picker harness.
//   canvas <url>  — boot to canvas, then report which context type the game canvas holds
//   sorry  <url>  — launch WITHOUT WebGPU and expect the sorry screen instead of the menu
// Usage: NODE_PATH=$REPO/node_modules node gate-check.js <mode> <appUrl> <gameServer> <outPrefix>
const { chromium } = require('playwright');

const MODE = process.argv[2];
const APP_URL = process.argv[3];
const GAME = process.argv[4] ?? 'http://localhost:8787';
const OUT = process.argv[5] ?? 'gate';

(async () => {
  const args =
    MODE === 'sorry'
      ? ['--disable-features=WebGPU']
      : ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--use-angle=metal'];
  const browser = await chromium.launch({ args, headless: true });
  const page = await browser.newPage({ viewport: { height: 900, width: 1440 } });
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
            async arrayBuffer() { const res = await fetch(url); return res.arrayBuffer(); },
            slice(a, b) {
              return { async arrayBuffer() {
                const res = await fetch(url, { headers: { Range: 'bytes=' + a + '-' + (b - 1) } });
                return res.arrayBuffer();
              } };
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
    IDBObjectStore.prototype.put = function (...args2) {
      try { return origPut.apply(this, args2); } catch (err) {
        if (err && err.name === 'DataCloneError') {
          const req = { onsuccess: null, onerror: null };
          setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
          return req;
        }
        throw err;
      }
    };
  })();`);

  console.log(`mode=${MODE} goto ${APP_URL}`);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  if (MODE === 'sorry') {
    const gpu = await page.evaluate(() => ({
      hasNavigatorGpu: 'gpu' in navigator && !!navigator.gpu,
    }));
    console.log(`navigator.gpu present: ${gpu.hasNavigatorGpu}`);
    try {
      await page.getByText('does not support', { exact: false }).waitFor({ timeout: 15000 });
      console.log('SORRY SCREEN: visible');
    } catch {
      console.log('SORRY SCREEN: NOT FOUND — dumping visible text');
      console.log(await page.evaluate(() => document.body.innerText.slice(0, 500)));
    }
    const menuVisible = await page.getByText('RUN SAN ANDREAS', { exact: false }).count();
    console.log(`menu visible: ${menuVisible > 0}`);
  } else {
    const runButton = page.getByText('RUN SAN ANDREAS', { exact: false });
    if (await runButton.count()) await runButton.first().click();
    await page.getByText('Choose game folder', { exact: false }).first().click({ timeout: 30000 });
    console.log('folder chosen, waiting for canvas...');
    await page.waitForSelector('canvas', { timeout: 240000 });
    await page.waitForTimeout(15000); // let the world settle so the shot shows geometry
    // WebGPU is the only context the app can boot on since 074/13 phase 5 deleted the three path.
    const webgpu = await page.evaluate(() => {
      const canvas = document.querySelector('.sa-game canvas') ?? document.querySelector('canvas');
      try {
        return !!canvas.getContext('webgpu');
      } catch {
        return false;
      }
    });
    console.log(`canvas context: webgpu=${webgpu}`);
  }

  await page.screenshot({ path: `${OUT}.png` });
  console.log(`screenshot ${OUT}.png`);
  await browser.close();
})().catch((err) => {
  console.error('gate-check failed:', err);
  process.exit(1);
});
