import { copyFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AudioFixOutput,
  BgOutput,
  CaptionPreset,
  CaptionWord,
  ConvertFormat,
  CookieBrowser,
  CustomCaptionStyle,
  LoudnessPreset,
  NoiseLevel,
  OutputFormat,
  SilenceMode,
  ThumbnailFrame,
  TimelineAnalysis,
  TimelineSegment,
  TrackAspect,
  TrackSmoothing,
  UpscaleModel,
  UpscaleOutput,
  UpscaleScale,
  WaveformPeaks,
} from '@editools/shared';
import { config } from '../config';
import { ISNET_SIZE, predictAlphaMask } from './background';
import { buildAssTrack, CAPTION_FONT_FILES, normalizeWords } from './captions';
import {
  aspectRatio,
  buildTrack,
  cropWindow,
  detectFaces,
  pickPrimary,
  sendcmdScript,
  YUNET_SIZE,
  type FaceBox,
  type Sample,
} from './facetrack';
import { alignerFiles, modelPath } from './features';
import {
  parseProbe,
  probeMedia,
  runFfmpeg,
  runFfmpegCapture,
  runFfmpegToBuffer,
  spawnFfmpegStream,
  type ProcessHandle,
} from './ffmpeg';
import type { JobCallbacks, JobTask } from './jobs';
import { getSession } from './onnx';
import { realesrganModelsDir, runRealesrgan } from './realesrgan';
import { loadAligner, readWav16kMono, type Aligner } from './aligner';
import { EtaProgress } from './progress';
import { readTranscript, transcribe } from './whisper';
import { runDownload } from './ytdlp';

/** Media downloader (yt-dlp). Retries cover flaky sites (TikTok's anti-bot roulette). */
export function downloadTask(req: {
  url: string;
  output: OutputFormat;
  height?: number;
  title?: string;
  cookiesFromBrowser?: CookieBrowser;
}): JobTask {
  return {
    title: req.title,
    maxAttempts: 3,
    start: (tempDir, callbacks) =>
      runDownload(
        { url: req.url, output: req.output, height: req.height, cookiesFromBrowser: req.cookiesFromBrowser, tempDir },
        callbacks,
      ),
    resolveOutput: async (tempDir) => {
      const file = (await readdir(tempDir)).find((f) => f.toLowerCase().endsWith(`.${req.output}`));
      return file ? path.join(tempDir, file) : undefined;
    },
  };
}

const AUDIO_FORMATS = new Set<ConvertFormat>(['mp3', 'wav', 'm4a', 'flac', 'ogg']);
type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'flac' | 'ogg';

function audioCodecArgs(format: AudioFormat): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-q:a', '0'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', '256k'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-q:a', '6'];
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
        args = ['-i', req.inputPath, '-vn', ...audioCodecArgs(req.format as AudioFormat), output];
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

const MAX_RENDER_SEGMENTS = 250;

/** Merges the smallest gaps between segments until the count is manageable — very long files
 *  (or a heavily hand-edited segment list) could otherwise produce an enormous filter graph. */
