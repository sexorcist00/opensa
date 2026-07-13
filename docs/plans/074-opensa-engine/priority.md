# 074 — Priority order: from here to "real OpenSA drives on the new engine"

The single ordered list of what remains, in the order I would execute it (2026-07-12, end of the Fable
session). Each step names its plan doc, why it sits where it sits, and what "done" looks like. Three
milestones structure it: **A — the whole map is deliverable · B — the player lives in the world ·
C — the flip and the endgame.**

Current state (end of 2026-07-13): milestones A and B1–B4 are DONE/PARKED — the FULL map converts in one
command (~30 s bakeless incl. clouds+water; 202.6 s with shadow bakes) and streams everywhere; the PLAYER
walks/runs/jumps in the real app with prod HUD/zones/pointer-lock and in-game benches (all 6 scenes
vsync-120); Safari smoke ✅; the config-API parity module ships prod tunables to the engine; water v3
PARKED as leftover (0.6.0 plan). NEXT: vehicles-in-game (entity handles) → C1 criteria run (needs the
WebGL-prod `?bench=all` baseline for the side-by-side) → flip; C2 cleanup GATED on an explicit command.

---

## Milestone A — the whole map is deliverable

**A1. meshopt + brotli wire compression** — ✅ DONE 2026-07-13 (14 ledger: geometry 4.23×, full-LS
497.5 → 311.2 MB ≤ the 400 MB gate; worker-side decode NET faster than deflate-only; brotli deliberately
skipped — serve-time `Content-Encoding: br` remains) · size M
Geometry is the measured 82 % of the 1.15 GB full-LS pak; this is the top lever and it touches the format
boundary (encode in `opensa-pack`, decode in the pak worker), so it lands BEFORE more paks get produced.
**Done:** full-LS pak ≤ ~400 MB on the wire; decode adds < 1 ms to worst cell create; bench unchanged.

**A2. Bake worker pool + chunked welding** — ✅ DONE 2026-07-13 (14 ledger: full-LS --bakes 939 → 532 s,
peak RSS 16 → 5.2 GB; serial ≡ pooled SHA-identical; chunk ring = 2 cells ≥ the 400 u sun ray; bakes are
OPT-IN since the same day — `--bakes`, quarter-of-cores default) · size M
Bakes are 91 % of convert time (parallel per cell); welding the whole map cannot hold in one 16 GB heap
(one city already held it). Chunk = region-sized weld scratch with an overlap margin for the bake BVH.
**Done:** the FULL non-modified map converts on the M3 in one command, wall-time recorded (~target ≤ 15 min).

**A3. Full-map pak in the standalone page** — ✅ CORE DONE 2026-07-13 (first FULL-MAP pak: 71.4 s
bakeless, 1121 entries, 769.7 MB wire, `?src=pak-map` in the lab/standalone/game; whole-map `?bench=map`
tour committed to the series — max 14 ms. REMAINING here: the `--bakes` full-map convert and the 30-min
soak) · size S
Convert the full map (A2), serve via range-reads (already landed), fly SF→LV→LS in `opensa-engine.html`.
This is the "whole world on the new engine" demo and the long-haul streaming soak in one.
**Done:** cross-map flight, no leaks (ledger returns to baseline after unload-all), `city`-style bench rows
recorded per region; the M1 stress tails (whip/teleport/30-min soak) close here too.

## Milestone B — the player lives in the world

