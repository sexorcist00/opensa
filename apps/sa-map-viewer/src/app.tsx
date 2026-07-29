import type { ReactElement } from 'react';

import { useMapSource } from './source/use-map-source';
import { SourcePanel } from './ui/source-panel';

/** sa-map-viewer's shell (plan 094). Phase 0: the source panel only — phase 1 mounts the engine canvas behind it. */
export function App(): ReactElement {
  const controller = useMapSource();

  return <SourcePanel controller={controller} />;
}
