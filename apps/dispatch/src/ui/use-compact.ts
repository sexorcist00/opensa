/**
 * Is the console running on a phone-sized screen? Read from a media query rather than from a user-agent
 * string, because what changes the layout is the WIDTH — a phone in landscape, a narrow window and a split
 * screen all need the same treatment, and none of them are reliably identifiable any other way.
 */
import { useEffect, useState } from 'react';

/** Below this the two side panels stop fitting next to a usable map. */
export const COMPACT_MAX_WIDTH = 860;

export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => matches());

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`);
    // No synchronous set here: the initializer already read the query, so calling it again on mount would
    // only cost a second render. Subscribe, and let a real change drive the state.
    const update = (): void => setCompact(query.matches);
    query.addEventListener('change', update);

    return (): void => query.removeEventListener('change', update);
  }, []);

  return compact;
}

function matches(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(`(max-width: ${COMPACT_MAX_WIDTH}px)`).matches;
}
