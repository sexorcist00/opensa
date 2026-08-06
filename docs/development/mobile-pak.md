# Building a pak a phone can open

A world built from SA assets cannot be displayed on a phone: its textures are BC-compressed and mobile GPUs
ship ETC2/ASTC instead ([edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md)). Two converter
flags fix that, and this page is the whole recipe — including the case where the phone is the only computer
available.

## The two flags

| Flag | What it does | What it costs |
| --- | --- | --- |
| `--rgba8` | Refuses the DXT passthrough, so every texture is decoded to RGBA8 — a format every GPU reads | **4-8x** the texture memory |
| `--max-texture N` | Caps every texture edge at N (power of two), halving both axes together so aspect survives | One halving takes back **three quarters** of what `--rgba8` costs |

They are meant to be used together. `--rgba8` alone makes a district affordable only at a very small `--rect`;
with `--max-texture 256` the same memory buys roughly sixteen times the area.

**`--rgba8` covers the MODELS too, since 2026-08-04.** It used to convert only the world, and a car is not in
the pak — `model-ostex.ts` picked BC for any block-aligned dictionary, so a phone loaded the district and threw
on the first spawn. That is why every recipe here passed `--no-models`. With models converted the flag means
what it says, and the cost lands where a car's dictionary already is (~20× its model, so a full vehicle roster
in RGBA8 is not a district-sized decision — keep `--no-models` unless the run needs cars).

## Verify it rather than trust the flag

```bash
npx tsx tools/opensa-pack/src/cli.ts --game … --out … --rgba8 --platforms mobile
```

`--platforms` fails the pack when what it wrote demands a feature that GPU family does not carry, reading
**both** halves (the pak's arrays and every model's dictionary). Without it the pack still reports the demand:
one log line, and `platforms` in `report.json`.

On the engine side the same question is answered twice more, and neither needs a phone in the room:

