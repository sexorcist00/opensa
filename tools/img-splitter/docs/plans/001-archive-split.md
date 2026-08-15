# 001 — Split `models/*.img` into typed, size-bounded archives

Give every kind of game content its own archive, and give the writer a ceiling it cannot cross, so no stage
ever produces a file the next stage cannot open. The design this implements is
[`docs/architecture/img-archive-layout.md`](../../../../docs/architecture/img-archive-layout.md); read it
first — the WHY is there, the HOW is here.

## Why now (measured 2026-08-15)

The `sa` build died mid-`vehicles` at 2 168 825 856 B. That specific failure is fixed (`a1a1217c`: one
archive open, one streamed write per run), and the fix exposed the real shape of the problem — the stage now
finishes in 6.13 s and emits **4 268 185 600 B**, which `readFileSync` refuses with `ERR_FS_FILE_TOO_LARGE`.
Numbers: [`benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md`](../../../../docs/benchmarks/tools/2026-08-15-vehicle-installer-batched-img.md).

So the vehicles stage is unblocked and everything behind it is not: `sa-lod-generator` and
`opensa-lod-generator` open every `models/*.img` whole, and `vehicle-cutscene` reads `gta3.img` whole to
resolve txdp parents. **71 call sites across 53 files** read archives into one buffer.

This also parks `asi/perfect-cutscene` plan 001 step 7's field run, which needs a pipeline build that
completes.

## Steps

Every step ends with its verification; a step without recorded numbers is unfinished.

- [ ] **0. The census, and the two things that must be read rather than remembered.**
      Two facts are already measured and go in as the starting table: the stock archives by extension
      (`gta3.img` 16 316 entries — dff 12 964, txd 2 759, col 216, ipl 164, ifp 149, dat 64; `gta_int` 2 484;
      `player` 542; `cutscene` 634) and the IDE sections that will drive the classifier (`objs` 14 052,
      `peds` 276, `cars` 212, `tobj` 160, `2dfx` 97, `anim` 54, `weap` 50, `txdp` 38, `hier` 35).
      What is NOT measured and may not be assumed:
      1. **How many archives SA can register** — a fixed-size table; read it out of the accepted exe or
         gta-reversed, and find out whether FLA already moves it (`restrictions/sa-target.md`: exactly ONE
         plugin owns a limit). The game already runs six.
      2. **Precedence when one name exists in two registered archives.** The layout is designed so this is
         never exercised, but the answer decides how loudly the splitter must refuse a duplicate.
      Verification: both answers written into this plan with their source (address / file / line), and the
      census tables filled in.
- [ ] **1. The classifier — pure, no I/O.** Entry name → bucket, from the IDE sections plus each row's txd
      column; non-model entries (`.ipl` / `.ifp` / `.dat` / `.col`) and anything unclaimed stay in `gta3.img`.
      Verification: every entry of the stock `gta3.img` classified with a per-bucket count; the UNCLAIMED
      list printed and its size recorded here (a classifier that quietly absorbs surprises is the failure
      mode). Tests: negative cases first — an entry no IDE declares, a name declared by two sections.
- [ ] **2. The splitter tool.** Emit the buckets, rewrite `gta.dat`'s `IMG` lines, leave `cutscene`/`player`/
      `gta_int` alone. Verification: entry bytes byte-identical to the source archive, the entry count
      conserved exactly (in == sum of out, no duplicates), and the run's wall clock + output sizes recorded.
- [ ] **3. The cap and the spill, in the shared writer.** `tool-kit` gains a bucket-aware write that opens
      `<name>.img`, and creates `<name>2.img` when the next entry would cross the cap; every installer routes
      through it. The cap is a named constant with its reason (Node's 2 GiB read ceiling), set below it with
      margin. Verification: a synthetic set that crosses the cap produces the sibling and loses nothing; the
      real vehicle set (3 077 354 628 B) produces its real bucket count; no output file exceeds the cap.
- [ ] **4. Wire it into pmb, before `mods`.** A new first stage, excludable like the rest. `checkImgIdBudgets`
      learns the bucket set instead of its four hard-coded names — an archive it does not know about is an
      under-count, and that is the silent direction. Verification: a full `sa` build completes end to end
      (the run that could not finish today), with per-stage timings and every archive's size recorded.
- [ ] **5. The field run.** Does the real game boot, stream and play from the split archives? This is where
      step 0's first unknown gets its answer in practice. Verification: boot, drive, and the cutscene A/B
      that plan 001 step 7 is waiting on. **If it falls over here, that is not a defeat of the design** — it
      is the trigger for the ASI work (lift the archive table, in `perfect-map.asi` or beside it), which is
      the agreed next link and not part of this plan.

## What this plan may not do

- **Do not shape content down to the ceiling.** The 2 GiB wall is Node's, not the game's and not VER2's
  (`project-goals.md` directive 2). Dropping the 362 865 928 B of extra numbered txds the game does not read
  today is a separate, arguable saving — it is not a fix, and it must not be smuggled in as one.
- **Do not classify from a name list in code.** The bucket derives from what the asset's IDE row says
  (`restrictions/assets-and-data.md`). A hard-coded roster is a slot rule wearing a data rule's clothes.
- **Do not let an archive be added without the id-pool guard learning it** (step 4). The FLA pools are global
  and real on the target.
