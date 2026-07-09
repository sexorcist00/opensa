#pragma once
// Fix #1 (buildings): lift the int16 IplDef building-pool-range ceiling. Two parts:
//   (a) OBSERVE IncludeEntity (0x404C90 → body 0x1563730): mirror the building min/max into an int32 sidecar
//       keyed by IPL slot. Read-only w.r.t. the engine — cannot corrupt it.
//   (b) REDIRECT RemoveIpl's two int16 bound READS (movsx edi/edx from IplDef+0x22/+0x24) to the int32 sidecar,
//       so the original delete loop iterates the FULL range instead of the truncated int16 one. Everything else
//       in RemoveIpl (object pass, dummy pass, delete path, car generators) runs unchanged — minimal blast radius.
// Dummies (firstDummy/lastDummy) are the same shape and are 004b. Assumes the fixed 0x400000 image base (SA 1.0
// has no ASLR); ApplyInt16 refuses otherwise. FIRST ITERATION — validate under Wine on the int16-repro bracket.
#include <windows.h>
#include <cstdint>

#include "../config.hpp"
#include "../fingerprint.hpp"  // Runtime(), HostBase()
#include "../hook.hpp"
#include "../log.hpp"
#include "../mem.hpp"

namespace pm::patches {

#if PM_INT16_LOG
inline int gDbgInc = 0;
inline int gDbgRmv = 0;

// Append signed-decimal `label a b c` to perfect-map-asi.log (the runtime hooks run after OnAttach closed its Log).
inline char* DbgItoa(int32_t v, char* out) {
  uint32_t u = v < 0 ? (*out++ = '-', 0u - static_cast<uint32_t>(v)) : static_cast<uint32_t>(v);
  char tmp[12];
  int n = 0;
  do {
    tmp[n++] = static_cast<char>('0' + u % 10);
    u /= 10;
  } while (u);
  while (n) {
    *out++ = tmp[--n];
  }
  return out;
}

inline void DbgAppend(const char* label, int32_t a, int32_t b, int32_t c) {
  char path[MAX_PATH];
  HostDir(path, sizeof(path));
  lstrcatA(path, "perfect-map-asi.log");
  HANDLE f = CreateFileA(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS,
                         FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) {
    return;
  }
  char buf[160];
  char* p = buf;
  for (const char* s = label; *s; ++s) {
    *p++ = *s;
  }
  *p++ = ' ';
  p = DbgItoa(a, p);
  *p++ = ' ';
  p = DbgItoa(b, p);
  *p++ = ' ';
  p = DbgItoa(c, p);
  *p++ = '\r';
  *p++ = '\n';
  DWORD w = 0;
  WriteFile(f, buf, static_cast<DWORD>(p - buf), &w, nullptr);
  CloseHandle(f);
}
#endif

constexpr int kMaxIpl = 256;                 // m_IplIndex is uint8 → at most 256 slots
constexpr uintptr_t kBuildingPool = 0xB74498;  // *(CPool<CBuilding>**)
constexpr uintptr_t kIplPool = 0x8E3FB0;       // *(CPool<IplDef>**)
constexpr uint32_t kSizeofBuilding = 0x38;
constexpr uint32_t kSizeofIplDef = 0x34;

// int32 sidecar for the building range (replaces the truncating int16 IplDef.firstBuilding/lastBuilding).
inline int32_t gFirstBuilding[kMaxIpl];
inline int32_t gLastBuilding[kMaxIpl];

// The RemoveIpl snapshot (taken at its entry, before the bound-read detours run). RemoveIpl is non-reentrant, so
// a single pair suffices. The detours read THESE, not gFirst/gLastBuilding — because the entry hook resets the
// slot to empty for the next load right after snapshotting.
inline int32_t gSnapFirst = 0x7FFFFFFF;
inline int32_t gSnapLast = static_cast<int32_t>(0x80000000);

inline uintptr_t IplDefPtr(int slot) {
  return *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(kIplPool)) +
         static_cast<uintptr_t>(slot) * kSizeofIplDef;
}

