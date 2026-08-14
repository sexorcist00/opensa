#pragma once
// The game structures this plugin reads, in ONE place. Every offset and address below was read out of the
// accepted exe (SHA1 8c23ceff…) and cross-checked against gta-reversed-modern — see plan 001's design table.
// Nothing here writes; the patches in `patches/` do that.
//
// The VAs are used as ABSOLUTE addresses: SA 1.0 is linked at 0x400000 and does not relocate, and every patch
// here refuses to install unless `asi::HostBase()` is that base (the same gate perfect-map's fx2dfx uses). The
// alternative — resolving through `asi::Runtime()` — puts a `GetModuleHandleA` call inside a classifier that
// runs per visible entity per frame, which is not a price a render path should pay.
#include <cstdint>

namespace pc::game {

inline constexpr uintptr_t kExpectedImageBase = 0x400000;

// --- entity layout (CEntity / CPlaceable / CObject) --------------------------------------------------------
inline constexpr uint32_t kPlacementPos = 0x04;   // CPlaceable::m_placement position (used when m_matrix null)
inline constexpr uint32_t kMatrix = 0x14;         // CPlaceable::m_matrix
inline constexpr uint32_t kMatrixPos = 0x30;      // CMatrix::pos
inline constexpr uint32_t kModelIndex = 0x22;     // CEntity::m_nModelIndex (int16)
inline constexpr uint32_t kTypeByte = 0x36;       // CEntity type bitfield; `& 7` is the entity type
inline constexpr uint32_t kObjectType = 0x13C;    // CObject::m_nObjectType (CPhysical is 0x138 bytes)
inline constexpr uint8_t kEntityTypeObject = 4;   // eEntityType ENTITY_TYPE_OBJECT
inline constexpr uint8_t kObjectTypeCutscene = 4; // eObjectType OBJECT_TYPE_CUTSCENE

// --- model info -------------------------------------------------------------------------------------------
inline constexpr uint32_t kModelInfoPtrsVa = 0xa9b0c8;  // CModelInfo::ms_modelInfoPtrs
inline constexpr uint32_t kGetModelTypeSlot = 4;        // CBaseModelInfo vtable: dtor, As*Ptr ×3, GetModelType
inline constexpr uint8_t kModelInfoVehicle = 6;         // ModelInfoType MODEL_INFO_VEHICLE

// --- renderer globals -------------------------------------------------------------------------------------
inline constexpr uint32_t kCameraPosVa = 0xb76870;  // CRenderer::ms_vecCameraPosition (3 floats)

// --- the .rdata window a model-info vtable must live in, so a garbage pointer never becomes a call ---------
inline constexpr uint32_t kRdataLowVa = 0x858000;
inline constexpr uint32_t kRdataHighVa = 0x8a4000;

using GetModelTypeFn = uint8_t(__attribute__((thiscall)) *)(void*);

inline uint8_t ByteAt(const void* base, uint32_t offset) {
  return *reinterpret_cast<const uint8_t*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline int16_t Int16At(const void* base, uint32_t offset) {
  return *reinterpret_cast<const int16_t*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline void* PtrAt(const void* base, uint32_t offset) {
  return *reinterpret_cast<void* const*>(reinterpret_cast<uintptr_t>(base) + offset);
}

inline uint8_t EntityType(const void* entity) {
  return static_cast<uint8_t>(ByteAt(entity, kTypeByte) & 7);
}

inline void* ModelInfo(int16_t modelIndex) {
  if (modelIndex < 0) {
    return nullptr;
  }
  void** table = reinterpret_cast<void**>(kModelInfoPtrsVa);
  return table[modelIndex];
}

/**
 * `modelInfo->GetModelType()` through the vtable — the general test (a model's TYPE, never its name or its id
 * range, which FLA moves). The vtable pointer is range-checked against .rdata first: on anything unexpected we
 * return 0 (= no type) instead of calling through a garbage pointer.
 */
inline uint8_t ModelType(void* modelInfo) {
  if (modelInfo == nullptr) {
    return 0;
  }
  const uintptr_t vtable = reinterpret_cast<uintptr_t>(PtrAt(modelInfo, 0));
  if (vtable < kRdataLowVa || vtable >= kRdataHighVa) {
    return 0;
  }
  GetModelTypeFn getType = reinterpret_cast<GetModelTypeFn>(reinterpret_cast<void**>(vtable)[kGetModelTypeSlot]);
  return getType(modelInfo);
}

/** The renderer's own inlined `CEntity::GetPosition()`: the matrix position when there is a matrix, else the
 *  simple placement. Returns a pointer to three floats. */
inline const float* EntityPosition(const void* entity) {
  void* matrix = PtrAt(entity, kMatrix);
  if (matrix != nullptr) {
    return reinterpret_cast<const float*>(reinterpret_cast<uintptr_t>(matrix) + kMatrixPos);
  }
  return reinterpret_cast<const float*>(reinterpret_cast<uintptr_t>(entity) + kPlacementPos);
}

inline float Sqrt(float value) {
  float result;
  __asm__("fsqrt" : "=t"(result) : "0"(value));  // no CRT under -nostdlib
  return result;
}

/** Distance from the camera the visible-entity loop itself uses as the sort key. */
inline float DistanceFromCamera(const void* entity) {
  const float* pos = EntityPosition(entity);
  const float* cam = reinterpret_cast<const float*>(kCameraPosVa);
  const float dx = cam[0] - pos[0];
  const float dy = cam[1] - pos[1];
  const float dz = cam[2] - pos[2];
  return Sqrt(dx * dx + dy * dy + dz * dz);
}

/** A cutscene object whose model is a VEHICLE — the only thing this plugin ever treats differently. */
inline bool IsCutsceneVehicleObject(const void* entity) {
  if (entity == nullptr || EntityType(entity) != kEntityTypeObject) {
    return false;
  }
  if (ByteAt(entity, kObjectType) != kObjectTypeCutscene) {
    return false;
  }
  return ModelType(ModelInfo(Int16At(entity, kModelIndex))) == kModelInfoVehicle;
}

}  // namespace pc::game
