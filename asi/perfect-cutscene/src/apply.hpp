#pragma once
// Apply orchestration — perfect-cutscene's `asi::ApplyFn`. Runs the enabled fixes, each gated by config.hpp.
// Compiled only into the APPLY build.
//
// Coexistence: every site this plugin owns lives in the CUTSCENE-object / car-FX-pipe zone, which no limit
// adjuster touches (FLA and OLA relocate pools and placement arrays) — so the fixes apply regardless of the
// adjuster mask, and each one still verify-and-defers on its own bytes before writing.
#include <asi/log.hpp>
#include <asi/plugin.hpp>

#include "config.hpp"

namespace pc {

inline void ApplyPatches(asi::Log& log, const asi::Plugin& plugin, unsigned adjusterMask) {
#if !PC_CENSUS && !PC_DEFER_ALPHA && !PC_BLESSED_SIX
  log.Tagged(plugin.tag, "scaffold build: no payload enabled yet (plan 001 step 1) — patching nothing");
#endif

  (void)adjusterMask;
  (void)plugin;
  (void)log;
}

}  // namespace pc
