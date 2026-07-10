/**
 * Cascaded-shadow math (plan 065) — the pure half of the CSM plugin: split scheme, view-slice fitting,
 * dawn/dusk extent clamping and the static-cascade refresh policy. No three.js objects here so every rule
 * is unit-testable; the plugin applies these numbers to cameras/lights.
 */

export interface CascadeRange {
  /** Slice far bound, world units from the camera. */
  far: number;
  /** Slice near bound, world units from the camera. */
  near: number;
}

export interface RefreshPolicy {
  /** Re-render when the fit centre moved further than this fraction of the cascade radius. */
  moveFraction: number;
  /** Re-render when the sun direction rotated more than this (radians). */
  sunAngleRad: number;
}

export interface RefreshState {
  /** Fit-centre position at the last rendered frame. */
  center: readonly [number, number, number];
  /** Sun direction at the last rendered frame (unit). */
  sunDir: readonly [number, number, number];
}

export interface SliceSphere {
  /** Distance of the sphere centre along the view direction, from the camera. */
  centerDistance: number;
  /** Bounding-sphere radius of the frustum slice (the ortho half-extent that covers it). */
  radius: number;
}

/**
 * Dawn/dusk extent clamp (plan 065 §5): near the horizon the geometric shadow length explodes (1/tan
 * elevation) — the classic CSM budget killer. Scale the far cascade's max distance down as the sun drops:
 * full extent above `fullElevation`, shrinking to `minFactor` at the horizon (the strength fade in the
 * existing `(1 − nightFactor)²` formula hides the truncation).
 */
export function shadowDistanceFactor(sunElevation: number, fullElevation = 0.35, minFactor = 0.35): number {
  const t = Math.min(1, Math.max(0, sunElevation / fullElevation));

  return minFactor + (1 - minFactor) * t;
}

/**
 * Bounding sphere of a perspective-frustum slice [near, far] — the stable-fit CSM standard: an ortho camera
 * of half-extent `radius` centred at `centerDistance` along the view covers the slice from ANY sun angle,
 * so the shadow camera's size never changes with view rotation (texel snapping then kills the shimmer).
 */
export function sliceSphere(fovYDeg: number, aspect: number, near: number, far: number): SliceSphere {
  const tanY = Math.tan((fovYDeg * Math.PI) / 360);
  const tanX = tanY * aspect;
  const tan2 = tanX * tanX + tanY * tanY;
  // Optimal centre along the view axis (clamped into the slice): minimizes the max corner distance.
  const center = Math.min(far, Math.max(near, ((near + far) / 2) * (1 + tan2)));
  const nearCornerSq = (center - near) ** 2 + near * near * tan2;
  const farCornerSq = (center - far) ** 2 + far * far * tan2;

  return { centerDistance: center, radius: Math.sqrt(Math.max(nearCornerSq, farCornerSq)) };
}

/**
 * Practical split scheme (three CSM addon's approach): blend uniform and logarithmic splits by `lambda`
 * (0 = uniform, 1 = logarithmic). Returns `count` ranges covering [near, maxDistance].
 */
export function splitRanges(near: number, maxDistance: number, count: number, lambda: number): CascadeRange[] {
  const ranges: CascadeRange[] = [];
  let previous = near;
  for (let index = 1; index <= count; index += 1) {
    const t = index / count;
    const uniform = near + (maxDistance - near) * t;
    const logarithmic = near * (maxDistance / near) ** t;
    const far = uniform + (logarithmic - uniform) * lambda;
    ranges.push({ far, near: previous });
    previous = far;
  }

  return ranges;
}

/** Default cadence: ~0.6° sun rotation (≈ a game minute) or a quarter of the radius of camera travel
 *  (the ×1.3 fit margin keeps the leading edge covered that long). */
export const DEFAULT_REFRESH: RefreshPolicy = { moveFraction: 0.25, sunAngleRad: 0.01 };

/**
 * Static-cascade refresh decision (plan 065 §2): mid/far cascades hold almost only static geometry, so
 * re-render only when the sun rotated or the camera left the covered margin — not every frame.
 */
export function needsRefresh(
  last: null | RefreshState,
  center: readonly [number, number, number],
  sunDir: readonly [number, number, number],
  radius: number,
  policy: RefreshPolicy = DEFAULT_REFRESH,
): boolean {
  if (!last) {
    return true;
  }
  const dx = center[0] - last.center[0];
  const dy = center[1] - last.center[1];
  const dz = center[2] - last.center[2];
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) > radius * policy.moveFraction) {
    return true;
  }
  const dot = sunDir[0] * last.sunDir[0] + sunDir[1] * last.sunDir[1] + sunDir[2] * last.sunDir[2];

  return dot < Math.cos(policy.sunAngleRad);
}
