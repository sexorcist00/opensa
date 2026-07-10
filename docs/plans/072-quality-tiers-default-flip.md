# 072 — Quality tiers, default flip, cleanup

Part of the [rendering overhaul chain](062-rendering-overhaul.md). The closing plan: depends on everything before it. The chain isn't "done" until the modern pipeline is the DEFAULT and the budgets hold on real hardware tiers.

## Context

Plans 002–009 each added `graphics.*` toggles and recorded per-feature costs. What's missing at this point: a coherent user-facing quality ladder, enforcement that the combined default fits the frame budget, and the 038-style cleanup decision (what happens to the classic path).

## Decisions

1. **Four tiers** mapping every chain toggle:
   - **low**: classic-equivalent (038 look) + new sky at cheapest model, no static shadow cascades, sky-only water reflection, light pool 8, no volumetrics;
   - **medium**: CSM 2 cascades, pool 16, shore water, no planar reflection;
   - **high** (default target): CSM 3, planar water, pool 32, full emissive night, Stage-A clouds;
   - **ultra**: PCSS/contact experiments, volumetric clouds (005 Stage B), SSR water, wet-look.
     Exact mapping finalized from the measured numbers in each plan's doc — tiers are DERIVED from data, not vibes.
2. **Frame budget contract**: high tier ≤ 16.6 ms p95 on the reference machine across ALL bench scenes (worst: dusk long-shadows + LV night). Any overshoot gets resolved by demoting features between tiers, not by shipping a slow default.
3. **Default flip**: `graphics.pipeline: 'modern'` + tier `high` become the defaults after a full sign-off sweep (all benches × key hours × weathers, side-by-side vs classic).
4. **Classic path fate — user decision point**: 038 deleted its old path after sign-off; propose the same here (classic survives only as the `low` tier's lighting model, the master `'classic'` switch dies). Defer the deletion until the modern pipeline has survived real use for a while.
5. **Docs & memory**: the living graphics plan (029) and night plans (032/033/034) get status updates pointing here; memories updated (`shadows-deferred` note about the T3 fork landing, headlight MVP note retired).

## Tasks

- [ ] Tier definition table (from measured per-feature ms) + `graphics.quality: 'low'|'medium'|'high'|'ultra'` preset applier (presets set the individual toggles; individual overrides still respected — precedent: vehicle reflection presets).
- [ ] Auto-pick heuristic at first launch (GPU renderer string + a 2-second self-bench) with manual override in settings UI.
- [ ] Full bench sweep per tier; fix budget violations by re-tiering; record the final matrix (tier × scene → ms) here.
- [ ] Sign-off sweep with the user (screenshot matrix tooling from 001); flip defaults.
- [ ] Cleanup pass: dead classic-only branches inventory (deletion PR deferred — list them here), config defaults, debug overlay regrouping (one "Rendering" section).
- [ ] Update docs/plans/029 (+032/033/034) statuses + memories; move this chain's docs from ideas/ to docs/plans/ numbering if the project convention prefers (decide with the user).

## Verification

- High tier holds ≤ 16.6 ms p95 on every bench scene on the reference machine; low tier runs on the weakest hardware we care about (define it here).
- New-user first launch lands on a sensible tier automatically.

## Measurements

_(record before closing the chain)_

- final tier × scene frame-ms matrix: …
- auto-pick decisions on tested GPUs: …
