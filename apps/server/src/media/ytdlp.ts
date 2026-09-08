import path from 'node:path';
import { spawn } from 'node:child_process';
import youtubedl from 'youtube-dl-exec';
import ffmpegStatic from 'ffmpeg-static';
import type { AnalyzeResult, OutputFormat, QualityOption } from '@editools/shared';
import { config } from '../config';

const ffmpegPath = ffmpegStatic as unknown as string | null;

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

export function runDownload(
  opts: { url: string; output: OutputFormat; height?: number; tempDir: string },
  onProgress: (percent: number) => void,
): DownloadHandle {
  const flags: Record<string, unknown> = {
    ...baseFlags,
    newline: true,
    output: path.join(opts.tempDir, '%(id)s.%(ext)s'),
    matchFilter: `duration <=? ${config.maxDurationSeconds}`,
    maxFilesize: config.maxFilesize,
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

  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
      if (m) onProgress(Math.min(100, Math.round(parseFloat(m[1]))));
    }
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
