#pragma once
// The game facts this plugin reads, in ONE place. Rule (the SDK's, and perfect-cutscene's game.hpp before
// this one): every offset and address here was read out of the accepted exe (SHA1 8c23ceff…) and cross-checked
// against gta-reversed-modern — NOTHING is written here before plan 001 step 1 has read it. Nothing here
// writes; the patches in `patches/` do that.
//
// Step 1 adds, each with its provenance in the catalogue: the RpAtomic layout (render callback slot, geometry,
// frame), RpGeometry's material list, RpMaterial's colour, the frame LTM getter, the model-load point that
// installs an atomic's render callback, and the model → TXD-name path the classifier reads.
#include <cstdint>

namespace pveg::game {

inline constexpr uintptr_t kExpectedImageBase = 0x400000;

// --- renderer globals -------------------------------------------------------------------------------------
// CRenderer::ms_vecCameraPosition (3 floats) — the camera the visible-entity loop sorts by. Read out of the
// accepted exe 2026-08-14 for perfect-cutscene (its plan 001, `RenderEverythingBarRoads` 0x553AA0 reads it);
// the one address this scaffold carries, because it is already provenance'd in a sibling plugin.
inline constexpr uint32_t kCameraPosVa = 0xb76870;

inline const float* CameraPosition() {
  return reinterpret_cast<const float*>(kCameraPosVa);
}

}  // namespace pveg::game
