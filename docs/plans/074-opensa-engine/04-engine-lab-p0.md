# 074·04 — Engine lab + the P0 gate

[← chain](readme.md) · prev: [03 converter](03-converter-tool.md) · next: [05 streaming](05-streaming-runtime.md)

`apps/engine-lab` — the renderer laboratory. NOT a second game: no React shell, no gameplay, no physics; a
canvas, the engine, a scripted camera and the HUD. Import boundary enforced by nx tags: lab → `packages/engine`

- `packages/engine-formats` only (never `packages/game`, never three's renderer).

## What the lab is for

1. **M0 vertical slice**: render one converted district (03 output) with the 01 core — opaque + cutout(A2C) +
   flat sky colour. Prove the thesis with numbers before anything else exists.
2. **Bench parity**: the SAME districts and the SAME camera paths as the WebGL bench scenes (`ls-noon` first) —
   every number directly comparable to today's 65 ms CPU / 31 ms GPU baseline.
3. **Stress harness**: the scenarios that killed 073 — cold start, camera whips, drive-speed cell swaps —
   scripted and repeatable (`?path=ls-noon&speed=2`).
4. The permanent home for effect A/B toggles as 06–09 land.

## HUD (ported from 073, extended — lands BEFORE the first mesh renders)

frame ms (avg/max) + fps · CPU segments (sim-stub/submit) · **GPU per-pass ms via timestamp queries** ·
draws/pipelines bound · residency bytes (buffers/textures, per the resources ledger) · JS heap + longtasks ·
cells visible/total. Everything on screen; DevTools optional, never required (the 073 process lesson).

## The P0 gate (numbers, agreed in advance)

| Check                                           | Pass                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| One LS district, static camera sweep, 2× retina | **GPU < 5 ms**, submit **< 1 ms**                                                          |
| Draw count                                      | ≤ 8/cell HD (bench: 100–300 total)                                                         |
| Pipeline count                                  | < 40, all compiled behind the veil; ZERO steady-state compiles                             |
| Alpha edge                                      | vgsebushes / fences: **no black halo** (visual sign-off + edge-luminance diff vs baseline) |
| Cold start                                      | district load → first frame < 3 s on the dev machine                                       |
| Safari (TP)                                     | boots, renders, gates re-measured (informational, not blocking)                            |
| Memory                                          | flat after load; leak assertion clean after unload-all                                     |

**Fail ⇒ stop and analyze** — a cheap honest answer is the design goal of gating first. Partial passes get a
written verdict in the ledger before any workaround work starts.

## Tasks

- [ ] Scaffold `apps/engine-lab` (vite entry like the standalone spikes) — after approval.
- [ ] HUD + GPU timestamps first; verify timestamp-query availability path (feature check from 01).
- [ ] Blob loader (main-thread fetch for M0; worker IO arrives in 05) + cell registry hookup.
- [ ] Scripted camera: sweep + the ls-noon path replayed from the existing bench path data.
- [ ] Alpha visual bench page (the three known-bad textures against grey; screenshot diff harness).
- [ ] Run the P0 matrix (Chrome + Safari TP), fill the ledger, write the verdict in the umbrella readme.

## Measurement ledger

(the P0 matrix results, per-browser; compare row: WebGL prod today = 65 ms CPU / ~31 ms GPU / 14 454 draws)
