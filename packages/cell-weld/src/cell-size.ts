/**
 * The RENDER cell size: the grid a district is welded into and the manifest ships to the engine, which
 * streams and draws `.oscell` blobs on it. NOT an option — the pak, the runtime and every tool that names a
 * cell coordinate must agree, and nothing checks that when it is a flag.
 *
 * Distinct from the GAME-side grid (`GAME_CELL_SIZE`, 256) that collision streaming, procobj scatter and the
 * LOD-impostor bake use. The two have never been equal and need not be.
 *
 * Lives here, beside the welder that welds on it, because both the offline converter (`opensa-pack`, a
 * `type:tool`) and the in-browser viewer (`sa-map-viewer`, a `type:app`) need it — and an app may not import
 * a tool.
 */
export const CELL_SIZE = 250;
