# Plans index

The map of planning docs across the repo. **Engine plans** live here — one numbered folder per plan
(`docs/plans/NNN-*/readme.md`, multi-part plans add sibling files inside their folder); the
**offline tools** keep their own `docs/plans/` next to their code. Open questions and parked ideas live in
[`../open-issues/`](../open-issues/) and [`../ideas/`](../ideas/).

> The [Nx monorepo migration (plan 057)](./057-nx-monorepo-migration/readme.md) will move each tool's `docs/` under
> `tools/<name>/docs/` — update the links below when it lands.

## Engine (`docs/plans/`)

Core runtime + RenderWare parsing, world streaming, rendering, characters, vehicles, physics, UI — plans
`001`–`090`, one folder each (066, 073, 074, 078–083 carry multi-part sub-plans). Newest first:

- **[090 — A car's cabin at night](./090-vehicle-cabin-at-night/readme.md)** — OPENED 2026-07-28 from a field
  report: the previon's interior is almost black at dusk. Measured cause — 084's per-vertex SKY occlusion
  (cabin 0.32–0.69 against 0.90–1.00 on the bodywork) keeps dividing the light after the sky stops being the
  source. Two steps: `01` relax that factor at night, `02` a dash glow baked into the night set and switched
  by the car's own headlights, with the cabin found from the model's glass and wheel hubs, never a car list.
- **[089 — Vehicle particles](./089-vehicle-particles/readme.md)** — OPENED 2026-07-27: tyre smoke
  (`collisionsmoke`) and skid marks (`particleskid`) driven by how hard a wheel actually slides, marks
  darker with the slide and gone 5 REAL seconds later, plus impact smoke. Its foundation is the capability
  the 044 FX path never had — a DYNAMIC emitter (today's particles are baked static map anchors) — and the
  surface-driven wheel effects on top wait on [081/10](./081-vehicle-physics/10-surface-types.md).
- **[088 — Ped locomotion feel](./088-ped-locomotion-feel/readme.md)** — SHIPPED 2026-07-24, both
  rounds: turn-rate heading + plant, crossfades with phase carry, walk/run/sprint tiers + cycle-speed
  sync, the jump/fall FSM (coyote/buffer/anticipation), impact-tiered landings, a real slope slide,
  and vehicle ingress/egress realism (root-motion slides, passenger door + shuffle, blockage-probed
  exit chain, overturned crawl-out, door choreography). Audit: `docs/audit/ped-locomotion-feel.md`.
- **[087 — The gostown field round](./087-gostown-field-round/readme.md)** — the first TC's field-bug
  batch after its first full boot (bridge at LOD range, missing island chunk + floating tree, black
  water stripes); same symptom→bytes method as 085.
- **[086 — One build, consistent names, pak-based fetch](./086-unified-build-naming-fetch/readme.md)** —
  `game-src/<id>` · `mods-src/<id>` · `build/<id>` naming unification (`original`→`original`,
  `build/original`→`build/original`), pak manifest identity, the fetch-pack finishing tool replacing
  `build-game.ts`, the fetch client booting the pak, TC trial runs (gostown/carcer/anderius).
- **[085 — Map-object appearance](./085-map-object-appearance/readme.md)** — the 2026-07-22 field round
  (after vehicles, before peds): row A SHIPPED — the night emissive mask went per-channel (the luma delta
  systematically killed saturated neon: the LV strip's red rope lights never glowed); further rows as the
  user reports them.

- **[084 — Vehicle appearance and dynamic-model lighting](./084-vehicle-appearance/readme.md)** — the 2026-07-20
  field round: wheel-side/scale conventions and the flat dynamic indirect term SHIPPED (with measurements);
  open = night level vs the map, reflections (floor vs prod-style presets — DECISION NEEDED) and AO for
  dynamics. The perf row is CLOSED (2026-07-21: it was mod vegetation, not vehicles). Peds share the
  row-B root.

- **[083 — Basic CLEO support](./083-cleo-basic/readme.md)** — run compiled `.cs` scripts: Sanny-DB SCM
  decoder (lifts the 0x014B car-gen reader), engine-agnostic thread VM, CleoHost on the rigid `.osm`
  path, `packages/cleo` module, tracer + coverage. Promoted from ideas/0.4.0/04.
- **[082 — Vehicle license plates](./082-vehicle-plates/readme.md)** — per-instance city-correct plates on
  the array-based engine: plate atlas array + per-instance slot, converter-flagged plate submeshes,
  mask DSL + placement-seeded determinism, damage-riding. Promoted from ideas/0.4.0/01.
  **CLOSED 2026-07-28**: 01–04 shipped, the pak was reconverted and the field verdict is in — every car
  wears its plate. Phase 0 corrected two of this plan's own assumptions (the city mapping was recorded
  backwards, and a plate is two quads, not one), and the first real boot cost one fix: a WGSL uniformity
  error in `rigidTexel`, which no test can see. Closed on the look verdict — the distribution drive, the
  bench guard and a ram test are listed unmeasured in the plan's readme.
- **[081 — Vehicle driving physics](./081-vehicle-physics/readme.md)** — feel overhaul on the own engine.
  **01–05 DONE 2026-07-26, field-accepted**: `handling.cfg` went from 5 fields consumed to 21, every one a
  translation of the original's own code (spring law, `cTransmission` gearbox, air drag, tyre grip and
  traction loss, the steering limiter, the rear-lock handbrake); six fitted constants died; the gate is
  answered — STAY on DRCVC, its three asymmetries documented. Audit:
  [`audit/vehicle-physics-081.md`](../audit/vehicle-physics-081.md). **08 (SA gravity) closed-rejected and
  09 (speed steering) SHIPPED 2026-07-27**; the same day 07's regression pack (5 cars × 11 scenes, gated by
  `scripts/phys-regression.ts`) and its step-cost measurement landed, and 06 §2's kerb assist was closed by
  the field as not needed. **CODE-COMPLETE 2026-07-27**: 06 §1 air control (the original's own turn forces,
  `?airCtl`) and §3 camber from the authored axle, then 07's five-class sweep — which found the tuning
  generalises and left the class-factor table EMPTY — and the close-out
  ([audit](../audit/vehicle-physics-081-closeout.md)). **What is left is ONE field round** (jumps, a
  solid-axle car through a corner, one drive per class); 10 (surface types) is shipped-and-shelved as an
  open issue. Promoted from ideas/0.4.0/07.
