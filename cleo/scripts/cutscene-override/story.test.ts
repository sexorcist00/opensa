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
      expect(ops.indexOf(OP.HAS_CUTSCENE_LOADED)).toBeGreaterThan(load);
      expect(ops.indexOf(OP.HAS_CUTSCENE_LOADED)).toBeLessThan(start);
      expect(ops.indexOf(OP.HAS_CUTSCENE_FINISHED)).toBeGreaterThan(start);
      expect(clear).toBeGreaterThan(ops.indexOf(OP.HAS_CUTSCENE_FINISHED));
      // The timeout path exists: a second LOADED check guards START, and CLEAR sits outside it.
      expect(ops.filter((op) => op === OP.HAS_CUTSCENE_LOADED)).toHaveLength(2);
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
        000065: 004D GOTO_IF_FALSE -344
        000072: 0006 SET_LVAR_INT 2@ 0
        000079: 0AF0 READ_INT_FROM_INI_FILE 'cleo\\cutscene-override.ini' 'areas' 0@s 2@
        000122: 00D6 IF 21
        000126: 0256 NOT IS_PLAYER_PLAYING 0
        000130: 0038 NOT IS_INT_VAR_EQUAL_TO_NUMBER $409 0
        000137: 004D GOTO_IF_FALSE -156
        000144: 0001 WAIT 250
        000149: 0002 GOTO -122
        000156: 0001 WAIT 500
        000161: 016A DO_FADE 500 0
        000168: 00D6 IF 0
        000172: 016B GET_FADING_STATUS
        000174: 004D GOTO_IF_FALSE -192
        000181: 0001 WAIT 50
        000185: 0002 GOTO -168
        000192: 01B4 SET_PLAYER_CONTROL 0 0
        000198: 04BB SET_AREA_VISIBLE 2@
        000203: 02E4 LOAD_CUTSCENE 0@s
        000208: 0006 SET_LVAR_INT 32@ 0
        000215: 00D6 IF 1
        000219: 06B9 NOT HAS_CUTSCENE_LOADED
        000221: 0019 NOT IS_INT_LVAR_GREATER_THAN_NUMBER 32@ 15000
        000229: 004D GOTO_IF_FALSE -247
        000236: 0001 WAIT 100
        000240: 0002 GOTO -215
        000247: 00D6 IF 0
        000251: 06B9 HAS_CUTSCENE_LOADED
        000253: 004D GOTO_IF_FALSE -294
        000260: 02E7 START_CUTSCENE
        000262: 016A DO_FADE 500 1
        000269: 00D6 IF 0
        000273: 02E9 NOT HAS_CUTSCENE_FINISHED
        000275: 004D GOTO_IF_FALSE -294
        000282: 0001 WAIT 250
        000287: 0002 GOTO -269
        000294: 016A DO_FADE 500 0
        000301: 00D6 IF 0
        000305: 016B GET_FADING_STATUS
        000307: 004D GOTO_IF_FALSE -325
        000314: 0001 WAIT 50
        000318: 0002 GOTO -301
        000325: 02EA CLEAR_CUTSCENE
        000327: 04BB SET_AREA_VISIBLE 0
        000331: 01B4 SET_PLAYER_CONTROL 0 1
        000337: 016A DO_FADE 500 1
        000344: 0A93 TERMINATE_THIS_CUSTOM_SCRIPT
        ; footer: 12 bytes at 346
        "
      `);
    });
  });
});
