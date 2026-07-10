#pragma once
// Fix #6 (2dfx emitter leak/crash on LODs): null-guard the fx-system use-after-free. See plan 008 for the full RE.
//
// Root: the fx manager reaps a finished FxSystem_c (FxManager_c::Update 0x4A9A80 → DestroyFxSystem 0x4A9810 →
// ~FxSystem_c zeroes m_SystemBP @+8) WITHOUT unlinking the entity's FxEntitySystem node in Fx_c::m_FxEntities.
// On stream-out CEntity::DestroyEffects → Fx_c::DestroyEntityFx (0x4A1280) then does node->m_System->Kill()
// (0x4AA3F0 → Stop 0x4AA390) on that dangling system → `mov cl,[m_SystemBP(null)+0x1B]` → AV 0x004AA3A1.
//
// DestroyEntityFx already RemoveItems + `operator delete`s the node regardless of the Kill — so the ONLY defect is
// the redundant Kill()/Stop() dereferencing an already-freed system. A dead system has m_SystemBP == null (the dtor
// zeroed it); Stop/Play on it has nothing to do. So the minimal, correct fix is to null-guard the two functions that
// deref m_SystemBP unconditionally: FxSystem_c::Stop (0x4AA390, the crash) and Play (0x4AA2F0, the symmetric path).
// Guarding Stop neutralises Kill (Kill just calls Stop then writes a state byte on the — not-yet-reused — block).
// This is a genuine lifecycle fix, not a pool bump: particles still unload via the normal node-delete path; we only
// stop the dead-system deref. It lets particle 2dfx ride LODs without the crash (plan 010).
//
// Both are thiscall, 0 args (ret 0). Assumes the fixed 0x400000 image base (SA 1.0, no ASLR).
#include <windows.h>
#include <cstdint>

#include "../config.hpp"
#include "../fingerprint.hpp"  // Runtime(), HostBase()
#include "../hook.hpp"
#include "../log.hpp"
#include "../mem.hpp"

namespace pm::patches {

#if PM_FX2DFX_LOG
inline int gFxGuardHits = 0;

// Append `[dbg] fx2dfx dead-system caught #N` to the log (the guard runs after OnAttach closed its Log). Only ever
// called on the RARE null-blueprint path (a genuinely reaped system) — never on the hot live-system path.
inline void PmFxDeadSystemLog(void* /*sys*/) {
  ++gFxGuardHits;
  if (gFxGuardHits > 32) {
    return;  // enough proof; stop spamming the log
  }
  char path[MAX_PATH];
  HostDir(path, sizeof(path));
  lstrcatA(path, "perfect-map-asi.log");
  HANDLE f = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) {
    return;
  }
  char buf[64] = "[dbg] fx2dfx dead-system Stop/Play caught #";
  char num[12];
  int n = 0;
  int v = gFxGuardHits;
  do {
    num[n++] = static_cast<char>('0' + v % 10);
    v /= 10;
  } while (v);
  char* p = buf;
  while (*p) {
    ++p;
  }
  while (n) {
    *p++ = num[--n];
  }
  *p++ = '\r';
  *p++ = '\n';
  DWORD w = 0;
  WriteFile(f, buf, static_cast<DWORD>(p - buf), &w, nullptr);
  CloseHandle(f);
}
#endif

