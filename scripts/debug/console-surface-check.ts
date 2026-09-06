/**
 * Does the console's chrome actually FIT a phone, and can a finger hit it?
 *
 * **The check the cross-platform restriction has been asking for since it was written.**
 * [`docs/restrictions/cross-platform-surface.md`](../../docs/restrictions/cross-platform-surface.md) states
 * five questions a new control must answer, says the failure is SILENT in every way this repo can be silent
 * — it typechecks, it lints, every test passes because a test asserts behaviour and this is geometry — and
 * then says *"nothing in this repository measures a touch target, and no benchmark row has ever contained
 * one."* This measures two of the five, which are the two that have actually bitten:
 *
 * - **Nothing past the right edge at 360 CSS px.** The 2026-08-25 failure was not small controls, it was
 *   controls that were NOT ON THE SCREEN: the bar came to 403 px inside a 360-px phone and the map's
 *   right-hand cluster sat past the edge with nothing to scroll to. The top bar carries `overflow: hidden`,
 *   so anything that does not fit is CLIPPED rather than pushed — invisible, and invisible in a screenshot.
 * - **≥ 44 CSS px in both axes where the pointer is coarse** (`TOUCH_TARGET`), which is what WCAG 2.5.5,
 *   Apple's HIG and Material all agree on.
 *
 * The other three (keyboard, hover, one component) are not geometry and a reader answers them.
 *
 *   npm run build -- --base=./
 *   npx tsx scripts/debug/console-surface-check.ts [--dir dist] [--browser <chrome>] [--width 360]
 *
 * Exit code 1 = something is off the edge or under the target size. `--browser` names a chromium when the
 * pinned Playwright download is not the one on disk, which is the usual case in a container.
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
const port = Number(flag('port', '4611'));
const width = Number(flag('width', '360'));
const height = Number(flag('height', '609'));
/** WCAG 2.5.5 / Apple HIG / Material, and the token the styles carry. */
const TOUCH_TARGET = 44;

if (!existsSync(join(source, 'dispatch.html'))) {
  console.error(`no ${source}/dispatch.html — run \`npm run build -- --base=./\` first`);
  process.exit(1);
}

async function main(): Promise<void> {
  const root = join(process.cwd(), 'build', '.surface-check');
  rmSync(root, { force: true, recursive: true });
  mkdirSync(root, { recursive: true });
  cpSync(source, root, { recursive: true });

  const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
  process.on('exit', () => void server.kill());
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const browser = await chromium.launch(browserPath === '' ? {} : { executablePath: browserPath });
  // `hasTouch` is what makes `(pointer: coarse)` true, which is what the styles switch on. Without it this
  // measures the DESK build at phone width and reports every target as fine.
  const page = await browser.newPage({ hasTouch: true, viewport: { height, width } });
  await page.goto(`http://localhost:${port}/dispatch.html?units=0&calls=0`, { waitUntil: 'load' });
  await page.waitForTimeout(6000);

  // No named inner functions in here: this body is serialised into the page, and esbuild's `keepNames`
  // helper (`__name`) does not exist on the other side of that boundary.
  const found = await page.evaluate(
    ([edge, target]) => {
      const offEdge: string[] = [];
      const small: string[] = [];
      for (const el of document.querySelectorAll('button, select, input, [role="button"], a[href]')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
          continue;
        }
        const text = (el.textContent ?? '').trim().slice(0, 24);
        const what = text === '' ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()} "${text}"`;
        // Past the edge is only a failure when nothing between here and the root SCROLLS to it. That is the
        // whole distinction the 2026-08-25 report turned on: the controls were not merely off-screen, they
        // were off-screen "with nothing to scroll to". A scrollable ancestor makes the same geometry fine.
        let reachable = false;
        for (let node: Element | null = el.parentElement; node !== null; node = node.parentElement) {
          const overflowX = getComputedStyle(node).overflowX;
          if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) {
            reachable = true;
            break;
          }
        }
        if (!reachable && (box.right > edge + 0.5 || box.left < -0.5)) {
          offEdge.push(`${what} spans ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
        if (box.width < target - 0.5 || box.height < target - 0.5) {
          small.push(`${what} is ${Math.round(box.width)}x${Math.round(box.height)}`);
        }
      }

      return { docWidth: document.documentElement.scrollWidth, offEdge, small };
    },
    [width, TOUCH_TARGET] as const,
  );

  await browser.close();
  server.kill();

  console.log(`viewport ${width}x${height}, coarse pointer, document ${found.docWidth} px wide`);
  const failures: string[] = [];
  if (found.docWidth > width) {
    failures.push(`the document is ${found.docWidth} px wide inside a ${width} px viewport`);
  }
  failures.push(...found.offEdge.map((line) => `off the edge: ${line}`));
  failures.push(...found.small.map((line) => `under ${TOUCH_TARGET} px: ${line}`));

  if (failures.length === 0) {
    console.log(`ok — nothing past the edge, every control at least ${TOUCH_TARGET} px in both axes`);

    return;
  }
  for (const line of failures) {
    console.error(`FAIL ${line}`);
  }
  process.exitCode = 1;
}

void main();
