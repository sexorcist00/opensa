#pragma once
// perfect-vegetation's PAYLOAD switches (the framework's own — ASI_APPLY / ASI_DEBUG — live in the SDK's
// config.hpp). Per-fix flags allow bring-up bisection: enable one fix at a time under Wine.
#include <asi/config.hpp>

// The plugin's fixes are compiled only into an APPLY build; PVEG_APPLY mirrors the framework switch so the
// payload headers keep one name to gate on. Guarded, so a `-DPVEG_APPLY=…` on the command line is honoured.
#ifndef PVEG_APPLY
#define PVEG_APPLY ASI_APPLY
#endif

#ifndef PVEG_CENSUS
#define PVEG_CENSUS 0  // [plan 001 step 2] log which atomics classify as impostors, and how many draw per frame
#endif

#ifndef PVEG_FIX_CARDS
#define PVEG_FIX_CARDS 0  // [plan 001 step 3] the fix: per-card material alpha from the view weight
#endif

#ifndef PVEG_TRACE
#define PVEG_TRACE 0  // 1 = trace per-atomic decisions into the log (make DEBUG=1)
#endif
