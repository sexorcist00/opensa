/**
 * The SDK build pipeline's shell (plan cleo-sdk/001): discover authored script folders under
 * `cleo/scripts/`. IR construction, the whitelist gate and assembly land with plans 002–004;
 * until then a build run reports what it found and emits nothing.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** The file that makes a `cleo/scripts/` folder a script source (the DSL entry, plan 004). */
export const SCRIPT_ENTRY = 'script.ts';

/** Script source folders under the scripts home: every directory carrying a `script.ts`, sorted. */
export function discoverScriptDirs(scriptsRoot: string): readonly string[] {
  if (!existsSync(scriptsRoot)) {
    throw new Error(`scripts home not found: ${scriptsRoot} (expected the repo's cleo/scripts/)`);
  }

  return readdirSync(scriptsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(scriptsRoot, entry.name, SCRIPT_ENTRY)))
    .map((entry) => entry.name)
    .sort();
}
