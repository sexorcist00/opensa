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
| [procedural-objects.md](procedural-objects.md) | **What `procobj.dat`'s columns mean** (recovered 2026-08-09): SPACING is a LENGTH (`area / spacing²`, and the file's own header comment says otherwise), MINDIST is a camera radius clamped to 80 and never a distance between objects, nothing prevents clumping, and the surface/entity gates that decide what scatters at all |
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
