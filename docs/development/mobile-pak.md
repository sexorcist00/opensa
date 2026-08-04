# Building a pak a phone can open

A world built from SA assets cannot be displayed on a phone: its textures are BC-compressed and mobile GPUs
ship ETC2/ASTC instead ([edge-cases/browser-runtime.md](../edge-cases/browser-runtime.md)). Two converter
flags fix that, and this page is the whole recipe — including the case where the phone is the only computer
available.

## The two flags

| Flag | What it does | What it costs |
| --- | --- | --- |
| `--rgba8` | Refuses the DXT passthrough, so every world texture is decoded to RGBA8 — a format every GPU reads | **4-8x** the texture memory |
| `--max-texture N` | Caps every texture edge at N (power of two), halving both axes together so aspect survives | One halving takes back **three quarters** of what `--rgba8` costs |

They are meant to be used together. `--rgba8` alone makes a district affordable only at a very small `--rect`;
with `--max-texture 256` the same memory buys roughly sixteen times the area.

A texture over the cap is decoded rather than passed through — a DXT block cannot be resized while compressed —
so `--max-texture` alone already implies re-encoding for the textures it touches.

## On a desktop

```bash
npx tsx tools/opensa-pack/src/cli.ts \
  --game ./game-src/original --out ./build/district \
  --rgba8 --max-texture 256 --rect 8,-8,11,-5 --no-ao --no-models

npm run dev -- --host
# phone, same Wi-Fi:
# http://<host-ip>:5173/dispatch.html?src=build/district&at=2495,-1687
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
