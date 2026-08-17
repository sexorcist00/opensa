/**
 * Electron main: the window, and nothing that knows what a `.dff` is. The conversion lives in
 * `@opensa/vehicle-cutscene` and runs in a CHILD process (plan 001) — this file must stay a shell.
 */
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

import { APP_NAME, DEV_SERVER_URL_ENV } from '../shared/app-info';
import { registerIpc } from './ipc';

function createWindow(): void {
  const window = new BrowserWindow({
    backgroundColor: '#000000',
    height: 720,
    minHeight: 560,
    minWidth: 840,
    show: false,
    title: APP_NAME,
    webPreferences: { preload: join(__dirname, 'preload.cjs') },
    width: 1040,
  });

  registerIpc(window);

  // Painting an empty window first and then swapping in the UI reads as a stall on a cold start.
  window.once('ready-to-show', () => window.show());

  // A renderer that fails to load leaves a BLANK window and no message at all — the one Electron failure
  // that looks like nothing happening. Say it out loud, and keep the window so the message has somewhere
  // to be seen from.
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`${APP_NAME}: the window failed to load ${url} — ${description} (${code})`);
  });

  window.webContents.on('did-finish-load', () => console.log(`${APP_NAME}: window loaded`));

  const devServerUrl = process.env[DEV_SERVER_URL_ENV];

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.setName(APP_NAME);

void app.whenReady().then(() => {
  createWindow();

  // macOS keeps the process alive with no windows; clicking the dock icon must give one back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
