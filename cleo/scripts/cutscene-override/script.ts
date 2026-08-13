/**
 * cutscene-override (cleo/scripts plan 003): play the cutscene named in `cleo\cutscene-override.ini`
 * once, at session start, instead of the player sitting through the intro to reach it. The field
 * instrument for vehicle-cutscene work — one ini edit + one save load per look.
 *
 * The opcode sequence is main.scm's own (measured, plan 003 step 0): area → `02E4` → wait `06B9`
 * (REQUIRED: starting unloaded runs degraded — no camera, no widescreen) → `02E7` → poll `02E9` →
 * fade out → `02EA` → restore. Waits are condition-driven like main.scm's; the one addition is a
 * TIMERA timeout on the load wait, because a bad ini name never reaches LOADED — that path restores
 * the player and terminates instead of hanging on a black screen.
 *
 * `target: 'sa-only'` — the mirror of opensa-only: OpenSA has no cutscene system, so this artifact
 * is for the real-SA bottle alone and the whitelist holds only the real-CLEO half.
 */
import { TIMER_A } from '@opensa/cleo/vm/thread';

import { defineScript } from '../../sdk/src/dsl/script';
import { int, lvar, str } from '../../sdk/src/ir';

const INI = 'cleo\\cutscene-override.ini';
/** SA's ONMISSION global — measured from main.scm's `0180 SET_ON_MISSION_FLAG` (plan 003 step 0). */
const ONMISSION = 409;
const PLAYER = 0;
const FADE_OUT = 0;
const FADE_IN = 1;
const FADE_MS = 500;
/** main.scm fades back in over a full second after a cutscene (measured at the prolog sites). */
const FADE_IN_MS = 1000;
/** A scene that never reaches LOADED (an ini typo, a broken install) stops waiting here. */
const LOAD_TIMEOUT_MS = 15_000;
/** Belt for a `02E9` that never fires: no scene runs longer than this — restore instead of hang. */
const FINISH_TIMEOUT_MS = 300_000;
const POLL_MS = 250;

export const script = defineScript({
  budgetPerTick: 24,
  build(s) {
    const scene = s.localString('scene');
    const area = s.local('area');
    const timer = lvar(TIMER_A);

    // The inert gate: no ini / no key → not a viewer session, vanish without touching anything.
    s.if(() => s.op('READ_STRING_FROM_INI_FILE', str(INI), str('cutscene'), str('scene'), scene), {
      then: () => {
        // The scene's interior area (generated [areas] section); no row leaves 0 = outside.
        s.op('SET_LVAR_INT', area, int(0));
        s.op('READ_INT_FROM_INI_FILE', str(INI), str('areas'), scene, area);

        // Wait until main.scm's intro is done or skipped: player playing AND ONMISSION == 0.
        s.while(
          () => {
            s.not('IS_PLAYER_PLAYING', int(PLAYER));
            s.not('IS_INT_VAR_EQUAL_TO_NUMBER', s.global(ONMISSION), int(0));
          },
          () => s.wait(POLL_MS),
          { any: true },
        );
        s.wait(FADE_MS);

        // main.scm's start sequence: fade to black, freeze, area, load, wait for LOADED.
        s.op('DO_FADE', int(FADE_MS), int(FADE_OUT));
        s.while(
          () => s.op('GET_FADING_STATUS'),
          () => s.wait(50),
        );
        s.op('SET_PLAYER_CONTROL', int(PLAYER), int(0));
        s.op('SET_AREA_VISIBLE', area);
        s.op('LOAD_CUTSCENE', scene);
        s.op('SET_LVAR_INT', timer, int(0));
        s.while(
          () => {
            s.not('HAS_CUTSCENE_LOADED');
            s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', timer, int(LOAD_TIMEOUT_MS));
          },
          () => s.wait(100),
        );

        // Loaded → play to the end (the manager sets widescreen and fades in itself).
        s.if(() => s.op('HAS_CUTSCENE_LOADED'), {
          then: () => {
            s.op('START_CUTSCENE');
            s.op('DO_FADE', int(FADE_IN_MS), int(FADE_IN));
            s.op('SET_LVAR_INT', timer, int(0));
            s.while(
              () => {
                s.not('HAS_CUTSCENE_FINISHED');
                s.not('IS_INT_LVAR_GREATER_THAN_NUMBER', timer, int(FINISH_TIMEOUT_MS));
              },
              () => s.wait(0),
            );
          },
        });

        // Common restore, timeout path included. Field round 1 (white screen, thread never
        // terminated): anything between FINISHED and CLEAR is a window for the manager's own
        // end-fade to hold `016B` true forever — so the fade-out is INSTANT (main.scm's `016A 0 0`)
        // and CLEAR follows in the same tick; the slow fade only comes back AFTER the clear.
        s.op('DO_FADE', int(0), int(FADE_OUT));
        s.op('CLEAR_CUTSCENE');
        s.op('RESTORE_CAMERA_JUMPCUT');
        s.op('SET_CAMERA_BEHIND_PLAYER');
        s.op('SET_AREA_VISIBLE', int(0));
        s.op('SET_PLAYER_CONTROL', int(PLAYER), int(1));
        s.op('DO_FADE', int(FADE_IN_MS), int(FADE_IN));
      },
    });
    s.op('TERMINATE_THIS_CUSTOM_SCRIPT');
  },
  name: 'cutscene-override',
  scmName: 'csovrd',
  target: 'sa-only',
});