function capSegmentCount(segments: Segment[], max = MAX_RENDER_SEGMENTS): Segment[] {
  const kept = segments.map((s) => ({ ...s }));
  while (kept.length > max) {
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
  return capSegmentCount(kept);
}

const CHUNK_SILENCE_DB = -35;
const CHUNK_MIN_SILENCE_SECONDS = 1.2;
const CHUNK_PADDING_SECONDS = 0.2;
/** Real pauses this frequent would mean re-loading the whisper model that many times over — an
 *  extreme edge case; past it, fall back to one whisper call for the whole file. */
const MAX_TRANSCRIBE_CHUNKS = 40;

/**
 * Complement of `silences` over [0, duration], padded a little into each silence so a chunk
 * boundary doesn't clip the word right at its edge. Used to split audio into per-pause chunks
 * before transcription (see transcribeCaptionsTask) — deliberately not `keptSegments`' silence
 * *removal* semantics (that strips padding out of the kept audio for an edit; this wants the
 * opposite, generous padding, since these chunks get transcribed, not spliced into a video).
 */
function speechChunks(silences: Segment[], duration: number): Segment[] {
  const chunks: Segment[] = [];
  let cursor = 0;
  for (const s of silences) {
    const end = Math.min(duration, s.start + CHUNK_PADDING_SECONDS);
    if (end - cursor > 0.1) chunks.push({ start: cursor, end });
    cursor = Math.max(cursor, s.end - CHUNK_PADDING_SECONDS);
  }
  if (duration - cursor > 0.1) chunks.push({ start: cursor, end: duration });
  if (chunks.length === 0) chunks.push({ start: 0, end: duration });
  return chunks.length <= MAX_TRANSCRIBE_CHUNKS ? chunks : [{ start: 0, end: duration }];
}

const PEAKS_SOURCE_RATE = 1000;
const MAX_PEAK_BUCKETS = 20_000;
const THUMBNAIL_TARGET = 100;
const THUMBNAIL_MIN_INTERVAL = 0.5;
const THUMBNAIL_WIDTH = 160;
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

/** Min/max per bucket from raw f32le PCM, read byte-by-byte to avoid Buffer/Float32Array
 *  alignment issues. Bucket count is capped regardless of clip length so the JSON response
 *  stays bounded — resolution degrades gracefully on very long files instead of a hard cutoff. */
function bucketPeaks(pcm: Buffer, sourceRate: number): WaveformPeaks {
  const total = Math.floor(pcm.length / 4);
  if (total === 0) return { values: [], bucketSeconds: 0 };
  const stride = Math.max(1, Math.ceil(total / MAX_PEAK_BUCKETS));
  const values: number[] = [];
  for (let i = 0; i < total; i += stride) {
    let min = 1;
    let max = -1;
    const end = Math.min(total, i + stride);
    for (let j = i; j < end; j += 1) {
      const v = pcm.readFloatLE(j * 4);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    values.push(Number(min.toFixed(3)), Number(max.toFixed(3)));
  }
  return { values, bucketSeconds: stride / sourceRate };
}

/** Splits an MJPEG byte stream (ffmpeg `-f image2pipe -vcodec mjpeg`) on JPEG SOI/EOI markers. */
function splitMjpegFrames(buf: Buffer): Buffer[] {
  const frames: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const soi = buf.indexOf(JPEG_SOI, pos);
    if (soi === -1) break;
    const eoi = buf.indexOf(JPEG_EOI, soi + 2);
    if (eoi === -1) break;
    frames.push(buf.subarray(soi, eoi + 2));
    pos = eoi + 2;
  }
  return frames;
}

function parseVolumeDetect(stderr: string): { mean: number; max: number } | null {
  const mean = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr);
  if (!mean || !max) return null;
  return { mean: Number(mean[1]), max: Number(max[1]) };
}

/** Same headroom-above-the-sample heuristic the old client-side calibration used. */
function thresholdFromVolume(v: { mean: number; max: number }): number {
  return Math.round(Math.min(-15, Math.max(-70, Math.max(v.max + 4, v.mean + 10))));
}

/**
 * Stage 1 of the timeline tool: probes the file, detects silences at the requested mode/
 * threshold, and generates a waveform peaks array plus (for video) a thumbnail filmstrip — all
 * client-editable before anything is actually cut. An optional noise sample runs a quick,
 * range-scoped `volumedetect` pass to calibrate the threshold instead of decoding the whole file.
 */
