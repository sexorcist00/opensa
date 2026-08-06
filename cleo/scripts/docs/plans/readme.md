# cleo/scripts — plan chain (authored replacements for the two corpus scripts)

Author OUR versions of the two shipping corpus scripts on the SDK (`cleo/sdk`): `rhino tracks.cs`
and `no_lights.cs`. One source, two runtimes — every authored script stays a conformance test of
the VM against real CLEO, and both replacements are measurably better than the originals (smaller,
cheaper per frame, and for rhino: a real chance to fix the tracks-don't-rotate defect).

**Provenance of the call (2026-08-06):** for rhino this RESTORES a recorded intent — the 097/07
ledger (defect row 7) already said *"User's call 2026-08-05: SKIP — 097/08 authors our own track
script instead"* — which the 097/08 scope-cut paragraph then contradicted ("rhino tracks stays the
author's script"). For no_lights it REVERSES the 2026-08-05 skip (the native light-damage recipe in
[`docs/postmortem/097-hotring-hotknife-intake.md`](../../../../docs/postmortem/097-hotring-hotknife-intake.md)
remains the engine half of plan 002, not an alternative to it). The superseded scope-cut lines in
`docs/plans/097-cleo-basic/08-authoring-sdk.md` and `cleo/sdk/docs/plans/readme.md` now point here.

## The chain

| #   | Plan                                    | Delivers                                                                                                                                      | Status  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | [001 — rhino tracks](001-rhino-tracks.md) | authored track script: `0AE2` walk, per-link loop, frames addressed BY NAME (`track_1`…`track_12`) — bypassing the sibling-order hack; both-runtime field proof | planned |
| 2   | [002 — no_lights](002-no-lights.md)     | authored hotring light-killer + the engine half that makes it visible on OpenSA (atlas row for `SetLightStatus`, smashed-lamp state in vehicle-lamps) | planned |

001 first: it is script-only (zero engine changes) and exercises the SDK loop/name-lookup surface
002 reuses. 002 carries the one engine seam (the smashed-lamp state) — that state is derived from
damage STATE, never from a model id, so any CLEO mod smashing lights benefits, not just this script.

## What "done" means for the chain

Each authored script: (a) compiles dual-target under the whitelist gate, byte-deterministic;
(b) headless story green within its declared per-frame budget, measured better than the original
it replaces (numbers in the plan ledger); (c) field-proven on OpenSA AND under real CLEO on the
canonical SA 1.0 US exe (Wine, manual verdict); (d) ships in the pak build in place of the
author's original, with the author's mod files in `mods-src/` left byte-untouched.
