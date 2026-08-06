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

So the first deliverable is not a server, it is a **contract**: the event and snapshot shapes, what a
reconnect replays, what the client is allowed to extrapolate between updates, and what an operator sees when
the feed is stale rather than empty. Written into [`docs/contracts/`](../../../../contracts/) so a backend can
be built separately and later, against something rather than against a guess.

## Routes that are real paths, not bearings

Routes are drawn as straight lines today, and that is honest rather than lazy: the vehicle node graph lives in
`data/Paths` and is **`original`-only** — a total conversion ships none
([assets-and-data](../../../../restrictions/assets-and-data.md)) — so a route line would silently lie on half
the games we run. A bearing that admits to being a bearing beat that.

Real routing needs the graph question answered first: what a game without `data/Paths` gets, and whether the
sidecar the [city-life chain](../../../0.5.0/plans/06-city-life/readme.md) is already designing for this case
too. Note also what the graph does **not** say — travel direction (0 one-way links parsed) and gradient.

## Replay and history

A dispatch desk is judged after the shift as much as during it: scrub back through a period, watch units and
calls move, and answer "what did we see at 14:20". The engine already has the pieces in a different shape —
plan 096's video mode drives seeded runs through the world deterministically — so the question is whether a
replay is a recorded event log played back through the same board reducer (cheap, exact, and it works with
the mock feed too) or something heavier.

## Multi-operator

Two or more consoles on the same board: assignment conflicts, ownership of a call, and who wins when both
dispatch the same unit. Blocked on the feed contract above — there is nothing to share state through until
that exists.

## Install and offline

A dispatcher on a phone wants the console on the home screen and the map available when the network is not:
install (PWA), an offline cache over the pak's already content-addressed chunks, and an honest statement of
what works without a connection. Deliberately out of 0.5.0's console chain, which stops at "excellent in a
browser tab on a real phone".
