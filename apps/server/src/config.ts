import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Dev fallback for the AI models and the Real-ESRGAN binary: the repo's
 * `vendor/` folder (filled by `scripts/fetch-vendor.mjs` on install). The
 * desktop app and containers point at their own copies via env vars.
 */
function findVendorDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(dir, 'vendor');
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const vendorDir = findVendorDir();
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

export const config = {
  /**
   * Defaults to localhost only for local development. Deployments (e.g. the
   * Docker image) set HOST=0.0.0.0 — inside a container that is safe because
   * only the platform's proxy reaches the port.
   */
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** When set, logs also go to this file (the desktop app points it at userData/logs — no visible console otherwise). */
  logFile: process.env.LOG_FILE ?? null,
  /** Set TRUST_PROXY=1 behind a hosting proxy so rate limiting sees real client IPs. */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** When set, the server also serves the built web app from this directory (single-port deploy). */
  webDist: process.env.WEB_DIST ?? null,
  /**
   * Optional path to a Netscape-format cookies.txt passed to yt-dlp (--cookies).
   * Used to get past anti-bot walls on datacenter IPs. Mount as a secret file in
   * production; never commit cookies to the repo.
   */
  cookiesFile: process.env.COOKIES_FILE ?? null,
  corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],

  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
  maxQueuedJobs: 4,
  /** Jobs (and their temp files) are wiped this long after creation. */
  jobTtlMs: 30 * 60_000,
  /** Hard timeout for a single yt-dlp download process. */
  jobTimeoutMs: 30 * 60_000,
  analyzeTimeoutMs: 45_000,
  /** Media longer than this is refused at analyze time and filtered at download time. */
  maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 4 * 3600),
  /** Passed to yt-dlp --max-filesize. */
  maxFilesize: process.env.MAX_FILESIZE ?? '6G',
  /** Upload cap for converter/audio tools (local uploads are instant on desktop). */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 ** 3),

  // --- AI tools (image + face tracking). Desktop-only in practice: the web
  // deploy has neither the GPU nor the memory, so IMAGE_TOOLS=false there. ---

  /** Master switch; availability additionally requires the model/binary files to exist. */
  imageToolsEnabled: process.env.IMAGE_TOOLS !== 'false',
  /** Folder holding the .onnx models (ISNet background removal, YuNet face detection). */
  modelsDir: process.env.MODELS_DIR ?? (vendorDir ? path.join(vendorDir, 'models') : null),
  /** Real-ESRGAN ncnn-vulkan executable; its `models/` folder must sit next to it. */
  realesrganPath:
    process.env.REALESRGAN_PATH ??
    (vendorDir ? path.join(vendorDir, 'realesrgan', exe('realesrgan-ncnn-vulkan')) : null),
  /** Input images above this many pixels are refused (memory/VRAM guard). */
  maxImagePixels: Number(process.env.MAX_IMAGE_PIXELS ?? 50_000_000),
  /** Face tracking analyses every frame; cap the clip length. */
  maxTrackingSeconds: Number(process.env.MAX_TRACKING_SECONDS ?? 600),

  // --- Captions. Desktop-only: CPU transcription is slow and the web deploy
  // is resource-constrained, so it gets its own switch (not imageToolsEnabled
  // — whisper.cpp needs no GPU, a different profile than the image/onnx tools). ---

  /** Master switch; availability additionally requires the whisper binary/model to exist. */
  captionsEnabled: process.env.CAPTIONS_TOOL !== 'false',
  /** whisper.cpp CLI executable (whisper-cli). */
  whisperPath: process.env.WHISPER_PATH ?? (vendorDir ? path.join(vendorDir, 'whisper', exe('whisper-cli')) : null),
  /** Transcription is CPU-bound and roughly real-time or slower; cap the clip length. */
  maxCaptionSeconds: Number(process.env.MAX_CAPTION_SECONDS ?? 1800),
  /** Bundled OFL font files (see captions.ts's CAPTION_FONT_FILES) for custom caption templates. */
  fontsDir: process.env.FONTS_DIR ?? (vendorDir ? path.join(vendorDir, 'fonts') : null),
} as const;
