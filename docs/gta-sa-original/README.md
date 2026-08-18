# The original GTA:SA — the game we import from and ship into

Facts about **Rockstar's game and the real install we target**, kept apart from everything describing OpenSA.
The rest of `docs/` answers "what does our engine/pipeline do"; this folder answers **"what is the original,
and what is actually running on the machine our output lands on"**.

The separation matters because the two are constantly confused in planning. A 2004 ceiling is a fact about
the original; whether we have to design around it is a fact about the install. Plan 07 spent a fortnight
organised around a limit the target install had already set to `unlimited` — that is the mistake this folder
exists to prevent.

## The files

| File | Subject |
| --- | --- |
| [reference-install-config.md](reference-install-config.md) | **The verbatim capture** of that install — exe fingerprint, every plugin, both adjuster inis, our ASI log, the installed mods. Written to survive the deletion of the `NO_COMMIT/` copy |
| [reference-install.md](reference-install.md) | **The declared baseline install** (`NO_COMMIT/gta_sa`, 2026-08-07): which plugins own which limits, which stock ceilings it lifts and which it does not, and the numbers it actually runs (72 914 permanent text rows, a 9 627-row IPL file) |
| [img-archive-limit.md](img-archive-limit.md) | **The 8-archive ceiling and how it is lifted** (2026-08-15): it has TWO halves — `CStreaming::ms_files` (derived: 8 slots, `0x8E48D8`) and the CdStream handle tables — plus the mechanism read out of `SimpleLimitAdjuster_IMGfiles.asi`: relocate the table, then rewrite the 4-byte OPERANDS of the 14 instructions that referenced it, and probe `CdStreamRead` for an existing `0xE9` hook. What we take from it and what we refuse (it patches blind; our SDK verifies). **Not needed today** — the shipped layout fits the stock 8 exactly; the deferred task and its trigger are [`in-reserve/img-archive-limit-lift.md`](../in-reserve/img-archive-limit-lift.md) |
| [procedural-objects.md](procedural-objects.md) | **What `procobj.dat`'s columns mean** (recovered 2026-08-09): SPACING is a LENGTH (`area / spacing²`, and the file's own header comment says otherwise), MINDIST is a camera radius clamped to 80 and never a distance between objects, nothing prevents clumping, and the surface/entity gates that decide what scatters at all |
| [unloaded-map-data.md](unloaded-map-data.md) | **Stock data files the game never loads** (2026-08-15): `gta.dat` declares 106 IDE/IPL files, 112 sit on disk, and a map `.ide`/`.ipl` has no other load path. The concrete cost — `leveldes.ide` re-uses seven ids that the LOADED `countn2.ide` owns, which every folder-globbing tool reports as a conflict and the game never sees. The load list is `gta.dat`, not the directory |
| [carmods-unknown-part-crash.md](carmods-unknown-part-crash.md) | **A `carmods.dat` token with no IDE row is a null dereference at boot** (2026-08-17): `LoadVehicleUpgrades` → `SetupVehicleUpgradeFlags` on a null model info (`0x4C4576`), no log line, no id-range check — a mod may add parts, it just has to define them. Caught at build time by vehicle-installer's `assertCarmodsModels` |
| [atomic-model-one-atomic.md](atomic-model-one-atomic.md) | **An `objs` model is ONE atomic** (2026-08-17): `CFileLoader::SetRelatedModelInfoCB` → `CAtomicModelInfo::SetAtomic` overwrites the model info for every atomic of the clump it reads, so the last visited (the FIRST in the file — RW's clump list is head-inserted) survives, re-framed at the origin. Stock ships 34 multi-atomic map models and every one is an `anim` row; zero `objs` rows carry two. Why a verbatim LOD clone of `burger01_LAw` showed only its burger sign — the round-15 "LOD absent" |
| [skygfx-fork-building-pipe.md](skygfx-fork-building-pipe.md) | **What the install's SkyGfx (JuniorDjjr fork) does to a world atomic** (2026-08-17, read out of its source AND its shipped compiled shaders): the install's ini values that matter (`buildingPipe=PS2`, `stochasticTexturing=1`, dual pass at 200), the stock rule for who is on the building pipe (night-colour chunk), and the finding that **no building shader reads vertex normals** — prelit + ambient is the whole light term, in stock SA and in the fork alike; the stochastic PS is a barycentric blend of three hashed samples of the same tiled texture and depends on nothing in the geometry; the fork's own instancer `DNInstance_PS2` is the one place a re-encoded mesh meets fork code |
| [vehicle-special-features.md](vehicle-special-features.md) | **Special vehicle abilities are hardcoded to model ids** (2026-08-18): pop-up lights, hydraulics, hooks, turrets, jets — a branch on the id, so only a slot replacement inherits them; the reference install's FLA ships a `model_special_features.dat` loader (`CustomModelName StandardModelName`, enabled, EMPTY) that re-points a model at a standard one — vehicle-installer plan 011 writes it from each mod's `features.txt` |
| [cutscenes.md](cutscenes.md) | **The cutscene system as measured** (2026-08-12, the vehicle-cutscene gates): the 23 hand-rigged vehicle models and their per-car authoring chaos, txdcut.ide's typo/missing/dead rows, the narrow ok/dam-only frame collapse, ANPK anims binding by NAME with a channel for every bone, blank plates (CCustomCarPlateMgr never runs in cutscenes), and why a cutscene.img drop-in into the bottle is a clean A/B |

## What belongs here, and what does not

**Here:** how the original engine behaves, what its data means, what its formats are, and what the target
install provides. Anything a mod author or a modded install brings with it.

**Not here:**

- **A rule a new design must satisfy** — that is [`restrictions/`](../restrictions/README.md), which links
  here for the detail. The split is the same one that folder already uses: this side carries the
  measurement, restrictions carries the one-line rule and what breaks when it is violated.
- **A limitation of OUR pipeline** — [`edge-cases/`](../edge-cases/README.md).
- **How the original's code worked**, recovered for a design — that belongs in the plan doing the recovering,
  with a link to [gta-reversed](../links.md). We recover what the DATA means and write our own execution
  ([`project-goals.md`](../project-goals.md) directive 1); a page of ported logic is not a reference.

## The rule this folder is here to enforce

**Budget a map-content plan against the install you ship to, not against stock 1.0 — and say which one you
picked.** Both answers are legitimate and they are wildly different numbers. Writing neither down is how a
plan ends up conservative by two-and-a-half times without anyone noticing, because the result still works.
