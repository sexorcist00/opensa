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
| `cleo/` (or `CLEO/`) | The mod's compiled CLEO scripts + sidecars (`.cs`, `.ini`, `.fxt`) — copied to the built game's `cleo/` (canonical lowercase, author-relative structure preserved), where the runtime discovers them at boot (plan 097/06); a `--rebake` re-copies them. **Misspelled (`celo/`, loose `.cs` beside the dff): not carried at all** — the vehicle installs fine, its script never runs, and the boot census line (`[cleo] N script(s)`) is the only place the absence shows. |

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
| `data/vehicle-mods.txt` | **Ours, not SA's.** The mod-car ledger: one lowercased vehicle SLOT per line (`#` starts a comment; several names on one line are read as several), written by `vehicle-installer` for every slot a mod took over, sorted so a rebuild is byte-identical. **The only vehicle data file read at RUNTIME**, by video mode's car pick (096 D10) — nothing else in the game reads it. **It is a SWITCH, not a preference** (D10 as revised 2026-08-03): if one line names a slot whose model the build actually carries, EVERY scene drives a mod car and no stock car appears; if no line does, every scene takes a stock car. Written on EVERY install run, including an install with no vehicle mods: present-and-empty says "this build looked and found none", absent says "this build predates the ledger", and downstream both mean the stock roster. A `--rebake` MERGES into it (`--only <car>` adds that slot, it never rewrites the file to its own selection). **Misspell the name and the file is simply never found**: video mode silently falls back to the stock roster — no warning, no other effect, because the fact it carries cannot be recovered any other way (mods are indistinguishable from stock once merged). The same silence covers a ledger whose every row names a slot this build has no `.osm` for, which is why video mode's boot line prints the count of DRIVABLE slots, not of ledger rows. |
| `models/generic/vehicle.txd` | Shared dictionary merged into every car, and the home of the plate rasters. Never deleted by the pack. |

---

## 3. DFF frames (the model's own contract)

### Structure

| Name | Role |
| --- | --- |
| `chassis` | The body mesh. `chassis_dummy` is the root the components hang under. |
| `<anything>_vlo` | The low-detail mesh shown past the vehicle LOD swap (`chassis_vlo`). |
| `wheel` | A single wheel atomic, instanced at every `wheel_*_dummy` (mirrored on the right). **A FLAT mesh (no extent along the axle) is a MARKER meaning "this model draws no SA wheels"** — the builder leaves it unscaled instead of fitting it to the ide diameter, so it stays invisible the way SA leaves it. The GTA 5 Rhino does this (its running gear is `wheel_big_*`/`track_*`); fitting it instead scaled a 2 cm triangle by 23.5 and swept six half-metre shards around with the wheels. The physics radius still comes from the ide, never from the marker. |
| `wheel_{l\|r}{f\|m\|b}_dummy` | Wheel hubs. `m` is the middle axle of a 3-axle truck. |
| `wheel_{lf\|rf\|lm\|rm\|lb\|rb}` | Per-corner wheel atomics (different front/rear wheels). A LONE corner with real dummies is treated as a mis-named shared wheel — several mods ship only `wheel_rf`. |
| `f_wheel_<mask>` | A container frame whose child atomics are the wheel sub-model (the wheel-mod convention). |
| `extra1` … `extraN` | Mutually-exclusive optional parts; SA shows at most one, and the pick is per SPAWN. |
| `misc_a` … `misc_h` | SA's generic moving components. A `misc_*` holding head-lamp faces is a **pop-up headlight pod**. |
| `ug_*` | Upgrade attachment points. Present in models, consumed by nothing yet. |

**CLEO scripts see these names too** (plan 097/05): `GetFrameFromName` resolves script part lookups
against the rig's part names verbatim (`misc_a`, `dvan_l`, `dmbus_r`…), and the CAutomobile carNode
reads (`CVehicle+0x648`) bind wheels to the **`wheel_*_dummy`** forms. A name the rig lacks yields a
null frame token — the script's own guard skips, SILENTLY by design (real CLEO would crash there);
the atlas-miss console lines report only UNKNOWN addresses, not missing frames. Two rig facts
currently limit this surface: the vehicle-optimizer DROPS empty parent frames (rhino's `misc_e`
track chain — `docs/hacks/cleo-frame-sibling-order.md`) and flattens parent links, so sibling walks
run in rig order. What that costs a script is measured in `docs/edge-cases/cleo-vm.md`: a script
anchored on a dummy does nothing at all, silently.

### Cutscene conversion (read by `vehicle-cutscene` at build time)

