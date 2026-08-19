# The vehicle colour table is 128 rows, and the shipping build is already past it

**Found 2026-08-19** while making `tools/add-vehicles` idempotent (plan 002): the run's second pass grew
`carcols.dat`'s `col` palette by five rows, every time.

## The numbers

| tree | `col` rows |
| --- | --- |
| stock (`game-src/original`) | **127** (ids 0–126) |
| the shipping build (`build/original/sa`) | **140** |
| + the 115 added cars | **145** |
| the table the game holds them in | **128** — `Vehicle colors (128)` in FLA's own ini, and that line is COMMENTED OUT in the reference install, so 128 is what runs |

FLA writes the game's own default in the parentheses, which is where the 128 comes from — it has not been
read out of a disassembly here, and that is exactly why the installer WARNS about the overflow instead of
refusing it (`vehicleColourWarnings`). A build the user plays every day is not a build a tool gets to refuse
on an inference.

## What made it grow, and what that says

`addPaletteColors` appended a mod's custom colours **unconditionally**: every `--rebake` of a car that
authors colours added the same rows again and re-pointed that car's carcols line at the new ids. The
evidence is in the shipping build itself — three colours are in it twice:

```
57,124,155   # 131 spinnaker blue solid   blue      …and again at # 138
108,4,0      # 132 coral red     light              …and again at # 139
88,76,51     # 134 jlf beige dark beige  dark       …and again at # 137
```

Fixed the same day: a colour whose RGB **and** description already exist is reused, so the palette is a
function of the mod set rather than of how many times the installer ran. The existing twins are left where
they are on purpose — collapsing them would renumber colours that cars already reference by id.

**The general lesson is the one this repo keeps re-learning**: a merge that is not idempotent does not fail,
it DRIFTS, and the drift is only visible against a fixed-size table nobody was counting.

## What is not known yet

Whether the game's array really is 128, and what sits behind it. Until someone reads
`CFileLoader::LoadVehicleColours` / `CVehicleModelInfo::ms_vehicleColourTable` in the reversed source, the
honest position is: the build has been running 12 rows past the adjuster's stated default for some time with
no reported symptom, which is either luck or evidence that the number is wrong.

**The fix that costs nothing**: uncomment `Vehicle colors` in `fastman92limitAdjuster_GTASA.ini` and set it
above the palette the build carries (256 leaves room; a vehicle's colour is a byte in the save, so 256 is the
natural ceiling). That is a change to the reference install's configuration and therefore the user's call —
raised 2026-08-19, not yet taken.

## Where this bites

- `tools/vehicle-installer` — the palette merge (plan 003) and the report on every install/rebake path.
- `tools/add-vehicles` 002 — 115 added cars want five colours of their own.
- `docs/restrictions/sa-target.md` carries the one-line rule.
