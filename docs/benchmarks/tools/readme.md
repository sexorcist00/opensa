# Tool-build measurements — the third family

**What lives here:** measured numbers of BUILD TOOLS — wall-clock of a full run, input/output sizes,
per-item tables. Neither of the other two families fits them: a tool run has no frame cost
(performance family) and no behaviour lap (vehicle-physics family), but the standing rule — every
measured number gets committed here, immediately — applies to it the same.

**Conditions are still the whole point.** Every file names its inputs (which game tree, which mod set,
which flags) and the machine; two runs are only comparable when those match.

## File naming

`YYYY-MM-DD-<tool>-<what>.md` — e.g. `2026-08-13-vehicle-cutscene-fleet.md`.

## Chronology

| Date | File | Tool | What |
| --- | --- | --- | --- |
| 2026-08-13 | [2026-08-13-vehicle-cutscene-fleet.md](2026-08-13-vehicle-cutscene-fleet.md) | vehicle-cutscene | The first full 23-model fleet build (plan 002 step 10): sizes, wall-clock, structural verification |
| 2026-08-15 | [2026-08-15-vehicle-installer-batched-img.md](2026-08-15-vehicle-installer-batched-img.md) | vehicle-installer | The batched gta3.img write: a stage that could not finish now takes 6.13 s — and emits a 4.27 GB archive no reader can open |
