import type { PreparedAtomic, RWClump } from '@opensa/renderware';

import { parseDff, prepareClumpAtomics } from '@opensa/renderware';

import type { ParsedModel, ParseRequest, ParseResponse } from './dff-parser';

import { collectTransferables } from './transferables';

/**
 * Streaming parse worker (plan 060 Phase 5): parses raw DFF buffers and runs the pure geometry-prepare
 * stage OFF the main thread — the two indivisible 50–80 ms units of a cell build. Results go back with
 * their typed-array buffers in the transfer list (zero copy); the main thread primes the renderware
 * caches and the sliced cell build then runs on cache hits only.
 */

/** Mirrors asset-cache's parseOrEmpty: absent/unparseable models render nothing instead of crashing. */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

self.onmessage = (event: MessageEvent<ParseRequest>): void => {
  const { id, models } = event.data;
  const parsed: ParsedModel[] = models.map(({ buffer, name }) => {
    let clump = EMPTY_CLUMP;
    let prepared: PreparedAtomic[] = [];
    try {
      clump = parseDff(buffer);
      prepared = prepareClumpAtomics(clump);
    } catch {
      clump = EMPTY_CLUMP;
      prepared = [];
    }

    return { clump, name, prepared };
  });
  const response: ParseResponse = { id, models: parsed };
  self.postMessage(response, { transfer: collectTransferables(parsed) });
};
