# sa-lod-generator/01 — The verbatim and decimate paths adopt the 2dfx policy

Part of [07 — LOD generators, extended](../readme.md). Depends on
[lod-common/01](../../../../../../tools/lod-common/docs/plans/005-2dfx-keep-policy.md). **Gated on nothing** — this is a
behaviour-preserving adoption; the real-SA capability that needs an ASI is
[02](02-particle-emitters.md).

## Context

This generator has two paths and they disagree about 2dfx in a way nobody chose:

- **verbatim** (`finalize.ts:203`) byte-copies the HD clump and drops only particles. Everything else
  survives **implicitly** — including types we have never decoded and would not want at LOD range (sun glare,
  enex markers).
- **decimate** (`finalize.ts:197`) rebuilds the section via `collectClumpEffects(hdDff, clump)`, whose
  default keep is all-but-particle. Same outcome, arrived at by a different route.

So a roadsign survives both, an enex marker survives both, and neither is a decision. The difference between
implicit survival and declared carry is the whole point of this step: today, dropping an undecoded type from
LODs requires editing a byte-copy path that has no notion of types at all.

## Decisions

1. **Verbatim becomes policy-driven too.** This is the substantive half of the plan — the byte-copy path must
   consult the same keep-set as the others, so an undecoded type can be dropped deliberately rather than
   riding along because nothing looked at it. The mechanism already exists
   (`extract2dfxEntries(bytes, keepTypes)` / `build2dfxSection`); the path simply does not use it.
2. **Decimate passes the policy's keep-set** to `collectClumpEffects` instead of leaning on its default.
   `collectClumpEffects`'s default keep then has no callers and can stop existing — a default that encodes a
   policy is a second place the policy lives.
3. **Output must be byte-identical, and where it cannot be, the plan says which types moved.** For the stock
   target the resolved policy reproduces today's sets exactly. If the policy deliberately drops an undecoded
   type that verbatim was carrying by accident, that is a real output change, and it belongs in this plan's
   measurements with the model count it affects — not in a later plan's noise.
4. **`stripParticleEffects` stays, for now.** It is the real-SA mandatory strip and it is
   [02](02-particle-emitters.md)'s to flip. Wiring it into the policy here without the engine fix would put a
   crash one config edit away.

## Tasks

- [ ] Route the verbatim path through `extract2dfxEntries(bytes, keepTypesFor(target))` + `build2dfxSection`
      instead of an unconditional byte copy.
- [ ] Route the decimate path's `collectClumpEffects` call through the policy keep-set; remove the function's
      policy-bearing default.
- [ ] Golden compare on a sample set, per path — verbatim and decimate separately, because they can fail
      differently.
- [ ] Census the delta: how many models carry an undecoded 2dfx type that verbatim was implicitly keeping,
      and what the policy now does with each. Record it even if the answer is zero — a count of zero is only
      evidence once the counted thing is known to be possible.
- [ ] Grep guard: no implicit keep and no policy-bearing default left in this package or in
      `collectClumpEffects`.

## Verification

- Stock-target LOD bytes unchanged across the sample set on BOTH paths, or the difference is enumerated by
  type and model in the measurements.
- Particles still stripped for real SA exactly as today.
- The policy is the only place a type's LOD fate is decided.

## Measurements / notes

_(record after implementation)_

- models carrying an undecoded 2dfx type on the verbatim path, and the policy's verdict on each: …
- sample set + golden-compare result per path: …
