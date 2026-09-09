import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type { JobCallbacks } from './jobs';

// Packaged builds (desktop app) point at the bundled binary via env var.
const ffmpegPath = process.env.FFMPEG_PATH ?? (ffmpegStatic as unknown as string | null) ?? 'ffmpeg';

export interface ProcessHandle {
  kill(): void;
  done: Promise<void>;
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
  return {
    kill() {
      if (!proc.pid) return;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      } else {
        proc.kill('SIGTERM');
      }
    },
    done,
  };
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
): ProcessHandle {
  const proc = spawn(ffmpegPath, ['-y', '-hide_banner', ...args, '-progress', 'pipe:1', '-nostats'], {
    windowsHide: true,
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

  return {
    kill() {
      if (!proc.pid) return;
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
      } else {
        proc.kill('SIGTERM');
      }
    },
    done,
  };
}
