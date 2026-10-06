import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { app, BrowserWindow, dialog, safeStorage, session, shell } from 'electron';
import type { OfflineCache, SessionStore } from '@editools/server/account';
import cloudConfig from '../cloud.config.json';

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
// Account session (kept between launches)
// ---------------------------------------------------------------------------

const sessionTokenPath = () => path.join(app.getPath('userData'), 'session.bin');
const offlineCachePath = () => path.join(app.getPath('userData'), 'offline-cache.json');

function removeFile(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // nothing to remove, or not removable: the next write overwrites it
  }
}

/**
 * The refresh token is the one secret of the session, so it is encrypted with the OS (DPAPI on
 * Windows) via Electron's safeStorage. Where encryption is not available it is NOT written to disk
 * at all: the user then signs in again at each launch, which is safer than a plaintext token.
 *
 * The offline cache holds no secret — what protects it is the cloud's signature on the limits it
 * contains — so it is plain JSON.
 */
function createSessionStore(): SessionStore {
  return {
    loadRefreshToken() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        return safeStorage.decryptString(readFileSync(sessionTokenPath()));
      } catch {
        return null;
      }
    },
    saveRefreshToken(token) {
      if (token === null) return removeFile(sessionTokenPath());
      try {
        if (!safeStorage.isEncryptionAvailable()) return;
        writeFileSync(sessionTokenPath(), safeStorage.encryptString(token), { mode: 0o600 });
      } catch {
        // non-fatal: the user signs in again next launch
      }
    },
    loadOfflineCache() {
      try {
        const raw = JSON.parse(readFileSync(offlineCachePath(), 'utf8')) as Partial<OfflineCache>;
        return raw && raw.user && raw.signed && raw.entitlements ? (raw as OfflineCache) : null;
      } catch {
        return null;
      }
    },
    saveOfflineCache(cache) {
      if (cache === null) return removeFile(offlineCachePath());
      try {
        writeFileSync(offlineCachePath(), JSON.stringify(cache), 'utf8');
      } catch {
        // non-fatal: offline grace just will not survive a restart
      }
    },
  };
}

// ---------------------------------------------------------------------------
// External links (checkout)
// ---------------------------------------------------------------------------

/** Where the app may send the user's browser: Kiwify checkout pages and the configured sales site. */
function isAllowedExternal(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  const extra: string[] = cloudConfig.externalHosts;
  const allowed = ['kiwify.com.br', ...extra.map((h) => h.toLowerCase())];
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
}

// ---------------------------------------------------------------------------
// Embedded server
// ---------------------------------------------------------------------------

/**
 * Points the embedded server at the right binaries and web build.
 * Must run BEFORE the server module is imported (its config reads env at import).
 */
function configureEnvironment(): void {
  // The hosted backend (Supabase). All three values are public by design — the anon key is meant to
  // ship in clients; the service-role key and the signing PRIVATE key must never appear here. An
  // environment variable wins, so a developer can point a build at a local `supabase start`.
  const fromConfig: Array<[string, string]> = [
    ['SUPABASE_URL', cloudConfig.supabaseUrl],
    ['SUPABASE_ANON_KEY', cloudConfig.supabaseAnonKey],
    ['LIMITS_PUBLIC_KEY', cloudConfig.limitsPublicKey],
  ];
  for (const [key, value] of fromConfig) {
    if (value && !process.env[key]) process.env[key] = value;
  }
  if (app.isPackaged) {
    const res = process.resourcesPath;
    process.env.YTDLP_PATH = path.join(res, 'bin', exe('yt-dlp'));
    process.env.FFMPEG_PATH = path.join(res, 'bin', exe('ffmpeg'));
    process.env.WEB_DIST = path.join(res, 'web');
    // AI tools: models + Real-ESRGAN + whisper.cpp ship as extraResources (see package.json "build").
    process.env.MODELS_DIR = path.join(res, 'models');
    process.env.REALESRGAN_PATH = path.join(res, 'bin', 'realesrgan', exe('realesrgan-ncnn-vulkan'));
    process.env.WHISPER_PATH = path.join(res, 'bin', 'whisper', exe('whisper-cli'));
    process.env.FONTS_DIR = path.join(res, 'fonts');
    // No visible console on a double-clicked .exe — write logs to a file so a
    // feature that silently shows "unavailable" on someone else's machine can
    // still be diagnosed (send this file).
    const logDir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(logDir, { recursive: true });
    process.env.LOG_FILE = path.join(logDir, 'app.log');
  } else {
    // dist/main.cjs → apps/desktop → repo root
    const repoRoot = path.join(__dirname, '..', '..', '..');
    process.env.YTDLP_PATH = path.join(repoRoot, 'node_modules', 'youtube-dl-exec', 'bin', exe('yt-dlp'));
    process.env.FFMPEG_PATH = path.join(repoRoot, 'node_modules', 'ffmpeg-static', exe('ffmpeg'));
    process.env.WEB_DIST = path.join(repoRoot, 'apps', 'web', 'dist');
    process.env.MODELS_DIR = path.join(repoRoot, 'vendor', 'models');
    process.env.REALESRGAN_PATH = path.join(repoRoot, 'vendor', 'realesrgan', exe('realesrgan-ncnn-vulkan'));
    process.env.WHISPER_PATH = path.join(repoRoot, 'vendor', 'whisper', exe('whisper-cli'));
    process.env.FONTS_DIR = path.join(repoRoot, 'vendor', 'fonts');
  }
  process.env.HOST = '127.0.0.1';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
}

async function startEmbeddedServer(): Promise<number> {
  const { buildApp } = await import('@editools/server/app');
  const server = await buildApp({ sessionStore: createSessionStore() });

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

  // The system browser is the only place a checkout may open; the renderer cannot choose the target
  // freely (https only, allow-listed hosts), and the guard already requires the client header here.
  server.post('/api/desktop/open-external', async (request, reply) => {
    const url = (request.body as { url?: unknown } | null)?.url;
    if (typeof url !== 'string' || !isAllowedExternal(url)) return reply.code(400).send({ error: 'blocked_host' });
    await shell.openExternal(url);
    return reply.code(204).send();
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
    // The packaged .exe already carries this icon (see build.win.icon); setting it here too
    // covers `npm run desktop:dev`, where Electron would otherwise show its own default icon.
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const origin = `http://127.0.0.1:${port}`;

  // The window only ever shows the app. A link that would open another window, or navigate away, is
  // handed to the system browser if it is an allowed https page, and dropped otherwise.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === origin) return;
    event.preventDefault();
    if (isAllowedExternal(url)) void shell.openExternal(url);
  });

  void win.loadURL(origin);
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
