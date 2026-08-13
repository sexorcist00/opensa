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
        000065: 004D GOTO_IF_FALSE -732
        000072: 0006 SET_LVAR_INT 2@ 0
        000079: 0AF0 READ_INT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'areas' 0@s 2@
        000122: 0001 WAIT 5000
        000127: 0006 SET_LVAR_INT 3@ 0
        000134: 00D6 IF 0
        000138: 0039 IS_INT_LVAR_EQUAL_TO_NUMBER 3@ 0
        000145: 004D GOTO_IF_FALSE -261
        000152: 00D6 IF 22
        000156: 0256 NOT IS_PLAYER_PLAYING 0
        000160: 016B GET_FADING_STATUS
        000162: 06B9 HAS_CUTSCENE_LOADED
        000164: 004D GOTO_IF_FALSE -183
        000171: 0001 WAIT 250
        000176: 0002 GOTO -152
        000183: 0006 SET_LVAR_INT 33@ 0
        000190: 00D6 IF 3
        000194: 0256 IS_PLAYER_PLAYING 0
        000198: 016B NOT GET_FADING_STATUS
        000200: 06B9 NOT HAS_CUTSCENE_LOADED
        000202: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 33@ 10000
        000210: 004D GOTO_IF_FALSE -228
        000217: 0001 WAIT 100
        000221: 0002 GOTO -190
        000228: 00D6 IF 2
        000232: 0256 IS_PLAYER_PLAYING 0
        000236: 016B NOT GET_FADING_STATUS
        000238: 06B9 NOT HAS_CUTSCENE_LOADED
        000240: 004D GOTO_IF_FALSE -254
        000247: 0006 SET_LVAR_INT 3@ 1
        000254: 0002 GOTO -134
        000261: 0006 SET_LVAR_INT 4@ 0
        000268: 00D6 IF 2
        000272: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitex' 0@s 5@
        000315: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitey' 0@s 6@
        000358: 0AF2 READ_FLOAT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'sitez' 0@s 7@
        000401: 004D GOTO_IF_FALSE -444
        000408: 0006 SET_LVAR_INT 4@ 1
        000415: 0ACD PRINT_STRING_NOW 'CSOVRD: SITE OK' 3000
        000437: 0002 GOTO -470
        000444: 0ACD PRINT_STRING_NOW 'CSOVRD: NO SITE ROW' 3000
        000470: 0001 WAIT 500
        000475: 016A DO_FADE 500 0
        000482: 00D6 IF 0
        000486: 016B GET_FADING_STATUS
        000488: 004D GOTO_IF_FALSE -506
        000495: 0001 WAIT 50
        000499: 0002 GOTO -482
        000506: 01B4 SET_PLAYER_CONTROL 0 0
        000512: 00D6 IF 0
        000516: 0039 IS_INT_LVAR_EQUAL_TO_NUMBER 4@ 1
        000523: 004D GOTO_IF_FALSE -591
        000530: 000B ADD_VAL_TO_FLOAT_LVAR 7@ 1.0
        000540: 00A1 SET_CHAR_COORDINATES $12 5@ 6@ 7@
        000554: 04E4 REQUEST_COLLISION 5@ 6@
        000562: 03CB LOAD_SCENE 5@ 6@ 7@
        000573: 0395 CLEAR_AREA 5@ 6@ 7@ 300.0 1
        000591: 04BB SET_AREA_VISIBLE 2@
        000596: 02E4 LOAD_CUTSCENE 0@s
        000601: 0006 SET_LVAR_INT 32@ 0
        000608: 00D6 IF 1
        000612: 06B9 NOT HAS_CUTSCENE_LOADED
        000614: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 15000
        000622: 004D GOTO_IF_FALSE -640
        000629: 0001 WAIT 100
        000633: 0002 GOTO -608
        000640: 00D6 IF 0
        000644: 06B9 HAS_CUTSCENE_LOADED
        000646: 004D GOTO_IF_FALSE -703
        000653: 02E7 START_CUTSCENE
        000655: 016A DO_FADE 1000 1
        000662: 0006 SET_LVAR_INT 32@ 0
        000669: 00D6 IF 1
        000673: 02E9 NOT HAS_CUTSCENE_FINISHED
        000675: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 300000
        000685: 004D GOTO_IF_FALSE -703
        000692: 0001 WAIT 0
        000696: 0002 GOTO -669
        000703: 016A DO_FADE 0 0
        000709: 02EA CLEAR_CUTSCENE
        000711: 02EB RESTORE_CAMERA_JUMPCUT
        000713: 0373 SET_CAMERA_BEHIND_PLAYER
        000715: 04BB SET_AREA_VISIBLE 0
        000719: 01B4 SET_PLAYER_CONTROL 0 1
        000725: 016A DO_FADE 1000 1
        000732: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 734
        "
      `);
    });
  });
});
