/**
 * The scripted vehicle-animation clip names, in ONE place. Shared by the system that REQUESTS them by name
 * (`enter-vehicle.system`) and the player that RESOLVES them from `ped.ifp` (`apps/web` engine-player). A
 * single source so a rename can't silently desync the two — a mismatch makes the driver ride STANDING with
 * his legs out of the car (the exact failure the player's resolution guards against).
 */
export const CAR_GETIN = 'car_getin_lhs';
export const CAR_GETOUT = 'car_getout_lhs';
export const CAR_SIT = 'car_sit';

/** All three, in the order the player registers them (climb-in, climb-out, sit). */
export const VEHICLE_SCRIPTED_CLIPS = [CAR_GETIN, CAR_GETOUT, CAR_SIT] as const;
