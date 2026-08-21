#pragma once
// The view weight of one impostor card — pure arithmetic, no game access, so it can be read and checked on its
// own before any hook exists (plan 001 step 0). The payload that applies it (step 3) feeds it the card's
// model-space angle and the camera direction in the tree's frame, and writes the result into the card's
// material alpha.
//
// Geometry contract (lod-trees plan 013 step 04 — `docs/contracts/`, written with it): an impostor's N cards
// are N MATERIALS of ONE atomic in card order, card i standing in the vertical plane at angle θ_i = π·i/N
// around the trunk (the bake's `renderImpostor` loop), so its plane normal in model space is
// (cos θ_i, sin θ_i, 0). Nothing is read from the geometry; the structure IS the data.
#include <cstdint>

namespace pveg::patches {

inline constexpr uint32_t kMaxCards = 8;

// Weight exponent: |n·v|^p. 1 = plain cosine (a card at 45° keeps 71 %), higher sharpens toward the facing
// card. A FIELD number (plan 001 step 4); it starts at 2 and gets its hack card if it stays a constant.
inline constexpr float kWeightPower = 2.0f;

// No CRT under -nostdlib: x87 sqrt/cos/sin directly.
inline float Sqrt(float value) {
  float result;
  __asm__("fsqrt" : "=t"(result) : "0"(value));
  return result;
}

inline float Cos(float radians) {
  float result;
  __asm__("fcos" : "=t"(result) : "0"(radians));
  return result;
}

inline float Sin(float radians) {
  float result;
  __asm__("fsin" : "=t"(result) : "0"(radians));
  return result;
}

inline float Abs(float value) {
  return value < 0.0f ? -value : value;
}

/**
 * Per-card alpha weights for a camera looking along the HORIZONTAL model-space direction (`viewX`, `viewY`)
 * (the card planes are vertical, so the view's vertical component never changes which card faces it).
 * `out[i]` = |n_i · v|^p, normalised so the weights sum to 1 — the stack of N cards then carries about ONE
 * projection's worth of coverage from any azimuth. Returns the number of cards written (0 when `cards` is
 * outside 1..kMaxCards or the view vector is degenerate, in which case the caller leaves the materials alone).
 */
inline uint32_t CardWeights(uint32_t cards, float viewX, float viewY, float* out) {
  if (cards == 0 || cards > kMaxCards) {
    return 0;
  }
  const float length = Sqrt(viewX * viewX + viewY * viewY);
  if (length < 1e-4f) {
    return 0;
  }
  const float vx = viewX / length;
  const float vy = viewY / length;
  constexpr float kPi = 3.14159265f;
  float sum = 0.0f;
  for (uint32_t i = 0; i < cards; i += 1) {
    const float angle = (kPi * static_cast<float>(i)) / static_cast<float>(cards);
    const float cosine = Abs(Cos(angle) * vx + Sin(angle) * vy);
    float weight = 1.0f;
    for (float p = 0.0f; p < kWeightPower; p += 1.0f) {
      weight *= cosine;
    }
    out[i] = weight;
    sum += weight;
  }
  if (sum < 1e-6f) {
    return 0;
  }
  for (uint32_t i = 0; i < cards; i += 1) {
    out[i] /= sum;
  }
  return cards;
}

}  // namespace pveg::patches