namespace detail {

// Build a null-blueprint guard trampoline for a thiscall(this=ecx), 0-arg function whose first `savedLen` bytes
// (whole instructions, >=5) we relocate. Stub: if `this->m_SystemBP (+8)` is null → `ret`; else run the saved
// prologue and jmp to `cont`. Then overwrite the entry with a 5-byte jmp to the stub.
inline bool InstallNullBpGuard(uintptr_t entry, uintptr_t cont, const uint8_t* saved, uint32_t savedLen) {
  uint8_t* t = AllocExec(48 + savedLen);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x41;
  t[p++] = 0x08;  // mov eax, [ecx+8]   (m_SystemBP)
  t[p++] = 0x85;
  t[p++] = 0xC0;  // test eax, eax
#if PM_FX2DFX_LOG
  // Null path: log the catch (rare) then ret. `jnz relocated` skips the whole logging+ret block.
  const uint32_t jnzAt = p;
  t[p++] = 0x0F;
  t[p++] = 0x85;  // jnz rel32 → relocated (patched after we know the offset)
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x00;
  t[p++] = 0x60;  // pushad
  t[p++] = 0x51;  // push ecx  (the FxSystem_c* this)
  EmitCall(t, p, base, reinterpret_cast<uintptr_t>(&PmFxDeadSystemLog));
  t[p++] = 0x83;
  t[p++] = 0xC4;
  t[p++] = 0x04;  // add esp, 4
  t[p++] = 0x61;  // popad
  t[p++] = 0xC3;  // ret
  const uint32_t relocated = p;
  const int32_t rel = static_cast<int32_t>(relocated) - static_cast<int32_t>(jnzAt + 6);
  t[jnzAt + 2] = static_cast<uint8_t>(rel);
  t[jnzAt + 3] = static_cast<uint8_t>(rel >> 8);
  t[jnzAt + 4] = static_cast<uint8_t>(rel >> 16);
  t[jnzAt + 5] = static_cast<uint8_t>(rel >> 24);
#else
  t[p++] = 0x75;
  t[p++] = 0x01;  // jnz +1  (skip the ret → run the original)
  t[p++] = 0xC3;  // ret     (dead system → no-op; thiscall, 0 args)
#endif
  for (uint32_t i = 0; i < savedLen; ++i) {
    t[p++] = saved[i];  // relocated prologue (position-independent movs/pushes — no rel operands)
  }
  EmitJmp(t, p, base, cont);
  return WriteJmp(entry, base);
}

}  // namespace detail

// Original prologues we relocate (whole instructions covering the 5-byte jmp), + their continuations.
inline constexpr uint8_t kFxStopEntry[] = {0x56, 0x8b, 0xf1, 0x8b, 0x46, 0x08};  // @0x4AA390 push esi;mov esi,ecx;mov eax,[esi+8]
inline constexpr uint8_t kFxPlayEntry[] = {0x51, 0x56, 0x8b, 0xf1, 0x80, 0x7e, 0x50, 0x02};  // @0x4AA2F0 push ecx;push esi;mov esi,ecx;cmp byte[esi+0x50],2

inline void ApplyFx2dfx(Log& log) {
  if (HostBase() != 0x400000) {
    log.Line("[perfect-map] fx2dfx: unexpected image base — DEFER");
    return;
  }
  struct Site {
    uint32_t va;
    const uint8_t* bytes;
    uint32_t len;
    const char* name;
  };
  const Site sites[] = {
      {0x4aa390, kFxStopEntry, sizeof(kFxStopEntry), "FxSystem_c::Stop 0x4AA390"},
      {0x4aa2f0, kFxPlayEntry, sizeof(kFxPlayEntry), "FxSystem_c::Play 0x4AA2F0"},
  };
  bool anyDiff = false;
  for (const Site& s : sites) {
    if (!VerifyBytes(Runtime(s.va), s.bytes, s.len)) {
      anyDiff = true;
      log.Line("[perfect-map] fx2dfx: site DIFFERS (adjuster/PF owns it):");
      log.Line(s.name);
    }
  }
  if (anyDiff) {
    log.Line("[perfect-map] fx2dfx: DEFER (patching nothing) — a hook already owns the fx zone");
    return;
  }
  const bool a = detail::InstallNullBpGuard(Runtime(0x4aa390), Runtime(0x4aa396), kFxStopEntry, sizeof(kFxStopEntry));
  const bool b = detail::InstallNullBpGuard(Runtime(0x4aa2f0), Runtime(0x4aa2f8), kFxPlayEntry, sizeof(kFxPlayEntry));
  log.Line(a && b ? "[perfect-map] fx2dfx APPLIED: FxSystem_c::Stop/Play null-blueprint guarded (2dfx UAF fixed)"
                  : "[perfect-map] fx2dfx: patch write FAILED (see VirtualProtect)");
}

}  // namespace pm::patches
