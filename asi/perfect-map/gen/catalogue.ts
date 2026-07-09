/**
 * Machine-readable patch catalogue — the single source of truth the generator ([generate.ts](./generate.ts))
 * turns into `src/generated/patches.hpp`. Values are the RE results verified against the 1.0 US exe (SHA1
 * `8c23ceff…`); the human narrative lives in [docs/patch-catalogue.md](../docs/patch-catalogue.md), which MUST
 * agree with this file. Addresses are 1.0 US virtual addresses (image base 0x400000).
 *
 * This file carries the byte-verify BASELINES (fingerprint anchors + per-site original bytes). The `apply`
 * logic per patch is hand-written C++ in `src/patches/` (plan 004) — a markdown table cannot express a sidecar
 * hook or an array relocation, so the generator emits DATA only.
 */

/** A byte sequence expected at a runtime exe address — the per-patch original-byte verification (never write
 *  unless the bytes at `address` still match; a mismatch means an adjuster already owns the site → defer). */
export interface ByteAnchor {
  /** 1.0 US virtual address. */
  readonly address: number;
  /** The exact original bytes at `address`. */
  readonly bytes: readonly number[];
  /** Stable identifier, e.g. `IncludeEntity.entry`. */
  readonly name: string;
  readonly note?: string;
}

export interface CatalogueEntry {
  /** Adjuster zones that, if already patched by FLA/OLA, make us defer this entry (coexistence). */
  readonly conflictsWith?: readonly string[];
  /** kebab-case id, e.g. `ipldef-range`. */
  readonly id: string;
  /** The byte-verify sites this patch touches (its `apply` in 004 confirms these before writing). */
  readonly sites: readonly ByteAnchor[];
  /** `hook` = injector function_hooker on a callable entry; `relocate` = repoint a too-small static array. */
  readonly strategy: 'hook' | 'relocate';
  readonly summary: string;
}

/** A byte sequence at a FILE offset — the version fingerprint reads these from the exe on DISK, so it identifies
 *  the build regardless of what an in-memory adjuster (FLA/OLA) has patched at runtime. */
export interface FileAnchor {
  /** The exact original bytes at `fileOffset`. */
  readonly bytes: readonly number[];
  /** Offset into the exe file. */
  readonly fileOffset: number;
  readonly name: string;
  readonly note?: string;
}

export interface Fingerprint {
  /** DISK-read anchor bytes proving it is 1.0 US — file offsets, so a loaded FLA/OLA can't invalidate them. */
  readonly anchors: readonly FileAnchor[];
  /** Exact file size of the only accepted `gta_sa.exe`. */
  readonly exeSize: number;
  /** Its SHA1 (40 hex chars). */
  readonly sha1: string;
}

/** The only accepted target: canonical GTA:SA 1.0 US (HOODLUM). Reject the 14,405,632 / `0df50d56…` variant.
 *  Anchors are FILE offsets (read from disk) — the version identity must survive whatever an adjuster has patched
 *  in memory. */
export const FINGERPRINT: Fingerprint = {
  anchors: [
    {
      bytes: [0xe9, 0x9b, 0xea, 0x15, 0x01],
      fileOffset: 0x4090,
      name: 'IncludeEntity.entry',
      note: 'va 0x404C90 — jmp 0x1563730 (HOODLUM trampoline)',
    },
    {
      bytes: [0x0f, 0xbf, 0x7b, 0x22],
      fileOffset: 0x3f4a,
      name: 'RemoveIpl.firstBuilding',
      note: 'va 0x404B4A — movsx edi, word[ebx+0x22]',
    },
    {
      bytes: [0x66, 0x8b, 0x43, 0x2a],
      fileOffset: 0x5023,
      name: 'LoadIplBoundingBox.staticIdx',
      note: 'va 0x405C23 — mov ax, word[ebx+0x2a]',
    },
    {
      bytes: [0x89, 0x04, 0x8d, 0xe0, 0xc0, 0xbc, 0x00],
      fileOffset: 0x1b7d38,
      name: 'LoadScene.store',
      note: 'va 0x5B8938 — mov [ecx*4+0xBCC0E0], eax',
    },
  ],
  exeSize: 14383616,
  sha1: '8c23ceffafa9fd88ea567be7926a33413b8e3c00',
};

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    conflictsWith: ['fla:ipl-entity-index'],
    id: 'ipldef-range',
    sites: [
      {
        address: 0x404c90,
        bytes: [0xe9, 0x9b, 0xea, 0x15, 0x01],
        name: 'IncludeEntity.entry',
        note: 'observe hook (already a jmp→0x1563730): accumulate the int32 building range (pure min/max)',
      },
      {
        address: 0x404b20,
        bytes: [0xa1, 0xb0, 0x3f, 0x8e, 0x00],
        name: 'RemoveIpl.entry',
        note: 'snapshot hook: capture the slot range for the detours, then reset the slot (lifecycle reset)',
      },
      {
        address: 0x404b4a,
        bytes: [0x0f, 0xbf, 0x7b, 0x22],
        name: 'RemoveIpl.firstBuilding',
        note: 'movsx edi,word[ebx+0x22] → detour: edi = gSnapFirst',
      },
      {
        address: 0x404b5d,
        bytes: [0x0f, 0xbf, 0x53, 0x24],
        name: 'RemoveIpl.lastBuilding',
        note: 'movsx edx,word[ebx+0x24] → detour: edx = gSnapLast (initial pre-loop cmp)',
      },
      {
        address: 0x404ba8,
        bytes: [0x0f, 0xbf, 0x53, 0x24],
        name: 'RemoveIpl.lastBuilding.loop',
        note: 'the loop BACK-EDGE re-read of lastBuilding (every iteration) → detour: edx = gSnapLast',
      },
    ],
    strategy: 'hook',
    summary:
      'IplDef building pool-range int16 → int32: observe IncludeEntity + snapshot RemoveIpl entry + redirect its THREE lastBuilding/firstBuilding reads (incl. the loop back-edge re-read 0x404BA8) to an int32 sidecar. FLA jmp-hooks the read sites → we overlay it; OLA leaves them stock. WORKS in-game (buildings; dummies don’t overflow).',
  },
  {
    conflictsWith: ['fla:inst-entries-per-file'],
    id: 'loaded-buildings',
    sites: [
      {
        address: 0x5b8938,
        bytes: [0x89, 0x04, 0x8d, 0xe0, 0xc0, 0xbc, 0x00],
        name: 'LoadScene.store',
        note: 'mov [ecx*4+0xBCC0E0], eax — relocate base + add the missing bound',
      },
      {
        address: 0x5b8940,
        bytes: [0x89, 0x0d, 0xd8, 0xc0, 0xbc, 0x00],
        name: 'LoadScene.count',
        note: 'mov [0xBCC0D8], ecx',
      },
    ],
    strategy: 'relocate',
    summary: 'gpLoadedBuildings CEntity*[4096] @0xBCC0E0 — relocate+enlarge, add the missing LoadScene bound',
  },
  {
    conflictsWith: ['fla:ipl-entity-index'],
    id: 'ipl-entity-index',
    sites: [
      {
        address: 0x405c23,
        bytes: [0x66, 0x8b, 0x43, 0x2a],
        name: 'LoadIplBoundingBox.staticIdx',
        note: 'mov ax, word[ebx+0x2a] — staticIdx into IplEntityIndexArrays',
      },
    ],
    strategy: 'relocate',
    summary: 'IplEntityIndexArrays CEntity**[40] @0x8E3F08 — relocate+enlarge, raise the 40-slot ceiling',
  },
];
