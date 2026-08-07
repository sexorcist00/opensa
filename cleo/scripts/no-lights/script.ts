/**
 * Our replacement for the hotring's `no_lights.cs` (plan cleo/scripts 002) — the race car drives with
 * all four lamps smashed, on both runtimes.
 *
 * The original's recipe is right and is kept verbatim: `CDamageManager` at `CAutomobile+0x5A0`, four
 * `SetLightStatus(light, SMASHED)` calls, lights 0..3. What changes is everything around it, and each
 * change is a cost or a correctness fix rather than a preference:
 *
 *  - **It polls, it does not run every frame.** The original walks every car in a 10 km sphere with
 *    `WAIT 0` — for an effect that is idempotent and permanent per car. A car cannot be spawned, seen and
 *    judged inside {@link POLL_MS}, so the latency is invisible; the frame cost is divided by ~24.
 *  - **Near the PLAYER, not the whole map.** The original searches a 10 000 m radius from the world
 *    origin, i.e. every car that exists, every frame.
 *  - **ONE model compare.** The original asks `IS_INT_LVAR_EQUAL_TO_NUMBER 1@ 494` seven times in a row
 *    under one `IF 26`, having already spent `GET_CAR_MODEL` + `IS_THIS_MODEL_A_CAR`. `0137 IS_CAR_MODEL`
 *    is the whole test in one instruction.
 *  - **It checks the player exists first.** The original does not, and reads coordinates regardless.
 *
 * The model id is this MOD's own install slot, read from the built `data/vehicles.ide` (row 494 =
 * hotring). That is not the engine hardcoding a car: the script ships inside the mod whose slot it names,
 * and unlike the rhino's `track_1` there is no geometric property that means "this car should have no
 * lights" — it is authored intent, and intent has to be named.
 */
import { defineScript } from '../../sdk/src/dsl/script';
import { float, int } from '../../sdk/src/ir';

/** `CDamageManager::SetLightStatus(eLights, eLightsState)` — SA 1.0 US (gta-reversed, atlas-verified). */
const SET_LIGHT_STATUS = 0x6c2100;
/** `CAutomobile+0x5A0` m_damageManager. */
const VEHICLE_DAMAGE_MANAGER = 0x5a0;
/** `eLightsState`: 0 OK, 1 SMASHED. */
const SMASHED = 1;
/** `eLights` 0 FL, 1 FR, 2 RR, 3 RL — all four, which is the whole point of the mod. */
const LIGHTS = [0, 1, 2, 3];

/** The hotring's slot in the built `data/vehicles.ide`. */
const HOTRING_MODEL = 494;

/** SA's player globals — the liveness guard the original does without. */
const PLAYER_CHAR = 12;
const PLAYER_INDEX = 8;

/** Idempotent and permanent per car, so the poll only has to beat "the player looks at a fresh spawn". */
const POLL_MS = 400;
/** Lamps are only ever visible on a car near the player. */
const SEARCH_RADIUS_M = 150;

export const script = defineScript({
  /** A POLL tick carrying the hotring plus 16 cars of traffic: measured 153, and the ~23 frames between
   *  polls cost ONE instruction each. Cost is linear and measured at ~8 per car in range. */
  budgetPerTick: 160,
  build(s) {
    const car = s.local('car');
    const damage = s.local('damage');
    const findNext = s.local('findNext');
    const px = s.local('px');
    const py = s.local('py');
    const pz = s.local('pz');

    const killLights = (): void => {
      s.op('GET_VEHICLE_POINTER', car, damage);
      s.op('ADD_VAL_TO_INT_LVAR', damage, int(VEHICLE_DAMAGE_MANAGER));
      for (const light of LIGHTS) {
        // CLEO pushes a native call's arguments in REVERSE, so the LAST listed is the first C argument:
        // listing (status, light) is what calls SetLightStatus(light, status). The original lists them
        // exactly this way — see the plan ledger's disassembly.
        s.op('CALL_METHOD', int(SET_LIGHT_STATUS), damage, int(2), int(0), int(SMASHED), int(light));
      }
    };

    s.loop(() => {
      // The poll WAITS AFTER its work, so a hotring already standing in the world when the script spawns
      // is dealt with on the first frame instead of {@link POLL_MS} later.
      s.if(
        () => {
          s.op('DOES_CHAR_EXIST', s.global(PLAYER_CHAR));
          s.op('IS_PLAYER_PLAYING', s.global(PLAYER_INDEX));
        },
        {
          then: () => {
            s.op('GET_CHAR_COORDINATES', s.global(PLAYER_CHAR), px, py, pz);
            s.op('SET_LVAR_INT', findNext, int(0));
            s.while(
              () =>
                s.op(
                  'GET_RANDOM_CAR_IN_SPHERE_NO_SAVE_RECURSIVE',
                  px,
                  py,
                  pz,
                  float(SEARCH_RADIUS_M),
                  findNext,
                  int(0),
                  car,
                ),
              () => {
                s.op('SET_LVAR_INT', findNext, int(1));
                s.if(() => s.op('IS_CAR_MODEL', car, int(HOTRING_MODEL)), { then: killLights });
              },
              { noWaitWarning: true },
            );
          },
        },
      );
      s.wait(POLL_MS);
    });
  },
  name: 'no-lights',
  scmName: 'nolight',
});

/** Re-exported so the story test names the same constants the script is built from. */
export const SPEC = {
  HOTRING_MODEL,
  LIGHTS,
  POLL_MS,
  SEARCH_RADIUS_M,
  SMASHED,
} as const;
