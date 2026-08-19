/**
 * What the built map spends of SA's two ENTITY pools, and whether the install it ships to can hold it.
 *
 * Every `inst` row becomes one entity at load, and which pool it lands in is decided by the game, not by
 * the IPL: `CFileLoader::LoadObjectInstance` branches on `mi->m_nObjectInfoIndex == -1` — a model with an
 * `object.dat` row is a dynamic object and becomes a `CDummyObject`, everything else a `CBuilding`. So the
 * census has to read `object.dat` to answer, and a row count alone cannot.
 *
 * **This exists because the field paid for its absence.** `installRequirements` priced every text-IPL row
 * against `CPool<CBuilding>` and priced `CPool<CDummy>` not at all, so a build placing 17 539 dummies
 * against `Dummys = 50000` reported nothing — and the game died on the third LOAD GAME, at `0x00538103`,
 * with the pool allocator returning null into code that does not check it
 * ([write-up](../../../docs/open-issues/sa-load-game-crash-dummy-pool.md)). Same shape as the FLA pools a
 * day earlier: a guard number that is not the number the install will actually run is silent by
 * construction, so the ceilings here are read off the adjuster ini THIS BUILD SHIPS.
 */
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { parseObjectDat } from '@opensa/renderware/parsers/text/object-dat.parser';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two entity pools a map placement spends, the OLA key that sizes each, and the pool OLA builds when
 * its line is absent — `CPools::Initialise` (`new CBuildingPool(13000, "Buildings")`,
 * `new CDummyPool(2500, "Dummys")`).
 */
const ENTITY_POOL_BUDGETS = [
  { field: 'buildings', key: 'Buildings', label: 'CPool<CBuilding>', stock: 13_000 },
  { field: 'dummies', key: 'Dummys', label: 'CPool<CDummy>', stock: 2_500 },
] as const;

export interface EntityPoolSpend {
  /** Rows in the streamed binary IPLs — resident only near the player, so the peak, not the floor. */
  binary: { buildings: number; dummies: number };
  /** Rows in the permanent text IPLs — placed at boot and never unloaded. */
  permanent: { buildings: number; dummies: number };
}

/**
 * Fail the build when the PERMANENT map placement asks either entity pool for more than the install it
 * ships to will have — loud here rather than a null dereference during the data load, which is what SA does
 * with a pool that cannot answer.
 *
 * **The gate is the permanent rows, never the peak**, and stock is the proof: stock SA's binary IPLs hold
 * 25 624 building rows against a 13 000 pool, and the game has run since 2004 — because they stream, and
 * are never all resident. Gating the sum would fail a tree that is fine. The streamed half is reported
 * beside it as the ceiling nobody reaches.
 *
 * The dummy pool gets a line the build cannot gate on at all: those entities are **not released between
 * world entries** while `IplDef.firstDummy/lastDummy` stay int16 (perfect-map 011), so the pool buys a
 * number of LOADS rather than a headroom. The build cannot know how many a session wants, so it states the
 * arithmetic and leaves the call to whoever sets the ini.
 */
export function checkEntityPoolBudgets(gameDir: string): EntityPoolSpend {
  const spend = countEntityPoolSpend(gameDir);
  const { pools, source } = olaEntityPools(gameDir);

  for (const budget of ENTITY_POOL_BUDGETS) {
    const limit = pools[budget.key] ?? budget.stock;
    const permanent = spend.permanent[budget.field];
    const streamed = spend.binary[budget.field];
    const stated = limit === Infinity ? 'unlimited' : String(limit);
    if (permanent > limit) {
      throw new Error(
        `real-SA entity pool exhausted — ${budget.label}: ${permanent} PERMANENT rows against ${stated}, ` +
          `before anything streams. Read from: ${source}. Raise ${budget.key} in the OLA ini the build SHIPS ` +
          '(mods-src/<game>/mods/sa/…, not just the bottle) and record it in ' +
          'docs/gta-sa-original/reference-install-config.md.',
      );
    }
    log(
      `  entity pool — ${budget.label}: ${permanent} permanent of ${stated}` +
        `, +${streamed} streamed (never all resident), per ${source}`,
    );
  }

  const perEntry = spend.permanent.dummies;
  const dummyPool = pools.Dummys ?? ENTITY_POOL_BUDGETS[1].stock;
  if (perEntry > 0 && dummyPool !== Infinity) {
    console.warn(
      `  ! CPool<CDummy> is NOT released between world entries (docs/open-issues/sa-load-game-crash-dummy-pool.md): ` +
        `${perEntry} permanent dummies per entry against Dummys = ${dummyPool} holds ` +
        `${Math.floor(dummyPool / perEntry)} entries per boot, and the next one crashes at 0x00538103. ` +
        'Retired by perfect-map plan 011.',
    );
  }

  return spend;
}

/**
 * Count what the built tree asks of each pool, split the way the game splits it. Text IPLs are permanent;
 * binary IPLs stream, so their share is the worst case rather than a constant cost — but they spend the
 * SAME pools, which is why a census of text rows alone under-states the peak.
 */
