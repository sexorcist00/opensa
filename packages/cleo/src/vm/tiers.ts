/**
 * Unimplemented-opcode tiers (plan 097/07 decision 4) — the degradation POLICY as data.
 *
 * Three tiers: `noop` continues silently (cosmetic effects), `conditional-false` answers the
 * script's IF with a deterministic false (the not-installed guard runs, same as real CLEO),
 * `kill-thread` terminates the thread with a located fault (an opcode whose skip would corrupt the
 * script's own state). An opcode in NEITHER the registry NOR this table takes the default: noop,
 * plus conditional-false when the opcode DB flags it as a condition — and coverage reports it as
 * UNDECLARED, which is the corpus-join test's failure signal (a known gap must be declared).
 */
import { opcodeDef } from '../core/opcode-table';

/** How an unimplemented opcode resolved: the tier plus whether it was explicitly declared. */
export interface TierResolution {
  readonly declared: boolean;
  readonly tier: UnimplementedTier;
}

export type UnimplementedTier = 'conditional-false' | 'kill-thread' | 'noop';

/**
 * The declared gaps — every entry names its corpus consumer. Class C (Car Left Door on coach/bus)
 * is DEFERRED BY DESIGN until a ped-task surface exists (city-life territory): the script must
 * run, detect, do nothing and say why — never break the runner.
 */
export const DECLARED_TIERS: ReadonlyMap<number, UnimplementedTier> = new Map<number, UnimplementedTier>([
  // --- Cosmetic on-screen text (firela's ladder HUD readout) ---
  [0x0343, 'noop'], // SET_TEXT_WRAPX
  [0x03f0, 'noop'], // USE_TEXT_COMMANDS
  [0x0430, 'noop'], // WARP_CHAR_INTO_CAR_AS_PASSENGER
  [0x05ca, 'noop'], // TASK_ENTER_CAR_AS_PASSENGER
  [0x0615, 'noop'], // OPEN_SEQUENCE_TASK
  [0x0616, 'noop'], // CLOSE_SEQUENCE_TASK
  [0x0618, 'noop'], // PERFORM_SEQUENCE_TASK
  [0x061b, 'noop'], // CLEAR_SEQUENCE_TASK
  [0x0633, 'noop'], // TASK_LEAVE_ANY_CAR
  [0x0676, 'noop'], // TASK_SHUFFLE_TO_NEXT_CAR_SEAT
  [0x0687, 'noop'], // CLEAR_CHAR_TASKS
  [0x07fc, 'noop'], // DISPLAY_TEXT_WITH_FLOAT
  // --- Class C: Car Left Door (coach + bus) — ini config + ped boarding tasks ---
  [0x0af0, 'conditional-false'], // READ_INT_FROM_INI_FILE — config read fails, the script's guard skips
  [0x0e43, 'conditional-false'], // GET_CHAR_TASK_POINTER_BY_ID — no task system, "no task" answer
  [0x0e4a, 'conditional-false'], // IS_CHAR_EXITING_ANY_CAR
]);

/** Resolve the tier for an opcode no handler serves (the runner's unimplemented path). */
export function tierOf(opcode: number): TierResolution {
  const declared = DECLARED_TIERS.get(opcode);
  if (declared !== undefined) {
    return { declared: true, tier: declared };
  }

  return { declared: false, tier: opcodeDef(opcode)?.condition ? 'conditional-false' : 'noop' };
}
