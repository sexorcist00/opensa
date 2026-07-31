# Vehicle name contracts

Every NAME on this page carries behaviour. A file called something else is not read, a frame called
something else is not animated, a texture called something else is not recognised — and in almost every
case **nothing reports it**, because a mod that contributes nothing looks exactly like a mod that ships
nothing. This page is the one place to check before inventing a name, and the place to add one.

Two rules run through all of it:

1. **Derive from the asset before you reach for a name.** A tyre is found by its geometry (the material's
   mean radius), a pop-up headlight pod by the lamp faces inside it, chrome by bare grey + an env map — not
   by what any of them are called. A name contract is what is left when the asset cannot say it itself.
2. **Names are matched lowercased and trimmed.** Case and stray whitespace never decide anything.

To see what a given car actually gives the builder — frames, parts, hinges, the pop-up pod, and the two
traps below flagged by name — run `npx tsx scripts/debug/dump-vehicle-rig.ts <model|path/to.dff>`.

---

## 1. A vehicle mod folder (read by `vehicle-installer` at build time)

One folder = one vehicle. `<model>` is the game's model slot (`previon`, `zr350`, …) and everything else in
the build keys off it.

| Name | What it is |
| --- | --- |
| `<model>.dff` | The model. Its basename IS `<model>` — the folder name is free text and is never parsed. |
| `<model>.txd` | Its dictionary. |
| `<model><N>.txd` | Extra numbered dictionaries (`previon1.txd`); they ship into `gta3.img` alongside. |
| `<model>.settings.txt` | **Settings** — the car's data lines (below). |
| `features.txt` | **Features** — what the model can DO (below). Folder-scoped, not `<model>.features.txt`. |

- The settings file is found by its **`.settings.txt` suffix**, never by "the first `.txt` in the folder" —
  `features.txt` sorts before it and used to swallow it whole (the previon lost its entire data row that way).
- Both files are decoded by the encoding they were **saved** in: a BOM decides, and with no BOM the parity of
  the NUL bytes does (UTF-16 is what most Windows-authored mods ship). Read as UTF-8 a UTF-16 file parses to
  nothing at all, silently.

### `<model>.settings.txt` — the data lines

Blank-line-separated blocks, each classified by its **structure** and then validated with the real engine
parser, so order does not matter and an unrecognised block is dropped **with a warning naming the block**.

| Block | Merges into | Keyed by |
| --- | --- | --- |
| `id, model, txd, type, HANDLINGID, gameName, …` | `data/vehicles.ide` | model |
| `HANDLINGID  mass  turnMass  …` (~33 columns) | `data/handling.cfg` | the handling id, **not** the model |
| `model, p,s[, p,s …]` (numeric or `newN` refs) | `data/carcols.dat` | model |
| `R,G,B  # newN <name>` lines | `data/carcols.dat` `col` section | appended, `newN` resolved |
| `model, part, part, …` (word-only ids) | `data/carmods.dat` | model |

The handling id is the ide line's 5th column — a car may name a handling row that is not its own model name,
and the installer's `--strip` follows the same link.

### `features.txt` — what the model can do

One token per feature, whitespace/comma separated, `#` and `//` start a comment. Tokens are upper-cased.

| Token | Meaning |
| --- | --- |
| `UP/DOWN_LIGHTS` | The car has retractable ("pop-up") headlights. |

The vocabulary is the Modloader/IVF one, so mods already in the wild declare themselves correctly. Unknown
tokens are carried through and ignored — adding a feature later means teaching the converter one token, not
re-authoring the mods.

---

## 2. Built game data (written by the installer, read by the converter)

| Path | Contract |
| --- | --- |
| `data/vehicles.ide` | model, txd, type, handling id, wheel model id, **wheel scale [front, rear] = the wheel DIAMETER in metres** (not a multiplier). |
| `data/handling.cfg` | Rows keyed by the handling id above. |
| `data/carcols.dat`, `data/carmods.dat` | Keyed by model. `carmods` is parsed but not yet wired into the engine. |
| `data/vehicle-features.txt` | **Ours, not SA's.** `<model> <FEATURE>…`, one line per model, written from each mod's `features.txt`. Read by `opensa-pack` while baking that car — **build time only**; nothing reads it at runtime, so a change here needs a rebuild (`vehicle-installer --rebake`). |
| `data/vehicle-mods.txt` | **Ours, not SA's.** The mod-car ledger: one lowercased vehicle SLOT per line (`#` starts a comment; several names on one line are read as several), written by `vehicle-installer` for every slot a mod took over, sorted so a rebuild is byte-identical. **The only vehicle data file read at RUNTIME**, by video mode's car pick (096 D10) — nothing else in the game reads it. Written on EVERY install run, including an install with no vehicle mods: present-and-empty says "this build looked and found none", absent says "this build predates the ledger", and downstream both mean no preference. A `--rebake` MERGES into it (`--only <car>` adds that slot, it never rewrites the file to its own selection). **Misspell the name and the file is simply never found**: video mode stops preferring mod cars and picks uniformly from the stock roster — no warning, no other effect, because the fact it carries cannot be recovered any other way (mods are indistinguishable from stock once merged). |
| `models/generic/vehicle.txd` | Shared dictionary merged into every car, and the home of the plate rasters. Never deleted by the pack. |

