# 098 — The dispatch console: a CAD map, trimmed to what it draws, on a phone

**The engine's second consumer, declared** (priority set 2026-08-06). `apps/dispatch` is a computer-aided-
dispatch operator surface over the streamed world — a top-down 3D map, live units, a call queue, and
click-to-inspect that answers with the model and TXD names the pak was built from. It arrived in a single
commit (`d57c92d`) with one write-up ([features/dispatch-console.md](../../features/dispatch-console.md))
and **nothing else**: no plan chain, no roadmap row, and not a word in
[project-goals](../../project-goals.md), every line of which was written for one consumer — the game.

Two facts make that gap expensive right now.

**This is the surface that reaches a phone.** It is the only one in the repo that does. The game cannot: a
pak built from SA assets is BC throughout and no mobile GPU has BC, which is the whole reason
[097](../097-platform-reach/readme.md) exists. The console already opens an `--rgba8` world today — no gate,
no pending concept. Meanwhile the project's entire mobile evidence base is **one synthetic row**, and 097
says so itself: *"nothing here has been run on the phone"*. Its step
[1/04](../097-platform-reach/1-device-truth/readme.md) deliberately refused to write a residency ceiling
rather than fit a constant before a device was measured. This chain is how that measurement gets taken.

**A map view never reads part of what it ships — and only that part may be cut.** The direction is to
optimise the engine for the 3D map without the extra, and the second half of that sentence is the load-
bearing one: **cars and peds are drawn, the palm sways, the day turns, the weather colours the world.** That
is what makes a 3D map a 3D map instead of a tile stack, and it is what
[directive 6](../../project-goals.md#6-the-target-is-a-aaa-grade-game-and-that-is-a-measurable-claim) calls a
world that is alive. What may be cut is the dead half: pak entries no frame of this surface ever requests,
passes with no consumer on screen, and bundle code that never executes.

## The decisions this chain is built on

Taken 2026-08-06 with the user; every step below inherits them.

| Decision | What it rules in | What it rules out |
| --- | --- | --- |
| **The SA world only** | the console reads the same pak and the same authored data the game does | geo import (OSM / tiles / CityGML), a CRS layer, CAD over a real city |
| **The console leads the mobile work** | phone work is ordered by the operator surface, because it is the one that runs there | the game shell's touch chrome setting the order |
| **The board stays a mock** | `stepOperations` remains the feed; the seam stays a seam | a backend, a socket protocol, multi-operator, replay |
| **Cut only what is dead** | one declared map profile, over the build and the frame, removing what this surface **provably never reads** | cutting whatever looks "game-ish": cars and peds are drawn, vegetation sways, the day turns |
| **One engine, PC and mobile** | shared code and a shared frame; the platform difference is a **budget**, not a feature set | a forked renderer, a "mobile shader path", a second codebase |
| **UI is designed, not eyeballed** | the design skills are loaded before layout and colour; tokens live in `apps/dispatch/src/ui/styles.ts` | picking colour and density by feel, styles scattered per component |

## The evidence this chain is answering

Every number is already in the record.

| What | Measured | Where |
| --- | --- | --- |
| Phone, synthetic world | 41 fps, 162 draws, 37 MB resident — Mali-G51, 360×800 @ DPR 2, `?demo=1` (no streaming, no LODs, no water) | [benchmarks, mobile row](../../benchmarks/index.md#mobile) |
| Phone, emulated | Pixel 7 412×839 @ DPR 3, 38–46 fps under SwiftShader, 576 recorded draws, 44/144 cells visible | [features/dispatch-console.md](../../features/dispatch-console.md#verification) |
| Phone, real world | never run — the console is what makes it runnable today | this chain, [2/03](2-real-device-truth/readme.md) |
| Desktop, populated drive | 1004 slow frames, p50 21.3 ms · **GPU pass mean 15.64 ms against a CPU render of 0.1–0.6 ms** | [091](../091-frame-time-attribution/readme.md) |
| Cold entry into a district | first frame `cell-collision-read` **235 ms**, then ~20 frames of 110–170 ms | 093 sweep |
| Boot frame | **576.1 ms** | 091 |
| The shareable console | ~490 kB of ASCII-escaped JS, single-file **for `?demo=1` only** — the pak worker is a separate `assets/pak-worker-*.js` chunk | [features/dispatch-console.md](../../features/dispatch-console.md#verification) |
| BC pak reference | 1,272,901,632 B at 1137 cells | [universal-texture concept](../../concepts/universal-texture-transcode.md) |

Read together: the desktop engine is GPU-bound in steady state and main-thread-bound in transients, and the
phone has never been measured against real content at all. So the order is **cut the dead weight, then
measure the thing we intend to ship, then tune against that measurement** — never the other way round.

## The chains, in execution order

| # | Chain | Why here |
| --- | --- | --- |
| 1 | [The map profile](1-the-map-profile/readme.md) | Dropping bytes nothing reads needs no device to justify it, and it changes every number the rest of the chain is tuned against |
| 2 | [Real device truth](2-real-device-truth/readme.md) | The first real mobile row in this repo, and it should be a row of what we intend to ship. Hands 097 the ceiling it refused to invent |
| 3 | [The operator surface on a phone](3-the-operator-surface-on-a-phone/readme.md) | "It loads" is not "an operator can work it" — 360 CSS px, touch, legibility, and the no-GPU floor |
| 4 | [A console is not a game](4-a-console-is-not-a-game/readme.md) | A game is always moving; a dispatch map idles most of a shift on a device that runs hot and flat |
| 5 | [Symbology and picking as product](5-symbology-and-picking-as-product/readme.md) | The console's central interaction stands on a flag named `debug`, and its units are debug lines |

## What this chain does NOT own

[097](../097-platform-reach/readme.md) keeps all of it, and 098 duplicates none of it: universal texture
transcode and its concept gate, workers and `crossOriginIsolated` transport, the runtime read of the baked
collision, the WebGL2 fallback backend and its concept gate, and the game shell's touch controls. Where this
chain needs one of those, it says so and waits rather than building a second version.

The relationship runs the other way too: 097's phone-side steps are blocked on a device measurement nobody
has taken, and [2/03](2-real-device-truth/readme.md) is the cheapest way to take it.

## Ruled out, 2026-08-06

Recorded so they are not re-litigated, not because they are bad:

- **Real-world geography** — no OSM/tile/CityGML import, no CRS layer. The console maps the SA world.
- **A live operations feed** — the board stays `stepOperations`. The seam is already named in
  `apps/dispatch/src/ops/sim.ts`; the contract for a real one is
  [roadmap 0.6.0](../../roadmap/0.6.0/plans/05-dispatch-cad-depth/readme.md).
- **Multi-operator, replay/history, install + offline pak cache** — same roadmap entry, deferred by decision
  rather than by difficulty.

## Status

| Step | State |
| --- | --- |
| the chain itself | **OPENED 2026-08-06** — declared, ordered, and the decisions above taken with the user |
| 1/01 … 5/04 | not started |

**Owed, and not yet paid:** every number quoted above is somebody else's measurement. This chain has not run
anything yet, and its headline claim — a real district, on a real phone, in an operator's hands — stays
unproven until [2/03](2-real-device-truth/readme.md) records its row.
