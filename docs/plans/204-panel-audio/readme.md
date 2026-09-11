# 204 — Panel audio: the console's own voice, and the mixer underneath it

**Opened 2026-09-10**, out of [the concept](concept.md) — its research record, the reading of PCAD's real
client, and the four rounds of questioning that produced every decision below. Read that first; this document
is what gets built and in which order, and it does not re-argue anything the concept settled.

Subordinate to [202](../202-pcad-dispatch/readme.md), which is the product, and a sibling of
[203](../203-audio/readme.md), which gave the console the world's own sound. **203 made the console hear the
CITY. This one makes it hear the WORK** — and fixes the mixer that both stand on.

---

## The decisions this chain is built on

Taken with the user 2026-09-10, in four rounds. The [concept's §6](concept.md) carries the reasoning and the
full table; this is what every step below inherits.

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **Three categories, one owner each** | `world` (ours, the city) · `map` (ours, what the board SHOWS) · `cad` (PCAD's, what only the plugin knows) | one pool for incomparable things, and any need for deduplication — an event never has two sources |
| **The owner makes the sound** | a forwarded foreign event is DISPLAYED | an operator with the game and the browser open hearing one panic twice, at two delays |
| **The vocabulary is a CONTRACT** | one document both repositories are built against, and PCAD fixed NOW rather than at phase 3 | a console-side table that drifts from the plugin's for as long as phase 3 takes |
| **Our own set, most of it PCAD's** | the two surfaces sound like ONE product | synthesis-only, which would make the shared vocabulary shared in name and different in sound |
| **Synthesis is the FLOOR, not the product** | an alert that cannot be missing, because a computed tone has no failure mode to inherit | a panic button that inherits [203's decision 4.3](../203-audio/concept.md) — *silence is the normal case* |
| **In the app bundle** | latency and reliability at once; the set belongs to the APP, not to a world build | 4.1's *a sound fix must not cost a world rebuild*, which does not reach a set that is not part of the world |
| **Everything on by default** | an audio system that protects somebody | one nobody enables |
| **A floor, not an exemption** | `cad` at zero makes panic and link-loss QUIET, and the interface says so | an alert that ignores the operator's own mute |
| **The mock plays PCAD's part** | an ear and a latency number before phase 3, through the seam PCAD will use | a `cad` bus that cannot be heard or measured until another repository ships |
| **One chain** | mixer and panel together, the user's call | shipping the mixer first, which was the recommendation — see the note under [the order](#the-order-and-the-trade-it-takes) |

## The budgets this chain is held to

New numbers, named before the work, per [directive 5](../../project-goals.md#5-performance-is-a-requirement-not-an-outcome).
The four from 203 (64 voices · 2 ms/frame · 64 MB · ≤ 200 ms to the first sound) still hold and are not
restated per step.

| Budget | Value | Where it bites |
| --- | --- | --- |
| Event → audible | **≤ 50 ms** | 2/03. 203's 200 ms is a COLD-START figure; a sound answering an action needs an order of magnitude less or it reads as a coincidence rather than a response |
| Alerts refused | **0, ever** | 1/01, and it is the regression guard for the defect that opened this plan |
| Peak sample on the master | **≤ 1.0** | 1/02. Clipping is the most recognisable *not-AAA* artefact there is |
| Voices reserved for `cad` | **4 of the 64** | 1/01 — a number to measure and move, not a guess to defend |
| The panel set in the bundle | **≤ 1 MB** | 2/02 |

**One of these may not all hold at once, and the chain says so up front.** A 50 ms budget on a phone that is
also streaming a city is not a number anybody here has measured, and 5/01 decides it with a measurement
rather than an argument.

## What this chain does NOT own

The voice/chat layer ([202 §7](../202-pcad-dispatch/readme.md): *the console does not become a radio* — a
key-up CLICK is not voice and is in scope; carrying traffic is not). Radio and ped speech, still out of v1 by
203's decision 1.1. And distance filtering, which is [deferred with its price](../../performance/README.md)
rather than planned: 64 biquads on a Mali phone is a number nobody has measured.

---

## The chains

| # | Chain | Why here |
| --- | --- | --- |
| 1 | [The mixer](#1--the-mixer) | Everything else plays through it, and it carries a live defect today |
| 2 | [The vocabulary](#2--the-vocabulary) | A name has to mean something to both repositories before either can raise it |
| 3 | [The consumers](#3--the-consumers) | The console's two categories, and the tab it is not looking at |
| 4 | [PCAD](#4--pcad) | The other signatory. A branch and a PR, not a push |
| 5 | [The numbers](#5--the-numbers) | AAA is a measurable claim or it is a mood |

### 1 — The mixer

`@opensa/audio`, `type:engine`. **Improves the world audio that already ships**, whatever happens to the rest.

| Step | What it produces | Verified by |
| --- | --- | --- |
| **1/01** | **Buses, and the end of the refused alert.** `master → { world, map, cad }`, one gain each; a voice names its bus; the stealing rule ranks WITHIN a bus; `cad` reserves voices the world can never take. [Decision 4.2](../203-audio/concept.md) is untouched — *the quietest at the listener* still decides among the world's own sounds, which is what it was about | a test that fills the pool with 64 world voices and then plays a `cad` voice, which must NOT be refused. **The mutation is the proof**: it passes today, because today there is no such thing as a `cad` voice |
| **1/02** | **The limiter.** A `DynamicsCompressorLike` on the master, and the conformance assertion that a real node satisfies it (the pattern that already caught `interrupted`) | a test summing 64 voices at full scale; the peak sample against the 1.0 budget, on the device in 5/01 |
| **1/03** | **Ducking**: `cad` pulls `world` down for the length of an alert plus a release, through the ramp API `voices.ts` already has | a capture showing the world bus gain move and return, plus the ear on the phone |
| **1/04** | **Three levels, persisted, one control** — and the FLOOR that keeps panic and link-loss audible at `cad = 0`. Answers [the cross-platform five](../../restrictions/cross-platform-surface.md) by construction, the way the volume key already does | `styles.test.ts`'s existing `TOUCH_TARGET` pin, a test that the floor holds at zero, and a reload that keeps the levels |

### 2 — The vocabulary

| Step | What it produces | Verified by |
| --- | --- | --- |
| **2/01** | **The contract** in `docs/contracts/`: the three categories, every event name, who owns each, the *owner sounds* rule, and **the provenance of the sound set** — which is recorded nowhere today and in six months has nobody left to ask | a doc row, and 4/01 building against it |
| **2/02** | **The set, in the bundle**, plus the synthesis floor: a name with no file resolves to a computed tone and says so in the report, exactly as an absent bank does | a test that every contract name resolves to SOMETHING; the bundle size against 1 MB |
| **2/03** | **The event API** — `audio.event(category, name)`, resident, no fetch on the path | the latency field, measured in 5/01 against 50 ms |
| **2/04** | **Coalescing and variation.** Ten calls in a burst is one tone and a count, not a machine gun; repeated one-shots vary. The chain already learned this from the original — [`CAETwinLoopSoundEntity` randomises its swap interval](../../gta-sa-original/audio-ambience.md) because a fixed one becomes a rhythm the ear cannot unhear | a test firing ten events inside the window and asserting one voice |

### 3 — The consumers

| Step | What it produces | Verified by |
| --- | --- | --- |
| **3/01** | **`map`: the board's lifecycle as the console SEES it** — an incident appears, a unit arrives, a unit stops reporting, a call closes. Derived from `Operations`, which the console already holds | tests on a board stepped by hand |
| **3/02** | **`cad`: the shell's events**, and the mock playing PCAD's part through the same seam so there is something to hear before phase 3 | the ear on the phone; the seam unchanged when the mock is switched off |
| **3/03** | **The visual counterpart for every event.** [DESIGN.md](../../../apps/dispatch/DESIGN.md)'s rule applied: *any one channel read alone is enough*, so a muted, deaf or headphone-less dispatcher loses nothing — which is exactly what makes *on by default* defensible | a table in the contract mapping each event to what is drawn, and a test that the drawing does not depend on the audio path |
| **3/04** | **The backgrounded tab.** The dispatcher is a player, so the console is behind the game window and background timers clamp to ≥ 1 s. Alerts are scheduled on the `AudioContext` clock and must never route through the audio tick; the ambience being throttled there is accepted and STATED | a test that the alert path does not touch the clock, and a device check with the tab hidden |

### 4 — PCAD

**A branch and a pull request in `sexorcist00/pcad`** — the user reviews and merges. Changes to somebody's
running system do not arrive silently in `main`.

| Step | What it produces | Verified by |
| --- | --- | --- |
| **4/01** | **The explicit sound field**, replacing `title_lc:find("assistance request")`. Reword a title, translate it, or fix a typo in it today and the sound stops — silently, with the notification still appearing | the trigger fires on a renamed title |
| **4/02** | **The four missing events**: `link_lost` / `link_back` (nothing sounds when the board freezes, which is this product's worst failure), `unit_stale` (the backend already marks one at 300 s), `bolo_new` | a session where the socket is cut |
| **4/03** | **The priority tones, split.** `priority_start` / `_middle` / `_end` are on disk and only the first is wired, to `assist_request`; P1 and P3 sound identical while the assets for the difference sit unused | the ear, on three calls |

### 5 — The numbers

| Step | What it produces | Verified by |
| --- | --- | --- |
| **5/01** | **The device row**: event → audible ms, **alerts refused (must be 0)**, peak sample on the master, voices per bus at peak, ms/tick against the 2 ms, MB against the 64, and the battery delta against `?audio=0` — which 203/4-03 already owes and which this chain makes larger | a phone row in `docs/benchmarks/`, filed BEFORE it is analysed |

---

## The order, and the trade it takes

The recommendation was to ship chain 1 first and alone: it improves audio that already ships, it is small, and
**G1 is a live defect today rather than a missing feature**. The user chose one chain, and that is the call
this plan is built on.

**What the trade costs, stated so it is not discovered**: the refused alert lives until the whole chain lands
rather than until chain 1 does. So **1/01 is the first step inside the chain** — the defect does not get to
outlive the work that happens to sit beside it.

## The check, against the six questions

[The goals](../../project-goals.md#the-check-when-a-plan-is-written) ask six of every plan:

1. **Which authored data, read as the author meant it?** PCAD's own trigger table and its sound set, adopted
   rather than reinvented — the reading in [the concept](concept.md) is what replaced a guessed vocabulary.
2. **What does the original do, and why is that not our answer?** San Andreas has no dispatch panel at all.
   Nothing to port, nothing to match, and [directive 3](../../project-goals.md) makes *good* the only bar.
3. **What is better, and what says so?** Five named defects with named fixes, and 5/01's row. The one that is
   not an opinion today: an alert can be refused by 64 car engines, and a test will fail on it.
4. **What does it cost when the world is busy?** The 2 ms tick is unchanged — alerts do not run on it (3/04) —
   and `cad`'s four reserved voices come out of the 64 the budget already names.
5. **What contract does a mod author keep?** `audio-events.dat` is untouched. The panel set is the APP's and
   is not a mod surface, which 2/01 states so nobody looks for one.
6. **Does it need a player?** No. `@opensa/audio` stays `type:engine` and Node-free; the buses and the limiter
   are engine-layer, and only the console's two consumers know what a unit is.

---

## Status

| Step | State |
| --- | --- |
| the chain itself | **OPENED 2026-09-10** — declared, ordered, and the decisions above taken with the user in four rounds |
| the questioning round | **CLOSED 2026-09-10** — fourteen decisions, frontier empty, and the category split confirmed as a reading rather than a quote ([the concept](concept.md) §6) |
| **1/01 Buses, and the end of the refused alert** | **DONE 2026-09-10.** `master → { cad, map, world }`, one gain each, built in the constructor rather than on demand so a bus always exists to be ducked or levelled before anything has played on it. A voice names its bus; one that names none is `world`, which is where the city is. **The admission rule has TWO ranks and the order is the point**: a bus tidies its own house first — `audibleGain`, decision 4.2 untouched, because that is the question it was written about — and only a bus BELOW its reserve reaches across, and only into a bus above its own. That second rank is the whole of *an alert is never refused*: the world reserves nothing, so sixty-four engines are all fair game for the first four panel alerts however quiet they are. **Every half is proven by mutation**: removing the reserve fails the alert test, letting a bus rank across all buses at once fails the tidy-your-own-house test, and dropping the above-reserve filter fails the protection test. **The second of those caught a weak test rather than weak code** — the first version's globally quietest voice happened to sit in the same bus, so both rules stole the same voice and the mutation passed; the fixture now puts the quietest in the OTHER bus, where the two rules disagree. 24 tests in the pool, 768 across the packages and the console. **`refusedByBus` is in the report**, split per bus, because a total that mixes a refused alert with a refused car engine cannot say whether the budget held. **One assumption beyond the named budget, stated in the code**: `map` reserves 2 — the plan names `cad`'s 4 and is silent on this one, and a reserve mechanism only one bus uses is a special case pretending to be a rule; what would settle it is a shift where `refusedByBus.map` is non-zero. **And a restriction was filed**, because the defect's shape is the dangerous one: nothing errors, one refusal is counted among all the others, and it shipped in `main` for a day invisible only because nothing yet played a panel alert |
| **1/02 The limiter** | **DONE 2026-09-10.** A `DynamicsCompressorLike` between the master and the speakers — **after** the master and not before, so the volume an operator sets makes the limiter work LESS; upstream of a gain it would be a ceiling the gain lifts the signal straight back through, and the mutation that swaps the two fails two tests. Set as a LIMITER rather than as a musical compressor: hard knee, ratio 20 (the highest Web Audio allows — a limiter wants a wall, not a slope), 3 ms attack, 250 ms release, threshold **-6 dBFS**. **The arithmetic is written down with its honest limit**: 64 uncorrelated voices sum as ~8x = +18 dBFS, which at 24 dB over a -6 threshold and 20:1 lands near **-4.8 dBFS**; 64 voices IN PHASE at full scale would still come out over, but that is an arithmetic worst case rather than a signal, and squashing every real mix to protect against it would be the wrong trade — **5/01 measures the real peak on the device**, which is what decides the number rather than the comment. `reduction` is reported, because it is a number about the CONTENT (how hard the mix is pushing) rather than about the limiter. **The conformance assertion earned its keep again**: a real `DynamicsCompressorNode` must satisfy the hand-written subset, which is the check that caught `interrupted` on its first run. 28 tests in the pool, 772 across the packages and the console. **And a test caught the same trap as 1/01 did**: the first version asserted `ratio.value === LIMITER_RATIO`, a constant compared with itself, so a ratio of 4 — a musical compressor rather than a ceiling — passed. It asserts VALUES now |
| **1/03 Ducking** | **DONE 2026-09-10.** An alert pulls `world` and `map` down by **-12 dB** and lets them back up when it ends — the depth broadcast and two-way radio both use, enough that a tone reads cleanly over a city bed and little enough that the bed is still there. Down in 80 ms, up in 400: the alert has already started, so a slow duck loses its first syllable under traffic, while a fast release makes the city REAPPEAR rather than return. **It is DERIVED from the state of the `cad` bus rather than called for**, which is the reliability half: a duck a caller has to remember is one somebody eventually forgets, and the alert it is forgotten on is the one that mattered. It is applied at the two places a bus's population can change — a voice starting and a voice leaving — and every path out of a voice (ended, stopped, stolen) goes through the same release, so the world cannot be left held down for an alert that has finished. **It MULTIPLIES the operator's own level rather than replacing it**: the bus node carries `level x duck` and the report gives back the LEVEL, because a control that read its own ducking would jump about while an alert played. It never ducks `cad` itself, which would be a thorough way to lose an alert, and it stays down while ANY alert is live rather than releasing between two inside the same bad second. 34 tests; four mutations fail — ducking the alert's own bus, not applying on play, stepping instead of ramping, and dropping the operator's level from the target |
| **1/04 Levels, persistence, the control, and the floor** | **DONE 2026-09-10.** **The levels are carried by MIXES rather than by a slider each**, and that is a reading of *three levels, one control* taken here and stated so it can be challenged: three sliders is three targets and ~360 px of a bar that already clips, needs a pointer to be precise with, and is two layouts on a phone and a desk — everything [the restriction](../../restrictions/cross-platform-surface.md) forbids. **A preset is also the better control**: nobody working a board wants *everything quieter*, they want *the city under the work*, which a master volume cannot express at all. Four mixes — `full`, `work` (the city at 0.35 under an untouched panel), `alerts`, `muted` — stepped by the same one key, persisted under one `localStorage` key, and **every access guarded**, because the accessor itself throws in a private window or a blocked store and an audio control that takes the console down on load is a far worse defect than a forgotten level. **The FLOOR is in the pool**: a voice marked `floored` holds its whole bus open at **0.25** for as long as it plays, `max` rather than a replacement so it can only ever raise a muted bus. It is stepped rather than ramped, deliberately — it opens on the first sample of an alert a muted console would otherwise have swallowed, and a ramp there is a late alert. **And the key SAYS so**: *Muted — panic and lost link stay audible*, because an operator reached by a tone after muting should have been told once, by the control that did it. 39 tests in the pool, 19 on the console's audio, 790 across the app and the packages; the floor's three mutations and the mix's three all fail. **One honest negative**: the stored-name check in `storedMix` is NOT load-bearing — `mixOf` already falls back — and rather than dress a redundant line as a guard, the comment says what it is actually for (making the cast true) |
| **2/01 The contract** | **DONE 2026-09-11.** [`docs/contracts/panel-audio.md`](../../contracts/panel-audio.md): the three categories with the test that separates them (*can the console see it in the board it already holds?*), sixteen event names mapped against what PCAD raises today, which two are FLOORED, the explicit `sound` field that replaces resolving a trigger by searching a notification's title, and the provenance of the 27 files — recorded because it is written nowhere else and in six months there is nobody left to ask. **It also surfaced a hole the questioning round had not reached, and answers it as an explicit assumption rather than silently**: *the owner makes the sound* has no answer for a dispatcher working the console with no game running, where the owner of `panic_button` is simply not there to voice it. So ownership is written as a **SUPPRESSION rule rather than a permission rule** — a surface suppresses a foreign event only while it knows the owner is present and voicing, and with no such handshake every surface voices everything it can see. The shapes of the two failures are not comparable: a suppression rule degrades into *you hear it twice*, a permission rule into *you hear nothing*. Where the handshake lives is deliberately not invented here |
| **2/02 The set, and the floor under it** | **PARTLY DONE 2026-09-11 — the floor is built, the FILES are blocked and the blocker is a number.** `packages/audio/src/tones.ts` synthesises every one of the contract's eighteen names: pure, deterministic to the sample, no oscillator nodes and no context, which is what makes a tone testable at all and also why the floor cannot fail — there is nothing there to be absent. **The vocabulary is pitch and repetition rather than timbre**, because that is what a dispatch alert language has always been and what survives a phone speaker: a priority is three pulses, two, or one (urgency without volume, which is what a priority IS), a fall means *gone*, a rise means *back*, and everything routine is one soft tone. Every pulse is enveloped, since a bare sine switched on and off is two clicks with a note between them. `panel-sounds.ts` prefers an authored file and falls back to the tone, and SAYS which layer answered — so *this build is on the floor* is a fact in a capture rather than a guess. 17 tests. **Two mutations found real defects rather than confirming the code**: (1) *starts at silence* proved nothing, because `sin(0)` is zero with or without an envelope — the test now measures the first millisecond against the tone's own level, where an attack is visible; (2) the `missing` list was **unreachable**, since the set is the union of the tone table and the bundled files and each source serves its own names, so it was deleted rather than left reading as protection. **What is NOT done**: the authored files. The raw set is **2.9 MB against a 1 MB budget**, so it needs transcoding before it can ship at all, and this container has neither `ffmpeg` nor `opusenc`. That is the budget doing its job rather than an obstacle — the number says the files cannot ship as they are, whoever moves them |
| **2/03 The event API** | **DONE 2026-09-11.** `packages/audio/src/panel-events.ts` — the contract's vocabulary in code: which category owns each of the eighteen names, and the two that are FLOORED. **The whole path is resident**, so `event()` is a lookup and a voice with nothing to fetch, decode or convert. **The latency is measured from when the EVENT happened rather than from when this was called**, which is the only version of the number the budget is about: a message that took 200 ms to cross a socket and 1 ms to reach a speaker is a late alert, and a clock started at the speaker would call it instant. An unknown name is said ONCE — a vocabulary mismatch between two repositories is one fact, not one per arrival. **Two mutations exposed weak tests rather than good code**: the floor's test passed with flooring removed, because it was really testing the RESERVE (slots) rather than the floor (muting) — it now mutes `cad` and watches a panic open the bus while a chime stays silent; and the category table had no test of its CONTENT, so moving `alpr_hit` to the world bus passed — the map names are now asserted exactly, which is the contract's own test written down |
| **2/04 Coalescing and variation** | **DONE 2026-09-11.** A name that has just sounded stays quiet for **900 ms** and the fold is counted: ten calls arriving at once is an ordinary bad minute, and ten identical chimes is a machine gun at exactly the moment an operator most needs to think. **Per NAME rather than globally**, so a panic during a burst of new calls is still heard — coalescing is about repetition, and two different events are not one. Every play is detuned by up to **3 %**, small enough that nobody could name the interval and large enough that a queue is not one recording repeated. **The chain learned this from the original once already**: `CAETwinLoopSoundEntity` randomises its swap interval precisely because a fixed one makes a rhythm, and a rhythm is what an ear learns and then cannot stop hearing. Three mutations fail, including replacing the per-name window with a global one |
| 3/01 · 3/02 · 3/03 · 3/04 | not started |
| 4/01 · 4/02 · 4/03 | not started |
| 5/01 | not started |

**The defect this plan opened on, restated so the first step cannot be skipped**: `VoicePool` ranks a voice
by `audibleGain`, which for a positionless sound is its bare gain — so a panel alert authored at 0.8 ranks
below sixty-four engines at 1.0 near the camera and `play` returns `null`. Nothing reports it as anything but
a refusal count. It is live in `main` today and only invisible because nothing yet plays a panel alert.
