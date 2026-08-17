# 006 — `--resume`: a resume point in `.work-<target>`, and checkpoints inside the pack stage

**Status: 📋 PLANNED 2026-08-17** (his idea, the day the first `original` opensa build in weeks died at the
LAST step of a 55-minute run — the pack's archive rewrite — and had to be re-run from stage 1). Build after
the current run lands green.

Restrictions checked 2026-08-17: `restrictions/architecture.md` — *a build's SOURCE may not live inside its
own output; `<out>/.work-<target>` is wiped before any stage reads `--game`* (the resume carve-out below has
to keep that guard for everything but the resume state itself, and prove the state is the run's own);
*a stage in the common chain may not produce different content per target in one run* (a resume is
per `.work-<target>`, so it inherits that); `restrictions/build-vs-runtime.md` — never re-pack a pack
output (a resume of the pack stage reads the KEPT pack input, never `<out>/opensa`).

## The idea

`<out>/.work-<target>/` already IS the run's state: `1-mods`, `2-vehicles`, … one dir per stage, each a
whole game tree. What is missing is (1) a MANIFEST saying which stages are done and against what inputs,
(2) keeping the consumed stage dirs until the run ends green (today a stage dir is `rmSync`'d as soon as the
next stage has read it, and the whole work dir at the end — `pipeline.ts:371, 460`), and (3) checkpoints
INSIDE the one stage that costs more than all the others together: `pack` (~35 min of a 55-min run — 16
weld chunks, then six model classes, then the archive rewrite).

`pmb --resume` then: reads the manifest, verifies the fingerprint, skips every stage marked done (its dir is
the next stage's `--game`), and enters the failed stage — the pack entering at its last finished chunk.

## Phase 1 — stage-level resume

- `.work-<target>/resume.json`: `{ target, configHash, sourceFingerprint, stages: [{name, dir, doneAt,
  seconds}], failed?: {name, error} }`, written after EVERY stage (and on failure). `configHash` = the resolved
  run config (target, excludes, procobj density, split buckets — everything `build-timings.json` records
  today); `sourceFingerprint` = per source root (`--game`, `mods-src/<game>/{mods,vehicles,peds,vegetation,
  procobj}`) a cheap fingerprint: file count + total bytes + newest mtime, per root. A resume whose
  fingerprint differs REFUSES: *"mods-src/original/vehicles changed since the run this resumes (…) — a
  resumed build over changed sources is a build nobody can reproduce; run without --resume"*. This is the
  whole safety of the feature and it must be loud: a stale resume is SILENT otherwise (the tree builds, it
  just does not contain what the sources say).
- Consumed stage dirs are kept until the run finishes green (then deleted as today, unless `--keep-work`).
  Cost: disk — a full `original` run holds ~7 stage trees of 3–4 GB each; state it in `docs/edge-cases/`
  and let `--no-checkpoints` opt out for a machine that cannot afford it.
- The wipe-before-read guard keeps wiping everything under `.work-<target>` EXCEPT under `--resume`, where
  it wipes only the stages the manifest does not mark done — and still refuses a `--game` inside the work dir.
- Failure path: the failed stage's partial dir is deleted before re-entering it (a half-written stage is
  worse than none — the same rule `writeImgFile` follows for a half-written archive).

## Phase 2 — checkpoints inside `pack`

`convertDistrict` runs 16 chunks in a fixed order and its `TexturePlanner` assigns `(arrayRef, layer)`
eagerly across them — chunk N's plan depends on chunks 1..N-1. A per-chunk checkpoint therefore has to
persist, after each chunk: the welded cell payloads of that chunk (already wire-compressed bytes + their
manifest entries) AND a snapshot of the planner (`byContent`/`byName` → `(arrayRef, layer)`, bucket
layer counts, `nextArrayRef`, `missing`/`crossTxd` ledgers). Resume = load the snapshot into a fresh
planner, replay nothing, continue at chunk N+1. **The planner snapshot is the artifact
`docs/in-reserve/ospak-in-place-cell-patch.md` needs** (a subset weld cannot reproduce the shipping
pak's layer indexes because the plan is not persisted) — write it as a first-class sidecar
(`pak/texture-plan.json`, kept in the OUTPUT too), and that card's trigger moves closer for free.

Then the model classes: each class writes its bundles into `.work-<target>/pack/models/<class>.done`
with the `.osm` bytes it produced (they are inserted into archives only at the very end), so a resume after
"vehicles converted, peds failed" re-runs peds only. The archive rewrite is last and is idempotent per
family (`rewriteModelArchives`, 2026-08-17): re-running it is safe.

The pak assembly (`buildOspak`) is cheap relative to the weld and is redone from the checkpoints.

## Phase 3 — the surface

`pmb … --resume` (no other flags needed — everything else comes from the manifest, and a flag that differs
from the manifest is refused as a changed config); `docs/commands.md`; a `resume` line in the run banner
(`resuming <target> at <stage>[/chunk N] from <doneAt>`); `build-timings.json` marks the resumed stages so a
resumed run's numbers are never mistaken for a fresh run's (the benchmark schema wants which build a run
read — a resumed one says so).

## What it does not do

- It does not make the pipeline incremental against source CHANGES — a changed mod re-runs from stage 1.
  That is a different, larger design (content-addressed stage inputs) and this plan must not pretend to it.
- It does not resume across a code change: the manifest carries the git HEAD of the run and a resume from a
  different HEAD is refused (a stage's OUTPUT depends on the code that wrote it).

## Verification, when built

`pipeline.test.ts`: a run killed after stage N resumes at N+1 with the same bytes as an unbroken run
(byte-identical intermediate trees); a fingerprint change refuses; a HEAD change refuses; a pack killed
after chunk K resumes at K+1 with a byte-identical `world.ospak` + `manifest.json` (the determinism contract
`convert.ts` already states — "reruns stay byte-identical"). Measured: minutes saved on the real failure of
2026-08-17 (a 55-min run re-entered at its last step instead of from stage 1).
