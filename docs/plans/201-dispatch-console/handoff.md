# 201 — the handoff spec

**Rewritten 2026-09-06.** The post chain that this file was built around is CLOSED — §3.1 flew it and §3.1b
says what the answer means; do not re-open either without reading both. What follows §0 is the state as it
stands after two days that changed what this chain is optimising FOR.

The `## Status` table in [readme.md](readme.md) is the chain's state of record; this is the working spec it
points at.

---

## 0. Where the next session starts

**BEFORE ANY OF IT: you do not implement anything until you have questioned the user through the Ask Menu.**
That is a standing project rule as of 2026-09-06 (`CLAUDE.md`, first of the workflow rules), and the skill
that runs it is [`grilling`](../../../.claude/skills/grilling/SKILL.md) (`grill-me` is only its trigger).
It works the plan as a design tree in ROUNDS — ask the whole settled frontier, wait, recompute — and
**finding facts is your job, never the user's**: anything the plan chain, the code or the tools can answer is
looked up, and only DECISIONS reach them.

**Read these three first, in this order, and nothing here will surprise you:**

1. **§3.1b** — `dtMean` on this device is a MISS RATE, not a cost. The frame is pinned to the display
   interval, so there is no pool of unattributed milliseconds to hunt. An agent was sent after "the
   remaining ~13 ms" and they do not exist.
2. **§5c** — smoothness is a budget now, it is MEASURED (`paceChangeRate`), and it is the axis the operator
   noticed unprompted when the frame time could not see it.
3. **§5d** — the debug tools reach the phone since 2026-09-06, which is where 62 of the 100 of them have
   always belonged.

**What is open, ranked by what it would settle:**

| what | why it is next | what it costs |
| --- | --- | --- |
| **PCAD carries no world time** | the console's clock follows a SERVER anchor and the anchor is published by the MOCK. 202's protocol never mentioned one, so this is a field the product still has to add — everything on our side is built and verified | a protocol change in `sexorcist00/pcad`, not here |
| **The 62 game-data tools have never been run** | they became reachable today and nobody has looked. `ide-flag-histogram` says which authored IDE bits exist to honour; `dat-order-check` is a correctness question about the shipped data | minutes each, on the phone |
| **The remaining chain-9 rungs** | the graphics ladder is a bloom switch and a prefilter scale; the user asked for a real optimisation ↔ quality axis (§5a) | a measurement before it is a UI task |
| **Audio** | never planned, nothing exists, and the user has asked twice (§5e) | a bank parser, then Web Audio |

