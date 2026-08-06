/**
 * CLI for the CLEO authoring SDK build: `npm run build:cleo-scripts`
 * (= `npx tsx cleo/sdk/src/cli.ts`). Compiles every script under `cleo/scripts/` to
 * `cleo/sdk/dist/` — assembly arrives with plans 002–004; today the run reports the sources found.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverScriptDirs } from './build';

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts');
const names = discoverScriptDirs(scriptsRoot);
console.log(`[cleo-sdk] ${names.length} script(s) discovered${names.length > 0 ? `: ${names.join(', ')}` : ''}`);
