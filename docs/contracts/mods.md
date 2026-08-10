# Mod folder name contracts

What `mod-installer` looks for when it layers `mods-src/<game>/mods/*` onto a base game. Every name here
decides behaviour, and a name spelled otherwise is not an error — the file is simply copied somewhere the
game never reads, and **the mod does nothing, silently**. That has already cost one whole install
(`models/gta3img/` instead of `gta3_img/`).

Vehicle mods have their own folder shape: [vehicles.md](./vehicles.md).

---

## 1. The `--in` tree

One folder per mod, each an immediate subfolder of `--in`. The folder NAME is free text with one job:
**ordering**. Mods apply in numeric-aware alphabetical order (`1. Foo` < `2. Bar` < `10. Baz`), and **later
mods win** — the last one to write a file owns it.

A mod is applied in one of two shapes, decided by its contents, not by its name:

| Shape | Decided by | What happens |
| --- | --- | --- |
| **Path overlay** (default) | anything else | The mod mirrors the game tree from its own root; files overwrite by path. |
| **Modloader-style bake** | it carries a **loader `.txt`** — any `.txt` whose contents declare `IDE` / `IPL` / `COLFILE` paths | The folder LAYOUT is ignored entirely and every file is bucketed by its BARE NAME (below). |

---

## 2. Path-overlay conventions

### `gta3_img/`, `gta_int_img/`, `cutscene_img/`

A binary archive cannot be patched file-by-file, so a mod ships a folder instead: these merge into
`models/gta3.img`, `models/gta_int.img` and `models/cutscene.img`.

- **Top level of the mod only, and the name must match exactly.** `models/gta3img/` or a nested
  `models/gta3_img/` is copied verbatim as loose files the game never reads.
- **Place an asset in the archive its STOCK copy lives in.** An interior model belongs in `gta_int_img/`; put
  it in `gta3_img/` and it shadows nothing.
- Loose files inside become entries by name — added if new, replacing an existing entry otherwise.
- **A `.col` is a LIBRARY, and replacing it DELETES every model it does not carry.** `laxref.col` holds 148
  named collision models; a mod shipping its own copy to change one bench replaces the entry whole, and the
  other 147 lose their collision. The objects still exist — they are simply placed with nothing to stand on,
  which shows in-game as walking through a bench, never as an error. **Ship the whole library, not your
  edit of it**, and if you started from another mod's copy check that it was whole first. Same shape as
  `Remove original/`, except nothing declared the intent.
  *What catches you:* since 2026-08-10 the installer prints
  `mod-installer: <name>.col replaced — N collision model(s) LOST: …` naming the models, so the loss is at
  least loud at build time. It is still a WARNING — the replacement wins, per this contract. Nothing catches
  it at runtime unless FLA's optional error reporting is on, which is how the first case was found: mod 60
  had dropped `ferseat01_LAx`, and the real game said "model ID 3752 does not have loaded collision" months
  after the install.
- **`Remove original/`** (also `Remove originals`, `remove-original`, …): the file NAMES inside are DELETED
  from the archive. The contents are irrelevant — mods ship the retired originals for reference.
- A subfolder holding PNGs is a **texture folder for an archive-internal `<folder>.txd`** (below).
- Any other subfolder is organisational and is recursed — real packs ship `gta3_img/LV/…` layouts.
- `<name>.ipl.merge` inside an IMG folder EDITS the named binary stream entry instead of replacing it; those
  run last, after every data merge has rebased the streams.

### Texture folders: a folder named like a `.txd`, holding PNGs

**A directory whose sibling `<dir>.txd` exists in the install is a texture folder**: its PNGs merge INTO that
dictionary instead of being copied as files.

```
models/generic/vehicle/carplate.png     →  merges into models/generic/vehicle.txd
models/particle.txd/particleskid.png    →  the same file — the extension on the FOLDER is accepted too
gta3_img/previon/remap.png              →  merges into the previon.txd ENTRY inside gta3.img
```

