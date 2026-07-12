# 074 — Priority order: from here to "real OpenSA drives on the new engine"

The single ordered list of what remains, in the order I would execute it (2026-07-12, end of the Fable
session). Each step names its plan doc, why it sits where it sits, and what "done" looks like. Three
milestones structure it: **A — the whole map is deliverable · B — the player lives in the world ·
C — the flip and the endgame.**

Current state (see [readme → Handoff status](readme.md)): the static world streams and renders — full Los
Santos flies in the lab and in the web app's standalone page at 120 Hz vsync with ~3× GPU headroom; effects
parity is 12/14; the game itself has not touched the engine yet.

---

## Milestone A — the whole map is deliverable

**A1. meshopt + brotli wire compression** — [14](14-pmb-integration.md) task, built now, not at the end
· size M
Geometry is the measured 82 % of the 1.15 GB full-LS pak; this is the top lever and it touches the format
boundary (encode in `opensa-pack`, decode in the pak worker), so it lands BEFORE more paks get produced.
**Done:** full-LS pak ≤ ~400 MB on the wire; decode adds < 1 ms to worst cell create; bench unchanged.

**A2. Bake worker pool + chunked welding** — [14](14-pmb-integration.md) tasks · size M
Bakes are 91 % of convert time (parallel per cell); welding the whole map cannot hold in one 16 GB heap
(one city already held it). Chunk = region-sized weld scratch with an overlap margin for the bake BVH.
**Done:** the FULL non-modified map converts on the M3 in one command, wall-time recorded (~target ≤ 15 min).

**A3. Full-map pak in the standalone page** — [10](10-integration-flip.md) · size S
Convert the full map (A2), serve via range-reads (already landed), fly SF→LV→LS in `opensa-engine.html`.
This is the "whole world on the new engine" demo and the long-haul streaming soak in one.
**Done:** cross-map flight, no leaks (ledger returns to baseline after unload-all), `city`-style bench rows
recorded per region; the M1 stress tails (whip/teleport/30-min soak) close here too.

## Milestone B — the player lives in the world

**B1. Skinning probe — own IFP sampler** — [08](08-dynamics.md), scheduled FIRST inside B deliberately
· size L, the riskiest unknown of the whole chain
Own skinned-mesh path: DFF skin data → engine skinned pipeline (bone matrices in a storage buffer), own IFP
keyframe sampler (three's AnimationMixer is not portable). Probe = CJ idle/walk cycle rendering in the LAB.
**Done:** one animated ped at 120 Hz; the pipeline count stays enumerated; sampler unit-tested against
known IFP curves.

**B2. Dynamic entity API + vehicles** — [08](08-dynamics.md) · size L
The engine grows a small dynamic-object layer next to the static cells: per-frame transforms (storage
buffer), rigid part hierarchies for vehicles (doors/wheels), the entity HANDLES that plan 10's audit said
will replace three mesh refs in gameplay code. Local light pool (06 row 7) lands here — its producers
(headlights/brake lights) finally exist.
**Done:** a drivable-looking vehicle + walking ped rendered by the engine in the lab, moved by game-style
transform updates; light pool lit at night.

**B3. Game boots on the engine (integration phase 2)** — [10](10-integration-flip.md) · size L
`Game.create` grows the capability branch: own engine renderer behind a flag, three-WebGL still default.
Physics/zones/time/logic reuse as-is (audited renderer-agnostic); streaming follows the PLAYER; picking
goes through an engine-side ray query against the 07 cell BVHs; HUD/UI unchanged (DOM).
**Done:** walk and drive around Los Santos in the real app with `?engine=opensa` — gameplay parity with
the WebGL path for movement/camera/streaming; benches from inside the GAME, not the lab.

**B4. Water v1 + remaining world effects** — [06](06-world-effects-parity.md) rows 12/13 tails · size M
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
fallback). Every deletion PR bench-gated.
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
- Plans stay English-only; every field verdict and measurement goes into the owning plan's ledger.
- Parked items have written prerequisites — check ideas/0.5.0 before re-attempting directional shadows,
  weather wind, or stochastic default-on.
