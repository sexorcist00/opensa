#pragma once
// Step 3 — THE fix. One call is repointed: the inline `call CRenderer::RenderOneNonRoad(entity)` in
// `RenderEverythingBarRoads`' visible-entity loop. A cutscene object that is not a skinned actor (a car, a
// prop — see game.hpp's classifier) goes into the engine's own sorted entity list instead — the same list, callback and flush (`RenderFadingInEntities`)
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
 * Stands in for the loop's `RenderOneNonRoad(entity)`. A classified cutscene object is deferred; if the
 * sorted list is full the insert returns false and we render inline exactly as before — a car is never lost.
 * The deferred entity is rendered later by `CVisibilityPlugins::RenderEntity`, which calls this same
 * `RenderOneNonRoad` — through the ORIGINAL pointer, not this call site, so there is no re-entry.
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcRenderOneNonRoad(void* entity) {
  if (game::IsDeferrableCutsceneObject(entity) && gInsertEntityIntoSortedList != nullptr &&
      gInsertEntityIntoSortedList(entity, game::DistanceFromCamera(entity)) != 0) {
    return;
  }
  gRenderOneNonRoad(entity);
}

/**
 * Stands in for `RenderOneNonRoad(entity)` at the DEFERRED end — inside `CVisibilityPlugins::RenderEntity`,
 * after it has set the alpha-test ref to 100 (or 0 in an interior area). For one of OUR deferred cutscene
 * objects in the outdoor world we put the ref back to the 140 the main pass would have used, so this plugin
 * changes draw ORDER and nothing else: mod cutscene glass sits at alpha 102–125, i.e. between the two refs, so
 * without this the deferral would silently start rendering glass the game used to discard (measured on
 * PROLOG3, the one confirmed outdoor scene of the step-3 gate — its cop car's windscreen turned matte).
 * Whether we WANT that glass is a separate decision, deliberately not taken here (plan 001's open options).
 */
__attribute__((force_align_arg_pointer)) inline void __cdecl PcRenderDeferredEntity(void* entity) {
  if (!game::IsDeferrableCutsceneObject(entity) || !game::IsOutdoorArea()) {
    gRenderOneNonRoad(entity);

    return;
  }
  game::SetRenderState(game::kRsAlphaTestFunctionRef, game::kOutdoorAlphaRef);
  gRenderOneNonRoad(entity);
  // Back to what RenderEntity itself chose for this entity, so the next item in the list is unaffected.
  game::SetRenderState(game::kRsAlphaTestFunctionRef,
                       game::ModelDontWriteZBuffer(entity) ? 0 : game::kDeferredAlphaRef);
}

inline constexpr const char* kDeferSites[] = {
    "CRenderer.RenderEverythingBarRoads.callRenderOneNonRoad",
    "CRenderer.RenderOneNonRoad.entry",
    "CVisibilityPlugins.InsertEntityIntoSortedList.entry",
    "RwHelper.GetAnimHierarchyFromSkinClump.entry",
    "CVisibilityPlugins.RenderEntity.callRenderOneNonRoad",
};

/**
 * Repoint one `E8 rel32` call site at `replacement`, but only after its own rel32 decodes to `expected` — so a
 * site that points anywhere we did not predict (a relocated body, a foreign hook) stops us instead of being
 * followed blindly. Returns the original callee, or 0 when the site is not what the catalogue says.
 */
inline uintptr_t RepointCall(const asi::ByteAnchor& site, uintptr_t expected, void* replacement) {
  const uintptr_t at = asi::Runtime(site.address);
  const int32_t rel = *reinterpret_cast<const int32_t*>(at + 1);
  const uintptr_t callee = at + 5 + static_cast<uintptr_t>(rel);
  if (callee != expected || !asi::WriteCall(at, reinterpret_cast<uintptr_t>(replacement))) {
    return 0;
  }

  return callee;
}

inline void ApplyDefer(asi::Log& log, const asi::Plugin& plugin) {
  if (asi::HostBase() != game::kExpectedImageBase) {
    log.Tagged(plugin.tag, "defer: unexpected image base — DEFER (game.hpp reads absolute VAs)");
    return;
  }
  if (!asi::VerifySitesOrDefer(log, plugin.tag, plugin.tables, kDeferSites, 5)) {
    log.Tagged(plugin.tag, "defer: DEFER (patching nothing) — someone else owns the entity render path");
    return;
  }
  const asi::ByteAnchor* loopCall = asi::FindSite(plugin.tables, kDeferSites[0]);
  const asi::ByteAnchor* renderOne = asi::FindSite(plugin.tables, kDeferSites[1]);
  const asi::ByteAnchor* insert = asi::FindSite(plugin.tables, kDeferSites[2]);
  const asi::ByteAnchor* deferredCall = asi::FindSite(plugin.tables, kDeferSites[4]);
  if (loopCall == nullptr || renderOne == nullptr || insert == nullptr || deferredCall == nullptr) {
    log.Tagged(plugin.tag, "defer: site name not in the catalogue — DEFER");
    return;
  }
  const uintptr_t original = asi::Runtime(renderOne->address);
  gRenderOneNonRoad = reinterpret_cast<RenderOneNonRoadFn>(original);
  gInsertEntityIntoSortedList = reinterpret_cast<InsertEntityIntoSortedListFn>(asi::Runtime(insert->address));

  // The ref patch goes in FIRST: between the two writes the deferral would otherwise be live for a moment
  // without it, and this runs during DLL attach where a frame can already be rendering.
  if (RepointCall(*deferredCall, original, reinterpret_cast<void*>(&PcRenderDeferredEntity)) == 0) {
    log.Tagged(plugin.tag, "defer: RenderEntity call site is not what the catalogue says — DEFER");
    return;
  }
  const bool ok = RepointCall(*loopCall, original, reinterpret_cast<void*>(&PcRenderOneNonRoad)) != 0;
  log.Tagged(plugin.tag, ok ? "defer APPLIED: cutscene cars/props render in the sorted entity pass, "
                              "outdoor alpha-test ref preserved"
                            : "defer: loop call site is not what the catalogue says — DEFER (ref patch stays)");
}

}  // namespace pc::patches
