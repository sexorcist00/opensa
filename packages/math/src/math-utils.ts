const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const degToRad = (degrees: number): number => degrees * DEG2RAD;

export const radToDeg = (radians: number): number => radians * RAD2DEG;

export const lerp = (x: number, y: number, t: number): number => (1 - t) * x + t * y;

/** Always returns a non-negative remainder, unlike `%`. */
export const euclideanModulo = (n: number, m: number): number => ((n % m) + m) % m;

export const MathUtils = { clamp, degToRad, euclideanModulo, lerp, radToDeg } as const;