export function analyzeTimelineTask(req: {
  inputPath: string;
  mode: SilenceMode;
  range?: TimelineSegment;
  sample?: TimelineSegment;
  title?: string;
}): JobTask {
  let outputName: string | null = null;
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');

        // Probe stream layout first — `-af silencedetect` errors out on a file with no audio
        // stream at all (e.g. a muted screen recording), so whether to even attempt it depends
        // on this pass, not the other way around.
        const probeStderr = await track(runFfmpegCapture(['-i', req.inputPath, '-f', 'null', '-'])).done;
        assertAlive();
        const duration = parseDuration(probeStderr);
        if (!duration) throw new Error('EDITOOLS_INVALID_FILE: could not determine duration');
        const hasVideo = hasRealVideoStream(probeStderr);
        const hasAudio = probeStderr.includes(': Audio:');
        const dims = parseProbe(probeStderr);
        const rangeStart = Math.min(Math.max(req.range?.start ?? 0, 0), duration);
        const rangeEnd = Math.min(Math.max(req.range?.end ?? duration, rangeStart), duration);

        let noiseDb: number | undefined;
        if (req.sample && hasAudio) {
          const dur = Math.max(0.1, req.sample.end - req.sample.start);
          const sampleStderr = await track(
            runFfmpegCapture([
              '-ss', String(req.sample.start), '-i', req.inputPath, '-t', String(dur),
              '-af', 'volumedetect', '-f', 'null', '-',
            ]),
          ).done;
          assertAlive();
          const volume = parseVolumeDetect(sampleStderr);
          if (volume) noiseDb = thresholdFromVolume(volume);
        }

        const params = req.mode === 'off' || !hasAudio ? null : SILENCE_PARAMS[req.mode];
        const effectiveNoiseDb = noiseDb ?? params?.noiseDb;

        let silences: Segment[] = [];
        if (params) {
          const detectStderr = await track(
            runFfmpegCapture([
              '-i', req.inputPath,
              '-af', `silencedetect=noise=${effectiveNoiseDb}dB:d=${params.minSilence}`,
              '-f', 'null', '-',
            ]),
          ).done;
          assertAlive();
          silences = parseSilences(detectStderr).filter((s) => s.end > rangeStart && s.start < rangeEnd);
        }
        const kept = keptSegments(silences, rangeStart, rangeEnd, params?.paddingSeconds ?? 0);

        let peaks: WaveformPeaks | null = null;
        if (hasAudio) {
          const pcm = await track(
            runFfmpegToBuffer([
              '-i', req.inputPath, '-vn', '-ac', '1', '-ar', String(PEAKS_SOURCE_RATE), '-f', 'f32le', '-',
            ]),
          ).done;
          assertAlive();
          peaks = bucketPeaks(pcm, PEAKS_SOURCE_RATE);
        }

        let thumbnails: ThumbnailFrame[] = [];
        if (hasVideo) {
          const interval = Math.max(THUMBNAIL_MIN_INTERVAL, duration / THUMBNAIL_TARGET);
          const strip = await track(
            runFfmpegToBuffer([
              '-i', req.inputPath,
              '-vf', `fps=1/${interval},scale=${THUMBNAIL_WIDTH}:-1`,
              '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '6', '-',
            ]),
          ).done;
          assertAlive();
          thumbnails = splitMjpegFrames(strip).map((buf, i) => ({
            at: Math.min(duration, i * interval),
            dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`,
          }));
        }

        const analysis: TimelineAnalysis = {
          duration,
          hasVideo,
          hasAudio,
          width: dims?.width ?? 0,
          height: dims?.height ?? 0,
          peaks,
          thumbnails,
          silences,
          kept,
          noiseDb: effectiveNoiseDb,
        };
        outputName = 'analysis.json';
        await writeFile(path.join(tempDir, outputName), JSON.stringify(analysis), 'utf8');
      }),
    resolveOutput: async (tempDir) => {
      if (!outputName) return undefined;
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

/**
 * Stage 2 of the timeline tool: rebuilds the media keeping only the given segments (trim/atrim +
 * concat, same filter-graph approach the old one-shot silence cutter used) — the client has
 * already decided what to keep, via analyzeTimelineTask plus any hand edits, so no silencedetect
 * runs here at all. Serves both "cut silence" and manual video trims: both are just edits to the
 * same kept-segment list.
 */
export function cutSegmentsTask(req: {
  inputPath: string;
  segments: TimelineSegment[];
  title?: string;
}): JobTask {
  let outputName: string | null = null;
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');

        const detectStderr = await track(runFfmpegCapture(['-i', req.inputPath, '-f', 'null', '-'])).done;
        assertAlive();
        const duration = parseDuration(detectStderr);
        if (!duration) throw new Error('EDITOOLS_INVALID_FILE: could not determine duration');
        const video = hasRealVideoStream(detectStderr);

        const kept = capSegmentCount(
          req.segments
            .map((s) => ({
              start: Math.max(0, Math.min(s.start, duration)),
              end: Math.max(0, Math.min(s.end, duration)),
            }))
            .filter((s) => s.end - s.start > 0.05)
            .sort((a, b) => a.start - b.start),
        );
        const keptTotal = kept.reduce((sum, s) => sum + (s.end - s.start), 0);
        const removed = Math.max(0, duration - keptTotal);
        const gaps =
          kept.length === 0
            ? 0
            : kept.length -
              1 +
              (kept[0].start > 0.05 ? 1 : 0) +
              (duration - kept[kept.length - 1].end > 0.05 ? 1 : 0);
        callbacks.onMeta?.({ silencesCut: gaps, removedSeconds: Math.round(removed) });

        const inputExt = path.extname(req.inputPath).toLowerCase();
        outputName = video ? 'output.mp4' : inputExt === '.mp3' ? 'output.mp3' : 'output.wav';
        const outputPath = path.join(tempDir, outputName);

        // Nothing worth cutting — deliver the file as-is.
        if (removed < 0.3 || kept.length === 0) {
          outputName = video ? `output${inputExt || '.mp4'}` : outputName;
          await copyFile(req.inputPath, path.join(tempDir, outputName));
          return;
        }

        // The filter graph can exceed Windows' command-line limit, so it goes through a script file.
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

        await track(
          runFfmpeg(
            ['-i', req.inputPath, '-filter_complex_script', scriptPath, ...outputArgs, outputPath],
            keptTotal,
            callbacks,
          ),
        ).done;
      }),
    resolveOutput: async (tempDir) => {
      if (!outputName) return undefined;
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Image tools
// ---------------------------------------------------------------------------

/** Progress from helper passes (probe, format conversion) would only confuse the bar. */
function withoutProgress(callbacks: JobCallbacks): JobCallbacks {
  return { ...callbacks, onProgress: () => undefined };
}

/**
 * Multi-step tasks share this shape: an async pipeline plus a handle whose
 * kill() reaches whichever child process is currently running.
 */
function pipelineTask(run: (ctx: { track<T extends { kill(): void }>(h: T): T; assertAlive(): void }) => Promise<void>): ProcessHandle {
  let killed = false;
  let current: { kill(): void } | null = null;
  const ctx = {
    track<T extends { kill(): void }>(h: T): T {
      current = h;
      return h;
    },
    assertAlive() {
      if (killed) throw new Error('canceled');
    },
  };
  return {
    kill() {
      killed = true;
      current?.kill();
    },
    done: run(ctx),
  };
}

function imageEncoderArgs(format: 'png' | 'jpg' | 'webp', lossless: boolean): string[] {
  switch (format) {
    case 'png':
      return ['-c:v', 'png'];
    case 'jpg':
      return ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p'];
    case 'webp':
      return lossless ? ['-c:v', 'libwebp', '-lossless', '1'] : ['-c:v', 'libwebp', '-quality', '95'];
  }
}

/**
 * Background removal (ISNet via onnxruntime). ffmpeg does the pixel work:
 * decode → 1024² RGB for the model, then the predicted alpha is scaled back
 * and merged into the original image.
 */
export function removeBackgroundTask(req: { inputPath: string; output: BgOutput; title?: string }): JobTask {
  const outputName = `output.${req.output}`;
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');
        const probe = await track(probeMedia(req.inputPath)).done;
        assertAlive();
        if (!probe) throw new Error('EDITOOLS_INVALID_FILE: not an image');
        if (probe.width * probe.height > config.maxImagePixels) throw new Error('EDITOOLS_IMAGE_TOO_LARGE');
        callbacks.onMeta?.({ inputWidth: probe.width, inputHeight: probe.height });

        const model = modelPath('isnet');
        if (!model) throw new Error('ISNet model file is missing');

        const rgb = await track(
          runFfmpegToBuffer([
            '-i', req.inputPath, '-frames:v', '1',
            '-vf', `scale=${ISNET_SIZE}:${ISNET_SIZE}:flags=lanczos`,
            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
          ]),
        ).done;
        assertAlive();

        const session = await getSession(model);
        const mask = await predictAlphaMask(session, rgb);
        assertAlive();
        const maskPath = path.join(tempDir, 'mask.raw');
        await writeFile(maskPath, mask);

        await track(
          runFfmpeg(
            [
              '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${ISNET_SIZE}x${ISNET_SIZE}`, '-i', maskPath,
              '-i', req.inputPath,
              '-filter_complex',
              `[0:v]scale=${probe.width}:${probe.height}:flags=lanczos[m];[1:v]format=rgba[i];[i][m]alphamerge[out]`,
              '-map', '[out]', '-frames:v', '1',
              ...imageEncoderArgs(req.output, true),
              path.join(tempDir, outputName),
            ],
            null,
            withoutProgress(callbacks),
          ),
        ).done;
      }),
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

