/**
 * Pak IO worker (plan 074/05): the pak bytes live HERE, never on the main thread (the 073 memory lesson).
 * M1 note: the worker fetches the whole pak once and serves range slices as transferables — vite's dev
 * middleware doesn't guarantee HTTP Range support; true Range-only reads land with the production server.
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
  type: 'blob' | 'ready';
}

let pak: null | Uint8Array = null;

self.onmessage = (event: MessageEvent<PakWorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'init' && message.url) {
    fetch(message.url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`pak fetch ${response.status}`);
        }
        pak = new Uint8Array(await response.arrayBuffer());
        self.postMessage({ key: '', type: 'ready' } satisfies PakWorkerResponse);
      })
      .catch((error: unknown) => {
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
    if (!pak) {
      self.postMessage({ error: 'pak not initialized', key: message.key, type: 'blob' } satisfies PakWorkerResponse);

      return;
    }
    // slice() copies out of the worker-resident pak; the copy transfers (zero-copy handoff to main).
    const buffer = (pak.buffer as ArrayBuffer).slice(message.offset, message.offset + message.length);
    (self as unknown as Worker).postMessage({ buffer, key: message.key, type: 'blob' } satisfies PakWorkerResponse, [
      buffer,
    ]);
  }
};
