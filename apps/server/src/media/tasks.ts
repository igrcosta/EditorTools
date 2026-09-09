import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AudioFixOutput,
  ConvertFormat,
  LoudnessPreset,
  NoiseLevel,
  OutputFormat,
} from '@editools/shared';
import { config } from '../config';
import { runFfmpeg } from './ffmpeg';
import type { JobTask } from './jobs';
import { runDownload } from './ytdlp';

/** Media downloader (yt-dlp). Retries cover flaky sites (TikTok's anti-bot roulette). */
export function downloadTask(req: {
  url: string;
  output: OutputFormat;
  height?: number;
  title?: string;
}): JobTask {
  return {
    title: req.title,
    maxAttempts: 3,
    start: (tempDir, callbacks) =>
      runDownload({ url: req.url, output: req.output, height: req.height, tempDir }, callbacks),
    resolveOutput: async (tempDir) => {
      const file = (await readdir(tempDir)).find((f) => f.toLowerCase().endsWith(`.${req.output}`));
      return file ? path.join(tempDir, file) : undefined;
    },
  };
}

const AUDIO_FORMATS = new Set<ConvertFormat>(['mp3', 'wav', 'm4a']);

function audioCodecArgs(format: 'mp3' | 'wav' | 'm4a'): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '0'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
  }
}

/**
 * Converter / audio extractor. First attempt remuxes streams into the new
 * container (seconds); if the codecs don't fit the container, the transparent
 * retry transcodes instead.
 */
export function convertTask(req: { inputPath: string; format: ConvertFormat; title?: string }): JobTask {
  let attempt = 0;
  const outputName = `output.${req.format}`;
  return {
    title: req.title,
    maxAttempts: 2,
    start: (tempDir, callbacks) => {
      const output = path.join(tempDir, outputName);
      let args: string[];
      if (AUDIO_FORMATS.has(req.format)) {
        args = ['-i', req.inputPath, '-vn', ...audioCodecArgs(req.format as 'mp3' | 'wav' | 'm4a'), output];
      } else if (req.format === 'webm') {
        args = ['-i', req.inputPath, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', output];
      } else if (attempt === 0) {
        args = [
          '-i', req.inputPath, '-c', 'copy',
          ...(req.format === 'mp4' ? ['-movflags', '+faststart'] : []),
          output,
        ];
      } else {
        args = [
          '-i', req.inputPath,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-c:a', 'aac', '-b:a', '192k',
          ...(req.format === 'mp4' ? ['-movflags', '+faststart'] : []),
          output,
        ];
      }
      attempt += 1;
      callbacks.onStage('processing');
      return runFfmpeg(args, null, callbacks);
    },
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

const NOISE_FILTERS: Record<Exclude<NoiseLevel, 'off'>, string> = {
  light: 'afftdn=nr=6:nf=-28',
  balanced: 'afftdn=nr=12:nf=-30',
  strong: 'afftdn=nr=20:nf=-32',
};

const LOUDNESS_FILTERS: Record<Exclude<LoudnessPreset, 'off'>, string> = {
  youtube: 'loudnorm=I=-14:TP=-1.0:LRA=11',
  social: 'loudnorm=I=-14:TP=-1.0:LRA=9',
  podcast: 'loudnorm=I=-16:TP=-1.5:LRA=11',
};

/** Noise removal + loudness normalization ("Fix Audio"). */
export function audioFixTask(req: {
  inputPath: string;
  noise: NoiseLevel;
  loudness: LoudnessPreset;
  output: AudioFixOutput;
  title?: string;
}): JobTask {
  const outputName = `output.${req.output}`;
  const filters: string[] = [];
  if (req.noise !== 'off') {
    filters.push('highpass=f=75', NOISE_FILTERS[req.noise]);
  }
  if (req.loudness !== 'off') {
    filters.push(LOUDNESS_FILTERS[req.loudness]);
  }
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) => {
      const output = path.join(tempDir, outputName);
      callbacks.onStage('processing');
      return runFfmpeg(
        [
          '-i', req.inputPath,
          '-vn',
          '-af', filters.join(','),
          // loudnorm resamples to 192 kHz internally; bring it back to normal.
          '-ar', '48000',
          ...audioCodecArgs(req.output),
          output,
        ],
        null,
        callbacks,
      );
    },
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

/** Extensions we can trim without re-encoding (stream copy). */
const COPYABLE_AUDIO = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.aac']);

/** Cuts [startSeconds, endSeconds] out of an audio file. */
export function trimTask(req: {
  inputPath: string;
  startSeconds: number;
  endSeconds: number;
  title?: string;
}): JobTask {
  const inputExt = path.extname(req.inputPath).toLowerCase();
  const copyable = COPYABLE_AUDIO.has(inputExt);
  const outputName = copyable ? `output${inputExt}` : 'output.wav';
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) => {
      const output = path.join(tempDir, outputName);
      callbacks.onStage('processing');
      return runFfmpeg(
        [
          '-i', req.inputPath,
          '-ss', String(req.startSeconds),
          '-to', String(req.endSeconds),
          '-vn',
          ...(copyable ? ['-c', 'copy'] : ['-c:a', 'pcm_s16le']),
          output,
        ],
        Math.max(1, req.endSeconds - req.startSeconds),
        callbacks,
      );
    },
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

export function assertDurationAllowed(seconds: number): boolean {
  return seconds <= config.maxDurationSeconds;
}
