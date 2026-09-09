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
  // Label by the SMALLER dimension ("1080p" convention): a vertical 1080x1920
  // video has height 1920 but everyone calls it 1080p. The height is still what
  // yt-dlp's format filter needs.
  const byHeight = new Map<number, number>();
  for (const f of formats) {
    if (!f || !f.vcodec || f.vcodec === 'none' || typeof f.height !== 'number') continue;
    const height = f.height as number;
    const width = typeof f.width === 'number' ? (f.width as number) : height;
    const label = Math.min(width, height);
    if (label < 144) continue;
    byHeight.set(height, label);
  }
  const entries = [...byHeight.entries()].sort((a, b) => b[1] - a[1]); // [height, labelDim] desc
  const recommendedHeight = pickRecommended(entries);
  const qualities: QualityOption[] = entries.map(([height, labelDim]) => ({
    height,
    label: `${labelDim}p`,
    recommended: height === recommendedHeight,
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
function pickRecommended(entriesDesc: Array<[height: number, labelDim: number]>): number | null {
  if (entriesDesc.length === 0) return null;
  const under = entriesDesc.filter(([, labelDim]) => labelDim <= 1080);
  return under.length > 0 ? under[0][0] : entriesDesc[entriesDesc.length - 1][0];
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
    // Some sites (TikTok) intermittently serve pages the extractor can't parse.
    extractorRetries: 5,
  };

  if (opts.output === 'mp4') {
    const h = opts.height ?? 1080;
    // Fallback chain covers sites without separate mp4/m4a streams (TikTok,
    // Instagram, X…); remux guarantees the final container is mp4 either way.
    flags.format = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
    flags.mergeOutputFormat = 'mp4';
    flags.remuxVideo = 'mp4';
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
