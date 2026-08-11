# 005 — One report per target, assembled at the end of the chain

**Status: PLANNED 2026-08-11 (user's proposal).** Make report generation its own step at the end of EACH
chain — `opensa` and `sa` alike — instead of a side effect of one branch.

## The problem, and it has already cost two rounds in one hour

**What lands in `report.json` today depends on which target you built.** The root report is written inside
`buildOpensaTarget` from the pack's report; the `sa` target runs with `--exclude opensa`, never reaches that
writer, and therefore produces **no machine-readable summary at all** — for the target that ships into the
real game.

Two failures on 2026-08-11, the same shape both times:

1. The UV-repair ledger (plan 025) was merged into the root report — and the `sa` build printed its console
   line while writing the list nowhere, because it never runs the opensa branch.
2. The fix for that was a sidecar written by the optimize stage (`<out>/uv-stretch.json`). It works, and it
   is the first crack of exactly the drift this plan exists to stop: **each tool writing its own file beside
   the build because there is no assembler to hand a fragment to.**

The root cause is structural: **the stage runner discards stage return values** (`await timed(stage.name, ()
=> stage.run(game, out))`), so nothing a stage learns can reach a report unless the stage writes a file
itself or a closure variable is threaded by hand — which is what `uvStretchLedger` is.

## The shape

- **The runner COLLECTS.** `stage.run` already returns a value; keep it, keyed by stage name. That single
  change is what makes every other part of this possible, and it is also the riskiest — it touches the chain
  every build depends on.
- **A final `report` step per target**, after the target's own stages, that assembles: the build target, the
  source game dir and its id, the timings already gathered, and one fragment per stage that produced one.
  It builds no game dir, so it is a STEP and not a pipeline stage — `STAGE_NAMES` ordering and
  `--until`/`--exclude` must not be able to skip it by accident (or if they can, that must be deliberate and
  stated).
- **Written as `<out>/report-<target>.json`** — `report-opensa.json`, `report-sa.json` (user, 2026-08-11:
  *"иначе перезатрем"*). Two targets share one `--out`, so a single unnamed `report.json` is not a summary of
  a run, it is a summary of **whichever target happened to finish last** — which is exactly the state that
  produced today's confusion, where the file on disk was the opensa run's while the sa build had just ended.
  **There is no unnamed root report after this plan.** The name is the target, always, and a reader that
  cannot say which target it wants was never going to read the right file.
  Every current consumer of the bare `report.json` therefore has to be found and updated in the same change —
  see the risk section; a rename is exactly the kind of break that is silent at build time.
- **Fragments are typed per stage**, a discriminated union rather than a bag — otherwise the report becomes a
  dumping ground and its consumers start doing `?.` archaeology.

## `.work` follows the same rule: `.work-<target>`

Same defect, one level down and older (user, 2026-08-11). **`<out>/.work` is wiped at the start of EVERY pmb
run**, so building one target destroys the kept stages of the other — with `--keepWork` set for step-by-step
debugging, a `sa` build silently throws away everything a previous `opensa` run was keeping, and the only
symptom is that the folder you were about to look at is gone.

`.work-opensa` / `.work-sa` makes the two runs independent, and it is what lets a target be re-run without
disturbing the other's intermediates at all.

**The cost, and it is real:** the two chains are NOT the same before the split — the `sa` target runs with
`--exclude vehicles,peds`, so its common stages genuinely differ and cannot be shared. Under `--keepWork`
that means two full sets of intermediate GAME DIRS, several GB each. Without `--keepWork` nothing changes:
stages are still deleted as they are consumed, so only one lives at a time per chain.

**Owed with it:** the `--until` flow keeps `.work` deliberately, and `docs/commands.md` plus anything that
names `.work` by hand (debug recipes, the `model-repack` lab notes) has to move to the new names in the same
change — a stale path here reads as "the build produced nothing".

## What it fixes beyond the immediate bug

- `sa` gets a report at all. It ships to the real game, budgets against real ceilings
  (`reportInstallRequirements`, `procobj cost`, the ID-pool guards) and today all of that exists only as
  console output that nobody can diff.
- The pack's own report stays beside its pak — this plan does not move it, it stops the ROOT copy from being
  the pack's report wearing the run's name.
- `uv-stretch.json` is absorbed and deleted: the fragment goes back to being a fragment.

## Cost and risk, priced honestly

- **This is chain plumbing, and every build depends on it.** The runner change is small in lines and large in
  blast radius.
- **A rename is a silent break.** `report.json` and `.work` are named by hand in debug recipes, in
  `docs/commands.md`, in the crosstxd skill and in memory notes. Each one that is missed fails by reading an
  absent file, which looks like "the build produced nothing" rather than "the path moved".
- **Do not start it under a verification.** The user is about to check two builds and decide on merging
  `025-world-visibility`; changing how builds are assembled underneath that is precisely what invalidates a
  field round. **This lands after that merge, not before.**
- Existing consumers of `build/<game>/report.json` must be found first — `scripts/debug/` reads it, the
  crosstxd skill reads `textures.crossTxd`, and a moved or reshaped root file breaks them silently.

## Verification

- A `--exclude opensa` run (the `sa` target) produces `report-sa.json` containing its own stages' fragments —
  the case that has no report today.
- A full run produces BOTH `report-opensa.json` and `report-sa.json`, and building one target afterwards
  leaves the other's report untouched. That is the regression test for the whole plan: today the second build
  overwrites the first's report, and under `--keepWork` it also deletes the first's `.work`.
- The UV ledger arrives through the fragment path with `uv-stretch.json` gone, and its `repairedModels` list
  is byte-identical to what the sidecar wrote for the same input.
- Every current consumer of the bare `report.json` is updated in the same change; a grep for the literal
  name comes back empty afterwards.
- Under `--keepWork`, `sa` then `opensa` leaves BOTH `.work-sa` and `.work-opensa` intact — the failure this
  fixes, and the one that is invisible until you go looking for a folder that is no longer there.
