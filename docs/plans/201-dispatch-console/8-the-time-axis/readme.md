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
| Movement between server packets | **interpolated**, never teleported and never extrapolated past what was received |
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

**Owes:** what the operator sees when the feed goes quiet — a stale marker, not a confidently wrong one — and
the latency the interpolation adds.

**Half of it is already enforced, by 8/01 rather than by this step.** `UnitTracks.at` interpolates between
two samples and **holds** past the last one, returning the answer's age and a `stale` flag once it is older
than one publish interval — so no consumer can accidentally invent a position, whatever this step decides to
draw. Reintroducing extrapolation fails a test. What remains is entirely this step's: showing the operator
that a marker is aging, and the latency number.

### 03 — The clock and the timeline

One clock the whole console reads: the world's hour, the board, and the symbology all take their T from it.
Scrub, ×2/×8 playback, live/return-to-live, and bookmarks on moments.

The world's own time of day follows the server with a manual override (decided 2026-08-06) — so the clock has
**two** notions of time that must not be confused: the *game hour* the environment driver applies, and the
*wall time* the board is scrubbed along. Say which is which in the UI or the operator will read one for the
other.

**Owes:** the two clocks distinguished on screen, and the frame cost of a scrub (a drag re-solves every
entity — it must not stall).

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
