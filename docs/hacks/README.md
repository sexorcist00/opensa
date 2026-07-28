# Hacks

Every expedient this project knowingly took: a constant fitted by eye instead of read from the game, a
heuristic standing in for a formula nobody has recovered yet, a trick that buys a look the honest path would
have cost too much to get.

They are written down for one reason: **a hack that nobody recorded is indistinguishable from a decision.**
Six months on, the fitted 0.6 in a shader reads as if someone knew it was 0.6. This rubric keeps the
difference visible — what it stands in for, what it was judged on, and what would replace it.

Recording one is not permission to take it. The standing rule in `CLAUDE.md` still holds: dig the original
game's real formula out of the reversed source first, and a fitted constant is a debt, not an answer. This
folder is the debt ledger.

## What belongs here

- A **fitted constant** — a number chosen because it looked right, not because the game or the physics says
  it (`NIGHT_SKY_RELAX`, `POPUP_SPEED`).
- A **stand-in rule** — a heuristic that answers a question the real system would answer differently (finding
  a car's cabin from its glass bounds because there is no interior-lighting model).
- A **deliberate cheat for the look** — an effect faked because the real one is not there (a dashboard glow
  with no light source behind it).
- An **exclusion or special case** carried for a reason the general rule cannot express.

## What does NOT belong here

- `docs/edge-cases/` — a LIMIT we live with (a format ceiling, a missing feature). A hack is something we
  actively DO; an edge case is something we cannot do.
- `docs/performance/` — a lever we chose not to pull, with its price. A hack has already been pulled.
- `docs/postmortem/` — a direction that DIED. A hack is alive and shipping.
- Anything measured out of the game's own data. A number read from `handling.cfg`, a rule taken from the
  reversed source, an angle derived from the model — those are answers, and they belong in `docs/features/`
  or `docs/contracts/`.

## The file shape

One file per hack, named for what it does (`night-sky-relax.md`, not `090-01.md`), carrying:

1. **What it is** — the constant or rule, verbatim, with where it lives in the code.
2. **What it stands in for** — the honest thing it replaces, and why that thing is not there.
3. **What it was judged on** — the measurement or the field verdict that made it acceptable. "It looked
   right" is a legitimate answer, as long as it says so.
4. **What would retire it** — the condition under which this stops being needed.
5. **Blast radius** — what else moves if the number changes.

## Lifecycle

A hack that gets replaced by a proper approach **moves to [`retired/`](retired/)** — it is not deleted. Its
entry gains a closing note: what replaced it, in which commit or plan, and what the honest version turned out
to be. The row in the table below stays and points at the new location, so the history of a number survives
the number.

## Live hacks

| Hack | Where | Stands in for |
| --- | --- | --- |
| [Night relax of the sky-occlusion term](night-sky-relax.md) | `engine/render/shaders.ts` | a night light model that knows light arrives from the street, not the sky |
| [The dash light and how a cabin is found](cabin-glow.md) | `renderware/vehicle/cabin.ts`, `engine/render/shaders.ts` | interior lighting with an actual source, and an authored interior tag |
| [Pop-up headlight travel time](popup-travel-time.md) | `game/vehicle/vehicle-rig.ts` | SA's own pop-up animation, which does not exist |
| [Independent-axle camber gain](independent-camber-gain.md) | `game/vehicle/vehicle-rig.ts` | the original's rule for the `AXLE_*` model flags, absent from the reversed source |

Older fitted numbers elsewhere in the tree (the sky-occlusion despeckle slack, the reflection HDR gain, the
dynamic-indirect weight) are candidates for this list and get written up as they are next touched — this
folder was opened 2026-07-28 and is not back-filled wholesale.
