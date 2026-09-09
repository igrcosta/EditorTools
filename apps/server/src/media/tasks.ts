import { copyFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AudioFixOutput,
  ConvertFormat,
  LoudnessPreset,
  NoiseLevel,
  OutputFormat,
  SilenceMode,
} from '@editools/shared';
import { config } from '../config';
import { runFfmpeg, runFfmpegCapture, type ProcessHandle } from './ffmpeg';
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

export function assertDurationAllowed(seconds: number): boolean {
  return seconds <= config.maxDurationSeconds;
}

interface SilenceParams {
  noiseDb: number;
  minSilence: number;
  /** Silence kept around each cut so edits breathe. */
  paddingSeconds: number;
}

const SILENCE_PARAMS: Record<Exclude<SilenceMode, 'off'>, SilenceParams> = {
  gentle: { noiseDb: -40, minSilence: 1.0, paddingSeconds: 0.25 },
  balanced: { noiseDb: -35, minSilence: 0.6, paddingSeconds: 0.15 },
  aggressive: { noiseDb: -30, minSilence: 0.35, paddingSeconds: 0.08 },
};

interface Segment {
  start: number;
  end: number;
}

function parseSilences(stderr: string): Segment[] {
  const silences: Segment[] = [];
  const re = /silence_start:\s*(-?[\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  for (let m = re.exec(stderr); m; m = re.exec(stderr)) {
    silences.push({ start: Math.max(0, Number(m[1])), end: Number(m[2]) });
  }
  return silences;
}

function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function hasRealVideoStream(stderr: string): boolean {
  return stderr
    .split('\n')
    .some((line) => line.includes(': Video:') && !line.includes('attached pic'));
}

/** Complement of the silences over [rangeStart, rangeEnd], with breathing padding. */
function keptSegments(
  silences: Segment[],
  rangeStart: number,
  rangeEnd: number,
  padding: number,
): Segment[] {
  const kept: Segment[] = [];
  let cursor = rangeStart;
  for (const s of silences) {
    if (s.end <= rangeStart || s.start >= rangeEnd) continue;
    const end = Math.min(Math.max(s.start, rangeStart) + padding, rangeEnd);
    if (end - cursor > 0.05) kept.push({ start: cursor, end });
    cursor = Math.max(Math.min(s.end, rangeEnd) - padding, end);
  }
  if (rangeEnd - cursor > 0.05) kept.push({ start: cursor, end: rangeEnd });
  // Very long files could produce enormous filter graphs — merge the smallest
  // gaps until the segment count is manageable.
  while (kept.length > 250) {
    let idx = 0;
    let smallest = Infinity;
    for (let i = 0; i < kept.length - 1; i += 1) {
      const gap = kept[i + 1].start - kept[i].end;
      if (gap < smallest) {
        smallest = gap;
        idx = i;
      }
    }
    kept[idx] = { start: kept[idx].start, end: kept[idx + 1].end };
    kept.splice(idx + 1, 1);
  }
  return kept;
}

/**
 * AutoCut-style silence removal for audio and video: pass 1 maps silences with
 * silencedetect, pass 2 rebuilds the media keeping only the audible segments.
 * An optional range trims to [start, end] first; mode 'off' skips silence
 * cutting entirely (pure trim).
 */
export function silenceCutTask(req: {
  inputPath: string;
  mode: SilenceMode;
  range?: { start: number; end: number };
  /** Threshold calibrated from a user-selected noise sample; overrides the mode preset. */
  noiseDbOverride?: number;
  title?: string;
}): JobTask {
  const params = req.mode === 'off' ? null : SILENCE_PARAMS[req.mode];
  const noiseDb = req.noiseDbOverride ?? params?.noiseDb;
  let outputName: string | null = null;
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) => {
      let killed = false;
      let current: { kill(): void } | null = null;

      const done = (async () => {
        callbacks.onStage('processing');

        // Pass 1 — detect silences (also tells us duration and stream layout).
        const detect = runFfmpegCapture([
          '-i', req.inputPath,
          ...(params
            ? ['-af', `silencedetect=noise=${noiseDb}dB:d=${params.minSilence}`]
            : []),
          '-f', 'null', '-',
        ]);
        current = detect;
        const stderr = await detect.done;
        if (killed) throw new Error('canceled');

        const duration = parseDuration(stderr);
        if (!duration) throw new Error('could not determine duration');
        const rangeStart = Math.min(Math.max(req.range?.start ?? 0, 0), duration);
        const rangeEnd = Math.min(Math.max(req.range?.end ?? duration, rangeStart), duration);
        const silences = params
          ? parseSilences(stderr).filter((s) => s.end > rangeStart && s.start < rangeEnd)
          : [];
        const kept = keptSegments(silences, rangeStart, rangeEnd, params?.paddingSeconds ?? 0);
        const keptTotal = kept.reduce((sum, s) => sum + (s.end - s.start), 0);
        const removed = Math.max(0, duration - keptTotal);
        if (params) {
          callbacks.onMeta?.({
            silencesCut: silences.length,
            removedSeconds: Math.round(Math.max(0, rangeEnd - rangeStart - keptTotal)),
          });
        }

        const video = hasRealVideoStream(stderr);
        const inputExt = path.extname(req.inputPath).toLowerCase();
        outputName = video ? 'output.mp4' : inputExt === '.mp3' ? 'output.mp3' : 'output.wav';
        const outputPath = path.join(tempDir, outputName);

        // Nothing worth cutting — deliver the file as-is.
        if (removed < 0.3 || kept.length === 0) {
          outputName = video ? `output${inputExt || '.mp4'}` : outputName;
          await copyFile(req.inputPath, path.join(tempDir, outputName));
          return;
        }

        // Pass 2 — rebuild without the silences. The filter graph can exceed
        // Windows' command-line limit, so it goes through a script file.
        const filters: string[] = [];
        const concatInputs: string[] = [];
        kept.forEach((s, i) => {
          if (video) {
            filters.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`);
            filters.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`);
            concatInputs.push(`[v${i}][a${i}]`);
          } else {
            filters.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`);
            concatInputs.push(`[a${i}]`);
          }
        });
        filters.push(
          `${concatInputs.join('')}concat=n=${kept.length}:v=${video ? 1 : 0}:a=1${video ? '[v][a]' : '[a]'}`,
        );
        const scriptPath = path.join(tempDir, 'filter.txt');
        await writeFile(scriptPath, filters.join(';\n'), 'utf8');

        const outputArgs = video
          ? ['-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
             '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
          : outputName === 'output.mp3'
            ? ['-map', '[a]', '-c:a', 'libmp3lame', '-q:a', '0']
            : ['-map', '[a]', '-c:a', 'pcm_s16le'];

        const render = runFfmpeg(
          ['-i', req.inputPath, '-filter_complex_script', scriptPath, ...outputArgs, outputPath],
          keptTotal,
          callbacks,
        );
        current = render;
        await render.done;
      })();

      const handle: ProcessHandle = {
        kill() {
          killed = true;
          current?.kill();
        },
        done,
      };
      return handle;
    },
    resolveOutput: async (tempDir) => {
      if (!outputName) return undefined;
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}
