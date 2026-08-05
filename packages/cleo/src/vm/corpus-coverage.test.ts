import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from '../core/decode';
import { opcodeDef } from '../core/opcode-table';
import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';
import { DECLARED_TIERS } from './tiers';

/**
 * The census→registry→tier join (plan 097/07 decision 1): every opcode the shipped corpus uses is
 * either SERVED by the registry or has a DECLARED tier — an undeclared gap fails here at build
 * time, sorted into the failure message by real frequency. Runs over the regenerated fixtures
 * (`npm run test:fixtures`), skips where they are absent (CI without game assets).
 */
const CORPUS = 'tests/original/cleo';

describe.skipIf(!existsSync(CORPUS))('corpus coverage join', () => {
  describe('negative cases', () => {
    it('no corpus opcode is an UNDECLARED gap (unserved and carrying no declared tier)', () => {
      const runner = new ScriptRunner({ host: createRecordingHost() });
      const undeclared = new Map<number, number>();
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`)));
        for (const instruction of script.instructions) {
          const { opcode } = instruction;
          if (!runner.registry.has(opcode) && !DECLARED_TIERS.has(opcode)) {
            undeclared.set(opcode, (undeclared.get(opcode) ?? 0) + 1);
          }
        }
      }
      const report = [...undeclared.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([opcode, count]) => `${opcode.toString(16).padStart(4, '0')} ×${count} ${opcodeDef(opcode)?.name ?? '?'}`,
        );

      expect(report).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('the class C + text gaps are exactly the declared set the corpus exercises', () => {
      const used = new Set<number>();
      for (const file of readdirSync(CORPUS).filter((name) => name.endsWith('.cs'))) {
        const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${file}`)));
        for (const instruction of script.instructions) {
          used.add(instruction.opcode);
        }
      }
      const exercised = [...DECLARED_TIERS.keys()].filter((opcode) => used.has(opcode)).sort((a, b) => a - b);

      // Every declared tier row earns its place by a real corpus consumer (no dead policy rows).
      expect(exercised).toEqual([...DECLARED_TIERS.keys()].sort((a, b) => a - b));
    });
  });
});
