# 2026-08-15 — vehicle-installer: the batched gta3.img write

**What this measures:** the vehicles stage after the batch fix (one archive open, one `writeImgFile` per
RUN, entries staged by path via `EditableImg.setFile`) — replacing a full `writeFileSync(img.build())`
rebuild per car.

**Why it exists:** the stage could not complete at all before. The `sa` build died mid-stage on
`ERR_OUT_OF_RANGE` at 2 168 825 856 B — `writeFileSync` caps at 2 GiB and the archive crossed it partway
through the alphabet.

## Conditions

| | |
| --- | --- |
| Machine | this workstation, macOS 25.6.0 (Darwin), APFS |
| Node | v24.15.0 |
| `--game` | `build/original/.work-sa/1-mods` — the tree the `mods` stage produced this day (1.8 GB, `gta3.img` 1 242 236 928 B) |
| `--in` | `mods-src/original/vehicles` — 212 folders, 752 dff/txd, 3 077 354 628 B |
| Command | `tsx tools/vehicle-installer/src/cli.ts --game … --in … --out …`, standalone (not through pmb) |
| Commit | `a1a1217c` |

**APFS caveat, and it matters for comparison:** `install()` starts with `cpSync(gamePath, outPath)` of the
whole 1.8 GB tree, which macOS serves by copy-on-write and effectively for free. The same run on NTFS pays
that copy in full. Do not read the wall clock below as portable.

## Run

| | Before (2026-08-11 set) | Before (this set) | After |
| --- | --- | --- | --- |
| Outcome | completed | **FAILED mid-stage** | **completed** |
| Wall clock | 26.8 s (pmb stage timing) | — (died) | **6.13 s** (`/usr/bin/time -l` real) |
| Archive rebuilds | 1 per car | 1 per car | **1 per run** |
| Peak RSS | not measured | — | **3 105 882 112 B (3.11 GB)** |
| `models/gta3.img` out | not recorded | — | **4 268 185 600 B (4.27 GB)** |
| Entries written | not recorded | — | 743 img entries, 212 vehicles, 211 mod-ledger slots |

`user 1.44 s / sys 2.33 s` against `real 6.13 s` — the stage is I/O bound, as a 4.27 GB write should be.

## The result this run is really about

The stage now produces an archive **nothing in the repo can read back**:

```
readFileSync FAILS: ERR_FS_FILE_TOO_LARGE File size (4268185600) is greater than 2 GiB
```

That is the predicted state, not a surprise — the fix removes the WRITE ceiling and Node's READ ceiling is
untouched at 2 GiB. So the vehicles stage is unblocked and the pipeline behind it is not: `sa-lod-generator`
and `opensa-lod-generator` open every `models/*.img` whole, and `vehicle-cutscene` reads `gta3.img` whole to
resolve txdp parents. The archive split is what answers that; this run is the measurement it starts from.

Peak RSS is worth watching rather than celebrating: 3.11 GB against a 1.24 GB source archive. Staging costs
paths, so the residue is the base buffer plus per-entry copies awaiting collection — a number that should
fall on its own once the base archive is read through an fd rather than `readFileSync`.

See [`edge-cases/converter-pipeline.md`](../../edge-cases/converter-pipeline.md) for the limits as measured
and [`restrictions/assets-and-data.md`](../../restrictions/assets-and-data.md) for the rule.
