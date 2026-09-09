import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../config';
import type { ProcessHandle } from './ffmpeg';
import type { JobCallbacks } from './jobs';

/** Models folder ships next to the executable (same layout as the upstream release zip). */
export function realesrganModelsDir(): string | null {
  return config.realesrganPath ? path.join(path.dirname(config.realesrganPath), 'models') : null;
}

/**
 * Runs realesrgan-ncnn-vulkan (the engine behind Upscayl) with monotonic
 * progress parsed from its "12,50%" / "12.50%" stderr lines. Needs a Vulkan
 * GPU — failures surface as `gpu_required` via the shared error mapping.
 */
export function runRealesrgan(args: string[], callbacks: JobCallbacks): ProcessHandle {
  if (!config.realesrganPath) {
    return { kill() {}, done: Promise.reject(new Error('EDITOOLS_GPU_REQUIRED: realesrgan binary not configured')) };
  }
  const proc = spawn(config.realesrganPath, args, {
    windowsHide: true,
    cwd: path.dirname(config.realesrganPath),
  });

  let stderr = '';
  let emitted = 0;
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString();
    stderr = (stderr + text).slice(-8000);
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(\d+)[.,](\d+)%/.exec(line);
      if (!m) continue;
      const percent = Math.min(99, Number(m[1]));
      if (percent > emitted) {
        emitted = percent;
        callbacks.onProgress(percent);
      }
    }
  };
  proc.stderr?.on('data', onChunk);
  proc.stdout?.on('data', onChunk);

  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (err) => reject(new Error(`EDITOOLS_GPU_REQUIRED: ${err.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      // A crash before any GPU banner was printed almost always means no Vulkan runtime.
      else if (!/\[\d+ .+\]/.test(stderr)) reject(new Error(`EDITOOLS_GPU_REQUIRED: exit ${code} ${stderr.slice(-1000)}`));
      else reject(new Error(stderr.slice(-1500) || `realesrgan exited with code ${code}`));
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