// cdecl observer the IncludeEntity trampoline calls with (iplSlot, entity) before the body runs. Accumulates the
// building pool-index range in int32 (PURE min/max). The lifecycle reset is done by the RemoveIpl snapshot hook
// (unload clears the slot), NOT by peeking the engine's IplDef.firstBuilding — that field stays SHRT_MAX for
// slots whose buildings are ALL > 32767 (the engine's unsigned min keeps 0x7FFF), which broke the old fresh-detect.
inline void PmIncludeObserver(int slot, void* entity) {
  if (static_cast<unsigned>(slot) >= kMaxIpl || !entity) {
    return;
  }
  const uint8_t type = *reinterpret_cast<uint8_t*>(reinterpret_cast<uintptr_t>(entity) + 0x36) & 7;
#if PM_INT16_LOG
  // Diagnostic: does the DUMMY pool (type 5) also overflow int16? (dummies aren't fixed yet — 004b.)
  if (type == 5 && gDbgInc < 24) {
    const uintptr_t db = *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(0xB744A0));
    const int32_t did = static_cast<int32_t>((reinterpret_cast<uintptr_t>(entity) - db) / kSizeofBuilding);
    if (did > 32767) {
      ++gDbgInc;
      DbgAppend("[dbg] incDUMMY slot/id", slot, did, 0);
    }
  }
#endif
  if (type != 1) {
    return;  // ENTITY_TYPE_BUILDING == 1 (dummies == 5 → 004b)
  }
  const uintptr_t base = *reinterpret_cast<uintptr_t*>(*reinterpret_cast<uintptr_t*>(kBuildingPool));
  const int32_t id = static_cast<int32_t>((reinterpret_cast<uintptr_t>(entity) - base) / kSizeofBuilding);
  if (id < gFirstBuilding[slot]) {
    gFirstBuilding[slot] = id;
  }
  if (id > gLastBuilding[slot]) {
    gLastBuilding[slot] = id;
  }
#if PM_INT16_LOG
  // Log the first few buildings whose pool index exceeds int16 (the interesting over-2^15 case): slot, id, last.
  if (id > 32767 && gDbgInc < 16) {
    ++gDbgInc;
    DbgAppend("[dbg] inc slot/id/last", slot, id, gLastBuilding[slot]);
  }
#endif
}

// RemoveIpl entry hook (ALWAYS on with the fix): snapshot the slot's int32 building range for the bound-read
// detours (which run a few instructions later), then RESET the slot to empty so its next load accumulates fresh.
// This is the lifecycle reset that replaces the broken IplDef.firstBuilding==SHRT_MAX peek.
inline void PmRemoveIplSnapshot(int slot) {
  if (static_cast<unsigned>(slot) >= kMaxIpl) {
    gSnapFirst = 0x7FFFFFFF;
    gSnapLast = static_cast<int32_t>(0x80000000);
    return;
  }
  gSnapFirst = gFirstBuilding[slot];
  gSnapLast = gLastBuilding[slot];
#if PM_INT16_LOG
  if (gDbgRmv < 40) {
    const uintptr_t ipldef = IplDefPtr(slot);
    const int32_t bf = *reinterpret_cast<int16_t*>(ipldef + 0x22);
    const int32_t bl = *reinterpret_cast<int16_t*>(ipldef + 0x24);
    if ((gSnapFirst != 0x7FFFFFFF && (gSnapFirst > 32767 || gSnapLast > 32767)) || bf < 0 || bl < 0) {
      ++gDbgRmv;
      DbgAppend("[dbg] rmvFIX slot/i16bFirst/snapFirst", slot, bf, gSnapFirst);
      DbgAppend("[dbg] rmvFIX slot/i16bLast/snapLast", slot, bl, gSnapLast);
    }
  }
#endif
  gFirstBuilding[slot] = 0x7FFFFFFF;
  gLastBuilding[slot] = static_cast<int32_t>(0x80000000);
}

