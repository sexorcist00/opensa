# External links

Every external resource the project has used or keeps an eye on, in one place.
Rule (also in `CLAUDE.md`): when an external resource proves useful, add it here.

## GTA SA reverse engineering & modding

- <https://github.com/gta-reversed/gta-reversed> — reversed GTA SA source; the reference for engine
  internals (pools, `CIplStore`, streaming) behind our int16/pool guards and the `asi/perfect-map` work.
- <https://github.com/JuniorDjjr/CLEOPlus> — CLEO extension reference (opcode surface for plan 083).
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
