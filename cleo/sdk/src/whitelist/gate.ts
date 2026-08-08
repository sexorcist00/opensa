/**
 * The whitelist gate (plan cleo-sdk/003 decisions 4-5): walks IR before assembly. The VM half
 * always holds — we never emit what we cannot run; the real-CLEO half is lifted only by an explicit
 * `target: 'opensa-only'`, and that choice is carried in the artifact NAME
 * (`docs/contracts/mods.md`) so a `.cs` that cannot run on real SA is never mistaken for one that
 * can.
 */
import { opcodeDef } from '@opensa/cleo';

import type { IrInstruction } from '../ir';

import { DUAL_TARGET_OPCODES, VM_SERVED_OPCODES } from './whitelist.generated';

export type ScriptTarget = 'dual' | 'opensa-only';

export interface WhitelistViolation {
  /** Which runtime cannot run it: `vm` is fatal for any target, `real-cleo` only for `dual`. */
  readonly missing: 'real-cleo' | 'vm';
  readonly opcode: number;
}

export class WhitelistError extends Error {
  constructor(readonly violations: readonly WhitelistViolation[]) {
    super(`whitelist violations:\n${violations.map(describe).join('\n')}`);
    this.name = 'WhitelistError';
  }
}

/** The artifact filename carries the target — the NAME rule of `docs/contracts/mods.md`. */
export function artifactName(scriptName: string, target: ScriptTarget): string {
  return target === 'dual' ? `${scriptName}.cs` : `${scriptName}.opensa-only.cs`;
}

/** Every violation in the script, or a clean pass — a build error names them all at once. */
export function checkWhitelist(instructions: readonly IrInstruction[], target: ScriptTarget): void {
  const violations: WhitelistViolation[] = [];
  const seen = new Set<number>();
  for (const ins of instructions) {
    if (seen.has(ins.opcode)) {
      continue;
    }
    seen.add(ins.opcode);
    if (!VM_SERVED_OPCODES.has(ins.opcode)) {
      violations.push({ missing: 'vm', opcode: ins.opcode });
    } else if (target === 'dual' && !DUAL_TARGET_OPCODES.has(ins.opcode)) {
      violations.push({ missing: 'real-cleo', opcode: ins.opcode });
    }
  }
  if (violations.length > 0) {
    throw new WhitelistError(violations);
  }
}

function describe(violation: WhitelistViolation): string {
  const id = violation.opcode.toString(16).toUpperCase().padStart(4, '0');
  const name = opcodeDef(violation.opcode)?.name ?? '(unknown)';

  return violation.missing === 'vm'
    ? `  ${id} ${name} — not served by the OpenSA VM (no target can emit it)`
    : `  ${id} ${name} — not served by plain real CLEO 4 on SA 1.0 US (drop it, or declare target: 'opensa-only')`;
}
