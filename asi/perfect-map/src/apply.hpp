#pragma once
// Apply orchestration — perfect-map's `asi::ApplyFn`. Runs the enabled fixes, each gated by config.hpp and
// coexistence: int16 is applied regardless of adjusters (none of them fix it); the two array relocations DEFER
// when FLA/OLA is present (they own those zones). Compiled only into the APPLY build.
#include <asi/coexistence.hpp>
#include <asi/log.hpp>

#include "config.hpp"

#if PM_FIX_INT16
#include "patches/int16.hpp"
#endif

#if PM_FIX_FX2DFX
#include "patches/fx2dfx.hpp"
#endif

namespace pm {

inline void ApplyPatches(asi::Log& log, unsigned adjusterMask) {
#if PM_FIX_INT16
  patches::ApplyInt16(log);  // no adjuster fixes int16 → always apply
#endif

#if PM_FIX_FX2DFX
  patches::ApplyFx2dfx(log);  // fx zone is disjoint from adjusters → always apply (internal verify-and-defer)
#endif

#if PM_FIX_LOADEDBUILDINGS
  if (adjusterMask != 0) {
    log.Line("[perfect-map] loaded-buildings: adjuster present → DEFER");
  } else {
    log.Line("[perfect-map] loaded-buildings: TODO (004b)");
  }
#endif

#if PM_FIX_IPLINDEX
  if (adjusterMask != 0) {
    log.Line("[perfect-map] ipl-entity-index: adjuster present → DEFER");
  } else {
    log.Line("[perfect-map] ipl-entity-index: TODO (004b)");
  }
#endif

  (void)adjusterMask;
  (void)log;
}

}  // namespace pm