The converter (tool `vehicle-cutscene`, plan 002) rebuilds each `cs*` model from the mod's gameplay
DFF; these mod frame names decide what the CUTSCENE copy carries. Misspelling one is SILENT: the mesh
is still adopted (it rides the nearest carried ancestor un-animated) — what is lost is its animation
channel, exactly like the taxi's misnamed door (gate 7).

| Name | What the converter does |
| --- | --- |
| template part names (`chassis`, `door_lf_ok`…; bikes: `wheel_rear`, `chainset`, `pedal_l/r`, `handlebars`, `forks_front`, `wheel_front`; boats: `boat_hi`, `boat_rearflap_left/right`) | Matched by canonical name to the vanilla cutscene bone; the bone keeps the VANILLA local (the anims' bind pose) and an un-animated `_pv` shim absorbs the mod's placement delta. On bikes/boats the matched frame may be a meshless dummy — its subtree meshes ride the bone. |
| `<anything>_dam`, `<anything>_vlo` | Never carried into the cutscene copy. |
| `_[<year>]…` subtrees (`_[1991]:2`) | Year-variant ALTERNATIVES to base parts — never adopted (the taxi stacked three door sets). |
| `f_wheel_<mask>` | Wheel sub-model container (cars): the first atomic is the shared wheel; the container is never adopted as body parts. |
| `f_extras:<n>`, `f_class:<n>` | Variant containers. CARS: one MESH per container (field-frozen, gates 4+7). BIKES/BOATS: the first child SUBTREE with a mesh is adopted whole (handlebar sets carry brake levers/grips as sub-meshes), later children dropped. |
| `f_extras:<n>+` | Additive container (bikes/boats): every child kept — the MTB ships both wheel reflectors in one. |
| `<part>_ok`/`_dam` under its own `<part>_dummy` | The frame's transform is junk the game destroys — the dummy is the hinge; every OTHER mesh frame keeps its transform. |
| a mod mesh named EXACTLY like a vanilla cutscene frame (`door_lf_ok` glass under `door_lf_ok`) | Adopted with an `_ad` suffix (`door_lf_ok_ad`): anim binding is NOT first-match-only, so an un-renamed duplicate binds the channel too and double-transforms (plan 004 round 1 — floating door glass). The renamed mesh rides its parent bone; nothing is lost. |
| `carplate`, `carpback` (MATERIAL texture names) | A model wearing these placeholder quads gets a READABLE plate pair baked into its emitted `cs*.txd` (vehicle-cutscene plan 003) — own-TXD-first resolution overrides the placeholders the runtime never fills for cutscene objects. A mod shipping its OWN texture under these exact names gets ours instead (same look class); any other name is untouched. Models without the quads (the bike/boat mods) get no pair. |

### Tracked vehicles (`track_*` — read by our shipped `rhino-tracks.cs`)

A model carrying these names gets its tread and road wheels animated by the script we ship
(`cleo/scripts/rhino-tracks/`), on **any slot** — the script tests for the names, never for a model
id, so the mod may be installed anywhere and a new tracked vehicle needs no code.

| Name | Role |
| --- | --- |
| `track_1` … `track_12` | The tread FLIPBOOK: twelve authored states of the same belt. Exactly one is shown at a time, advancing one link per 1.5 deg of wheel roll and repeating every 18 deg. **`track_1` is the capability test** — a model without it is left completely alone. |
| `wheel_big_0`, `wheel_big_1` | Drive sprockets. Rolled by the reference wheel's own angle. |
| `wheel_small_1` … `wheel_small_8` | Road wheels. Rolled at **2x** the sprocket angle (they are half the diameter). |
| `wheel_rb_dummy` | The reference wheel the roll angle is read from (`m_forward`, via `m_aCarNodes[CAR_WHEEL_RB]`) — a standard hub name, no extra authoring. |

Every one of these must be a frame **with a mesh**: a dummy is not an addressable part (above), and
the script skips what it cannot resolve. Gaps are tolerated but visible — `track_7` missing means
the tread simply vanishes for that 1.5 deg of the cycle rather than crashing. The count is fixed at
twelve today; the arc per link is `18 / <count>`, so a model with a different link count needs the
script's `TRACK_LINKS` changed, not just renamed frames.

### Damageable components

`bonnet`, `boot`, `bump_front`, `bump_rear`, `wing_lf`, `wing_rf`, `windscreen`, `door_{lf|rf|lr|rr}` —
each as a `<part>_dummy` frame carrying a `<part>_ok` mesh and its `<part>_dam` twin.

- **The mesh hangs on the `*_dummy`; the `_ok`/`_dam` frame's own transform is DISCARDED.** That is the
  original's rule (`CVehicleModelInfo::PreprocessHierarchy` → `CollapseFramesCB` destroys those frames), and
  ignoring it threw a mod's doors clear of the car. Stock SA authors that transform as identity, so nothing
  in the stock fleet ever showed the difference.
- A door swings about its `*_dummy` frame's **own local Z**. A mod that turns a hinge frame ABOVE the dummy
  gets a scissor door for free, with no special case anywhere.
- **A door is its whole hinge SUBTREE, not one named mesh.** SA rotates the dummy's frame, so every atomic
  a mod authors under `door_*_dummy` — separate glass (`glass_lf_ok`), trim, whatever the exporter split —
  travels with the door. The builder records the subtree as the door's part roster (`VehicleDoor.parts`) and
  the swing rotates each member about the hinge. Misspell the glass out of the subtree (parent it to the
  chassis) and it silently stays behind when the door opens — the comet mod's authoring is what surfaced
  this (2026-08-04). Stock cars author one atomic per door, so their doors carry no roster.
- The damage system names parts **without** the suffix: `door_lf`, `bonnet`.
- **Which FRONT doors exist decides how the player boards (2026-08-05).** Entry and the exit chain pick
  among the sides whose `door_{lf|rf}` part the model actually carries: a model authored with only
  `door_rf` (the coach — a real bus boards through its one front door) is entered from EITHER side via
  that door, with the approach routed around the bumper, then the seat shuffle. A model with NO front
  door parts keeps the near-side behaviour (the hinge fallback). Misspelling a door name is SILENT and
  now changes boarding: `door_If` (capital i) reads as "this side has no door" and the player walks
  around to the other one — `dump-vehicle-rig.ts`'s articulation list is the check.

### Dummies (frames with no mesh)

Every one is carried verbatim into the model. Consumed today:

| Name | Used for |
| --- | --- |
| `ped_frontseat` | The driver seat position. |
| `headlights` / `taillights` | Lamp anchors (SA authors ONE per end and mirrors it). **At the model ORIGIN = this model has no lamp of that kind** — see below. |

**A lamp dummy at (0,0,0) means "no lamp here", and it is the only way to say it.** That is SA's own
convention, not ours: a missing dummy reads back as (0,0,0) from `CVehicleModelInfo::m_avDummyPos` and
`CVehicle::DoHeadLightBeam` tests exactly that (`if (pointModelSpace.IsZero()) return;`). Since plan
098/11 OpenSA honours it at BOTH ends — an absent or origin dummy emits no beam, no pool light and no
corona there — and there is no fallback: what the model does not author, the game does not light.

For a mod author this is the whole lever. A race car with no lamps zeroes both dummies (the hotring mod's
own author had already done it for `taillights`); a truck with no rear lamps zeroes just the tail. It
needs no engine change, no config line and no per-model rule, and it is what
`scripts/debug/zero-vehicle-dummy.ts` writes — a 12-byte edit to that one frame's position.

**Spelled wrong / left out:** a dummy the model simply does not carry behaves identically to a zeroed
one (no lamp at that end), so a typo in the frame name silently costs the car its lights on that side
rather than erroring. `scripts/debug/lamp-census.ts` is where that shows up — it prints, per model,
whether each lamp dummy is real, at the origin, or absent.

**The lamp MATERIAL is a different thing and does not gate the light.** Whether the lens glows (the
lit-twin swap and the emissive) keys on the `vehiclelights*` marker material; whether there IS a light
keys on the dummy. The stock `coach` proves they are independent: it carries no head lamp material at
all and still has working headlights.

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

**A material's UV-animation name must match a dict entry in the SAME DFF** (plan 099). The material's UV
Anim plugin names an entry of the clump's leading UVAnimDict (`f13d` on the ferris wheel's `Frames`
material); the converter binds the two by that name and the runtime plays the keyframes. Both names are
written by the exporter, so they normally agree — but a re-export that drops the dict, or a hand-edited
clump, leaves a reference to nothing. **When the name resolves to no entry, or to one with no keyframes,
the material renders STATIC and nothing is logged** — same fallback as the world lane, chosen because a
missing animation must not take a model out of the game. The symptom is a sign or a light strip frozen on
frame 0, which is exactly what the bug looks like before the animation ever worked, so check the dict
first: `npx tsx scripts/debug/dump-osm.ts <model>` prints the animations the built `.osm` actually carries
and the submesh each one drives. Only UV channel 0 is played; a mask naming more channels loses the rest.

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
