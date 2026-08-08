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

### 02 — Interpolation, honestly

Between two received samples the unit moves smoothly; past the last one it **stops**. Extrapolation was
rejected on 2026-08-06: a car continuing on its last vector drives through a wall, and a map that invents
positions is worse than one that admits it is a second behind.

**Owes:** what the operator sees when the feed goes quiet — a stale marker, not a confidently wrong one — and
the latency the interpolation adds.

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
