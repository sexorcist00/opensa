#pragma once
// Step 3 — THE fix. One call is repointed: the inline `call CRenderer::RenderOneNonRoad(entity)` in
// `RenderEverythingBarRoads`' visible-entity loop. A cutscene object whose model is a VEHICLE goes into the
// engine's own sorted entity list instead — the same list, callback and flush (`RenderFadingInEntities`)
// gameplay vehicles have used all along, which draws it after every other entity of the pass, back-to-front.
// Everything else falls straight through to the original.
//
// Why here and not per-atomic: `m_alphaList` (the vehicle alpha-atomic list) is cleared and flushed INSIDE one
// entity's `RenderOneNonRoad`, so atomics inserted from a cutscene object would never be drawn. The entity
// list is the mechanism that actually runs late in the frame. Full reasoning: plan 001's design section.
#include <cstdint>

#include <asi/fingerprint.hpp>
#include <asi/hook.hpp>
#include <asi/log.hpp>
#include <asi/plugin.hpp>
#include <asi/verify.hpp>

#include "../config.hpp"
#include "../game.hpp"

namespace pc::patches {

using RenderOneNonRoadFn = void(__cdecl*)(void*);
using InsertEntityIntoSortedListFn = uint8_t(__cdecl*)(void*, float);

inline RenderOneNonRoadFn gRenderOneNonRoad = nullptr;
inline InsertEntityIntoSortedListFn gInsertEntityIntoSortedList = nullptr;

/**
 * Stands in for the loop's `RenderOneNonRoad(entity)`. A classified cutscene vehicle is deferred; if the
 * sorted list is full the insert returns false and we render inline exactly as before — a car is never lost.
 * The deferred entity is rendered later by `CVisibilityPlugins::RenderEntity`, which calls this same
 * `RenderOneNonRoad` — through the ORIGINAL pointer, not this call site, so there is no re-entry.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcRenderOneNonRoad(void* entity) {
  if (game::IsCutsceneVehicleObject(entity) && gInsertEntityIntoSortedList != nullptr &&
      gInsertEntityIntoSortedList(entity, game::DistanceFromCamera(entity)) != 0) {
    return;
  }
  gRenderOneNonRoad(entity);
}

inline constexpr const char* kDeferSites[] = {
    "CRenderer.RenderEverythingBarRoads.callRenderOneNonRoad",
    "CRenderer.RenderOneNonRoad.entry",
    "CVisibilityPlugins.InsertEntityIntoSortedList.entry",
};

inline void ApplyDefer(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "defer: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kDeferSites, 3)) {
    log.Tagged(plugin.tag, "defer: DEFER (patching nothing) — someone else owns the entity render path");
    return;
  }
  const asi::ByteAnchor* callSite = asi::FindSite(plugin.tables, kDeferSites[0]);
  const asi::ByteAnchor* renderOne = asi::FindSite(plugin.tables, kDeferSites[1]);
  const asi::ByteAnchor* insert = asi::FindSite(plugin.tables, kDeferSites[2]);
  if (callSite == nullptr || renderOne == nullptr || insert == nullptr) {
    log.Tagged(plugin.tag, "defer: site name not in the catalogue — DEFER");
    return;
  }
  // Same rule as the census patch: the callee is decoded from the site's own rel32 and must agree with the
  // catalogue, so we never follow a call site that points somewhere we did not expect.
  const uintptr_t site = asi::Runtime(callSite->address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(site + 1);
  const uintptr_t callee = site + 5 + static_cast<uintptr_t>(rel);
  if (callee != asi::Runtime(renderOne->address)) {
    log.Tagged(plugin.tag, "defer: loop call site does not point at RenderOneNonRoad — DEFER");
    return;
  }
  gRenderOneNonRoad = reinterpret_cast<RenderOneNonRoadFn>(callee);
  gInsertEntityIntoSortedList =
      reinterpret_cast<InsertEntityIntoSortedListFn>(asi::Runtime(insert->address));
  const bool ok = asi::WriteCall(site, reinterpret_cast<uintptr_t>(&PcRenderOneNonRoad));
  log.Tagged(plugin.tag, ok ? "defer APPLIED: cutscene vehicles now render in the sorted entity pass"
                            : "defer: patch write FAILED (see VirtualProtect)");
}

}  // namespace pc::patches
