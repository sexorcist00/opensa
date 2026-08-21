/**
 * Machine-readable patch catalogue — perfect-vegetation's single source of truth, typed against the SDK's
 * interfaces (`@opensa/asi-sdk/catalogue`) and turned into `src/generated/patches.hpp` by
 * [generate.ts](./generate.ts). Addresses are 1.0 US virtual addresses (image base 0x400000); every byte
 * window must be READ OUT of the one accepted exe (SHA1 `8c23ceff…`, a copy sits at
 * `game-src/original/gta_sa.exe`; `.text` VA 0x401000 is file offset 0x400) and cross-checked against
 * gta-reversed-modern — never copied from a wiki or from memory.
 *
 * **EMPTY on purpose (plan 001 step 0, 2026-08-21).** The sites arrive with step 1 (the RE), each with its
 * provenance line; until then the plugin builds, fingerprint-gates the exe and patches nothing. The
 * candidates step 1 has to pin are listed in plan 001 by FUNCTION NAME, without addresses — an address
 * written here before it was read off the exe is exactly the hand-edited value the SDK forbids.
 *
 * The human narrative is [plan 001](../docs/plans/001-view-weighted-impostor-cards.md); the `apply` logic per
 * entry is hand-written C++ in `src/patches/` (a table cannot express a render callback).
 */

import type { CatalogueEntry } from '@opensa/asi-sdk/catalogue';

export const CATALOGUE: readonly CatalogueEntry[] = [];