- `packages/engine/src/core/device.test.ts` boots `initDevice` against a **simulated mobile adapter** (the
  fake's `adapterFeatures` minus BC, rejecting a required-but-absent feature exactly as a browser does). This
  is what pins the 2026-08-04 fix: asking for BC unconditionally makes `requestDevice` reject on every mobile
  GPU, and before this test nothing could see it.
- `packages/engine/src/stream/setup.test.ts` refuses a BC world on a no-BC device at MANIFEST time, so the
  message names the world rather than one texture.

## Capturing a run from a real phone

The build checks say a world *can* load; only a device says what it costs. What a capture must record — and
what it may not be used to claim — is in
[`docs/benchmarks/readme.md`](../benchmarks/readme.md#mobile-runs-a-different-schema-and-never-a-comparable-one).
Two things bite in practice:

- **A flag is not reach.** The 2026-08-04 capture needed `#enable-unsafe-webgpu` plus a browser restart,
  because Chromium's adapter **blocklist** returned a null adapter (not a missing Vulkan path —
  `featureLevel: 'compatibility'` produced an adapter too). A run behind that flag measures hardware
  capability. Say so in the row.
- **Serve over https.** On a plain `http://` LAN IP, `caches` is undefined and every cache operation silently
  no-ops, so the phone re-downloads the world each visit and the numbers include a download nobody intended.
  Since 2026-08-05 the shell **says so** — a note under the preloader (*"This download will not be kept…"*) and
  a `[loader] downloads are NOT cached` line in the console. If you see either, the run carries a download.

A texture over the cap is decoded rather than passed through — a DXT block cannot be resized while compressed —
so `--max-texture` alone already implies re-encoding for the textures it touches.

## One command, on the phone itself

Everything below is what `npm run phone` (`scripts/phone.sh`) does in one go — convert if there is no pak,
print what the pak carries, start both servers, print the URL to open. It exists because a field run is a
ritual repeated dozens of times on a device with no keyboard, and every step of it that has to be retyped is
a step that gets skipped:

```bash
npm run phone                                   # first run: converts, then serves
npm run phone                                   # every run after: servers up, here is the link
REBUILD=1 npm run phone                         # re-convert
BAKE=0 OUT=./build/phone-plain npm run phone    # the other side of the collision A/B
MODELS=0 npm run phone                          # skip the model convert (dispatch only — no physics)
RECT=8,-8,11,-5 SPAWN=2495,-1687,20 npm run phone
```

It refuses to start if `game-src/original/data/gta.dat` is missing, and it never re-converts silently — a
phone convert is minutes to hours. The rest of this page is the same recipe by hand, and the reasons behind
each flag.

**If the device cannot run vite**, unpack the committed archive and the script serves the app as static files
instead of starting a dev server — same command, one origin, no vite:

```bash
mkdir -p build/webapp && tar -xzf prebuilt/opensa-webapp.tar.gz -C build/webapp
```

(`prebuilt/` also says how to refresh it — `npm run build -- --base=./`; the `--base` is what keeps the asset
paths working from a subfolder.) That is not hypothetical: on an Android 10 / arm64 phone the
rolldown binding dies with `Illegal instruction` before printing a line, and no wasm fallback is reachable
([edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md)). Build with `--base=./` or the asset
paths will be absolute and 404 from a subfolder.

## Bake the collision too (097/3-01)

A phone's CPU makes every main-thread spike several times worse, and the largest named one is a COL parse per
cell. `--bake-collision` moves it into the converter:

```bash
npx tsx tools/opensa-pack/src/cli.ts --game … --out … --rgba8 --max-texture 256 --bake-collision
# or, through the canonical build:
npx tsx tools/perfect-map-builder/src/cli.ts --game ./game-src/original --in ./mods-src --exclude sa --bake-collision
```

It is **off by default on purpose**: the runtime reads the bake when the pak carries one and parses COL when it
does not, so the same tree built twice — one flag apart — is the A/B this is judged on, and neither side needs
a code change. What to look for:

- the pack log: `collision: baked N cells (M triangles, K breakable regions) on the 256 game grid`;
- in the browser, on a cold district entry, `cell-collision-decode` in the frame's span breakdown where the
  COL path used to spend its milliseconds inside the `collision` block.

**Use the GAME, not `dispatch.html`.** The dispatch surface streams the world but runs no physics, so it never
asks for a cell's colliders — the baked path is simply not on its route.

## On a desktop

```bash
npx tsx tools/opensa-pack/src/cli.ts \
  --game ./game-src/original --out ./build/district \
  --rgba8 --max-texture 256 --rect 8,-8,11,-5 --no-ao --no-models

npm run dev -- --host
# phone, same Wi-Fi — the map surface (no physics):
# http://<host-ip>:5173/dispatch.html?src=build/district&at=2495,-1687
# ...or the game itself, which is what exercises collision streaming:
# http://<host-ip>:5173/?loader=http-dir&src=http://<host-ip>:3001/build/district
```

`--rect` is inclusive GTA **cell** coordinates, cell = `floor(worldXY / 250)`. **Los Santos sits at negative
GTA y**: `8,-8,11,-5` is x 2000…3000, y −2000…−1250 (Ganton/Idlewood); the whole of LS is about `1,-10,11,-3`.

`--no-ao` skips the ambient-occlusion bake (much the slowest stage) and `--no-models` skips vehicles and peds,
which a dispatch map does not draw. Add them back when the area is proven.

## On the phone itself (Termux)

Viable because **the converter's only external runtime dependency is `meshoptimizer`** — everything else it
needs is in this repo, and nothing in the chain compiles native code. The 59 devDependencies (nx, rolldown,
oxlint, lightningcss) are dev tooling the conversion never touches, and their prebuilt binaries are
`linux-x64-gnu`, which is why a full `npm install` is the step most likely to complain on an arm64 phone.

```bash
pkg install nodejs-lts git python
git clone <your fork> && cd opensa

npm pkg delete scripts.prepare       # the repo's `prepare` runs husky, which --omit=dev does not install
npm install --omit=dev               # 173 packages instead of 1171 — the dev toolchain is never used here
npm i tsx                            # the TS runner; it is a devDependency, so --omit=dev skipped it
```

**Do NOT pass `--omit=optional`.** It looks right — the flaky prebuilt binaries (nx, rolldown, oxlint) are
optional deps — but npm already filters those by `os`/`cpu`, so an arm64 phone never fetches the `linux-x64`
ones anyway. What `--omit=optional` *would* skip is `@esbuild/android-arm64`, which is exactly the binary
`tsx` needs to run a single line of TypeScript.

And do not reach for `--ignore-scripts` to get past the husky failure either: esbuild installs its platform
binary from a `postinstall`, so silencing scripts trades one break for a worse one. Deleting the one script
that fails is the surgical fix, and a git hook is meaningless on a phone.

Put the game's `data/` and `models/` under `game-src/original/`, then convert a SMALL area first:

```bash
npx tsx tools/opensa-pack/src/cli.ts \
  --game ./game-src/original --out ./build/district \
  --rgba8 --max-texture 256 --rect 9,-7,10,-6 --no-ao --no-models
```

Serve it and open the console, both on the phone:

```bash
cd build/district && python3 -m http.server 8080
# browser: http://localhost:8080/<the dispatch html>?src=/&at=2495,-1687
```

### What to expect to go wrong

- **`npm install`** — the arm64/bionic mismatch on dev-tool binaries. `--omit=optional` is the first thing to
  try; the conversion path does not need any of them.
- **Memory.** The full-map scripts run with `--max-old-space-size=12288`. A 2x2-cell district needs far less,
  but no number has been measured on a phone — start small and grow.
- **Disk.** The PC game is ~4.7 GB before the pak.
- **`python3 -m http.server` ignores `Range:`**, so the pak is fetched whole rather than streamed by cell. Fine
  for a district, not for a city — the runtime detects it and falls back on purpose.

### The mobile game's files will not do

GTA:SA for Android stores textures in the OpenGL/PVR Texture Native layout (PVRTC/ETC). The parser handles
D3D8/D3D9 only and **skips what it does not understand rather than failing**, so those dictionaries produce a
world with missing textures rather than an error. The PC files are what the converter reads. See
[links.md](../links.md).

## Why the phone needs no assets of its own

The pak is built once, wherever there is a copy of the game, and then **served**. The runtime asks for byte
ranges (`Range: bytes=…`) and pulls only the cells the camera needs, which is why a 770 MB pak opens on a
phone at all. Any HTTP server the phone can reach will do — a desktop on the same Wi-Fi, a static host, or
Termux on the phone itself.
