/**
 * Does the built web app actually BOOT, served the way the phone serves it?
 *
 * **The gap this closes cost a round trip on 2026-08-31.** `prebuilt/opensa-webapp.tar.gz` was rebuilt
 * without `--base=./`, so every asset path came out absolute (`/assets/…`). The phone serves the app from
 * `http://localhost:3001/build/webapp/`, where an absolute path resolves to the SERVER root and 404s — the
 * boot shell paints, the module never runs, and the console sits on `starting…` with no error anywhere. The
 * archive's own README warns about exactly this; nothing checked it, and the first check written did not
 * catch it either, because it served `dist/` at the ROOT, where the absolute path happens to work.
 *
 * So this serves the build from a SUBDIRECTORY on purpose, and fails on the two things that are invisible
 * from the outside: a page still reading `starting…` after the boot window, and any request that 404s.
 *
 *   npx tsx scripts/debug/webapp-smoke.ts                    # builds nothing; expects dist/ to exist
 *   npx tsx scripts/debug/webapp-smoke.ts --dir build/webapp # or check what is actually unpacked
 *
 * It needs a chromium Playwright can launch. `--browser <path>` names one when the pinned download is not
 * there (a container with its own browser build, which is the usual case here).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);

  return at >= 0 && args[at + 1] !== undefined ? String(args[at + 1]) : fallback;
};

const source = flag('dir', 'dist');
const browserPath = flag('browser', '');
const port = Number(flag('port', '4610'));
/** The path the phone serves the app under — the whole point of this check. */
const SERVED_UNDER = 'build/webapp';
const BOOT_MS = Number(flag('wait', '8000'));

if (!existsSync(join(source, 'dispatch.html'))) {
  console.error(`no ${source}/dispatch.html — run \`npm run build -- --base=./\` first`);
  process.exit(1);
}

async function main(): Promise<void> {
  const root = join(process.cwd(), 'build', '.webapp-smoke');
  rmSync(root, { force: true, recursive: true });
  mkdirSync(join(root, SERVED_UNDER), { recursive: true });
  cpSync(source, join(root, SERVED_UNDER), { recursive: true });

  const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
  const stop = (): void => void server.kill();
  process.on('exit', stop);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const browser = await chromium.launch(browserPath === '' ? {} : { executablePath: browserPath });
  const page = await browser.newPage({ viewport: { height: 609, width: 360 } });
  const failures: string[] = [];
  // The phone panel is not running here and the console probes it; that is absence, not breakage.
  const expected = (url: string): boolean => url.includes(':8787/') || url.endsWith('.pmtiles');
  page.on('requestfailed', (request) => {
    if (!expected(request.url())) {
      failures.push(`REQUEST FAILED ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    // The panel and a pak this check does not serve are expected to be absent; an ASSET 404 is the bug.
    if (response.status() >= 400 && response.url().includes('/assets/')) {
      failures.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => failures.push(`PAGE ERROR ${String(error).slice(0, 200)}`));

  const url = `http://localhost:${port}/${SERVED_UNDER}/dispatch.html?demo=1&units=0&calls=0&inventory=1`;
  await page.goto(url, { waitUntil: 'load' });
  await new Promise((resolve) => setTimeout(resolve, BOOT_MS));

  const text = (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\n/g, ' | ');
  const canvases = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}`),
  );
  await browser.close();
  stop();

  const stuck = text.toLowerCase().includes('starting');
  console.log(`served under /${SERVED_UNDER}/ from ${source}`);
  console.log(`canvases: ${JSON.stringify(canvases)}`);
  console.log(`text:     ${text}`);
  if (stuck) {
    console.error('\nSTUCK ON `starting…` — the module never ran. Absolute asset paths are the usual cause:');
    console.error('  rebuild with `npm run build -- --base=./` (see prebuilt/README.md).');
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed request(s):`);
    for (const failure of failures.slice(0, 10)) {
      console.error(`  ${failure}`);
    }
  }
  process.exitCode = stuck || failures.length > 0 ? 1 : 0;
}

void main();
