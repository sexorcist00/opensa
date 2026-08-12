# The original's cutscene system — what the vehicle-cutscene work measured

Facts about REAL GTA:SA discovered while building `tools/vehicle-cutscene` (2026-08-12; the field
evidence lives in that tool's [plan 002](../../tools/vehicle-cutscene/docs/plans/002-implementation.md)
gate records). Everything here is the ORIGINAL game's behaviour, measured off `game-src/original` and
the reference install — not OpenSA.

## The models (`models/cutscene.img`, 634 entries)

- **23 vehicle DFFs across 21 `vehicles.ide` slots** (`cszr350`+`b`, `cscopcarla`+`92` share donors);
  the rest are cutscene peds and props. Traps: `csho` is the ped "Ho", not hotknife; `csandrom92` is
  CUT CONTENT (a txdcut row with no model anywhere); slot stems are the 8-char IDE names
  (`csremington92` ↔ `remingtn` — an INTERIOR letter is dropped, no prefix rule can link them);
  `csfirela` is slot `firela`, not `firetruk`+`la`.
- **Every cutscene vehicle is a hand-made HAnim rig** and the authoring is inconsistent per car: wheel
  nodes are `Box01` / `wheel_lf_node` / `axis_lf` / `wheelLFNode` / `dummywheel_rr` / single mesh
  frames at the corners; parts are `_ok` or `_hi_ok`; roots are the model name, `<model>_dummy`,
  `Root`, `Dummy01`, `Monster92`; csmonster inserts a `COG` frame between root and chassis; cssadler
  ships its own `winscreen_ok` typo. Bone ids are DFS-sequential per model; hierarchy node flags follow
  one rule everywhere: `(siblings follow ? 2 : 0) | (leaf ? 1 : 0)`.
- **Junk mesh-frame transforms are real, and the game's collapse rule is NARROW**: only a
  `<part>_ok/_dam` frame under its own `<part>_dummy` has its transform destroyed at load
  (`PreprocessHierarchy`/`CollapseFramesCB`); every other frame KEEPS its transform — stock copcarla's
  `chassis` carries `[0, 1.637, −0.35]` and its geometry is authored in that space. Components are
  keyed by the DUMMY, which is why a mod shipping `door_lr_ok` under `door_rr_dummy` (the taxi mod's
  copy-paste misname) works in gameplay.

## The TXDs (`data/txdcut.ide` + txdp)

- txdcut.ide is the cs-TXD → parent-TXD `txdp` dictionary. Stock ships **one typo row**
  (`csopcarla, copcarla` — the model is `cscopcarla`), **two missing rows** (`cscopcarsf`,
  `csdinghy` — exactly the two slots whose cs TXDs carry their own textures, R*'s own workaround),
  one duplicated row (`cssabre92`) and one dead row (`csandrom92`).
- Resolution order at runtime: the model's OWN TXD first, then the txdp parent, then the resident
  generic `models/generic/vehicle.txd` — vanilla's empty cs TXDs prove the chain, and shipping a
  same-named texture in the own TXD overrides the chain (the plate-bake trick, tool plan 003).

## The animations (`anim/cuts.img`, 444 entries = ~148 scenes × .ifp/.cut/.dat)

- Cutscene IFPs are the OLD **ANPK** format (the gameplay `anim.img` is ANP3): 4-byte-aligned chunks,
  `NAME` = the OBJECT the following `DGAN` drives, `CPAN`→`ANIM` = one bone channel (28-char name +
  frame count), keyframe block as the next sibling (`KRT0` = rot+trans, `KR00` = rot only). Reader:
  `scripts/debug/cutscene-anim-channels.ts`.
- **Binding is by frame NAME** (`CAnimBlendAssociation` via `CCutsceneMgr`), and the anims carry a
  channel for EVERY bone of the vanilla model — 2-frame static `KRT0`s included — so an animated
  bone's local transform is fully anim-owned; a converted model's own frame locals only survive on
  frames the anim has no channel for. Wheels spin via `KR00` on the MESH bones; wheel NODES get static
  `KRT0` translations. In SA (unlike III/VC) the scene's object list + anims come from `<name>.dat`
  inside cuts.img — main.scm only loads-by-name and starts.
- **The intro's vehicles live in `prolog1.ifp`/`prolog3.ifp`, not `intro*.ifp`** (intro1a drives
  csbat/csplay/props only).
- License plates: `CCustomCarPlateMgr` generates plate textures for GAMEPLAY vehicles only — cutscene
  objects render the raw placeholders, so **vanilla cutscene cars have blank white plates** (the
  user's gate-7 vanilla A/B screenshot is the recorded evidence). The plate art all sits uncompressed
  RGBA8888 in `vehicle.txd`: `platecharset` 32×256, `plateback1/2/3` 64×32, `carplate` 16×16.

## The reference install (cutscene angle)

The bottle streams `models\cutscene.img` DIRECTLY (modloader.log) and its modloader tree carries no
`.img` overrides — its `cutscene.img`/`data/txdcut.ide` were byte-identical to stock 1.0 when measured
(2026-08-12), so a drop-in of those two files is a clean, fully reversible cutscene-only A/B (the
gate-4/7 delivery method; originals kept beside as `.vanilla`). The ProperFixes row in
[reference-install-config.md](reference-install-config.md) lists `cuts.img`/`cutscene.img` as part of
the PACKAGE's distribution — the installed selection does not include them.