- The texture NAME is the PNG's basename, matched case-insensitively: an existing texture of that name is
  **replaced**, a new one is **added**. Every other texture in the dictionary is left untouched — this is a
  merge, never a rewrite.
- Format is chosen from the image: **DXT5 when it carries real alpha, DXT1 when it does not**. PNGs must be
  8-bit RGB/RGBA and non-interlaced.
- Within a mod, files are copied BEFORE subfolders, so a `.txd` the same mod also ships is in place first and
  gets patched rather than lost.
- **Both spellings of the folder name work** — `vehicle/` and `vehicle.txd/` target `vehicle.txd`. Authors
  write both, and until 2026-07-29 the second one was not a wrong-target bug but a BUILD KILLER: the folder
  missed the `<dir>.txd` test (it looked for `particle.txd.txd`), fell through to `mkdir`, and hit the stock
  file with a bare `EEXIST: file already exists, mkdir …/models/particle.txd` that named neither the mod nor
  the rule.
- The texture NAME stored is the PNG's own spelling; the MATCH against the dictionary is case-insensitive.
- Inside an IMG folder, a texture folder whose `.txd` entry is missing is a **loud warning**, not a silent
  skip. **The dictionary is never CREATED from the PNGs** — the folder patches what is already there, so a
  mod that ships the PNGs of a WHOLE dictionary must ship the `.txd` too or lose every one of its textures.
  When that happens, build the file from the folder with `scripts/debug/txd-from-pngs.ts` (see
  [`docs/debug/README.md`](../debug/README.md)) — that is what the warning is telling you to do. It is a real
  shape: "52. Abandoned Cars" shipped `gta3_img/philss/` as 22 loose PNGs while "0. Map Fixes Pack" repointed
  `cuntwjunk04` at a `philss` dictionary nobody shipped, and those 22 PNGs were exactly that model's 22
  textures.
- On the LOOSE side the folder is **warned about and still copied** as a directory, PNGs and all: nothing
  there can create the dictionary, the stray files are harmless (the game ignores them), and a later rule may
  well make the folder itself valid. The warning is the part that matters — it names the missing `.txd`.

### `<target>.merge` — edit a data file instead of replacing it

A mod ships `multiobj.ide.merge` next to the game path it wants to change. Directives apply to the CURRENT
state of the target, so merge-mods stack with each other and with earlier whole-file replacements:

```
remove from "objs":
1682, ap_radar1_01, ap_misc1bit, 100, 2097152

add to "anim":
1682, ap_radar1_01, ap_misc1bit, radar, 600, 0

replace in "inst":
- 710, vgs_palm01, 0, 2110.67, -977.73, 66.13, 0, 0, 0, 1, -1
+ 710, vgs_palm01, 0, 2110.67, -977.73, -300.0, 0, 0, 0, 1, -1
```

- `.ide` targets: `remove` deletes by ID, `add` appends (creating the section when absent) and replaces a
  same-ID entry.
- `.ipl` targets: index-safe only, because row ORDER is data (binary streams and `lod` columns address rows
  by index). `add` appends before the section's `end`, `replace` swaps in place, `remove` matches the whole
  whitespace-normalised line and — for `inst` — rebases every surviving `lod` link and reports the removed
  indexes so the area's binary streams are patched the same way.
- A `.merge` whose target does not exist in the install is a hard error, not a skip.
- `#` and `//` comments are ignored.

---

## 3. Modloader-style bake

Triggered by a loader `.txt` (a `Loader.txt`-style file declaring `IDE`/`IPL`/`COLFILE` paths). The mod's own
folder layout stops mattering; every file is bucketed by bare name:

