# 201/8 — The time axis

**Decided 2026-08-06, and moved forward from [roadmap 0.6.0](../../../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md)
deliberately.** Not because replay is urgent, but because *where time lives in the data model* is the kind of
decision that costs a rewrite if it is taken late. A unit whose position is a point cannot be scrubbed; a
unit whose position is a function of time can be, and everything else — smooth movement, trails, replay —
falls out of the same structure.

This is the shape CZML gives Cesium: an entity's properties are functions over an interval, and a clock
drives the scene. We are not adopting CZML; we are adopting the fact that **time is an axis, not a field.**

## What it has to serve

| Requirement | Decided |
| --- | --- |
| Movement between server packets | ~~interpolated~~ → **the last fix, and never extrapolated past it** (the user's call, 2026-08-22 — see [02](#02--interpolation-honestly)) |
| History depth | **the current shift** (hours) — client-side, no storage backend needed |
| Scrub | a timeline the operator drags |
| Playback | accelerated (×2, ×8) |
| Trail | where a unit has been over the last N minutes |
| Moment bookmarks | "it started here", returnable |

## Steps

### 01 — A position is a function of time

The board's unit and call types stop carrying a position and start carrying a sampled track over an
interval. `stepOperations` (`apps/dispatch/src/ops/sim.ts`) — the mock feed, and a pure reducer — is what
writes into it today; the real feed from the native CAD plugin writes into the same structure later.

The renderer asks for *the state at time T*, and "now" is simply the T the clock is at.

**Owes:** the type, the sampling policy (how often a track keeps a sample and what it drops), and the memory
cost of 150 units × a shift, measured against the
[300–500 MB ceiling](../readme.md#the-budgets-this-chain-is-held-to).

**DONE 2026-08-22.** `UnitTracks` (`apps/dispatch/src/ops/tracks.ts`) — a ring of samples per unit, stored
column-wise (`t` u32 ms, `x`/`y`/`heading` f32, `status` u8) so a sample costs exactly **17 bytes** and the
figure is a fact rather than an estimate of what an array of objects weighs.

**It is a store beside the board, not a field on `Unit`, and that is a deviation from the sketch above with
a reason.** `Operations` is an immutable snapshot and `stepOperations` is a pure reducer — the property that
lets the whole board be unit-tested today and swapped for a socket handler later. A ring buffer cannot be
immutable at a per-tick cost, so putting one on `Unit` would either destroy that purity or copy 150 buffers
20 times a second. `Unit.at` stays what it always was — the state at `ops.now` — and the store answers every
other T. The recording happens **outside** the React state updater, because a side effect inside one runs
twice under StrictMode and a track written twice cannot be scrubbed.

**The sampling policy, and all three rules come from the feed rather than from taste:**

- **One sample per 4 s**, which is not a choice: it is PCAD's publish rate, read out of its source
  ([202 §4](../../202-pcad-dispatch/readme.md)). The mock ticks at 20 Hz, and recording at tick rate would
  make the mock's tracks five times denser than the live feed's — a memory figure that flatters and a scrub
  that behaves differently in the two.
- **A status change always samples**, rate limit or not: a unit that went en-route and arrived between two
  position samples has a history saying it never did.
- **A stationary run collapses to its two ends** — the moment it stopped, and where it still is. Most of a
  shift, most units are parked.

**The number it owed** ([the measurement](../../../benchmarks/opensa-engine/2026-08-22-dispatch-track-memory.json)):
**17.51 MB for 150 units × 8 h**, and the accounting is EXACT — `arrayBuffers` moves by 17.51 MB against an
accounted 17.51. Two things that matter more than the figure:

- **It is HOST memory and may not be charged against the 300–500 MB ceiling**, which is `Engine.ledger()`
  counting GPU bytes. The report keeps `tracks` apart from `world.residencyMb` for the same reason 5/01 kept
  `pickingMb` apart from it.
- **The reading that would have lied**: `heapUsed` alone reports **0.2 MB** for 17.5 MB of typed arrays,
  because a backing store lives outside the V8 heap. The first version of this measurement watched only
  `heapUsed` — plausible, self-consistent and completely wrong, the same family as the 2454 cell creates.

**And the collapse buys history rather than bytes**, which was not the expected answer: the ring is
pre-allocated, so every scenario pays the same 17.51 MB. What differs is what it HOLDS — 8.0 h when all 150
move for the whole shift, and **24.0 h at a plausible 25 % duty cycle**.

`SHIFT_HOURS = 8` is the one number nobody named, and it is [a recorded
hack](../../../hacks/dispatch-shift-length.md) rather than a decision: the rate either side of it is
measured, the unit count is the user's, and this one is not. Linear in both memory and history; the user
naming a window retires it in one sentence.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** nothing.

### 02 — Interpolation, honestly

Between two received samples the unit moves smoothly; past the last one it **stops**. Extrapolation was
rejected on 2026-08-06: a car continuing on its last vector drives through a wall, and a map that invents
positions is worse than one that admits it is a second behind.

**INTERPOLATION IS OUT TOO — the user's call, 2026-08-22.** A track answers with the last fix at or before
the moment asked for; between two fixes it steps rather than slides. It had been built in 8/01 and is
removed, before anything on screen depended on it.

Three things make the call the right one rather than merely the one that was made:

- **The same argument that killed extrapolation applies to the slide.** At PCAD's 4 s rate a car at 100 km/h
  covers ~110 m between fixes, and a straight line between them runs through buildings.
  [202 §4](../../202-pcad-dispatch/readme.md) named exactly this — *"smooth, confident and wrong, which is
  worse on a 3D map than on a tile map because the world around it makes the error obvious"* — and then
  listed interpolation as the thing whose rate this constrains. Stepping is the honest picture of a
  self-reported feed: the dot is where the unit SAID it was.
- **Nothing on screen needed it.** The mock feed integrates at 20 Hz, so the live map is already smooth; and
  a drag across an 8 h timeline moves about one sample per pixel, so a slide inside a 4 s gap is invisible.
  It was machinery for a feed that is not wired yet.
- **The cheap fix for the jumping is not ours.** 202 phase 4 already proposes raising PCAD's publish rate,
  and *"both are worth measuring before choosing: raise the rate and see what the map looks like, before
  building uncertainty rendering to compensate for a rate nobody tried to change."*

**What would bring it back:** a field verdict that stepping reads badly at a publish rate nobody managed to
raise. That is a measurement, and it is [202 phase 4](../../202-pcad-dispatch/readme.md)'s to take.

**Owes:** what the operator sees when the feed goes quiet — a stale marker, not a confidently wrong one — and
the latency the interpolation adds.

**The engine half is enforced in the track accessor rather than left to each consumer.** `UnitTracks.at`
answers with the last fix and **holds** past it, returning the answer's age and a `stale` flag once it is
older than one publish interval — so no consumer can invent a position. Reintroducing extrapolation fails a
test. What remains is entirely this step's and is UI: showing the operator that a marker is aging. The
latency number the step also owed is now zero by construction — a stepped read adds none.

### 03 — The clock and the timeline

One clock the whole console reads: the world's hour, the board, and the symbology all take their T from it.
Scrub, ×2/×8 playback, live/return-to-live, and bookmarks on moments.

The world's own time of day follows the server with a manual override (decided 2026-08-06) — so the clock has
**two** notions of time that must not be confused: the *game hour* the environment driver applies, and the
*wall time* the board is scrubbed along. Say which is which in the UI or the operator will read one for the
other.

**Owes:** the two clocks distinguished on screen, and the frame cost of a scrub (a drag re-solves every
entity — it must not stall).

**DONE 2026-08-22.**

**The whole of replay is one substitution, and that is what 8/01 bought.** `useOperations` now holds two
boards: `live` is what the feed is doing and what the history records, and `ops` is the board AT THE CLOCK —
the same object while live, and a reconstructed snapshot while scrubbing. Everything downstream takes `ops`
and cannot tell which it was handed, so there is no second rendering path: the map loop, the symbology, the
panels and the detail card all work on a scrub without a line of change. Keeping time out of `Unit` and in a
store beside it is what made a resolved snapshot the same shape as a live one.

**A unit and a call get different histories, because they change differently.** A unit MOVES and is sampled;
a call does not move at all and changes STATUS a handful of times, so its history is an event list — smaller
and exact. `BoardHistory` owns both, and a scrub therefore satisfies the chain's own verification: units are
where they were, and calls have the state they had, not the one they ended with.

**The two clocks are labelled, because the chain said they would be confused and the console was already
doing it.** The top bar's dial was labelled `Time`, which is the one label it may not have now that a second
clock exists: it says **`WORLD`** (it turns the sky) and the new timeline strip says **`SHIFT`** (it moves
the board). Whenever the picture is not the current one the strip shows a loud **`REPLAY`** badge, because an
operator reading an hour-old picture as the live one is the failure this step can actually cause.

**Playback stops at the newest sample rather than slipping into live.** A console that silently becomes live
while the operator is reading the past has changed what is on screen without being asked; returning is one
press of a button that says `Live`. ×1/×2/×8, and bookmarks are `Mark` plus a button per moment.

**The number it owed** ([measured](../../../benchmarks/opensa-engine/2026-08-22-dispatch-scrub-cost.json)):
one full-board resolve at 150 units + 40 calls over an 8 h history is **p50 0.071 ms, p95 0.193, worst
0.636** — 0.4 % of a 16.7 ms frame typically and 3.8 % at its worst. A drag re-solves everything every frame
and does not come close to stalling. What is NOT measured and is named rather than assumed: React's
re-render on each scrub frame, which the loop is immune to (it reads through a getter) and the panels are
not.

**One structure here is not bounded** and it is worth knowing before it matters: the unit rings are
fixed-size, the calls' event lists grow with the shift. At a deliberately absurd 49 transitions per call they
are ~125 kB, so nothing needs doing — but a feed that flapped a call's status would grow them without limit.

**Touched from [the protected list](../1-the-map-profile/protected-list.md):** nothing.

### 04 — Trails

The last N minutes of a unit's track, drawn on the ground. Cheap once 01 exists — it is the track, clipped.

Trails are ground geometry, so they share the clamp-to-ground work with
[7/05's annotations](../7-the-operator-map/readme.md). Do not build it twice.

**Owes:** the cost of 150 trails, and the rule for what N is (a constant chosen by eye is a debt —
`docs/hacks/`).

## What this does not do

No storage backend, no cross-shift archive, no incident search. History is the current shift, in the
client. Anything longer needs a server that persists events, which stays in
[roadmap 0.6.0](../../../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md) with the live feed.

## Verification

- Scrub back an hour: units are where they were, calls have the state they had, and the picture is the same
  one the operator saw.
- Switching [display mode](../6-display-modes/readme.md) mid-scrub keeps the moment.
- The feed cut off mid-run leaves stale markers that say so, and no unit inside a building.
