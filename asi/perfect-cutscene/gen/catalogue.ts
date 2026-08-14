/**
 * Machine-readable patch catalogue — perfect-cutscene's single source of truth, typed against the SDK's
 * interfaces (`@opensa/asi-sdk/catalogue`) and turned into `src/generated/patches.hpp` by
 * [generate.ts](./generate.ts). Addresses are 1.0 US virtual addresses (image base 0x400000); every byte
 * window below was READ OUT of the one accepted exe (SHA1 `8c23ceff…`) on 2026-08-14 and cross-checked
 * against gta-reversed-modern, never copied from a wiki.
 *
 * The human narrative is [plan 001](../docs/plans/001-deferred-cutscene-alpha.md); the `apply` logic per
 * entry is hand-written C++ in `src/patches/` (a table cannot express a render callback).
 */

import type { CatalogueEntry } from '@opensa/asi-sdk/catalogue';

const RE = 'bytes read from the accepted exe 2026-08-14 (ASI plan 001)';

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'cutscene-deferred-alpha',
    provenance: `gta-reversed-modern source/game_sa/Entity/Object/CutsceneObject.cpp — CCutsceneObject::SetModelIndex (RH_ScopedVMTInstall 0x5B1B20) + SetupCarPipeAtomicsForClump (RH_ScopedInstall 0x5B1AB0); ${RE}`,
    sites: [
      {
        address: 0x5b1b20,
        bytes: [0x56, 0x57, 0x8b, 0x7c, 0x24, 0x0c],
        name: 'CCutsceneObject.SetModelIndex.entry',
        note: 'thiscall(this=ecx, uint32 modelId): push esi / push edi / mov edi,[esp+0xc] — the one path EVERY cutscene object takes, and where the clump exists. 6 bytes = whole instructions covering a 5-byte jmp',
      },
      {
        address: 0x5b1ab0,
        bytes: [0xa0, 0x58, 0x40, 0xbc, 0x00],
        name: 'CCutsceneObject.SetupCarPipeAtomicsForClump.entry',
        note: 'mov al,[0xBC4058] (bCarPipeAtomicsInitialized) — exactly 5 bytes, one instruction. Step 4 skips the force-pipe on translucent atomics of the blessed six',
      },
      {
        address: 0x8d0f68,
        bytes: [
          0xfc, 0x8a, 0x86, 0x00, 0xf0, 0x8a, 0x86, 0x00, 0xe4, 0x8a, 0x86, 0x00, 0xd8, 0x8a, 0x86, 0x00, 0xc8, 0x8a,
          0x86, 0x00, 0xbc, 0x8a, 0x86, 0x00,
        ],
        name: 'CCutsceneObject.ms_sCutsceneVehNames.table',
        note: "the six char* the force-pipe keys off (cscopcarla92, cscopcarsf, csbravura, CsFireLa, csmothership, CsVoodoo — the MIXED case is the exe's; the game hashes them uppercased via CKeyGen). DATA anchor: proves the blessed set is stock before step 4 touches it",
      },
    ],
    strategy: 'hook',
    summary:
      'Defer translucent cutscene-vehicle atomics into the sorted alpha pass (glass over actors at any entity draw order)',
  },
  {
    id: 'blessed-six-pipe',
    provenance: `gta-reversed-modern source/game_sa/Fx/CarFXRenderer.cpp — CCarFXRenderer::CustomCarPipeAtomicSetup (RH_ScopedInstall 0x5D5B20); ${RE}`,
    sites: [
      {
        address: 0x5d5b20,
        bytes: [0xe9, 0xeb, 0x4a, 0x00, 0x00],
        name: 'CCarFXRenderer.CustomCarPipeAtomicSetup.entry',
        note: 'the callable entry is itself `jmp 0x5DA610` — the relocated-body shape the SDK hook helpers take as (entry, body)',
      },
      {
        address: 0x5da610,
        bytes: [0x56, 0x8b, 0x74, 0x24, 0x08],
        name: 'CCarFXRenderer.CustomCarPipeAtomicSetup.body',
        note: 'push esi / mov esi,[esp+8] (the RpAtomic*) — 5 bytes, whole instructions; where the vehicle env-map pipe is stamped (and translucents get dropped outside a real CVehicle)',
      },
    ],
    strategy: 'hook',
    summary: "Stop the force-pipe from dropping the blessed six's glass, so it enters the deferred pass instead",
  },
];
