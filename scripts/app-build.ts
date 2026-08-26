/**
 * Which commit an app bundle was built from, injected as `__APP_BUILD__` by every vite config that builds
 * one (the root site build and the dispatch embed).
 *
 * It exists because of a repeated, silent field failure: on 2026-08-26 three inventory captures in a row were
 * taken of an app the device had NOT updated to — twice while everyone involved believed otherwise — and
 * nothing in the capture could say so. The pak's `buildTime` is in there; the APP's identity was not. A
 * capture that names its own build turns "did the archive reach the phone?" from an argument into a field.
 *
 * The SHA alone, deliberately: no timestamp, so rebuilding the same commit produces the same bundle. A
 * working tree with uncommitted changes gets a `+`, because a build from a dirty tree is not that commit.
 */
import { execSync } from 'node:child_process';

export function appBuild(cwd: string): string {
  try {
    const run = (command: string): string => execSync(command, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const sha = run('git rev-parse --short HEAD').trim();

    return run('git status --porcelain').trim() === '' ? sha : `${sha}+`;
  } catch {
    // A tarball with no `.git`, or no git at all. `unknown` is the honest answer and is never a version
    // anyone can mistake for one.
    return 'unknown';
  }
}
