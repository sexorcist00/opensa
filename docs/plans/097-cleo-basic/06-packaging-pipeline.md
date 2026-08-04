# 097/06 — Packaging & pipeline: CLEO mods ship through the normal build

Closes the data-loss hole the recon found and makes the whole corpus travel `mods-src → pmb →
build/<game>/opensa → fetch pack` with no hand-placing. Field checkpoint 3: **a full build of a game
with all 7 mods in `mods-src` runs everything from the built dir AND from the fetch pack.**

## The holes (recon, 2026-08-04)

1. **mod-installer BAKE path silently deletes `.cs`/`.ini`/`.fxt`** — they fall off the end of
   `scanModloaderMod`'s bucket chain (`tools/mod-installer/src/bake-mod.ts:114-157`) with no log, and
   the two class-A target mods are exactly bake-shaped (`data/Loader.txt` + `gta3_img/`). The overlay
   path already copies them verbatim (generic recursive copy, `apply-mod.ts:77-120`) — two behaviours
   for the same content.
2. **vehicle-installer never looks inside a mod's `cleo/` subfolder** — `applyVehicle` reads depth-1
   only (`apply-vehicle.ts:44`) and copies nothing; `rebake` likewise. Class B/C mods (dff + txd +
   settings.txt + `cleo/`) lose their scripts.
3. **Case**: fetch-pack and the local loader lowercase VFS keys; the overlay copy preserves author
   case (`CLEO/` vs `cleo/`). The canonical on-disk spelling must be picked once.

## Decisions

1. **Canonical layout: lowercase `cleo/` at the game-dir root**, scripts + their sidecar files
   (`.ini`, `.fxt`) as loose files under it, author-relative structure preserved
   (`cleo/cleo_text/x.fxt` stays a path, no bare-name flattening — scripts reference sidecars by
   relative path, e.g. `0AF0` reads `cleo\Car Left Door.ini`). Installers normalise the folder name
   to lowercase on write.
2. **mod-installer bake path gains CLEO buckets**: `.cs`/`.ini`/`.fxt` (and files under a `cleo/` or
   `CLEO/` dir regardless of extension) → copied to `<out>/cleo/<relative path>`, with a log line per
   file (the silent-drop era ends loudly). The bake test extends: `readme.txt` still dropped, `.cs`
   kept. Overlay path: normalise `CLEO/` → `cleo/` on copy, behaviour otherwise unchanged.
3. **vehicle-installer carries the `cleo/` subfolder** of a vehicle mod into `<out>/cleo/` (same
   normalisation); `--rebake` re-copies it (scripts may have changed with the mod). The `.ini`
   sidecar rides along.
4. **Contracts updated in the same change** (the name-carries-behaviour rule): the bake table row in
   `docs/contracts/mods.md` flips from "ignored" to the bucket description + what happens on
   misspelling (`cleo2/` → still dropped, loudly listed); a new `cleo/` section in
   `docs/contracts/vehicles.md` (a vehicle mod's scripts folder). `tools/mod-installer/readme.md` and
   the bake plan docs lose their "CLEO ignored" lines.
5. **Runtime discovery stays `vfs.names`** (recon: complete in all three loaders; all chunks unzip at
   boot; `cleo/…` lands in the `others` fetch group). First consumer of `names` — add the prefix
   filter as a small helper where the host already lives, not a new VFS API. Script-relative file IO
   (`0AF0` ini reads) resolves `cleo\X.ini` → `cleo/x.ini` against the VFS (backslashes, case).
6. **Config finalised**: `Config.cleo.enabled` stays default-OFF; the per-game switch (which games
   ship scripts) is simply whether the build's `cleo/` dir has content. The F2 row (plan 07) is the
   runtime toggle. The default flips to ON only at chain close-out with the field verdict recorded.
7. **Pack sanity**: fetch-pack slices/pruning untouched (`.cs` are tiny); the standing pack checks
   apply (never re-pack a pack output; sanity-check cell count/size against the known baseline).

## Subtasks

- [ ] mod-installer: bake buckets + normalisation + log lines + tests (bake-shaped CLEO mod keeps
      scripts; prose `.txt` still dropped; `gta3_img/` handling untouched).
- [ ] vehicle-installer: `cleo/` carry + rebake behaviour + tests.
- [ ] Contracts + tool readmes updated (decision 4) — same change as the code.
- [ ] Host: prefix enumeration helper + script-relative path resolution (`0AF0`) + tests.
- [ ] Move the 7 corpus mods into `mods-src/<game>/mods/` slots (user call on which game(s));
      full pmb build; verify `build/<game>/opensa/cleo/` contents match the corpus.
- [ ] **Field checkpoint 3**: the built game runs all supported behaviours from `build/<game>/opensa`
      (the field-run rule: the built dir and NOTHING else), then the same from a fetch pack via the
      static server. Boot census line lists the script count; numbers into the ledger.

## Verification

- A bake-shaped CLEO mod and a vehicle CLEO mod both survive `pmb` end-to-end (unit + the field
  checkpoint); the misspelling case is loud; fetch and local loaders both discover the same script
  set.

## Ledger

_(files carried per mod, build sizes before/after, checkpoint 3 record, which game hosts the corpus)_
