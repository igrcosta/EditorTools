import { copyFile, readdir, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type {
  AudioFixOutput,
  BgOutput,
  CaptionPosition,
  CaptionPreset,
  CaptionWord,
  ConvertFormat,
  LoudnessPreset,
  NoiseLevel,
  OutputFormat,
  SilenceMode,
  TrackAspect,
  TrackSmoothing,
  UpscaleModel,
  UpscaleOutput,
  UpscaleScale,
} from '@editools/shared';
import { config } from '../config';
import { ISNET_SIZE, predictAlphaMask } from './background';
import { buildAssTrack, normalizeWords } from './captions';
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
import { modelPath } from './features';
import {
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
import { readTranscript, transcribe } from './whisper';
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
        const ratio = aspectRatio(req.aspect, width, height);
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
        let emitted = 0;
        let pending: Buffer[] = [];
        let pendingBytes = 0;

        const handleFrame = async (frame: Buffer) => {
          assertAlive();
          const faces = await detectFaces(session, frame);
          const primary = pickPrimary(faces, previous);
          if (primary) previous = primary;
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
        const points = buildTrack(samples, { width, height, fps, duration }, crop, req.smoothing);
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
export function transcribeCaptionsTask(req: { inputPath: string; title?: string }): JobTask {
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
        if (probe.duration > config.maxCaptionSeconds) throw new Error('EDITOOLS_TOO_LONG');

        const model = modelPath('whisperBase');
        if (!model) throw new Error('EDITOOLS_ASR_MODEL_MISSING: whisper model file is missing');

        // Extract a 16kHz mono WAV (whisper.cpp's expected input format).
        const wavPath = path.join(tempDir, 'audio.wav');
        await track(
          runFfmpeg(
            ['-i', req.inputPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath],
            probe.duration,
            withoutProgress(callbacks),
          ),
        ).done;
        assertAlive();

        // Transcribe. whisper.cpp's own progress reporting is unreliable, so this
        // step stays indeterminate (matches how the other pipelines treat helper passes).
        await track(transcribe(wavPath, model, tempDir)).done;
        assertAlive();
        const { words, language } = await readTranscript(tempDir);
        if (words.length === 0) throw new Error('EDITOOLS_NO_SPEECH_DETECTED');
        callbacks.onMeta?.({ captionWordCount: words.length, captionLanguage: language });

        await writeFile(
          path.join(tempDir, outputName),
          JSON.stringify({ words, videoWidth: probe.width, videoHeight: probe.height }),
          'utf8',
        );
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
  position: CaptionPosition;
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
        await writeFile(assPath, buildAssTrack(words, req.preset, req.position, probe.width, probe.height), 'utf8');

        // Relative filename + cwd keep Windows drive colons out of the filter graph.
        await track(
          runFfmpeg(
            [
              '-i', req.inputPath,
              '-vf', 'ass=captions.ass',
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
