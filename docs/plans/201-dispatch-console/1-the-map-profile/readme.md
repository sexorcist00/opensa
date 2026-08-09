# 201/1 — The map profile: cut what is dead, keep what is alive

**The lead chain.** Trim the engine to what this surface actually uses — and nothing further.

The opposite reading is the tempting one and it is wrong. A dispatch map is not a schematic: **cars and peds
are drawn and animated, vegetation sways, the day turns, the weather colours the world.** That is the
difference between a 3D map and a tile stack, and it is exactly what
[directive 6](../../../project-goals.md#6-the-target-is-a-aaa-grade-game-and-that-is-a-measurable-claim)
means by a world that is alive. The profile may not take any of it.

What it takes is the **dead** half: pak entries no frame of this surface ever requests, passes with no
consumer on screen, and bundle code that never executes.

## The three rules this chain is written under

**Keep by default.** A cut needs one of exactly two grounds, and the step must name which: **(a)** the
inventory shows the entry or pass is *never read by this surface*, or **(b)** a measurement on the target
device shows it costs more than it returns — and then the answer is a **cheaper honest version** (a slower
cadence, a smaller ring, a further LOD), not a switched-off feature.

**A world that got deader is a regression, not an optimisation.** It is reverted whatever the profiler said.

**One engine, PC and mobile.** The profile is a budget and a build target, never a fork of the codebase: no
second renderer, no "mobile shader path", no parallel shader set. The platform difference is expressed in
numbers the frame *reads*, not branches the frame *executes*. A per-feature quality ladder was already
measured and refused here
([render-scale-tier](../../../performance/deferred-optimizations/render-scale-tier.md)); the profile stays
one named target that both a build and a frame can be audited against.

Two more that bound the whole chain:

- **Never touch what a mod author's files mean.** The profile is a build *target*, not a format change —
  [`docs/contracts/`](../../../contracts/) is untouched, and a console pointed at a full pak must still open
  it. See [build-vs-runtime](../../../restrictions/build-vs-runtime.md).
- **Anything rejected for being worse** goes to
  [`docs/performance/deferred-optimizations/`](../../../performance/README.md) with its price attached, so it
  is revisited when the frame budget is blown instead of re-derived.

## Steps

### 01 — The inventory

What a map view actually reads, measured **before anything is cut**. No cut is proposed in this step; its
whole output is a before-table.

Three columns wide, each with the instrument that produces it — so this step starts by running things that
exist rather than by deciding how to measure:

| Dimension | What it lists | Instrument |
| --- | --- | --- |
| Frame | every pass the console's frame runs, its cost, and whether anything on screen consumes it | the frame-time attribution spans from [091](../../091-frame-time-attribution/readme.md) and `scripts/debug/slow-frame-census.ts`; a pass with no span is itself a finding — **plus the CPU-side split below, because on the target device that finding turned out to be the whole frame** |
| Bytes | every pak entry kind the console fetches, how many bytes, and how many times | `opensa-pack`'s `report.json` for what the build contains, against the console's own fetches for what it actually asks for. **The gap between those two is the whole point of chain 1** |
| Bundle | every module the console ships, its kB, and whether it ever executes | the vite build output plus `npm run knip` |

Record two things beyond the tables, both of which later steps depend on and neither of which exists today:

- **whether any per-cell error metric is present** in the pak — **step 05** needs one and
  the answer is expected to be no;
- **the district**, pinned here and reused by every later measurement in 201.

### The measurement district — pinned once, here

Every before/after number in this chain, and the phone row in
[chain 2](../2-real-device-truth/readme.md), must be taken on **the same ground**. A before-table from one
district and an after-table from another is not an A/B, and the repo has already paid for that lesson
(`CLAUDE.md`: an A/B must be self-describing).

**Pinned 2026-08-06: the centre of Los Santos** (`?district=los-santos-centre`, opening at `1480,-1720`).
Dense, mixed heights, water within the view, and the part of the map an operator actually watches — not an
empty stretch that flatters every number. Every later step names it; a number taken anywhere else is not
part of this chain's before/after.

**Re-affirmed 2026-08-08, and the pin now moves the tools instead of the other way round.** The first real
mobile capture was taken on Ganton, because that is the rect `phone.sh` converted by default — the pin was a
sentence in this document and nothing read it. It is now a table
(`apps/dispatch/src/world/districts.ts`) that the pak rect, the game spawn, the map's opening point and the
report all read, so:

- `npm run phone` converts **`los-santos-centre` by default**, and `DISTRICT=` picks another;
- `?district=<name>` alone opens the camera over that district — the label and the ground come from one place
  and cannot disagree;
- a report taken anywhere but the pinned district **says so in its own `warnings`**, instead of a paragraph
  written by hand after it is filed.

Its rect is `5,-7,6,-6` — the same 2×2 shape Ganton was converted at, anchored on the cell `1480,-1720`
falls in, so the two differ in CONTENT and not in how much world was built. That shape is not only
convenience: the Ganton row measured **~60 MB resident per cell**, so a 3×3 district would sit at roughly
540 MB against a 300–500 MB ceiling. Widening the rect is therefore a decision with a number attached, and it
belongs to [1/03](#03--the-pak-profile) rather than to the pin.

**Budget:** none — this step spends nothing and changes nothing.
**Owes:** the three tables and the pinned district, recorded in `docs/benchmarks/` **before** they are
analysed (standing rule), naming the pak build that was read.

**On which machine — settled 2026-08-06: the phone is the baseline.** This chain was written as *desktop
baseline first, phone second*, and the development machine is an Android phone
([development/termux.md](../../../development/termux.md)). So every number in 201 is taken on the device the
product targets, and none of them is comparable to the repo's existing desktop rows — which the mobile
benchmark schema already declares as a rule ([200/1-02](../../200-platform-reach/1-device-truth/readme.md)).

**The instrument exists:** `?inventory=1` collects the frame half and hands it over through a copy button,
because there is no headless capture on this machine. Invocation and what it cannot measure:
[development/query-parameters.md](../../../development/query-parameters.md).

**And it had to grow a CPU side, which is a finding rather than a feature** (2026-08-08). The first real
capture on this device came back with **no `timestamp-query` at all**, empty `spans`, and `submitMs` at 5.6 %
of the frame: 94 % of the frame had no owner, and no GPU timer exists on this adapter to give it one. A step
told to cut what is never read cannot proceed against that, so the collector now also records **where the
main thread's own time goes** — a number every device can produce:

| Field | What it settles |
| --- | --- |
| `cpu.bodyMeanMs` / `cpu.outsideMeanMs` | is the frame WORKING or WAITING? The two have opposite fixes and the p50 cannot tell them apart |
| `cpu.segmentsMs` | which part of the body — `engine-frame`, `overlay-2d`, `board`, `stream`, `readout`, and `other` for what nobody claimed |
| `frame.dtHistogramMs` | dt per 2 ms bin: piled at 16.7/33.3 is a missed vsync deadline, spread is genuine cost. The open question the 08-07 row could not answer |

It is a **proxy, not a GPU timer**: what is outside the body stays one number (present, backpressure, vsync,
other tasks, GC together). That is the honest ceiling of what this device can measure, and it is still the
difference between 94 % unattributed and one named residual.

The segments are timed with a SECOND `FrameSpans` recorder, never the shared one — a span opened inside the
loop body would be subtracted from `dt` twice
([restrictions/architecture.md](../../../restrictions/architecture.md#a-frame-time-span-may-only-wrap-synchronous-work-that-runs-between-frames)).

> **This step cannot run in a container without game data.** A field run reads `build/<game>/opensa` and
> nothing else ([restrictions/architecture.md](../../../restrictions/architecture.md)), so 01 runs on a
> machine with a built game — everything downstream of it is blocked until it does.

### 02 — The protected list

**DONE 2026-08-09 — [the list](protected-list.md).** Written **before the first cut**, so the trim cannot
quietly eat the life of the world. Six rows, each naming what carries the item in code or data (so "we kept
it" is checkable) and whether losing it is caught or **silent — four of the six are**, which is why the
chain's verification is a field verdict rather than a screenshot pair. Baked collision is recorded there as
what it is: a conditional candidate for 03, not a protected item. What may not be removed at any measurement:

- **cars and peds drawn and animated** — see [5/04](../5-symbology-and-picking-as-product/readme.md), which
  makes this a decision rather than a gap;
- **vegetation sway** (the baked per-vertex amplitudes and `Environment.windStrength`);
- **the day/night cycle and timecyc** — the console's hour slider already drives it;
- **the weather mood**, the lit world, and vehicle reflections;
- **one engine across PC and mobile.**

**Owes:** the list itself, plus a line in every later step naming what it touched from it — normally nothing.
A step that touches a protected item must carry the cheaper-version argument, not a removal.

### 03 — The pak profile

A build target that omits only entries 01 proved this surface never reads. Every omission names its evidence
from 01; there is no "a map does not need it" without a measurement behind it.

**Baked collision is a conditional candidate**, not a given: it leaves only if
[5/04](../5-symbology-and-picking-as-product/readme.md) settles that units are kinematic rather than
simulated. Vehicle and ped dictionaries and ped animation are **protected** by 02 and stay.

**Owes:** bytes and resident MB before/after on the **district pinned in step 01**, against the BC reference
(1,272,901,632 B at 1137 cells), **and** the "kept, and why" list beside the "cut, and on what evidence" one.

### 04 — The frame profile

Passes are **priced, not deleted**. A pass with no consumer on screen already costs nothing by construction;
a protected pass that is expensive on a phone gets a cheaper version.

Two already-priced levers this profile can take honestly:

| Lever | Priced at | What the profile may do |
| --- | --- | --- |
| [env-probe cadence](../../../performance/deferred-optimizations/env-probe-cadence.md) | 0.2–1.9 ms, 5.8 ms worst | vehicle reflections are protected → **cadence**, never off |
| [foliage fill](../../../performance/deferred-optimizations/foliage-fill.md) | 13.72 → 7.63 ms in the measured case | sway is protected → the overdraw is what gets cut, not the motion |

**Budget:** name the console's frame budget on the target device before changing a pass, per
[directive 5](../../../project-goals.md#5-performance-is-a-requirement-not-an-outcome).

**Owes, to close the step:** desktop frame time before/after on the **district pinned in step 01**,
and a verdict per pass — *kept / made cheaper / removed* — with its ground.

**Owes, after [2/03](../2-real-device-truth/readme.md):** the same table re-taken on the phone. This is a
**named follow-up, not a blocker** — the chain would otherwise deadlock, since chain 2 measures the profile
this step produces. A pass judged cheap on a desktop and expensive on a phone comes back here, and the
re-take is what closes chain 1 for good.

### 05 — The streaming profile

At map altitude the world is nearly all far-LOD, while the HD ring streams for a camera nobody is standing
at. Anchor the ring policy to the map's focus rather than to a player. This **redistributes** detail; it does
not lose it.

**The prerequisite nobody had noticed:** the intended rule is LOD by **screen-space error** — a cell loads
when its projected error exceeds N pixels, which is what makes one rule work at every zoom and on every
screen instead of a ladder of hand-picked radii. That computation needs a **geometric error per cell**: the
error introduced by drawing this cell instead of its finer content, in world units. **Our pak carries no such
number.** [3D Tiles](../../../links.md) makes it a required per-tile field for exactly this reason.

So this step has a bake half before it has a runtime half: `opensa-lod-generator` already measures its
simplification against the source by render diff, which is where an honest error value can come from rather
than a constant. Until that number exists, screen-space error has nothing to compute and the ring policy is
the fallback, not the design.

**Owes, additionally:** the geometric error written per cell, how it was derived, and the pixel threshold
that reads it — measured on the phone from [chain 2](../2-real-device-truth/readme.md), never guessed.

Watch the grid rule: render content is keyed on 250 and collision/procobj on 256
([architecture restrictions](../../../restrictions/architecture.md#anything-baked-per-cell-is-baked-on-the-grid-its-consumer-streams-on)).

**Owes:** cells, draws and resident MB before/after, and **the zoom at which HD has to come back** — stated
as a rule, not a constant chosen by eye.

### 06 — The bundle

Dead code only: what the console ships and never runs.

**Owes:** kB before/after on the single-file artifact (~490 kB today). Note that the artifact is single-file
for `?demo=1` only — [2/02](../2-real-device-truth/readme.md) owns the pak-worker chunk beside it.

## Verification

- The protected list from 02 is re-read at the end of the chain against a running console: cars and peds
  drawn, a palm moving, the hour changing the light, weather colouring the world. A screenshot pair is not
  enough — this is a field verdict, per
  [directive 4](../../../project-goals.md#4-better-must-be-demonstrated-not-assumed).
- Every cut in 03/04/06 traces to a row in 01.
- A console pointed at a full (unprofiled) pak still opens it.
- No new branch in the renderer that exists only for one platform.