const UPSCALE_MODEL_NAMES: Record<UpscaleModel, string> = {
  photo: 'realesrgan-x4plus',
  anime: 'realesrgan-x4plus-anime',
  fast: 'realesr-animevideov3',
};

/**
 * Image upscaling with Real-ESRGAN (ncnn-vulkan, the engine behind Upscayl).
 * x4plus models only do 4×; a 2× request upscales 4× then downsamples —
 * the same trick Upscayl uses.
 */
export function upscaleTask(req: {
  inputPath: string;
  model: UpscaleModel;
  scale: UpscaleScale;
  output: UpscaleOutput;
  title?: string;
}): JobTask {
  const outputName = `output.${req.output}`;
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');
        const probe = await track(probeMedia(req.inputPath)).done;
        assertAlive();
        if (!probe) throw new Error('EDITOOLS_INVALID_FILE: not an image');
        const outWidth = probe.width * req.scale;
        const outHeight = probe.height * req.scale;
        if (outWidth * outHeight > config.maxImagePixels) throw new Error('EDITOOLS_IMAGE_TOO_LARGE');
        callbacks.onMeta?.({
          inputWidth: probe.width,
          inputHeight: probe.height,
          outputWidth: outWidth,
          outputHeight: outHeight,
        });
        const modelsDir = realesrganModelsDir();
        if (!modelsDir) throw new Error('EDITOOLS_GPU_REQUIRED: realesrgan not configured');

        // Normalise to PNG so any ffmpeg-readable input works (ncnn only reads jpg/png/webp).
        const prepared = path.join(tempDir, 'in.png');
        await track(runFfmpeg(['-i', req.inputPath, '-frames:v', '1', prepared], null, withoutProgress(callbacks))).done;
        assertAlive();

        const nativeScale = req.model === 'fast' ? req.scale : 4;
        const upscaled = path.join(tempDir, 'up.png');
        await track(
          runRealesrgan(
            ['-i', prepared, '-o', upscaled, '-n', UPSCALE_MODEL_NAMES[req.model], '-s', String(nativeScale), '-m', modelsDir, '-f', 'png'],
            callbacks,
          ),
        ).done;
        assertAlive();

        const output = path.join(tempDir, outputName);
        const needsResize = nativeScale !== req.scale;
        if (!needsResize && req.output === 'png') {
          await rename(upscaled, output);
          return;
        }
        await track(
          runFfmpeg(
            [
              '-i', upscaled,
              ...(needsResize ? ['-vf', `scale=${outWidth}:${outHeight}:flags=lanczos`] : []),
              ...imageEncoderArgs(req.output, false),
              output,
            ],
            null,
            withoutProgress(callbacks),
          ),
        ).done;
      }),
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Face tracking
// ---------------------------------------------------------------------------