**What is NOT open, so nobody spends a session re-deciding it:** the post chain (§3.1, 2.4 ms, closed),
whether bloom ships (the operator released it at night — Smooth is the default), and the frame-rate budget
(45 fps, the user's call; and read §3.1c on what 45 means on a 60 Hz panel).

---

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

**And the 20.2 ms empty map is NOT 20.2 ms of work** — §3.1b: the frame is pinned to the display interval
and `dtMean` here is the miss rate restated in milliseconds, so this table's left column measures how often
the frame misses, not what it costs. Read it that way or it will be subtracted from, which is the mistake
§3.1b exists to stop.

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

## 3. The work: §3.1 was flown and it closed the 7.7 ms question — 3.1b says what the answer means

### 3.1 — ANSWERED, 2026-09-05 (late): the bloom chain is 2.4 ms, not 7.7 — read 3.1b before acting on it

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

### 3.1b — And what that number MEANS was got wrong once already, in this file, hours after §3.1 was flown

The first version of §3.1 closed with *"the post chain is not where the frame is — go find the remaining
~13 ms"*. **There is no remaining 13 ms, and an agent sent to look for it would have spent a session on a
subtraction with nothing on the other side of it.** Here is the check that settles it — the vsync rung MIX
alone, with no cost model at all, predicting each arm's mean:

| arm | predicted from the rung mix | measured | offset |
| --- | --- | --- | --- |
| `field` #1 | 20.40 ms | 19.57 | −0.83 |
| `nobloom` | 17.88 ms | 16.80 | −1.08 |
| `field` #2 | 19.87 ms | 18.88 | −0.99 |

The same offset three times (it is the sub-interval frames the render gate lets through). **So `dtMean` on
this device is not a measure of work — it is the MISS RATE restated in milliseconds**, and the 19.2 ms
"budget" is not 19.2 ms of anything the engine does. The frame is pinned to the display interval; what
varies is how often it misses.

**Restated honestly, then, this is what the arm found:** the bloom chain is what pushes **roughly one frame
in five past the display deadline** — rung-1 occupancy 78 % and 81 % with it, **95 %** without. That is the
same fact as "2.43 ms", and it is the better way to say it, because on a vsync-locked device work that fits
under the deadline is FREE and work that does not costs a whole interval. The chain sits exactly on that
boundary, which is why it reads as noise on the mean and as a whole rung on the ladder. **It is therefore
not "nothing", and the first version of this section undersold it in the course of overselling the hunt.**

**What is and is not measurable here, which is the durable part.** CPU work is measurable and finely —
`cpu.bodyMeanMs` separates 3.54 / 3.40 / 3.11 from 2.97 across these arms. GPU work is not, and not merely
for want of `timestamp-query`: `outside` (frame minus body — 17.81 / 17.16 / 16.94 against 14.32 / 14.62) is
GPU time and present WAIT added together, and nothing on this adapter separates them. So a GPU-side question
at this pose can only be asked through the miss rate, and only about a change big enough to move a rung.
**Anything smaller is invisible here by construction rather than by noise** — which is the real reason
§3.2's two vendor levers came back indistinguishable, a result that was correctly predicted without this
being the stated reason.

### 3.1c — AND THE BAR MOVED: 45 fps, not 60 (the user's call, 2026-09-05)

Everything above was written against a 60 fps budget. It is **45** now, and that re-prices this whole
section rather than merely relaxing it:

| | ms | fps | against a 45 fps bar |
| --- | --- | --- | --- |
| empty map (`field`) | 19.2 | 52 | **passes, with margin** |
| declared board (150 units + 40 calls) | 23.8 | 42 | **misses by 1.6 ms** |

**So the map is done and the board is the only open number**, and 1.6 ms is AT the instrument's floor — it
will be judged on the ladder, not on the mean (§3.1b), and the board is above the vsync floor where an
ablation is legible, which is the one place §3.1d says a GPU question can still be asked.

**There is no 45 fps on a 60 Hz panel, and this matters for what "passing" buys.** The frame is pinned to the
display interval, so a 22.2 ms mean is a **67/33 mix of 16.7 and 33.3 ms frames** — judder by construction,
not a smooth 45. A console that averages 45 fps this way looks worse than one that holds 30 flat. If the
operator's complaint is ever *smoothness* rather than *throughput*, the budgets this panel offers are 60 and
30, and the honest move is to pick one, not to tune within the band.

**And the bloom question changed sides TWICE in one session, which is worth watching happen.** At 60 fps the
chain was load-bearing: it moved rung-1 occupancy from 78 % to 95 %. When the bar dropped to 45 the map
cleared it with the chain in, so bloom looked like a pure look-and-battery decision. **Then the user added
that SMOOTHNESS matters too (2026-09-05), and that puts it straight back.** Rung-1 occupancy is not a
throughput number — it is the stutter rate, and 78 % means roughly one frame in five doubles while 95 % means
one in twenty. **Measured across everything this chain flew, the bloom chain is the single largest lever on
smoothness that exists**, and nothing else came close. So: not a budget item under the 45 fps bar, and a
first-class item under the smoothness one.

**Which is why the frame now REPORTS its steadiness** (`frame-pacing.ts`, 2026-09-05): `paceChangeRate`,
`paceChanges` and `paceWorstRatio` are in the inventory report beside the histogram. **A distribution has no
order in it** — the same bins describe a flat 30 and a 60/30 stutter — so smoothness was structurally
unanswerable from `dtHistogramMs` and every row before this one read the ladder by hand in its own prose. The
measure is a RATIO between neighbouring frames, so it carries no refresh rate and reads the same on a 144 Hz
desk; 0 is a perfectly even frame at any rate and a 60/30 alternation approaches 1. **Take it on the next
device round and the smoothness claims stop being adjectives.**

### 3.1d — So what is actually left to do

Not a hunt for missing milliseconds. Three real options, in the order they cost:

1. **Decide whether 78 % → 95 % on-vsync is worth buying, and with what.** That is a product question for
   the operator, not a profiling one — and every candidate inside the chain is smaller than the chain, so
   the honest form of it is "keep bloom or not", not "tune bloom".
2. **If a GPU-side number is wanted, change where it is asked.** At this pose the frame is on the floor
   ~80 % of the time and the instrument is blind under it. The declared board (23.8 ms) sits above the
   floor; an ablation there is legible where the same ablation on the empty map is not. Beware that it
   quantizes again one rung up.
3. **The CPU side is open and properly instrumented**, and nobody has run out of road on it: the body is
   3.1–3.5 ms with the spans already split (`sym:*`, `overlay-2d`, `stream`, `engine-frame`). That is the
   part of this frame where a millisecond can still be found and PROVEN.

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

## 5a. The graphics ladder, and what it still owes (2026-09-05)

The operator saw the night A/B, released bloom, and asked for it as a SETTING with presets — an
*optimisation ↔ picture quality* axis. What shipped is the spine of that: three rungs, each with a measured
number, all applying live.

| rung | what it does | what it is worth |
| --- | --- | --- |
| Full | prefilter at full resolution | the pre-2026-09-05 look; its half-res replacement measured **−4.4 ms** |
| Balanced | prefilter at half resolution | what the console has drawn since 2026-09-05 |
| Smooth | no bloom chain at all | **44.6 % of frame pairs stutter → 7.9 %**, 5.6x |

**The ladder is short and the user has asked for more of it.** Before adding a rung, read what CAN go in it,
because the space is narrower than it looks:

- **Refused outright**: resolution, sample count, scene format. The standing call (2026-09-04) is that frame
  time may not be bought with resolution, sampling or anti-aliasing, and `?scale=`, `?msaa=` and `?scene=`
  are measurement arms.
- **Cannot be live even if wanted**: anything the PIPELINES are compiled against — the formats and the
  sample count. A rung carrying one of those is a page load, and the menu has to say so rather than appear
  to apply instantly.
- **Live, and the only reason the ladder works today**: fields that change target GEOMETRY. `ensureTargets`'
 key names them now (`bloomPrefilterScale`, `bloomMinLevelPx`); it named the size alone until this step, so
  a budget field could move and nothing would rebuild — the inert shape again, now guarded by a test that
  was verified to fail on the old key.
- **Unmeasured, therefore not a rung yet**: everything else. The chain's own rule is that nothing is tuned
  before its arm is run, and a preset menu is the worst place to break it — a rung that changes nothing
  reads to the operator as "this setting does not matter on my phone".

**So the next rung is a measurement task before it is a UI task**, and the instrument for judging it exists
now: `paceChangeRate` says what a rung buys in steadiness, which is the axis the operator actually asked
about.

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

## 5c. Smoothness is a budget, and it is measured (2026-09-06)

**The frame rate budget is 45 fps** (the user's call) **and smoothness is a SECOND criterion beside it**, not
a softer version of the first. They point at different work: throughput at the board's remaining 1.6 ms,
smoothness at how often the frame changes rung at all.

`frame-pacing.ts` measures it. `paceChangeRate` is stutters per consecutive pair — 0 is a perfectly even
frame at ANY rate, a 60/30 alternation approaches 1 — and it is refresh-rate agnostic by construction, so it
reads the same on a 144 Hz desk. **A distribution structurally cannot answer this**: the same histogram bins
describe a flat 30 and a 60/30 stutter, which is why every row before this one read the vsync ladder by hand
in its own prose.

The number that made the case: **the empty map stutters on 44.6 % of consecutive frame pairs and 7.9 %
without the bloom chain**, 5.6x
([the row](../../benchmarks/opensa-engine/2026-09-05-mobile-frame-pacing.json)). The SAME arm's mean
difference is 2.4–3.2 ms — at or under the instrument's floor, a number no row here may claim. **Two
criteria, one change, an order of importance apart**, and the operator saw the smoothness one immediately
and unprompted.

**Take `paceChangeRate` on every arm from now on.** It is the axis the product was told to optimise and the
only one the mean cannot report.

---

## 5d. The debug tools reach the phone now (2026-09-06)

**62 of the 100 scripts in `scripts/debug/` read GAME DATA**, and the phone is the only machine that has
any. Until today none of them was reachable from a session, and nobody had noticed — the panel runs a fixed
job list, which is a security boundary (it answers on a tunnel one bearer token from the open internet).

`phone_run debug SCRIPT=<name> [ARGS=…]` runs any of them. The name is a knob matched against `^[a-z0-9-]+$`
and checked against the real directory; the child is spawned with an argument array and no shell. Nothing
off the wire is concatenated into a command line, so the boundary did not move.

**THIRTEEN OF THE 62 HAVE NOW BEEN RUN (2026-09-06). FOUR NEEDED FIXING BEFORE THEY WOULD RUN AT ALL** —
`dat-order-check`, `mod-id-collisions`, `lamp-census`, `uv-anim-measure` — and eight were confirmed already
correct. **Every data verdict came back CLEAN**: 0 late definitions, 0 out-of-range LOD links, 0 unaligned
DXT, `carmods-check` ok, IPL rows within the stock budget. **The tools found their own infrastructure and
their own documentation, not defects in the data.** Not on the
game data — on a DIRECTORY the phone does not have and never will: `dat-order-check` defaults to
`build/original/sa`, a desk build this device never produces, and `mod-id-collisions` walks
`mods-src/original/mods`, which it does not carry. Both threw an unguarded `ENOENT`. The first died before
reaching its SECOND default, `game-src/original`, which was present and had the answer; the second threw away
a stock census it had already computed. **Fixed and verified on the device** (`8529c1c6`): an absent tree is a
named skip, and the exit is non-zero only when nothing was checkable.

**Assume the same shape in the rest.** ~25 scripts name a BUILT tree (`build/original/sa`, `.../opensa`) —
some only in a usage comment, five already fall back through `existsSync`, and the remainder have not been
run. The class is not "a built tree" but *any directory this machine lacks, read unguarded*, so check the
default before spending a run on it.

**What the three said**, filed in
[the row](../../benchmarks/opensa-engine/2026-09-06-phone-game-data-tools.json): `dat-order-check` **9 406
rows, 0 late**; `ide-flag-histogram` **14 276 rows, 20 bits present, 6 implemented** — the 14 unread bits are
NOT an unhonoured-data finding, plan 039 judged each one; `mod-id-collisions` **14 842 ids, 8 disagreements**.

**Two doc baselines no longer describe this tree, and one instrument does not exist.** The collision baseline
is EIGHT rather than the documented seven (the extra is `id 1`, `csplay` against `truth`); `dat-order-check`
reads 9 406 rows where the doc records 9 268 — same verdict, different count, so two different copies of
`game-src/original` rather than a before/after. And plan 039 cites `scripts/ide-flag-histogram.ts`, a path
with **ZERO commits in this repository's history**, so its 14 323-def table may not be subtracted from today's
run. **The rest of the seven, and the pattern they make.** `lamp-census` (fixed, then 26 models with no standard
lamp material, 0 carrying `ivflights`), `lod-link-check` (**6 108 links, 0 out of range** — its seven
`farther than 20 u` are stock `BillBd*` billboards, and the README already calls 20 u the FLOOR of what it
guarantees), `txd-dimension-census` (**2 760 dictionaries, 26 126 textures, ZERO unaligned DXT** — the class
that silently kills a whole dictionary is clean) and `alpha-class-census` (**395 of 26 126 left in the blend
pass**; NOT headroom — `candidate` is the rule that ALREADY ships and the shipped classification is the UNION
of the two).

**READ THIS BEFORE COMPARING ANYTHING TO A DOC.** Every tool's verdict matched its doc and every COUNT
disagreed: `dat-order-check` 9 406 against 9 268, `lod-link-check` 6 108 against 6 103, and
`txd-dimension-census` **3 NPOT against a restriction stating stock has 0**. The two comparable to themselves
both read HIGH, so this phone's `game-src/original` carries slightly MORE than the copy every baseline was
taken on. What differs is NOT established, and establishing it is the cheapest next thing here — until then a
doc baseline is not a before/after partner for a run on this device.

**Three tools were already correct** and are the model to copy: `alpha-class-census` (archive through
`.find(existsSync)`, refusal naming `--img`), `lod-link-check` (guards `data/gta.dat`, exits 1 with a usage
line) and `two-dfx-census`. **Three suspects remain untested** — a built-tree default and no `existsSync` at
all: `dump-texel-avg`, `uv-anim-measure`, `dump-osm-meta`.

**The three NPOT are named** (the `--npot` run finished; only the tunnel died before its log could be read):
`icons4.txd: diskmetal32 132x128 rgba8888 mips=8`, `icons4.txd: salogo64 392x392 rgba8888 mips=9`,
`sunset01_lawn.txd: standardet1_LA 256x96 dxt1 mips=9`. Two are not DXT at all; the third is DXT1 but
block-aligned (96 = 4x24), so it loads. **The census reads `models/gta3.img` ALONE**, not the whole tree.

**And that archive is inside the scope of a second documented claim, which it also contradicts.**
[uncompressed-rasters.md](../../gta-sa-original/uncompressed-rasters.md) says *every uncompressed raster in
the game is single-level*, measured over `gta3.img` + `gta_int.img` — and `diskmetal32` is an uncompressed
rgba8888 raster with EIGHT mip levels inside `gta3.img`. A real counterexample, not an out-of-scope one.
The script's own header is a third: it claims `Stock: 26 004 textures, 0 of either` against today's 26 126
and 3.

**None of the three was corrected in the docs, deliberately** — and the reason is now known rather than
suspected. `ipl-row-census` answered it the same evening: **the phone's `game-src/original` is a SA-MP
INSTALL, not a clean stock copy.** Its `gta.dat` carries an `IPL SAMP\samp.ipl` line (unresolved, so it
contributes no rows — it PROVES the copy is not stock rather than accounting for the extra), and modloader
adds 0. **So a doc baseline labelled "stock" is not a partner for any run on this device**, which is why
none of the disagreeing numbers was written into the docs as a correction.

That matters twice: it retires the whole class of "the count is off" findings above, and it is not an
accident worth fixing — [202](../202-pcad-dispatch/readme.md) is a dispatch product FOR a SA-MP server, so
this copy is the product's actual target. **What is still unlisted is WHICH files carry the extra rows**
(+138 `inst` rows against the doc's 9 268); the census reports the totals and the budget, not the diff.

The rest of that census, for anyone budgeting map content: **9 406 rows / 32 767 int16 ceiling, 31 of 40
IPL slots carrying inst rows, `within the stock budget`**, 52 IPL files counted.

The tunnel dropped twice in that session; `npm run panel:tunnel` re-issues an address the session must be
given by hand. **And the panel serves the code it started with** — the dependency-check fix landed in
`65885fd2` and the device still reported the old wording after pulling it, exactly as the `debug` job did
at the start of the day. Restart the panel after pulling anything under `tools-debug/phone-console/`.

**And two DESK censuses were run for the first time on 2026-09-06 after sitting unused**
([the row](../../benchmarks/opensa-engine/2026-09-06-desk-censuses.json)): the ring residency policy asks for
**276 cells at every pose** where the view policy asks for 26 at block zoom, and the label cap is **not** what
limits labels on either surface — overlap is, and **six names in ten never reach a phone**. One of the two
did not even run: it had rotted on an API change because nothing ever called it. **A registered tool with no
caller is a repair job the day it is needed.**

---

## 5e. Audio: never planned, nothing exists (2026-09-06)

The user has asked twice. The state, checked rather than remembered: **no `AudioContext`, no sample loading,
nothing anywhere in the engine**, and no plan, roadmap entry or idea mentions audio at all. The only `audio`
in the repository is `audio.txt`, a vehicle audio ASSIGNMENT row that `add-vehicles` edits inside the real
game — which the real game then plays, not us. **SA's audio bank formats are not parsed**: no `SFXPak`, no
`BankLkup`, nothing.

**FMOD was assessed and is not recommended.** It has an HTML5 target, but the licence is proprietary with
revenue terms, the wasm payload lands in an app that boots in seconds on a phone whose milliseconds this
chain has spent two days defending, and the dispatch console ships as an embeddable widget with no runtime
dependencies — a rule strong enough that `panel-window.tsx` refused `react-rnd` over it.

**Web Audio is the answer, and the work is not the player.** It gives spatial panning, mixing and looping
with no dependency, and a mute button on it is trivial. The real work is the DATA: reading SA's own banks so
the world sounds as it was authored, which is a new format in `packages/renderware` of the same class as DFF
and TXD. Order: bank parser (desk work, testable on fixtures) → one sound in a browser → engine audio with
spatial panning → volume and mute.

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
