# Per-array checkpoints for the ASTC encode

**Came out of:** the phone's map-only convert on 2026-08-25
([the timing row](../benchmarks/tools/2026-08-25-phone-map-only-astc-encode-wall.md)), where a run killed by
Android at 6 m 25 s lost 45 minutes of encoding and the weld checkpoints saved 77 seconds of it.

## What it is

`opensa-pack` journals every weld chunk under `--checkpoints` and resumes at the first chunk without one
(`openCheckpoints` in `convert.ts`). The texture encode is a single call **after** that loop —
`encodeTextureArrays(planner, astc, threads, log)` at `convert.ts:335` — and nothing about it is
checkpointed. It reports its own progress array by array (`astc: array 3/26 — 5.2/56.5 M texels`), so the
unit is already there; only the persistence is missing.

The work: write each encoded array to the checkpoint directory as it is produced, keyed by the planner's
array identity, and on `--resume` load the ones already on disk and encode only the rest. A kill then costs
at most one array — on the measured run, ~90 s instead of ~2 550 s.

## Why it is deferred

**Because the run that needs it should not exist.** The encode is 97 % of a map-only convert, and
`TEXTURES=rgba8` removes the stage entirely — same weld, no encode, and the console gets a map on screen in
a couple of minutes rather than not at all. For the map work the phone is doing right now, checkpointing the
encode is optimising a stage that should be skipped.

It is also not free to get right: an array's bytes are only valid for the planner state that produced them,
so the journal has to carry enough of the plan to prove a loaded array belongs to this build. Replaying a
stale array into a fresh plan is the same class of silent, unreproducible output the weld checkpoints already
had to be guarded against ([the recipe stamp in `phone.sh`](../../scripts/phone.sh)).

## The trigger

**An ASTC pak has to be built ON the phone.** The moment the device must produce the shipping texture format
rather than the rgba8 A/B side — a field measurement that needs the real texture budget, or a pak built on
the phone for someone else to run — the encode becomes unavoidable and a 45-minute unresumable stage on a
device that kills at minute six is a stage that never finishes.

Two things would also retire this card instead of triggering it: an encoder that can use more than one
thread on this device without the isolate blow-up that forced `--astc-threads 1`, or a phone that stops
being killed (the EMUI settings and the Android 12+ phantom-process limit are in
[termux.md](../development/termux.md)).

**THE FIRST OF THOSE WAS TESTED 2026-09-11 AND IS NOT AVAILABLE.** `ASTC_THREADS=2` was the retry
`phone.sh` had been asking for since 08-25, and it does not blow up — it STALLS: the weld finishes in the
same 45 s as the single-threaded run and then `encoding texture arrays` prints not one array line for over
half an hour, with the process alive throughout. The comparison is clean because both runs held
`HEAP=1536` and differed in that one knob; the single-threaded half encoded its first array at 30 s. So the
2.38x measured on a desktop in 2026-08-07 is not reachable here, and the escape this card offered through
*more threads* is closed.

**And the same pair priced the trigger.** The pinned district is **18.3 M texels** and encodes in ~21
minutes single-threaded. Texels grow SUBLINEARLY in cells — 4 cells 18.3 M against 16 cells 56.5 M, because
map objects share one world dictionary — which extrapolates the full 576-cell map to roughly **1.0 G texels
and ~20 hours** of continuous, unresumable encode. That is the number this card is about, and it is now
arithmetic from a measurement rather than an estimate.

## Where the trigger is checked

`scripts/phone.sh`, in the branch that reports a failed convert: when `TEXTURES=astc` it already tells the
operator that the encode is the last stage and offers `TEXTURES=rgba8` as the way past it. That message
names this card, so an operator who hits the wall reads the reasoning before paying for the investigation
again.