namespace detail {

// Little-endian 32-bit store into a code buffer at `pos` (advances it).
inline void Put32(uint8_t* buf, uint32_t& pos, uint32_t value) {
  buf[pos++] = static_cast<uint8_t>(value);
  buf[pos++] = static_cast<uint8_t>(value >> 8);
  buf[pos++] = static_cast<uint8_t>(value >> 16);
  buf[pos++] = static_cast<uint8_t>(value >> 24);
}

inline void PutBytes(uint8_t* buf, uint32_t& pos, const uint8_t* src, uint32_t n) {
  for (uint32_t i = 0; i < n; ++i) {
    buf[pos++] = src[i];
  }
}

// Detour at RemoveIpl.firstBuilding (0x404B4A): set edi = gSnapFirst (the range snapshotted at RemoveIpl entry),
// run the clobbered `mov ecx,[0xB74498]`, jmp back to 0x404B54. No scratch regs needed → no push/pop.
inline bool InstallFirstBuildingDetour() {
  uint8_t* t = AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x3D;  // mov edi, [gSnapFirst]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapFirst));
  const uint8_t tail[] = {0x8B, 0x0D, 0x98, 0x44, 0xB7, 0x00};  // mov ecx, [0xB74498]  (relocated clobbered insn)
  PutBytes(t, p, tail, sizeof(tail));
  EmitJmp(t, p, base, Runtime(0x404B54));
  return WriteJmp(Runtime(0x404B4A), base);
}

// Detour at RemoveIpl.lastBuilding (0x404B5D): set edx = gSnapLast, run the clobbered `cmp edi,edx`, jmp to
// 0x404B63. No scratch regs needed.
inline bool InstallLastBuildingDetour() {
  uint8_t* t = AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x15;  // mov edx, [gSnapLast]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLast));
  const uint8_t tail[] = {0x3B, 0xFA};  // cmp edi, edx  (relocated clobbered insn)
  PutBytes(t, p, tail, sizeof(tail));
  EmitJmp(t, p, base, Runtime(0x404B63));
  return WriteJmp(Runtime(0x404B5D), base);
}

// Detour at the loop back-edge re-read of lastBuilding (0x404BA8: `movsx edx,word[ebx+0x24]`, then `inc edi;
// cmp edi,edx; jle`). The loop TERMINATION re-reads the truncated int16 every iteration — without this it stops
// after one building. Set edx = gSnapLast, run the clobbered `inc edi`, jmp to 0x404BAD. (0x404BA8 is also a jump
// target for the skip paths — they land on our jmp and do the same edx-reload + inc, so they stay correct.)
inline bool InstallLastBuildingLoopDetour() {
  uint8_t* t = AllocExec(24);
  if (!t) {
    return false;
  }
  const uintptr_t base = reinterpret_cast<uintptr_t>(t);
  uint32_t p = 0;
  t[p++] = 0x8B;
  t[p++] = 0x15;  // mov edx, [gSnapLast]  (abs32 follows)
  Put32(t, p, reinterpret_cast<uint32_t>(&gSnapLast));
  t[p++] = 0x47;  // inc edi  (relocated clobbered insn)
  EmitJmp(t, p, base, Runtime(0x404BAD));
  return WriteJmp(Runtime(0x404BA8), base);
}

}  // namespace detail

