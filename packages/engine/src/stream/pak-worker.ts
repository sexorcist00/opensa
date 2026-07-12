/**
 * Pak IO worker (plan 074/05): pak BYTES never touch the main thread (the 073 memory lesson).
 *
 * Two modes, auto-detected at init (074/10 integration round):
 * - RANGE mode — the server honours `Range:` (probed with `bytes=0-0` → 206): entries are fetched on
 *   demand as range slices; the multi-GB pak never resides in memory. The `.ospak` 4 KiB alignment exists
 *   for exactly this.
 * - WHOLE-PAK fallback — dev middlewares that ignore `Range` (some vite setups): fetch once, serve slices
 *   from worker memory (the M1 behaviour).
 */
export interface PakWorkerRequest {
  key?: string;
  length?: number;
  offset?: number;
  type: 'fetch' | 'init';
  url?: string;
}

export interface PakWorkerResponse {
  buffer?: ArrayBuffer;
  error?: string;
  key: string;
  /** Which IO mode init picked (surfaced to the HUD/logs). */
  mode?: 'range' | 'whole';
  type: 'blob' | 'ready';
}

let pak: null | Uint8Array = null;
let pakUrl = '';
let rangeMode = false;

async function init(url: string): Promise<void> {
  pakUrl = url;
  // Probe: a 1-byte range request. 206 = the server slices; 200 = it ignored Range (falls through with
  // the whole body — abort it and go whole-pak once, not per entry).
  const probe = await fetch(url, { headers: { Range: 'bytes=0-0' } });
  if (probe.status === 206) {
    rangeMode = true;
    probe.body?.cancel().catch(() => undefined);
    self.postMessage({ key: '', mode: 'range', type: 'ready' } satisfies PakWorkerResponse);

    return;
  }
  if (!probe.ok) {
    throw new Error(`pak fetch ${probe.status}`);
  }
  pak = new Uint8Array(await probe.arrayBuffer());
  self.postMessage({ key: '', mode: 'whole', type: 'ready' } satisfies PakWorkerResponse);
}

async function serve(key: string, offset: number, length: number): Promise<void> {
  let buffer: ArrayBuffer;
  if (rangeMode) {
    const response = await fetch(pakUrl, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (response.status !== 206) {
      throw new Error(`range fetch ${response.status} (server stopped honouring Range?)`);
    }
    buffer = await response.arrayBuffer();
  } else {
    if (!pak) {
      throw new Error('pak not initialized');
    }
    // slice() copies out of the worker-resident pak; the copy transfers (zero-copy handoff to main).
    buffer = (pak.buffer as ArrayBuffer).slice(offset, offset + length);
  }
  (self as unknown as Worker).postMessage({ buffer, key, type: 'blob' } satisfies PakWorkerResponse, [buffer]);
}

self.onmessage = (event: MessageEvent<PakWorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'init' && message.url) {
    init(message.url).catch((error: unknown) => {
      self.postMessage({
        error: error instanceof Error ? error.message : String(error),
        key: '',
        type: 'ready',
      } satisfies PakWorkerResponse);
    });

    return;
  }
  if (
    message.type === 'fetch' &&
    message.key !== undefined &&
    message.offset !== undefined &&
    message.length !== undefined
  ) {
    const key = message.key;
    serve(key, message.offset, message.length).catch((error: unknown) => {
      self.postMessage({
        error: error instanceof Error ? error.message : String(error),
        key,
        type: 'blob',
      } satisfies PakWorkerResponse);
    });
  }
};