- **[080 — Cinematic camera](./080-cinematic-camera/readme.md)** — GTA V-feel follow camera: per-channel
  springs/lag, auto-center + look-ahead, collision whiskers, vehicle speed/FOV/drift framing, bob/shake,
  7 sub-plans + priority chain. **01–07 DONE 2026-07-25** — the on-foot baseline, collision and the
  vehicle camera: damp/spring math + `CameraDirector` (`ui/camera/`), the smoothed rig with render
  interpolation (position weight), composition (turn-follow, idle recenter, look-ahead), collision
  (sphere casts, snap-in/ease-out, min distance, floor guard), and driving — speed→distance/FOV curves plus
  drift framing off 081/01's physics slip channel, as a second TUNING TABLE rather than a second code path,
  plus the additive motion layer — bob, landing dip, impact shake, sprint FOV kick, bounded and behind a
  `reducedMotion` switch (06). The 02–04 **field round is accepted** — defaults frozen as shipped, and the
  `?cam=legacy` A/B is DELETED with it. FOUR field rounds ran on the vehicle camera and the motion layer and
  every report was fixed; the close-out (07) turned the transition matrix into a test, froze the tuning,
  pruned the tab and ran the exit exam. **ACCEPTED in the field 2026-07-25 — the chain is closed for 0.5.0.**
  **08 (C-key view presets incl. first person) is DEFERRED**; its feasibility research is
  [`docs/ideas/first-person-camera/`](../ideas/first-person-camera/readme.md).
- **[079 — One canonical build source, the dev-surface unification, and its docs](./079-canonical-build-source/readme.md)**
  — every dev surface (lab, bench harness, viewers) reads ONE canonical build (`./build/original`), served in
  place (NOT copied into `public/`), via a new `http-dir` loader + the loading-MODE-selects-the-world fix +
  `buildTime`. Depends on [opensa-pack 003](../../tools/opensa-pack/docs/plans/003-game-shaped-output.md).
  **Phases 0–5 DONE 2026-07-21; phase 6 (docs) open.**
- **[078 — Global bug fixing](./078-global-bug-fixing/readme.md)** — the umbrella ledger for the bugs the
  first FULL pmb map convert surfaced (2026-07-19, >1 h run): engine and tool fixes tracked in one place.
  **OPEN — awaiting the detailed bug report; runs before 079.**
