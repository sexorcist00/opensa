#pragma once
// Version gate: refuse to patch anything unless the host is exactly GTA:SA 1.0 US. Reads the exe file size +
// the generated fingerprint anchors FROM DISK — so a loaded limit adjuster (FLA/OLA) that has patched code in
// MEMORY cannot make us mis-identify the version. Wrong fingerprint → patch nothing, log, return.
#include <windows.h>
#include <cstdint>

#include "generated/patches.hpp"
#include "log.hpp"

namespace pm {

constexpr uintptr_t kImageBase = 0x400000;

inline uintptr_t HostBase() {
  return reinterpret_cast<uintptr_t>(GetModuleHandleA(nullptr));
}

// A 1.0 US virtual address (linked at 0x400000) → its runtime address in this process (for the memory
// site-verify; unrelated to the disk fingerprint below).
inline uintptr_t Runtime(uint32_t va) {
  return HostBase() + (static_cast<uintptr_t>(va) - kImageBase);
}

inline bool IsSupportedExe(Log& log) {
  char path[MAX_PATH];
  if (GetModuleFileNameA(nullptr, path, sizeof(path)) == 0) {
    log.Line("[perfect-map] fingerprint: cannot resolve exe path — UNSUPPORTED");
    return false;
  }
  HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    log.Line("[perfect-map] fingerprint: cannot open exe — UNSUPPORTED");
    return false;
  }

  DWORD sizeHigh = 0;
  const DWORD size = GetFileSize(file, &sizeHigh);
  if (sizeHigh != 0 || size != gen::kExeSize) {
    log.Line("[perfect-map] fingerprint: exe size mismatch — UNSUPPORTED, patching nothing");
    CloseHandle(file);
    return false;
  }

  for (uint32_t i = 0; i < gen::kFingerprintCount; ++i) {
    const gen::FileAnchor& anchor = gen::kFingerprint[i];
    unsigned char buffer[32];
    if (anchor.length > sizeof(buffer) ||
        SetFilePointer(file, anchor.offset, nullptr, FILE_BEGIN) == INVALID_SET_FILE_POINTER) {
      log.Line("[perfect-map] fingerprint: bad anchor read — UNSUPPORTED");
      CloseHandle(file);
      return false;
    }
    DWORD got = 0;
    if (!ReadFile(file, buffer, anchor.length, &got, nullptr) || got != anchor.length) {
      log.Line("[perfect-map] fingerprint: short anchor read — UNSUPPORTED");
      CloseHandle(file);
      return false;
    }
    for (uint32_t j = 0; j < anchor.length; ++j) {
      if (buffer[j] != anchor.bytes[j]) {
        log.Line("[perfect-map] fingerprint: anchor mismatch — UNSUPPORTED, patching nothing:");
        log.Line(anchor.name);
        CloseHandle(file);
        return false;
      }
    }
  }

  CloseHandle(file);
  log.Line("[perfect-map] fingerprint OK — GTA:SA 1.0 US");
  return true;
}

}  // namespace pm
