import { describe, expect, it, vi } from 'vitest';

import { OPEN_URL_BIN, openConsole, sameConsole } from './opener.mjs';

const URL_ = 'http://localhost:3001/build/webapp/dispatch.html?src=x&agent=1';
/** The same console one measurement arm away — 201/9-04's ladder is five of these. */
const ARM = `${URL_}&msaa=1`;

/**
 * A phone whose clock and bus the test owns: `attachAfter` is how many polls pass before the page phones
 * home, so "it attached" and "it never did" are decisions rather than races.
 */
function phone(options = {}) {
  const { attachAfter = 0, hasOpener = true, launch = vi.fn(async () => {}), url = null } = options;
  let now = 1000;
  let polls = 0;

  return {
    deps: {
      attached: () => {
        const attached = polls >= attachAfter;
        polls += 1;

        const page = url === null ? { mode: 'live' } : { mode: 'live', url };

        return attached ? { attached: true, page } : { attached: false, page: null };
      },
      exists: (path) => hasOpener && path === OPEN_URL_BIN,
      launch,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
    launch,
  };
}

/** A phone whose attached page really does land on the URL it was steered to, after `landsAfter` polls. */
function steerablePhone(options = {}) {
  const { landsAfter = 2, url = URL_ } = options;
  let now = 1000;
  let polls = 0;
  let here = url;
  let landAt = null;
  let wanted = null;
  const steer = vi.fn(async (to) => {
    wanted = to;
    landAt = polls + landsAfter;
  });

  return {
    deps: {
      attached: () => {
        if (landAt !== null && polls >= landAt) {
          here = wanted;
        }
        polls += 1;

        return { attached: true, page: { mode: 'live', url: here } };
      },
      exists: (path) => path === OPEN_URL_BIN,
      launch: vi.fn(async () => {}),
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      steer,
    },
    steer,
  };
}

describe('openConsole', () => {
  describe('negative cases', () => {
    it('refuses without termux-open-url and names the package that provides it', async () => {
      const { deps, launch } = phone({ hasOpener: false });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.error).toContain('termux-tools');
      expect(answer.url).toBe(URL_);
      expect(launch).not.toHaveBeenCalled();
    });

    it('reports the launcher failing rather than claiming a page', async () => {
      const { deps } = phone({
        attachAfter: Number.POSITIVE_INFINITY,
        launch: vi.fn(async () => {
          throw new Error('no activity found');
        }),
      });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.error).toContain('no activity found');
    });

    it('gives up when the browser opened but nothing ever attached, and says where to look', async () => {
      const { deps } = phone({ attachAfter: Number.POSITIVE_INFINITY });

      const answer = await openConsole(deps, { timeoutMs: 2000, url: URL_ });

      expect(answer.ok).toBe(false);
      expect(answer.attached).toBe(false);
      expect(answer.error).toContain('npm run phone');
      expect(answer.url).toBe(URL_);
    });

    // The phone run on 2026-08-28: the launcher exits 0 and Android discards the activity, so the refusal
    // that only described a broken page sent the reader looking for a bug that was a permission.
    it('names the permission a background launch needs, since the launcher cannot report being ignored', async () => {
      const { deps } = phone({ attachAfter: Number.POSITIVE_INFINITY });

      const answer = await openConsole(deps, { timeoutMs: 2000, url: URL_ });

      expect(answer.error).toContain('display over other apps');
    });
  });

  describe('positive cases', () => {
    it('launches the url and answers once the page phones home', async () => {
      const { deps, launch } = phone({ attachAfter: 3 });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer).toMatchObject({ attached: true, ok: true, reused: false, url: URL_ });
      expect(answer.page).toEqual({ mode: 'live' });
      expect(launch).toHaveBeenCalledWith(URL_);
    });

    it('keeps the map already on screen instead of opening a second tab over it', async () => {
      const { deps, launch } = phone({ attachAfter: 0 });

      const answer = await openConsole(deps, { url: URL_ });

      expect(answer).toMatchObject({ attached: true, ok: true, reused: true });
      expect(launch).not.toHaveBeenCalled();
    });

    // 201/9-04's ladder cost the operator four manual switches; this is the line that removes them.
    it('steers an attached console to the next arm in the same tab, without the launcher', async () => {
      const { deps, steer } = steerablePhone();

      const answer = await openConsole(deps, { url: ARM });

      expect(answer).toMatchObject({ attached: true, navigated: true, ok: true, url: ARM });
      expect(answer.page.url).toBe(ARM);
      expect(steer).toHaveBeenCalledWith(ARM);
      expect(deps.launch).not.toHaveBeenCalled();
    });

    it('leaves a console that is already on the asked-for page alone rather than reloading it', async () => {
      const { deps, steer } = steerablePhone({ url: ARM });

      const answer = await openConsole(deps, { url: ARM });

      expect(answer).toMatchObject({ ok: true, reused: true });
      expect(steer).not.toHaveBeenCalled();
    });
  });
});

describe('sameConsole', () => {
  describe('negative cases', () => {
    it('tells two measurement arms apart, which is the whole reason it exists', () => {
      expect(sameConsole(URL_, ARM)).toBe(false);
      expect(sameConsole(`${URL_}&scale=0.5`, `${URL_}&scale=0.75`)).toBe(false);
    });

    it('is false rather than throwing on something that is not a URL', () => {
      expect(sameConsole(undefined, URL_)).toBe(false);
      expect(sameConsole(null, URL_)).toBe(false);
    });
  });

  describe('positive cases', () => {
    // The page reports `window.location.href`, and the app has appended `mode=` by the time it does.
    it('ignores the mode the app appends once its surface has settled', () => {
      expect(sameConsole(`${ARM}&mode=live`, ARM)).toBe(true);
    });

    it('ignores the percent-encoding the browser applies to a nested url', () => {
      const raw = 'http://localhost:3001/x.html?src=http://localhost:3001/build/phone&agent=1';
      const encoded = 'http://localhost:3001/x.html?src=http%3A%2F%2Flocalhost%3A3001%2Fbuild%2Fphone&agent=1';

      expect(sameConsole(raw, encoded)).toBe(true);
    });

    it('ignores the order the parameters happen to be in', () => {
      expect(
        sameConsole(`${URL_}&msaa=1`, 'http://localhost:3001/build/webapp/dispatch.html?msaa=1&agent=1&src=x'),
      ).toBe(true);
    });
  });
});
