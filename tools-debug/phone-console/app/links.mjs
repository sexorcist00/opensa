/**
 * The URLs the panel hands out — ONE rule, two readers.
 *
 * The page built these inline until 2026-08-28, which was fine while a person was the only thing that could
 * follow one. `phone_open` (plan 002's remaining tap) is a second reader, and a second copy of the rule is
 * how an agent opens a URL that differs from the one on the screen beside it — the same class of failure the
 * panel's own log/ring sharing exists to prevent.
 *
 * `agent=1` is on every link this file produces and nowhere else: these addresses only exist on the phone,
 * and it is what lets the map be read and driven (plan 002, the browser half). A shared link never carries it.
 */

/** The links the panel offers, in the order the page lists them. `phone_open`'s `LINK` knob takes one. */
export const LINK_NAMES = ['map', 'inventory', 'field', 'cleared', 'engine', 'board', 'flat', 'bake', 'share'];

/**
 * Every link, for one panel state.
 *
 * @param {{district?: string, out?: string, ports?: {app?: number, static?: number}, webapp?: boolean}} state
 *   `ports` and `webapp` come from the panel's own `/api/state`; `out` and `district` are what the run used.
 * @returns {Record<string, string>} keyed by {@link LINK_NAMES}.
 */
export function consoleUrls(state = {}) {
  const staticPort = state.ports?.static ?? 3001;
  const appPort = state.ports?.app ?? 5173;
  const out = String(state.out ?? './build/phone')
    .trim()
    .replace(/^\.\//, '');
  const pak = `http://localhost:${staticPort}/${out}`;
  // A prebuilt copy is served as static files and vite is never started, which on some arm64 CPUs is the
  // only way in at all (`scripts/phone.sh`).
  const app = state.webapp
    ? `http://localhost:${staticPort}/build/webapp/dispatch.html`
    : `http://localhost:${appPort}/dispatch.html`;
  const query = `src=${pak}&district=${encodeURIComponent(String(state.district ?? '').trim())}&agent=1`;

  // THE FIELD RUN IS THE MAP, and the board is a separate link (the user's call, 2026-08-31). It carried
  // `units=150&calls=40` until then, so every window the map's own work was to be judged on was taken
  // through a 150-unit symbology layer measuring 3.09 ms of CPU and returning 24 ms of frame. The map and
  // its optimisation come first; the board's own numbers (201/5-02, 5-04) are measured at `board` when
  // their turn comes, and nothing about them is lost by not measuring them today.
  //
  // The four run-links are ONE circuit and differ by one thing each, which is what makes the subtractions
  // mean anything:
  //
  //   engine  = the world, nothing over it            `engine`  ............... the 3D pass + streaming
  //   cleared = the overlay canvas dirtied, not drawn  `cleared` − `engine` .... the LAYER
  //   field   = the map's own overlay, empty board     `field`   − `cleared` ... the empty-board pass
  //   board   = the declared worst case, 150 units     `board`   − `field` ..... the CONTENT
  //
  // THE SURFACE IS PINNED ON EVERY MEASUREMENT LINK, and it is the second lesson of 2026-08-31. The
  // circuit above only means something if its arms differ by one thing — and the drawing buffer is not one
  // of the things a link controlled: the canvas follows the visible viewport, the browser's chrome
  // collapses and returns mid-flight, and one session measured 720x1218, 720x864, 720x746 and 720x640, a
  // 1.9x spread in pixels with `target` residency moving 59.87 -> 32.35 MB alongside it. Two arms taken at
  // two of those sizes cannot be subtracted, and nothing in either capture complains.
  //
  // 720x1218 is this phone's FULL-SCREEN buffer (360x609 CSS at DPR 2) — the largest of the four, chosen so
  // an arm cannot come out cheap by having been measured in a smaller window. The operator links below
  // carry none of this: a pinned buffer is stretched into whatever room the layout gives it, which is right
  // for a measurement and wrong for somebody working the map.
  const capture = 'inventory=1&surface=720x1218';
  const empty = `${query}&units=0&calls=0&${capture}`;

  return {
    bake: `${app}?${query}&bake=tiles&zmin=0&zmax=4`,
    // The declared worst case: 201's budget table says 150 units each drawn as a model with a symbol over
    // it, and every number 5/02 and 5/04 owe is measured AT it. It is no longer THE FIELD RUN — it is what
    // the field run is compared against once the map is the shape we want it.
    board: `${app}?${query}&units=150&calls=40&${capture}`,
    // The overlay canvas cleared every frame with nothing drawn into it (201/9-01). `engine` below skips the
    // `clearRect` as well, so the compositor may skip the layer whole — which is why the two-arm pair could
    // not say whether the ~21 ms it removed was the layer or its content.
    cleared: `${app}?${empty}&overlay=clear`,
    // The field run's A/B PARTNER (201/2): the same board and the same collector, with `?overlay=0` — so the
    // window prices the engine rather than the symbology over it. Two halves typed by hand differ by
    // something nobody wrote down, which is what makes the pair worth a link each.
    engine: `${app}?${empty}&overlay=0`,
    // THE FIELD RUN: the pinned district, the collector on, and NO BOARD. This is the window every number
    // about the map — streaming, textures, the frame — is taken in.
    field: `${app}?${empty}`,
    flat: `${app}?${query}&mode=flat`,
    inventory: `${app}?${query}&inventory=1`,
    map: `${app}?${query}`,
    // The share artifact is served as a plain file out of the repo, wherever the static server is.
    share: `http://localhost:${staticPort}/dist-share/dispatch.html?${query}&inventory=1`,
  };
}

/**
 * Which ports must already be serving for a link to answer, so opening a dead one is refused by name.
 *
 * The static port is on every list because it hands out the PAK, whatever serves the app: a console that
 * loads and then 404s on its manifest is the failure this check exists to turn into a sentence.
 */
export function portsFor(state = {}) {
  const staticPort = state.ports?.static ?? 3001;

  return state.webapp === true ? [staticPort] : [staticPort, state.ports?.app ?? 5173];
}