export function countEntityPoolSpend(gameDir: string): EntityPoolSpend {
  const dynamic = readDynamicModels(gameDir);
  const permanent = { buildings: 0, dummies: 0 };
  const binary = { buildings: 0, dummies: 0 };
  const { ides, ipls } = readGtaDat(gameDir);

  for (const relative of ipls) {
    const path = resolve(gameDir, relative);
    if (path === null) {
      continue;
    }
    for (const row of parseIpl(readFileSync(path, 'utf8'))) {
      const bucket = dynamic.has(row.modelName.toLowerCase()) ? 'dummies' : 'buildings';
      permanent[bucket] += 1;
    }
  }

  // A binary IPL names its models by ID only, so the IDE catalogue this tree loads is the only way to ask
  // which pool each row spends.
  const byId = new Map<number, string>();
  for (const relative of ides) {
    const path = resolve(gameDir, relative);
    if (path === null) {
      continue;
    }
    for (const def of parseIde(readFileSync(path, 'utf8'))) {
      byId.set(def.id, def.modelName.toLowerCase());
    }
  }
  for (const bytes of binaryIpls(gameDir)) {
    for (const row of parseBinaryIpl(bytes)) {
      const name = byId.get(row.id);
      const bucket = name !== undefined && dynamic.has(name) ? 'dummies' : 'buildings';
      binary[bucket] += 1;
    }
  }

  return { binary, permanent };
}

/**
 * The entity pools the target will really run, read off the OLA ini this build ships into the tree root.
 *
 * **The section matters**: the same file declares `Buildings` and `Dummys` three times — `[SALIMITS]`,
 * `[VCLIMITS]`, `[GTA3LIMITS]` — and the Vice City block's numbers are larger, so a whole-file match reads
 * a ceiling that is not in force and reports headroom that does not exist. An absent ini, a `#`/`;`-disabled
 * line and a missing section all fall back to OLA's stock pool, which can only make the guard stricter.
 */
export function olaEntityPools(gameDir: string): { pools: Record<string, number>; source: string } {
  const stock = Object.fromEntries(ENTITY_POOL_BUDGETS.map((budget) => [budget.key, budget.stock as number]));
  const ini = existsSync(gameDir)
    ? readdirSync(gameDir).find((name) => /^iii\.vc\.sa\.limitadjuster.*\.ini$/i.test(name))
    : undefined;
  if (ini === undefined) {
    return { pools: stock, source: 'no III.VC.SA.LimitAdjuster*.ini in the tree, so OLA defaults' };
  }
  // A line scan, not one clever regex: the ini is CRLF and a lazy match with a `$` alternative collapses to
  // the empty string on the first line end, which reads as "section present, keys absent" — stock ceilings
  // reported for an install that raised them, the exact silence this guard exists to remove.
  const lines = readFileSync(join(gameDir, ini), 'utf8').split(/\r?\n/);
  const from = lines.findIndex((line) => line.trim().toUpperCase() === '[SALIMITS]');
  if (from < 0) {
    return { pools: stock, source: `${ini} (no [SALIMITS] section, so OLA defaults)` };
  }
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((line) => /^\s*\[/.test(line));
  const section = to < 0 ? rest : rest.slice(0, to);
  const read = (key: string): number | undefined => {
    for (const line of section) {
      const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\w+)`, 'i').exec(line);
      if (match !== null) {
        return match[1].toLowerCase() === 'unlimited' ? Infinity : Number(match[1]);
      }
    }

    return undefined;
  };

  return {
    pools: Object.fromEntries(
      ENTITY_POOL_BUDGETS.map((budget) => {
        const value = read(budget.key);

        return [budget.key, value === undefined || Number.isNaN(value) ? budget.stock : value];
      }),
    ),
    source: `${ini} [SALIMITS]`,
  };
}

/** Every binary IPL in the tree's archives — the streamed half of the map. */
function* binaryIpls(gameDir: string): Generator<ArrayBuffer> {
  const modelsDir = join(gameDir, 'models');
  if (!existsSync(modelsDir)) {
    return;
  }
  for (const name of readdirSync(modelsDir).filter((entry) => entry.toLowerCase().endsWith('.img'))) {
    const buffer = readFileSync(join(modelsDir, name));
    const archive = openArchive(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    for (const entry of archive.names.filter((entryName) => entryName.toLowerCase().endsWith('.ipl'))) {
      const bytes = archive.get(entry);
      if (bytes) {
        yield bytes;
      }
    }
  }
}

function log(message: string): void {
  console.log(`· ${message}`);
}

/** Model names with an `object.dat` row — the models the game turns into dummies rather than buildings. */
function readDynamicModels(gameDir: string): Set<string> {
  const path = join(gameDir, 'data', 'object.dat');
  if (!existsSync(path)) {
    return new Set();
  }

  return new Set([...parseObjectDat(readFileSync(path, 'utf8')).keys()].map((name) => name.toLowerCase()));
}

/** The IDE and IPL files `gta.dat` registers — the load list, which is never the directory listing. */
function readGtaDat(gameDir: string): { ides: string[]; ipls: string[] } {
  const path = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(path)) {
    return { ides: [], ipls: [] };
  }
  const ides: string[] = [];
  const ipls: string[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^(IDE|IPL)\s+(\S.*)$/i.exec(line.trim());
    if (match === null || match[2].toLowerCase().endsWith('.zon')) {
      continue;
    }
    (match[1].toUpperCase() === 'IDE' ? ides : ipls).push(match[2].trim());
  }

  return { ides, ipls };
}

/** `gta.dat` writes Windows paths and SA opens them case-insensitively; a real tree may not. */
function resolve(gameDir: string, relative: string): null | string {
  const path = join(gameDir, relative.replace(/\\/g, '/'));
  if (existsSync(path)) {
    return path;
  }
  const directory = join(path, '..');
  if (!existsSync(directory)) {
    return null;
  }
  const wanted = path.slice(directory.length + 1).toLowerCase();
  const found = readdirSync(directory).find((name) => name.toLowerCase() === wanted);

  return found === undefined ? null : join(directory, found);
}