const ANALYSIS_FPS = 10;
/** Consecutive samples (1.5 s) without the marked face before the tracker looks for it again from the marker. */
const LOST_SUBJECT_SAMPLES = Math.ceil(ANALYSIS_FPS * 1.5);
/** Share of the progress bar given to the detection pass; the render takes the rest. */
const DETECTION_SHARE = 45;

/**
 * "Head tracking" reframe: pass 1 samples the video at 10 fps and finds the
 * face with YuNet; the smoothed path becomes a per-frame crop offset that
 * pass 2 applies through ffmpeg's sendcmd + crop, scaled to the output size.
 */
export function faceTrackTask(req: {
  inputPath: string;
  aspect: TrackAspect;
  zoom: number;
  smoothing: TrackSmoothing;
  anchorX: number;
  anchorY: number;
  /** Where the user placed the face to follow, as fractions of the frame; absent = follow the largest. */
  subject?: { x: number; y: number };
  title?: string;
}): JobTask {
  const outputName = 'output.mp4';
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');
        const probe = await track(probeMedia(req.inputPath)).done;
        assertAlive();
        if (!probe?.hasVideo || !probe.duration) throw new Error('EDITOOLS_INVALID_FILE: no video stream');
        if (probe.duration > config.maxTrackingSeconds) throw new Error('EDITOOLS_TOO_LONG');
        const model = modelPath('yunet');
        if (!model) throw new Error('YuNet model file is missing');

        const { width, height, duration } = probe;
        const fps = Math.min(120, Math.max(1, probe.fps ?? 30));
        const ratio = aspectRatio(req.aspect);
        const outSize = cropWindow(width, height, ratio, 1);
        const crop = cropWindow(width, height, ratio, req.zoom);
        callbacks.onMeta?.({ inputWidth: width, inputHeight: height, outputWidth: outSize.w, outputHeight: outSize.h });

        // Pass 1 — letterbox each sampled frame into YuNet's 640×640 input.
        const scale = Math.min(YUNET_SIZE / width, YUNET_SIZE / height);
        const scaledW = Math.max(2, Math.floor(width * scale));
        const scaledH = Math.max(2, Math.floor(height * scale));
        const stream = track(
          spawnFfmpegStream([
            '-i', req.inputPath,
            '-vf', `fps=${ANALYSIS_FPS},scale=${scaledW}:${scaledH}:flags=bilinear,pad=${YUNET_SIZE}:${YUNET_SIZE}:0:0:black`,
            '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-',
          ]),
        );
        const session = await getSession(model);
        const frameBytes = YUNET_SIZE * YUNET_SIZE * 3;
        const expectedFrames = Math.max(1, Math.ceil(duration * ANALYSIS_FPS));
        const samples: Sample[] = [];
        let previous: FaceBox | null = null;
        // The user's marker, in the analysis frame's own (letterboxed, scaled) pixels like FaceBox.
        const hint = req.subject ? { cx: req.subject.x * width * scale, cy: req.subject.y * height * scale } : null;
        let missed = 0;
        let emitted = 0;
        let pending: Buffer[] = [];
        let pendingBytes = 0;

        const handleFrame = async (frame: Buffer) => {
          assertAlive();
          const faces = await detectFaces(session, frame);
          const primary = pickPrimary(faces, previous, hint, hint !== null);
          if (primary) {
            previous = primary;
            missed = 0;
          } else if (hint && previous && (missed += 1) >= LOST_SUBJECT_SAMPLES) {
            // The marked face has been gone a while: look for it again from the marker.
            previous = null;
            missed = 0;
          }
          samples.push({
            t: samples.length / ANALYSIS_FPS,
            face: primary
              ? { cx: primary.cx / scale, cy: primary.cy / scale, size: Math.max(primary.w, primary.h) / scale }
              : null,
          });
          const percent = Math.min(DETECTION_SHARE, Math.round((samples.length / expectedFrames) * DETECTION_SHARE));
          if (percent > emitted) {
            emitted = percent;
            callbacks.onProgress(percent);
          }
        };

        for await (const chunk of stream.proc.stdout as AsyncIterable<Buffer>) {
          pending.push(chunk);
          pendingBytes += chunk.length;
          while (pendingBytes >= frameBytes) {
            const joined = pending.length === 1 ? pending[0] : Buffer.concat(pending);
            await handleFrame(joined.subarray(0, frameBytes));
            const rest = joined.subarray(frameBytes);
            pending = rest.length ? [rest] : [];
            pendingBytes = rest.length;
          }
        }
        await stream.exited;
        assertAlive();

        const seen = samples.filter((s) => s.face !== null).length;
        if (samples.length === 0 || seen === 0) throw new Error('EDITOOLS_NO_FACE_FOUND');
        callbacks.onMeta?.({
          inputWidth: width,
          inputHeight: height,
          outputWidth: outSize.w,
          outputHeight: outSize.h,
          faceCoverage: seen / samples.length,
        });

        // Smooth path → per-frame crop offsets for sendcmd.
        const points = buildTrack(samples, { width, height, fps, duration }, crop, req.smoothing, {
          x: req.anchorX,
          y: req.anchorY,
        });
        await writeFile(path.join(tempDir, 'track.cmd'), sendcmdScript(points), 'utf8');
        const filter =
          `[0:v]sendcmd=f=track.cmd,crop@c=${crop.w}:${crop.h}:${points[0].x}:${points[0].y},` +
          `scale=${outSize.w}:${outSize.h}:flags=lanczos,setsar=1[v]`;
        await writeFile(path.join(tempDir, 'filter.txt'), filter, 'utf8');

        // Pass 2 — render. Relative paths + cwd keep Windows drive colons out of the filter graph.
        await track(
          runFfmpeg(
            [
              '-i', req.inputPath,
              '-filter_complex_script', 'filter.txt',
              '-map', '[v]', '-map', '0:a?',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '192k',
              '-movflags', '+faststart',
              outputName,
            ],
            duration,
            {
              ...callbacks,
              onProgress: (p) => callbacks.onProgress(DETECTION_SHARE + Math.round((p * (99 - DETECTION_SHARE)) / 100)),
            },
            { cwd: tempDir },
          ),
        ).done;
      }),
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

