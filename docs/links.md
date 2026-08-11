# External links

Every external resource the project has used or keeps an eye on, in one place.
Rule (also in `CLAUDE.md`): when an external resource proves useful, add it here.

## GTA SA reverse engineering & modding

- <https://github.com/gta-reversed/gta-reversed-modern> — reversed GTA SA source (the active repo; the
  catalogue's provenance lines cite it); the reference for engine internals (pools, `CIplStore`,
  streaming) behind our int16/pool guards and the `asi/` plugin work.
- <https://github.com/JuniorDjjr/CLEOPlus> — CLEO extension reference (opcode surface for plan 097).
- <https://github.com/cleolibrary/CLEO4> — CLEO 4's own source. `source/CCustomOpcodeSystem.cpp` is the
  ground truth for how `0AA5`-`0AA8` marshal their parameters (the push loop that makes the LAST listed
  parameter the FIRST C argument — see `docs/edge-cases/cleo-vm.md`).
- <https://github.com/sannybuilder/library> — the Sanny Builder opcode DB (`sa/sa.json`, 3 739 commands
  with arities) — vendored + pinned by plan 097/01; also the recon disassembler's source of truth.
- <https://github.com/JuniorDjjr/SA-MixSets> — per-feature SA tweaks reference.
- <https://github.com/JuniorDjjr/VehFuncs> — vehicle function extensions (useful for vehicle features
  parity: extras, wheels, steering parts).
- <https://github.com/JuniorDjjr/skygfx> — the maintained skygfx fork; vehicle reflection / graphics
  reference (informed plan 030 and the stochastic-texturing survey).
- <https://github.com/aap/skygfx> — the original PS2-graphics-on-PC restoration; the ground truth for SA
  render behaviour (vehicle env-map, prelit handling).
- <https://github.com/Kiminaze/VehicleDeformation> — vehicle deformation reference (ideas 0.6.0/01
  vehdeform).
- <https://libertycity.ru/files/gta-san-andreas/237577-san-andreas-advanced-handling-s-a-a-h.html> —
  **S.A.A.H (San Andreas Advanced Handling)**: a 210-car realism re-tune of `handling.cfg`. Used as a
  MEASURING CORPUS, not a target (plan 081/01): `scripts/debug/handling-diff.ts` against it showed that
  **58 % of a calibrated table's edits never reach our physics** — the author moves the centre of mass on
  65 % of the fleet and the suspension on 61 %, and the engine reads neither.

## Assets

- <https://www.gtainside.com/en/sanandreas/skins/144069-endoskeleton-terminator-t800/> — the T800 ped mod
  used as the material-maps test case (`docs/improvements/character-material-maps.md`).

## References the user wants watched before work starts

- <https://www.youtube.com/watch?v=1dwufRp71EY> — **must be shown to the user before ANY work on the City
  Life chain begins** (his call, 2026-08-11; he will say afterwards what it changes). The gate itself lives
  at the top of
  [`docs/roadmap/0.5.0/plans/06-city-life/readme.md`](roadmap/0.5.0/plans/06-city-life/readme.md).
- <https://www.youtube.com/watch?v=R24KBNuOiR4> — **must be shown to the user before any work starts from the
  original-game defect list** (his call, 2026-08-11). Gate at the top of
  [`docs/improvements/original-game-defects.md`](improvements/original-game-defects.md).

## The original game's own bugs

- <https://github.com/CookiePLMonster/SilentPatch> — the community's bug-fix patch for the 3D-era games; its
  SA changelog
  (<https://github.com/CookiePLMonster/SilentPatch/blob/dev/CHANGELOG-SA.md>) is the closest thing to a
  catalogue of what is broken in stock San Andreas. **Read it as a defect inventory, not a fix list** — and
  note our reference install already runs it, so its fixes are present on the `sa` target and absent in our
  own engine. Used as a seed for
  [`docs/improvements/original-game-defects.md`](improvements/original-game-defects.md).

## Articles & techniques

- <https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578> — starfield shader survey (fed the
  night-sky work in plan 032; the ideas carried over to the own engine's sky).
- <https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311>
  — full sky-system survey (same arc).
- <https://kellylougheed.medium.com/3d-starry-night-with-three-js-7f9191bbcb84> — starry-night walkthrough.
- <https://andreasrohner.at/posts/Web%20Development/JavaScript/Random-starfield-generator-for-THREE-js/> —
  random starfield generator.

## Tools

- <https://mermaid.live> — quick preview for the architecture diagrams (`npm run arch` output).
