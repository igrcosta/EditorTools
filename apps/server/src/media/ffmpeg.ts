import { spawn, type ChildProcess } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { JobCallbacks } from './jobs';

// Packaged builds (desktop app) point at the bundled binary via env var.
const ffmpegPath = process.env.FFMPEG_PATH ?? (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';

export interface ProcessHandle {
  kill(): void;
  done: Promise<void>;
}

/** Kills the process tree (ffmpeg on Windows needs taskkill to take its children along). */
export function killProcess(proc: ChildProcess): void {
  if (!proc.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
  } else {
    proc.kill('SIGTERM');
  }
}

/** Runs ffmpeg and resolves with its full stderr (used for analysis passes like silencedetect). */
export function runFfmpegCapture(args: string[]): { kill(): void; done: Promise<string> } {
  const proc = spawn(ffmpegPath, ['-hide_banner', ...args], { windowsHide: true });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
  });
  const done = new Promise<string>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(stderr.slice(-1500) || `ffmpeg exited with code ${code}`));
    });
  });
  return { kill: () => killProcess(proc), done };
}

/** Runs ffmpeg writing to stdout (e.g. `-f rawvideo -`) and resolves with the collected bytes. */
export function runFfmpegToBuffer(args: string[]): { kill(): void; done: Promise<Buffer> } {
  const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
  const chunks: Buffer[] = [];
  let stderr = '';
  proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const done = new Promise<Buffer>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr.slice(-1500) || `ffmpeg exited with code ${code}`));
    });
  });
  return { kill: () => killProcess(proc), done };
}

/**
 * Spawns ffmpeg for streaming consumption of its stdout (frame-by-frame
 * analysis). The caller reads `proc.stdout` and awaits `exited`.
 */
export function spawnFfmpegStream(args: string[]): { proc: ChildProcess; kill(): void; exited: Promise<void> } {
  const proc = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const exited = new Promise<void>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1500) || `ffmpeg exited with code ${code}`));
    });
  });
  return { proc, kill: () => killProcess(proc), exited };
}

/**
 * Runs ffmpeg with monotonic 0–99 progress (100 is set by job finalization).
 * Duration comes from `durationHintSeconds` or is parsed from ffmpeg's own
 * "Duration:" stderr line; without either, progress stays null (indeterminate).
 */
export function runFfmpeg(
  args: string[],
  durationHintSeconds: number | null,
  callbacks: JobCallbacks,
  options: { cwd?: string } = {},
): ProcessHandle {
  const proc = spawn(ffmpegPath, ['-y', '-hide_banner', ...args, '-progress', 'pipe:1', '-nostats'], {
    windowsHide: true,
    cwd: options.cwd,
  });

  let duration = durationHintSeconds;
  let stderrTail = '';
  let emitted = 0;

  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    if (duration === null) {
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderrTail);
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  });

  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      // ffmpeg's out_time_ms is actually microseconds (long-standing quirk).
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (!m || duration === null || duration <= 0) continue;
      const seconds = Number(m[1]) / 1_000_000;
      const percent = Math.min(99, Math.round((seconds / duration) * 100));
      if (percent > emitted) {
        emitted = percent;
        callbacks.onProgress(percent);
      }
    }
  });

  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderrTail.slice(-1500) || `ffmpeg exited with code ${code}`));
    });
  });

  return { kill: () => killProcess(proc), done };
}

/**
 * Reads container/stream info without decoding (ffmpeg -i with no output exits
 * non-zero by design, so the exit code is ignored and stderr parsed instead).
 */
export function probeMedia(inputPath: string): { kill(): void; done: Promise<MediaProbe | null> } {
  const proc = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], { windowsHide: true });
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-64_000);
  });
  const done = new Promise<MediaProbe | null>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', () => resolve(parseProbe(stderr)));
  });
  return { kill: () => killProcess(proc), done };
}

export interface MediaProbe {
  width: number;
  height: number;
  fps: number | null;
  duration: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

/** Parses the "Stream … Video:" line of ffmpeg's stderr; honours 90° rotation metadata. */
export function parseProbe(stderr: string): MediaProbe | null {
  const videoLine = stderr
    .split('\n')
    .find((line) => line.includes(': Video:') && !line.includes('attached pic'));
  if (!videoLine) return null;
  const dims = /,\s*(\d{2,5})x(\d{2,5})(?:\s|,|\[|$)/.exec(videoLine.slice(videoLine.indexOf('Video:')));
  if (!dims) return null;
  let width = Number(dims[1]);
  let height = Number(dims[2]);
  const rotation = /(?:rotate\s*:\s*|rotation of\s*)(-?\d+(?:\.\d+)?)/.exec(stderr);
  if (rotation && Math.abs(Number(rotation[1])) % 180 === 90) [width, height] = [height, width];
  const fpsMatch = /(\d+(?:\.\d+)?)\s*fps/.exec(videoLine);
  const durationMatch = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return {
    width,
    height,
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    duration: durationMatch
      ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
      : null,
    hasVideo: true,
    hasAudio: stderr.includes(': Audio:'),
  };
}
