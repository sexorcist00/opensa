# 002 — Cutscene Converter: implementation

**Status: PLANNED 2026-08-15.** Execution plan for
[001-architecture](001-architecture.md). Ordered so that something runnable exists early and the
risky, unfamiliar part (packaging a signed-less portable exe) is proven before the UI is polished.

**Depends on**: [`vehicle-cutscene` plan 006](../../../../tools/vehicle-cutscene/docs/plans/006-no-base-copy.md)
(`--no-base-copy`) and [`@opensa/validation` plan 001](../../../../packages/validation/docs/plans/001-validation-package.md).
Steps 1–2 can start before either lands; step 4 needs both.

## Steps

- [ ] **1. The workspace + an empty window.** `apps/cutscene-converter` in the root `workspaces`,
      Electron main + a Vite/React renderer, one window with the app name. Nothing else.
      Verification: `npm run dev` in the workspace opens the window on macOS; repo lint and tsc stay
      green (the new toolchain must not leak into the root config).
- [ ] **2. The portable exe, EARLY.** `electron-builder` `portable` target producing one `.exe`;
      cross-build from macOS. Verification: the artifact exists, its size is recorded, and the user
      runs it once on Windows to confirm it opens. **This is step 2 on purpose** — packaging is the
      only part of this plan the repo has never done, and finding out it is hard is worth doing before
      any UI exists.
- [ ] **3. The ASI as a build resource.** The build copies `asi/perfect-cutscene/dist/perfect-cutscene.asi`
      into the app's resources and records its SHA into an about screen; **the build FAILS with a
      message naming the `make` command when the binary is absent.** Verification: a build with the
      file present embeds it; a build without it fails, and the failure tells you what to do.
- [ ] **4. The three-step wizard, wired.** Folder pickers for game / cars / out; each selection runs
      its validations through `@opensa/validation` and renders verdicts (error blocks the step,
      warning does not); "Convert" runs the tool in a forked child process with `--no-base-copy` and
      `--self-contained-txd`, streaming its output lines into a log pane; on success the out folder
      holds the three files + the ASI, and the app offers to open it.
      Verification: a real end-to-end run against `game-src/original` + `mods-src/original/vehicles`,
      output diffed against a CLI run of the same inputs — **byte-identical, or the facade is lying**.
- [ ] **5. The failure surface.** Every way this can go wrong, with a message a stranger can act on:
      wrong game folder (which file was missing), unsupported exe (what it found vs what it needs and
      what that costs them), no cars matched, some slots uncovered (named), out folder unwritable or
      equal to the game, the tool throwing mid-run, not enough disk. Verification: each is reachable
      in a test or by hand, and each screenshot is reviewed as COPY, not as code.
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
