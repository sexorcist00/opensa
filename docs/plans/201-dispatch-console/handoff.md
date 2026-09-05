# 201 — the handoff spec

**Rewritten 2026-09-05 (evening) for the agent taking the POST CHAIN; §3.1 was flown later the same day
and CLOSED that direction** — read it before anything else here, because the rest of §3 was written on a
premise it removes. The `## Status` table in [readme.md](readme.md) is the chain's state of record; this is
the working spec it points at.

Read [`CLAUDE.md`](../../../CLAUDE.md)'s chain first, then this.

---

## 1. Where the frame is

Measured today at the settled pose `[1500,-1500] h900 pitch −1.15 yaw π`, `?surface=720x640`, pak
`./build/phone-cars`, on the 2/03 phone. The empty map was flown three times across the session and read
**20.03 / 20.43 / 20.25 ms** — a 0.4 ms spread, which is what makes every subtraction below worth having.

| | frame mean | p50 | p95 | CPU body | draws |
| --- | --- | --- | --- | --- | --- |
| empty map (`field`) | **20.2 ms** | 16 | 34 | 3.3 | 112 |
| declared board (`board`, 150 units + 40 calls, fleet drawn) | **23.8 ms** | 18 | 38 | 7.9 | 3 571 |

**The board is no longer where the frame goes.** Everything the 150 units cost — cars, symbology, labels —
is now **+3.6 ms over the empty map**, and it took three changes today to get there:

| | before | after |
| --- | --- | --- |
| draws at the board ([instancing](../../benchmarks/opensa-engine/2026-09-05-mobile-vehicle-instancing.json)) | 11 810 | **3 571** |
| `sym:units` ([per-unit allocation](../../benchmarks/opensa-engine/2026-09-05-mobile-per-unit-allocation.json)) | 4.04 ms | **1.62** |
| board over empty | +6.1 ms | **+3.6** |

**So the 20.2 ms empty map is the whole remaining budget** — and the post chain, which this spec first
named as the biggest thing in it, **is not**: §3.1 has been flown since and the whole bloom chain is 2.4 ms.
The budget is still the map's; what is in it is an open question again.

---

## 2. Do this first, or every number you take is of the wrong thing

**The phone runs jobs out of a git checkout.** Stop the serving job, pull, re-unpack the app, restart:

```
phone_stop → phone_run pull → phone_run webapp → phone_run phone (OUT=./build/phone-cars MODELS=1 BAKE=1
DISTRICT=los-santos-centre TEXTURES=astc)
```

The `phone` job REUSES the pak when the recipe matches; it only converts when `--out/pak/manifest.json` is
missing or `REBUILD=1`. It will not spend an hour on you by accident.

**Verify the app you are measuring by reading `inventory.app` out of a snapshot.** A prebuilt archive is
always built before its own commit, so the stamp reads one behind with a `+` whenever the tree was dirty —
`aa64e84+` is the tree at `ca45aca`. This is not pedantry: an entire change shipped INERT this session and
the only thing that said so was a device number.

**The panel's `behind` count is live again since this session.** It used to be measured against a local
`origin/main` that nothing ever fetched, so it read `behind 0` on a device three app archives stale. The
probe fetches now (throttled 60 s, bounded 8 s) and an unreachable origin shows as
`origin unreachable, last read 2h ago` in the branch row. Trust it, but read `inventory.app` anyway.

**Two paks, not interchangeable.**

| pak | what it is | use it for |
| --- | --- | --- |
| `./build/phone` | `19:23 28-08-2026`, `MODELS=0` — no cars | the 09-05 morning series only |
| `./build/phone-cars` | `07:40 05-09-2026`, `MODELS=1 BAKE=1`, 5 vehicles | **everything since**, including every number above |

---

## 3. The work: NOT the post chain — §3.1 was flown and closed it

### 3.1 — ANSWERED, 2026-09-05 (late): the bloom chain is 2.4 ms, and the post chain is NOT where the frame is

The previous spec opened here with *"re-fly `nobloom` before designing anything, because 7.7 ms is stale"*.
It was flown. [The row](../../benchmarks/opensa-engine/2026-09-05-mobile-nobloom-refly.json), against a
baseline taken twice in the same session:

| arm | mean | p50 | p95 | rung 1 | moving frames |
| --- | --- | --- | --- | --- | --- |
| `field` #1 | 19.57 ms | 16 | 36 | 78 % | 3 854 |
| `nobloom` | **16.80 ms** | 16 | **26** | **95 %** | 3 561 |
| `field` #2 | 18.88 ms | 16 | 34 | 81 % | 3 077 |

**The whole bloom chain is 2.43 ms of a 19.23 ms frame** — against the 7.7 the sweep filed. The sweep was
right about the app it was flown on; the half-resolution prefilter that shipped that evening took most of it,
which `bloomhalf`'s separate −4.4 ms already implied. This is the first time the two have been on one
baseline, and it is why the spec insisted the subtraction be re-taken rather than computed.