// We hook the two ENTRY points (they must be pristine — HookObserve overwrites them) and FORCE our bound-read
// detours over the three RemoveIpl read sites. The detours are self-contained (they hardcode the relocated stock
// instruction and jump to a fixed continuation), so they work whether the read site is pristine (OLA/vanilla) or
// already jmp-hooked by FLA — we simply overlay FLA's incomplete int16 patch with our complete one. We DO verify
// the detour CONTINUATION targets, so a future adjuster hooking THOSE makes us defer instead of corrupt.
inline constexpr uint8_t kIncludeEntry[] = {0xe9, 0x9b, 0xea, 0x15, 0x01};    // @0x404C90 IncludeEntity entry (jmp)
inline constexpr uint8_t kRemoveIplEntry[] = {0xa1, 0xb0, 0x3f, 0x8e, 0x00};  // @0x404B20 RemoveIpl entry
inline constexpr uint8_t kCont404B54[] = {0xa1, 0x9c, 0x44, 0xb7, 0x00};      // @0x404B54 mov eax,[0xB7449C]
inline constexpr uint8_t kCont404B63[] = {0x89, 0x4c, 0x24, 0x14};            // @0x404B63 mov [esp+0x14],ecx
inline constexpr uint8_t kCont404BAD[] = {0x83, 0xc5, 0x38};                  // @0x404BAD add ebp,0x38

inline void ApplyInt16(Log& log) {
  if (HostBase() != 0x400000) {
    log.Line("[perfect-map] int16: unexpected image base — DEFER");
    return;
  }
  for (int i = 0; i < kMaxIpl; ++i) {
    gFirstBuilding[i] = 0x7FFFFFFF;
    gLastBuilding[i] = static_cast<int32_t>(0x80000000);
  }
  // Verify every byte we hook or relocate (framework rule) before touching anything. Log the FIRST site that
  // differs by name + address so we can see which one an adjuster owns (FLA patches the RemoveIpl reads).
  struct Site {
    uint32_t va;
    const uint8_t* bytes;
    uint32_t len;
    const char* name;
  };
  const Site sites[] = {
      {0x404c90, kIncludeEntry, sizeof(kIncludeEntry), "IncludeEntity.entry 0x404C90"},
      {0x404b20, kRemoveIplEntry, sizeof(kRemoveIplEntry), "RemoveIpl.entry 0x404B20"},
      {0x404b54, kCont404B54, sizeof(kCont404B54), "RemoveIpl.cont 0x404B54"},
      {0x404b63, kCont404B63, sizeof(kCont404B63), "RemoveIpl.cont 0x404B63"},
      {0x404bad, kCont404BAD, sizeof(kCont404BAD), "RemoveIpl.cont 0x404BAD"},
  };
  bool anyDiff = false;
  for (const Site& s : sites) {
    const uintptr_t a = Runtime(s.va);
    if (!VerifyBytes(a, s.bytes, s.len)) {
      anyDiff = true;
      log.Line("[perfect-map] int16: site DIFFERS (adjuster owns it):");
      log.Line(s.name);
      if (Readable(a, 8)) {  // dump what the adjuster actually wrote (to plan coexistence)
        log.KeyHex("  found[0..3] ", *reinterpret_cast<const uint32_t*>(a));
        log.KeyHex("  found[4..7] ", *reinterpret_cast<const uint32_t*>(a + 4));
      }
    }
  }
  if (anyDiff) {
    log.Line("[perfect-map] int16: DEFER (patching nothing) — differing sites dumped above");
    return;
  }
  // Order matters: the snapshot hook (RemoveIpl entry) sets gSnap for the bound-read detours a few insns later.
  const bool s = HookObserve1Cont(Runtime(0x404b20), Runtime(0x404b25), kRemoveIplEntry, sizeof(kRemoveIplEntry),
                                  reinterpret_cast<void*>(&PmRemoveIplSnapshot));
  const bool a = HookObserve2(Runtime(0x404c90), Runtime(0x1563730), reinterpret_cast<void*>(&PmIncludeObserver));
  const bool b = detail::InstallFirstBuildingDetour();
  const bool c = detail::InstallLastBuildingDetour();
  const bool e = detail::InstallLastBuildingLoopDetour();  // the loop back-edge re-read — the completeness fix
  log.Line(s && a && b && c && e
               ? "[perfect-map] int16 APPLIED (buildings): IncludeEntity observed + RemoveIpl snapshot + bounds int32"
               : "[perfect-map] int16: patch write FAILED (see VirtualProtect)");
}

}  // namespace pm::patches
