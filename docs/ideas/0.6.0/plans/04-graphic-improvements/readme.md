# 04 — Graphic improvements (shadows + street-lamp lighting)

**STATUS: DRAFT bundle** — both members are parked ideas the user wants to think through properly later
("мы позже хорошо над этим подумаем"); nothing here is scheduled or committed to a design.

The common thread: both features were BUILT in some form during the 074 chain, field-tested, and removed
by user decision — the current shipping engine is the deliberately simple, stable, fast version. This
bundle exists so the next attempt starts from the full record of what failed and why, not from zero.

| #   | Idea                                                             | Came from                                                                                                         |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 01  | [Baked directional sun shadows](01-baked-directional-shadows.md) | 074/07 v2, built + field-reverted 2026-07-12 (receiver-densification prerequisite inside); moved from 0.5.0/03    |
| 02  | [Light ALL lamps of loaded HD cells](02-hd-cell-lamps.md)        | The 2026-07-17 lamp-pool removal + the user's field observation that the budget likely allows lighting everything |

Adjacent open questions to fold into the same thinking round: vehicle/dynamic-entity grounding (the
rolled-back plan-16 contact blob — record + constraints in
[074/16 § steps 3+6](../../../../plans/074-opensa-engine/16-vehicle-paint.md)) and the
[hd-realtime-lod-baked concept](../../../../plans/074-opensa-engine/concept/hd-realtime-lod-baked.md)
(HD segment real-time light+shadows, bakes only for LODs) — a decision there may answer both members at
once.
