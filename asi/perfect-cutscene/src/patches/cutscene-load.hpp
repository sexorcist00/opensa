#pragma once
// The cutscene-object LOAD path — one repointed call, two jobs. The call is
// `CCutsceneObject::SetModelIndex`'s `call SetupCarPipeAtomicsForClump`, which fires once per cutscene object
// as a scene loads, with the model id and the freshly built clump in hand.
//
// 1. **The census (step 2, observation only)** — logs how the object classifies. It earned its keep on round 1:
//    the model TYPE came back 5 (MODEL_INFO_CLUMP) for every cutscene object, cars included, because cutscene
//    models all live in the shared CUTOBJ slots. Round 2 logs the engine's own actor test instead (a skinned
//    clump is an ACTOR).
// 2. **The force-pipe skip (step 4, the fix)** — for a cutscene CAR/prop we do not run the original at all.
//    `SetupCarPipeAtomicsForClump` exists to stamp the vehicle pipeline (`0x53F2009A`) onto EVERY atomic of six
//    hard-coded models, because VANILLA cutscene DFFs carry no pipeline stamp of their own. Ours do, per
//    atomic and by translucency (opaque = vehicle pipe, translucent = default; plan 004 rounds 5–9) — so for
//    our models the stamp is not a fix, it is an override that puts GLASS on the vehicle env-map pipe. On a
//    raked surface that pipe's static env map covers the whole pane and reads as matte grey, which is exactly
//    what the field saw on PROLOG3's sheriff car: windscreen and rear screen matte, vertical side windows
//    clean, every one of them the same material (measured — plan 001 step 3 round 3).
//    Skipping makes the six behave like the other seventeen, which the field has already accepted.
#include <cstdint>

#include <asi/append-log.hpp>
#include <asi/fingerprint.hpp>
#include <asi/hook.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

#include "../config.hpp"
#include "../game.hpp"
#include "../identity.hpp"

namespace pc::patches {

using SetupCarPipeFn = void(__cdecl*)(uint32_t, void*);

inline SetupCarPipeFn gSetupCarPipe = nullptr;
inline int32_t gCensusLines = 0;

// One scene loads a handful of objects; the cap only stops a long session from growing the log without bound.
inline constexpr int32_t kCensusLineLimit = 200;

/**
 * Stands in for `SetupCarPipeAtomicsForClump(modelId, clump)` at its ONE call site. A skinned clump is an
 * actor: nothing to log a verdict about and nothing the force-pipe would touch, so it passes straight through.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcSetupCarPipeAtomicsForClump(uint32_t modelId,
                                                                                           void* clump) {
  const bool actor = clump == nullptr || game::ClumpIsSkinned(clump);

#if PC_CENSUS
  if (gCensusLines < kCensusLineLimit) {
    ++gCensusLines;
    void* modelInfo = game::ModelInfo(static_cast<int16_t>(modelId));
    const int32_t key = modelInfo == nullptr
                            ? 0
                            : static_cast<int32_t>(*reinterpret_cast<const uint32_t*>(
                                  reinterpret_cast<uintptr_t>(modelInfo) + game::kModelInfoKey));
    asi::AppendLabelled(kLogFile, "[census] model/key/skinned", static_cast<int32_t>(modelId), key, actor ? 1 : 0);
  }
#endif

#if PC_BLESSED_SIX
  if (!actor) {
    return;  // our DFF already says which atomics take the vehicle pipe — do not let the engine overwrite it
  }
#endif

  if (gSetupCarPipe != nullptr) {
    gSetupCarPipe(modelId, clump);
  }
}

inline constexpr const char* kLoadSites[] = {
    "CCutsceneObject.SetModelIndex.callSetupCarPipe",
    "CCutsceneObject.SetupCarPipeAtomicsForClump.entry",
    "RwHelper.GetAnimHierarchyFromSkinClump.entry",
    "CCutsceneObject.ms_sCutsceneVehNames.table",
};

inline void ApplyCutsceneLoad(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "cutscene-load: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  // The name table is verified but never written: if the six hard-coded models ever differ from what the
  // catalogue recorded, the assumption this patch rests on has changed and it must not run.
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kLoadSites, 4)) {
    log.Tagged(plugin.tag, "cutscene-load: DEFER (patching nothing) — someone else owns the cutscene load path");
    return;
  }
  const asi::ByteAnchor* callSite = asi::FindSite(plugin.tables, kLoadSites[0]);
  const asi::ByteAnchor* target = asi::FindSite(plugin.tables, kLoadSites[1]);
  if (callSite == nullptr || target == nullptr) {
    log.Tagged(plugin.tag, "cutscene-load: site name not in the catalogue — DEFER");
    return;
  }
  // The original callee comes from the call site's OWN rel32, then has to agree with the catalogue's entry
  // address. Decoding it means we never hard-code a callee; cross-checking it means a rel32 that points
  // somewhere unexpected (a relocated body, a foreign hook) stops us instead of being followed blindly.
  const uintptr_t site = asi::Runtime(callSite->address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(site + 1);
  const uintptr_t callee = site + 5 + static_cast<uintptr_t>(rel);
  if (callee != asi::Runtime(target->address)) {
    log.Tagged(plugin.tag, "cutscene-load: call site does not point at SetupCarPipeAtomicsForClump — DEFER");
    return;
  }
  gSetupCarPipe = reinterpret_cast<SetupCarPipeFn>(callee);
  const bool ok = asi::WriteCall(site, reinterpret_cast<uintptr_t>(&PcSetupCarPipeAtomicsForClump));
  if (!ok) {
    log.Tagged(plugin.tag, "cutscene-load: patch write FAILED (see VirtualProtect)");
    return;
  }
#if PC_BLESSED_SIX
  log.Tagged(plugin.tag, "cutscene-load APPLIED: the six force-piped models keep OUR per-atomic pipelines");
#else
  log.Tagged(plugin.tag, "cutscene-load APPLIED (census only): cutscene objects will be logged");
#endif
}

}  // namespace pc::patches
