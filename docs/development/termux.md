# Developing on a phone (Termux)

**The development machine for this project is an Android phone running Termux.** Not a preference — the
working setup. Recorded 2026-08-06 so that instructions, scripts and plan steps are written for it instead of
for a desktop that is not there.

The user **has the game files and can build paks**, so nothing here is blocked on assets. What is different
is the machine.

## What changes

| Assumption a desktop makes | What is true here |
| --- | --- |
| `sudo`, `apt` | neither — `pkg install <x>`, everything runs as the single Termux user |
| stable paths (`/usr`, `/tmp`) | `$PREFIX` (`/data/data/com.termux/files/usr`); `$TMPDIR` is inside it |
| a long command keeps running | Android suspends the process — hold it with `termux-wake-lock` |
| files are just there | shared storage needs `termux-setup-storage` once |
| RAM is not a variable | it is the binding constraint on every build |
| a headless browser exists | **Playwright/Chromium headless is effectively unavailable** |

## The two that actually bite

**The build scripts ask for a 12 GB heap.** Every `build:game:*` script in `package.json` carries
`NODE_OPTIONS=--max-old-space-size=12288`. That is a desktop number and no phone will honour it. If a pak
build runs on the device, the flag has to come down to what the phone has and the build has to be sized to
fit — a district rather than the whole state is the obvious lever, and it is the same district
[201/1-01](../plans/201-dispatch-console/1-the-map-profile/readme.md) pins for measurement anyway.

**There is no headless capture path.** Much of `scripts/debug/` and all of `e2e/` drive a browser through
Playwright. Here the equivalent is: run `npm run dev` in Termux and open the page in the phone's own browser
(`http://localhost:5173/…`). That covers anything a human can read off the screen, and does not cover
scripted input or an automated screenshot diff. A step that owes a scripted check has to say so and find
another way rather than assume `npx playwright` will run.

## What this does to the measurement plan

[201](../plans/201-dispatch-console/readme.md) is written as *desktop baseline first, phone second* — chain 1
takes its before/after on a desktop and chain 2 re-takes it on a phone. **With no desktop, that ordering does
not hold as written.** Two honest ways out, and the chain says which it took rather than quietly producing
one column:

1. **The phone is the baseline.** Everything is measured on the one machine there is. The numbers stop being
   comparable to the repo's existing desktop rows — which the mobile benchmark schema
   ([200/1-02](../plans/200-platform-reach/1-device-truth/readme.md)) already declares as a rule — and in
   exchange every number is taken on the device the product actually targets.
2. **A desktop is borrowed** for the baseline only, and the phone rows stay the ones that decide anything.

Option 1 is the more honest default here: the console's whole point is that it runs on a phone, and a
baseline taken somewhere the product will never run is a baseline that flatters it.

## Where things are on the phone (read before writing a command with a path in it)

Paths here are not guessable, and two of them are not where the Termux documentation says they are. Measured
2026-08-09 on the device this chain is captured on:

| What | Path | Notes |
| --- | --- | --- |
| the repo | `~/opensa` | `/data/data/com.termux/files/home/opensa` |
| the game copy | `game-src/original` → `~/storage/downloads/New Folder` | holds `data/` + `models/`; **`~/storage/downloads` is a REAL directory inside Termux's private home**, not the usual `termux-setup-storage` symlink into shared storage |
| the pristine distribution | `/storage/emulated/0/Download/GTA CORP.rar` | `GTA_CORP/{data,models,SAMP}` — `models/gta3.img` 1 093 664 768 B, `gta_int.img` 198 545 408 B. **This is the restore source**; `pkg install unrar`, then `unrar e <rar> "GTA_CORP/models/<file>" ./` pulls single files without unpacking 2 GB |
| build output | `build/phone-ls` → `/storage/emulated/0/Download/opensa-build/phone-ls` | on SHARED storage, deliberately outside the game copy — see the symlink rule below |
| volumes | `/storage/emulated` only | no SD card, so there is no second place to look |

**Two search traps this cost a session to learn.** `~/storage/shared` does not exist here, and `find` does not
descend into a symlink it is GIVEN unless you pass `-L` — so `find ~/storage/shared …` returns silence that
reads exactly like "there is no copy of the game on this phone". Search `/storage/emulated/0` for the shared
side and `~` for the Termux-private side, and remember they are different filesystems with different free
space.

## Practical notes

- **The whole setup is `pkg install nodejs-lts git` and then `npm run phone:setup`** — once per device. A
  plain `npm install` is NOT the normal path here: the full tree pulls 1171 packages whose prebuilt binaries
  are `linux-x64-gnu`, and it is the step most likely to fail on arm64. Setup passes `--omit=dev` (173
  packages, none of which the convert path touches) and `HUSKY=0`, and it is idempotent, so re-running it
  after a failure or a reboot repeats nothing. Then `npm run phone` for every run
  ([mobile-pak.md](./mobile-pak.md)).
- `termux-wake-lock` before a build, `termux-wake-unlock` after — without it a long pak build dies when the
  screen sleeps. `npm run phone:setup` takes the lock when Termux offers one, so a convert started right
  after it is already covered.
- The dev server binds fine; reach it from the phone's browser at `localhost`, and from another device on the
  same network with `npm run dev -- --host`.
- Storage: the built game lives under `build/<game>/opensa`, and a field run reads that and nothing else
  ([restrictions/architecture.md](../restrictions/architecture.md)). Keep it on internal storage — shared
  storage via `termux-setup-storage` is slower and has different permission behaviour.
- **Symlinking `build/*` or `game-src/*` into shared storage is normal here, and two of those links must never
  land on one folder.** On 2026-08-09 `game-src/original`, `build/phone`, `build/phone-ganton`, `build/phone-ls`
  and `build/phone-ls-rgba8` all resolved to the same directory: every convert overwrote the previous pak (an
  A/B that kept one build), and — worse — the converter's `--out` was its own `--game`, so it rewrote the
  archives it was reading (`gta3.img` 1325 → 1145 MB, and a district that measured 597 texture layers came out
  with 49). Nothing said so; the paths had different names. `guardOut` now compares REAL paths and refuses it
  (`tools/tool-kit/src/game-dir.ts`), and `npm run phone` repeats the check before it deletes anything — but
  **a game copy already fed to a run in this shape is damaged and has to be restored from a clean copy.**
  `readlink -f game-src/* build/*` is the one-line way to see it.
  The damage is bounded and measurable: `rewriteOptimizedArchives` touches `models/*.img` and nothing else, so
  `data/` survives and only the archives that HELD converted models are rewritten. Measured on that copy with
  [`img-census.ts`](../debug/README.md) — `gta3.img` 1073 `.osm` bundles, `gta_int.img` 155, `cutscene.img` and
  `player.img` clean. Restoring those two files from a pristine install is the whole repair; the deleted `.dff`
  are not recoverable from the rewritten archive.
