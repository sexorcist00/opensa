/**
 * The URLs the panel hands out for the console, in ONE place.
 *
 * Two callers need the same string and they are on opposite sides of the wire: the page puts it behind its
 * links, and `POST /api/map/open` launches it on the phone's screen for an agent that has no fingers. A
 * second copy of this arithmetic is the kind of drift nothing catches — the tap and the tool would open
 * different paks, and the capture would name the one nobody was looking at.
 */

/**
 * @param {{district?: string, out?: string, ports: {app: number, static: number}, webapp?: boolean}} target
 * @returns {Record<'bake' | 'field' | 'flat' | 'inventory' | 'map' | 'share', string>}
 */
export function consoleUrls(target) {
  const { district = '', out = './build/phone', ports, webapp = false } = target;
  const pak = `http://localhost:${ports.static}/${String(out).trim().replace(/^\.\//, '')}`;
  // A prebuilt copy is served as static files and vite is never started, which on some arm64 CPUs is the
  // only way in at all (`scripts/phone.sh`).
  const app = webapp
    ? `http://localhost:${ports.static}/build/webapp/dispatch.html`
    : `http://localhost:${ports.app}/dispatch.html`;
  // `agent=1` on every link this panel hands out: these URLs only exist on the phone, and it is what lets an
  // agent read the map's numbers and see it (phone-console plan 002). Nothing else carries it, so a shared
  // link or a desk run never phones a panel.
  const query = `src=${pak}&district=${encodeURIComponent(String(district).trim())}&agent=1`;

  return {
    bake: `${app}?${query}&bake=tiles&zmin=0&zmax=4`,
    // The declared worst case, in one tap: 201's budget table says 150 units each drawn as a model with a
    // symbol over it, and every number 5/02 and 5/04 owe is measured AT it. Typed by hand it was never
    // typed at all.
    field: `${app}?${query}&units=150&calls=40&inventory=1`,
    flat: `${app}?${query}&mode=flat`,
    inventory: `${app}?${query}&inventory=1`,
    map: `${app}?${query}`,
    // The share artifact is served as a plain file out of the repo, wherever the static server is.
    share: `http://localhost:${ports.static}/dist-share/dispatch.html?${query}&inventory=1`,
  };
}

/** The views `map_open` accepts, so a typo is answered with the list rather than with a blank tab. */
export const CONSOLE_VIEWS = ['bake', 'field', 'flat', 'inventory', 'map', 'share'];
