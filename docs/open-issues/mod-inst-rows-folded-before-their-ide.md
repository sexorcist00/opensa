# A folded mod `inst` row is READ before the mod IDE that defines its id

**Status: open 2026-08-18, root cause pinned on the desk, no fix applied (found while bisecting a boot crash,
and it is NOT that crash).** The `sa` build produces a `gta.dat` whose stock IPL block places model ids that
only a mod IDE line further down defines. The real game reads `gta.dat` top to bottom, so those placements
hit an undefined id. In the reference bottle **modloader hides it** — it supplies the same mod IDEs itself,
early — which is why the build has shipped this way without a single report.

## Symptom

With `modloader.asi` disabled (a diagnostic arm on 2026-08-18), the reference install refuses to boot with
the game's undefined-id error naming **model 12780**. With modloader on, no error appears at all.

## What the data says

| Fact | Value |
| --- | --- |
| id 12780 | `fxsmoke30lit`, defined in `data/maps/missing smokes fix.ide` |
| that IDE in `gta.dat` | **line 158** — IDE #65 of 69, in the block the installer APPENDS |
| placements of 12780 | **39**, all in `las` |
| `IPL DATA\MAPS\LA\LAs.IPL` in `gta.dat` | **line 93** — 65 lines EARLIER |

`gta.dat` interleaves the two directives: stock IDEs (lines 16–80), stock IPLs (81–149), then the mods' IDEs
(150–161) and the mods' IPLs (162+).

## Why it happens

- `CFileLoader::LoadLevel` (`0x5B9030`, gta-reversed `FileLoader.cpp`) walks the file line by line: an `IDE`
  line loads object definitions **there**, an `IPL` line loads placements **there** (`MatchAllModelStrings()`
  runs once, before the first IPL). A definition that arrives later does not exist yet for a row read earlier.
- `mergeGtaDat` (`tools/mod-installer/src/gta-dat-merge.ts`) **appends** a mod's `IDE`/`IPL` refs to the end of
  `gta.dat`. Self-consistent on its own: the mod's IDE lands before the mod's own IPL.
- The IPL SLOT FOLD (`mergeModInstIpls`, [mod-installer plan 013](../../tools/mod-installer/docs/plans/013-slot-fold-across-hosts.md))
  then moves mod `inst` rows OUT of that appended file and into stock hosts, to stay under the 40 usable
  text-IPL slots. The host is chosen by capacity — nothing considers WHERE that host sits in `gta.dat`. A row
  folded into `LAs.ipl` is therefore read at line 93 while its definition waits at line 158.

The reference install's FLA has `GTA_ERROR_ATTEMPT_TO_LOAD_OBJECT_INSTANCE_WITH_UNDEFINED_ID` enabled, so the
real game says so out loud — as long as nothing defines the id behind our back.

## Why nothing in our toolchain catches it

Every check we have looks at the SET, never at the ORDER: `dangling-models` asks whether a placed id is
defined and streamable anywhere in the tree, `assertLodLinks` / `lod-link-check.ts` resolve row indexes,
`ipl-row-census.ts` counts rows and slots. All of them pass on this tree. The one thing that would have
failed is a check that compares two positions in `gta.dat`.

## The fix, when it is taken

1. **Splice, do not append**: mod `IDE` lines belong BEFORE the first `IPL` line of `gta.dat` (SA has no
   opinion about IDE order, and `registerImgArchives` already splices rather than appends, for the same class
   of reason). Mod `IPL` lines can stay at the end.
2. **Then guard it**: for every `inst` row of the built tree, the `IDE` that defines its id must appear
   earlier in `gta.dat` than the `IPL` that places it — fail the build naming both files, the way
   `assertLodLinks` and `assertCarmodsModels` fail. Without the guard the fold is free to reintroduce it the
   next time a host is chosen differently.
3. Re-check with modloader OFF, which is the only configuration that reports the fault.

## What this is NOT

It is not the 2026-08-18 boot crash (heap corruption inside `_rpMaterialListStreamRead`, `0x74E600`): with
modloader on, the ids ARE defined and no undefined-id error appears, yet the game still dies. That hunt is
separate.
