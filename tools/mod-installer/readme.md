# @opensa/mod-installer

Layer GTA-SA **mod folders** onto a base game into a single drop-in `--out`. Copy the game, then apply each mod on
top in numeric-aware alphabetical order — plain files overwrite, `gta3_img/`/`gta_int_img/`/`cutscene_img/` loose entries merge into `gta3.img`/`gta_int.img`/`cutscene.img`.

```sh
tsx tools/mod-installer/src/cli.ts --game ./game-src/original --in ./mods --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …)
- `--in` — folder of mods; each immediate subfolder is a mod, mirroring the game tree:
  ```
  mods/
    a-trees/   { data/  models/  gta3_img/ }  # gta3_img/ = loose IMG entries (gta_int_img/ → gta_int.img, cutscene_img/ → cutscene.img)
    b-roads/   { data/ }
  ```
- `--out` — output install dir (**wiped + rebuilt** each run)

## How it applies

1. `--out` is wiped, then the `--game` tree is copied in (the base).
2. Mod subfolders of `--in` are sorted **numeric-aware** alphabetical (`1. x`, `2. y`, `10. z` — the number prefix is the apply priority; later mods overwrite earlier ones) and
   applied in order; a later mod wins on a conflict.
3. Per mod, one of two modes:
   - **Modloader mod** (its subtree carries a `loader.txt`-style file with `IDE`/`IPL`/`COLFILE` directives) — it is
     **baked** (see below).
   - A baked IDE that **redefines an id** (e.g. moving a stock `objs` def into `anim` — Animal Statues
     Remastered animates two stock statues this way) WINS: the older definition is stripped from every other
     `.ide` in the install (`… id definition(s) … superseded` in the log). The real modloader merges IDE
     lines by id at runtime; baked without this, both definitions load and duplicate model-info ids corrupt
     SA's heap during the data load (crash right after `shopping.dat`).
   - Loader paths pointing **outside `data/`** (the `modloader\<Mod Name>\file.ipl` convention some mods
     ship) are re-homed to `DATA\MAPS\<basename>` — both the `gta.dat` line and the file destination. Baked
     verbatim they'd create a literal `modloader/` dir: dead weight in the opensa pack and a DOUBLE load on a
     real SA running modloader.asi.
   - **Plain mod** (no loader) — **overlay**: copy every top-level entry except the IMG folders over `--out` (overwrites
     matching files, keeps the rest), then merge the mod's `gta3_img/` / `gta_int_img/` / `cutscene_img/` loose files into the matching
     `--out/models/*.img` (add or replace by name). A PNG folder beside a loose `<name>.txd` merges into that TXD (see below).
     Inside an `*_img/` folder, subfolders work too (plan 009): a subfolder WITH PNGs merges them into the IMG entry
     `<folder>.txd` (loud warning if the entry is missing); any other subfolder is organisational — its files are
     collected recursively by bare name (`gta3_img/LV/x.dff` lands like `gta3_img/x.dff`).

Each mod applies onto the **accumulated** `--out`, so several mods that touch different files (or different
textures / different `gta3.img` entries) all coexist; only when two mods change the **same** item does the later
one win. The `*_img/` folder is a generic "loose IMG entries" convention — a binary `.img` can't be patched file-by-file,
so a mod expresses "add/replace these entries" as a folder; any source (the LOD tools, hand-built mods, …) can ship
one. A **`Remove original/` subfolder** inside an IMG folder DELETES its file names from the target archive (the
contents are irrelevant — mods ship the retired originals for reference; a missing entry warns). The same
convention works inside a Modloader-style mod (any `Remove original/` dir → names deleted from `gta3.img`,
never injected) — the rotating-ferris-wheel pattern: retire the stock models a runtime script replaces.

**`*.merge` data edits.** A mod that needs to EDIT a stock data file (not replace it) ships `<target>.merge`
at the target's game path — e.g. `data/maps/generic/multiobj.ide.merge`. Directives apply to the CURRENT
`--out` state (after earlier mods), so merge-mods stack and never clobber other mods' lines:

```
remove from "objs":
1682, ap_radar1_01, ap_misc1bit, 100, 2097152    # matched by ID; full line kept as documentation

add to "anim":
1682, ap_radar1_01, ap_misc1bit, radar, 600, 0
```

`remove` deletes by ID inside the named section (byte-matching would break on float reformatting); `add`
appends to the section (created when absent) and replaces a same-ID entry. A missing remove-ID warns and
continues; a malformed directive or an entry outside one fails the install. Applied after the mod's file
overlay, so a target the mod also ships is in place first. Full spec + rationale:
[docs/plans/006-merge-data-edits.md](docs/plans/006-merge-data-edits.md). (The long-time example, the
"Animated Radars" mod moving IDE id 1682 from `objs` to `anim` via `multiobj.ide.merge`, was deleted from
the mod set on 2026-07-23 — the mechanism is unchanged.)

**`.ipl` merge targets** (plans 007/008) use different, ORDER-AWARE semantics — inst IDs repeat and row order
is data (binary streams + `lod` columns reference rows by index): `replace in "inst":` swaps a row in place
via `-`/`+` full-line pairs; `add to` appends verbatim before the section `end`; `remove from "inst"`
performs the full REBASE a mod author does by hand — every surviving row's `lod` above the removed index is
decremented (orphaned text link → error) AND the area's `<base>_streamN.ipl` entries in `gta3.img` are
lod-patched the same way, byte-in-place (a stream instance pointing AT the removed row is unlinked with a
warning); `remove from` other sections (`occl`, …) matches the full line.

**Binary stream merges** (plan 008): `gta3_img/<name>.ipl.merge` EDITS the named stream entry instead of
replacing it — same grammar, rows are the binary INST fields (`id, interior, x, y, z, rx, ry, rz, rw, lod`),
matched canonically. `add` appends, `remove` deletes (stream rows are never index-referenced), `replace`
swaps; the entry is rebuilt with its CARS (parked cars) block carried over. Stream merges apply AFTER the
mod's data merges, so their rows live in the final (post-rebase) index space.

`merge-gen` (`src/merge-gen.ts` — library + CLI) converts a whole-file stock replacement (or a whole stream
entry) into the equivalent `.merge`: iterative remove-simulation collapses the author's hand-made rebase
edits into plain removes; mid-section inserts are relocated to appends with their lod links remapped;
float/quaternion re-export noise is canonicalized away. Everything gates on a roundtrip (semantic link
equivalence for inst). Real examples: `0. Map Fixes Pack` + `5. SA Xbox Map Features` — fully converted, no
whole-file data or stream replacements left; their 27 colliding stream files now stack instead of last-wins.
Specs: [docs/plans/007-ipl-merge-level1.md](docs/plans/007-ipl-merge-level1.md) ·
[docs/plans/008-ipl-merge-level2.md](docs/plans/008-ipl-merge-level2.md).

A guard refuses to wipe a dangerous `--out` (the filesystem root, or a path that is/contains `--game` / `--in`).

## Baking Modloader mods

A **Modloader-style** mod (a `loader.txt`/`Loader.txt`/`to gta.dat.txt` — any `.txt` carrying `IDE`/`IPL`/`COLFILE`
directives — plus files scattered anywhere in its tree) is **baked** into a flat, stock-loadable `--out` — the
on-disk equivalent of what `@opensa/modloader` does at runtime (whose pure merge logic it reuses). Per such mod:

- the loader's `IDE`/`IPL` lines are appended to `--out/data/gta.dat` (deduped, canonicalised to the stock
  `DATA\MAPS\…` style — backslashes + uppercase directory, filename as-authored);
- each `.ide`/text `.ipl` is written to disk — **overwriting the stock file** with that bare name if one exists
  (e.g. a modified `LAn.ide`), else the **loader-declared path** (a new `reLIT.ide`);
- `object.dat`/`procobj.dat` are **additively merged** onto the stock (other `.dat` overwrite);
- every `.dff`/`.txd`/`.col`/`.ifp` (and `_streamN.ipl`) is **injected into `--out/models/gta3.img` by bare name**
  (`COLFILE` is dropped — SA auto-discovers the embedded `.col`);
- UTF-16 loaders are read BOM-aware; prose `.txt` is ignored. CLEO content (a `cleo/`/`CLEO/` dir +
  loose `.cs`/`.ini`/`.fxt`) is carried to `<out>/cleo/` with a log line per file (plan 097/06);
  overlay mods get a top-level `CLEO/` normalised to `cleo/`.

Folder names are irrelevant (files match by bare name). Note: injecting a large model bundle bloats `gta3.img` —
baking trades disk size for not needing a runtime loader. See
[`docs/plans/004-bake-modloader-mods.md`](./docs/plans/004-bake-modloader-mods.md).

## Texture folders → loose `.txd` (and IMG-internal `.txd`)

A mod can patch a **loose** `.txd` (a `.txd` file on disk, e.g. `models/particle.txd`, `models/generic/vehicle.txd`)
by shipping a **folder of PNGs** in its place. If a mod directory's sibling
`<dir>.txd` already exists in `--out`, the folder is **not copied** — instead each `<name>.png` inside becomes a
texture named `<name>`, **replacing** the same-named texture or **adding** a new one (every other texture is left
untouched). Works at any depth.

```
mod/models/generic/vehicle/   → merges into  out/models/generic/vehicle.txd
  stock.png    (replaces the existing `stock` texture)
  decal.png    (adds a new `decal` texture)
```

The same convention reaches **inside the IMG archives** (plan 009): a PNG subfolder inside `gta3_img/` (or
`gta_int_img/`/`cutscene_img/`) merges into the IMG ENTRY `<folder>.txd` — e.g.
`gta3_img/philss/cap_up.png` patches the `cap_up` texture into `gta3.img : philss.txd`. Applied after the
mod's own file entries — a mod shipping BOTH `<txd>.txd` and a `<txd>/` folder gets the PNGs merged into
its OWN txd, not the stock one. A folder with no matching entry warns loudly. Author invariant: ship the
PNG fix in a mod NOT EARLIER than the last mod shipping that `<txd>.txd` wholesale.

Encoding follows the SA texture conventions: **DXT5** when a PNG has real alpha, else **DXT1**, with a full mip
chain — so alpha, mipmaps and compression are all handled. PNGs must be 8-bit RGB/RGBA. (The `.txd` must already
exist; mod-installer patches it, it doesn't create new dictionaries.)
