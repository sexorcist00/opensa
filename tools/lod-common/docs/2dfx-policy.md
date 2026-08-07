# The LOD 2dfx carry-policy

**The single source of truth for whether a 2d-effect entry rides onto a LOD.** The code is
`src/two-dfx-policy.ts` (`@opensa/lod-common/two-dfx-policy`); this page is the reasoning behind it. Shipped
by [plan 005](plans/005-2dfx-keep-policy.md).

The policy answers exactly one question — **carry or drop** — and never touches a payload. Rewriting an
entry's position or orientation is `transform2dfxEntry`'s job; keeping the raw bytes byte-verbatim is
`@opensa/rw-codec/dff`'s.

## Targets

Keyed by the **host the output feeds**, not by the generator that writes it — two generators feeding the same
host would otherwise carry the same fact in two rows.

| Target | Written by | Host |
| --- | --- | --- |
| `clone` | `sa-lod-generator` | real San Andreas: a per-object far copy of one model, verbatim or decimated |
| `cell` | `opensa-lod-generator` | the OpenSA engine: one baked mesh per map cell, many instances merged |

## The table

Counts are stock `original` (`scripts/debug/two-dfx-census.ts`, 14 865 models) — entries / models carrying at
least one.

| Type | Name | Stock | `clone` | `cell` | Why |
| --- | --- | --- | --- | --- | --- |
| 0 | light | 2203 / 327 | carry | **carry** | Distant night city lights are why 2dfx rides a LOD at all — and the only type a baked cell has ever carried. |
| 1 | particle | 64 / 43 | carry-rate-scaled | drop | Emitters ship on the clone since `03-asi/010` flipped the strip; `--strip-particles` is the stock-target opt-out. A cell has no emitter budget yet. |
| 3 | ped attractor | 916 / 266 | carry | drop | Carried because the clone paths carry it today. Nothing reads a ped attractor at LOD range — a candidate for the first MEASURED drop. |
| 6 | enter/exit | 78 / 71 | carry | drop | As type 3. |
| 7 | roadsign | 489 / 207 | carry | drop → **carry** | The visible win of the chain. `cell` is drop only until the cell path can re-rotate a plate. |
| 8 | trigger point | 33 / 7 | carry | drop | As type 3, and the rarest of them. |
| 9 | cover point | 15 007 / 1210 | carry | drop | As type 3, and the bulk of the corpus by count — whatever it costs to carry, it costs 15 000 times. |
| 10 | escalator | 5 / 4 | carry | drop → **carry** | Five entries in four models: it will never move an aggregate, so verify it by looking at those four. |
| *any other* | — | 0 | **drop** | **drop** | See below. |

## A type's coordinate SPACE is not the same question as its verdict

Measured over the stock corpus 2026-08-07, and the reason a carry can be correct in the table above and still
land a kilometre away:

| Type | Space | Evidence |
| --- | --- | --- |
| 0 light | model-local | 2094 / 2094 checked |
| 7 **roadsign** | **WORLD** | **489 / 489**. `cen_bit_08` sits at (−487.6, 1929.9) and its plates at (−456.1, 2014.2), (−434.2, 2039.0), (−530.2, 1989.4) — city coordinates. Every one of the 207 sign-carrying models is placed EXACTLY ONCE, which is what makes baking world coords into a model work at all. |
| 10 escalator | model-local | 5 / 5. Two of the four models are placed more than once (`escl_la` ×4), so escalators genuinely need a per-instance transform. |

So a roadsign carried into a cell-relative representation moves by `world − cellOrigin` and keeps its authored
rotation; applying an instance transform to it is a bug, not a refinement. `opensa-pack` has relied on this
since plan 076, and `packages/renderware/src/roadsign/glyph-quads.ts` states it in its header.

## The two rules that are easy to get wrong

**A type with no row is dropped, on every target.** The stock corpus carries only the eight types above, so
this changes nothing there — it is the rule for a type a mod invents, or one Rockstar used somewhere nobody
has looked. Dropping an unknown effect at LOD range is the conservative half of the trade, and it is a
DECISION here rather than an accident of which path happened to byte-copy.

**`carry-rate-scaled` is `carry` until the thinning exists.** `keepTypesFor` includes it: the scaling applies
to the payload, not to whether the entry rides. It is recorded now so the intent does not live only inside a
generator's CLI flag.

## What the policy deliberately does NOT decide

- **Payload transforms** — see `transform2dfxEntry`.
- **The verbatim byte-copy path.** `sa-lod-generator` clones some models by copying the DFF whole, which
  carries every type in the file including ones with no row. The policy applies there SUBTRACTIVELY (strip
  what is `drop`), and how far that goes is that generator's plan to decide and measure, not this table's.
- **Per-model exceptions.** There are none, and there should be none: a rule that names an asset stops being
  true the moment a mod replaces it.
