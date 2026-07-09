#pragma once
// The patch-table runner + the ASI attach sequence. Plan 003 delivers the SAFE machinery in DRY-RUN mode:
// fingerprint-gate → detect adjusters → byte-verify every generated site → log the plan, ZERO writes. Plan 004
// adds the per-patch apply() functions (sidecar hooks / array relocation) and flips PM_APPLY on.
#include <cstdint>

#include "coexistence.hpp"
#include "config.hpp"
#include "fingerprint.hpp"
#include "generated/patches.hpp"
#include "log.hpp"
#include "mem.hpp"

#if PM_APPLY
#include "apply.hpp"
#endif

namespace pm {

// Byte-verify each patch site in MEMORY against its baseline. A pristine site is ours to apply (004); a site
// whose bytes DIFFER is already owned by an adjuster (FLA/OLA) → we would DEFER it, not double-patch (this is
// the coexistence case, not an error). Returns the number of pristine sites.
inline uint32_t VerifyAllSites(Log& log) {
  uint32_t pristine = 0;
  for (uint32_t i = 0; i < gen::kPatchSiteCount; ++i) {
    const gen::ByteAnchor& site = gen::kPatchSites[i];
    const bool ok = VerifyBytes(Runtime(site.address), site.bytes, site.length);
    log.Line(ok ? "[perfect-map] site pristine (would apply):"
                : "[perfect-map] site differs — adjuster owns it (would DEFER):");
    log.Line(site.name);
    log.KeyHex("  address ", site.address);
    if (ok) {
      ++pristine;
    }
  }
  return pristine;
}

// The whole DLL_PROCESS_ATTACH story.
inline void OnAttach() {
  Log log;
  log.Open();
#if PM_APPLY
  log.Line("[perfect-map] loaded — built " __DATE__ " " __TIME__ " (APPLY, plan 004)");
#else
  log.Line("[perfect-map] loaded — built " __DATE__ " " __TIME__ " (verify-only, plan 003)");
#endif

  if (!IsSupportedExe(log)) {
    log.Close();
    return;
  }
  const unsigned adjusters = DetectAdjusters(log);

#if PM_APPLY
  ApplyPatches(log, adjusters);
#else
  (void)adjusters;
  const uint32_t pristine = VerifyAllSites(log);
  log.KeyHex("[perfect-map] sites pristine ", pristine);
  log.KeyHex("[perfect-map] sites total    ", gen::kPatchSiteCount);
  log.Line(pristine == gen::kPatchSiteCount
               ? "[perfect-map] all sites pristine — catalogue byte-accurate, safe to apply (004)"
               : "[perfect-map] some sites pre-patched — those defer to the adjuster (expected with FLA/OLA)");
#endif
  log.Close();
}

}  // namespace pm
