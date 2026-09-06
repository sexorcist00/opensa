import { checkDefinitionOrder, formatLateDefinition } from '@opensa/tool-kit/dat-order';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Does any `inst` row of a tree place a model whose IDE `gta.dat` lists LATER?**
 *
 * The game reads `gta.dat` top to bottom, so such a row loads against an id that does not exist yet and is
 * refused — visible only with `modloader.asi` off, because modloader supplies the same mod IDEs itself, early.
 * The build guard (`assertDefinitionOrder`) fails on exactly this report; this script is how you look at a tree
 * without running a build, including one the guard has never seen.
 *
 * Usage: `npx tsx scripts/debug/dat-order-check.ts [<game-dir>…]` (default: the built `sa` tree and stock).
 * Stock reports zero, so any finding is ours.
 *
 * **A tree that is not on this machine is a named SKIP rather than a crash**, because the defaults name a
 * DESK build and the one machine holding the game files never produces one. Unguarded, the first default's
 * `ENOENT` killed the run before it reached `game-src/original`, which was there and had the answer — the
 * tool reported a stack trace where it could have reported 9 406 rows and 0 findings (2026-09-06, the phone).
 * Exit is non-zero only when NOTHING was checkable, so a guard's caller still hears about an empty run.
 */
const dirs = process.argv.slice(2);
const asked = dirs.length > 0 ? dirs : ['build/original/sa', 'game-src/original'];
let checked = 0;

for (const dir of asked) {
  if (!existsSync(join(dir, 'data', 'gta.dat'))) {
    console.log(`\n${dir}: no data/gta.dat here — skipped`);
    continue;
  }
  checked += 1;
  const report = checkDefinitionOrder(dir);
  const rows = report.late.reduce((sum, row) => sum + row.count, 0);
  console.log(
    `\n${dir}: ${report.checked} text inst rows — ${rows} placed before their definition (${report.late.length} ids)`,
  );
  for (const row of report.late) {
    console.log(`  ${formatLateDefinition(row)}`);
  }
}

if (checked === 0) {
  console.error(`\nnothing checked — none of ${asked.join(', ')} carries data/gta.dat`);
  process.exit(1);
}
