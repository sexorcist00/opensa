# 001 — Cutscene Garage: architecture

**Status: PLANNED 2026-08-15.** A standalone Windows application that puts modded cars into GTA:SA's
cutscenes, for people who will never clone this repo. One portable `.exe`, three steps, no
prerequisites.

## What it is, and what it deliberately is not

**It is a FACADE.** The conversion is `@opensa/vehicle-cutscene`, unchanged and unforked; this app
chooses folders, validates them, runs the tool and explains the result. Every rule about SA data
stays in the tool — the app must never learn what a `.dff` is.

**It converts CUTSCENES ONLY** (the user's call, 2026-08-15). It does not install the cars into
gameplay. A user who converts their favourite car will still drive the stock one, and will expect
otherwise — so the UI has to say this in words, not in a footnote. That is a product decision, not a
limitation to hide.

## The three steps the user sees

1. **Pick a clean game** — the GTA:SA folder. Validated: the seven files the converter actually reads,
   plus the exe fingerprint (below).
2. **Pick a folder of cars** — the same `mods-src/<game>/vehicles` shape the tool already consumes.
   Validated: how many cutscene slots the mods cover, with the uncovered ones named.
3. **Pick an output folder** — and convert.

Output contains ONLY what changed, plus the plugin:

```
models/cutscene.img
data/txdcut.ide
anim/cuts.img
perfect-cutscene.asi
```

That is why [`vehicle-cutscene` plan 006](../../../../tools/vehicle-cutscene/docs/plans/006-no-base-copy.md)
exists: without `--no-base-copy` every run would physically copy 1.4 GB, because NTFS has no
copy-on-write.

## The decisions worth writing down

- **`--self-contained-txd` is always on, and never shown.** The user's game has no mod TXDs installed,
  so the txdp parent route cannot resolve; self-contained is the only correct mode here. A choice with
  exactly one correct answer is not a choice.
- **A modified game is fine.** The check is "can we read what we need and patch what we patch", not
  "is this pristine". Anything else is a warning at most — the audience for this app is people with
  modded games.
- **The exe fingerprint is a hard gate.** The converted fleet REQUIRES `perfect-cutscene.asi`, and the
  ASI refuses an exe it does not recognise. Converting onto an unsupported exe produces a result that
  looks fine and then loses actors behind car glass in-game. This must be loud at step 1.
- **The ASI is embedded at BUILD time** from `asi/perfect-cutscene/dist/` (the user builds it locally
  with mingw). **The app's build FAILS if that binary is absent** — never silently ships without it,
  because the fleet depends on it. The build records the binary's SHA in the app's about screen, so a
  bug report can say which plugin is inside.
- **The tool runs in a child process**, not in Electron's main. It streams the lines the CLI already
  prints (`converted`, `warning …`, `wheel stash sunk …`, `actor seated …`) into a live log pane. No
  progress API is added to the tool — the run is seconds, and its own output is the honest progress.

## Shape

```
apps/cutscene-garage/
  src/main/        # Electron main: window, dialogs, IPC, the child-process runner
  src/renderer/    # React + Tailwind — the same stack apps/web already uses
  src/shared/      # IPC message types shared by both sides
  build/           # electron-builder config; the ASI is copied in as a resource here
  docs/plans/      # 001 architecture · 002 implementation
```

- **Renderer** builds with Vite (already in the repo). **Main** bundles with esbuild — the converter
  is pure JS (`node:fs`/`node:os`/`node:path` and `@opensa/*`, zero native dependencies, verified),
  so it inlines into the main bundle with no rebuild-for-Electron step. This is the single biggest
  reason the whole idea is cheap.
- **One exe** via `electron-builder`'s `portable` target. Expect **~90–120 MB**; state it up front
  rather than discovering it.
- Validation comes from [`@opensa/validation`](../../../../packages/validation/docs/plans/001-validation-package.md),
  which shapes verdicts; the coverage answer itself comes from the tool's census.

## Windows SmartScreen — what can actually be done

An unsigned portable exe gets "Windows protected your PC" on first run, every user, forever. The
options, honestly:

| Option | Effect | Cost |
| --- | --- | --- |
| Ship unsigned, document the warning | Warning stays; the tutorial explains "More info → Run anyway" | free |
| **Azure Trusted Signing** | Signed, and reputation accrues on Microsoft's side; the current sane answer for a small project | ~$10/month, requires an identity/organization validation — **verify the current terms before planning on it** |
| OV code-signing certificate | Signed, but SmartScreen reputation still has to accumulate over downloads | ~$100–400/yr |
| EV certificate (hardware token) | Immediate SmartScreen trust | ~$300–500/yr + token logistics |

**Recommendation: ship unsigned for the first release and say so in the tutorial**, then decide on
Azure Trusted Signing once there is a reason to believe anyone outside this repo is downloading it.
Signing is a distribution decision with a recurring bill, not an engineering one, and it can be added
later without touching the app.

## Tutorial

Versioned inside the repo — `docs/tutorial/cutscene-garage/<version>/` — and the app links to the
version it was built from, never to "latest". A tutorial that drifts from the screen the reader is
looking at is worse than none.

## Risks

- **The build depends on a binary the repo does not carry.** `asi/perfect-cutscene/dist/` is
  gitignored; the app's build must fail loudly and say how to produce it, or someone will ship an
  empty facade.
- **600 MB of output.** `cutscene.img` + `cuts.img` are most of it. Fine on a modern disk, worth
  saying in the UI before the user picks a folder on a small SSD.
- **Cross-platform**: developed on macOS, shipped for Windows. Everything path-shaped needs care, and
  the `--out` == `--game` refusal must compare case-insensitively on win32.
- **This is the first Electron app in the repo.** It adds a toolchain (electron, electron-builder) the
  monorepo has never carried. Keep it inside `apps/cutscene-garage`; nothing else should learn about
  Electron.