| Bare name | Where it goes |
| --- | --- |
| `.dff` `.txd` `.col` `.ifp`, `*_stream<N>.ipl` | Injected into `models/gta3.img` **only** — an asset whose stock home is `gta_int.img` lands in the wrong archive and shadows nothing. |
| `object.dat`, `procobj.dat` | Merged ADDITIVELY, row by row (keyed by model / by surface+model). |
| `.ide`, text `.ipl`, other `.dat` | Written to disk: over the stock file with that bare name, else to the path the loader declared. |
| the loader `.txt` itself | Its `IDE`/`IPL` lines are appended to `data/gta.dat` (canonicalised to the stock `DATA\MAPS\…` spelling); `COLFILE` is dropped — col rides in the archive. |
| `Remove original/` (any depth) | The file NAMES retire `gta3.img` entries; contents are never injected. |
| a `cleo/`/`CLEO/` dir (any depth, any extension inside), loose `.cs`/`.ini`/`.fxt` | Copied to `<out>/cleo/…` — the dir's author-relative structure preserved, loose files by bare name — with a log line per file. A misspelled dir (`cleo2/`) is NOT a cleo dir: its `.cs`/`.ini`/`.fxt` still land via the loose-extension rule, other extensions are dropped as before. |
| `*.settings.txt`, prose `.txt` | Ignored by the map baker. Vehicle settings belong to a vehicle mod — see [vehicles.md](./vehicles.md). |

Loader and data files are read **BOM-aware** (UTF-16 is what Notepad writes); the `.merge` and IPL/IDE
readers on the overlay path still assume UTF-8.

---

## 4. CLEO scripts (`cleo/` — plan 097; the runtime reads these, not the baker)

The RUNTIME discovers compiled scripts at boot from the VFS key prefix **`cleo/` + `.cs`** (keys are
lowercased by every loader). The installers place them there (plan 097/06): mod-installer's bake
buckets CLEO content to `<out>/cleo/` (overlay mods normalise a top-level `CLEO/` → `cleo/`), and
vehicle-installer carries a vehicle mod's `cleo/` subfolder — see section 3 and
[vehicles.md](./vehicles.md).

| Name | Meaning | Misspelled → |
| --- | --- | --- |
| `cleo/<name>.cs` | Decoded and run as a script thread at boot (capped by `config.cleo.maxScripts`; census line `[cleo] N script(s)`). The local/http-dir partition ALSO pre-decodes these to select script-referenced models into the VFS (`cleoModelRefs`). | **Silently not discovered** — wrong folder or extension means no census entry and no model selection. The census line is the check: count your scripts. |
| a broken/foreign `.cs` | Skipped WITH a console line (`[cleo] … failed to decode`); the other scripts still run. | reports itself |
| the mod's `.ide` | Must ALSO be LISTED in `data/gta.dat` (`IDE DATA\MAPS\….ide`) — the runtime id→name resolver follows gta.dat, while the partition scans every `data/**/*.ide`. | Models reach the VFS but ids resolve to nothing: `[cleo] model id N resolves to nothing` (the 04 field lesson — reports itself) |
| `<name>.opensa-only.cs` (SDK-authored artifacts, `cleo/sdk` plan 003) | The `@opensa/cleo-sdk` build embeds the script's declared target in the filename: a plain `<name>.cs` passed the dual-target whitelist (runs under plain real CLEO 4 on SA 1.0 US AND our VM); `<name>.opensa-only.cs` uses opcodes only our VM serves. Our runtime treats both as ordinary scripts. | Dropping the suffix by renaming does NOT make the script portable: on real SA it faults at the first unknown opcode (real CLEO's failure, loud). The suffix is information, not a switch. |

---

## 5. What is NOT a contract

- **The mod folder's name** — ordering only. Renaming a mod cannot change what it does.
- **The path a Modloader-style mod uses internally** — bare names decide everything there.
- **A texture's format in the PNG folder** — it comes from the image's own alpha, not from a naming scheme.

---

## 6. Adding a convention

When a new folder/file name starts meaning something, it goes here in the same change, with what happens when
it is misspelled. That last part is the point: nearly every rule on this page exists because some spelling of
it once passed silently. Anything that reports itself needs a line here far less than something that does not.
