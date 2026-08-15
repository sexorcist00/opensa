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

- [x] **0. The census, and the ceiling that decides the shape. DONE 2026-08-15.**
      **The archives, by extension**: `gta3.img` 16 316 entries — dff 12 964, txd 2 759, col 216, ipl 164,
      ifp 149, dat 64; `gta_int` 2 484; `player` 542; `cutscene` 634. **The IDE sections** that drive the
      classifier: `objs` 14 052, `peds` 276, `cars` 212, `tobj` 160, `2dfx` 97, `anim` 54, `weap` 50,
      `txdp` 38, `hier` 35.
      **`TOTAL_IMG_ARCHIVES` = 8, derived not remembered**: gta-reversed `Streaming.h` puts `ms_files` at
      `0x8E48D8` and the next static, `ms_bLoadingBigModel`, at `0x8E4A58` — `0x180` = 384 B over a
      `tStreamingFileDesc` the header size-asserts at `0x30` = 48 B. GTAMods corroborates the split (3
      hardcoded + 5 from `gta.dat`). The target spends **6** (gta3 / gta_int / player, plus stock `gta.dat`'s
      CARREC, SCRIPT, CUTSCENE) and **FLA does not lift it in this install** — its ini patches ID pools and
      handling; `IMG archive needs rebuilding` is error reporting, not a limit. Recorded in
      [`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md) and as
      a rule in [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md).
      **What that settles**: 2 free slots against three wanted archives (`vehicles.img` + one spill sibling +
      `peds.img`), so the ASI lift is a certainty rather than a contingency — see step 5.
      **Dropped from this step** (the user's call, 2026-08-15): researching what the game does when one name
      exists in two registered archives. The layout is built so it cannot happen, so the right answer is a
      GUARD, not a fact — step 2 refuses a duplicate instead of relying on precedence.
- [ ] **1. The classifier — pure, no I/O.** Entry name → bucket, from the IDE sections plus each row's txd
      column; non-model entries (`.ipl` / `.ifp` / `.dat` / `.col`) and anything unclaimed stay in `gta3.img`.
      Verification: every entry of the stock `gta3.img` classified with a per-bucket count; the UNCLAIMED
      list printed and its size recorded here (a classifier that quietly absorbs surprises is the failure
      mode). Tests: negative cases first — an entry no IDE declares, a name declared by two sections.
- [ ] **2. The splitter tool.** Emit the buckets, rewrite `gta.dat`'s `IMG` lines, leave `cutscene`/`player`/
      `gta_int` alone. **Uniqueness is a GUARD here, not an assumption**: one name may land in exactly one
      archive, and the tool fails naming both sides if it ever would not — that is what makes the precedence
      question unaskable rather than unanswered. Verification: entry bytes byte-identical to the source
      archive, the entry count conserved exactly (in == sum of out, no duplicates), and the run's wall clock +
      output sizes recorded.
- [ ] **3. The cap and the spill, in the shared writer.** `tool-kit` gains a bucket-aware write that opens
      `<name>.img`, and creates `<name>2.img` when the next entry would cross the cap; every installer routes
      through it. The cap is a named constant with its reason (Node's 2 GiB read ceiling), set below it with
      margin. Verification: a synthetic set that crosses the cap produces the sibling and loses nothing; the
      real vehicle set (3 077 354 628 B) produces its real bucket count; no output file exceeds the cap.
- [ ] **4. Wire it into pmb, before `mods`.** A new first stage, excludable like the rest. `checkImgIdBudgets`
      learns the bucket set instead of its four hard-coded names — an archive it does not know about is an
      under-count, and that is the silent direction. Verification: a full `sa` build completes end to end
      (the run that could not finish today), with per-stage timings and every archive's size recorded.
- [ ] **5. The field run — and the archive-table lift it will need.** Step 0 already says the layout does not
      fit stock: 2 free slots against 3 wanted archives. So this step is not "does it work?" but "what breaks
      first, and does everything ELSE work while we are one slot short?" — build with the peds bucket left in
      `gta3.img` (the shape that fits stock exactly, 8 of 8), boot, drive, and run the cutscene A/B that
      `asi/perfect-cutscene` plan 001 step 7 is waiting on. That isolates the layout from the ceiling.
      Verification: the game boots and streams from split archives, with the swept cutscene verdicts matched.
      **Then the lift** — raising `TOTAL_IMG_ARCHIVES` in our ASI — is the agreed next link and gets its own
      plan, not a step here. It is a limit **nothing else on the target owns**, which is the one-owner rule's
      precondition for us claiming it.

## What this plan may not do

- **Do not shape content down to the ceiling.** The 2 GiB wall is Node's, not the game's and not VER2's
  (`project-goals.md` directive 2). Dropping the 362 865 928 B of extra numbered txds the game does not read
  today is a separate, arguable saving — it is not a fix, and it must not be smuggled in as one.
- **Do not classify from a name list in code.** The bucket derives from what the asset's IDE row says
  (`restrictions/assets-and-data.md`). A hard-coded roster is a slot rule wearing a data rule's clothes.
- **Do not let an archive be added without the id-pool guard learning it** (step 4). The FLA pools are global
  and real on the target.