**2.43 is UNDER the instrument's own ~2.5 ms floor, so this row does not claim the mean.** What it claims is
the ladder and the tail, which move together and by whole rungs — rung-1 occupancy +14 points, p95 down 8–10
ms — and the fact that the arm is **bracketed rather than trailing**: 19.57 → 16.80 → 18.88 is not monotonic,
so the warm-up story that has produced three false results in this chain does not fit it.

**So the premise this spec was written on is gone, and you should not spend a session on the post chain.**
Removing it ENTIRELY buys 2.4 ms of a 19.2 ms frame, at the floor, on a device where ~80 % of frames already
sit on one display interval. Every lever INSIDE the chain is necessarily smaller than that, and §3.2 already
shows two of them are unmeasurable here. **What is left of the 19.2 ms is not attributed to anything** —
the streamed world was 3.8 ms of a 23.4 ms frame in the sweep, the CPU body is 3.1–3.5, and the rest has no
span in this repo naming it. That, not the post chain, is the next question: **find where the remaining
~13 ms goes before optimising anything**, and note that a frame sitting on the vsync floor 80 % of the time
may mean the honest answer is that the device is presenting, not computing — in which case the chain's
instrument cannot see the work at all and the next step is a different instrument, not a different pass.

### 3.2 — What has already been tried, so you do not pay for it twice

| lever | result | link |
| --- | --- | --- |
| fewer levels (`bloom4`) | **0.2 ms** — noise. The tail mips are 12x10, 6x5, 3x3 px here; the money is in the FIRST levels | [sweep](../../benchmarks/opensa-engine/2026-09-05-mobile-map-ablation-sweep.json) |
| `rg11b10ufloat` storage (`bloomrg11`) | **−2.4 ms** | [levers](../../benchmarks/opensa-engine/2026-09-05-mobile-bloom-levers.json) |
| half-res prefilter (`bloomhalf`) | **−4.4 ms**, and it SHIPPED as the console default | same |
| both together (`bloomboth`) | **17.38 — the same as half alone. They are ALTERNATIVES, not additive** | same |
| dual-filter downsample + f16 colour (`bloomvendor`) | **indistinguishable**, and the prediction that it would be was pre-registered | [vendor levers](../../benchmarks/opensa-engine/2026-09-05-mobile-vendor-levers.json) |

**Read the last row before writing a plan.** Both vendor levers provably do less work — five taps instead of
thirteen, half-width ALU — and the frame does not notice, because ~90 % of frames already sit on one display
interval and a lever worth tenths cannot be seen from under a vsync floor. That is the shape of this
device, and it is why §3.1 comes first.

### 3.3 — What you may not do

- **Frame time may not be bought with resolution, sampling or anti-aliasing** (the user's standing call,
  2026-09-04). `?scale=`, `?msaa=` and `?scene=` are measurement arms and are not shipping paths.
- **Any change that alters the picture goes to the operator as an A/B on the device before it is kept.**
  `bloomhalf` shipped that way, at NIGHT, because a half-res bright pass can only lose a sub-pixel emitter
  where there is one lit — a daylight A/B on it was indistinguishable and settled nothing.
- A [protected-list](1-the-map-profile/protected-list.md) item is released by a field verdict and nothing
  else.
- A feature ships on a phone and on a desk in the same change.

### 3.4 — The other terms, for scale

From the same sweep, all against a 23.4 ms baseline: **the streamed world 3.8**, the cumulus field 1.8, the
env probe 1.6, the sky LUT 1.0. **Only the first two clear the instrument's floor** — the null arm put that
at ~2.5 ms that session, and `?ablate=probe` is a NULL ARM on this surface anyway (`apps/dispatch` never
assigns `Engine.probeCenter`, so the pass has never rendered a face here — `surface.probeFaces` says so).

---

## 4. The instruments you have that the last agent did not

- **`overlay-2d` is split permanently**, and `symbology.render` is split under it: `sym:calls`, `sym:units`,
  `sym:labels`, `sym:scale`. The recorder is passed in by the host, so plan mode and every test pay nothing.
  This is what turned a 6 ms unattributed remainder into a number.
- **`?sprites=0`** (`nosprites` on the panel) — the symbology's own drawing path, as a control arm.
- **`scripts/debug/canvas-symbol-arms.mjs`** — a desk-side Canvas2D A/B in headless Chromium, ten seconds,
  no device. It answered "is a blit cheaper at all" and, more usefully, put a SCALE under the device number.
  **Use it before spending a device round on any 2D question.** It has already refuted one of mine: the
  decomposition explained `sym:scale`'s ~250 µs a frame by its two `ctx.font` assignments, and the desk says
  alternating two shorthands is **0.6 µs** an assignment while the whole scale bar is **3 µs**. The churn is
  real and ~6x, and it is 1.2 µs — so the device spends ~250 µs on 3 µs of desk work, the same ~80x ratio
  `sym:units` carried before its allocations went. Nothing was shipped on the refuted guess; the two
  candidates that survive are in [the row](../../benchmarks/opensa-engine/2026-09-05-desk-canvas-symbol-arms.json),
  and only the device can separate them.
