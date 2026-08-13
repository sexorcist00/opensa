/**
 * The story is STRUCTURAL, not executed: `sa-only` means the OpenSA VM does not serve the cutscene
 * opcodes, so there is nothing headless to run them on — the review surface is the emitted
 * sequence (main.scm's own, plan 003 step 0) and the disasm listing; the behaviour verdict is the
 * bottle's (step 4).
 */
import { decodeScript } from '@opensa/cleo';
import { describe, expect, it } from 'vitest';

import { compileScript } from '../../sdk/src/build';
import { buildScript } from '../../sdk/src/dsl/script';
import { checkWhitelist, WhitelistError } from '../../sdk/src/whitelist/gate';
import { script as definition } from './script';

const OP = {
  CLEAR_CUTSCENE: 0x02ea,
  GOTO_IF_FALSE: 0x004d,
  HAS_CUTSCENE_FINISHED: 0x02e9,
  HAS_CUTSCENE_LOADED: 0x06b9,
  LOAD_CUTSCENE: 0x02e4,
  READ_STRING_FROM_INI_FILE: 0x0af4,
  SET_AREA_VISIBLE: 0x04bb,
  START_CUTSCENE: 0x02e7,
  TERMINATE: 0x0a93,
  WAIT: 0x0001,
} as const;

function opcodes(): number[] {
  return decodeScript(compileScript(definition).bytes).instructions.map((ins) => ins.opcode);
}

