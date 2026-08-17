import { useEffect, useRef } from 'react';

import type { ConvertResult } from '../shared/ipc';
import type { LoggedLine } from './use-wizard';

/**
 * The tool's own lines, as it prints them. No synthetic percentage: the run is seconds long, and its
 * per-slot output is the honest progress.
 */
export function RunLog({
  lines,
  result,
}: {
  readonly lines: readonly LoggedLine[];
  readonly result: ConvertResult | undefined;
}): React.ReactElement | undefined {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [lines.length]);

  if (lines.length === 0) {
    return undefined;
  }

  return (
    <section className="cc-log">
      <pre className="cc-log-body">
        {lines.map((line) => (
          <span className={line.stream === 'stderr' ? 'cc-log-err' : undefined} key={line.id}>
            {line.text}
            {'\n'}
          </span>
        ))}
      </pre>
      <div ref={endRef} />
      {result ? (
        <p className={result.code === 0 ? 'cc-log-done' : 'cc-log-failed'}>
          {result.code === 0
            ? 'Done. The output folder holds models/cutscene.img, data/txdcut.ide, anim/cuts.img and perfect-cutscene.asi.'
            : `The converter stopped with code ${result.code}. The lines above say where.`}
        </p>
      ) : undefined}
    </section>
  );
}