- **[077 — Unit coverage back to 85–90 %](./077-unit-coverage/readme.md)** — the 074/13 teardown deleted heavily
  unit-tested WebGL code and sank coverage 88.9 → 72.3 %. Recovered to **88.18 %** with a **device-independent
  seam**: a recording `GPUDevice` stand-in that boots the whole engine headlessly, no engine source touched.
  **DONE 2026-07-18.**
- **[076 — Roadsign / billboard text](./076-roadsign-text/readme.md)** — 2dfx type-7 text plates (roadsignfont glyph
  atlas, world-space) that prod renders and the own engine skips → blank boards. Bake into the cutout pipeline.

- **[075 — Water body classes: SEA vs INLAND](./075-water-body-classes/readme.md)** — split water.dat by height so
  inland pools/reservoirs render calm (no swell/foam/spillover) while the ocean keeps its full dynamics.

- **[074 — OpenSA engine](./074-opensa-engine/readme.md)** — own WebGPU-only framework + native formats
  (concept: [00-concept](./074-opensa-engine/00-concept.md)): target **60 fps with the full WebGL effect set**. Chain:
  01 framework architecture · 02 native formats (`.oscell`/`.ostex`/`.ospak`, texture ARRAYS, alpha pipeline) ·
  03 converter tool (`opensa-pack`) · 04 engine lab + P0 gate · 05 streaming/memory · 06 world effects ledger ·
  07 baked channels (066 specs re-targeted) · 08 dynamics (early skinning probe) · 09 post-FX/MSAA+A2C ·
  10 integration & flip. Vertical-slice roadmap M0–M4, every milestone gated on numbers.

- **[073 — WebGPU migration (three.js) — FAILED](./073-webgpu-migration-threejs/readme.md)** — the WebGL→WebGPU
  renderer mode on three.js: the CPU side was fully solved (render 65 → ~4 ms: bundles + patched three 0.185.1 +
  plain-Mesh pipeline sharing + memory caps), but an irreducible GPU/present remainder in **three's WebGPU
  backend on Metal** kept an M3 Pro under the 40 fps bar — the blocker is on three.js's side (per-object
  pipelines, naga codegen traps, backend present overhead; full forensic log in sub-plan 08). **Conclusion: the
  path forward is our own framework — [074 OpenSA engine](./074-opensa-engine/readme.md).** The
  `?webgpu/bundle/...` flags and engine changes stay in-tree for debugging until the own-framework work decides
  their fate.

- **[062 — Rendering overhaul](./062-rendering-overhaul/readme.md)** — **CLOSED 2026-07-21 (user triage): the whole
  062–072 chain is superseded by the own engine (074) — every effect was re-implemented there; no tail in
  these plans is actionable any more.** The "modern lighting" fork (chain umbrella,
  promoted from `ideas/0.4.0/02-rendering`): real sun on the prelit world without double-counting, CSM building
  shadows with LOD proxies, PBR sky + 512×1 horizon LUT, unified fog (horizon cut), Gerstner water, world-shader
  light pool (projected headlights), glowing night emissives, quality tiers + default flip. Stages:
  [063 foundations/instrumentation](./063-render-foundations-instrumentation/readme.md) ·
  [064 hybrid lighting](./064-hybrid-world-lighting/readme.md) · [065 shadows](./065-cascaded-shadows/readme.md) ·
  [066 pmb modern-asset tool](./066-pmb-modern-tool/readme.md) · [067 sky](./067-pbr-sky-clouds/readme.md) ·
  [068 fog](./068-unified-fog/readme.md) · [069 water](./069-water/readme.md) · [070 local lights](./070-local-lights/readme.md) ·
  [071 night](./071-night-emissive-atmosphere/readme.md) · [072 tiers/flip](./072-quality-tiers-default-flip/readme.md).
- [061 — World-ready state](./061-world-ready-state/readme.md) — boot reveal + teleport freeze driven by streaming
  `settled()`.
- [060 — Streaming smoothness](./060-streaming-smoothness/readme.md) — warm-invisibly + atomic-appear cell pipeline.
- [059 — Map car generators](./059-map-car-generators/readme.md) — spawn the binary-IPL `CARS` section (SA's map-baked
  parked cars in gta3.img): parser + specific-model + random (popcycle/cargrp, B1 city approximation) all done
  (lazy LOD register, ground-snap on spawn), in-game verified; B2 per-zone fidelity + random colour pending.
- [058 — Modloader](./058-modloader/readme.md) — `modloader/` overlay (`AssetFileSystem` decorator): override vehicle
  dff/txd + merge their settings into vehicles.ide/handling.cfg/carcols.dat, no engine changes.
