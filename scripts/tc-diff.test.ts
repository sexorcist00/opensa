import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';

import { buildTimecyc, sampleTimecycBlend } from '../packages/renderware/src/parsers/text/timecyc';
import { convertTo24h, parseTimecyc } from '../packages/renderware/src/parsers/text/timecyc.parser';

describe('timecyc source diff', () => {
  it('compares timecyc.dat (prod reads this) with timecyc_24h.dat and the pak bake', () => {
    const manifest = JSON.parse(readFileSync('public/pak-map/manifest.json', 'utf8')) as {
      timecyc: string;
      timecyc24: boolean;
    };
    const raw18 = readFileSync('NO_COMMIT/optimized/data/timecyc.dat', 'latin1');
    const raw24 = readFileSync('NO_COMMIT/optimized/data/timecyc_24h.dat', 'latin1');
    const sources: [string, ReturnType<typeof buildTimecyc>][] = [
      ['timecyc.dat→24h', buildTimecyc(convertTo24h(parseTimecyc(raw18)))],
      ['timecyc_24h.dat ', buildTimecyc(parseTimecyc(raw24))],
      [
        'pak bake        ',
        buildTimecyc(
          manifest.timecyc24 ? parseTimecyc(manifest.timecyc) : convertTo24h(parseTimecyc(manifest.timecyc)),
        ),
      ],
    ];
    const out: string[] = [];
    out.push(`pak text === timecyc_24h.dat ? ${String(manifest.timecyc.trim() === raw24.trim())}`);
    out.push(`pak text === timecyc.dat    ? ${String(manifest.timecyc.trim() === raw18.trim())}`);
    for (const [label, tc] of sources) {
      const s = sampleTimecycBlend(tc, 4, 4, 19, 1);
      out.push(
        `${label}  w4 19h: fog ${s.fogStart.toFixed(0)}/${s.farClip.toFixed(0)}  skyTop ${s.skyTop.map((v) => v.toFixed(0)).join(',')}  skyBot ${s.skyBot.map((v) => v.toFixed(0)).join(',')}  lowClouds ${s.lowClouds.map((v) => v.toFixed(0)).join(',')}`,
      );
    }
    writeFileSync('/tmp/claude-501/tcdiff.txt', out.join('\n'));
  });
});