---

## 3. DFF frames (the model's own contract)

### Structure

| Name | Role |
| --- | --- |
| `chassis` | The body mesh. `chassis_dummy` is the root the components hang under. |
| `<anything>_vlo` | The low-detail mesh shown past the vehicle LOD swap (`chassis_vlo`). |
| `wheel` | A single wheel atomic, instanced at every `wheel_*_dummy` (mirrored on the right). |
| `wheel_{l\|r}{f\|m\|b}_dummy` | Wheel hubs. `m` is the middle axle of a 3-axle truck. |
| `wheel_{lf\|rf\|lm\|rm\|lb\|rb}` | Per-corner wheel atomics (different front/rear wheels). A LONE corner with real dummies is treated as a mis-named shared wheel — several mods ship only `wheel_rf`. |
| `f_wheel_<mask>` | A container frame whose child atomics are the wheel sub-model (the wheel-mod convention). |
| `extra1` … `extraN` | Mutually-exclusive optional parts; SA shows at most one, and the pick is per SPAWN. |
| `misc_a` … `misc_h` | SA's generic moving components. A `misc_*` holding head-lamp faces is a **pop-up headlight pod**. |
| `ug_*` | Upgrade attachment points. Present in models, consumed by nothing yet. |

### Damageable components

`bonnet`, `boot`, `bump_front`, `bump_rear`, `wing_lf`, `wing_rf`, `windscreen`, `door_{lf|rf|lr|rr}` —
each as a `<part>_dummy` frame carrying a `<part>_ok` mesh and its `<part>_dam` twin.

- **The mesh hangs on the `*_dummy`; the `_ok`/`_dam` frame's own transform is DISCARDED.** That is the
  original's rule (`CVehicleModelInfo::PreprocessHierarchy` → `CollapseFramesCB` destroys those frames), and
  ignoring it threw a mod's doors clear of the car. Stock SA authors that transform as identity, so nothing
  in the stock fleet ever showed the difference.
- A door swings about its `*_dummy` frame's **own local Z**. A mod that turns a hinge frame ABOVE the dummy
  gets a scissor door for free, with no special case anywhere.
- The damage system names parts **without** the suffix: `door_lf`, `bonnet`.

### Dummies (frames with no mesh)

Every one is carried verbatim into the model. Consumed today:

| Name | Used for |
| --- | --- |
| `ped_frontseat` | The driver seat position. |
| `headlights` / `taillights` | Lamp anchors (SA authors ONE per end and mirrors it). |

Carried but not consumed yet: `exhaust`, `petrolcap`, `engine`, `ped_arm`, the second lamp dummies some
models author (`taillights2`), and anything else the author left.

---

## 4. Material and texture names

| Name | Meaning |
| --- | --- |
| `vehiclelights*` | The lamp atlas. A material on it whose colour is a marker IS a lamp: `(255,175,0)` / `(0,255,200)` = head, `(185,255,0)` / `(255,60,0)` = tail. The colours are metadata and are never rendered. |
| `carplate` | The plate's text strip — a generated 64×16 raster per car. |
| `carpback` | The plate's background quad — one of three static city designs. |
| `platecharset` | The glyph atlas, in `models/generic/vehicle.txd`. |
| `plateback1` / `2` / `3` | The city backgrounds: **SF / LV / LS**, in that order (measured; the reversed `eCarPlateType` agrees). |

Carcols paint markers are **colours, not names**: `(60,255,0)` primary, `(255,0,175)` secondary,
`(0,255,255)` tertiary, `(255,255,0)` quaternary.

**There is deliberately NO texture-name matching for the reflection class.** Chrome is decided by data (an
untextured neutral-grey material with an env map), glass by translucency, paint by a carcols marker. Mods
combine arbitrary texture names, so a name rule there produces false positives on whole fleets.

---

## 5. Converted output

| Name | What it is |
| --- | --- |
| `<model>.osm` | The converted model: a `DESC` fixture (JSON) + `GEOM` buffers + baked collision. Replaces `<model>.dff` in the archives. |
| `<model>.ostex` | Its baked dictionary — one texture array, carried as a section of the `.osm` (and a name the loader also accepts as a standalone asset). |

A field run reads the BUILT game dir and nothing else, so a name that only exists in `mods-src` or
`game-src` has no effect on what the game does.
