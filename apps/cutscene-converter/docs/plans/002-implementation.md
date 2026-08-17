# 002 — Cutscene Converter: implementation

**Status: steps 1–5 DONE 2026-08-17** (measured numbers under each); 6–8 are the user's, and step 2 is
waiting on one Windows run. Execution plan for
[001-architecture](001-architecture.md). Ordered so that something runnable exists early and the
risky, unfamiliar part (packaging a signed-less portable exe) is proven before the UI is polished.

**Depends on**: [`vehicle-cutscene` plan 006](../../../../tools/vehicle-cutscene/docs/plans/006-no-base-copy.md)
(`--no-base-copy`) and [`@opensa/validation` plan 001](../../../../packages/validation/docs/plans/001-validation-package.md).
Steps 1–2 can start before either lands; step 4 needs both.

## Steps

- [x] **1. The workspace + an empty window.** `apps/cutscene-converter` in the root `workspaces`,
      Electron main + a Vite/React renderer, one window with the app name. Nothing else.
      Verification: `npm run dev` in the workspace opens the window on macOS; repo lint and tsc stay
      green (the new toolchain must not leak into the root config).
      **Done.** electron 43.4.0 · electron-builder 26.15.3 · esbuild 0.27.7, all in the APP's
      `devDependencies` — the first workspace package in this repo to declare its own. Renderer: vite +
      react (its own config, `base: './'` so a `file://` load resolves its assets). Main: one esbuild pass
      to CJS. The window reports `did-finish-load` / `did-fail-load` out loud, because a renderer that
      fails to load is the one Electron failure that looks like nothing happening.
      **Two things the plan did not know:** npm 11 BLOCKS install scripts by default, so electron's binary
      never downloaded — approved narrowly (`allowScripts: { "electron@43.4.0": true }` in the root
      package.json, the user's call). And the app's tag cannot be `type:app`: it imports two `type:tool`
      packages, so it is `type:tool` (the consequence `@opensa/validation` plan 001 predicted).
      Repo-level edits kept minimal: `.gitignore` + `.eslintflatignore` for `dist/`+`release/`, the Node
      halves added to eslint's scripts block (the renderer stays under the strict rules), one vitest
      include line.
- [x] **2. The portable exe, EARLY.** `electron-builder` `portable` target producing one `.exe`;
      cross-build from macOS. Verification: the artifact exists, its size is recorded, and the user
      runs it once on Windows to confirm it opens. **This is step 2 on purpose** — packaging is the
      only part of this plan the repo has never done, and finding out it is hard is worth doing before
      any UI exists.
      **Done, and it was not hard**: no wine, no extra toolchain — electron-builder fetched the Windows
      electron zip and its own nsis. `release/cutscene-converter-0.4.0.exe` = **88 871 868 B (84.8 MB)**,
      inside the 90–120 MB the plan predicted. The plugin sits beside it in `resources/`.
      **Measured trap:** electron-builder packs the WORKSPACE ROOT's runtime `dependencies` by default, and
      this app needs none of them — the first artifact carried rapier, bitecs, react and meshoptimizer.
      `!node_modules/**` in `files`: asar **18 112 416 → 199 198 B (−98.9 %)**, exe −1.6 MB.
      **Left to the user: one run on Windows to confirm it opens.**
- [x] **3. The ASI as a build resource.** The build copies `asi/perfect-cutscene/dist/perfect-cutscene.asi`
      into the app's resources and records its SHA into an about screen; **the build FAILS with a
      message naming the `make` command when the binary is absent.** Verification: a build with the
      file present embeds it; a build without it fails, and the failure tells you what to do.
      **Done.** With the binary present: `embedded perfect-cutscene.asi (18944 B, sha1 6f980530…12b5c0)`,
      and that SHA renders in the about line. With it moved away the build stops at `build:asi` and prints
      the path plus `cd asi/perfect-cutscene && npm run build:asi` (the npm script, which is what a reader
      can actually run — the plan said "the make command"). A DEV server still starts without it and the
      about line says "no plugin embedded — this is a dev tree, not a shippable build"; only a BUILD fails.
- [x] **4. The three-step wizard, wired.** Folder pickers for game / cars / out; each selection runs
      its validations through `@opensa/validation` and renders verdicts (error blocks the step,
      warning does not); "Convert" runs the tool in a forked child process with `--no-base-copy` and
      `--self-contained-txd`, streaming its output lines into a log pane; on success the out folder
      holds the three files + the ASI, and the app offers to open it.
      Verification: a real end-to-end run against `game-src/original` + `mods-src/original/vehicles`,
      output diffed against a CLI run of the same inputs — **byte-identical, or the facade is lying**.
      **Done, and byte-identical**: `diff -rq` clean and the md5-of-md5s equal (`7533b5b9…5c7ad6`) between
      `tsx tools/vehicle-cutscene/src/cli.ts …` and the app's own child run. 23/23 slots converted, 694
      paint materials, 21 plates; output **579 MB** (cutscene.img 321 MB + cuts.img 257 MB + txdcut.ide),
      ~3.1 s on macOS. The child is `import '@opensa/vehicle-cutscene/cli'` and nothing else, forked with
      `ELECTRON_RUN_AS_NODE=1` on our own binary (a packaged app has no `node` to call); the tool's
      `./cli` was added to its exports map for it. The UI was read out of the running app over CDP: three
      steps rendered, the preload bridge exposing all eight functions, the about line carrying the real
      plugin SHA.
- [x] **5. The failure surface.** Every way this can go wrong, with a message a stranger can act on:
      wrong game folder (which file was missing), unsupported exe (what it found vs what it needs and
      what that costs them), no cars matched, some slots uncovered (named), out folder unwritable or
      equal to the game, the tool throwing mid-run, not enough disk. Verification: each is reachable
      in a test or by hand, and each screenshot is reviewed as COPY, not as code.
      **Done as behaviour; the COPY review is the user's.** All eight are reachable: the seven game files
      each name themselves, the exe verdict says what it found, what it needs and that an unsupported one
      loses the actors behind car glass; an unreadable cars folder is an error and uncovered slots are a
      warning that names them; `out == game` is refused case-insensitively (the win32 half is why); an
      unwritable folder is caught by an actual probe write; a mid-run failure surfaces as the child's exit
      code with the tool's own lines above it; free space under 1 GB is a warning naming the figure.
      Ten tests in `src/main/*.test.ts` — the argv the facade builds, and the game/out validations.
- [ ] **6. The look.** Match `apps/web`'s existing visual language rather than inventing one — same
      Tailwind tokens, same typographic scale. Verification: side-by-side screenshots; the user's
      call, since "looks like ours" is a judgement he owns.
- [ ] **7. The tutorial.** `docs/tutorial/cutscene-converter/<version>/` — install, the three steps, what
      to copy where afterwards, and two things the app is DECIDED to be rather than apologise for:
      the SmartScreen warning (shipping unsigned, "More info → Run anyway", why it appears) and the
      CUTSCENES-ONLY scope (gameplay cars are the user's own business). The app links to its own
      version. Verification: the user follows it on a clean machine without asking a question;
      anything he has to ask is a defect in the tutorial, not in him.
- [ ] **8. Release.** Version, artifact, the ASI SHA and the tutorial version recorded together, so a
      bug report identifies all three. Verification: the recorded triple matches a fresh build.

## What is NOT in v1, and why

- **Installing into the game directly.** `--out` == game is refused by the tool. It is a different
  feature with a different risk profile (an unrecoverable overwrite of someone's install) and it wants
  a backup step before anyone builds it.
- **Gameplay car installation.** DECIDED, not deferred by omission (the user, 2026-08-15): what to
  install for gameplay is the user's business, and the app says so on screen. `vehicle-installer`
  could become a fourth step **if the app finds an audience** — until then this is the scope, and
  doing half of the pair silently would be the only wrong version.
- **A progress bar with percentages.** The tool's own per-slot lines are honest progress; a synthetic
  percentage over a 5-second run is decoration.
- **Signing.** DECIDED: none. See 001 — a distribution decision with a recurring bill, addable later
  without touching a line of the app, so deferring it costs nothing. The tutorial carries the warning
  instead.

## Numbers to record

Artifact size, cold-start time, and a full conversion's wall-clock **on Windows** — the last one is the
figure this whole chain was designed around and it cannot be measured on macOS.

**Measured 2026-08-17 (macOS, the halves that can be measured here):**

| | |
| --- | --- |
| Portable exe | 88 871 868 B (84.8 MB) |
| asar | 199 198 B (18 112 416 B before `!node_modules/**`) |
| Embedded plugin | `perfect-cutscene.asi` 18 944 B, sha1 `6f98053010ba0295ee867ddcbf18efb57512b5c0` |
| Conversion, 23/23 slots | ~3.1 s, output 579 MB (cutscene.img 321 MB + cuts.img 257 MB) |
| Renderer bundle | 195 KB (61.6 KB gzip) |
| App unit tests | 10, 166 ms |

Still open: cold start and a conversion's wall-clock **on Windows**, which need the user's machine.

## Deviations from 001's shape, and why

- **No `build/` folder.** 001 put the electron-builder config in `apps/cutscene-converter/build/`; it is one
  file, so it is `electron-builder.yml` at the app root, and the ASI is copied into `dist/asi/` with the
  other build output. A directory named `build/` inside an app also reads as build OUTPUT everywhere else
  in this repo.
- **No Tailwind.** 001 said "same Tailwind tokens as `apps/web`". `apps/web` does not actually use Tailwind
  for its shell — its visual language is the `--sa-*` custom properties in `ui/shell/shell.css`. The app
  reuses those, which is what "looks like ours" meant.
