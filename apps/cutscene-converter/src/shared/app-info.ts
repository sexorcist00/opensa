/** Facts both processes need. Kept out of `main/` and `renderer/` so neither imports the other. */
export const APP_NAME = 'Cutscene Converter';

/** The env var `scripts/dev.ts` sets; its absence is what "packaged build" means to the main process. */
export const DEV_SERVER_URL_ENV = 'OPENSA_DEV_SERVER_URL';
