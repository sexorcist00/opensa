// Public API for the RenderWare (GTA San Andreas) asset loaders.

// IMG archive + asset resolution
export * from './archive';

// Collision (COL) index over the archive
export * from './collision';

// Framework-agnostic map resolution + region instancing
export * from './map';
export { frameWorldTransform, mulMat3, rotationToQuat } from './mesh/frame-transform';
export {
  hasPreparedAtomics,
  prepareClumpAtomics,
  type PreparedAtomic,
  preparedAtomicsFor,
  primePreparedAtomics,
} from './mesh/prepare-clump';
// Parser layer (renderer-agnostic): binary RW geometry + collision + text map definitions.
export { parseColLibrary, parseDffCollision } from './parsers/binary/col';
export * from './parsers/binary/col-types';
export { parseDff } from './parsers/binary/dff';
export { gxtKeyHash, parseGxt } from './parsers/binary/gxt';
export { type IfpAnimation, type IfpBone, type IfpKeyframe, parseIfp } from './parsers/binary/ifp';
export { parseTxd } from './parsers/binary/txd';
export * from './parsers/binary/types';
export * from './parsers/text';

// three.js adapter layer
export { updateAnimatedObjects } from './three/animated-objects';

export {
  breakableFromGeometry,
  type BreakableInstance,
  breakableInstanceKey,
  breakBreakable,
  type BreakOptions,
  getBreakable,
  getBreakableByKey,
  nearestBreakable,
  registerBreakable,
  resetBreakables,
} from './three/breakable';
export { buildAnimationClip, type BuildAnimClipOptions } from './three/build-anim-clip';
export {
  buildClump,
  buildClumpEscalators,
  buildClumpLights,
  buildClumpParticles,
  buildClumpParts,
  type ClumpEscalator,
  type ClumpLight,
  type ClumpParticle,
  type RenderPart,
  setDynamicMaterialTslFactory,
  wrapClumpParts,
} from './three/build-clump';
export { buildCollisionWireframe } from './three/build-col-wireframe';
export {
  buildDebrisMesh,
  DEBRIS_LIFETIME,
  type DebrisImpact,
  debrisTimeUniform,
  resetDebris,
  spawnDebris,
  updateDebris,
} from './three/build-debris';
export {
  buildEscalatorSteps,
  type EscalatorPathEntry,
  resetEscalators,
  updateEscalators,
} from './three/build-escalator';
export {
  buildParticleEmitters,
  particleDrawDistanceUniform,
  type ParticleEffectsSettings,
  type ParticleEmitterEntry,
  particleTimeUniform,
  particleViewportUniform,
  resetParticleEffects,
  setFxLibrary,
  updateParticleEffects,
} from './three/build-particles';
export { buildRoadsignParts, roadsignGlyphIndex, setRoadsignFont } from './three/build-roadsign';
export { buildSkinnedClump, type SkinnedClump } from './three/build-skinned-clump';
export { buildTextureMap, setTextureDataFreeing, type TextureDictionary } from './three/build-texture';
export {
  buildVehicle,
  type BuiltDoor,
  type BuiltPart,
  type BuiltVehicle,
  type BuiltWheel,
  type VehicleOptions,
} from './three/build-vehicle';
export { buildWater, oceanFrame } from './three/build-water';
export { type CoronaEntry, coronaMaterial, GLOW_LAYER } from './three/corona';
export { nightFillRim, nightFillUniform, setNightFillTslApplier } from './three/night-fill';
export { applyNightFillTsl, buildDynamicMaterialTsl, syncNightFillTsl } from './three/night-fill-tsl';
export { type SunSplit, sunSplit, type SunSplitInput } from './three/sun-split';
export { updateUvAnimations } from './three/uv-anim';
export {
  buildWorldMaterial,
  dnBalanceUniform,
  LOCAL_LIGHT_POOL,
  setWorldMaterialTslBuilder,
  setWorldWindowGlowTslApplier,
  windowGlowUniform,
  worldCsmUniforms,
  worldDayTintUniform,
  worldEmissiveUniforms,
  worldFogUniforms,
  worldLocalLightUniforms,
  worldMoonUniforms,
  worldShadowUniforms,
  worldSunUniforms,
  worldTintUniform,
} from './three/world-material';
export { applyWorldWindowGlowTsl, buildWorldMaterialTsl, syncWorldTsl } from './three/world-material-tsl';
// Renderer-agnostic vehicle model (074/08 B5) — the own engine's spawn-time builder.
export { buildVehicleModel } from './vehicle/build-vehicle-model';
export { VehicleTextures } from './vehicle/textures';
export * from './vehicle/types';
