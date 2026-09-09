import path from 'node:path';
import { spawn } from 'node:child_process';
import youtubedlPkg from 'youtube-dl-exec';
import ffmpegStatic from 'ffmpeg-static';
import type { AnalyzeResult, OutputFormat, QualityOption } from '@editools/shared';
import { config } from '../config';

// Packaged builds (desktop app) point at bundled binaries via env vars.
const youtubedl = process.env.YTDLP_PATH ? youtubedlPkg.create(process.env.YTDLP_PATH) : youtubedlPkg;
const ffmpegPath = process.env.FFMPEG_PATH ?? (ffmpegStatic as unknown as string | null);

const baseFlags = {
  noPlaylist: true,
  noWarnings: true,
  ...(ffmpegPath ? { ffmpegLocation: ffmpegPath } : {}),
  ...(config.cookiesFile ? { cookies: config.cookiesFile } : {}),
};

export async function analyzeMedia(url: string): Promise<AnalyzeResult> {
  const info = (await youtubedl(
    url,
    { ...baseFlags, dumpSingleJson: true, skipDownload: true },
    { timeout: config.analyzeTimeoutMs },
  )) as Record<string, unknown>;

  const formats = Array.isArray(info.formats) ? (info.formats as Array<Record<string, unknown>>) : [];
  const heights = [
    ...new Set(
      formats
        .filter((f) => f && f.vcodec && f.vcodec !== 'none' && typeof f.height === 'number' && (f.height as number) >= 144)
        .map((f) => f.height as number),
    ),
  ].sort((a, b) => b - a);

  const recommended = pickRecommended(heights);
  const qualities: QualityOption[] = heights.map((h) => ({
    height: h,
    label: `${h}p`,
    recommended: h === recommended,
  }));

  const thumbnail = typeof info.thumbnail === 'string' && /^https:\/\//.test(info.thumbnail) ? info.thumbnail : null;

  return {
    title: typeof info.title === 'string' && info.title ? info.title : 'Untitled',
    durationSeconds: typeof info.duration === 'number' ? Math.round(info.duration) : null,
    thumbnailUrl: thumbnail,
    source: typeof info.extractor_key === 'string' ? info.extractor_key : 'Unknown',
    qualities,
  };
}

/** 1080p when available, otherwise the best quality below it, otherwise the smallest available. */
function pickRecommended(heightsDesc: number[]): number | null {
  if (heightsDesc.length === 0) return null;
  const under = heightsDesc.filter((h) => h <= 1080);
  return under.length > 0 ? under[0] : heightsDesc[heightsDesc.length - 1];
}

export interface DownloadHandle {
  kill(): void;
  done: Promise<void>;
}

export interface DownloadCallbacks {
  onProgress: (percent: number) => void;
  onStage: (stage: 'downloading' | 'processing') => void;
}

export function runDownload(
  opts: { url: string; output: OutputFormat; height?: number; tempDir: string },
  callbacks: DownloadCallbacks,
): DownloadHandle {
  const flags: Record<string, unknown> = {
    ...baseFlags,
    newline: true,
    output: path.join(opts.tempDir, '%(id)s.%(ext)s'),
    matchFilter: `duration <=? ${config.maxDurationSeconds}`,
    maxFilesize: config.maxFilesize,
    // Fragmented sources (YouTube DASH/HLS) download much faster in parallel.
    concurrentFragments: 8,
  };

  if (opts.output === 'mp4') {
    const h = opts.height ?? 1080;
    flags.format = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/b[height<=${h}]`;
    flags.mergeOutputFormat = 'mp4';
  } else {
    flags.format = 'ba/b';
    flags.extractAudio = true;
    flags.audioFormat = 'mp3';
    flags.audioQuality = 0;
  }

  // youtube-dl-exec spawns yt-dlp with an argument array — no shell involved.
  const proc = youtubedl.exec(opts.url, flags as Parameters<typeof youtubedl.exec>[1], {
    timeout: config.jobTimeoutMs,
  });

  // yt-dlp downloads each stream 0→100% (video, then audio for mp4), which made the
  // progress bar jump backwards. Scale the passes into one monotonic 0→99 value:
  // mp4: video 0–88, audio 88–99; mp3: 0–97; final merge/convert holds at 99.
  let pass = 0;
  let emitted = 0;
  const scale = (raw: number): number => {
    if (opts.output === 'mp3') return raw * 0.97;
    return pass <= 1 ? raw * 0.88 : 88 + raw * 0.11;
  };
  const handleLine = (line: string): void => {
    if (line.includes('[download] Destination:')) {
      pass += 1;
      return;
    }
    const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
    if (m) {
      const scaled = Math.min(99, Math.round(scale(parseFloat(m[1]))));
      if (scaled > emitted) {
        emitted = scaled;
        callbacks.onProgress(scaled);
      }
      return;
    }
    if (/\[Merger\]|\[ExtractAudio\]/.test(line)) {
      callbacks.onStage('processing');
      if (emitted < 99) {
        emitted = 99;
        callbacks.onProgress(99);
      }
    }
  };
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) handleLine(line);
  });

  return {
    kill() {
      if (!proc.pid) return;
      if (process.platform === 'win32') {
        // Kill the whole tree — yt-dlp spawns ffmpeg as a child.
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      } else {
        proc.kill('SIGTERM');
      }
    },
    done: proc.then(() => undefined),
  };
}
