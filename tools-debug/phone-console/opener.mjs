/**
 * Opening the console ON THE PHONE'S SCREEN (plan 002).
 *
 * Everything else in this panel could be driven from the other side of the wire, and then the map itself
 * needed a person: the bus in `remote.mjs` only talks to a page that is ALREADY open, so "no map is
 * attached" was the one refusal no tool could clear. Android will open a URL for us — `termux-open-url`
 * hands it to the browser the same way a tap on a link does — so an agent can put the page in front of
 * whoever is holding the phone and then read it.
 *
 * **The launch is not the success**, and on a real device the usual reason is not ours. Android forbids a
 * BACKGROUND app from starting an activity, and the panel is exactly that whenever the operator is in some
 * other app — so `termux-open-url` exits 0, nothing opens, and nothing anywhere says why (measured on the
 * phone 2026-08-28: the same URL opened instantly from a foreground Termux and not at all from here, until
 * Termux was allowed to display over other apps). After that come the ordinary ones: no static server, no
 * pak, or a bundle that does not parse and therefore cannot report itself through this channel at all.
 * So the open is only finished when the page PHONES HOME, and until it does this reports what it launched,
 * naming the permission first because that is the answer far more often than the map is.
 */

/** Termux's own launcher — part of `termux-tools`, so it is there unless somebody removed it. */
export const OPEN_URL_BIN = '/data/data/com.termux/files/usr/bin/termux-open-url';

/** How long the page is given to boot and reach the bus before the caller is told what to look at. */
const ATTACH_TIMEOUT_MS = 40_000;

/** How often the bus is asked, while waiting. */
const ATTACH_TICK_MS = 250;

/**
 * Put a console URL on the phone's screen and wait until that page is the one on the bus.
 *
 * Two ways in, and the first is the one a ladder lives on. **An attached console STEERS ITSELF**: `steer`
 * sends it a `navigate` command and it replaces its own location, so the arm changes in the same tab with
 * nobody touching the phone. Before that, an attached console was simply refused (`reused: true`) and the
 * only way to change arms was a person backgrounding the browser until the page fell off the bus 15 s
 * later — four times for 201/9-04's five-arm ladder, and dozens for an ablation.
 *
 * `termux-open-url` remains the way in when NOTHING is attached, and it is the half that cannot be made
 * reliable: Android forbids a background app from starting an activity (see the module header), so the
 * launch is only ever finished when the page phones home.
 *
 * @param {{attached: () => {attached: boolean, page: unknown}, exists: (path: string) => boolean,
 *   launch: (url: string) => Promise<unknown>, sleep?: (ms: number) => Promise<void>,
 *   now?: () => number, steer?: (url: string) => Promise<unknown>}} deps
 * @param {{timeoutMs?: number, url: string}} request
 */
export async function openConsole(deps, request) {
  const { attached, exists, launch, now = () => Date.now(), sleep = wait, steer } = deps;
  const { timeoutMs = ATTACH_TIMEOUT_MS, url } = request;

  const before = attached();
  // Already on the page being asked for: nothing to do, and re-navigating would throw away a warmed world.
  if (before.attached && sameConsole(before.page?.url, url)) {
    return { attached: true, ok: true, page: before.page, reused: true, url };
  }
  if (before.attached && steer) {
    try {
      await steer(url);
    } catch (error) {
      return { error: `the console did not take the navigation: ${String(error?.message ?? error)}`, ok: false, url };
    }

    // The old page stops polling as it unloads and the new one attaches in its place, so "arrived" is a page
    // reporting the URL that was asked for — never merely something being attached, which was still true of
    // the page we just sent away.
    const until = now() + timeoutMs;
    while (now() < until) {
      const state = attached();
      if (state.attached && sameConsole(state.page?.url, url)) {
        return { attached: true, navigated: true, ok: true, page: state.page, url };
      }
      await sleep(ATTACH_TICK_MS);
    }

    return {
      attached: false,
      error:
        `the console took the navigation and no page carrying that URL reached the panel within ` +
        `${Math.round(timeoutMs / 1000)}s. The tab is on the new address but did not phone home: a bundle ` +
        'that does not parse cannot report itself through this channel at all, and a console that cannot ' +
        'fetch its pak needs the static server running (`npm run phone`).',
      ok: false,
      url,
    };
  }

  if (!exists(OPEN_URL_BIN)) {
    return {
      error:
        'no termux-open-url on this phone, so nothing can be put on its screen from here — `pkg install ' +
        'termux-tools` installs it. Until then the URL below has to be opened by hand.',
      ok: false,
      url,
    };
  }
  // Attached, but there is no way to steer it: a second tab would take the bus over and leave the operator
  // looking at the old one, so this stays a refusal rather than becoming two consoles.
  if (before.attached) {
    return { attached: true, ok: true, page: before.page, reused: true, url };
  }

  try {
    await launch(url);
  } catch (error) {
    return { error: `termux-open-url failed: ${String(error?.message ?? error)}`, ok: false, url };
  }

  const until = now() + timeoutMs;
  while (now() < until) {
    const state = attached();
    if (state.attached) {
      return { attached: true, ok: true, page: state.page, reused: false, url };
    }
    await sleep(ATTACH_TICK_MS);
  }

  return {
    attached: false,
    error:
      `termux-open-url accepted the URL and no map reached the panel within ${Math.round(timeoutMs / 1000)}s. ` +
      'It exits 0 either way, so start with the screen: NOTHING OPENED means Android dropped the activity — a ' +
      'background app may not start one unless Termux is allowed to display over other apps (Settings → Apps ' +
      '→ Termux → Display over other apps), which is the usual cause on a device that has never been asked ' +
      'for it. If the console IS on the screen it did not reach this panel: one that cannot fetch its pak ' +
      'needs the static server running (`npm run phone`), and a bundle that does not parse at all cannot ' +
      'report itself through this channel.',
    ok: false,
    url,
  };
}

/**
 * Whether two console URLs are the same page to a measurement.
 *
 * The attached page reports `window.location.href`, which is not the string the panel handed the browser:
 * the app appends `mode=` once the surface has settled, and the browser percent-encodes `src`. Neither is a
 * difference an arm cares about, and treating one as a difference would re-navigate a console that is
 * already on the right page — a wasted page load in the middle of a ladder. Everything else IS the arm
 * (`msaa`, `scene`, `scale`, `surface`, `district`), so it is compared exactly.
 */
export function sameConsole(a, b) {
  const parse = (raw) => {
    try {
      const parsed = new URL(String(raw ?? ''), 'http://localhost');
      parsed.searchParams.delete('mode');
      parsed.searchParams.sort();

      return `${parsed.pathname}?${parsed.searchParams.toString()}`;
    } catch {
      return null;
    }
  };
  const left = parse(a);

  return left !== null && left === parse(b);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
