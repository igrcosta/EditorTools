import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { app, BrowserWindow, dialog, session, shell } from 'electron';

const isWin = process.platform === 'win32';
const exe = (name: string) => (isWin ? `${name}.exe` : name);

// ---------------------------------------------------------------------------
// Settings (persisted in the user's app-data folder)
// ---------------------------------------------------------------------------

interface Settings {
  downloadDir: string;
}

let settings: Settings;

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings(): Settings {
  const defaults: Settings = { downloadDir: app.getPath('downloads') };
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings>;
    if (typeof raw.downloadDir === 'string' && raw.downloadDir) {
      return { ...defaults, downloadDir: raw.downloadDir };
    }
  } catch {
    // first run or unreadable file — use defaults
  }
  return defaults;
}

function saveSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // non-fatal: settings just won't persist
  }
}

// ---------------------------------------------------------------------------
// Embedded server
// ---------------------------------------------------------------------------

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

  // Desktop-only endpoints (the web UI detects them to show desktop features).
  server.get('/api/desktop/settings', async () => ({ downloadDir: settings.downloadDir }));
  server.post('/api/desktop/choose-folder', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose download folder',
      defaultPath: settings.downloadDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (!result.canceled && result.filePaths[0]) {
      settings.downloadDir = result.filePaths[0];
      saveSettings();
    }
    return { downloadDir: settings.downloadDir };
  });

  // Port 0 → the OS picks a free port; the app stays localhost-only.
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address() as AddressInfo;
  return address.port;
}

/**
 * Sites change constantly and yt-dlp's nightly channel carries the extractor
 * fixes; self-update in the background on every launch so downloads keep
 * working without shipping a new Editools version. Failures are harmless —
 * the bundled binary keeps being used.
 */
function updateYtdlpInBackground(): void {
  const bin = process.env.YTDLP_PATH;
  if (!bin || !existsSync(bin)) return;
  try {
    const proc = spawn(bin, ['-U', '--update-to', 'nightly'], { stdio: 'ignore' });
    proc.on('error', () => undefined);
  } catch {
    // offline or binary not writable — ignore
  }
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

function uniquePath(dir: string, filename: string): string {
  const { name, ext } = path.parse(filename);
  let candidate = path.join(dir, filename);
  for (let i = 1; existsSync(candidate); i += 1) {
    candidate = path.join(dir, `${name} (${i})${ext}`);
  }
  return candidate;
}

function setupDownloads(): void {
  // "Save file" clicks in the UI become silent saves into the configured folder.
  session.defaultSession.on('will-download', (_event, item) => {
    try {
      mkdirSync(settings.downloadDir, { recursive: true });
    } catch {
      settings.downloadDir = app.getPath('downloads');
    }
    const savePath = uniquePath(settings.downloadDir, item.getFilename());
    item.setSavePath(savePath);
    item.once('done', (_e, state) => {
      if (state === 'completed') shell.showItemInFolder(savePath);
    });
  });
}

// ---------------------------------------------------------------------------
// Window & lifecycle
// ---------------------------------------------------------------------------

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
    settings = loadSettings();
    const port = await startEmbeddedServer();
    // eslint-disable-next-line no-console
    console.log(`Editools desktop ready at http://127.0.0.1:${port}`);
    setupDownloads();
    createWindow(port);
    updateYtdlpInBackground();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
