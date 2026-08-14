#pragma once
// Step 2 — the classifier, observed and not acted on. We repoint ONE call: the
// `call CCutsceneObject::SetupCarPipeAtomicsForClump` inside `SetModelIndex`, which fires once per cutscene
// object as a scene loads. Our stand-in logs what the model TYPE read returns (the vtable-slot-4 call step 3's
// deferral depends on) and then calls the original, unchanged.
//
// Rendering is untouched by this patch. Its whole job is to prove the model-type read in the field before a
// render path depends on it — a wrong vtable slot would be a call through a garbage pointer.
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
 * Stands in for `SetupCarPipeAtomicsForClump(modelId, clump)` at its ONE call site. Logs
 * `<modelId> <modelType> <isCutsceneVehicle>` — model type 6 is a vehicle, 7 a ped, 5 a clump prop — then runs
 * the original so the blessed-six pipe setup still happens.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcSetupCarPipeAtomicsForClump(uint32_t modelId,
                                                                                          void* clump) {
  if (gCensusLines < kCensusLineLimit) {
    ++gCensusLines;
    const uint8_t type = game::ModelType(game::ModelInfo(static_cast<int16_t>(modelId)));
    asi::AppendLabelled(kLogFile, "[census] model/type/vehicle", static_cast<int32_t>(modelId), type,
                        type == game::kModelInfoVehicle ? 1 : 0);
  }
  if (gSetupCarPipe != nullptr) {
    gSetupCarPipe(modelId, clump);
  }
}

inline constexpr const char* kCensusSites[] = {
    "CCutsceneObject.SetModelIndex.callSetupCarPipe",
    "CCutsceneObject.SetupCarPipeAtomicsForClump.entry",
};

inline void ApplyCensus(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "census: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kCensusSites, 2)) {
    log.Tagged(plugin.tag, "census: DEFER (patching nothing) — someone else owns the cutscene load path");
    return;
  }
  const asi::ByteAnchor* callSite = asi::FindSite(plugin.tables, kCensusSites[0]);
  const asi::ByteAnchor* target = asi::FindSite(plugin.tables, kCensusSites[1]);
  if (callSite == nullptr || target == nullptr) {
    log.Tagged(plugin.tag, "census: site name not in the catalogue — DEFER");
    return;
  }
  // The original callee comes from the call site's OWN rel32, then has to agree with the catalogue's entry
  // address. Decoding it means we never hard-code a callee; cross-checking it means a rel32 that points
  // somewhere unexpected (a relocated body, a foreign hook) stops us instead of being followed blindly.
  const uintptr_t site = asi::Runtime(callSite->address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(site + 1);
  const uintptr_t callee = site + 5 + static_cast<uintptr_t>(rel);
  if (callee != asi::Runtime(target->address)) {
    log.Tagged(plugin.tag, "census: call site does not point at SetupCarPipeAtomicsForClump — DEFER");
    return;
  }
  gSetupCarPipe = reinterpret_cast<SetupCarPipeFn>(callee);
  const bool ok = asi::WriteCall(site, reinterpret_cast<uintptr_t>(&PcSetupCarPipeAtomicsForClump));
  log.Tagged(plugin.tag, ok ? "census APPLIED (verify-only payload): cutscene model types will be logged"
                            : "census: patch write FAILED (see VirtualProtect)");
}

}  // namespace pc::patches
