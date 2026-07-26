/**
 * How much of its lock a car may actually use — the original's own speed-sensitive steering limiter.
 *
 * `CAutomobile::ProcessControl` (gta-reversed, `docs/links.md`) does this to the player's car every step:
 *
 * ```cpp
 * steerAngle = adhesive * traction * 4.0f * 4.0f / (speedForward * speedForward);
 * steerAngle = std::min(steerAngle, 1.0f);
 * steerAngle = std::asin(steerAngle) / DegreesToRadians(m_fSteeringLock);
 * // …forced back to 1.0 when countersteering a slide, or with the handbrake up
 * m_fSteerAngle *= steerAngle;
 * ```
 *
 * Read it as physics rather than as a tuning curve: a tyre can hold `μ × g` of lateral acceleration, a turn
 * at speed `v` and radius `r` demands `v² / r`, so the tightest turn the tyres allow grows with the square of
 * speed — and the wheel angle that asks for exactly that is what the `asin` returns. **The car is prevented
 * from asking for more grip than it has.** That is the difference between a car and a cursor: without it,
 * full lock at 100 km/h is a request the tyres answer by letting go, which is the "the car just snaps round"
 * complaint in one line.
 *
 * Two exemptions, both the original's and both important: **countersteering** (steering into a slide the car
 * is already in) gets the full lock back, because that is how a driver saves it; so does the **handbrake**,
 * because a handbrake turn is a deliberate slide.
 *
 * It replaces two fitted constants — a flat 0.6 of the authored lock and a 0.6 falloff toward top speed —
 * neither of which knew anything about grip.
 */

/** The original's `4.0f * 4.0f`, in the same place. */
const LOCK_NUMERATOR = 16;
/** Its physics rate: a "game unit" of speed is one metre per this many seconds. */
const SA_STEP = 1 / 50;
/**
 * Surface adhesion — a tyre on tarmac, straight out of the game's own data.
 *
 * `g_surfaceInfos.GetAdhesiveLimit` reads `data/surface.dat`, a 6×6 matrix of adhesion GROUPS, and
 * `data/surfinfo.dat` says which group each surface belongs to. Both files ship in the build and both are
 * unambiguous: `WHEELBASE` (the surface the tyres are, per surface.dat's own header note) is in group
 * `RUBBER`, `TARMAC` is in group `ROAD`, and the Road×Rubber cell is **4.5**.
 *
 * It was **1.0** here for one build, because it was guessed rather than looked up — and since the limiter
 * divides by the square of speed, guessing it 4.5× low left a car with 4.5× less steering than the original
 * gives it. The field caught it immediately ("still hard to turn in at speed"). At 4.5 the limiter allows the
 * FULL authored lock below about 65 km/h and 9.4° of a 35° lock at 100 km/h.
 *
 * **Owed**: read the two files instead of carrying this number. They are mod targets like every other data
 * file, and the whole matrix is needed the moment wheels can tell tarmac from grass or sand — at which point
 * this constant becomes a lookup and the off-road handling flags (`bOffroadAbility`) get something to modify.
 */
const ROAD_ADHESION = 4.5;
/** Below this speed the limiter is meaningless (the formula divides by v²) and the car gets its full lock. */
const MIN_LIMITED_SPEED = 0.01;
/** Lateral speed (m/s) past which the car counts as sliding, for the countersteer exemption. */
const SLIDE_SPEED = 0.05;

/** The share of its authored lock the car may use, 0..1. */
export function steerLimit(input: {
  /** Handbrake up? A handbrake turn is a slide on purpose. */
  handbrake: boolean;
  /** Authored `fSteeringLock`, in DEGREES — the original divides by it, so a car with more lock keeps less. */
  lockDeg: number;
  /** Forward speed (m/s). */
  speed: number;
  /** Current front-wheel angle (rad), signed the way the car steers. */
  steerAngle: number;
  /** Lateral speed (m/s) in the car's own frame — positive to the car's right. */
  swaySpeed: number;
  /** `fTractionMultiplier` — the tyre's grip, the same number the wheels are given. */
  traction: number;
}): number {
  const { handbrake, lockDeg, speed, steerAngle, swaySpeed, traction } = input;
  if (Math.abs(speed) <= MIN_LIMITED_SPEED || lockDeg <= 0) {
    return 1;
  }
  // Countersteering: the wheel points against the way the car is sliding. Give the driver everything.
  if (handbrake || (steerAngle < 0 && swaySpeed > SLIDE_SPEED) || (steerAngle > 0 && swaySpeed < -SLIDE_SPEED)) {
    return 1;
  }
  // The original works in game units, where `traction` has already been scaled by 0.001; carrying that
  // through leaves the SI form below, in which nothing is hidden: grip over speed squared.
  const gameSpeed = speed * SA_STEP;
  const limit = (ROAD_ADHESION * traction * 0.001 * LOCK_NUMERATOR) / (gameSpeed * gameSpeed);
  if (limit >= 1) {
    return 1;
  }

  return Math.min(1, Math.asin(limit) / ((lockDeg * Math.PI) / 180));
}