- **`world.vehicleDrawsOpaque` / `world.vehicleDrawsBlend`** — the 3 571 draws split by rigid phase. The
  opaque half instances (roughly submeshes x MODELS); the blend half cannot, because its order is a function
  of the eye, so it stays one draw per car per submesh. Which of the two the remainder is was an inference
  from arithmetic until this landed; `draws − blend − opaque` is everything that is not a car.
- The report carries `marksHidden`, `spriteVariants`, `probeFacesRendered` and `surface.probeFaces`.
- The fake device records `firstInstance`, without which instanced draws are untestable.

---

## 5. The rules this session paid for, in the order they cost the most

**A change can ship completely inert and every test can pass.** Instancing landed, the device returned
**11 810 draws — unchanged to the unit**. The run key asked "is every submesh visible" and nothing ever is:
every caller hides submeshes and re-shows a set. Seven new tests passed because they exercised the mechanism
rather than the workload. *Test the configuration your callers actually produce.*

**A monotonic sequence is warm-up, not a lever.** The sprite arm's first pairing read a confident −0.58 ms;
six alternating windows showed the number falling steadily while the arm alternated, and the sign flipped by
the last pair. Third time in this chain that three windows agreed on a false story.

**Measure the instrument before the effect.** The desk control's first version timed single frames against a
~100 µs `performance.now()` clamp and read a clean 15 % win it had no resolution to see. A sample is a block
of 40 frames now.

**Fly the baseline twice, in the same session.** `field` read 20.43 and 20.03 ninety seconds apart, and 20.25
after the change — which is the only reason today's deltas mean anything. Earlier in the day the same arm
spanned 26.8–59.9 ms on a hot device.

**Read what a pass is gated on in the HOST, not only in the engine.** `?ablate=probe` was priced at 1.6 ms on
a surface where the probe has never rendered a face.

---

## 5b. The branches are read, and only one thing came off them (2026-09-05)

Six branches sat on `origin` and the question *"is anything lost?"* was asked of them. **Five were stale
ancestors of `main` with nothing unique in them.** The sixth, `claude/chain9-desk-work`, carried real code —
earlier builds of 9-05 and 9-06 from 2026-09-02 — and **every line of it is superseded by what `main` shipped
three days later**, which the step notes now say in place so nobody re-derives this:

| the branch built | what `main` has instead | why main's is the keeper |
| --- | --- | --- |
| `bloomLevelsFor` — halve until the shorter edge < 16 px, as the DEFAULT | `bloomLevels()` — a ceiling of 8, a floor from `budget.bloomMinLevelPx` that defaults to 1, and `?bloomlevels=` as the arm | the sweep priced that tail at **0.2 ms — noise**. The branch ships a look change to buy a number the device says is not there |
| `CLOUD_FIELD_HZ = 10`, keyed on clump | `cloudFieldDue` — keyed on clump, amortized on **texel travel** | the rate is DERIVED (one texel every ~4.7·w s) rather than chosen, and it survives the clock being scrubbed backwards |
| `bloom8` / `clouds0` panel arms | `bloom4`, `bloomrg11`, `bloomhalf`, `bloomboth`, `bloomfull`, `bloomdual`, `bloomf16`, `bloomvendor`, `nocloud` | the whole measured family, against the branch's two |

**What survived is a restriction, and it is worth more than the code was**: *a long-lived process serves the
TABLE IT STARTED WITH* ([architecture.md](../../restrictions/architecture.md)) — measured twice, in opposite
directions, and one of its two occurrences is the panel going on offering those very arms after the checkout
left the branch. It is in `main` now. **A second debt this turned up is paid too**: `query-parameters.md`
documented NONE of this chain's parameters — `?ablate=`, `?surface=`, `?bloomlevels=`, `?bloomformat=`,
`?bloomscale=`, `?bloomdown=`, `?bloomminpx=`, `?postprec=`, `?sprites=` — and still listed `msaa` as
field-removed while the console ships it as 9-04's arm. All nine are in the table now with what each arm
measured.

**The lesson, since this is the second time the repo has paid for it:** `git log main..branch` compares
patch-ids and will tell you six commits are missing. That is not the question. The question is whether the
CONTENT is superseded, and for five of these six the answer was *there was never anything there*, while for
the sixth it was *yes, by a measurement taken after the branch stopped moving*.

---

## 6. Still unpaid, by everyone

- **No row records battery, charging state or die temperature.** Every thermal argument in this chain is made
  without them, including "the device had not moved" above — which rests on a re-flown baseline instead.
- **No capture records how many browser tabs compete with it**, which is the null arm's one unclosed
  candidate for its own spread.
- **Upstream has never been merged.** `AlexSergey/opensa` cannot be fetched from the web container (no
  credentials, `add_repo` refused), so the fork's divergence is unmeasured. Do it from a checkout that can.
- **A `?models=0` arm.** The fleet's own cost was measured against a window where the models happened not to
  load — a real arm would make that reproducible. (The related gap is closed: how much of the fleet's draw
  count is the un-instanceable blend phase is a REPORTED number now, not an inference.)
- **The CSS box is not held constant.** The browser chrome collapses between 360x320, 360x570 and 360x609;
  the pinned buffer holds the scene still, but the overlay follows the box, so its pixel count moves between
  windows that are otherwise identical.