describe('cutscene-override', () => {
  describe('negative cases', () => {
    it('is refused by both VM-holding targets — the reason sa-only exists', () => {
      const built = buildScript(definition);
      for (const target of ['dual', 'opensa-only'] as const) {
        expect(() => checkWhitelist(built.instructions, target)).toThrow(WhitelistError);
      }
    });
  });

  describe('positive cases', () => {
    it('gates on the ini read: a failed read jumps straight to TERMINATE, no cutscene opcode touched', () => {
      const ops = opcodes();
      expect(ops[2]).toBe(OP.READ_STRING_FROM_INI_FILE);
      expect(ops[3]).toBe(OP.GOTO_IF_FALSE);
      // The inert path is the ini read and termination only — everything else sits inside the gate.
      expect(ops.filter((op) => op === OP.TERMINATE)).toHaveLength(1);
      expect(ops[ops.length - 1]).toBe(OP.TERMINATE);
    });

    it("emits main.scm's own sequence: area → load → LOADED wait → start → FINISHED poll → clear", () => {
      const ops = opcodes();
      const load = ops.indexOf(OP.LOAD_CUTSCENE);
      const start = ops.indexOf(OP.START_CUTSCENE);
      const clear = ops.indexOf(OP.CLEAR_CUTSCENE);
      expect(ops.indexOf(OP.SET_AREA_VISIBLE)).toBeLessThan(load);
      const loadedWait = ops.indexOf(OP.HAS_CUTSCENE_LOADED, load);
      expect(loadedWait).toBeGreaterThan(load);
      expect(loadedWait).toBeLessThan(start);
      expect(ops.indexOf(OP.HAS_CUTSCENE_FINISHED)).toBeGreaterThan(start);
      expect(clear).toBeGreaterThan(ops.indexOf(OP.HAS_CUTSCENE_FINISHED));
      // The timeout path exists: after LOAD a wait plus a started-guard check, CLEAR outside it
      // (the gate's manager-free checks BEFORE the load are extra occurrences by design).
      expect(ops.filter((op, at) => op === OP.HAS_CUTSCENE_LOADED && at > load)).toHaveLength(2);
      expect(ops.filter((op) => op === OP.CLEAR_CUTSCENE)).toHaveLength(1);
    });

    it('never runs a WAIT-free stretch beyond its declared budget (every loop is warning-free)', () => {
      const compiled = compileScript(definition);
      expect(compiled.warnings).toEqual([]);
      const ops = opcodes();
      let gap = 0;
      let worst = 0;
      for (const op of ops) {
        gap = op === OP.WAIT ? 0 : gap + 1;
        worst = Math.max(worst, gap);
      }
      // Linear over-approximation (counts both if-branches) — still must fit the budget.
      expect(worst).toBeLessThanOrEqual(definition.budgetPerTick);
    });

    it('builds deterministically and emits the committed listing (the review surface)', () => {
      const first = compileScript(definition);
      expect(first.artifact).toBe('cutscene-override.sa-only.cs');
      expect(first.bytes).toEqual(compileScript(definition).bytes);
      expect(first.listing).toMatchInlineSnapshot(`
        "000000: 03A4 SCRIPT_NAME 'csovrd'
        000011: 00D6 IF 0
        000015: 0AF4 READ_STRING_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'cutscene' 'scene' 0@s
        000065: 004D GOTO_IF_FALSE -465
        000072: 0006 SET_LVAR_INT 2@ 0
        000079: 0AF0 READ_INT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'areas' 0@s 2@
        000122: 0001 WAIT 5000
        000127: 0006 SET_LVAR_INT 3@ 0
        000134: 00D6 IF 0
        000138: 0039 IS_INT_LVAR_EQUAL_TO_NUMBER 3@ 0
        000145: 004D GOTO_IF_FALSE -282
        000152: 00D6 IF 23
        000156: 0256 NOT IS_PLAYER_PLAYING 0
        000160: 0038 NOT IS_INT_VAR_EQUAL_TO_NUMBER $409 0
        000167: 016B GET_FADING_STATUS
        000169: 06B9 HAS_CUTSCENE_LOADED
        000171: 004D GOTO_IF_FALSE -190
        000178: 0001 WAIT 250
        000183: 0002 GOTO -152
        000190: 0006 SET_LVAR_INT 33@ 0
        000197: 00D6 IF 4
        000201: 0256 IS_PLAYER_PLAYING 0
        000205: 0038 IS_INT_VAR_EQUAL_TO_NUMBER $409 0
        000212: 016B NOT GET_FADING_STATUS
        000214: 06B9 NOT HAS_CUTSCENE_LOADED
        000216: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 33@ 10000
        000224: 004D GOTO_IF_FALSE -242
        000231: 0001 WAIT 100
        000235: 0002 GOTO -197
        000242: 00D6 IF 3
        000246: 0256 IS_PLAYER_PLAYING 0
        000250: 0038 IS_INT_VAR_EQUAL_TO_NUMBER $409 0
        000257: 016B NOT GET_FADING_STATUS
        000259: 06B9 NOT HAS_CUTSCENE_LOADED
        000261: 004D GOTO_IF_FALSE -275
        000268: 0006 SET_LVAR_INT 3@ 1
        000275: 0002 GOTO -134
        000282: 0001 WAIT 500
        000287: 016A DO_FADE 500 0
        000294: 00D6 IF 0
        000298: 016B GET_FADING_STATUS
        000300: 004D GOTO_IF_FALSE -318
        000307: 0001 WAIT 50
        000311: 0002 GOTO -294
        000318: 01B4 SET_PLAYER_CONTROL 0 0
        000324: 04BB SET_AREA_VISIBLE 2@
        000329: 02E4 LOAD_CUTSCENE 0@s
        000334: 0006 SET_LVAR_INT 32@ 0
        000341: 00D6 IF 1
        000345: 06B9 NOT HAS_CUTSCENE_LOADED
        000347: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 15000
        000355: 004D GOTO_IF_FALSE -373
        000362: 0001 WAIT 100
        000366: 0002 GOTO -341
        000373: 00D6 IF 0
        000377: 06B9 HAS_CUTSCENE_LOADED
        000379: 004D GOTO_IF_FALSE -436
        000386: 02E7 START_CUTSCENE
        000388: 016A DO_FADE 1000 1
        000395: 0006 SET_LVAR_INT 32@ 0
        000402: 00D6 IF 1
        000406: 02E9 NOT HAS_CUTSCENE_FINISHED
        000408: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 300000
        000418: 004D GOTO_IF_FALSE -436
        000425: 0001 WAIT 0
        000429: 0002 GOTO -402
        000436: 016A DO_FADE 0 0
        000442: 02EA CLEAR_CUTSCENE
        000444: 02EB RESTORE_CAMERA_JUMPCUT
        000446: 0373 SET_CAMERA_BEHIND_PLAYER
        000448: 04BB SET_AREA_VISIBLE 0
        000452: 01B4 SET_PLAYER_CONTROL 0 1
        000458: 016A DO_FADE 1000 1
        000465: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 467
        "
      `);
    });
  });
});
