/**
 * The only bridge. `contextIsolation` stays on and the renderer gets these functions and nothing else — no
 * `require`, no filesystem, no child processes.
 */
import { contextBridge, ipcRenderer } from 'electron';

import type { ConverterApi, ConvertLine, ConvertRequest, FolderKind } from '../shared/ipc';

import { IPC } from '../shared/ipc';

const api: ConverterApi = {
  cancelConvert: () => void ipcRenderer.invoke(IPC.cancelConvert),
  convert: (request: ConvertRequest) => ipcRenderer.invoke(IPC.convert, request),
  onConvertLine: (listener) => {
    const handler = (_event: unknown, line: ConvertLine): void => listener(line);
    ipcRenderer.on(IPC.convertLine, handler);

    return () => void ipcRenderer.off(IPC.convertLine, handler);
  },
  openFolder: (path: string) => ipcRenderer.invoke(IPC.openFolder, path),
  pickFolder: (kind: FolderKind) => ipcRenderer.invoke(IPC.pickFolder, kind),
  validateCars: (gamePath: string, carsPath: string) => ipcRenderer.invoke(IPC.validateCars, gamePath, carsPath),
  validateGame: (gamePath: string) => ipcRenderer.invoke(IPC.validateGame, gamePath),
  validateOut: (gamePath: string, outPath: string) => ipcRenderer.invoke(IPC.validateOut, gamePath, outPath),
};

contextBridge.exposeInMainWorld('converter', api);
