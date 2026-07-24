# 083/04 — Packaging, config & wiring: the two mods run end-to-end

Answers "engine part or separate module" concretely (separate module — the `game/mods` precedent)
and makes the two mods actually run in the browser. Rewired from the idea: the hub is
`engine-canvas-host`, the F2 capabilities system exists, and the data path runs through
mod-installer → opensa-pack.

## Decisions

1. **`packages/cleo`** (Nx project) depending on `@opensa/game` + `@opensa/renderware` (for
   `BinaryStream`/shared SCM reader) — NOT engine core (stays script-free; the core gained
   nothing, even the model path is adapter-level). Exports `CleoRunnerSystem implements System` +
   `installCleo(game, adapter, opts)`.
2. **Wired in `engine-canvas-host`** via `game.addSystem` after adapter/vehicle wiring (the same
   compile-time wiring every system uses — no dynamic discovery). Ticks in the variable-rate
   section on game delta, play-gated.
3. **Scripts from the VFS**: enumerate `CLEO/*.cs` at boot (the modloader-overlay convention;
   mod-installer bakes mods BEFORE opensa-pack, and a pack `--out` passes loose data through — so
   a CLEO mod's folder survives the whole pipeline untouched). Decode (01), start one thread per
   script. **mod-installer gains `CLEO/` folder awareness** (place `.cs` like it places
   `gta3_img/` content) — the one tool change; test mirrors the img-folder handling.
4. **`Config.cleo`**: `{ enabled: boolean; trace?: boolean; maxScripts?: number }` — default
   `enabled: false` until proven; live-read; the 4 config fixtures updated. F2 gains a CLEO row
   group (enabled/trace toggles + running-thread list) via capabilities.
5. **Failure isolation**: per-thread decode/exec errors kill THAT thread with a log; the runner,
   other scripts and the frame survive. An unsupported script degrades to "did nothing, said why".

## Subtasks

- [ ] `packages/cleo` scaffolding (project.json, lint boundaries: no engine import in core files —
      the nx-tags rule pattern).
- [ ] `CleoRunnerSystem`: VFS enumeration, decode, thread spawn, `update(delta)` → `runner.tick`,
      per-thread isolation, dispose.
- [ ] `Config.cleo` + fixtures + F2 rows.
- [ ] mod-installer `CLEO/` handling + test.
- [ ] End-to-end in the browser: install Wind Farm + Ferris Wheel (models via the normal mod
      pipeline + scripts), enable cleo → turbines and the wheel spawn and rotate. Screenshot/gif
      in the plan; behaviour compared against the real game (user has both mods installed there).
- [ ] Error-isolation test: a deliberately corrupted `.cs` dies logged; the other script runs on.
- [ ] Perf check: both mods live, `[bench]`-style frame sanity — VM + host ≤ 0.2 ms/frame budget.

## Verification

- Both mods run in-engine matching real-game behaviour; `enabled:false` = zero overhead;
  a broken script cannot take down the runner or the frame loop.

## Ledger

_(packaging record, per-frame cost with both mods, field verdict)_
