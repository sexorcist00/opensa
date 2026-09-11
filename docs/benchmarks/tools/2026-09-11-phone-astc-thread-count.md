# 2026-09-11 — two ASTC threads STALL the encode on this phone

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

## What this row does NOT say

The single-threaded half's **total** encode time, because the tunnel dropped mid-run — the eta was still
falling (1 226 → 820 s) and an eta is not a measurement. A row claiming ~21 minutes would be quoting a
prediction the encoder made about itself.
