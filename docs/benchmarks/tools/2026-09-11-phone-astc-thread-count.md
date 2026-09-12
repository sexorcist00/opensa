# 2026-09-11 — the ASTC encode never stalled: one array is 74 % of the work

**Tool:** `opensa-pack`, driven by `scripts/phone.sh` through the phone console's MCP (`phone_run phone`).
**Inputs:** `game-src/original`, district `los-santos-centre` (rect `5,-7,6,-6` — 4 grid cells, the pinned
one), `--textures astc --max-texture 256 --no-ao --platforms mobile --no-models`, `VEHICLES` unused at
`MODELS=0`.
**Machine:** the development phone (Huawei `MGA-LX3`, ARM Bifrost, Termux) — the same device as
[the 08-25 row](./2026-08-25-phone-map-only-astc-encode-wall.md), which this one answers.

Recorded before being read, per the standing rule. **Partial**: the single-threaded half was still encoding
when the panel's tunnel dropped, so its FINAL wall time is not in this row. Everything below is from lines
the panel had already journalled.

## Why it was run

`scripts/phone.sh` had carried an open invitation since 08-25, in its own words: *"WORTH RETRYING, and
nobody has: the three deaths were caused by the bug FIXED on 2026-08-09, not by the thread count surviving
it. `2` has not been tried since. The pool measured 2.38x one thread and is bit-identical, so it is a free 2x
if the address space allows."* The 08-25 row had concluded that an ASTC convert cannot finish on this
device; if the pool worked, that conclusion was drawn against a handicapped encoder.

## The pair

Both runs on the pinned district, both `HEAP=1536`, both into `./build/phone-t2`. **One knob differs.**

| | `ASTC_THREADS=2` | `ASTC_THREADS=1` |
| --- | --- | --- |
| weld, 4 cells | **45.5 s** | **42.2 s** |
| collision bake | 9 cells / 49 870 tris | 9 cells / 49 870 tris |
| `encoding texture arrays` reached | yes | yes |
| first array line | **NONE, for over half an hour** | **30 s** |
| progress after that | none — process alive throughout | 4/20 arrays at 145 s, eta falling 1226 → 820 s |
| total texels | — | **18.3 M** across 20 arrays |

## What it says

**Two threads do not blow up — they STALL.** The process never died; it reached the encode and stopped
making progress. That is a different failure from the three deaths of 08-09, and it is worse to diagnose:
a killed run says so, a stalled one looks like a slow one.

**The equal weld times are what make the comparison clean.** 45.5 against 42.2 s on identical work means
`HEAP=1536` costs nothing before the encode, so the stall belongs to the thread pool rather than to the
heap reservation. (The first reading of this pair blamed the heap; the weld times refute it.)

**So the 2.38x measured on 2026-08-07 is not reachable on this device.** It was measured where the isolates
have room. `--astc-threads 1` is therefore REQUIRED here rather than merely proven, and the note in
`phone.sh` says that now instead of inviting the retry.

## What it changes

- **The 08-25 conclusion stands, and now for a demonstrated reason.** An ASTC convert on this phone is
  single-threaded, full stop; the escape through more threads is closed by measurement rather than by
  caution.
- **It prices the full map.** 4 cells are 18.3 M texels; 16 cells were 56.5 M on 08-25 — **sublinear**,
  because map objects share one world texture dictionary rather than carrying copies
  ([world-streaming.md](../../architecture/world-streaming.md)). Fitting those two points puts the whole
  576-cell map near **1.0 G texels**, which at this rate is roughly **20 hours** of continuous, unresumable
  encode on a device that kills background work.
- **That is the trigger of [`opensa-pack-encode-checkpoints`](../../in-reserve/opensa-pack-encode-checkpoints.md)**,
  whose own card named *"an encoder that can use more than one thread on this device"* as one of the two
  things that would retire it instead. Tested; not available.

## CORRECTION, same day: ONE thread stalls too

**A third run refutes the headline above, and it is filed rather than edited away.** After the panel was
restarted the single-threaded convert was started again on the same district. It reached the encode and
printed the same four arrays — `1/20` and `2/20` at 25 s, `3/20` and `4/20` at 177-178 s, 2.7 of 18.3 M
texels — and then **nothing for over 45 minutes**, with the process alive throughout. Its own eta at that
point was ~1 007 s, so it is far past the time it predicted for the WHOLE stage.

So the difference between the two thread counts is narrower than this row first claimed:

| | `ASTC_THREADS=2` | `ASTC_THREADS=1` |
| --- | --- | --- |
| arrays before it went quiet | **0** | **4 of 20** (2.7 of 18.3 M texels) |
| then | silent, alive | silent, alive |

