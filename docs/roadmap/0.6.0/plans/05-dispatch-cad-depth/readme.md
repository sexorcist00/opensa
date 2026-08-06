# CAD depth — what the dispatch console is missing to be a real system

The console ships in 0.5.0 as a real map with a **mock desk**: the world, the streaming, the picking and the
operator chrome are real; the operations feed is a client-side simulation. That was the right cut — it made
the surface exist and proved the engine embeds — and this is the list of what a working dispatch system has
that a mock does not.

Deferred by decision on 2026-08-06, not by difficulty. Each item is a blurb, not a step chain; the chain gets
written when the cycle picks it up. The 0.5.0 half is [plan 098](../../../../plans/098-dispatch-console/readme.md).

## The live operations feed — contract first

`stepOperations` (`apps/dispatch/src/ops/sim.ts`) is a pure, unit-tested reducer that moves units,
auto-dispatches, ages calls and trickles new ones. Its header already names the seam: *when this app is wired
to a game server, `stepOperations` is what gets replaced by the socket handler; nothing else in the app
changes.* There is no networking anywhere in this repo today — not a WebSocket, not a poll.

The source is known as of 2026-08-06: a **native CAD plugin** on the client side is what raises calls and
carries the dispatcher's traffic to the units. The console stays a separate web application beside the game
and consumes what that plugin publishes.

So the first deliverable is not a server, it is a **contract**: the event and snapshot shapes, what a
reconnect replays, how often a unit's position is published (chain 8's interpolation is written against that
rate), and what an operator sees when the feed is stale rather than empty. Written into
[`docs/contracts/`](../../../../contracts/) so the plugin and the console can be built separately, against
something rather than against a guess.

Note what is **not** deferred: the client-side time axis moved forward into
[098/8](../../../../plans/098-dispatch-console/8-the-time-axis/readme.md), because where time lives in the
data model is cheap to decide now and a rewrite to decide late.

## Routes that are real paths, not bearings

Routes are drawn as straight lines today, and that is honest rather than lazy: the vehicle node graph lives in
`data/Paths` and is **`original`-only** — a total conversion ships none
([assets-and-data](../../../../restrictions/assets-and-data.md)) — so a route line would silently lie on half
the games we run. A bearing that admits to being a bearing beat that.

Real routing needs the graph question answered first: what a game without `data/Paths` gets, and whether the
sidecar the [city-life chain](../../../0.5.0/plans/06-city-life/readme.md) is already designing for this case
too. Note also what the graph does **not** say — travel direction (0 one-way links parsed) and gradient.

## History beyond the current shift

Scrubbing **within a shift** is no longer deferred — it lives in
[098/8](../../../../plans/098-dispatch-console/8-the-time-axis/readme.md), client-side, needing no storage.
What stays here is everything that outlives the browser tab: persisting events across shifts, an incident
archive, and search over it ("what did we see at 14:20 last Tuesday"). That needs a server that keeps the
log, which is the same server the live feed needs — so the two arrive together or not at all.

## Multi-operator

Two or more consoles on the same board: assignment conflicts, ownership of a call, and who wins when both
dispatch the same unit. Blocked on the feed contract above — there is nothing to share state through until
that exists.

## Install and offline

A dispatcher on a phone wants the console on the home screen and the map available when the network is not:
install (PWA), an offline cache over the pak's already content-addressed chunks, and an honest statement of
what works without a connection. Deliberately out of 0.5.0's console chain, which stops at "excellent in a
browser tab on a real phone".