/**
 * Stage 1 — transcribe only: extracts a 16kHz mono WAV, runs whisper.cpp
 * (word-level timestamps) and writes the result as `words.json`. The web app
 * lets the user edit the text/timing of each word before stage 2 renders it,
 * so this task's "output" is data, not a video — same JobTask shape either way.
 */
export function transcribeCaptionsTask(req: { inputPath: string; title?: string; language: string }): JobTask {
  const outputName = 'words.json';
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');
        const probe = await track(probeMedia(req.inputPath)).done;
        assertAlive();
        if (!probe?.hasVideo || !probe.duration) throw new Error('EDITOOLS_INVALID_FILE: no video stream');
        const duration = probe.duration;
        if (duration > config.maxCaptionSeconds) throw new Error('EDITOOLS_TOO_LONG');

        const model = modelPath('whisperModel');
        if (!model) throw new Error('EDITOOLS_ASR_MODEL_MISSING: whisper model file is missing');

        // Progress: whisper only reports once per 30 s of audio, so the bar is an estimate from
        // measured speed (see progress.ts), corrected by the real signals below. It stays under
        // 100 until the runner itself marks the job done, i.e. once every caption exists.
        const alignExpected = req.language === 'auto' || alignerFiles(req.language) !== null;
        const eta = new EtaProgress({
          whisper: 0.9,
          align: req.language === 'en' ? 0.35 : 0.65,
        });
        eta.plan({ whisper: duration, align: alignExpected ? duration : 0 });
        callbacks.onProgress(1);
        const ticker = setInterval(() => callbacks.onProgress(eta.percent()), 500);
        ticker.unref();
        try {
          // Extract a 16kHz mono WAV (whisper.cpp's expected input format).
          const wavPath = path.join(tempDir, 'audio.wav');
          await track(
            runFfmpeg(
              ['-i', req.inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath],
              duration,
              withoutProgress(callbacks),
            ),
          ).done;
          assertAlive();

          // Split on real pauses before transcribing, each chunk transcribed on its own knowing its
          // own true start offset. (whisper.cpp's --vad would do the splitting itself, but it hands
          // back token times on a timeline with the pauses removed — see transcribe() in whisper.ts.)
          const detectStderr = await track(
            runFfmpegCapture([
              '-i', wavPath,
              '-af', `silencedetect=noise=${CHUNK_SILENCE_DB}dB:d=${CHUNK_MIN_SILENCE_SECONDS}`,
              '-f', 'null', '-',
            ]),
          ).done;
          assertAlive();
          const silences = parseSilences(detectStderr).filter((s) => s.end > 0 && s.start < duration);
          const chunks = speechChunks(silences, duration);
          const speechSeconds = chunks.reduce((sum, c) => sum + (c.end - c.start), 0);
          eta.plan({ whisper: speechSeconds, align: alignExpected ? speechSeconds : 0 });

          // Timing: whisper decides *what* was said; for languages with a forced-alignment model
          // (aligner.ts) *when* each word was said is then measured by that model instead, which is
          // an order of magnitude tighter than whisper's own token times. Other languages fall back
          // to whisper's DTW timestamps (slower, still much better than the raw decoder ones).
          const words: CaptionWord[] = [];
          let language = req.language;
          let aligner: Aligner | null = null;
          let aligned = false;
          const useAlignerFor = async (lang: string): Promise<Aligner | null> => {
            const files = alignerFiles(lang);
            if (!files) return null;
            try {
              return await loadAligner(files.model, files.vocab, lang);
            } catch {
              return null; // model unreadable or runtime missing: fall back to whisper's timing
            }
          };
          if (language !== 'auto') aligner = await useAlignerFor(language);

          for (const [i, chunk] of chunks.entries()) {
            assertAlive();
            const chunkWav = path.join(tempDir, `chunk-${i}.wav`);
            await track(
              runFfmpeg(
                ['-i', wavPath, '-ss', String(chunk.start), '-t', String(chunk.end - chunk.start), '-c', 'copy', chunkWav],
                chunk.end - chunk.start,
                withoutProgress(callbacks),
              ),
            ).done;
            assertAlive();

            // DTW only when the language is known to have no aligner (it costs speed).
            let dtw = language !== 'auto' && aligner === null;
            const chunkSeconds = chunk.end - chunk.start;
            // whisper reports once per 30 s window of audio.
          const whisperWindow = Math.min(1, 30 / chunkSeconds);
          eta.begin('whisper', chunkSeconds, whisperWindow);
            await track(
              transcribe(chunkWav, model, tempDir, `chunk-${i}`, { language, dtw, onProgress: (f) => eta.setReal(f, f + whisperWindow) }),
            ).done;
            eta.end();
            assertAlive();
            let result = await readTranscript(tempDir, `chunk-${i}`, { dtw });

            // "Auto": the first chunk's guess becomes the language for the rest, so one clip never
            // flips between languages mid-way, and it picks the aligner.
            if (language === 'auto' && result.language) {
              language = result.language;
              aligner = await useAlignerFor(language);
              if (aligner === null) {
                eta.skipAlign();
                dtw = true;
                await track(transcribe(chunkWav, model, tempDir, `chunk-${i}`, { language, dtw })).done;
                assertAlive();
                result = await readTranscript(tempDir, `chunk-${i}`, { dtw });
              }
            }

            let chunkWords = result.words;
            if (aligner && result.words.length > 0) {
              try {
                const samples = await readWav16kMono(chunkWav);
                eta.begin('align', chunkSeconds);
                chunkWords = await aligner.align(samples, result.words, result.segments, assertAlive, (done, total) =>
                  eta.setReal(done / total, (done + 1) / total),
                );
                eta.end();
                aligned = true;
              } catch {
                assertAlive(); // a cancel must stay a cancel; anything else keeps whisper's own timing
                chunkWords = result.words;
              }
            }
            for (const w of chunkWords) words.push({ text: w.text, start: w.start + chunk.start, end: w.end + chunk.start });
          }
          if (words.length === 0) throw new Error('EDITOOLS_NO_SPEECH_DETECTED');
          callbacks.onMeta?.({
            captionWordCount: words.length,
            captionLanguage: language === 'auto' ? undefined : language,
            captionTiming: aligned ? 'aligned' : 'estimated',
          });

          await writeFile(
            path.join(tempDir, outputName),
            JSON.stringify({ words, videoWidth: probe.width, videoHeight: probe.height, videoFps: probe.fps }),
            'utf8',
          );
        } finally {
          clearInterval(ticker);
        }
      }),
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}

