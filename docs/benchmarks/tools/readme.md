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
| 2026-08-15 | [2026-08-15-vehicle-cutscene-no-base-copy.md](2026-08-15-vehicle-cutscene-no-base-copy.md) | vehicle-cutscene | `--no-base-copy` (plan 006): 1.72 GiB of output down to 579 MiB and three files, byte-identical to the copy run |
| 2026-08-15 | [2026-08-15-mod-installer-layered-flat-path.md](2026-08-15-mod-installer-layered-flat-path.md) | mod-installer | The flat path across plan 011: byte-identical install before/after the layer walk — and why the session's wall-clock is not usable |
| 2026-08-15 | [2026-08-15-vehicle-installer-models-new.md](2026-08-15-vehicle-installer-models-new.md) | vehicle-installer | `models/` + `new/` (plan 007): the flat path byte-identical before/after, the structured tree going 0 → 212 cars (and the cutscene census 0/23 → 23/23), rebake per car |
| 2026-08-17 | [2026-08-17-model-repack-lod-half.md](2026-08-17-model-repack-lod-half.md) | model-repack | opensa-lod-generator plan 007: the OpenSA one-model swap gains its LOD half — gostown one cell 1.9 s (LOD rebake 1.2 s), lab LOD cut from the swapped HD (md5 proof), the all-archives source fix |
| 2026-08-17 | [2026-08-17-pmb-resume-killed-build.md](2026-08-17-pmb-resume-killed-build.md) | perfect-map-builder | `--resume` on the first REAL killed build (gostown, SIGTERM at weld chunk 6/21): refused over a consumed chain dir (fixed), then resumed at chunk 7 — 122 s vs 197 s unbroken, pak + water + all archives byte-identical |
| 2026-08-17 | [2026-08-17-vehicle-installer-rebake-sa.md](2026-08-17-vehicle-installer-rebake-sa.md) | vehicle-installer | `--rebake --kind sa` (plan 008): one car into the real-SA tree in 4.2 s (vs a 707 s build), 3.7 GB peak RSS, archives byte-identical on the idempotence run |
| 2026-08-18 | [2026-08-18-cutscene-converter-0.4.0.md](2026-08-18-cutscene-converter-0.4.0.md) | cutscene-converter | The first Windows runs (the user's machine): cold start ~5 s, conversion ~2 s — the cold start is 2.5× the work it starts, and the portable format owns it. Plus the released artifact's figures (exe 89 008 404 B, asar 199 198 B, plugin sha1) |
