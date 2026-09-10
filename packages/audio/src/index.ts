export { AudioAbsence, type AudioAbsenceReport } from './absence';
export {
  Ambience,
  AMBIENCE_PREFIX,
  type AmbienceHost,
  type AmbienceLoop,
  type AmbienceReport,
  BED_FULL_HEIGHT,
  BED_SILENT_HEIGHT,
  bedGainForHeight,
  bedLayerNames,
  bedNameFor,
  CROSSFADE_SECONDS,
  DEFAULT_BED,
  MAX_BED_LAYERS,
  TWIN_SWAP_MAX_MS,
  TWIN_SWAP_MIN_MS,
  TWIN_SWAP_SECONDS,
} from './ambience';
export {
  AudioClock,
  type AudioClockHost,
  type AudioClockReport,
  browserClockHost,
  DEFAULT_TICK_HZ,
} from './audio-clock';
export { AudioHost } from './audio-host';
export type {
  AudioAvailability,
  AudioBufferLike,
  AudioBufferSourceLike,
  AudioContextLike,
  AudioHostOptions,
  AudioHostState,
  AudioNodeLike,
  AudioParamLike,
  GainLike,
  GestureTarget,
  StereoPannerLike,
} from './audio-host.interface';
export { type AudioEvent, AudioEventTable } from './event-table';
export {
  attenuation,
  audibleGain,
  type AudioListener,
  DEFAULT_FALLOFF,
  distanceBetween,
  type Falloff,
  panFor,
  type Vec3,
} from './spatial';
export {
  CRZ_FADE_SECONDS,
  type EngineState,
  type EngineVoicing,
  gainOf,
  IDLE_FADE_SECONDS,
  IDLE_RATIO,
  idleProgress,
  REV_RATIO,
  revProgress,
  VehicleEngine,
} from './vehicle-engine';
export {
  DEFAULT_MAX_VELOCITY_KMH,
  IDLE_SLOT,
  MAX_VELOCITY_FIELD,
  REV_SLOT,
  type VehicleVoice,
  VehicleVoiceTable,
} from './vehicle-table';
export { MAX_VOICES, type Voice, VoicePool, type VoicePoolReport, type VoiceRequest } from './voices';
export { audioZoneAt, contains } from './zones';
