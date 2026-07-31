/**
 * Video mode's acceptance exam, rolled up off a harness log — the numbers every 096 phase re-sits.
 *
 * Reads the `[video] {json}` scene reports (and counts the `[cam] jump` lines beside them) and prints, per
 * log and in total: directed frames, the share of them the car sat inside the safe frame, cuts and what ended
 * them, how often the pan cap bit, how the scenes ended, and the sequencer's own ledger — regions visited in
 * order, the realised mod-car share, and any scene whose weather target moved mid-shot (D15's leak).
 *
 * Usage: npx tsx scripts/debug/video-accept.ts <harness.log>…
 */
import { readFileSync } from 'node:fs';

/** The half of a `[video]` scene report this exam reads (the capture carries much more). */
interface SceneReport {
  ended: string;
  /** Absent in captures taken before 096/05 — those runs had one hardcoded car. */
  modCar?: boolean;
  region: string;
  scene: number;
  shots: {
    causes: Record<string, number>;
    cuts: number;
    judged: number;
    panClips: number;
    /** The SHARE of judged frames inside the safe frame, not a count — weight it before summing logs. */
    safe: number;
  };
}

interface Totals {
  causes: Record<string, number>;
  clips: number;
  cuts: number;
  ends: Record<string, number>;
  judged: number;
  jumps: number;
  modCars: number;
  regions: string[];
  safe: number;
  scenes: number;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  throw new Error('usage: video-accept.ts <harness.log>…');
}

function blank(): Totals {
  return {
    causes: {},
    clips: 0,
    cuts: 0,
    ends: {},
    judged: 0,
    jumps: 0,
    modCars: 0,
    regions: [],
    safe: 0,
    scenes: 0,
  };
}

/** One log's scenes, deduped: the harness echoes every report line twice (live, then the end-of-run dump). */
function readLog(path: string, into: Totals): void {
  const seen = new Set<number>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.includes('[cam] jump')) {
      into.jumps += 1;
    }
    const at = line.indexOf('[video] {');
    if (at < 0) {
      continue;
    }
    const scene = JSON.parse(line.slice(at + '[video] '.length)) as SceneReport;
    if (seen.has(scene.scene)) {
      continue;
    }
    seen.add(scene.scene);
    into.scenes += 1;
    into.judged += scene.shots.judged;
    into.safe += scene.shots.judged * scene.shots.safe;
    into.cuts += scene.shots.cuts;
    into.clips += scene.shots.panClips;
    into.modCars += scene.modCar ? 1 : 0;
    into.regions.push(scene.region);
    into.ends[scene.ended] = (into.ends[scene.ended] ?? 0) + 1;
    for (const [cause, count] of Object.entries(scene.shots.causes)) {
      into.causes[cause] = (into.causes[cause] ?? 0) + count;
    }
  }
}

function report(label: string, totals: Totals): void {
  const share = (part: number): string => `${((100 * part) / Math.max(1, totals.judged)).toFixed(2)}%`;
  console.log(
    `${label}: ${totals.scenes} scenes · ${totals.judged} directed frames · safe ${share(totals.safe)} · ` +
      `${totals.cuts} cuts · pan clipped ${share(totals.clips)} · ${totals.jumps} [cam] jump lines · ` +
      `mod cars ${totals.scenes === 0 ? 0 : ((100 * totals.modCars) / totals.scenes).toFixed(0)}%`,
  );
}

const all = blank();
for (const path of paths) {
  const one = blank();
  readLog(path, one);
  readLog(path, all);
  report(path.split('/').pop() ?? path, one);
  // The cycle in the order it played: the acceptance question "did it visit every region, in order" is one a
  // log can answer, which is why the drive spine's order is fixed and the other kinds' regions are not.
  console.log(`  regions ${one.regions.join(' → ')}`);
}

if (paths.length > 1) {
  console.log('');
  report('TOTAL', all);
}
console.log(`cut causes ${JSON.stringify(all.causes)}\nscene ends ${JSON.stringify(all.ends)}`);
