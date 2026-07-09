#pragma once
// Build-time switches. Default = verify-only (plan 003); pass -DPM_APPLY=1 (`make APPLY=1`) to actually patch
// (plan 004). Per-fix flags allow bring-up bisection — enable one fix at a time under Wine.

#ifndef PM_APPLY
#define PM_APPLY 0  // 0 = verify-only; 1 = apply the enabled fixes below
#endif

#ifndef PM_FIX_INT16
#define PM_FIX_INT16 1  // IplDef int16 pool-range → int32 sidecar (the root 2^15 fix). No adjuster fixes this.
#endif

#ifndef PM_FIX_LOADEDBUILDINGS
#define PM_FIX_LOADEDBUILDINGS 0  // [004b] gpLoadedBuildings 4096 relocation — not yet implemented
#endif

#ifndef PM_FIX_IPLINDEX
#define PM_FIX_IPLINDEX 0  // [004b] IplEntityIndexArrays 40-slot relocation — not yet implemented
#endif

#ifndef PM_INT16_LOG
#define PM_INT16_LOG 0  // 1 = trace the int16 sidecar at runtime (IncludeEntity/RemoveIpl) into the log
#endif
