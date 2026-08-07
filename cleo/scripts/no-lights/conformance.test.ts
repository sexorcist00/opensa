/**
 * The half of this plan a headless test CAN reach for the OTHER runtime: our artifact must issue the
 * native call in exactly the shape the author's original does, because that shape is the only thing
 * real CLEO ever sees.
 *
 * It matters because the argument ORDER is invisible by inspection. CLEO pushes a call's arguments in
 * reverse, so `(status, light)` in the listing is `SetLightStatus(light, status)` in C — plan 001 shipped
 * a VM that had this backwards, and nothing in the suite caught it. Here the original IS the spec: if a
 * later change to the assembler, the DSL or the VM's native lane moves our operands, this fails instead
 * of the Wine run.
 *
 * The original is committed at `tests/custom/cleo/no_lights.cs` (regenerated into the corpus by
 * `npm run test:fixtures`) — a corpus subject may not depend on a mod folder that can be edited under
 * it, which is the trap plan 001 walked into.
 */
import { decodeScript, type Instruction } from '@opensa/cleo';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { script as definition, SPEC } from './script';

const ORIGINAL = 'tests/original/cleo/nolights.cs';
/** `0AA6 CALL_METHOD` — the only opcode this conformance check is about. */
const CALL_METHOD = 0x0aa6;

/** Every `CALL_METHOD` of a script, as the plain numbers its operands carry. */
const callMethods = (bytes: Uint8Array): (null | number)[][] =>
  decodeScript(bytes)
    .instructions.filter((instruction: Instruction) => instruction.opcode === CALL_METHOD)
    .map((instruction: Instruction) =>
      instruction.operands.map((operand) => ('value' in operand ? Number(operand.value) : null)),
    );

const ours = (): (null | number)[][] => callMethods(compileScript(definition).bytes);

describe.skipIf(!existsSync(ORIGINAL))('no-lights conformance against the author’s original', () => {
  describe('negative cases', () => {
    it('emits no call the original does not — four lamps, no more', () => {
      expect(ours()).toHaveLength(SPEC.LIGHTS.length);
      expect(callMethods(new Uint8Array(readFileSync(ORIGINAL)))).toHaveLength(SPEC.LIGHTS.length);
    });
  });

  describe('positive cases', () => {
    it('issues each SetLightStatus with the original’s operands, argument ORDER included', () => {
      const original = callMethods(new Uint8Array(readFileSync(ORIGINAL)));

      // Operand 1 is the `this` var and differs by allocation (4@ there, 1@ here), so compare
      // everything else: the address, the parameter count/pop, and the two arguments in order.
      const shape = (call: (null | number)[]): (null | number)[] => [call[0], ...call.slice(2)];
      expect(ours().map(shape)).toEqual(original.map(shape));
    });

    it('lists (status, light) — which is what reversed push order turns into SetLightStatus(light, …)', () => {
      // Spelled out rather than left to the comparison above: this is the fact the whole real-CLEO
      // half rests on, and reading it off the array is how a future reader checks it.
      expect(ours().map((call) => call.slice(-2))).toEqual(SPEC.LIGHTS.map((light) => [SPEC.SMASHED, light]));
    });
  });
});
