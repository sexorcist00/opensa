// perfect-map.asi — entry point. On DLL_PROCESS_ATTACH it hands off to the framework: open the log,
// fingerprint-gate the exe, detect adjusters, and (plan 003) byte-verify every patch site in DRY-RUN. The
// limit patches themselves (apply) land in plan 004. KERNEL32-only, static, -nostdlib (see the Makefile).
#include <windows.h>

#include "patch_table.hpp"

// The DLL entry point directly (via `-nostdlib -e _DllMain@12`) so no CRT startup is linked — the .asi imports
// KERNEL32 only and loads on any Windows SA runs on. `extern "C"` keeps the stdcall name un-mangled for `-e`.
extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID /*reserved*/) {
  if (reason == DLL_PROCESS_ATTACH) {
    DisableThreadLibraryCalls(instance);
    pm::OnAttach();
  }
  return TRUE;
}
