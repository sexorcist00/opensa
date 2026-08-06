/**
 * CLI for the CLEO authoring SDK build: `npm run build:cleo-scripts`
 * (= `npx tsx cleo/sdk/src/cli.ts`). Compiles every script under `cleo/scripts/` to
 * `cleo/sdk/dist/` — the artifact name carries the script's target (`docs/contracts/mods.md`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ScriptDefinition } from './dsl/script';

import { compileScript, discoverScriptDirs, SCRIPT_ENTRY } from './build';

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptsRoot = path.resolve(here, '../../scripts');
const distDir = path.resolve(here, '../dist');

const names = discoverScriptDirs(scriptsRoot);
console.log(`[cleo-sdk] ${names.length} script(s) discovered${names.length > 0 ? `: ${names.join(', ')}` : ''}`);

for (const name of names) {
  const module = (await import(path.join(scriptsRoot, name, SCRIPT_ENTRY))) as { default?: ScriptDefinition };
  if (!module.default) {
    throw new Error(`[cleo-sdk] ${name}/${SCRIPT_ENTRY} has no default export (expected a ScriptDefinition)`);
  }
  const compiled = compileScript(module.default);
  for (const warning of compiled.warnings) {
    console.warn(`[cleo-sdk] ${name}: WARNING ${warning}`);
  }
  mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, compiled.artifact), compiled.bytes);
  console.log(`[cleo-sdk] ${compiled.artifact}: ${compiled.bytes.length} bytes`);
}
