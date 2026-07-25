/**
 * The camera config the rig tests run against — the SHIPPED defaults, written out literally.
 *
 * Deliberately a copy rather than `createGameRuntimeConfig().camera`: a field round retunes those numbers,
 * and a behaviour test that silently follows the tuning stops testing the behaviour. When a default moves,
 * this fixture moves with it only if the tests still describe what the rig should do.
 */
import type { CameraConfig } from '@opensa/game';

export const TEST_CAMERA_CONFIG: CameraConfig = {
  collisionMinDistance: 1.6,
  collisionRadius: 0.35,
  collisionReleaseTime: 0.4,
  collisionWhiskerAngle: 0.26,
  deadZone: 0.08,
  followDistance: 7,
  followHeight: 0.9,
  followLerp: 3,
  followMaxPolar: Math.PI / 2 - 0.05,
  followMinPolar: 0.25,
  followPolar: 1.15,
  followZoom: true,
  followZoomMax: 10,
  followZoomMin: 4,
  inputSmoothTime: 0.03,
  lagMaxDistance: 1.2,
  lookAheadDistance: 0.8,
  lookAheadFullSpeed: 7,
  lookAheadTime: 0.45,
  manualGraceSec: 0.25,
  moveThreshold: 0.6,
  pitchMax: 0.9,
  pitchMin: -1.2,
  positionLagTime: 0.12,
  recenterDelaySec: 2,
  recenterRate: 1.6,
  sensitivity: 0.004,
  settleEpsilon: 0.03,
  teleportSnapDistance: 20,
  turnThreshold: 0.9,
  verticalLagTime: 0.28,
  yawLagTime: 0.25,
  zoomLambda: 8,
};