**B1. Skinning probe — own IFP sampler** — ✅ DONE 2026-07-13 (08 probe note: own sampler + storage
palettes + dynamics vertex-layout family; FIELD ✅ animated ped; the riskiest unknown of the chain is
retired) · size L
Own skinned-mesh path: DFF skin data → engine skinned pipeline (bone matrices in a storage buffer), own IFP
keyframe sampler (three's AnimationMixer is not portable). Probe = CJ idle/walk cycle rendering in the LAB.
**Done:** one animated ped at 120 Hz; the pipeline count stays enumerated; sampler unit-tested against
known IFP curves.

**B2. Dynamic entity API + vehicles** — ✅ v1 DONE 2026-07-13 (rigid-entity layer + vehicle fixture:
parts/wheels/4-colour carcols/lamp day-night texture twins/26 verbatim dummies; light pool 06 row 7 with
headlight producers, bench row accepted. REMAINING in 08: lamp state on braking, headlight cones v2,
chassis_vlo LOD, ok/dam) · size L
The engine grows a small dynamic-object layer next to the static cells: per-frame transforms (storage
buffer), rigid part hierarchies for vehicles (doors/wheels), the entity HANDLES that plan 10's audit said
will replace three mesh refs in gameplay code. Local light pool (06 row 7) lands here — its producers
(headlights/brake lights) finally exist.
**Done:** a drivable-looking vehicle + walking ped rendered by the engine in the lab, moved by game-style
transform updates; light pool lit at night.

**B3. Game boots on the engine (integration phase 2)** — ✅ v1 DONE 2026-07-13 (FIELD ✅: walk/run/jump
around Grove Street with `?engine=opensa`; physics/collision/input REUSED, shared runtime Config, ped-probe
player, data-driven feet. Timecyc driver ✅ 2026-07-13 — the SHARED config→Environment driver
(engine-environment-driver adapter, litFade-dynamic arcs, prod tunables preserved; plan 10 config-API task
closed same day). Zones/HUD + pointer lock ✅ 2026-07-13 (reuse-not-duplicate: prod's DOM <Hud> narrowed to
a HudGame surface — the three Game satisfies it structurally; ZoneNameSystem + info.zon/gxt loaders shared
via ui/zone-data.ts; click = mouse capture, Esc frees, pause exits the lock). In-game benches ✅ 2026-07-13
(`?engine=opensa&bench=<key|all>`: prod's BENCH_SCENES + samplePath reused, host-specific harness —
physics.teleport anchor, per-scene weather via the shared driver + dome crossfade, settle→warmup→timed
capture of engine stats, SAME `[bench] {json}` console protocol → C1 compares own-engine vs WebGL rows
directly). **B3 is now FULLY closed** — next: vehicles-in-game (entity handles), water v1, C1 criteria run) ·
size L
`Game.create` grows the capability branch: own engine renderer behind a flag, three-WebGL still default.
Physics/zones/time/logic reuse as-is (audited renderer-agnostic); streaming follows the PLAYER; picking
goes through an engine-side ray query against the 07 cell BVHs; HUD/UI unchanged (DOM).
**Done:** walk and drive around Los Santos in the real app with `?engine=opensa` — gameplay parity with
the WebGL path for movement/camera/streaming; benches from inside the GAME, not the lab.

**B4. Water v1 + remaining world effects** — [06](06-world-effects-parity.md) rows 12/13 tails · size M
✅/PARKED 2026-07-13: water went v1→v2→v3 in one day (runtime flat → shore-field bake → TRUE-depth bake
with surf/foam/swash; 12 field rounds logged in plan 06) and is PARKED as a leftover at v3 — the look
ceiling is the 2005 sprite textures; resume = docs/ideas/0.6.0/plans/02-water-realism (authored textures
first). Coronas textured + 2dfx particles (row 13 tails) remain open here.
The game needs a sea surface; v1 = flat animated surface with the sky-shared fog (the "real waves" rework
stays the 0.5.0 idea). Textured corona sprites + coronamoon land with the particle.txd path; 2dfx particles
(factory smoke) close row 13.
**Done:** coastline looks intentional; night coronas textured; ledger 06 = 14/14 (some rows v1-marked).

## Milestone C — the flip and the endgame

**C1. Flip criteria run** — [10](10-integration-flip.md) · size M
The pre-agreed gates: 60 fps ls-noon @2× retina; ≥ WebGL fps on EVERY bench scene; parity screenshot
sign-off; stress matrix + 30-min soak green in Chrome and Safari (the Safari row is still unvisited!).
**Done:** the flip decision doc with every ledger linked; own engine becomes the default renderer.

**C2. Cleanup** — [13](13-cleanup.md) · size M
Drop the three-WebGL path, the 073 flag zoo, three/babylon/postprocessing (user decision: no WebGL
fallback). Every deletion PR bench-gated. **GATED on a separate explicit user command (2026-07-13
directive): after the flip the old path STAYS for a side-by-side comparison period (settings/picture/
anything forgotten) — C2 never auto-starts from C1 passing.**
**Done:** dependency/bundle ledger recorded; one renderer in the tree.

**C3. pmb integration + the exit exam** — [14](14-pmb-integration.md) · size L
`opensa-pack` becomes a perfect-map-builder stage (wind/stochastic/subdivision data move into pmb config);
full modded profiles (anderius/carcer/gostown) convert and run the final bench matrix.
**Done:** the headline the chain exists for — **the user's full modded SA at 60 fps on the own engine**.

---

## Standing rules while executing (do not relearn these)

- Bench ritual after every perf-relevant change; series.md is append-only; >10 % GPU/frame p95 regression
  blocks until explained (Metal timestamp quantization: trust avg when max is bit-identical).
- Reconvert BOTH paks (`pak`, `pak-sf`, later full-map) whenever the converter or manifest changes.
- Golden WGSL snapshots: change → review the diff → `vitest -u`; naga guardrails stay (no uniform-space
  arrays, no unbounded loops).
- ALL project docs and code stay English-only — repo-wide, not just plans (user rule, broadened
  2026-07-13); field verdicts get paraphrased in English; every verdict and measurement goes into the
  owning plan's ledger.
- Parked items have written prerequisites — check ideas/0.5.0 before re-attempting directional shadows,
  weather wind, or stochastic default-on.