/**
 * Stage 2 — render: takes the (possibly user-edited) word list plus a style
 * preset and position zone, builds the .ass track and burns it in. No ASR
 * here at all, so it's a plain single-pass ffmpeg pipeline.
 */
export function renderCaptionsTask(req: {
  inputPath: string;
  words: CaptionWord[];
  preset: CaptionPreset;
  customStyle: CustomCaptionStyle | null;
  positionX: number;
  positionY: number;
  scale: number;
  title?: string;
}): JobTask {
  const outputName = 'output.mp4';
  return {
    title: req.title,
    maxAttempts: 1,
    start: (tempDir, callbacks) =>
      pipelineTask(async ({ track, assertAlive }) => {
        callbacks.onStage('processing');
        const probe = await track(probeMedia(req.inputPath)).done;
        assertAlive();
        if (!probe?.hasVideo || !probe.duration) throw new Error('EDITOOLS_INVALID_FILE: no video stream');
        if (probe.duration > config.maxCaptionSeconds) throw new Error('EDITOOLS_TOO_LONG');

        const words = normalizeWords(req.words);
        if (words.length === 0) throw new Error('EDITOOLS_INVALID_FILE: no caption text');

        const assPath = path.join(tempDir, 'captions.ass');
        await writeFile(
          assPath,
          buildAssTrack(
            words,
            req.preset,
            req.customStyle,
            req.positionX,
            req.positionY,
            req.scale,
            probe.width,
            probe.height,
          ),
          'utf8',
        );

        // A custom template's font is a bundled file, not something libass finds via the
        // system font list — copy it into a relative "fonts" folder inside tempDir (relative,
        // like the .ass path below, to dodge Windows drive-colon escaping in the filter graph)
        // and point `fontsdir` at it.
        let fontsFilterArg = '';
        if (req.customStyle) {
          const fontFile = CAPTION_FONT_FILES[req.customStyle.font].file;
          if (!config.fontsDir) throw new Error('EDITOOLS_ASR_MODEL_MISSING: bundled caption fonts are missing');
          const fontsSubdir = path.join(tempDir, 'fonts');
          await mkdir(fontsSubdir, { recursive: true });
          await copyFile(path.join(config.fontsDir, fontFile), path.join(fontsSubdir, fontFile));
          fontsFilterArg = ':fontsdir=fonts';
        }

        // Relative filename + cwd keep Windows drive colons out of the filter graph.
        await track(
          runFfmpeg(
            [
              '-i', req.inputPath,
              '-vf', `ass=captions.ass${fontsFilterArg}`,
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
              '-c:a', 'copy',
              '-movflags', '+faststart',
              outputName,
            ],
            probe.duration,
            callbacks,
            { cwd: tempDir },
          ),
        ).done;
      }),
    resolveOutput: async (tempDir) => {
      const output = path.join(tempDir, outputName);
      return existsSync(output) ? output : undefined;
    },
  };
}
