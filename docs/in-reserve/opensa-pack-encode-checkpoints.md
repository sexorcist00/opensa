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

**THE FIRST OF THOSE WAS PROBED 2026-09-11 AND THE PROBE WAS UNREADABLE** — see the correction at the end
of [its row](../benchmarks/tools/2026-09-11-phone-astc-thread-count.md): every reading that day was taken
through a blind spot in the log, and nothing about the thread pool was actually established.

**What the day DID establish belongs here, because it changes this card's shape.** The pinned district's
`array 5/20` is **13.5 of 18.3 M texels — 74 % of the stage in ONE array**. A checkpoint granularity of *per
array* would therefore save almost nothing on a district: a kill during array 5 loses 74 % of the work
whether or not the four arrays before it were journalled. **If this card is ever built, its unit has to be
smaller than an array** — a layer, or a band of layers — or it will be a journal that cannot help the only
case it exists for. That is a design constraint the card did not have this morning.

**The escape through more threads is therefore still OPEN and still untested**, which is worth saying
plainly: it was reported closed for several hours on 2026-09-11 and it was not.

**What the day did give this card is the TRIGGER's size.** The pinned district is **18.3 M texels**. Texels
grow SUBLINEARLY in cells — 4 cells 18.3 M against 16 cells 56.5 M, because map objects share one world
dictionary — which extrapolates the full 576-cell map to roughly **1.0 G texels**. The per-texel RATE is
still owed: every figure quoted that day was the encoder's own eta rather than a completed stage, and an eta
is not a measurement.

## A neighbour that WAS broken, and is fixed (2026-09-11)

This card is about the ENCODE having no checkpoints. The WELD has had them since the beginning — and they
had never once worked through `scripts/phone.sh`.

The script stamped its recipe at `$OUT/.pack-checkpoints/.recipe`, inside the journal directory. But
`clearChunkCheckpoints` is an `rm -rf` of that whole directory, and the pack runs it at the start of every
convert that is not a resume — so each run deleted the stamp it had just written. Every later run then found
a journal with no stamp, called it pre-stamp, dropped it and welded from scratch. **The loop was
self-sustaining: each run destroyed the evidence the next one needed.** Five converts in a row re-welded
four cells for nothing before the message was read instead of skimmed.

The stamp lives BESIDE the journal now (`$OUT/.pack-recipe`), where the pack does not reach. For four cells
this was 40 s a retry; on the full map it would be 46 minutes a retry, which is the number that makes it
belong in this card's neighbourhood at all.

## Where the trigger is checked

`scripts/phone.sh`, in the branch that reports a failed convert: when `TEXTURES=astc` it already tells the
operator that the encode is the last stage and offers `TEXTURES=rgba8` as the way past it. That message
names this card, so an operator who hits the wall reads the reasoning before paying for the investigation
again.
