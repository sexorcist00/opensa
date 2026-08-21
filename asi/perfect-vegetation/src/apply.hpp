#pragma once
// Apply orchestration — perfect-vegetation's `asi::ApplyFn`. Runs the enabled fixes, each gated by config.hpp.
// Compiled only into the APPLY build.
//
// Coexistence: every site this plugin will own lives in the ATOMIC render path (an atomic's render callback and
// the model-load point that installs it), which no limit adjuster touches (FLA and OLA relocate pools and
// placement arrays) — so the fixes apply regardless of the adjuster mask, and each one still verify-and-defers
// on its own bytes before writing. The SkyGfx fork is the neighbour that matters: it owns the building
// PIPELINE, never the atomic render CALLBACK, and this plugin wraps the callback — see plan 001.
#include <asi/log.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"
// Compiled into every build even before a payload uses it, so the pure weight math is type-checked from step 0.
#include "patches/weights.hpp"

namespace pveg {

inline void ApplyPatches(asi::Log& log, const asi::Plugin& plugin, unsigned adjusterMask) {
#if !PVEG_CENSUS && !PVEG_FIX_CARDS
  log.Tagged(plugin.tag, "scaffold build: no payload enabled yet (plan 001 step 0) — patching nothing");
#endif

  (void)adjusterMask;
  (void)plugin;
  (void)log;
}

}  // namespace pveg
