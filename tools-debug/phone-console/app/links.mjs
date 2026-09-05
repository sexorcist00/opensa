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
export const LINK_NAMES = [
  'map',
  'inventory',
  'field',
  'cleared',
  'engine',
  'board',
  'nosprites',
  'msaa1',
  'rgb10a2',
  'scale75',
  'scale50',
  'nocells',
  'nocloud',
  'nobloom',
  'bloom4',
  'bloomrg11',
  'bloomhalf',
  'bloomboth',
  'bloomfull',
  'bloomdual',
  'bloomf16',
  'bloomvendor',
  'night',
  'nightfull',
  'nighthalf',
  'nightnobloom',
  'noprobe',
  'noskylut',
  'flat',
  'bake',
  'share',
];

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
  // 720x640 is the SMALLEST of the four buffers this browser settled at, and both reasons to prefer it were
  // learned the hard way on 2026-08-31. **Comparability needs the size to be CONSTANT, not maximal** — the
  // first version of this line pinned 720x1218 on the argument that no arm should come out cheap in a
  // smaller window, which confuses fairness with size. And the big buffer costs what the device has least:
  // `target` residency is 59.87 MB at 1218 against 32.35 MB at 640, ~27 MB of render targets added to a
  // ~98 MB total, and the tab was killed part-way through the first circuit flown that way.
  //
  // It also lands the circuit ON the existing record rather than beside it: the 2026-08-31 150-unit row was
  // taken at `canvasPixels` 460 800, which is exactly 720x640 — so `board` − `field`, the CONTENT half, can
  // be read against a row this repo already has.
  //
  // The operator links below carry none of this: a pinned buffer is stretched into whatever room the layout
  // gives it, which is right for a measurement and wrong for somebody working the map.
  //
  // **What that stretch does NOT do, since 2026-09-04: distort the world.** It used to. The camera framed
  // for the BUFFER's aspect while the browser stretched that buffer into the CSS box, so a 720x640 pin
  // inside a 360x550 box rendered for 1.125 and displayed at 0.655 — the whole map ~1.7x too tall, and
  // every look verdict taken through a measurement link was worthless (the operator's report, and it is how
  // this was found). The camera reads the displayed box now (`canvasAspect`, `world/boot.ts`), so a pin
  // costs vertical RESOLUTION and nothing else. **A look verdict still belongs on an unpinned link**: soft
  // is soft, and `map` is the one that is native.
  const capture = 'inventory=1&surface=720x640';
  const empty = `${query}&units=0&calls=0&${capture}`;

  // 201/9-04's ladder: THE FIELD RUN with ONE attachment constant moved, so each arm's difference from
  // `field` is the thing being priced and nothing else. The scene pass is `rgba16float` at 4x MSAA with a
  // `depth32float` at 4x — 48 BYTES PER PIXEL of tile working set, against the 16 Arm budgets for a 16x16
  // tile on the Bifrost/Valhall family this phone runs; past that the driver shrinks the tile and every
  // per-tile fixed cost multiplies. `?scale=` is the engine's own knob and has existed since 2026-08-12, so
  // the two resolution arms re-use it rather than inventing a second one.
  //
  //   msaa1   = one sample                12 B/px, and no resolve ... the tile configuration whole
  //   rgb10a2 = the format halved         32 B/px .................. the price of rgba16float, AA kept
  //   scale75 / scale50 = fewer pixels    linear ................... fill-bound against tile-bound
  //
  // `msaa1` also loses alpha-to-coverage on the cutout pipelines (WebGPU has no such thing at one sample),
  // which is a LOOK change judged on the phone at map zoom — not a reason to skip the arm, a reason the arm
  // owes a verdict as well as a number.
  return {
    bake: `${app}?${query}&bake=tiles&zmin=0&zmax=4`,
    // 201/9's ABLATION arms. There is no `timestamp-query` on the 2/03 device and no browser flag brings it
    // (`docs/edge-cases/browser-runtime.md`, re-tested 2026-09-04), so a pass is priced by REMOVING it and
    // re-flying the same route: each of these is `field` minus one group, and the difference in the
    // window's mean is what that group costs. `bloom4` is the odd one — it shortens the chain rather than
    // removing it, which is 201/9-05's actual lever and not only a measurement.
    bloom4: `${app}?${empty}&bloomlevels=4`,
    // 201/9-05's two REAL levers, after the sweep refuted the level count: the chain's own storage, and where
    // its pyramid starts. `bloomrg11` moves no pixels and changes no resolution — it halves the bytes of every
    // pass that reads or writes the chain, which is what the 09-04 ladder's `rgb10a2` arm implied and this one
    // takes without UNORM's clipping. `bloomhalf` quarters the three passes that are 90 % of the chain and is
    // a LOOK change: the bright-pass threshold then runs on a 2x2 average, so sub-pixel emitters dim.
    // The candidate DEFAULT rather than a diagnostic: the two levers are independent (one halves the bytes of
    // every pass in the chain, the other quarters the pixels of the three biggest), and separately they read
    // -2.4 ms and -4.4 ms off a 21.5 ms baseline.
    bloomboth: `${app}?${empty}&bloomformat=rg11b10ufloat&bloomscale=0.5`,
    // The console's default became `bloomscale=0.5` on 2026-09-05 (the operator's night verdict), so THIS is
    // the arm that re-flies what `field` used to be. A default that moved without leaving its predecessor
    // reachable would make every row taken before it unrepeatable.
    // THE TWO VENDOR ARMS (201/9, the Arm/Bjorge material in docs/links.md). Both are `field` plus ONE
    // field, which is what makes them subtractable — and both are pitched at what the sweep found the frame
    // to be, which is the post chain's per-pixel work rather than the world's per-triangle work.
    //
    //   bloomdual = the downsample's kernel: 13 taps -> 5 .... Bjorge, SIGGRAPH 2015; Arm's own for Mali
    //   bloomf16  = the colour maths at half width ........... Arm prices mediump at ~2x on their ALUs
    //   bloomvendor = both at once .......................... because neither alone can clear the floor
    //
    // The third one is not laziness. This device's ablation floor is 2.47 ms
    // (docs/benchmarks/opensa-engine/2026-09-05-mobile-ablation-null-arm.json) and neither lever is expected
    // to be worth that alone, so the combined arm is the only one with a chance of reading above the noise.
    // If it does not, the honest answer is that they are unmeasurable here rather than that they are zero.
    bloomdual: `${app}?${empty}&bloomdown=dual5`,
    bloomf16: `${app}?${empty}&postprec=f16`,
    bloomfull: `${app}?${empty}&bloomscale=1`,
    bloomhalf: `${app}?${empty}&bloomscale=0.5`,
    bloomrg11: `${app}?${empty}&bloomformat=rg11b10ufloat`,
    bloomvendor: `${app}?${empty}&bloomdown=dual5&postprec=f16`,
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
    msaa1: `${app}?${empty}&msaa=1`,
    // THE LOOK PAIR, and it has to be at NIGHT (201/9-05). `bloomhalf` is measured at −4.4 ms and its known
    // cost is sub-pixel EMITTERS: at half resolution the bright-pass threshold runs on a 2x2 average, so a
    // street light one pixel across is diluted below it and stops blooming. At hour 10 there is nothing lit
    // to lose and the daylight A/B on 2026-09-05 was indistinguishable — which settles nothing. These two
    // differ by the arm alone (`links.test.mjs`), so what an operator sees between them IS the arm.
    night: `${app}?${empty}&hour=22`,
    // THE PREFILTER question's live partner, and the one `nighthalf` STOPPED being on 2026-09-05. That day
    // the operator's verdict made `bloomPrefilterScale: 0.5` the console's default, so `night` — which
    // carries no `bloomscale` — has rendered at half ever since, and `nighthalf`, which sets 0.5 explicitly,
    // renders the SAME THING. The pair went on looking like a pair: both links resolve, the test that pins
    // them still passes because it only asserts they differ by that one parameter, and an operator flipping
    // between them sees no difference because there is none. **An A/B whose two halves are one run is the
    // exact failure `docs/restrictions/architecture.md` names**, and this is the second time this repo has
    // met it in a week. `nightfull` is the arm that actually moves: `bloomscale=1` is the PRE-verdict
    // default, so `night` minus this is what that verdict bought, re-flyable for as long as it matters.
    nightfull: `${app}?${empty}&hour=22&bloomscale=1`,
    // Kept, and no longer a partner to anything: it PINS the shipped default rather than moving it, which is
    // worth having when a row needs to state the scale it ran at rather than inherit it. Rows filed before
    // 2026-09-05 cite it as the arm, and they were right at the time.
    nighthalf: `${app}?${empty}&hour=22&bloomscale=0.5`,
    // THE REMOVAL question, which is a different question from the prefilter one above and has never been
    // put to an operator. 2026-09-05 measured what dropping the chain BUYS — the map stutters on 44.6 % of
    // consecutive frame pairs and on 7.9 % without it, 5.6x
    // (`docs/benchmarks/opensa-engine/2026-09-05-mobile-frame-pacing.json`) — and nothing has ever measured
    // what it COSTS to look at. `night` minus this arm is that cost, at the hour where bloom has something
    // to do; the day pair is the one that already came back indistinguishable and settled nothing.
    nightnobloom: `${app}?${empty}&hour=22&ablate=bloom`,
    nobloom: `${app}?${empty}&ablate=bloom`,
    nocells: `${app}?${empty}&ablate=cells`,
    nocloud: `${app}?${empty}&ablate=cloud`,
    noprobe: `${app}?${empty}&ablate=probe`,
    noskylut: `${app}?${empty}&ablate=skylut`,
    // THE SYMBOLOGY ARM (201/9-01): `board` with the symbol sprites off, so the marks are rebuilt as paths
    // the way they were before 2026-09-05. `nosprites` − `board` is what a blit is worth on this device —
    // the only way to price it here, since the adapter has no `timestamp-query`. Its own fallback, not a
    // second path written for the measurement, so what it measures is exactly what shipped before.
    nosprites: `${app}?${query}&units=150&calls=40&${capture}&sprites=0`,
    rgb10a2: `${app}?${empty}&scene=rgb10a2unorm`,
    scale50: `${app}?${empty}&scale=0.5`,
    scale75: `${app}?${empty}&scale=0.75`,
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
