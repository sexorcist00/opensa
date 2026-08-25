import { chromium } from 'playwright';
const DIR = '/tmp/claude-0/-home-user/8ad5d22a-571d-5146-96c0-b8168a935948/scratchpad/shots';
const CASES = [
  { h: 800, name: 'phone', touch: true, w: 360 },
  { h: 800, name: 'desk', touch: false, w: 1280 },
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const c of CASES) {
  const ctx = await browser.newContext({
    deviceScaleFactor: c.touch ? 2 : 1,
    hasTouch: c.touch,
    isMobile: c.touch,
    viewport: { height: c.h, width: c.w },
  });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173/dispatch.html?district=los-santos-centre', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${DIR}/v2-${c.name}.png` });
  const r = await page.evaluate(() => {
    const over = [],
      small = [];
    for (const el of document.querySelectorAll('*')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > innerWidth + 0.5 || b.bottom > innerHeight + 0.5))
        over.push((el.textContent || el.tagName).trim().slice(0, 26));
    }
    for (const el of document.querySelectorAll('button,input')) {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.width < 44 || b.height < 44)) small.push(`${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    const css = !!document.getElementById('opensa-dispatch-css');
    return { css, over: [...new Set(over)].length, small: small.length };
  });
  console.log(c.name, 'overflow', r.over, '· under44', c.touch ? r.small : '(desk, n/a)', '· sheet installed', r.css);
  await ctx.close();
}
await browser.close();