**What survives:** two threads is worse — it produces no array at all where one thread produces four. That
comparison still holds and `--astc-threads 1` is still the right default.

**What does NOT survive:** the reading that one thread *works* and two *stall*. Both stall; one simply gets
further. Whatever is wrong is not only the thread pool, and the 08-25 row's *"the encode is the wall"* is
looking like a understatement rather than a rate problem — a rate would keep printing.

**What is now unexplained and needs its own investigation**: what array 5 is, and whether the encoder is
grinding on one enormous array or has hung. The next instrument this wants is per-ARRAY size in the log
before the encode of that array starts, rather than after it finishes — the current line can only report an
array that completed, which is precisely the thing that stops happening.

## SECOND CORRECTION: the pair may not be a pair at all

**The operator's own report, hours later: the screen was off during these runs.** That is not a detail — it
is a confound that reaches the whole row.

`termux-wake-lock` keeps the CPU awake and the log records it held, but it does not defeat EMUI's
PowerGenie, which [termux.md](../../development/termux.md) already calls the most aggressive background
killer of any Android skin. A frozen process is ALIVE and makes no progress — which is exactly the symptom
both runs showed, and exactly what neither the kill-signature test nor the thread comparison can tell apart
from a real stall.

**So `0 arrays against 4` may be nothing but how long the screen happened to be on in each run.** The two
runs were not controlled for the one variable that turns out to matter most, and no conclusion about the
thread pool can be drawn from them. The rows above stay as filed — they are what was logged — but the
verdict they carried is withdrawn until a run with the screen ON says otherwise.

**What this costs, stated plainly**: a day's worth of conclusions about `--astc-threads`, and the 08-25 row's
own *"Android killed it at 6 m 25 s"* now also wants re-reading — a kill and a freeze are different failures
and this project has been treating them as one.

## THIRD CORRECTION, and this one is the answer: array 5 is 74 % of the work

**Nothing ever hung.** The instrument added after the stalls says so on the first run that carried it:

```
astc: array 1/20 starting — 0.4 M texels, 107 layers at 64x64
astc: array 2/20 starting — 0.0 M texels, 3 layers at 4x4
astc: array 3/20 starting — 2.3 M texels, 141 layers at 128x128
astc: array 4/20 starting — 0.0 M texels, 2 layers at 16x16
astc: array 5/20 starting — 13.5 M texels, 206 layers at 256x256
```

**Array 5 alone is 13.5 of the district's 18.3 M texels — 74 % of the stage in ONE array**, 206 layers at
256x256. Four small arrays finish in the first two minutes, and then the encoder spends the rest of the run
inside a single unit of work whose completion is the only thing that prints. Every "stall" in this file was
that array being encoded.

So the readings collected all day were of one shape: *four arrays and then silence*. They were correctly
observed and wrongly explained three times — thread count, then heap size, then thermal throttling. The
observation never distinguished them because **the progress line reported an array that had FINISHED**, and
the array that mattered had not.

**What still stands from the corrections above:** `HEAP=1536` is required on this device — with the default
4096 the weld itself does not complete, measured across three runs each way. That one is real and separate.

**What is now explained rather than mysterious:** everything else. And the run that produced these lines is
also the first where `--resume` engaged (`resuming the last convert from …/.pack-checkpoints`), after the
stamp was moved out of the directory the pack deletes.

## What this row does NOT say

The single-threaded half's **total** encode time, because the tunnel dropped mid-run — the eta was still
falling (1 226 → 820 s) and an eta is not a measurement. A row claiming ~21 minutes would be quoting a
prediction the encoder made about itself.

## What the instrument still could not answer, and the heartbeat that closes it (2026-09-12)

Array 5 then ran for roughly two hours against the eta's ~11 minutes, and **this file draws no conclusion
from that** — a fourth explanation guessed from the same silent observation would be the same mistake a
fourth time. The eta is texel-proportional, which assumes a constant cost per texel; whether that assumption
holds across layer sides (64x64 through 256x256) has not been measured, and the run that would have measured
it never finished.

What is certain is the shape of the gap: the per-array lines are the finest granularity the loop had, and one
array is 74 % of the stage — so a working encoder and a frozen process still produced the same log for over
an hour. That is the same indistinguishability the previous correction was about, only one level down, and
the screen-off freeze this device actually has (`docs/development/termux.md`) lands in exactly that blind
spot.

So the encoder now beats from **inside** an array: `astc: array 5/20 layer 96/206, 1 412s in`, one line a
minute (`HEARTBEAT_MS`, `convert.ts`). Silence now means frozen, and the layer counter divided by the seconds
gives the per-layer rate directly — which is the measurement that would settle the eta question without
another whole run being spent on it.