- [057 — Nx monorepo migration](./057-nx-monorepo-migration/readme.md)
- [056 — Multi-game config](./056-multi-game-config/readme.md)
- [055 — Input sources / mobile controls](./055-input-sources-mobile-controls/readme.md) · [054 — Asset cache revoke](./054-asset-cache-revoke/readme.md) · [053 — Asset local loader](./053-asset-local-loader/readme.md)
- …`001`–`052` in this folder.

## Tools (each ships its own plans)

- **map-optimizer** — lossless DFF/TXD conditioning (normals, prelit, dedupe, mips, full build).
  [`map-optimizer/docs/plans/`](../../tools/map-optimizer/docs/plans/) (`001`–`015`).
- **vehicle-optimizer** — scale + reflection-strength transfer for vehicle DFFs.
  [`vehicle-optimizer/docs/plans/`](../../tools/vehicle-optimizer/docs/plans/) (`001`–`003`).
- **opensa-lod-generator** — chunked LOD bake (merge → QEM decimate → per-cell TXD → drop-in build).
  [`opensa-lod-generator/docs/plans/`](../../tools/opensa-lod-generator/docs/plans/) (`001`–`002`).
- **lod-trees-generator** — SA-style tree LOD impostors (crossed-billboard cards + baked alpha atlas) from HD
  trees, plus the map strip + place stages (text↔binary IPL LOD-index coupling), the SA asset-format checklist,
  and aspect-aware atlas + `--prelight` trunk transfer. (procobj is now its own tool.)
  [`lod-trees-generator/docs/plans/`](../../tools/lod-trees-generator/docs/plans/) (`001`–`005`, `007`).
- **lod-procobj-generator** — procobj scatter → static IPL with **simplified-copy** (decimated) LODs; reuses
  `sa-lod` + `map-placement`. [`lod-procobj-generator/docs/plans/`](../../tools/lod-procobj-generator/docs/plans/)
  (`001` architecture · `002` build pipeline · `003` asset format).
- **mod-installer** — layer mod folders onto a base game (files overwrite, `gta3img/` merges into `gta3.img`, a
  PNG folder merges into a sibling loose `.txd`), alphabetical.
  [`mod-installer/docs/plans/`](../../tools/mod-installer/docs/plans/) (`001` design · `002` as-built · `003` txd).
- **vehicle-installer** — install vehicle mod folders: dff/txd → `gta3.img`; settings → `handling.cfg`/
  `vehicles.ide`/`carcols.dat` (car/car4, alpha-sorted, custom `col` palettes)/`carmods.dat`; `--strip` to keep
  only the installed cars. [`vehicle-installer/docs/plans/`](../../tools/vehicle-installer/docs/plans/) (`001`
  architecture · `002` install · `003` palette · `004` strip).
- **ped-installer** — install ped mod folders: dff/txd → `gta3.img`; a new ped's line → `peds.ide` (replace by
  model, append if new); `--strip` to keep only the installed peds + the player ped (`--player`, default
  `BMYPOL1`). [`ped-installer/docs/plans/`](../../tools/ped-installer/docs/plans/) (`001` architecture · `002`
  add/replace · `003` strip).
- **tool-kit** — shared building blocks (mesh smooth-normals + QEM simplify, editable IMG). No plans doc yet.
- **map-placement** — shared SA map-edit workflows (id allocation, IDE/gta.dat edits, swapped-HD retexture,
  procobj convert/strip), used by lod-trees-generator + lod-procobj-generator.
  [`map-placement/docs/plans/`](../../tools/map-placement/docs/plans/) (`001` architecture & API).
- **sa-lod** — shared simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL), extracted from
  opensa-lod-generator, used by it + lod-procobj-generator.
  [`sa-lod/docs/plans/`](../../tools/lod-common/docs/plans/) (`001` architecture & API).
- **rw-codec** — shared pure RW chunk/DFF/DXT/geometry-struct codec, extracted from map-optimizer (plan 057,
  step 2). Top-level `rw-codec/` now; moves under `tools/` in the migration. No plans doc.
- **timecyc-builder** — timecyc precompute. No plans doc yet.

## Other docs

- [`../open-issues/`](../open-issues/) — investigated problems kept for reference (e.g. locked-dff).
- [`../ideas/`](../ideas/) — parked design directions ("later, maybe").
- [`../architecture/`](../architecture/README.md) — the architecture docs (modules, boot/loading, streaming, pmb, tools).
