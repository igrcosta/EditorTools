import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { app, BrowserWindow, session, shell } from 'electron';

const isWin = process.platform === 'win32';
const exe = (name: string) => (isWin ? `${name}.exe` : name);

/**
 * Points the embedded server at the right binaries and web build.
 * Must run BEFORE the server module is imported (its config reads env at import).
 */
function configureEnvironment(): void {
  if (app.isPackaged) {
    const res = process.resourcesPath;
    process.env.YTDLP_PATH = path.join(res, 'bin', exe('yt-dlp'));
    process.env.FFMPEG_PATH = path.join(res, 'bin', exe('ffmpeg'));
    process.env.WEB_DIST = path.join(res, 'web');
  } else {
    // dist/main.cjs → apps/desktop → repo root
    const repoRoot = path.join(__dirname, '..', '..', '..');
    process.env.YTDLP_PATH = path.join(repoRoot, 'node_modules', 'youtube-dl-exec', 'bin', exe('yt-dlp'));
    process.env.FFMPEG_PATH = path.join(repoRoot, 'node_modules', 'ffmpeg-static', exe('ffmpeg'));
    process.env.WEB_DIST = path.join(repoRoot, 'apps', 'web', 'dist');
  }
  process.env.HOST = '127.0.0.1';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
}

async function startEmbeddedServer(): Promise<number> {
  const { buildApp } = await import('@editools/server/app');
  const server = await buildApp();
  // Port 0 → the OS picks a free port; the app stays localhost-only.
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address() as AddressInfo;
  return address.port;
}

function setupDownloads(): void {
  // "Save file" clicks in the UI become silent saves into the user's Downloads folder.
  session.defaultSession.on('will-download', (_event, item) => {
    const savePath = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(savePath);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(savePath);
    });
  });
}

function createWindow(port: number): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    backgroundColor: '#09090b',
    title: 'Editools',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void win.loadURL(`http://127.0.0.1:${port}`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    configureEnvironment();
    const port = await startEmbeddedServer();
    // eslint-disable-next-line no-console
    console.log(`Editools desktop ready at http://127.0.0.1:${port}`);
    setupDownloads();
    createWindow(port);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
